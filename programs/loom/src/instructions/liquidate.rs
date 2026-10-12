use anchor_lang::prelude::*;
use anchor_lang::solana_program::program_option::COption;
use anchor_spl::token_interface::{transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::constants::*;
use crate::error::LoomError;
use crate::events::*;
use crate::math;
use crate::oracle::load_sol_usd_prices;
use crate::state::*;

/// Permissionless: anyone (a keeper bot, the admin, an investor) can settle a loan
/// that is past its term, whose SOL price fell to 60% of the opening price,
/// or whose collateral fell below the liquidation threshold. The program — not the caller — decides where every lamport goes:
///   * past its term (default): SOL worth the outstanding debt at the current price -> treasury,
///     the rest of the collateral -> borrower (all of it -> treasury if it is worth less than the debt)
///   * price rule / threshold:  all of the SOL collateral -> treasury
///   * escrow rent              -> borrower
/// A pool-funded loan is first bought out by the treasury: it pays the pool everything the loan owes
/// (from its approved payouts), so depositors are repaid in full and the treasury takes the SOL.
/// Borrowers accept these rules before borrowing. They keep the stablecoin they received; the debt is cancelled.
#[derive(Accounts)]
pub struct Liquidate<'info> {
    pub caller: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = treasury)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, has_one = borrower)]
    pub loan: Box<Account<'info, Loan>>,
    #[account(mut, seeds = [ESCROW_SEED, loan.key().as_ref()], bump = loan.escrow_bump)]
    pub escrow: Account<'info, CollateralEscrow>,
    /// CHECK: pinned to `loan.borrower`; receives the escrow's rent.
    #[account(mut)]
    pub borrower: UncheckedAccount<'info>,
    /// CHECK: pinned to `config.treasury`; receives seized collateral.
    #[account(mut)]
    pub treasury: UncheckedAccount<'info>,
    /// CHECK: validated in `load_sol_usd_prices`.
    pub price_update: UncheckedAccount<'info>,
    /// CHECK: Chainlink SOL/USD feed — address pinned here; owner, layout and staleness checked in `load_sol_usd_prices`.
    #[account(address = CHAINLINK_SOL_USD_FEED @ LoomError::InvalidChainlinkFeed)]
    pub chainlink_feed: UncheckedAccount<'info>,
    // ---- pool-funded loans only: the treasury's buy-out of the loan ----
    #[account(mut, seeds = [POOL_SEED, loan.mint.as_ref()], bump = pool.bump)]
    pub pool: Option<Box<Account<'info, Pool>>>,
    #[account(mut)]
    pub pool_vault: Option<Box<InterfaceAccount<'info, TokenAccount>>>,
    /// Signs the buy-out as the delegate the treasury approved on its token account.
    #[account(seeds = [RESERVE_SEED, loan.mint.as_ref()], bump = reserve.bump)]
    pub reserve: Option<Box<Account<'info, Reserve>>>,
    #[account(address = loan.mint)]
    pub mint: Option<Box<InterfaceAccount<'info, Mint>>>,
    #[account(mut)]
    pub treasury_token: Option<Box<InterfaceAccount<'info, TokenAccount>>>,
    pub token_program: Option<Interface<'info, TokenInterface>>,
}

