use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::constants::*;
use crate::error::LoomError;
use crate::events::*;
use crate::state::*;

/// Adds SOL to an active loan's escrow, which lowers the price at which it can be seized.
/// Anyone may top up (e.g. a friend); the SOL always belongs to the loan and returns to the borrower.
#[derive(Accounts)]
pub struct AddCollateral<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut)]
    pub loan: Box<Account<'info, Loan>>,
    #[account(mut, seeds = [ESCROW_SEED, loan.key().as_ref()], bump = loan.escrow_bump)]
    pub escrow: Account<'info, CollateralEscrow>,
    pub system_program: Program<'info, System>,
}

pub fn process_add_collateral(ctx: Context<AddCollateral>, lamports: u64) -> Result<()> {
    require!(lamports > 0, LoomError::ZeroAmount);
    let loan = &ctx.accounts.loan;
    require!(loan.status == LoanStatus::Active, LoomError::LoanNotActive);
    require!(Clock::get()?.unix_timestamp <= loan.maturity_ts, LoomError::LoanMatured);

    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer { from: ctx.accounts.payer.to_account_info(), to: ctx.accounts.escrow.to_account_info() },
        ),
        lamports,
    )?;

    let loan_key = ctx.accounts.loan.key();
    let loan = &mut ctx.accounts.loan;
    if loan.opening_collateral_lamports == 0 {
        loan.opening_collateral_lamports = loan.collateral_lamports;
    }
    loan.collateral_lamports = loan.collateral_lamports.checked_add(lamports).ok_or(LoomError::MathOverflow)?;
    let stats = &mut ctx.accounts.config.stats;
    stats.collateral_locked_lamports = stats.collateral_locked_lamports.checked_add(lamports).ok_or(LoomError::MathOverflow)?;

    emit!(CollateralAdded { loan: loan_key, payer: ctx.accounts.payer.key(), lamports, collateral_lamports: loan.collateral_lamports });
    Ok(())
}
