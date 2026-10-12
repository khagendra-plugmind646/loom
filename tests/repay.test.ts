import { expect } from "chai";
import { Keypair } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  CreditMerkleTree,
  INTEREST_BPS,
  LOAN_TERM_SECS,
  createNote,
  creditLeaf,
  identityCommitment,
  interestFor,
  loanDebt,
  minInterestSecs,
  totalDue,
  type LoanAccount,
} from "@loom/sdk";
import { TX_FEE, USD, createWorld, swapAccount, type World } from "./fixtures";

const T = LOAN_TERM_SECS;

describe("repay: amounts and interest", () => {
  let w: World;
  let loan: LoanAccount;
  beforeEach(async () => {
    w = await createWorld();
    loan = await w.openLoan({ principal: USD(2_000) });
    w.fund(w.usdc, w.borrower.publicKey, USD(10_000)); // enough to cover interest on top of the principal
  });

  it("rejects a zero payment", async () => {
    w.fails([await w.repayIx(loan, 0n)], [w.borrower], "ZeroAmount");
  });

  it("repaid right away, the minimum interest period applies", async () => {
    const owed = USD(2_000) + interestFor(USD(2_000), INTEREST_BPS, minInterestSecs());
    expect(loanDebt(loan, Number(w.h.now())).owed).to.equal(owed);
    const before = w.h.tokenBalance(w.usdc, w.treasury.publicKey);
    const repaid = await w.repay(loan, owed);
    expect(repaid.status).to.equal("repaid");
    expect(repaid.repaid).to.equal(owed);
    expect(w.h.tokenBalance(w.usdc, w.treasury.publicKey) - before).to.equal(owed);
  });

  it("charges interest only for the time borrowed once past the minimum", async () => {
    w.h.warp(Math.floor(T / 2));
    const owed = USD(2_000) + interestFor(USD(2_000), INTEREST_BPS, Math.floor(T / 2));
    expect(loanDebt(loan, Number(w.h.now())).owed).to.equal(owed);
    expect((await w.repay(loan, owed)).repaid).to.equal(owed);
  });

  it("each payment covers interest first, then principal", async () => {
    w.h.warp(Math.floor(T / 4));
    const interest = interestFor(USD(2_000), INTEREST_BPS, Math.floor(T / 4));

    // less than the interest due: principal untouched
    let l = await w.repay(loan, USD(10));
    expect(l.repaid).to.equal(USD(10));
    expect(l.principalRepaid).to.equal(0n);
    expect(l.interestAccrued).to.equal(interest);
    expect(l.accruedTs).to.equal(w.h.now());

    // the rest of the interest plus $500 of principal
    l = await w.repay(l, interest - USD(10) + USD(500));
    expect(l.principalRepaid).to.equal(USD(500));
    expect(l.status).to.equal("active");
  });

  it("interest keeps accruing only on the principal still owed", async () => {
    w.h.warp(Math.floor(T / 4));
    const first = loanDebt(loan, Number(w.h.now()));
    let l = await w.repay(loan, first.interest + USD(1_000)); // half the principal
    expect(l.principalRepaid).to.equal(USD(1_000));
    w.h.warp(Math.floor(T / 4));
    const second = loanDebt(l, Number(w.h.now()));
    expect(second.principal).to.equal(USD(1_000));
    expect(second.interest).to.equal(interestFor(USD(1_000), INTEREST_BPS, Math.floor(T / 4)));
    l = await w.repay(l, second.owed);
    expect(l.status).to.equal("repaid");
    expect(l.repaid).to.equal(first.owed + second.interest);
  });

  it("overpayments are capped at what is owed: only that leaves the payer's wallet", async () => {
    w.h.warp(Math.floor(T / 3));
    const owed = loanDebt(loan, Number(w.h.now())).owed;
    const before = w.h.tokenBalance(w.usdc, w.borrower.publicKey);
    const l = await w.repay(loan, owed * 3n);
    expect(l.repaid).to.equal(owed);
    expect(before - w.h.tokenBalance(w.usdc, w.borrower.publicKey)).to.equal(owed);
    expect(w.event("repaymentMade").amount.toString()).to.equal(owed.toString());
  });

  it("never costs more than the full-term maximum (totalDue)", async () => {
    w.h.warp(T);
    const owed = loanDebt(loan, Number(w.h.now())).owed;
    expect(owed).to.equal(totalDue(USD(2_000)));
    expect((await w.repay(loan, owed + USD(100))).repaid).to.equal(totalDue(USD(2_000)));
  });

  it("the SDK predicts the exact on-chain charge at every step of a payment schedule", async () => {
    let l = loan;
    for (const [warp, pay] of [
      [3_600, USD(1)],
      [86_400 * 10, USD(250)],
      [86_400 * 45, USD(17.5)],
      [86_400 * 90, USD(900)],
    ] as const) {
      w.h.warp(warp);
      const predicted = loanDebt(l, Number(w.h.now()));
      const payInterest = pay < predicted.interest ? pay : predicted.interest;
      const next = await w.repay(l, pay);
      expect(next.repaid - l.repaid).to.equal(pay);
      expect(next.principalRepaid - l.principalRepaid).to.equal(pay - payInterest);
      expect(loanDebt(next, Number(w.h.now())).owed).to.equal(predicted.owed - pay);
      expect(w.event("repaymentMade").remaining.toString()).to.equal((predicted.owed - pay).toString());
      l = next;
    }
  });
});