pub fn process_liquidate(mut ctx: Context<Liquidate>) -> Result<()> {
    require!(ctx.accounts.loan.status == LoanStatus::Active, LoomError::LoanNotActive);
    let now = Clock::get()?.unix_timestamp;
    // Interest stops accruing at the deadline, so a default is settled at what was owed then.
    ctx.accounts.loan.accrue(now)?;
    let loan = &ctx.accounts.loan;
    let config = &ctx.accounts.config;
    let prices = load_sol_usd_prices(
        &ctx.accounts.price_update,
        &ctx.accounts.chainlink_feed,
        now,
        config.max_price_age_secs,
        config.max_confidence_bps,
    )?;
    // Settle at the higher of Pyth and Chainlink: SOL is only seized when both show the drop.
    let (price, expo) = (prices.highest(), prices.expo());

    let outstanding = loan.owed()?;
    let principal_outstanding = loan.principal_outstanding();
    let defaulted = now > loan.maturity_ts;
    if !defaulted {
        let price_dropped = loan.price_rule_hit(price, expo)?;
        let value = math::lamports_to_stable(loan.collateral_lamports, price, expo, STABLE_DECIMALS)?;
        let under_threshold = !math::covers(value, outstanding, loan.liquidation_threshold_bps as u64)?;
        require!(price_dropped || under_threshold, LoomError::NotLiquidatable);
    }

    // Depositors are repaid in full before the collateral moves.
    if loan.from_pool {
        buy_out_pool_loan(&mut ctx, outstanding, principal_outstanding)?;
    }
    let loan = &ctx.accounts.loan;

    // On default the treasury takes SOL worth what is still owed (rounded up, at the oracle
    // price) and the rest goes back to the borrower. Price/threshold settlements take it all.
    let seize = if defaulted {
        let owed = math::stable_to_lamports(outstanding as u128, price, expo, STABLE_DECIMALS, true)?;
        owed.min(loan.collateral_lamports)
    } else {
        loan.collateral_lamports
    };
    let returned = loan.collateral_lamports - seize;

    ctx.accounts.escrow.sub_lamports(seize)?;
    ctx.accounts.treasury.add_lamports(seize)?;
    // The returned collateral and the escrow's rent go back to the borrower.
    ctx.accounts.escrow.close(ctx.accounts.borrower.to_account_info())?;

    let loan_key = ctx.accounts.loan.key();
    let loan = &mut ctx.accounts.loan;
    loan.status = if defaulted { LoanStatus::Defaulted } else { LoanStatus::Liquidated };
    loan.closed_ts = now;

    let stats = &mut ctx.accounts.config.stats;
    if defaulted {
        stats.loans_defaulted += 1;
    } else {
        stats.loans_liquidated += 1;
    }
    stats.active_loans -= 1;
    stats.outstanding_debt = stats.outstanding_debt.saturating_sub(principal_outstanding);
    stats.collateral_locked_lamports = stats.collateral_locked_lamports.saturating_sub(loan.collateral_lamports);

    emit!(LoanLiquidated {
        loan: loan_key,
        borrower: loan.borrower,
        defaulted,
        outstanding_debt: outstanding,
        seized_lamports: seize,
        returned_lamports: returned,
        price: price as i64,
        price_expo: expo,
    });
    Ok(())
}

/// The treasury pays the pool everything a pool-funded loan still owes, from its approved payouts.
fn buy_out_pool_loan(ctx: &mut Context<Liquidate>, outstanding: u64, principal_outstanding: u64) -> Result<()> {
    let a = &ctx.accounts;
    let (pool, vault, reserve, mint, source, token_program) =
        match (&a.pool, &a.pool_vault, &a.reserve, &a.mint, &a.treasury_token, &a.token_program) {
            (Some(p), Some(v), Some(r), Some(m), Some(t), Some(tp)) => (p, v, r, m, t, tp),
            _ => return err!(LoomError::PoolAccountsRequired),
        };
    require_keys_eq!(vault.key(), pool.vault, LoomError::InvalidPool);
    require_keys_eq!(source.owner, a.config.treasury, LoomError::PoolBackstopUnfunded);
    require_keys_eq!(source.mint, a.loan.mint, LoomError::PoolBackstopUnfunded);
    let approved = match source.delegate {
        COption::Some(delegate) if delegate == reserve.key() => source.delegated_amount,
        _ => 0,
    };
    require!(approved >= outstanding && source.amount >= outstanding, LoomError::PoolBackstopUnfunded);

    let mint_key = a.loan.mint;
    let seeds: &[&[u8]] = &[RESERVE_SEED, mint_key.as_ref(), &[reserve.bump]];
    transfer_checked(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            TransferChecked {
                from: source.to_account_info(),
                mint: mint.to_account_info(),
                to: vault.to_account_info(),
                authority: reserve.to_account_info(),
            },
            &[seeds],
        ),
        outstanding,
        mint.decimals,
    )?;

    let loan_key = a.loan.key();
    let pool = ctx.accounts.pool.as_mut().unwrap();
    pool.cash = pool.cash.checked_add(outstanding).ok_or(LoomError::MathOverflow)?;
    pool.principal_out = pool.principal_out.saturating_sub(principal_outstanding);
    pool.interest_earned = pool.interest_earned.checked_add(outstanding - principal_outstanding).ok_or(LoomError::MathOverflow)?;
    emit!(PoolLoanBoughtOut { loan: loan_key, mint: mint_key, amount: outstanding });
    Ok(())
}
