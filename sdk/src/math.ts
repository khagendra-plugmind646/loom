import {
  BPS,
  COLLATERAL_RATIO_BPS,
  CREDIT_LEVEL_RATES_BPS,
  CREDIT_LIMIT_MULTIPLE,
  MAX_CREDIT_CERTIFICATES,
  INTEREST_BPS,
  LAMPORTS_DECIMALS,
  LOAN_TERM_SECS,
  MIN_INTEREST_SECS,
  PROTOCOL_FEE_BPS,
  SEIZE_PRICE_BPS,
  STABLE_DECIMALS,
  YEAR_SECS,
} from "./constants";

const pow10 = (e: number) => 10n ** BigInt(e);
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

/** Simple interest on `principal` at `rateBps` a year for `secs` seconds, rounded up (matches the program). */
export function interestFor(principal: bigint, rateBps: bigint, secs: number): bigint {
  if (secs <= 0) return 0n;
  return ceilDiv(principal * rateBps * BigInt(Math.floor(secs)), BPS * BigInt(YEAR_SECS));
}

/** Seconds of interest every loan pays at minimum: 30 days, or the whole term if shorter. */
export const minInterestSecs = () => Math.min(MIN_INTEREST_SECS, LOAN_TERM_SECS);

/** The most a loan can cost: principal + interest for the whole term (matches the program's `total_due`). */
export function totalDue(principal: bigint, rateBps: bigint = INTEREST_BPS): bigint {
  return principal + interestFor(principal, rateBps, LOAN_TERM_SECS);
}

/** Loan fields the amount owed depends on. */
export interface LoanDebtFields {
  principal: bigint;
  totalDue: bigint;
  repaid: bigint;
  maturityTs: bigint;
  rateBps: number;
  principalRepaid: bigint;
  interestAccrued: bigint;
  accruedTs: bigint;
}

/**
 * What a loan owes at `nowSecs`, exactly as the program would compute it in a transaction at that time:
 * interest accrues on the principal still owed until the deadline, with a minimum of `minInterestSecs()`.
 * Loans opened before time-based interest (rateBps = 0) owe their fixed `totalDue`.
 */
export function loanDebt(loan: LoanDebtFields, nowSecs: number): { principal: bigint; interest: bigint; owed: bigint } {
  if (loan.rateBps === 0) {
    const owed = loan.totalDue > loan.repaid ? loan.totalDue - loan.repaid : 0n;
    return { principal: owed, interest: 0n, owed };
  }
  const rate = BigInt(loan.rateBps);
  const principal = loan.principal - loan.principalRepaid;
  const until = Math.min(nowSecs, Number(loan.maturityTs));
  const accrued = loan.interestAccrued + interestFor(principal, rate, until - Number(loan.accruedTs));
  const minimum = interestFor(loan.principal, rate, minInterestSecs());
  const paid = loan.repaid - loan.principalRepaid;
  const total = accrued > minimum ? accrued : minimum;
  const interest = total > paid ? total - paid : 0n;
  return { principal, interest, owed: principal + interest };
}

/** Stablecoin base units that `lamports` are worth at `price * 10^expo` USD/SOL. */
export function lamportsToStable(lamports: bigint, price: bigint, expo: number): bigint {
  const e = expo + STABLE_DECIMALS - LAMPORTS_DECIMALS;
  const num = lamports * price;
  return e >= 0 ? num * pow10(e) : num / pow10(-e);
}

/** Lamports worth `units` stablecoin base units. */
export function stableToLamports(units: bigint, price: bigint, expo: number, roundUp = true): bigint {
  const e = LAMPORTS_DECIMALS - STABLE_DECIMALS - expo;
  const [num, den] = e >= 0 ? [units * pow10(e), price] : [units, price * pow10(-e)];
  return roundUp ? ceilDiv(num, den) : num / den;
}

/**
 * Minimum SOL collateral for `principal`, valued at the conservative oracle price
 * (price - conf) exactly like the program. `bufferBps` adds headroom for price
 * movement between quoting and signing (e.g. 100 = +1%).
 */
export function requiredCollateralLamports(
  principal: bigint,
  price: bigint,
  conf: bigint,
  expo: number,
  bufferBps = 0n,
): bigint {
  const conservative = price - conf;
  if (conservative <= 0n) throw new Error("oracle price too uncertain");
  const needed = ceilDiv(principal * COLLATERAL_RATIO_BPS, BPS);
  const lamports = stableToLamports(needed, conservative, expo, true);
  return ceilDiv(lamports * (BPS + bufferBps), BPS);
}

/** Current collateral ratio in bps (collateral value / outstanding debt). */
export function collateralRatioBps(collateralLamports: bigint, outstanding: bigint, price: bigint, expo: number): bigint {
  if (outstanding === 0n) return 0n;
  return (lamportsToStable(collateralLamports, price, expo) * BPS) / outstanding;
}

