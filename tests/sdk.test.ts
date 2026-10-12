import { expect } from "chai";
import {
  INTEREST_BPS,
  collateralRatioBps,
  defaultBreakEvenUsd,
  defaultSplit,
  formatDuration,
  formatRate,
  interestFor,
  lamportsToStable,
  liquidationPriceUsd,
  loanDebt,
  parseUnits,
  positionValue,
  requiredCollateralLamports,
  seizePriceAfterTopUp,
  seizePriceUsd,
  sharesForDeposit,
  stableToLamports,
  totalDue,
} from "@loom/sdk";
import { PRICE, SOL, USD, createWorld } from "./fixtures";

/** Pure SDK helpers the app relies on. They mirror program math, so they are pinned here. */
describe("sdk: math helpers", () => {
  it("interestFor is pro-rated and rounds up (like the program)", () => {
    const year = 365 * 86_400;
    expect(interestFor(USD(1_000), 1_200n, year)).to.equal(USD(120));
    expect(interestFor(USD(1_000), 1_200n, year / 12)).to.equal(USD(10));
    expect(interestFor(1n, 1_200n, 1)).to.equal(1n);
    expect(interestFor(USD(1_000), 1_200n, 0)).to.equal(0n);
    expect(interestFor(USD(1_000), 1_200n, -5)).to.equal(0n);
    expect(totalDue(USD(1_000))).to.equal(USD(1_120));
    expect(totalDue(USD(1_000), 800n)).to.equal(USD(1_080));
  });

  it("lamports <-> stablecoin conversions round as the program does", () => {
    expect(lamportsToStable(SOL(2), PRICE(150), -8)).to.equal(USD(300));
    expect(stableToLamports(USD(300), PRICE(150), -8)).to.equal(SOL(2));
    expect(stableToLamports(1n, PRICE(150), -8, true)).to.equal(7n); // $0.000001 at $150 = 6.67 lamports
    expect(stableToLamports(1n, PRICE(150), -8, false)).to.equal(6n);
  });

  it("requiredCollateralLamports is exactly 200% at price - confidence, plus an optional buffer", () => {
    const exact = requiredCollateralLamports(USD(1_000), PRICE(150), PRICE(1), -8);
    expect(lamportsToStable(exact, PRICE(149), -8) >= USD(2_000)).to.be.true;
    expect(lamportsToStable(exact - 1n, PRICE(149), -8) < USD(2_000)).to.be.true;
    const buffered = requiredCollateralLamports(USD(1_000), PRICE(150), PRICE(1), -8, 100n);
    expect(buffered).to.equal((exact * 10_100n + 9_999n) / 10_000n);
    expect(() => requiredCollateralLamports(USD(1), PRICE(1), PRICE(1), -8)).to.throw(/uncertain/);
  });

  it("defaultSplit caps the treasury's share at the collateral", () => {
    expect(defaultSplit(SOL(10), USD(300), PRICE(150), -8)).to.deep.equal({ toTreasury: SOL(2), toBorrower: SOL(8) });
    expect(defaultSplit(SOL(1), USD(300), PRICE(150), -8)).to.deep.equal({ toTreasury: SOL(1), toBorrower: 0n });
    expect(defaultBreakEvenUsd(SOL(2), USD(300))).to.equal(150);
  });

  it("display helpers for ratios and seizure prices", () => {
    expect(collateralRatioBps(SOL(2), USD(150), PRICE(150), -8)).to.equal(20_000n);
    expect(collateralRatioBps(SOL(2), 0n, PRICE(150), -8)).to.equal(0n);
    expect(liquidationPriceUsd(SOL(2), USD(200), 13_000)).to.equal(130);
    expect(liquidationPriceUsd(0n, USD(200), 13_000)).to.equal(0);
    const loan = {
      collateralLamports: SOL(10),
      openingCollateralLamports: SOL(10),
      principal: USD(500),
      principalRepaid: 0n,
      openPrice: PRICE(150),
      openPriceExpo: -8,
      liquidationThresholdBps: 13_000,
    };
    expect(seizePriceUsd(loan, USD(500))).to.equal(90); // the 60% line beats the threshold ($65)
    expect(seizePriceAfterTopUp(loan, USD(500), SOL(10))).to.equal(45);
  });

  it("pool share math rounds in favour of the pool", () => {
    const pool = { cash: 100n, principalOut: 50n, totalShares: 100n };
    expect(sharesForDeposit(pool, 3n)).to.equal(2n);
    expect(positionValue(pool, 1n)).to.equal(1n);
    expect(sharesForDeposit({ cash: 0n, principalOut: 0n, totalShares: 0n }, 7n)).to.equal(7n);
    expect(positionValue({ cash: 0n, principalOut: 0n, totalShares: 0n }, 7n)).to.equal(0n);
  });

  it("parseUnits / format helpers", () => {
    expect(parseUnits("1250.5", 6)).to.equal(1_250_500_000n);
    expect(parseUnits(".25", 6)).to.equal(250_000n);
    expect(parseUnits("3", 6)).to.equal(3_000_000n);
    for (const bad of ["", ".", "1.2.3", "-1", "abc", "1.0000001"]) expect(() => parseUnits(bad, 6), bad).to.throw();
    expect(formatRate(1_200)).to.equal("12%");
    expect(formatDuration(30 * 86_400)).to.equal("30 days");
    expect(formatDuration(365 * 86_400)).to.equal("1 year");
    expect(formatDuration(60)).to.equal("1 minute");
  });

  it("loans from before time-based interest (rateBps = 0) owe their fixed totalDue", () => {
    const legacy = { principal: USD(100), totalDue: USD(112), repaid: USD(12), maturityTs: 0n, rateBps: 0, principalRepaid: 0n, interestAccrued: 0n, accruedTs: 0n };
    expect(loanDebt(legacy, 0)).to.deep.equal({ principal: USD(100), interest: 0n, owed: USD(100) });
    expect(loanDebt({ ...legacy, repaid: USD(200) }, 0).owed).to.equal(0n);
  });
});

describe("sdk: decoding loan accounts from older program versions", () => {
  const V1 = 235; // before `recipient`
  const V2 = V1 + 32; // before time-based interest, pools, top-ups and credit levels

  it("decodes current, pre-interest and pre-recipient layouts", async () => {
    const w = await createWorld();
    const friend = w.h.wallet(1).publicKey;
    const loan = await w.openLoan({ principal: USD(100), recipient: friend });
    const data = w.h.svm.getAccount(loan.address)!.data;

    const v2 = w.client.decodeLoan(loan.address, data.subarray(0, V2));
    expect(v2.recipient.equals(friend)).to.be.true;
    expect(v2.rateBps).to.equal(0);
    expect(v2.fromPool).to.be.false;
    expect(v2.creditCertificate).to.equal(null);
    expect(v2.principal).to.equal(loan.principal);

    const v1 = w.client.decodeLoan(loan.address, data.subarray(0, V1));
    expect(v1.recipient.equals(loan.borrower)).to.be.true; // old loans paid the borrower
    expect(v1.totalDue).to.equal(loan.totalDue);
    expect(loan.rateBps).to.equal(Number(INTEREST_BPS));
  });
});
