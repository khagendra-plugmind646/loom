//! Minimal, dependency-free readers for the two SOL/USD oracles Loom uses:
//! Pyth `PriceUpdateV2` accounts and Chainlink Data Feeds (store v1 `Transmissions`) accounts.
//!
//! Loom reads both and stays on the borrower-safe / lender-safe side of them
//! (see `OraclePrices`), so a single faulty oracle cannot seize SOL or under-collateralize a loan.
//!
//! Pyth layout:
//! Layout (Anchor/Borsh):
//!   [0..8)    discriminator
//!   [8..40)   write_authority: Pubkey
//!   [40]      verification_level tag (0 = Partial{num_signatures: u8}, 1 = Full)
//!   ...       price_message: feed_id [u8;32], price i64, conf u64, exponent i32,
//!             publish_time i64, prev_publish_time i64, ema_price i64, ema_conf u64
//!   ...       posted_slot u64
use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::LoomError;

#[derive(Clone, Copy, Debug)]
pub struct SolPrice {
    /// USD per SOL = price * 10^expo
    pub price: u64,
    pub conf: u64,
    pub expo: i32,
    pub publish_time: i64,
}

impl SolPrice {
    /// Lower bound of the confidence interval — used when valuing collateral at origination.
    pub fn conservative(&self) -> u64 {
        self.price.saturating_sub(self.conf)
    }
}

pub fn load_sol_usd_price(
    info: &AccountInfo,
    now: i64,
    max_age_secs: u32,
    max_confidence_bps: u16,
) -> Result<SolPrice> {
    require_keys_eq!(*info.owner, PYTH_RECEIVER_PROGRAM_ID, LoomError::InvalidOracle);
    let data = info.try_borrow_data()?;
    require!(data.len() >= 41, LoomError::InvalidOracle);
    require!(data[..8] == PRICE_UPDATE_V2_DISCRIMINATOR, LoomError::InvalidOracle);

    // Only accept fully verified (all Wormhole guardian signatures checked) updates.
    let mut o = 40;
    match data[o] {
        1 => o += 1,
        0 => return err!(LoomError::OracleNotFullyVerified),
        _ => return err!(LoomError::InvalidOracle),
    }
    require!(data.len() >= o + 32 + 8 + 8 + 4 + 8, LoomError::InvalidOracle);

    require!(data[o..o + 32] == SOL_USD_FEED_ID, LoomError::WrongPriceFeed);
    o += 32;
    let price = i64::from_le_bytes(data[o..o + 8].try_into().unwrap());
    o += 8;
    let conf = u64::from_le_bytes(data[o..o + 8].try_into().unwrap());
    o += 8;
    let expo = i32::from_le_bytes(data[o..o + 4].try_into().unwrap());
    o += 4;
    let publish_time = i64::from_le_bytes(data[o..o + 8].try_into().unwrap());

    require!(price > 0, LoomError::InvalidPrice);
    require!((-18..=0).contains(&expo), LoomError::InvalidPrice);
    let age = now.saturating_sub(publish_time);
    require!(age <= max_age_secs as i64, LoomError::StalePrice);

    let price = price as u64;
    require!(
        (conf as u128) * (BPS as u128) <= (price as u128) * (max_confidence_bps as u128),
        LoomError::PriceTooUncertain
    );

    Ok(SolPrice { price, conf, expo, publish_time })
}

/// Chainlink feed layout (matches `chainlink_solana` 2.0.8's `read_feed_v2`):
///   [0..8)     discriminator
///   [8..200)   header: version u8, state u8, owner/proposed_owner/writer Pubkey, description [u8;32],
///              decimals u8 @138, flagging_threshold u32, latest_round_id u32 @143, granularity u8,
///              live_length u32 @148, live_cursor u32, historical_cursor u32
///   [200..248) live transmission: slot u64, timestamp u32 @208, padding u32, answer i128 @216, padding
const CL_DECIMALS: usize = 138;
const CL_LATEST_ROUND: usize = 143;
const CL_LIVE_LENGTH: usize = 148;
const CL_TIMESTAMP: usize = 208;
const CL_ANSWER: usize = 216;
const CL_MIN_LEN: usize = 248;

