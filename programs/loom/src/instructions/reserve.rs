use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::constants::*;
use crate::error::LoomError;
use crate::events::*;
use crate::state::*;

#[derive(Accounts)]
pub struct InitReserve<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin, has_one = treasury)]
    pub config: Box<Account<'info, Config>>,
    #[account(mint::token_program = token_program, constraint = mint.decimals == STABLE_DECIMALS @ LoomError::InvalidMintDecimals)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(init, payer = admin, space = 8 + Reserve::INIT_SPACE, seeds = [RESERVE_SEED, mint.key().as_ref()], bump)]
    pub reserve: Box<Account<'info, Reserve>>,
    #[account(
        init,
        payer = admin,
        seeds = [VAULT_SEED, mint.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = reserve,
        token::token_program = token_program,
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: the treasury wallet, pinned by `has_one = treasury` on config.
    pub treasury: UncheckedAccount<'info>,
    /// Treasury token account that will receive repayments in this stablecoin.
    #[account(
        init_if_needed,
        payer = admin,
        associated_token::mint = mint,
        associated_token::authority = treasury,
        associated_token::token_program = token_program,
    )]
    pub treasury_token: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FundReserve<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [RESERVE_SEED, mint.key().as_ref()], bump = reserve.bump, has_one = mint, has_one = vault)]
    pub reserve: Box<Account<'info, Reserve>>,
    #[account(mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = mint, token::authority = admin, token::token_program = token_program)]
    pub admin_token: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct WithdrawReserve<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [RESERVE_SEED, mint.key().as_ref()], bump = reserve.bump, has_one = mint, has_one = vault)]
    pub reserve: Box<Account<'info, Reserve>>,
    #[account(mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = mint, token::token_program = token_program)]
    pub destination: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn process_init_reserve(ctx: Context<InitReserve>) -> Result<()> {
    let reserve = &mut ctx.accounts.reserve;
    reserve.mint = ctx.accounts.mint.key();
    reserve.vault = ctx.accounts.vault.key();
    reserve.decimals = ctx.accounts.mint.decimals;
    reserve.total_funded = 0;
    reserve.total_withdrawn = 0;
    reserve.total_disbursed = 0;
    reserve.total_repaid = 0;
    reserve.bump = ctx.bumps.reserve;
    reserve.vault_bump = ctx.bumps.vault;
    Ok(())
}

pub fn process_fund_reserve(ctx: Context<FundReserve>, amount: u64) -> Result<()> {
    require!(amount > 0, LoomError::ZeroAmount);
    let accounts = &ctx.accounts;
    transfer_checked(
        CpiContext::new(
            accounts.token_program.to_account_info(),
            TransferChecked {
                from: accounts.admin_token.to_account_info(),
                mint: accounts.mint.to_account_info(),
                to: accounts.vault.to_account_info(),
                authority: accounts.admin.to_account_info(),
            },
        ),
        amount,
        accounts.mint.decimals,
    )?;

    let reserve = &mut ctx.accounts.reserve;
    reserve.total_funded = reserve.total_funded.checked_add(amount).ok_or(LoomError::MathOverflow)?;
    ctx.accounts.vault.reload()?;
    emit!(ReserveFunded { mint: reserve.mint, amount, vault_balance: ctx.accounts.vault.amount });
    Ok(())
}

pub fn process_withdraw_reserve(ctx: Context<WithdrawReserve>, amount: u64) -> Result<()> {
    require!(amount > 0, LoomError::ZeroAmount);
    require!(ctx.accounts.vault.amount >= amount, LoomError::InsufficientLiquidity);

    let mint_key = ctx.accounts.mint.key();
    let seeds: &[&[u8]] = &[RESERVE_SEED, mint_key.as_ref(), &[ctx.accounts.reserve.bump]];
    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.vault.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.destination.to_account_info(),
                authority: ctx.accounts.reserve.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        ctx.accounts.mint.decimals,
    )?;

    let reserve = &mut ctx.accounts.reserve;
    reserve.total_withdrawn = reserve.total_withdrawn.checked_add(amount).ok_or(LoomError::MathOverflow)?;
    ctx.accounts.vault.reload()?;
    emit!(ReserveWithdrawn {
        mint: reserve.mint,
        amount,
        destination: ctx.accounts.destination.key(),
        vault_balance: ctx.accounts.vault.amount,
    });
    Ok(())
}
