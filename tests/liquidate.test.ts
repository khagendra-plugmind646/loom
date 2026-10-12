import { expect } from "chai";
import {
  LOAN_TERM_SECS,
  defaultSplit,
  loanDebt,
  settleReason,
  stableToLamports,
  totalDue,
  type LoanAccount,
} from "@loom/sdk";
import { PRICE, USD, createWorld, swapAccount, type World } from "./fixtures";

const T = LOAN_TERM_SECS;

describe("liquidate: when a loan can be settled", () => {
  let w: World;
  beforeEach(async () => {
    w = await createWorld();
  });

  it("a healthy loan before its deadline cannot be settled", async () => {
    const loan = await w.openLoan({ principal: USD(1_000) });
    for (const price of [150, 200, 120]) {
      w.h.setPrice(price);
      w.fails([await w.liquidateIx(loan)], [w.keeper], "NotLiquidatable");
    }
    expect(w.h.loan(loan.address).status).to.equal("active");
  });

  it("the debt threshold: below 130% of the debt it can be settled", async () => {
    const loan = await w.openLoan({ principal: USD(1_000) });
    w.h.setPrice(95); // 63% of the opening price: above the 60% line, below the 130% threshold
    expect(settleReason(loan, PRICE(95), -8, Number(w.h.now()))).to.equal("below-threshold");
    expect((await w.liquidate(loan)).status).to.equal("liquidated");
  });

  it("the 60% price rule triggers at exactly 60% of the opening price", async () => {
    const loan = await w.withThreshold(10_100, () => w.openLoan({ principal: USD(1_000) }));
    w.h.setPrice(90.00000001);
    w.fails([await w.liquidateIx(loan)], [w.keeper], "NotLiquidatable");
    w.h.setPrice(90);
    expect(settleReason(loan, PRICE(90), -8, Number(w.h.now()))).to.equal("price-drop");
    expect((await w.liquidate(loan)).status).to.equal("liquidated");
  });

  it("at the exact deadline it is not yet in default; one second later it is", async () => {
    const loan = await w.openLoan({ principal: USD(500) });
    w.h.warp(T);
    w.h.setPrice(150);
    w.fails([await w.liquidateIx(loan)], [w.keeper], "NotLiquidatable");
    w.h.warp(1);
    w.h.setPrice(150);
    expect(settleReason(loan, PRICE(150), -8, Number(w.h.now()))).to.equal("matured");
    expect((await w.liquidate(loan)).status).to.equal("defaulted");
  });

  it("the SDK's settleReason agrees with the program across a sweep of prices", async () => {
    for (const price of [150, 120, 100, 98, 97, 96.5, 96, 95, 92, 90.5, 90, 80]) {
      const loan = await w.openLoan({ principal: USD(1_000) });
      w.h.setPrice(price);
      const reason = settleReason(loan, PRICE(price), -8, Number(w.h.now()));
      const ix = await w.liquidateIx(loan);
      if (reason === null) {
        w.fails([ix], [w.keeper], "NotLiquidatable");
      } else {
        w.h.send([ix], [w.keeper]);
        expect(w.h.loan(loan.address).status, `price ${price}`).to.equal("liquidated");
      }
    }
  });

  it("is permissionless: the borrower, the admin or any wallet may settle", async () => {
    for (const caller of [w.borrower, w.admin, w.h.wallet(1)]) {
      const loan = await w.openLoan({ principal: USD(100) });
      w.h.setPrice(50);
      expect((await w.liquidate(loan, { caller })).status).to.equal("liquidated");
    }
  });

  it("a settled loan cannot be settled again", async () => {
    const loan = await w.openLoan({ principal: USD(100) });
    w.h.setPrice(50);
    await w.liquidate(loan);
    w.fails([await w.liquidateIx(loan)], [w.keeper], "AccountNotInitialized");
  });

  it("a repaid loan cannot be settled", async () => {
    const loan = await w.openLoan({ principal: USD(100) });
    w.fund(w.usdc, w.borrower.publicKey, USD(10));
    await w.repay(loan, USD(1_000));
    w.h.setPrice(10);
    w.fails([await w.liquidateIx(loan)], [w.keeper], "AccountNotInitialized");
  });

  it("uses the threshold snapshotted at opening, not the current config", async () => {
    const loan = await w.openLoan({ principal: USD(1_000) });
    w.h.send([await w.client.updateConfig(w.admin.publicKey, { liquidationThresholdBps: 19_000 })], [w.admin]);
    w.h.setPrice(120); // under 190% but above 130%
    w.fails([await w.liquidateIx(loan)], [w.keeper], "NotLiquidatable");
  });
});

