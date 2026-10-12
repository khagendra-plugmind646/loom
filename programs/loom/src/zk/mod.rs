//! On-chain Groth16 verification (BN254 via `alt_bn128` syscalls).
use anchor_lang::prelude::*;
use groth16_solana::groth16::Groth16Verifier;

use crate::error::LoomError;
use crate::merkle::u64_to_field;

pub mod verifying_key;
use verifying_key::{NR_PUBLIC_INPUTS, VERIFYING_KEY};

/// Splits a 32-byte pubkey into two 128-bit field elements (hi, lo) so it fits
/// in the BN254 scalar field. Mirrors `recipientHi`/`recipientLo` in the circuit.
pub fn pubkey_to_fields(key: &Pubkey) -> ([u8; 32], [u8; 32]) {
    let bytes = key.to_bytes();
    let mut hi = [0u8; 32];
    let mut lo = [0u8; 32];
    hi[16..].copy_from_slice(&bytes[..16]);
    lo[16..].copy_from_slice(&bytes[16..]);
    (hi, lo)
}

/// Verifies a repayment-certificate proof. `proof_a` must already be negated
/// (the client SDK does this), as required by `groth16-solana`.
pub fn verify_repayment_certificate(
    proof_a: &[u8; 64],
    proof_b: &[u8; 128],
    proof_c: &[u8; 64],
    root: &[u8; 32],
    nullifier_hash: &[u8; 32],
    min_principal: u64,
    recipient: &Pubkey,
) -> Result<()> {
    let (recipient_hi, recipient_lo) = pubkey_to_fields(recipient);
    let public_inputs: [[u8; 32]; NR_PUBLIC_INPUTS] =
        [*root, *nullifier_hash, u64_to_field(min_principal), recipient_hi, recipient_lo];

    let mut verifier = Groth16Verifier::new(proof_a, proof_b, proof_c, &public_inputs, &VERIFYING_KEY)
        .map_err(|_| error!(LoomError::InvalidProof))?;
    verifier.verify().map_err(|_| error!(LoomError::InvalidProof))
}
