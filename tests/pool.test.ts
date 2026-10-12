import { expect } from "chai";
import { Keypair } from "@solana/web3.js";
import { createTransferInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  BPS,
  LOAN_TERM_SECS,
  PROTOCOL_FEE_BPS,
  loanDebt,
  poolApyBps,
  positionValue,
  sharesForDeposit,
  stableToLamports,
  type LoanAccount,
} from "@loom/sdk";
import { PRICE, USD, createWorld, swapAccount, type World } from "./fixtures";

const T = LOAN_TERM_SECS;
const fee = (interest: bigint) => (interest * PROTOCOL_FEE_BPS) / BPS;

describe("pool: init_pool", () => {
  let w: World;
  beforeEach(async () => {
    w = await createWorld();
  });

  it("creates an empty pool and its vault", async () => {
    await w.initPool();
    const p = w.pool();
    expect(p.mint.equals(w.usdc)).to.be.true;
    expect(p.vault.equals(w.client.pda.poolVault(w.usdc))).to.be.true;
    expect([p.cash, p.principalOut, p.totalShares, p.totalDeposited, p.totalWithdrawn, p.interestEarned]).to.deep.equal([0n, 0n, 0n, 0n, 0n, 0n]);
    expect(w.h.tokenAccountBalance(p.vault)).to.equal(0n);
  });

  it("only the admin can create a pool", async () => {
    w.fails([await w.client.initPool(w.keeper.publicKey, w.usdc)], [w.keeper], "ConstraintHasOne");
  });

  it("needs a reserve for the stablecoin", async () => {
    const dai = w.h.createMint(w.admin);
    w.fails([await w.client.initPool(w.admin.publicKey, dai)], [w.admin], "AccountNotInitialized");
  });

  it("one pool per stablecoin", async () => {
    await w.initPool();
    expect(w.h.sendExpectFail([await w.client.initPool(w.admin.publicKey, w.usdc)], [w.admin])).to.match(/already in use/);
    await w.initPool(w.usdt); // a different coin is fine
  });
});

describe("pool: deposit", () => {
  let w: World;
  const lenderA = Keypair.generate();
  const lenderB = Keypair.generate();
  beforeEach(async () => {
    w = await createWorld();
    await w.initPool();
    for (const l of [lenderA, lenderB]) w.h.svm.airdrop(l.publicKey, 10n ** 10n);
  });

  it("the first deposit mints shares 1:1 and creates the position", async () => {
    await w.deposit(lenderA, USD(1_000));
    expect(w.position(lenderA.publicKey)).to.deep.include({ shares: USD(1_000), deposited: USD(1_000), withdrawn: 0n });
    expect(w.position(lenderA.publicKey)!.owner.equals(lenderA.publicKey)).to.be.true;
    expect(w.pool()).to.deep.include({ cash: USD(1_000), totalShares: USD(1_000), totalDeposited: USD(1_000) });
    expect(w.h.tokenAccountBalance(w.client.pda.poolVault(w.usdc))).to.equal(USD(1_000));
    expect(w.h.tokenBalance(w.usdc, lenderA.publicKey)).to.equal(0n);
    const ev = w.event("poolDeposited");
    expect(ev.owner.equals(lenderA.publicKey)).to.be.true;
    expect(ev.amount.toString()).to.equal(USD(1_000).toString());
    expect(ev.shares.toString()).to.equal(USD(1_000).toString());
  });

  it("further deposits add to the same position", async () => {
    await w.deposit(lenderA, USD(100));
    await w.deposit(lenderA, USD(50));
    expect(w.position(lenderA.publicKey)).to.deep.include({ shares: USD(150), deposited: USD(150) });
  });

  it("tokens sent straight to the vault don't change the share price (no inflation attack)", async () => {
    await w.deposit(lenderA, USD(1));
    const before = w.pool();
    const donor = w.fund(w.usdc, w.keeper.publicKey, USD(10_000));
    w.h.send([createTransferInstruction(donor, w.client.pda.poolVault(w.usdc), w.keeper.publicKey, USD(10_000))], [w.keeper]);
    expect(w.pool()).to.deep.equal(before);
    await w.deposit(lenderB, USD(1));
    expect(w.position(lenderB.publicKey)!.shares).to.equal(USD(1));
  });

  it("after the pool earns interest, a deposit buys fewer shares (matching the SDK)", async () => {
    await w.deposit(lenderA, USD(1_000));
    const loan = await w.openLoan({ principal: USD(1_000), pool: true });
    w.fund(w.usdc, w.borrower.publicKey, USD(100));
    w.h.warp(Math.floor(T / 2));
    await w.repay(loan, USD(2_000));
    const pool = w.pool();
    expect(pool.cash > pool.totalShares).to.be.true;
    const expected = sharesForDeposit(pool, USD(500));
    await w.deposit(lenderB, USD(500));
    expect(w.position(lenderB.publicKey)!.shares).to.equal(expected);
    expect(expected < USD(500)).to.be.true;
  });

  it("rejects zero, and deposits too small to mint a share", async () => {
    w.fund(w.usdc, lenderA.publicKey, USD(1));
    w.fails([await w.client.deposit(lenderA.publicKey, w.usdc, 0n)], [lenderA], "ZeroAmount");
    // grow the share price above 1 so that 1 base unit rounds down to 0 shares
    await w.deposit(lenderB, USD(100));
    const loan = await w.openLoan({ principal: USD(100), pool: true });
    w.fund(w.usdc, w.borrower.publicKey, USD(100));
    w.h.warp(Math.floor(T / 2));
    await w.repay(loan, USD(200));
    expect(sharesForDeposit(w.pool(), 1n)).to.equal(0n);
    w.fails([await w.client.deposit(lenderA.publicKey, w.usdc, 1n)], [lenderA], "DepositTooSmall");
  });

  it("rejects another mint's vault", async () => {
    await w.initPool(w.usdt);
    w.fund(w.usdc, lenderA.publicKey, USD(1));
    const ix = swapAccount(await w.client.deposit(lenderA.publicKey, w.usdc, USD(1)), w.client.pda.poolVault(w.usdc), w.client.pda.poolVault(w.usdt));
    w.fails([ix], [lenderA], "ConstraintHasOne");
  });
});