describe("liquidate: where the SOL goes", () => {
  let w: World;
  beforeEach(async () => {
    w = await createWorld();
  });

  it("price/threshold settlement: all collateral to the treasury, escrow rent to the borrower", async () => {
    const loan = await w.openLoan({ principal: USD(1_000) });
    const usdcKept = w.h.tokenBalance(w.usdc, w.borrower.publicKey);
    w.h.setPrice(95);
    const tBefore = w.h.lamports(w.treasury.publicKey);
    const bBefore = w.h.lamports(w.borrower.publicKey);
    const escrow = w.escrowLamports(loan.address);
    const l = await w.liquidate(loan);

    expect(l.status).to.equal("liquidated");
    expect(l.closedTs).to.equal(w.h.now());
    expect(w.h.lamports(w.treasury.publicKey) - tBefore).to.equal(loan.collateralLamports);
    expect(w.h.lamports(w.borrower.publicKey) - bBefore).to.equal(escrow - loan.collateralLamports);
    expect(w.h.svm.getAccount(w.client.pda.escrow(loan.address))).to.equal(null);
    // the borrower keeps the stablecoin; the debt is cancelled
    expect(w.h.tokenBalance(w.usdc, w.borrower.publicKey)).to.equal(usdcKept);

    const ev = w.event("loanLiquidated");
    expect(ev.loan.equals(loan.address)).to.be.true;
    expect(ev.borrower.equals(w.borrower.publicKey)).to.be.true;
    expect(ev.defaulted).to.be.false;
    expect(ev.seizedLamports.toString()).to.equal(loan.collateralLamports.toString());
    expect(ev.returnedLamports.toString()).to.equal("0");
    expect(ev.outstandingDebt.toString()).to.equal(loanDebt(loan, Number(w.h.now())).owed.toString());
    expect(ev.price.toString()).to.equal(PRICE(95).toString());
    expect(ev.priceExpo).to.equal(-8);
  });

  it("default: SOL worth the debt (rounded up) to the treasury, the rest back to the borrower", async () => {
    const loan = await w.openLoan({ principal: USD(500) });
    w.h.warp(T + 1);
    w.h.setPrice(120);
    const tBefore = w.h.lamports(w.treasury.publicKey);
    const bBefore = w.h.lamports(w.borrower.publicKey);
    const escrow = w.escrowLamports(loan.address);
    expect((await w.liquidate(loan)).status).to.equal("defaulted");

    const split = defaultSplit(loan.collateralLamports, totalDue(USD(500)), PRICE(120), -8);
    expect(split.toTreasury).to.equal(stableToLamports(totalDue(USD(500)), PRICE(120), -8, true));
    expect(w.h.lamports(w.treasury.publicKey) - tBefore).to.equal(split.toTreasury);
    expect(w.h.lamports(w.borrower.publicKey) - bBefore).to.equal(escrow - split.toTreasury);
    const ev = w.event("loanLiquidated");
    expect(ev.defaulted).to.be.true;
    expect(ev.seizedLamports.toString()).to.equal(split.toTreasury.toString());
    expect(ev.returnedLamports.toString()).to.equal(split.toBorrower.toString());
  });

  it("default with SOL worth less than the debt: all of it to the treasury", async () => {
    const loan = await w.openLoan({ principal: USD(500) });
    w.h.warp(T + 1);
    w.h.setPrice(50);
    const tBefore = w.h.lamports(w.treasury.publicKey);
    await w.liquidate(loan);
    expect(w.h.lamports(w.treasury.publicKey) - tBefore).to.equal(loan.collateralLamports);
    expect(w.event("loanLiquidated").returnedLamports.toString()).to.equal("0");
  });

  it("default after partial payments only takes the remaining debt", async () => {
    const loan = await w.openLoan({ principal: USD(500) });
    const paid = await w.repay(loan, USD(200));
    w.h.warp(T + 1);
    w.h.setPrice(150);
    const owed = loanDebt(paid, Number(w.h.now())).owed;
    expect(owed < USD(500)).to.be.true;
    const tBefore = w.h.lamports(w.treasury.publicKey);
    await w.liquidate(paid);
    expect(w.h.lamports(w.treasury.publicKey) - tBefore).to.equal(stableToLamports(owed, PRICE(150), -8, true));
    expect(w.event("loanLiquidated").outstandingDebt.toString()).to.equal(owed.toString());
  });

  it("interest stops at the deadline: a default settled much later owes the same", async () => {
    const a = await w.openLoan({ principal: USD(500) });
    const b = await w.openLoan({ principal: USD(500) });
    w.h.warp(T + 1);
    w.h.setPrice(150);
    await w.liquidate(a);
    const early = BigInt(w.event("loanLiquidated").outstandingDebt.toString());
    w.h.warp(T * 3);
    w.h.setPrice(150);
    await w.liquidate(b);
    expect(BigInt(w.event("loanLiquidated").outstandingDebt.toString())).to.equal(early);
    expect(early).to.equal(totalDue(USD(500)));
  });

  it("updates protocol stats for liquidations and defaults separately", async () => {
    const a = await w.openLoan({ principal: USD(1_000) });
    const b = await w.openLoan({ principal: USD(400) });
    const c = await w.openLoan({ principal: USD(300) });
    w.h.setPrice(95);
    await w.liquidate(a);
    let s = w.h.config().stats;
    expect(s.loansLiquidated).to.equal(1n);
    expect(s.loansDefaulted).to.equal(0n);
    expect(s.activeLoans).to.equal(2n);
    expect(s.outstandingDebt).to.equal(USD(700));
    expect(s.collateralLockedLamports).to.equal(b.collateralLamports + c.collateralLamports);

    w.h.warp(T + 1);
    w.h.setPrice(150);
    await w.liquidate(b);
    s = w.h.config().stats;
    expect(s.loansDefaulted).to.equal(1n);
    expect(s.activeLoans).to.equal(1n);
    expect(s.outstandingDebt).to.equal(USD(300));
    expect(s.collateralLockedLamports).to.equal(c.collateralLamports);
  });
});

