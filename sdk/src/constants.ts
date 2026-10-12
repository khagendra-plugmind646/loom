import { PublicKey } from "@solana/web3.js";
import { IDL } from "./idl";

export const LOOM_PROGRAM_ID = new PublicKey(IDL.address);

// Seeds — keep in sync with programs/loom/src/constants.rs
export const SEEDS = {
  config: "config",
  reserve: "reserve",
  vault: "vault",
  loan: "loan",
  escrow: "escrow",
  creditTree: "credit_tree",
  certificate: "certificate",
  pool: "pool",
  poolVault: "pool_vault",
  lender: "lender",
} as const;

// Immutable loan terms (compiled into the program).
export const BPS = 10_000n;
export const COLLATERAL_RATIO_BPS = 20_000n; // 200%
/** Interest: 12% a year, charged only for the time the loan is open, on the principal still owed. */
export const INTEREST_BPS = 1_200n;
/** Annual rate for holders of one ZK repayment certificate. */
export const CREDIT_INTEREST_BPS = 800n;
/** Credit levels: the rate for borrowers presenting 1, 2, or 3+ certificates (each from a different repaid loan). */
export const CREDIT_LEVEL_RATES_BPS = [CREDIT_INTEREST_BPS, 700n, 600n] as const;
/** Most certificates one loan can present. */
export const MAX_CREDIT_CERTIFICATES = 5;
/** Certificates proving repaid loans of at least $X in total unlock the credit rate on loans up to this multiple of $X. */
export const CREDIT_LIMIT_MULTIPLE = 2n;
/** Interest is charged for at least 30 days (or the whole term if shorter). */
export const MIN_INTEREST_SECS = 30 * 24 * 60 * 60;
export const YEAR_SECS = 365 * 24 * 60 * 60;
/** Share of the interest on pool-funded loans that goes to Loomzk's treasury; depositors earn the rest. */
export const PROTOCOL_FEE_BPS = 1_000n;
export const LOAN_TERM_SECS = 365 * 24 * 60 * 60;
/** A loan can be settled once SOL trades at or below 60% of its price when the loan opened. */
export const SEIZE_PRICE_BPS = 6_000n;
export const STABLE_DECIMALS = 6;
export const LAMPORTS_DECIMALS = 9;

// Pyth pull oracle
export const PYTH_RECEIVER_PROGRAM_ID = new PublicKey("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");
export const SOL_USD_FEED_ID_HEX = "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
/** Pyth sponsored SOL/USD PriceUpdateV2 account (shard 0) — same address on mainnet and devnet. */
export const SOL_USD_PRICE_ACCOUNT = new PublicKey("7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE");
export const PRICE_UPDATE_V2_DISCRIMINATOR = Uint8Array.from([34, 241, 35, 99, 157, 126, 244, 205]);

// Chainlink Data Feeds (read directly from the feed account)
export const CHAINLINK_STORE_PROGRAM_ID = new PublicKey("HEvSKofvBgfaexv23kMabbYqxasxU3mQ4ibBMEmJWHny");
/** Chainlink SOL/USD feed on DEVNET. Must match the program's CHAINLINK_SOL_USD_FEED. */
export const CHAINLINK_SOL_USD_FEED = new PublicKey("99B2bTijsU6f1GCT73HmdR7HCFFjGMBcPZY6jZ96ynrR");
export const CHAINLINK_TRANSMISSIONS_DISCRIMINATOR = Uint8Array.from([96, 179, 69, 66, 128, 129, 73, 117]);

export const MAINNET_STABLECOINS = {
  USDC: new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
  USDT: new PublicKey("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"),
} as const;

// ZK
export const CREDIT_TREE_DEPTH = 20;
export const NO_LEAF = 18446744073709551615n; // u64::MAX