describe("repay: timing and loan state", () => {
  let w: World;
  beforeEach(async () => {
    w = await createWorld();
    w.fund(w.usdc, w.borrower.publicKey, USD(10_000));
  });

  it("is allowed at the exact deadline and refused one second later", async () => {
    const a = await w.openLoan({ principal: USD(100) });
    const b = await w.openLoan({ principal: USD(100) });
    w.h.warp(T);
    expect(w.h.now()).to.equal(a.maturityTs);
    await w.repay(a, USD(1));
    w.h.warp(1);
    w.fails([await w.repayIx(b, USD(1))], [w.borrower], "LoanMatured");
  });

  it("refuses payments on a repaid loan", async () => {
    const loan = await w.openLoan({ principal: USD(100) });
    await w.repay(loan, USD(1_000));
    // the escrow is closed, so the accounts no longer validate
    w.fails([await w.repayIx(loan, USD(1))], [w.borrower], "AccountNotInitialized");
  });

  it("refuses payments on a settled loan", async () => {
    const loan = await w.openLoan({ principal: USD(100) });
    w.h.setPrice(50);
    await w.liquidate(loan);
    w.fails([await w.repayIx(loan, USD(1))], [w.borrower], "AccountNotInitialized");
  });
});

describe("repay: full repayment releases the collateral", () => {
  let w: World;
  beforeEach(async () => {
    w = await createWorld();
    w.fund(w.usdc, w.borrower.publicKey, USD(10_000));
  });

  it("closes the escrow and returns collateral + rent to the borrower", async () => {
    const loan = await w.openLoan({ principal: USD(1_000) });
    const escrow = w.escrowLamports(loan.address);
    const solBefore = w.h.lamports(w.borrower.publicKey);
    w.h.warp(86_400);
    const l = await w.repay(loan, USD(2_000));
    expect(l.status).to.equal("repaid");
    expect(l.closedTs).to.equal(w.h.now());
    expect(w.h.svm.getAccount(w.client.pda.escrow(loan.address))).to.equal(null);
    expect(w.h.lamports(w.borrower.publicKey) - solBefore).to.equal(escrow - TX_FEE);

    const ev = w.event("loanRepaid");
    expect(ev.loan.equals(loan.address)).to.be.true;
    expect(ev.collateralReturned.toString()).to.equal(loan.collateralLamports.toString());
  });

  it("anyone can repay for the borrower; the SOL still goes to the borrower", async () => {
    const loan = await w.openLoan({ principal: USD(1_000) });
    const friend = w.h.wallet(1);
    w.fund(w.usdc, friend.publicKey, USD(2_000));
    const escrow = w.escrowLamports(loan.address);
    const solBefore = w.h.lamports(w.borrower.publicKey);
    const friendUsdc = w.h.tokenBalance(w.usdc, friend.publicKey);
    const l = await w.repay(loan, USD(2_000), { payer: friend });
    expect(l.status).to.equal("repaid");
    expect(w.h.lamports(w.borrower.publicKey) - solBefore).to.equal(escrow);
    expect(friendUsdc - w.h.tokenBalance(w.usdc, friend.publicKey)).to.equal(l.repaid);
    expect(w.event("repaymentMade").payer.equals(friend.publicKey)).to.be.true;
  });

  it("accepts USDT for a USDC loan (and mixes of both) on treasury-funded loans", async () => {
    const loan = await w.openLoan({ principal: USD(1_000) });
    w.fund(w.usdt, w.borrower.publicKey, USD(2_000));
    const tUsdc = w.h.tokenBalance(w.usdc, w.treasury.publicKey);
    const tUsdt = w.h.tokenBalance(w.usdt, w.treasury.publicKey);
    let l = await w.repay(loan, USD(400), { mint: w.usdc });
    const owed = loanDebt(l, Number(w.h.now())).owed;
    l = await w.repay(l, USD(5_000), { mint: w.usdt });
    expect(l.status).to.equal("repaid");
    expect(w.h.tokenBalance(w.usdc, w.treasury.publicKey) - tUsdc).to.equal(USD(400));
    expect(w.h.tokenBalance(w.usdt, w.treasury.publicKey) - tUsdt).to.equal(owed);
    expect(w.reserve(w.usdc).totalRepaid).to.equal(USD(400));
    expect(w.reserve(w.usdt).totalRepaid).to.equal(owed);
    expect(w.event("repaymentMade").mint.equals(w.usdt)).to.be.true;
  });

  it("updates protocol stats", async () => {
    const loan = await w.openLoan({ principal: USD(1_000) });
    const other = await w.openLoan({ principal: USD(300) });
    let l = await w.repay(loan, USD(500));
    let s = w.h.config().stats;
    expect(s.totalRepaid).to.equal(USD(500));
    expect(s.outstandingDebt).to.equal(USD(1_300) - l.principalRepaid);
    expect(s.activeLoans).to.equal(2n);

    l = await w.repay(l, USD(2_000));
    s = w.h.config().stats;
    expect(s.totalRepaid).to.equal(l.repaid);
    expect(s.outstandingDebt).to.equal(USD(300));
    expect(s.activeLoans).to.equal(1n);
    expect(s.loansRepaid).to.equal(1n);
    expect(s.collateralLockedLamports).to.equal(other.collateralLamports);
  });

  it("a loan without an identity commitment doesn't enter the credit tree", async () => {
    const loan = await w.openLoan({ principal: USD(100) });
    const tree = w.h.creditTree();
    const l = await w.repay(loan, USD(1_000));
    expect(l.creditLeafIndex).to.equal(null);
    expect(l.creditLeaf).to.equal(0n);
    expect(w.h.creditTree()).to.deep.equal(tree);
    expect(w.h.events().some((e) => e.name === "creditLeafInserted")).to.be.false;
  });

  it("a loan with a commitment inserts its credit leaf, matching the off-chain tree", async () => {
    const notes = [createNote(), createNote(), createNote()];
    const leaves: bigint[] = [];
    for (const [i, note] of notes.entries()) {
      const loan = await w.openLoan({ principal: USD(100 * (i + 1)), note });
      w.h.warp(86_400 * (i + 1));
      const l = await w.repay(loan, USD(1_000));
      expect(l.creditLeafIndex).to.equal(BigInt(i));
      expect(l.creditLeaf).to.equal(creditLeaf(identityCommitment(note), l.principal, l.repaid, l.startTs, l.closedTs));
      leaves.push(l.creditLeaf);

      const ev = w.event("creditLeafInserted");
      expect(ev.index.toString()).to.equal(String(i));
      expect(w.event("loanRepaid").creditLeafIndex.toString()).to.equal(String(i));
      expect(w.h.creditTree()).to.deep.equal({ root: new CreditMerkleTree(leaves).root, nextIndex: BigInt(i + 1) });
    }
  });

  it("a partial payment doesn't insert a leaf", async () => {
    const loan = await w.openLoan({ principal: USD(100), note: createNote() });
    const l = await w.repay(loan, USD(50));
    expect(l.creditLeafIndex).to.equal(null);
    expect(w.h.creditTree().nextIndex).to.equal(0n);
  });
});

