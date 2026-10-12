use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::LoomError;
use crate::math;

/// Global protocol configuration and public, on-chain accounting.
#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    /// Admin wallet that pays out loans (from its USDC/USDT token accounts, up to the
    /// amount it approved to each reserve PDA), receives repayments and seized SOL.
    pub treasury: Pubkey,
    /// A loan becomes liquidatable when collateral value < outstanding debt * this.
    pub liquidation_threshold_bps: u16,
    /// Extra collateral (on top of the outstanding debt) seized on liquidation/default.
    pub liquidation_penalty_bps: u16,
    pub max_price_age_secs: u32,
    pub max_confidence_bps: u16,
    pub min_principal: u64,
    pub max_principal: u64,
    pub paused: bool,
    pub next_loan_id: u64,
    pub stats: ProtocolStats,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace, Debug)]
pub struct ProtocolStats {
    pub loans_opened: u64,
    pub loans_repaid: u64,
    pub loans_liquidated: u64,
    pub loans_defaulted: u64,
    pub active_loans: u64,
    /// SOL currently locked in loan escrows (excludes escrow rent).
    pub collateral_locked_lamports: u64,
    pub total_principal_issued: u64,
    pub total_repaid: u64,
    /// Principal still owed on active loans (interest accrues on top, per loan).
    pub outstanding_debt: u64,
    pub certificates_issued: u64,
}

/// A stablecoin reserve (one per mint: USDC, USDT). Its PDA is the delegate the treasury
/// approves to pay out loans; the legacy vault can still be funded and withdrawn.
#[account]
#[derive(InitSpace)]
pub struct Reserve {
    pub mint: Pubkey,
    /// PDA token account (seeds: ["vault", mint]) owned by this reserve.
    pub vault: Pubkey,
    pub decimals: u8,
    pub total_funded: u64,
    pub total_withdrawn: u64,
    pub total_disbursed: u64,
    /// Repayments made in this stablecoin (to the treasury, or to the lending pool for pool-funded loans).
    pub total_repaid: u64,
    pub bump: u8,
    pub vault_bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum LoanStatus {
    Active,
    Repaid,
    Liquidated,
    Defaulted,
}

#[account]
#[derive(InitSpace)]
pub struct Loan {
    pub id: u64,
    pub borrower: Pubkey,
    pub nonce: u64,
    /// Stablecoin the principal was disbursed in.
    pub mint: Pubkey,
    pub principal: u64,
    /// The most this loan can cost: principal + interest for the whole term. Fixed at open.
    pub total_due: u64,
    /// Everything paid so far (interest + principal).
    pub repaid: u64,
    pub collateral_lamports: u64,
    /// Pyth SOL/USD price used at origination (audit trail).
    pub open_price: i64,
    pub open_price_expo: i32,
    pub start_ts: i64,
    pub maturity_ts: i64,
    pub closed_ts: i64,
    /// Risk parameters snapshotted at open so the admin cannot change them later.
    pub liquidation_threshold_bps: u16,
    pub liquidation_penalty_bps: u16,
    pub status: LoanStatus,
    /// Poseidon(secret, nullifier) chosen by the borrower; zero = opted out of ZK credit.
    pub identity_commitment: [u8; 32],
    pub credit_leaf: [u8; 32],
    pub credit_leaf_index: u64,
    pub bump: u8,
    pub escrow_bump: u8,
    /// Wallet that received the stablecoin (the borrower unless they chose another).
    pub recipient: Pubkey,
    /// Annual interest rate: INTEREST_BPS, or CREDIT_INTEREST_BPS with a credit certificate.
    pub rate_bps: u16,
    /// Principal repaid so far (each payment covers interest first).
    pub principal_repaid: u64,
    /// Interest accrued from opening until `accrued_ts` (paid and unpaid).
    pub interest_accrued: u64,
    pub accrued_ts: i64,
    /// Credit certificate that unlocked the credit rate, or the default key.
    pub credit_certificate: Pubkey,
    /// Funded by the lending pool (repayments go back to it) rather than the treasury.
    pub from_pool: bool,
    /// SOL locked when the loan opened; `collateral_lamports` grows when the borrower adds SOL.
    pub opening_collateral_lamports: u64,
    /// Number of credit certificates presented at opening (0 = standard rate).
    pub credit_level: u8,
}

/// A lending pool for one stablecoin. Depositors supply liquidity and own shares of it; new loans are
/// funded from it first and depositors earn their interest, minus PROTOCOL_FEE_BPS. When a pool-funded
/// loan is settled, the treasury buys it out at what is owed, so depositors are repaid in full and the
/// treasury takes the SOL (and its price risk).
#[account]
#[derive(InitSpace)]
pub struct Pool {
    pub mint: Pubkey,
    /// PDA token account (seeds: ["pool_vault", mint]) owned by this pool.
    pub vault: Pubkey,
    /// Stablecoin the pool holds, tracked internally: tokens sent straight to the vault don't change share value.
    pub cash: u64,
    /// Principal lent out and not yet repaid.
    pub principal_out: u64,
    pub total_shares: u64,
    pub total_deposited: u64,
    pub total_withdrawn: u64,
    /// Interest earned by depositors (after the protocol fee).
    pub interest_earned: u64,
    pub bump: u8,
    pub vault_bump: u8,
}

impl Pool {
    /// What all shares are worth: cash plus principal lent out.
    pub fn value(&self) -> u64 {
        self.cash + self.principal_out
    }

