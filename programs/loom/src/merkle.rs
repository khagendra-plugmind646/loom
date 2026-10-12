//! Poseidon (BN254, circom-compatible) incremental Merkle tree used for
//! zero-knowledge repayment certificates. Hashing goes through the native
//! `sol_poseidon` syscall on-chain.
use anchor_lang::prelude::*;
use solana_poseidon::{hashv, Endianness, Parameters};

use crate::constants::*;
use crate::error::LoomError;
use crate::state::CreditTree;

pub fn poseidon(inputs: &[&[u8]]) -> Result<[u8; 32]> {
    hashv(Parameters::Bn254X5, Endianness::BigEndian, inputs)
        .map(|h| h.to_bytes())
        .map_err(|_| error!(LoomError::PoseidonFailed))
}

pub fn u64_to_field(v: u64) -> [u8; 32] {
    let mut out = [0u8; 32];
    out[24..].copy_from_slice(&v.to_be_bytes());
    out
}

/// True if `bytes` (big-endian) is a canonical BN254 scalar field element.
pub fn is_field_element(bytes: &[u8; 32]) -> bool {
    bytes < &BN254_FR_MODULUS_BE
}

/// leaf = Poseidon(identity, principal, total_repaid, start_ts, closed_ts)
/// Must stay in sync with zk/circuits/repayment_certificate.circom.
pub fn credit_leaf(identity: &[u8; 32], principal: u64, total_repaid: u64, start_ts: i64, closed_ts: i64) -> Result<[u8; 32]> {
    poseidon(&[
        identity,
        &u64_to_field(principal),
        &u64_to_field(total_repaid),
        &u64_to_field(start_ts as u64),
        &u64_to_field(closed_ts as u64),
    ])
}

impl CreditTree {
    pub fn initialize(&mut self, bump: u8) -> Result<()> {
        let mut current = [0u8; 32];
        for i in 0..CREDIT_TREE_DEPTH {
            self.zeros[i] = current;
            self.filled_subtrees[i] = current;
            current = poseidon(&[&current, &current])?;
        }
        self.roots = [[0u8; 32]; CREDIT_ROOT_HISTORY];
        self.roots[0] = current;
        self.current_root_index = 0;
        self.next_index = 0;
        self.bump = bump;
        Ok(())
    }

    /// Appends a leaf; returns its index.
    pub fn insert(&mut self, leaf: [u8; 32]) -> Result<u64> {
        let index = self.next_index;
        require!(index < (1u64 << CREDIT_TREE_DEPTH), LoomError::CreditTreeFull);

        let mut idx = index;
        let mut current = leaf;
        for i in 0..CREDIT_TREE_DEPTH {
            let (left, right) = if idx % 2 == 0 {
                self.filled_subtrees[i] = current;
                (current, self.zeros[i])
            } else {
                (self.filled_subtrees[i], current)
            };
            current = poseidon(&[&left, &right])?;
            idx /= 2;
        }

        self.current_root_index = (self.current_root_index + 1) % CREDIT_ROOT_HISTORY as u32;
        self.roots[self.current_root_index as usize] = current;
        self.next_index = index + 1;
        Ok(index)
    }

    pub fn is_full(&self) -> bool {
        self.next_index >= (1u64 << CREDIT_TREE_DEPTH)
    }

    pub fn current_root(&self) -> [u8; 32] {
        self.roots[self.current_root_index as usize]
    }

    pub fn is_known_root(&self, root: &[u8; 32]) -> bool {
        root != &[0u8; 32] && self.roots.iter().any(|r| r == root)
    }
}
