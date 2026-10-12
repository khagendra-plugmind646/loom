use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::constants::*;
use crate::error::LoomError;
use crate::events::*;
use crate::merkle::credit_leaf;
use crate::state::*;

#[derive(Accounts)]
pub struct Repay<'info> {
    /// Anyone may repay on the borrower's behalf; collateral always goes back to the borrower.
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = treasury)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, has_one = borrower)]
    pub loan: Box<Account<'info, Loan>>,
    /// CHECK: receives the released collateral; pinned to `loan.borrower`.
    #[account(mut)]
    pub borrower: UncheckedAccount<'info>,
    #[account(mut, seeds = [ESCROW_SEED, loan.key().as_ref()], bump = loan.escrow_bump)]
    pub escrow: Account<'info, CollateralEscrow>,
    #[account(mut, seeds = [CREDIT_TREE_SEED], bump = credit_tree.bump)]
    pub credit_tree: Box<Account<'info, CreditTree>>,
    /// Reserve of the stablecoin used for this payment (USDC or USDT — either is accepted).
    #[account(mut, seeds = [RESERVE_SEED, mint.key().as_ref()], bump = reserve.bump, has_one = mint)]
    pub reserve: Box<Account<'info, Reserve>>,
    #[account(mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, token::mint = mint, token::authority = payer, token::token_program = token_program)]
    pub payer_token: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: admin treasury wallet, pinned by `has_one = treasury`.
    pub treasury: UncheckedAccount<'info>,
    /// Repayments go directly to the admin treasury's token account.
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = treasury,
        associated_token::token_program = token_program,
    )]
    pub treasury_token: Box<InterfaceAccount<'info, TokenAccount>>,
    /// Lending pool of the payment coin: required for pool-funded loans (repayments go back to it).
    #[account(mut, seeds = [POOL_SEED, mint.key().as_ref()], bump = pool.bump)]
    pub pool: Option<Box<Account<'info, Pool>>>,
    #[account(mut)]
    pub pool_vault: Option<Box<InterfaceAccount<'info, TokenAccount>>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn process_repay(ctx: Context<Repay>, amount: u64) -> Result<()> {
    require!(amount > 0, LoomError::ZeroAmount);
    let now = Clock::get()?.unix_timestamp;
    let (pay, interest_part, from_pool) = {
        let loan = &mut ctx.accounts.loan;
        require!(loan.status == LoanStatus::Active, LoomError::LoanNotActive);
        require!(now <= loan.maturity_ts, LoomError::LoanMatured);
        loan.accrue(now)?;
        // Overpayments are capped at what is owed right now; each payment covers interest first.
        let pay = amount.min(loan.owed()?);
        (pay, pay.min(loan.interest_due()?), loan.from_pool)
    };

    // Pool-funded loans pay the pool back (principal + interest minus the protocol fee);
    // treasury-funded loans pay the treasury.
    let (to_pool, to_treasury) = if from_pool {
        require_keys_eq!(ctx.accounts.mint.key(), ctx.accounts.loan.mint, LoomError::RepayInLoanCoin);
        let (pool, vault) = match (&ctx.accounts.pool, &ctx.accounts.pool_vault) {
            (Some(p), Some(v)) => (p, v),
            _ => return err!(LoomError::PoolAccountsRequired),
        };
        require_keys_eq!(vault.key(), pool.vault, LoomError::InvalidPool);
        let fee = (interest_part as u128 * PROTOCOL_FEE_BPS as u128 / BPS as u128) as u64;
        (pay - fee, fee)
    } else {
        (0, pay)
    };
    if to_pool > 0 {
        let vault = ctx.accounts.pool_vault.as_ref().unwrap();
        pay_from_payer(&ctx.accounts, vault.to_account_info(), to_pool)?;
    }
    if to_treasury > 0 {
        pay_from_payer(&ctx.accounts, ctx.accounts.treasury_token.to_account_info(), to_treasury)?;
    }
    if from_pool {
        let pool = ctx.accounts.pool.as_mut().unwrap();
        pool.cash = pool.cash.checked_add(to_pool).ok_or(LoomError::MathOverflow)?;
        pool.principal_out = pool.principal_out.saturating_sub(pay - interest_part);
        pool.interest_earned = pool.interest_earned.checked_add(interest_part - to_treasury).ok_or(LoomError::MathOverflow)?;
    }

    let loan_key = ctx.accounts.loan.key();
    let loan = &mut ctx.accounts.loan;
    let principal_part = pay - interest_part;
    loan.repaid += pay;
    loan.principal_repaid += principal_part;
    let remaining = loan.owed()?;
    let reserve = &mut ctx.accounts.reserve;
    reserve.total_repaid = reserve.total_repaid.checked_add(pay).ok_or(LoomError::MathOverflow)?;
    let stats = &mut ctx.accounts.config.stats;
    stats.total_repaid = stats.total_repaid.checked_add(pay).ok_or(LoomError::MathOverflow)?;
    stats.outstanding_debt = stats.outstanding_debt.saturating_sub(principal_part);

    emit!(RepaymentMade {
        loan: loan_key,
        payer: ctx.accounts.payer.key(),
        mint: ctx.accounts.mint.key(),
        amount: pay,
        repaid: loan.repaid,
        remaining,
    });

    if remaining > 0 {
        return Ok(());
    }

    // ---- Fully repaid: release collateral and record the credit leaf ----
    loan.status = LoanStatus::Repaid;
    loan.closed_ts = now;

    // The ZK credit leaf is optional: a full tree must never block a borrower from
    // repaying and getting their collateral back.
    if loan.identity_commitment != [0u8; 32] && !ctx.accounts.credit_tree.is_full() {
        let leaf = credit_leaf(&loan.identity_commitment, loan.principal, loan.repaid, loan.start_ts, now)?;
        let index = ctx.accounts.credit_tree.insert(leaf)?;
        loan.credit_leaf = leaf;
        loan.credit_leaf_index = index;
        emit!(CreditLeafInserted { loan: loan_key, leaf, index, root: ctx.accounts.credit_tree.current_root() });
    }

    let collateral = loan.collateral_lamports;
    let credit_leaf_index = loan.credit_leaf_index;
    let borrower = loan.borrower;

    // Closing the escrow sends collateral + rent back to the borrower.
    ctx.accounts.escrow.close(ctx.accounts.borrower.to_account_info())?;

    let stats = &mut ctx.accounts.config.stats;
    stats.loans_repaid += 1;
    stats.active_loans -= 1;
    stats.collateral_locked_lamports = stats.collateral_locked_lamports.saturating_sub(collateral);

    emit!(LoanRepaid { loan: loan_key, borrower, collateral_returned: collateral, credit_leaf_index });
    Ok(())
}

/// Transfers `amount` of the payment coin from the payer to `to`.
fn pay_from_payer<'info>(accounts: &Repay<'info>, to: AccountInfo<'info>, amount: u64) -> Result<()> {
    transfer_checked(
        CpiContext::new(
            accounts.token_program.to_account_info(),
            TransferChecked {
                from: accounts.payer_token.to_account_info(),
                mint: accounts.mint.to_account_info(),
                to,
                authority: accounts.payer.to_account_info(),
            },
        ),
        amount,
        accounts.mint.decimals,
    )
}
