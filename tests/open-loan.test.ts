import { expect } from "chai";
import { Keypair, PublicKey } from "@solana/web3.js";
import { createApproveCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  CHAINLINK_SOL_USD_FEED,
  CHAINLINK_STORE_PROGRAM_ID,
  FR,
  INTEREST_BPS,
  LOAN_TERM_SECS,
  PYTH_RECEIVER_PROGRAM_ID,
  SOL_USD_PRICE_ACCOUNT,
  createNote,
  encodeChainlinkFeed,
  encodePriceUpdateV2,
  identityCommitment,
  lamportsToStable,
  requiredCollateralLamports,
  totalDue,
} from "@loom/sdk";
import { PRICE, SOL, TX_FEE, USD, createWorld, swapAccount, type World } from "./fixtures";

describe("open_loan: happy path", () => {
  let w: World;
  beforeEach(async () => {
    w = await createWorld();
  });

  it("records every loan field", async () => {
    const note = createNote();
    const collateral = requiredCollateralLamports(USD(1_000), PRICE(150), PRICE(0.05), -8);
    const now = w.h.now();
    const loan = await w.openLoan({ principal: USD(1_000), note });

    expect(loan.id).to.equal(0n);
    expect(loan.borrower.equals(w.borrower.publicKey)).to.be.true;
    expect(loan.recipient.equals(w.borrower.publicKey)).to.be.true;
    expect(loan.mint.equals(w.usdc)).to.be.true;
    expect(loan.principal).to.equal(USD(1_000));
    expect(loan.totalDue).to.equal(totalDue(USD(1_000), INTEREST_BPS));
    expect(loan.repaid).to.equal(0n);
    expect(loan.principalRepaid).to.equal(0n);
    expect(loan.interestAccrued).to.equal(0n);
    expect(loan.collateralLamports).to.equal(collateral);
    expect(loan.openingCollateralLamports).to.equal(collateral);
    expect(loan.openPrice).to.equal(PRICE(150));
    expect(loan.openPriceExpo).to.equal(-8);
    expect(loan.startTs).to.equal(now);
    expect(loan.accruedTs).to.equal(now);
    expect(loan.maturityTs).to.equal(now + BigInt(LOAN_TERM_SECS));
    expect(loan.closedTs).to.equal(0n);
    expect(loan.liquidationThresholdBps).to.equal(w.params.liquidationThresholdBps);
    expect(loan.liquidationPenaltyBps).to.equal(w.params.liquidationPenaltyBps);
    expect(loan.status).to.equal("active");
    expect(loan.rateBps).to.equal(Number(INTEREST_BPS));
    expect(loan.identityCommitment).to.equal(identityCommitment(note));
    expect(loan.creditLeaf).to.equal(0n);
    expect(loan.creditLeafIndex).to.equal(null);
    expect(loan.creditCertificate).to.equal(null);
    expect(loan.creditLevel).to.equal(0);
    expect(loan.fromPool).to.be.false;
  });

  it("locks the SOL in a per-loan escrow and pays the borrower from the treasury", async () => {
    const solBefore = w.h.lamports(w.borrower.publicKey);
    const usdcBefore = w.h.tokenBalance(w.usdc, w.borrower.publicKey);
    const source = w.payoutSource(w.usdc);
    const loan = await w.openLoan({ principal: USD(1_000) });

    expect(w.h.tokenBalance(w.usdc, w.borrower.publicKey) - usdcBefore).to.equal(USD(1_000));
    expect(w.payoutSource(w.usdc)).to.deep.equal({ balance: source.balance - USD(1_000), approved: source.approved - USD(1_000) });
    expect(w.escrowLamports(loan.address)).to.equal(loan.collateralLamports + w.escrowRent());
    const escrow = w.h.svm.getAccount(w.client.pda.escrow(loan.address))!;
    expect(escrow.owner.equals(w.client.programId)).to.be.true;
    // the borrower paid collateral + rent for the loan, escrow and their new token account + the fee
    expect(solBefore - w.h.lamports(w.borrower.publicKey) > loan.collateralLamports + w.escrowRent() + TX_FEE).to.be.true;
  });

  it("updates protocol stats and the reserve's disbursed total", async () => {
    const loan = await w.openLoan({ principal: USD(1_000) });
    await w.openLoan({ principal: USD(50), mint: w.usdt });
    const s = w.h.config().stats;
    expect(s.loansOpened).to.equal(2n);
    expect(s.activeLoans).to.equal(2n);
    expect(s.totalPrincipalIssued).to.equal(USD(1_050));
    expect(s.outstandingDebt).to.equal(USD(1_050));
    expect(s.collateralLockedLamports).to.equal(loan.collateralLamports + w.h.loan(w.client.pda.loan(w.borrower.publicKey, 2n)).collateralLamports);
    expect(w.h.config().nextLoanId).to.equal(2n);
    expect(w.reserve(w.usdc).totalDisbursed).to.equal(USD(1_000));
    expect(w.reserve(w.usdt).totalDisbursed).to.equal(USD(50));
  });

  it("emits LoanOpened with the loan's terms", async () => {
    const loan = await w.openLoan({ principal: USD(1_000) });
    const ev = w.event("loanOpened");
    expect(ev.loan.equals(loan.address)).to.be.true;
    expect(ev.id.toString()).to.equal("0");
    expect(ev.borrower.equals(w.borrower.publicKey)).to.be.true;
    expect(ev.recipient.equals(w.borrower.publicKey)).to.be.true;
    expect(ev.mint.equals(w.usdc)).to.be.true;
    expect(ev.principal.toString()).to.equal(USD(1_000).toString());
    expect(ev.totalDue.toString()).to.equal(loan.totalDue.toString());
    expect(ev.collateralLamports.toString()).to.equal(loan.collateralLamports.toString());
    expect(ev.price.toString()).to.equal(PRICE(150).toString());
    expect(ev.priceExpo).to.equal(-8);
    expect(ev.maturityTs.toString()).to.equal(loan.maturityTs.toString());
    expect(ev.rateBps).to.equal(Number(INTEREST_BPS));
    expect(ev.creditCertificate.equals(PublicKey.default)).to.be.true;
    expect(ev.fromPool).to.be.false;
  });

  it("loan ids increase and nonces are per borrower", async () => {
    const other = w.h.wallet();
    const a = await w.openLoan({ principal: USD(100), nonce: 7n });
    const b = await w.openLoan({ principal: USD(100), nonce: 7n, who: other });
    const c = await w.openLoan({ principal: USD(100), nonce: 8n });
    expect([a.id, b.id, c.id]).to.deep.equal([0n, 1n, 2n]);
    expect(a.address.equals(b.address)).to.be.false;
    // the same borrower can't reuse a nonce
    const { ix } = w.openLoanIx({ principal: USD(100), nonce: 7n });
    expect(w.h.sendExpectFail([await ix], [w.borrower])).to.match(/already in use/);
  });

  it("disburses USDT as well as USDC", async () => {
    const before = w.h.tokenBalance(w.usdt, w.borrower.publicKey);
    const loan = await w.openLoan({ principal: USD(50), mint: w.usdt });
    expect(loan.mint.equals(w.usdt)).to.be.true;
    expect(w.h.tokenBalance(w.usdt, w.borrower.publicKey) - before).to.equal(USD(50));
  });

  it("pays a chosen recipient (creating their token account) while the loan stays the borrower's", async () => {
    const friend = Keypair.generate().publicKey;
    const loan = await w.openLoan({ principal: USD(200), recipient: friend });
    expect(w.h.tokenBalance(w.usdc, friend)).to.equal(USD(200));
    expect(loan.borrower.equals(w.borrower.publicKey)).to.be.true;
    expect(loan.recipient.equals(friend)).to.be.true;
    expect(w.event("loanOpened").recipient.equals(friend)).to.be.true;
  });

  it("accepts principal exactly at the configured min and max", async () => {
    const min = await w.openLoan({ principal: w.params.minPrincipal });
    expect(min.principal).to.equal(w.params.minPrincipal);
    const whale = w.h.wallet(10_000); // $500k at 200% is ~6,700 SOL
    const max = await w.openLoan({ principal: w.params.maxPrincipal, who: whale });
    expect(max.principal).to.equal(w.params.maxPrincipal);
  });

  it("accepts exactly 200% collateral at the conservative price, and more", async () => {
    const needed = requiredCollateralLamports(USD(1_000), PRICE(150), PRICE(0.05), -8);
    const exact = await w.openLoan({ principal: USD(1_000), collateral: needed });
    expect(lamportsToStable(exact.collateralLamports, PRICE(149.95), -8) >= USD(2_000)).to.be.true;
    const generous = await w.openLoan({ principal: USD(1_000), collateral: SOL(100) });
    expect(generous.collateralLamports).to.equal(SOL(100));
  });

  it("accepts the largest valid identity commitment (field modulus - 1)", async () => {
    const loan = await w.openLoan({ principal: USD(100), commitment: FR - 1n });
    expect(loan.identityCommitment).to.equal(FR - 1n);
  });

  it("snapshots the risk parameters: later config changes don't touch open loans", async () => {
    const loan = await w.openLoan({ principal: USD(100) });
    w.h.send([await w.client.updateConfig(w.admin.publicKey, { liquidationThresholdBps: 15_000, liquidationPenaltyBps: 1_500 })], [w.admin]);
    const after = w.h.loan(loan.address);
    expect(after.liquidationThresholdBps).to.equal(w.params.liquidationThresholdBps);
    expect(after.liquidationPenaltyBps).to.equal(w.params.liquidationPenaltyBps);
    expect((await w.openLoan({ principal: USD(100) })).liquidationThresholdBps).to.equal(15_000);
  });

  it("accepts any verified SOL/USD Pyth update account (pull-oracle accounts are not pinned)", async () => {
    const elsewhere = Keypair.generate().publicKey;
    w.h.svm.setAccount(elsewhere, {
      owner: PYTH_RECEIVER_PROGRAM_ID,
      lamports: 1_000_000_000,
      executable: false,
      data: encodePriceUpdateV2({ price: PRICE(150), conf: PRICE(0.05), expo: -8, publishTime: Number(w.h.now()) }),
    });
    const { ix, address } = w.openLoanIx({ principal: USD(100) });
    w.h.send([swapAccount(await ix, SOL_USD_PRICE_ACCOUNT, elsewhere)], [w.borrower]);
    expect(w.h.loan(address).status).to.equal("active");
  });
});