describe("pool: withdraw", () => {
  let w: World;
  const lender = Keypair.generate();
  beforeEach(async () => {
    w = await createWorld();
    await w.initPool();
    w.h.svm.airdrop(lender.publicKey, 10n ** 10n);
    await w.deposit(lender, USD(1_000));
  });

  it("burns shares for their value and records it", async () => {
    w.h.send([await w.client.withdraw(lender.publicKey, w.usdc, USD(400))], [lender]);
    expect(w.h.tokenBalance(w.usdc, lender.publicKey)).to.equal(USD(400));
    expect(w.position(lender.publicKey)).to.deep.include({ shares: USD(600), withdrawn: USD(400), deposited: USD(1_000) });
    expect(w.pool()).to.deep.include({ cash: USD(600), totalShares: USD(600), totalWithdrawn: USD(400) });
    const ev = w.event("poolWithdrawn");
    expect(ev.amount.toString()).to.equal(USD(400).toString());
    expect(ev.shares.toString()).to.equal(USD(400).toString());
  });

  it("everything can be withdrawn, leaving an empty pool", async () => {
    w.h.send([await w.client.withdraw(lender.publicKey, w.usdc, USD(1_000))], [lender]);
    expect(w.pool()).to.deep.include({ cash: 0n, totalShares: 0n });
    expect(w.position(lender.publicKey)!.shares).to.equal(0n);
  });

  it("rejects zero shares and more shares than the position holds", async () => {
    w.fails([await w.client.withdraw(lender.publicKey, w.usdc, 0n)], [lender], "ZeroAmount");
    w.fails([await w.client.withdraw(lender.publicKey, w.usdc, USD(1_000) + 1n)], [lender], "InsufficientShares");
  });

  it("only cash that isn't lent out can leave", async () => {
    await w.openLoan({ principal: USD(700), pool: true });
    w.fails([await w.client.withdraw(lender.publicKey, w.usdc, USD(300) + 1n)], [lender], "InsufficientPoolLiquidity");
    w.h.send([await w.client.withdraw(lender.publicKey, w.usdc, USD(300))], [lender]);
    expect(w.pool().cash).to.equal(0n);
  });

  it("no one can withdraw from someone else's position", async () => {
    const thief = w.h.wallet(1);
    w.fund(w.usdc, thief.publicKey, 0n);
    // without a position of their own
    w.fails([await w.client.withdraw(thief.publicKey, w.usdc, USD(1))], [thief], "AccountNotInitialized");
    // pointing at the victim's position
    const ix = swapAccount(await w.client.withdraw(thief.publicKey, w.usdc, USD(1)), w.client.pda.lender(w.usdc, thief.publicKey), w.client.pda.lender(w.usdc, lender.publicKey));
    w.fails([ix], [thief], "ConstraintSeeds");
  });

  it("can pay out to any token account of the pool's coin, but not another coin", async () => {
    const elsewhere = w.fund(w.usdc, Keypair.generate().publicKey, 0n);
    const ix = swapAccount(await w.client.withdraw(lender.publicKey, w.usdc, USD(10)), getAssociatedTokenAddressSync(w.usdc, lender.publicKey, true), elsewhere);
    w.fund(w.usdc, lender.publicKey, 0n);
    w.h.send([ix], [lender]);
    expect(w.h.tokenAccountBalance(elsewhere)).to.equal(USD(10));

    const usdtAta = w.fund(w.usdt, lender.publicKey, 0n);
    const bad = swapAccount(await w.client.withdraw(lender.publicKey, w.usdc, USD(10)), getAssociatedTokenAddressSync(w.usdc, lender.publicKey, true), usdtAta);
    w.fails([bad], [lender], "ConstraintTokenMint");
  });
});