describe("liquidate: the 60% line moves with top-ups and principal repayments", () => {
  let w: World;
  let loan: LoanAccount;
  beforeEach(async () => {
    w = await createWorld();
    loan = await w.withThreshold(10_100, () => w.openLoan({ principal: USD(1_000) })); // isolate the price rule
  });

  it("doubling the collateral halves the line ($90 -> $45)", async () => {
    const topped = await w.addCollateral(loan.address, loan.collateralLamports);
    for (const p of [90, 45.01]) {
      w.h.setPrice(p);
      w.fails([await w.liquidateIx(topped)], [w.keeper], "NotLiquidatable");
    }
    w.h.setPrice(45);
    expect(settleReason(topped, PRICE(45), -8, Number(w.h.now()))).to.equal("price-drop");
    const tBefore = w.h.lamports(w.treasury.publicKey);
    expect((await w.liquidate(topped)).status).to.equal("liquidated");
    expect(w.h.lamports(w.treasury.publicKey) - tBefore).to.equal(topped.collateralLamports);
  });

  it("repaying principal lowers the line in proportion", async () => {
    w.fund(w.usdc, w.borrower.publicKey, USD(100));
    const paid = await w.repay(loan, USD(600));
    expect(paid.principalRepaid > USD(500)).to.be.true;
    w.h.setPrice(90); // would seize the untouched loan
    w.fails([await w.liquidateIx(paid)], [w.keeper], "NotLiquidatable");
    // line = 60% of the opening price x principal outstanding / principal (in 1e-8 USD)
    const line = (paid.openPrice * 6_000n * (paid.principal - paid.principalRepaid)) / (10_000n * paid.principal);
    const usd = (p: bigint) => Number(p) / 1e8;
    w.h.setPrice(usd(line + 1n));
    expect(settleReason(paid, line + 1n, -8, Number(w.h.now()))).to.equal(null);
    w.fails([await w.liquidateIx(paid)], [w.keeper], "NotLiquidatable");
    w.h.setPrice(usd(line));
    expect(settleReason(paid, line, -8, Number(w.h.now()))).to.equal("price-drop");
    expect((await w.liquidate(paid)).status).to.equal("liquidated");
  });
});

describe("liquidate: account validation", () => {
  let w: World;
  let loan: LoanAccount;
  beforeEach(async () => {
    w = await createWorld();
    loan = await w.openLoan({ principal: USD(100) });
    w.h.warp(T + 1);
    w.h.setPrice(150);
  });

  it("rejects a forged treasury (who would receive the SOL)", async () => {
    w.fails([await w.liquidateIx(loan, { treasury: w.keeper.publicKey })], [w.keeper], "ConstraintHasOne");
  });

  it("rejects a forged borrower", async () => {
    const ix = await w.client.liquidate({ caller: w.keeper.publicKey, loan: { ...loan, borrower: w.keeper.publicKey }, treasury: w.treasury.publicKey });
    w.fails([ix], [w.keeper], "ConstraintHasOne");
  });

  it("rejects another loan's escrow", async () => {
    const other = await w.openLoan({ principal: USD(100) });
    const ix = swapAccount(await w.liquidateIx(loan), w.client.pda.escrow(loan.address), w.client.pda.escrow(other.address));
    w.fails([ix], [w.keeper], "ConstraintSeeds");
  });
});