describe("repay: account validation", () => {
  let w: World;
  let loan: LoanAccount;
  beforeEach(async () => {
    w = await createWorld();
    loan = await w.openLoan({ principal: USD(100) });
  });

  it("rejects a forged treasury", async () => {
    w.fails([await w.repayIx(loan, USD(10), { treasury: w.keeper.publicKey })], [w.borrower], "ConstraintHasOne");
  });

  it("rejects a forged borrower (who would receive the collateral)", async () => {
    w.fails([await w.client.repay({ payer: w.borrower.publicKey, loan: { ...loan, borrower: w.keeper.publicKey }, mint: w.usdc, amount: USD(1_000), treasury: w.treasury.publicKey })], [w.borrower], "ConstraintHasOne");
  });

  it("rejects another loan's escrow", async () => {
    const other = await w.openLoan({ principal: USD(100) });
    const ix = swapAccount(await w.repayIx(loan, USD(1_000)), w.client.pda.escrow(loan.address), w.client.pda.escrow(other.address));
    w.fails([ix], [w.borrower], "ConstraintSeeds");
  });

  it("rejects paying from a token account the payer doesn't own", async () => {
    const victim = w.fund(w.usdc, w.keeper.publicKey, USD(1_000));
    const ix = await w.client.repay({ payer: w.borrower.publicKey, loan, mint: w.usdc, amount: USD(10), treasury: w.treasury.publicKey, payerToken: victim });
    w.fails([ix], [w.borrower], "ConstraintTokenOwner");
  });

  it("rejects a stablecoin without a reserve", async () => {
    const dai = w.h.createMint(w.admin);
    w.fund(dai, w.borrower.publicKey, USD(1_000));
    w.fails([await w.repayIx(loan, USD(10), { mint: dai })], [w.borrower], "AccountNotInitialized");
  });

  it("after the treasury changes, repayments go to the new treasury (its token account is created)", async () => {
    const next = Keypair.generate().publicKey;
    w.h.send([await w.client.updateConfig(w.admin.publicKey, { treasury: next })], [w.admin]);
    w.fails([await w.repayIx(loan, USD(10))], [w.borrower], "ConstraintHasOne"); // the old one is refused
    w.h.send([await w.client.repay({ payer: w.borrower.publicKey, loan, mint: w.usdc, amount: USD(10), treasury: next })], [w.borrower]);
    expect(w.h.tokenAccountBalance(getAssociatedTokenAddressSync(w.usdc, next, true))).to.equal(USD(10));
  });

  it("passing pool accounts for a treasury-funded loan has no effect on the pool", async () => {
    await w.initPool();
    await w.deposit(w.keeper, USD(500));
    const pool = w.pool();
    const before = w.h.tokenBalance(w.usdc, w.treasury.publicKey);
    w.h.send([await w.client.repay({ payer: w.borrower.publicKey, loan: { ...loan, fromPool: true }, mint: w.usdc, amount: USD(10), treasury: w.treasury.publicKey })], [w.borrower]);
    expect(w.pool()).to.deep.equal(pool);
    expect(w.h.tokenBalance(w.usdc, w.treasury.publicKey) - before).to.equal(USD(10));
  });
});