describe("pool: funding loans", () => {
  let w: World;
  const lender = Keypair.generate();
  beforeEach(async () => {
    w = await createWorld();
    await w.initPool();
    w.h.svm.airdrop(lender.publicKey, 10n ** 10n);
    await w.deposit(lender, USD(1_000));
  });

  it("a loan the pool can cover is paid from the pool, leaving the treasury untouched", async () => {
    const source = w.payoutSource(w.usdc);
    const before = w.h.tokenBalance(w.usdc, w.borrower.publicKey);
    const loan = await w.openLoan({ principal: USD(1_000), pool: true }); // exactly the pool's cash
    expect(loan.fromPool).to.be.true;
    expect(w.payoutSource(w.usdc)).to.deep.equal(source);
    expect(w.h.tokenBalance(w.usdc, w.borrower.publicKey) - before).to.equal(USD(1_000));
    expect(w.pool()).to.deep.include({ cash: 0n, principalOut: USD(1_000), totalShares: USD(1_000) });
    expect(w.h.tokenAccountBalance(w.client.pda.poolVault(w.usdc))).to.equal(0n);
    expect(w.event("loanOpened").fromPool).to.be.true;
    expect(w.reserve(w.usdc).totalDisbursed).to.equal(USD(1_000));
  });

  it("a loan larger than the pool's cash falls back to the treasury", async () => {
    const source = w.payoutSource(w.usdc);
    const loan = await w.openLoan({ principal: USD(1_000) + 1n, pool: true });
    expect(loan.fromPool).to.be.false;
    expect(source.balance - w.payoutSource(w.usdc).balance).to.equal(USD(1_000) + 1n);
    expect(w.pool().cash).to.equal(USD(1_000));
  });

  it("a loan that doesn't offer the pool is paid by the treasury", async () => {
    const loan = await w.openLoan({ principal: USD(100) });
    expect(loan.fromPool).to.be.false;
    expect(w.pool().cash).to.equal(USD(1_000));
  });

  it("the pool doesn't need treasury approval", async () => {
    w.approvePayouts(w.usdc, 0n);
    expect((await w.openLoan({ principal: USD(500), pool: true })).fromPool).to.be.true;
    // but the fallback does
    const { ix } = w.openLoanIx({ principal: USD(600), pool: true });
    w.fails([await ix], [w.borrower], "PayoutNotApproved");
  });

  it("rejects a pool vault that isn't the pool's", async () => {
    const { ix } = w.openLoanIx({ principal: USD(100), pool: true });
    w.fails([swapAccount(await ix, w.client.pda.poolVault(w.usdc), w.client.pda.vault(w.usdc))], [w.borrower], "InvalidPool");
  });

  it("rejects offering a pool for a coin without one", async () => {
    const { ix } = w.openLoanIx({ principal: USD(100), pool: true, mint: w.usdt });
    w.fails([await ix], [w.borrower], "AccountNotInitialized");
  });
});