/** SOL/USD price at which a loan becomes liquidatable (in USD, as a float for display). */
export function liquidationPriceUsd(collateralLamports: bigint, outstanding: bigint, thresholdBps: number): number {
  if (collateralLamports === 0n) return 0;
  const usd = (Number(outstanding) / 10 ** STABLE_DECIMALS) * (thresholdBps / 10_000);
  return usd / (Number(collateralLamports) / 10 ** LAMPORTS_DECIMALS);
}

export const formatStable = (units: bigint, digits = 2) =>
  (Number(units) / 10 ** STABLE_DECIMALS).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

export const formatSol = (lamports: bigint, digits = 4) =>
  (Number(lamports) / 10 ** LAMPORTS_DECIMALS).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });

/** "30 days", "5 minutes", "1 year": for loan terms and interest periods. */
export function formatDuration(secs: number): string {
  const units: [number, string][] = [[365 * 86_400, "year"], [86_400, "day"], [3_600, "hour"], [60, "minute"], [1, "second"]];
  const [size, name] = units.find(([u]) => secs >= u && secs % u === 0) ?? units.find(([u]) => secs >= u) ?? [1, "second"];
  const n = Math.round((secs / size) * 10) / 10;
  return `${n} ${name}${n === 1 ? "" : "s"}`;
}

/** Annual rate in bps as "12%". */
export const formatRate = (bps: number | bigint) => `${Number(bps) / 100}%`;

/** Parses a decimal string ("1250.5") into base units. */
export function parseUnits(value: string, decimals: number): bigint {
  const v = value.trim();
  if (!/^\d*(\.\d*)?$/.test(v) || v === "" || v === ".") throw new Error("invalid amount");
  const [whole, frac = ""] = v.split(".");
  if (frac.length > decimals) throw new Error(`max ${decimals} decimals`);
  return BigInt(whole || "0") * pow10(decimals) + BigInt((frac + "0".repeat(decimals)).slice(0, decimals) || "0");
}

/** Loan fields the settlement rules depend on. */
export interface LoanRiskFields extends LoanDebtFields {
  collateralLamports: bigint;
  /** SOL locked at opening (0 on loans opened before top-ups existed: treated as unchanged). */
  openingCollateralLamports: bigint;
  openPrice: bigint;
  openPriceExpo: number;
  liquidationThresholdBps: number;
}

type SeizeFields = Pick<
  LoanRiskFields,
  "collateralLamports" | "openingCollateralLamports" | "principal" | "principalRepaid" | "openPrice" | "openPriceExpo" | "liquidationThresholdBps"
>;

/**
 * The 60% line as [price, expo], exactly like the program's `Loan::price_rule_hit`: 60% of the opening price
 * for an unchanged loan, lowered in proportion when SOL is added or principal is repaid.
 */
function seizeLine(loan: SeizeFields): { price: bigint; expo: number; bps: bigint } {
  const opening = loan.openingCollateralLamports === 0n ? loan.collateralLamports : loan.openingCollateralLamports;
  if (loan.collateralLamports === opening && loan.principalRepaid === 0n) {
    return { price: loan.openPrice, expo: loan.openPriceExpo, bps: SEIZE_PRICE_BPS };
  }
  const line = (((loan.openPrice * SEIZE_PRICE_BPS * opening) / loan.collateralLamports) * (loan.principal - loan.principalRepaid)) / (BPS * loan.principal);
  return { price: line, expo: loan.openPriceExpo, bps: BPS };
}

/**
 * SOL/USD price (as a float, for display) at or below which the loan can be settled before its deadline
 * and all of its SOL goes to the treasury: the higher of the 60% line and the debt threshold.
 */
export function seizePriceUsd(loan: SeizeFields, owed: bigint): number {
  const line = seizeLine(loan);
  const priceRule = (Number(line.price) * 10 ** line.expo * Number(line.bps)) / 10_000;
  return Math.max(priceRule, liquidationPriceUsd(loan.collateralLamports, owed, loan.liquidationThresholdBps));
}

/** The seizure price if `addLamports` more SOL were added to the loan now (for the "Add SOL" preview). */
export function seizePriceAfterTopUp(loan: SeizeFields, owed: bigint, addLamports: bigint): number {
  const opening = loan.openingCollateralLamports === 0n ? loan.collateralLamports : loan.openingCollateralLamports;
  return seizePriceUsd({ ...loan, openingCollateralLamports: opening, collateralLamports: loan.collateralLamports + addLamports }, owed);
}