/// Chainlink SOL/USD as `(price, expo)`: USD per SOL = price * 10^expo.
pub fn load_chainlink_sol_usd(info: &AccountInfo, now: i64, max_age_secs: u32) -> Result<(u64, i32)> {
    require_keys_eq!(*info.key, CHAINLINK_SOL_USD_FEED, LoomError::InvalidChainlinkFeed);
    require_keys_eq!(*info.owner, CHAINLINK_STORE_PROGRAM_ID, LoomError::InvalidChainlinkFeed);
    let data = info.try_borrow_data()?;
    require!(data.len() >= CL_MIN_LEN, LoomError::InvalidChainlinkFeed);
    require!(data[..8] == CHAINLINK_TRANSMISSIONS_DISCRIMINATOR, LoomError::InvalidChainlinkFeed);
    let u32_at = |o: usize| u32::from_le_bytes(data[o..o + 4].try_into().unwrap());
    require!(u32_at(CL_LIVE_LENGTH) == 1, LoomError::InvalidChainlinkFeed);
    require!(u32_at(CL_LATEST_ROUND) != 0, LoomError::InvalidPrice);

    let decimals = data[CL_DECIMALS];
    require!(decimals <= 18, LoomError::InvalidPrice);
    let answer = i128::from_le_bytes(data[CL_ANSWER..CL_ANSWER + 16].try_into().unwrap());
    require!(answer > 0, LoomError::InvalidPrice);
    let price = u64::try_from(answer).map_err(|_| error!(LoomError::InvalidPrice))?;

    let age = now.saturating_sub(u32_at(CL_TIMESTAMP) as i64);
    require!(age <= max_age_secs as i64, LoomError::StaleChainlinkPrice);
    Ok((price, -(decimals as i32)))
}

/// Pyth and Chainlink SOL/USD, both expressed at Pyth's exponent.
#[derive(Clone, Copy, Debug)]
pub struct OraclePrices {
    pub pyth: SolPrice,
    /// Chainlink price rescaled to `pyth.expo`.
    pub chainlink: u64,
}

impl OraclePrices {
    pub fn expo(&self) -> i32 {
        self.pyth.expo
    }

    /// Values collateral when a loan opens: the lower of Pyth's conservative price and Chainlink.
    pub fn lowest(&self) -> u64 {
        self.pyth.conservative().min(self.chainlink)
    }

    /// Recorded as the loan's opening price (the 60% rule is measured from it): the lower of the two.
    pub fn open_price(&self) -> u64 {
        self.pyth.price.min(self.chainlink)
    }

    /// Used when settling a loan: the higher of the two, so SOL is only seized when both oracles agree
    /// and a default takes no more SOL than the higher price requires.
    pub fn highest(&self) -> u64 {
        self.pyth.price.max(self.chainlink)
    }
}

/// Reads and validates both oracles.
pub fn load_sol_usd_prices(
    pyth_info: &AccountInfo,
    chainlink_info: &AccountInfo,
    now: i64,
    max_age_secs: u32,
    max_confidence_bps: u16,
) -> Result<OraclePrices> {
    let pyth = load_sol_usd_price(pyth_info, now, max_age_secs, max_confidence_bps)?;
    let (cl_price, cl_expo) = load_chainlink_sol_usd(chainlink_info, now, max_age_secs)?;
    let chainlink = rescale(cl_price, cl_expo, pyth.expo)?;
    require!(chainlink > 0, LoomError::InvalidPrice);
    Ok(OraclePrices { pyth, chainlink })
}

/// `price * 10^from` expressed as `x * 10^to` (rounded down).
fn rescale(price: u64, from: i32, to: i32) -> Result<u64> {
    let v = if from >= to {
        let f = 10u128.checked_pow((from - to) as u32).ok_or(LoomError::MathOverflow)?;
        (price as u128).checked_mul(f).ok_or(LoomError::MathOverflow)?
    } else {
        let f = 10u128.checked_pow((to - from) as u32).ok_or(LoomError::MathOverflow)?;
        price as u128 / f
    };
    u64::try_from(v).map_err(|_| error!(LoomError::MathOverflow))
}