describe("pool: repayments go back to the pool", () => {
  let w: World;
  let loan: LoanAccount;
  const lender = Keypair.generate();
  beforeEach(async () => {
    w = await createWorld();
    await w.initPool();
    w.h.svm.airdrop(lender.publicKey, 10n ** 10n);
    await w.deposit(lender, USD(2_000));
    loan = await w.openLoan({ principal: USD(1_500), pool: true });
    w.fund(w.usdc, w.borrower.publicKey, USD(1_000));
  });

  it("full repayment: principal + interest to the pool, the protocol fee to the treasury", async () => {
    w.h.warp(Math.floor(T / 2));
    const debt = loanDebt(loan, Number(w.h.now()));
    const before = w.pool();
    const treasuryBefore = w.h.tokenBalance(w.usdc, w.treasury.publicKey);
    const l = await w.repay(loan, debt.owed);
    expect(l.status).to.equal("repaid");
    expect(w.h.tokenBalance(w.usdc, w.treasury.publicKey) - treasuryBefore).to.equal(fee(debt.interest));
    const after = w.pool();
    expect(after.cash - before.cash).to.equal(debt.owed - fee(debt.interest));
    expect(after.principalOut).to.equal(0n);
    expect(after.interestEarned).to.equal(debt.interest - fee(debt.interest));
    expect(w.h.tokenAccountBalance(w.client.pda.poolVault(w.usdc))).to.equal(after.cash);
  });

  it("partial repayment: the fee is taken only from the interest part", async () => {
    w.h.warp(Math.floor(T / 4));
    const debt = loanDebt(loan, Number(w.h.now()));
    const before = w.pool();
    const treasuryBefore = w.h.tokenBalance(w.usdc, w.treasury.publicKey);
    const pay = debt.interest + USD(500);
    await w.repay(loan, pay);
    const after = w.pool();
    expect(w.h.tokenBalance(w.usdc, w.treasury.publicKey) - treasuryBefore).to.equal(fee(debt.interest));
    expect(after.cash - before.cash).to.equal(pay - fee(debt.interest));
    expect(before.principalOut - after.principalOut).to.equal(USD(500));
  });

  it("depositors earn the interest: their shares are worth more and can be withdrawn", async () => {
    w.h.warp(Math.floor(T / 2));
    const debt = loanDebt(loan, Number(w.h.now()));
    await w.repay(loan, debt.owed);
    const shares = w.position(lender.publicKey)!.shares;
    const value = positionValue(w.pool(), shares);
    expect(value).to.equal(USD(2_000) + debt.interest - fee(debt.interest));
    w.h.send([await w.client.withdraw(lender.publicKey, w.usdc, shares)], [lender]);
    expect(w.h.tokenBalance(w.usdc, lender.publicKey)).to.equal(value);
  });

  it("must be repaid in the coin it was borrowed in", async () => {
    await w.initPool(w.usdt);
    w.fund(w.usdt, w.borrower.publicKey, USD(100));
    w.fails([await w.repayIx(loan, USD(10), { mint: w.usdt })], [w.borrower], "RepayInLoanCoin");
  });

  it("requires the pool accounts", async () => {
    const ix = await w.client.repay({ payer: w.borrower.publicKey, loan: { ...loan, fromPool: false }, mint: w.usdc, amount: USD(10), treasury: w.treasury.publicKey });
    w.fails([ix], [w.borrower], "PoolAccountsRequired");
  });

  it("rejects a vault that isn't the pool's", async () => {
    const ix = swapAccount(await w.repayIx(loan, USD(10)), w.client.pda.poolVault(w.usdc), getAssociatedTokenAddressSync(w.usdc, w.keeper.publicKey, true));
    w.fund(w.usdc, w.keeper.publicKey, 0n);
    w.fails([ix], [w.borrower], "InvalidPool");
  });

  it("the SDK's pool APY reflects active pool loans", () => {
    const apy = poolApyBps(w.pool(), [loan]);
    // 12% on $1,500 of a $2,000 pool, minus the 10% fee = 8.1%
    expect(apy).to.equal(810);
  });
});