    /// Shares minted for a deposit of `amount` (rounded down, in favour of existing depositors).
    pub fn shares_for(&self, amount: u64) -> Result<u64> {
        if self.total_shares == 0 || self.value() == 0 {
            return Ok(amount);
        }
        let s = (amount as u128) * (self.total_shares as u128) / (self.value() as u128);
        u64::try_from(s).map_err(|_| error!(LoomError::MathOverflow))
    }

    /// Stablecoin paid out for `shares` (rounded down, in favour of remaining depositors).
    pub fn amount_for(&self, shares: u64) -> Result<u64> {
        if self.total_shares == 0 {
            return Ok(0);
        }
        let a = (shares as u128) * (self.value() as u128) / (self.total_shares as u128);
        u64::try_from(a).map_err(|_| error!(LoomError::MathOverflow))
    }
}

/// One depositor's share of a pool.
#[account]
#[derive(InitSpace)]
pub struct LenderPosition {
    pub owner: Pubkey,
    pub mint: Pubkey,
    pub shares: u64,
    /// Lifetime deposits and withdrawals, so earnings = value + withdrawn - deposited.
    pub deposited: u64,
    pub withdrawn: u64,
    pub bump: u8,
}

impl Loan {
    pub fn principal_outstanding(&self) -> u64 {
        self.principal - self.principal_repaid
    }

    /// The 60% rule. For a loan whose collateral and principal are unchanged since opening, SOL is seized
    /// once it trades at or below 60% of the opening price. Adding SOL or repaying principal lowers that
    /// line in proportion, so the rule is "the collateral is worth 60% of what it was per dollar owed".
    pub fn price_rule_hit(&self, price: u64, expo: i32) -> Result<bool> {
        let opening = if self.opening_collateral_lamports == 0 { self.collateral_lamports } else { self.opening_collateral_lamports };
        if self.collateral_lamports == opening && self.principal_repaid == 0 {
            return math::price_at_or_below(price, expo, self.open_price, self.open_price_expo, SEIZE_PRICE_BPS);
        }
        // line = open_price × 60% × opening/current collateral × principal outstanding/principal, rounded down
        let open = u128::try_from(self.open_price).map_err(|_| error!(LoomError::InvalidPrice))?;
        let line = open
            .checked_mul(SEIZE_PRICE_BPS as u128)
            .and_then(|v| v.checked_mul(opening as u128))
            .ok_or(LoomError::MathOverflow)?
            / self.collateral_lamports as u128;
        let line = line.checked_mul(self.principal_outstanding() as u128).ok_or(LoomError::MathOverflow)?
            / (BPS as u128 * self.principal as u128);
        let line = i64::try_from(line).map_err(|_| error!(LoomError::MathOverflow))?;
        math::price_at_or_below(price, expo, line, self.open_price_expo, BPS)
    }

    /// Accrues interest on the principal still owed up to `now`, never past the deadline.
    pub fn accrue(&mut self, now: i64) -> Result<()> {
        let until = now.min(self.maturity_ts);
        if until > self.accrued_ts {
            let i = math::interest(self.principal_outstanding(), self.rate_bps as u64, until - self.accrued_ts)?;
            self.interest_accrued = self.interest_accrued.checked_add(i).ok_or(LoomError::MathOverflow)?;
            self.accrued_ts = until;
        }
        Ok(())
    }

    /// Interest owed as of the last accrual: what has accrued (at least the minimum) minus what was paid.
    pub fn interest_due(&self) -> Result<u64> {
        let minimum = math::interest(self.principal, self.rate_bps as u64, math::min_interest_secs())?;
        let interest_paid = self.repaid - self.principal_repaid;
        Ok(self.interest_accrued.max(minimum).saturating_sub(interest_paid))
    }

    /// Everything owed as of the last accrual. Zero means fully repaid.
    pub fn owed(&self) -> Result<u64> {
        self.principal_outstanding().checked_add(self.interest_due()?).ok_or_else(|| error!(LoomError::MathOverflow))
    }
}

/// Holds the SOL collateral of exactly one loan. Only the program can move these
/// lamports, and only according to `repay` (back to borrower) or `liquidate`.
#[account]
#[derive(InitSpace)]
pub struct CollateralEscrow {
    pub loan: Pubkey,
    pub bump: u8,
}

/// Append-only Poseidon Merkle tree of fully-repaid loans ("credit leaves").
#[account]
#[derive(InitSpace)]
pub struct CreditTree {
    pub next_index: u64,
    pub current_root_index: u32,
    pub roots: [[u8; 32]; CREDIT_ROOT_HISTORY],
    pub filled_subtrees: [[u8; 32]; CREDIT_TREE_DEPTH],
    pub zeros: [[u8; 32]; CREDIT_TREE_DEPTH],
    pub bump: u8,
}

/// A zero-knowledge repayment certificate. Its address is derived from the
/// nullifier hash, so each repaid loan can mint at most one certificate.
#[account]
#[derive(InitSpace)]
pub struct CreditCertificate {
    pub holder: Pubkey,
    pub nullifier_hash: [u8; 32],
    pub root: [u8; 32],
    /// Publicly proven lower bound on the repaid loan's principal.
    pub min_principal: u64,
    pub issued_at: i64,
    pub bump: u8,
}
