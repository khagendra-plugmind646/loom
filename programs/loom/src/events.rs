use anchor_lang::prelude::*;

#[event]
pub struct ReserveFunded {
    pub mint: Pubkey,
    pub amount: u64,
    pub vault_balance: u64,
}

#[event]
pub struct ReserveWithdrawn {
    pub mint: Pubkey,
    pub amount: u64,
    pub destination: Pubkey,
    pub vault_balance: u64,
}

#[event]
pub struct LoanOpened {
    pub loan: Pubkey,
    pub id: u64,
    pub borrower: Pubkey,
    pub recipient: Pubkey,
    pub mint: Pubkey,
    pub principal: u64,
    pub total_due: u64,
    pub collateral_lamports: u64,
    pub price: i64,
    pub price_expo: i32,
    pub maturity_ts: i64,
    pub rate_bps: u16,
    pub credit_certificate: Pubkey,
    pub from_pool: bool,
}

#[event]
pub struct CollateralAdded {
    pub loan: Pubkey,
    pub payer: Pubkey,
    pub lamports: u64,
    pub collateral_lamports: u64,
}

#[event]
pub struct PoolDeposited {
    pub mint: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
    pub shares: u64,
}

#[event]
pub struct PoolWithdrawn {
    pub mint: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
    pub shares: u64,
}

#[event]
pub struct PoolLoanBoughtOut {
    pub loan: Pubkey,
    pub mint: Pubkey,
    /// What the treasury paid the pool: everything the loan still owed.
    pub amount: u64,
}

#[event]
pub struct RepaymentMade {
    pub loan: Pubkey,
    pub payer: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub repaid: u64,
    pub remaining: u64,
}

#[event]
pub struct LoanRepaid {
    pub loan: Pubkey,
    pub borrower: Pubkey,
    pub collateral_returned: u64,
    pub credit_leaf_index: u64,
}

#[event]
pub struct CreditLeafInserted {
    pub loan: Pubkey,
    pub leaf: [u8; 32],
    pub index: u64,
    pub root: [u8; 32],
}

#[event]
pub struct LoanLiquidated {
    pub loan: Pubkey,
    pub borrower: Pubkey,
    pub defaulted: bool,
    pub outstanding_debt: u64,
    pub seized_lamports: u64,
    pub returned_lamports: u64,
    pub price: i64,
    pub price_expo: i32,
}

#[event]
pub struct CertificateIssued {
    pub certificate: Pubkey,
    pub holder: Pubkey,
    pub nullifier_hash: [u8; 32],
    pub min_principal: u64,
}