describe("open_loan: rejections", () => {
  let w: World;
  beforeEach(async () => {
    w = await createWorld();
  });

  const tryOpen = async (o: Parameters<World["openLoanIx"]>[0], code: string, who?: Keypair) => {
    const { ix, address } = w.openLoanIx({ ...o, who });
    w.fails([await ix], [who ?? w.borrower], code);
    expect(w.h.svm.getAccount(address), "no loan account left behind").to.equal(null);
  };

  it("while paused", async () => {
    w.h.send([await w.client.updateConfig(w.admin.publicKey, { paused: true })], [w.admin]);
    await tryOpen({ principal: USD(100) }, "Paused");
  });

  it("principal below the minimum or above the maximum", async () => {
    await tryOpen({ principal: w.params.minPrincipal - 1n }, "PrincipalOutOfRange");
    await tryOpen({ principal: w.params.maxPrincipal + 1n, collateral: SOL(10_000) }, "PrincipalOutOfRange");
    await tryOpen({ principal: 0n, collateral: SOL(1) }, "PrincipalOutOfRange");
  });

  it("zero collateral", async () => {
    await tryOpen({ principal: USD(100), collateral: 0n }, "ZeroAmount");
  });

  it("collateral one lamport short of 200%", async () => {
    const needed = requiredCollateralLamports(USD(1_000), PRICE(150), PRICE(0.05), -8);
    await tryOpen({ principal: USD(1_000), collateral: needed - 1n }, "InsufficientCollateral");
  });

  it("collateral that covers 200% at the oracle price but not at price - confidence", async () => {
    const atMid = requiredCollateralLamports(USD(1_000), PRICE(150), 0n, -8);
    await tryOpen({ principal: USD(1_000), collateral: atMid, confUsd: 1 }, "InsufficientCollateral");
  });

  it("an identity commitment outside the BN254 field", async () => {
    await tryOpen({ principal: USD(100), commitment: FR }, "InvalidCommitment");
    await tryOpen({ principal: USD(100), commitment: 2n ** 256n - 1n }, "InvalidCommitment");
  });

  it("paying the treasury itself", async () => {
    await tryOpen({ principal: USD(100), recipient: w.treasury.publicKey }, "InvalidRecipient");
  });

  it("a forged treasury", async () => {
    w.fund(w.usdc, w.keeper.publicKey, USD(1_000)); // the forged treasury even has a token account
    const ix = w.client.openLoan({
      borrower: w.borrower.publicKey,
      treasury: w.keeper.publicKey,
      mint: w.usdc,
      nonce: 1n,
      principal: USD(100),
      collateralLamports: SOL(10),
    });
    w.fails([await ix], [w.borrower], "ConstraintHasOne");
  });

  it("when the treasury's balance can't cover it", async () => {
    const dai = w.h.createMint(w.admin);
    w.h.send([await w.client.initReserve(w.admin.publicKey, dai, w.treasury.publicKey)], [w.admin]);
    w.fund(dai, w.treasury.publicKey, USD(20));
    w.approvePayouts(dai, USD(1_000));
    await tryOpen({ principal: USD(100), mint: dai }, "InsufficientLiquidity");
    // exactly the balance works
    expect((await w.openLoan({ principal: USD(20), mint: dai })).principal).to.equal(USD(20));
  });

  it("above the treasury's approved limit, after revocation, or when approved to someone else", async () => {
    w.approvePayouts(w.usdc, USD(60));
    await tryOpen({ principal: USD(100) }, "PayoutNotApproved");
    expect((await w.openLoan({ principal: USD(60) })).principal).to.equal(USD(60)); // exactly the limit
    await tryOpen({ principal: USD(10) }, "PayoutNotApproved"); // the limit is used up

    w.approvePayouts(w.usdc, 0n);
    await tryOpen({ principal: USD(10) }, "PayoutNotApproved");

    // approved, but to a different delegate
    const source = getAssociatedTokenAddressSync(w.usdc, w.treasury.publicKey, true);
    w.h.send([createApproveCheckedInstruction(source, w.usdc, w.keeper.publicKey, w.treasury.publicKey, USD(1_000), 6)], [w.treasury]);
    await tryOpen({ principal: USD(10) }, "PayoutNotApproved");
  });

  it("a stablecoin without a reserve", async () => {
    const dai = w.h.createMint(w.admin);
    w.fund(dai, w.treasury.publicKey, USD(1_000));
    await tryOpen({ principal: USD(100), mint: dai }, "AccountNotInitialized");
  });

  it("a feed account other than the pinned Chainlink SOL/USD address", async () => {
    const fake = Keypair.generate().publicKey;
    w.h.svm.setAccount(fake, {
      owner: CHAINLINK_STORE_PROGRAM_ID,
      lamports: 1_000_000_000,
      executable: false,
      data: encodeChainlinkFeed({ price: PRICE(1_000), timestamp: Number(w.h.now()) }),
    });
    const { ix } = w.openLoanIx({ principal: USD(100) });
    w.fails([swapAccount(await ix, CHAINLINK_SOL_USD_FEED, fake)], [w.borrower], "InvalidChainlinkFeed");
  });

  it("a borrower who can't afford the collateral", async () => {
    const poor = w.h.wallet(1);
    const { ix } = w.openLoanIx({ principal: USD(1_000), who: poor });
    const logs = w.h.sendExpectFail([await ix], [poor]);
    expect(logs).to.match(/insufficient lamports/);
  });
});

describe("pause only blocks new loans", () => {
  it("repay, add collateral and liquidate still work while paused", async () => {
    const w = await createWorld();
    const a = await w.openLoan({ principal: USD(100) });
    const b = await w.openLoan({ principal: USD(100) });
    w.h.send([await w.client.updateConfig(w.admin.publicKey, { paused: true })], [w.admin]);

    await w.addCollateral(a.address, SOL(1));
    w.h.setPrice(150);
    expect((await w.repay(a, USD(1_000))).status).to.equal("repaid");
    w.h.warp(LOAN_TERM_SECS + 1);
    w.h.setPrice(150);
    expect((await w.liquidate(b)).status).to.equal("defaulted");
  });
});
