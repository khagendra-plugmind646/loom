use anchor_lang::prelude::*;
use anchor_spl::token_interface::{transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::constants::*;
use crate::error::LoomError;
use crate::events::*;
use crate::state::*;

#[derive(Accounts)]
pub struct InitPool<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin)]
    pub config: Box<Account<'info, Config>>,
    /// Pools exist only for stablecoins Loom lends (those with a reserve).
    #[account(seeds = [RESERVE_SEED, mint.key().as_ref()], bump = reserve.bump, has_one = mint)]
    pub reserve: Box<Account<'info, Reserve>>,
    #[account(mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(init, payer = admin, space = 8 + Pool::INIT_SPACE, seeds = [POOL_SEED, mint.key().as_ref()], bump)]
    pub pool: Box<Account<'info, Pool>>,
    #[account(
        init,
        payer = admin,
        seeds = [POOL_VAULT_SEED, mint.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = pool,
        token::token_program = token_program,
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, seeds = [POOL_SEED, mint.key().as_ref()], bump = pool.bump, has_one = mint, has_one = vault)]
    pub pool: Box<Account<'info, Pool>>,
    #[account(mut)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, token::mint = mint, token::authority = owner, token::token_program = token_program)]
    pub owner_token: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = owner,
        space = 8 + LenderPosition::INIT_SPACE,
        seeds = [LENDER_SEED, mint.key().as_ref(), owner.key().as_ref()],
        bump,
    )]
    pub position: Box<Account<'info, LenderPosition>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    pub owner: Signer<'info>,
    #[account(mut, seeds = [POOL_SEED, mint.key().as_ref()], bump = pool.bump, has_one = mint, has_one = vault)]
    pub pool: Box<Account<'info, Pool>>,
    #[account(mut)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, token::mint = mint, token::token_program = token_program)]
    pub destination: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, seeds = [LENDER_SEED, mint.key().as_ref(), owner.key().as_ref()], bump = position.bump, has_one = owner)]
    pub position: Box<Account<'info, LenderPosition>>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn process_init_pool(ctx: Context<InitPool>) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    pool.mint = ctx.accounts.mint.key();
    pool.vault = ctx.accounts.vault.key();
    pool.cash = 0;
    pool.principal_out = 0;
    pool.total_shares = 0;
    pool.total_deposited = 0;
    pool.total_withdrawn = 0;
    pool.interest_earned = 0;
    pool.bump = ctx.bumps.pool;
    pool.vault_bump = ctx.bumps.vault;
    Ok(())
}

pub fn process_deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    require!(amount > 0, LoomError::ZeroAmount);
    let shares = ctx.accounts.pool.shares_for(amount)?;
    require!(shares > 0, LoomError::DepositTooSmall);

    transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.owner_token.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        ),
        amount,
        ctx.accounts.mint.decimals,
    )?;

    let pool = &mut ctx.accounts.pool;
    pool.cash = pool.cash.checked_add(amount).ok_or(LoomError::MathOverflow)?;
    pool.total_shares = pool.total_shares.checked_add(shares).ok_or(LoomError::MathOverflow)?;
    pool.total_deposited = pool.total_deposited.checked_add(amount).ok_or(LoomError::MathOverflow)?;

    let position = &mut ctx.accounts.position;
    position.owner = ctx.accounts.owner.key();
    position.mint = pool.mint;
    position.shares = position.shares.checked_add(shares).ok_or(LoomError::MathOverflow)?;
    position.deposited = position.deposited.checked_add(amount).ok_or(LoomError::MathOverflow)?;
    position.bump = ctx.bumps.position;

    emit!(PoolDeposited { mint: pool.mint, owner: position.owner, amount, shares });
    Ok(())
}

pub fn process_withdraw(ctx: Context<Withdraw>, shares: u64) -> Result<()> {
    require!(shares > 0, LoomError::ZeroAmount);
    require!(shares <= ctx.accounts.position.shares, LoomError::InsufficientShares);
    let amount = ctx.accounts.pool.amount_for(shares)?;
    require!(amount > 0, LoomError::ZeroAmount);
    // Only cash can leave; principal that is lent out comes back as loans are repaid.
    require!(amount <= ctx.accounts.pool.cash, LoomError::InsufficientPoolLiquidity);

    let mint_key = ctx.accounts.mint.key();
    let seeds: &[&[u8]] = &[POOL_SEED, mint_key.as_ref(), &[ctx.accounts.pool.bump]];
    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.vault.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.destination.to_account_info(),
                authority: ctx.accounts.pool.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        ctx.accounts.mint.decimals,
    )?;

    let pool = &mut ctx.accounts.pool;
    pool.cash -= amount;
    pool.total_shares -= shares;
    pool.total_withdrawn = pool.total_withdrawn.checked_add(amount).ok_or(LoomError::MathOverflow)?;
    let position = &mut ctx.accounts.position;
    position.shares -= shares;
    position.withdrawn = position.withdrawn.checked_add(amount).ok_or(LoomError::MathOverflow)?;

    emit!(PoolWithdrawn { mint: pool.mint, owner: position.owner, amount, shares });
    Ok(())
}