/**
 * Where the collateral goes if the loan is settled after its deadline (default), at `price * 10^expo`
 * USD/SOL. Mirrors the program: the treasury gets SOL worth the outstanding debt (rounded up), capped at
 * the collateral, and the rest goes back to the borrower.
 */
export function defaultSplit(
  collateralLamports: bigint,
  outstanding: bigint,
  price: bigint,
  expo: number,
): { toTreasury: bigint; toBorrower: bigint } {
  const owed = stableToLamports(outstanding, price, expo, true);
  const toTreasury = owed < collateralLamports ? owed : collateralLamports;
  return { toTreasury, toBorrower: collateralLamports - toTreasury };
}

/** SOL/USD price (as a float, for display) below which defaulted collateral no longer covers the debt, so none is returned. */
export function defaultBreakEvenUsd(collateralLamports: bigint, outstanding: bigint): number {
  return liquidationPriceUsd(collateralLamports, outstanding, 10_000);
}

/** Annual rate for a borrower presenting `count` credit certificates (count 0 = standard rate). */
export const creditRateBps = (count: number): bigint | null =>
  count === 0 ? null : CREDIT_LEVEL_RATES_BPS[Math.min(count, CREDIT_LEVEL_RATES_BPS.length) - 1];

/** The certificates a loan would present: up to MAX_CREDIT_CERTIFICATES, largest proven amounts first. */
export const creditCertificatesToUse = <T extends { minPrincipal: bigint }>(certificates: T[]): T[] =>
  [...certificates].sort((a, b) => (a.minPrincipal > b.minPrincipal ? -1 : 1)).slice(0, MAX_CREDIT_CERTIFICATES);

/** Largest loan these certificates cover at the credit rate: CREDIT_LIMIT_MULTIPLE x their combined proven amounts. */
export const creditLimit = (certificates: { minPrincipal: bigint }[]) =>
  creditCertificatesToUse(certificates).reduce((s, c) => s + c.minPrincipal, 0n) * CREDIT_LIMIT_MULTIPLE;

/** The certificates and rate for a loan of `principal`, or null when it is above the credit limit (standard rate). */
export function creditTerms<T extends { minPrincipal: bigint }>(certificates: T[], principal: bigint): { certificates: T[]; rateBps: bigint } | null {
  const use = creditCertificatesToUse(certificates);
  if (!use.length || principal > creditLimit(use)) return null;
  return { certificates: use, rateBps: creditRateBps(use.length)! };
}

/** What a pool is worth in total, and per position: cash plus principal lent out, split by shares (rounded down, like the program). */
export const poolValue = (pool: { cash: bigint; principalOut: bigint }) => pool.cash + pool.principalOut;

export function positionValue(pool: { cash: bigint; principalOut: bigint; totalShares: bigint }, shares: bigint): bigint {
  return pool.totalShares === 0n ? 0n : (shares * poolValue(pool)) / pool.totalShares;
}

/** Shares a deposit of `amount` would mint (rounded down, like the program). */
export function sharesForDeposit(pool: { cash: bigint; principalOut: bigint; totalShares: bigint }, amount: bigint): bigint {
  const value = poolValue(pool);
  return pool.totalShares === 0n || value === 0n ? amount : (amount * pool.totalShares) / value;
}

/**
 * Depositors' current yearly return on a pool, in bps: the interest its active loans are paying,
 * minus the protocol fee, spread over everything in the pool (lent out or not).
 */
export function poolApyBps(pool: { cash: bigint; principalOut: bigint }, activePoolLoans: LoanDebtFields[]): number {
  const value = poolValue(pool);
  if (value === 0n) return 0;
  const yearly = activePoolLoans.reduce((s, l) => s + (l.principal - l.principalRepaid) * BigInt(l.rateBps), 0n);
  return Number((yearly * (BPS - PROTOCOL_FEE_BPS)) / BPS / value);
}

export type SettleReason = "matured" | "price-drop" | "below-threshold";

/** Why the program would accept `liquidate` for this active loan right now, or null if it wouldn't. Mirrors the program. */
export function settleReason(loan: LoanRiskFields, price: bigint, expo: number, nowSecs: number): SettleReason | null {
  if (nowSecs > Number(loan.maturityTs)) return "matured";
  // price * 10^expo <= the 60% line, compared at a common exponent
  const line = seizeLine(loan);
  let now = price * BPS;
  let open = line.price * line.bps;
  if (expo > line.expo) now *= pow10(expo - line.expo);
  else open *= pow10(line.expo - expo);
  if (now <= open) return "price-drop";
  const outstanding = loanDebt(loan, nowSecs).owed;
  if (lamportsToStable(loan.collateralLamports, price, expo) * BPS < outstanding * BigInt(loan.liquidationThresholdBps)) return "below-threshold";
  return null;
}
