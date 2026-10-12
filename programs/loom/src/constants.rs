use anchor_lang::prelude::*;

// ---------------------------------------------------------------------------
// PDA seeds
// ---------------------------------------------------------------------------
pub const CONFIG_SEED: &[u8] = b"config";
pub const RESERVE_SEED: &[u8] = b"reserve";
pub const VAULT_SEED: &[u8] = b"vault";
pub const LOAN_SEED: &[u8] = b"loan";
pub const ESCROW_SEED: &[u8] = b"escrow";
pub const CREDIT_TREE_SEED: &[u8] = b"credit_tree";
pub const CERTIFICATE_SEED: &[u8] = b"certificate";
pub const POOL_SEED: &[u8] = b"pool";
pub const POOL_VAULT_SEED: &[u8] = b"pool_vault";
pub const LENDER_SEED: &[u8] = b"lender";

// ---------------------------------------------------------------------------
// Immutable loan terms. These are compiled into the program so that nobody —
// including the admin — can change the deal a borrower signed up for.
// ---------------------------------------------------------------------------
pub const BPS: u64 = 10_000;
/// Collateral must be worth at least 2x the principal when the loan is opened.
pub const COLLATERAL_RATIO_BPS: u64 = 20_000;
/// Interest: 12% a year, charged only for the time the loan is open, on the principal still owed.
pub const INTEREST_BPS: u64 = 1_200;
/// Annual rate for borrowers who present one ZK repayment certificate (proof of an earlier on-time repayment).
pub const CREDIT_INTEREST_BPS: u64 = 800;
/// Credit levels: the rate for borrowers presenting 1, 2, or 3+ certificates (each from a different repaid loan).
pub const CREDIT_LEVEL_RATES_BPS: [u64; 3] = [CREDIT_INTEREST_BPS, 700, 600];
/// Most certificates one loan can present.
pub const MAX_CREDIT_CERTIFICATES: usize = 5;
/// Certificates proving repaid loans of at least $X in total unlock the credit rate on loans up to this multiple of $X.
pub const CREDIT_LIMIT_MULTIPLE: u64 = 2;
/// Interest is charged for at least 30 days (or the whole term if shorter), so instant
/// borrow-and-repay loops cannot farm credit certificates for free.
pub const MIN_INTEREST_SECS: i64 = 30 * 24 * 60 * 60;
pub const YEAR_SECS: i64 = 365 * 24 * 60 * 60;
/// Share of the interest on pool-funded loans that goes to Loom's treasury; depositors earn the rest.
pub const PROTOCOL_FEE_BPS: u64 = 1_000;
/// Maximum loan term: 12 months.
pub const LOAN_TERM_SECS: i64 = 365 * 24 * 60 * 60;
/// A loan can be settled once SOL trades at or below 60% of its price when the loan
/// was opened (a 40% drop). The collateral is then still worth ~120% of the principal.
/// Adding SOL or repaying principal moves this line down in proportion (see `Loan::price_rule_hit`).
pub const SEIZE_PRICE_BPS: u64 = 6_000;
/// USDC and USDT on Solana both use 6 decimals; reserves must match.
pub const STABLE_DECIMALS: u8 = 6;

// ---------------------------------------------------------------------------
// Oracle (Pyth pull oracle — PriceUpdateV2 accounts)
// ---------------------------------------------------------------------------
pub const PYTH_RECEIVER_PROGRAM_ID: Pubkey = pubkey!("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");
/// sha256("account:PriceUpdateV2")[..8]
pub const PRICE_UPDATE_V2_DISCRIMINATOR: [u8; 8] = [34, 241, 35, 99, 157, 126, 244, 205];
/// Pyth SOL/USD feed id (same on mainnet and devnet).
pub const SOL_USD_FEED_ID: [u8; 32] = [
    0xef, 0x0d, 0x8b, 0x6f, 0xda, 0x2c, 0xeb, 0xa4, 0x1d, 0xa1, 0x5d, 0x40, 0x95, 0xd1, 0xda, 0x39,
    0x2a, 0x0d, 0x2f, 0x8e, 0xd0, 0xc6, 0xc7, 0xbc, 0x0f, 0x4c, 0xfa, 0xc8, 0xc2, 0x80, 0xb5, 0x6d,
];

// ---------------------------------------------------------------------------
// Oracle (Chainlink Data Feeds — read directly from the feed account, no CPI)
// ---------------------------------------------------------------------------
/// Chainlink Data Feeds store program (same on mainnet and devnet).
pub const CHAINLINK_STORE_PROGRAM_ID: Pubkey = pubkey!("HEvSKofvBgfaexv23kMabbYqxasxU3mQ4ibBMEmJWHny");
/// Chainlink SOL/USD feed account on DEVNET. Replace with the mainnet SOL/USD feed before deploying there.
pub const CHAINLINK_SOL_USD_FEED: Pubkey = pubkey!("99B2bTijsU6f1GCT73HmdR7HCFFjGMBcPZY6jZ96ynrR");
/// sha256("account:Transmissions")[..8]
pub const CHAINLINK_TRANSMISSIONS_DISCRIMINATOR: [u8; 8] = [96, 179, 69, 66, 128, 129, 73, 117];

// ---------------------------------------------------------------------------
// Zero-knowledge credit tree
// ---------------------------------------------------------------------------
pub const CREDIT_TREE_DEPTH: usize = 20;
pub const CREDIT_ROOT_HISTORY: usize = 32;
/// Sentinel stored in `Loan::credit_leaf_index` when no leaf was inserted.
pub const NO_LEAF: u64 = u64::MAX;
/// BN254 scalar field modulus, big-endian.
pub const BN254_FR_MODULUS_BE: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91, 0x43, 0xe1, 0xf5, 0x93, 0xf0, 0x00, 0x00, 0x01,
];
