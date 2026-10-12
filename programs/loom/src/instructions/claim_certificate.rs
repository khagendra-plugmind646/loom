use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::LoomError;
use crate::events::*;
use crate::state::*;
use crate::zk::verify_repayment_certificate;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ClaimCertificateArgs {
    /// Groth16 proof (A negated, B in EIP-197 order, C).
    pub proof_a: [u8; 64],
    pub proof_b: [u8; 128],
    pub proof_c: [u8; 64],
    pub root: [u8; 32],
    pub nullifier_hash: [u8; 32],
    pub min_principal: u64,
}

#[derive(Accounts)]
#[instruction(args: ClaimCertificateArgs)]
pub struct ClaimCertificate<'info> {
    /// Usually a fresh wallet with no on-chain link to the borrower.
    #[account(mut)]
    pub holder: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(seeds = [CREDIT_TREE_SEED], bump = credit_tree.bump)]
    pub credit_tree: Box<Account<'info, CreditTree>>,
    /// Seeded by the nullifier hash: a second claim for the same loan fails here.
    #[account(
        init,
        payer = holder,
        space = 8 + CreditCertificate::INIT_SPACE,
        seeds = [CERTIFICATE_SEED, args.nullifier_hash.as_ref()],
        bump,
    )]
    pub certificate: Box<Account<'info, CreditCertificate>>,
    pub system_program: Program<'info, System>,
}

pub fn process_claim_certificate(ctx: Context<ClaimCertificate>, args: ClaimCertificateArgs) -> Result<()> {
    require!(ctx.accounts.credit_tree.is_known_root(&args.root), LoomError::UnknownRoot);

    let holder = ctx.accounts.holder.key();
    verify_repayment_certificate(
        &args.proof_a,
        &args.proof_b,
        &args.proof_c,
        &args.root,
        &args.nullifier_hash,
        args.min_principal,
        &holder,
    )?;

    let cert = &mut ctx.accounts.certificate;
    cert.holder = holder;
    cert.nullifier_hash = args.nullifier_hash;
    cert.root = args.root;
    cert.min_principal = args.min_principal;
    cert.issued_at = Clock::get()?.unix_timestamp;
    cert.bump = ctx.bumps.certificate;

    ctx.accounts.config.stats.certificates_issued += 1;

    emit!(CertificateIssued {
        certificate: cert.key(),
        holder,
        nullifier_hash: args.nullifier_hash,
        min_principal: args.min_principal,
    });
    Ok(())
}