describe("pool: settling pool-funded loans (treasury buy-out)", () => {
  let w: World;
  let loan: LoanAccount;
  const lender = Keypair.generate();
  beforeEach(async () => {
    w = await createWorld();
    await w.initPool();
    w.h.svm.airdrop(lender.publicKey, 10n ** 10n);
    await w.deposit(lender, USD(2_000));
    loan = await w.openLoan({ principal: USD(1_000), pool: true });
  });

  it("default: the treasury pays the pool what is owed and takes SOL worth the debt", async () => {
    w.h.warp(T + 1);
    w.h.setPrice(150);
    const owed = loanDebt(loan, Number(w.h.now())).owed;
    const before = w.pool();
    const treasuryUsdc = w.h.tokenBalance(w.usdc, w.treasury.publicKey);
    const treasurySol = w.h.lamports(w.treasury.publicKey);
    expect((await w.liquidate(loan)).status).to.equal("defaulted");
    expect(w.pool().cash - before.cash).to.equal(owed);
    expect(w.pool().principalOut).to.equal(0n);
    expect(w.pool().interestEarned).to.equal(owed - USD(1_000));
    expect(treasuryUsdc - w.h.tokenBalance(w.usdc, w.treasury.publicKey)).to.equal(owed);
    expect(w.h.lamports(w.treasury.publicKey) - treasurySol).to.equal(stableToLamports(owed, PRICE(150), -8, true));
    expect(w.event("poolLoanBoughtOut").amount.toString()).to.equal(owed.toString());

    // depositors are made whole, with interest
    const shares = w.position(lender.publicKey)!.shares;
    w.h.send([await w.client.withdraw(lender.publicKey, w.usdc, shares)], [lender]);
    expect(w.h.tokenBalance(w.usdc, lender.publicKey)).to.equal(USD(2_000) + owed - USD(1_000));
  });

  it("price settlement: the treasury buys out the loan and takes all the SOL", async () => {
    w.h.setPrice(80);
    const owed = loanDebt(loan, Number(w.h.now())).owed;
    const treasurySol = w.h.lamports(w.treasury.publicKey);
    expect((await w.liquidate(loan)).status).to.equal("liquidated");
    expect(w.pool().cash).to.equal(USD(1_000) + owed);
    expect(w.h.lamports(w.treasury.publicKey) - treasurySol).to.equal(loan.collateralLamports);
  });

  it("refuses to settle until the treasury has approved enough to buy out the loan", async () => {
    w.h.warp(T + 1);
    w.h.setPrice(150);
    const owed = loanDebt(loan, Number(w.h.now())).owed;
    w.approvePayouts(w.usdc, owed - 1n);
    w.fails([await w.liquidateIx(loan)], [w.keeper], "PoolBackstopUnfunded");
    w.approvePayouts(w.usdc, owed);
    expect((await w.liquidate(loan)).status).to.equal("defaulted");
  });

  it("refuses to settle when the treasury's balance can't cover the buy-out", async () => {
    w.h.warp(T + 1);
    w.h.setPrice(150);
    const all = w.h.tokenBalance(w.usdc, w.treasury.publicKey);
    const sink = w.fund(w.usdc, w.keeper.publicKey, 0n);
    w.h.send([createTransferInstruction(getAssociatedTokenAddressSync(w.usdc, w.treasury.publicKey, true), sink, w.treasury.publicKey, all - USD(10))], [w.treasury]);
    w.fails([await w.liquidateIx(loan)], [w.keeper], "PoolBackstopUnfunded");
  });

  it("the buy-out must come from the treasury's own token account", async () => {
    w.h.warp(T + 1);
    w.h.setPrice(150);
    const forged = w.approveFrom(w.keeper, w.usdc, USD(10_000));
    const ix = swapAccount(await w.liquidateIx(loan), getAssociatedTokenAddressSync(w.usdc, w.treasury.publicKey, true), forged);
    w.fails([ix], [w.keeper], "PoolBackstopUnfunded");
  });

  it("requires the pool accounts", async () => {
    w.h.warp(T + 1);
    w.h.setPrice(150);
    const ix = await w.client.liquidate({ caller: w.keeper.publicKey, loan: { ...loan, fromPool: false }, treasury: w.treasury.publicKey });
    w.fails([ix], [w.keeper], "PoolAccountsRequired");
  });

  it("rejects a vault that isn't the pool's", async () => {
    w.h.warp(T + 1);
    w.h.setPrice(150);
    const ix = swapAccount(await w.liquidateIx(loan), w.client.pda.poolVault(w.usdc), w.client.pda.vault(w.usdc));
    w.fails([ix], [w.keeper], "InvalidPool");
  });
});
