use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::LoomError;

const LAMPORTS_DECIMALS: i32 = 9;

fn pow10(exp: u32) -> Result<u128> {
    10u128.checked_pow(exp).ok_or_else(|| error!(LoomError::MathOverflow))
}

/// Value of `lamports` in stablecoin base units, at `price * 10^expo` USD per SOL.
pub fn lamports_to_stable(lamports: u64, price: u64, expo: i32, decimals: u8) -> Result<u128> {
    let num = (lamports as u128)
        .checked_mul(price as u128)
        .ok_or(LoomError::MathOverflow)?;
    let e = expo + decimals as i32 - LAMPORTS_DECIMALS;
    if e >= 0 {
        num.checked_mul(pow10(e as u32)?).ok_or_else(|| error!(LoomError::MathOverflow))
    } else {
        Ok(num / pow10((-e) as u32)?)
    }
}

/// Lamports needed to be worth `units` stablecoin base units at `price * 10^expo`.
pub fn stable_to_lamports(units: u128, price: u64, expo: i32, decimals: u8, round_up: bool) -> Result<u64> {
    require!(price > 0, LoomError::InvalidPrice);
    // lamports = units * 10^(9 - decimals - expo) / price
    let e = LAMPORTS_DECIMALS - decimals as i32 - expo;
    let (num, den) = if e >= 0 {
        (units.checked_mul(pow10(e as u32)?).ok_or(LoomError::MathOverflow)?, price as u128)
    } else {
        (units, (price as u128).checked_mul(pow10((-e) as u32)?).ok_or(LoomError::MathOverflow)?)
    };
    let q = if round_up { num.div_ceil(den) } else { num / den };
    u64::try_from(q).map_err(|_| error!(LoomError::MathOverflow))
}

/// True when `price * 10^expo` is at or below `bps`/10_000 of `open_price * 10^open_expo`.
pub fn price_at_or_below(price: u64, expo: i32, open_price: i64, open_expo: i32, bps: u64) -> Result<bool> {
    let open = u128::try_from(open_price).map_err(|_| error!(LoomError::InvalidPrice))?;
    let mut now_side = (price as u128).checked_mul(BPS as u128).ok_or(LoomError::MathOverflow)?;
    let mut open_side = open.checked_mul(bps as u128).ok_or(LoomError::MathOverflow)?;
    // Bring both sides to the smaller exponent.
    if expo > open_expo {
        now_side = now_side.checked_mul(pow10((expo - open_expo) as u32)?).ok_or(LoomError::MathOverflow)?;
    } else {
        open_side = open_side.checked_mul(pow10((open_expo - expo) as u32)?).ok_or(LoomError::MathOverflow)?;
    }
    Ok(now_side <= open_side)
}

/// Simple interest on `principal` at `rate_bps` a year for `secs` seconds, rounded up in favour of the lender.
pub fn interest(principal: u64, rate_bps: u64, secs: i64) -> Result<u64> {
    if secs <= 0 {
        return Ok(0);
    }
    let i = (principal as u128)
        .checked_mul(rate_bps as u128)
        .and_then(|v| v.checked_mul(secs as u128))
        .ok_or(LoomError::MathOverflow)?
        .div_ceil(BPS as u128 * YEAR_SECS as u128);
    u64::try_from(i).map_err(|_| error!(LoomError::MathOverflow))
}

/// Seconds of interest every loan pays at minimum: 30 days, or the whole term if shorter.
pub fn min_interest_secs() -> i64 {
    MIN_INTEREST_SECS.min(LOAN_TERM_SECS)
}

/// The most a loan can cost: principal + interest for the whole term (no early payments).
pub fn total_due(principal: u64, rate_bps: u64) -> Result<u64> {
    principal.checked_add(interest(principal, rate_bps, LOAN_TERM_SECS)?).ok_or_else(|| error!(LoomError::MathOverflow))
}

/// `value * 10_000 >= amount * ratio_bps`
pub fn covers(value: u128, amount: u64, ratio_bps: u64) -> Result<bool> {
    let lhs = value.checked_mul(BPS as u128).ok_or(LoomError::MathOverflow)?;
    let rhs = (amount as u128).checked_mul(ratio_bps as u128).ok_or(LoomError::MathOverflow)?;
    Ok(lhs >= rhs)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn values_collateral() {
        // 2 SOL at $150.00000000 (expo -8) = $300 = 300_000_000 units
        let v = lamports_to_stable(2_000_000_000, 15_000_000_000, -8, 6).unwrap();
        assert_eq!(v, 300_000_000);
        let back = stable_to_lamports(300_000_000, 15_000_000_000, -8, 6, true).unwrap();
        assert_eq!(back, 2_000_000_000);
    }

    #[test]
    fn interest_is_pro_rated_and_rounds_up() {
        assert_eq!(interest(1_000_000_000, 1_200, YEAR_SECS).unwrap(), 120_000_000); // 12% of $1,000 over a year
        assert_eq!(interest(1_000_000_000, 1_200, YEAR_SECS / 12).unwrap(), 10_000_000); // one month = 1%
        assert_eq!(interest(1_000_000_000, 800, YEAR_SECS).unwrap(), 80_000_000); // credit rate
        assert_eq!(interest(1, 1_200, 1).unwrap(), 1); // rounds up
        assert_eq!(interest(1_000, 1_200, 0).unwrap(), 0);
    }

    #[test]
    fn two_x_rule() {
        assert!(covers(200, 100, COLLATERAL_RATIO_BPS).unwrap());
        assert!(!covers(199, 100, COLLATERAL_RATIO_BPS).unwrap());
    }

    #[test]
    fn sixty_percent_price_rule() {
        // opened at $150 (expo -8): the floor is $90
        let open = 150_0000_0000i64;
        assert!(price_at_or_below(90_0000_0000, -8, open, -8, SEIZE_PRICE_BPS).unwrap());
        assert!(!price_at_or_below(90_0000_0001, -8, open, -8, SEIZE_PRICE_BPS).unwrap());
        // different exponents are normalised: $89.99 at expo -2
        assert!(price_at_or_below(8_999, -2, open, -8, SEIZE_PRICE_BPS).unwrap());
        assert!(!price_at_or_below(9_001, -2, open, -8, SEIZE_PRICE_BPS).unwrap());
    }
}
