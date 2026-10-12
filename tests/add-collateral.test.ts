import { expect } from "chai";
import { LOAN_TERM_SECS, type LoanAccount } from "@loom/sdk";
import { SOL, TX_FEE, USD, createWorld, swapAccount, type World } from "./fixtures";

describe("add_collateral", () => {
  let w: World;
  let loan: LoanAccount;
  beforeEach(async () => {
    w = await createWorld();
    loan = await w.openLoan({ principal: USD(1_000) });
  });

  it("moves SOL into the loan's escrow and records it", async () => {
    const escrow = w.escrowLamports(loan.address);
    const payer = w.h.lamports(w.borrower.publicKey);
    const l = await w.addCollateral(loan.address, SOL(2));
    expect(l.collateralLamports).to.equal(loan.collateralLamports + SOL(2));
    expect(l.openingCollateralLamports).to.equal(loan.collateralLamports); // the opening amount is kept
    expect(w.escrowLamports(loan.address) - escrow).to.equal(SOL(2));
    expect(payer - w.h.lamports(w.borrower.publicKey)).to.equal(SOL(2) + TX_FEE);
    expect(w.h.config().stats.collateralLockedLamports).to.equal(l.collateralLamports);

    const ev = w.event("collateralAdded");
    expect(ev.loan.equals(loan.address)).to.be.true;
    expect(ev.payer.equals(w.borrower.publicKey)).to.be.true;
    expect(ev.lamports.toString()).to.equal(SOL(2).toString());
    expect(ev.collateralLamports.toString()).to.equal(l.collateralLamports.toString());
  });

  it("top-ups accumulate and leave everything else about the loan unchanged", async () => {
    await w.addCollateral(loan.address, SOL(1));
    const l = await w.addCollateral(loan.address, SOL(0.5));
    expect(l.collateralLamports).to.equal(loan.collateralLamports + SOL(1.5));
    expect({ ...l, collateralLamports: 0n }).to.deep.equal({ ...loan, collateralLamports: 0n });
  });

  it("anyone can top up; the SOL is returned to the borrower on repayment", async () => {
    const friend = w.h.wallet(10);
    await w.addCollateral(loan.address, SOL(3), friend);
    const escrow = w.escrowLamports(loan.address);
    const borrowerSol = w.h.lamports(w.borrower.publicKey);
    w.fund(w.usdc, w.borrower.publicKey, USD(100));
    await w.repay(loan, USD(2_000));
    expect(w.h.lamports(w.borrower.publicKey) - borrowerSol).to.equal(escrow - TX_FEE);
  });

  it("rejects zero lamports", async () => {
    w.fails([await w.client.addCollateral(w.borrower.publicKey, loan.address, 0n)], [w.borrower], "ZeroAmount");
  });

  it("is allowed at the deadline and refused after it", async () => {
    w.h.warp(LOAN_TERM_SECS);
    await w.addCollateral(loan.address, 1n);
    w.h.warp(1);
    w.fails([await w.client.addCollateral(w.borrower.publicKey, loan.address, 1n)], [w.borrower], "LoanMatured");
  });

  it("is refused on a closed loan", async () => {
    w.fund(w.usdc, w.borrower.publicKey, USD(100));
    await w.repay(loan, USD(2_000));
    w.fails([await w.client.addCollateral(w.borrower.publicKey, loan.address, SOL(1))], [w.borrower], "AccountNotInitialized");
  });

  it("rejects another loan's escrow", async () => {
    const other = await w.openLoan({ principal: USD(100) });
    const ix = swapAccount(await w.client.addCollateral(w.borrower.publicKey, loan.address, SOL(1)), w.client.pda.escrow(loan.address), w.client.pda.escrow(other.address));
    w.fails([ix], [w.borrower], "ConstraintSeeds");
  });

  it("makes the loan safer against the debt threshold too", async () => {
    const twin = await w.openLoan({ principal: USD(1_000) });
    const topped = await w.addCollateral(loan.address, loan.collateralLamports);
    // $95 is below the 130% threshold for the original collateral (and above the 60% line)...
    w.h.setPrice(95);
    expect((await w.liquidate(twin)).status).to.equal("liquidated");
    // ...but not once the collateral is doubled
    w.fails([await w.liquidateIx(topped)], [w.keeper], "NotLiquidatable");
  });
});
