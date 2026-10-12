//! Loom — transparent, SOL-collateralized stablecoin loans on Solana.
//!
//! * Borrowers lock SOL (>= 2x the principal) in a per-loan escrow PDA and, in the
//!   same transaction, receive USDC or USDT from the admin treasury wallet (which
//!   pre-approves a payout limit) into their own or a chosen wallet.
//! * Repay any time within 12 months: principal + flat 12%, in USDC or USDT,
//!   paid straight to the admin treasury. Full repayment releases the SOL.
//! * Loans past 12 months, or below the liquidation threshold, can be settled
//!   by anyone. On default the treasury gets SOL worth the outstanding debt and the
//!   rest returns to the borrower; on a price/threshold settlement it gets all of it.
//! * Fully repaid loans enter a Poseidon Merkle tree; borrowers can mint a
//!   zero-knowledge "repayment certificate" (Groth16, verified on-chain).
use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod math;
pub mod merkle;
pub mod oracle;
pub mod state;
pub mod zk;

use instructions::*;

declare_id!("wrCPKEKsMDgLdpNFJwGK8LSvWVRUnuEsbQVAZAXkoBQ");

#[program]
pub mod loom {
    use super::*;

    // ---------------- admin ----------------
    pub fn initialize(ctx: Context<Initialize>, params: InitializeParams) -> Result<()> {
        process_initialize(ctx, params)
    }

    pub fn update_config(ctx: Context<UpdateConfig>, params: UpdateConfigParams) -> Result<()> {
        process_update_config(ctx, params)
    }

    pub fn init_reserve(ctx: Context<InitReserve>) -> Result<()> {
        process_init_reserve(ctx)
    }

    pub fn fund_reserve(ctx: Context<FundReserve>, amount: u64) -> Result<()> {
        process_fund_reserve(ctx, amount)
    }

    pub fn withdraw_reserve(ctx: Context<WithdrawReserve>, amount: u64) -> Result<()> {
        process_withdraw_reserve(ctx, amount)
    }

    pub fn init_pool(ctx: Context<InitPool>) -> Result<()> {
        process_init_pool(ctx)
    }

    // ---------------- depositors ----------------
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        process_deposit(ctx, amount)
    }

    pub fn withdraw(ctx: Context<Withdraw>, shares: u64) -> Result<()> {
        process_withdraw(ctx, shares)
    }

    // ---------------- borrowers ----------------
    pub fn open_loan(ctx: Context<OpenLoan>, args: OpenLoanArgs) -> Result<()> {
        process_open_loan(ctx, args)
    }

    pub fn repay(ctx: Context<Repay>, amount: u64) -> Result<()> {
        process_repay(ctx, amount)
    }

    pub fn add_collateral(ctx: Context<AddCollateral>, lamports: u64) -> Result<()> {
        process_add_collateral(ctx, lamports)
    }

    // ---------------- permissionless ----------------
    pub fn liquidate(ctx: Context<Liquidate>) -> Result<()> {
        process_liquidate(ctx)
    }

    // ---------------- zero-knowledge ----------------
    pub fn claim_certificate(ctx: Context<ClaimCertificate>, args: ClaimCertificateArgs) -> Result<()> {
        process_claim_certificate(ctx, args)
    }
}
