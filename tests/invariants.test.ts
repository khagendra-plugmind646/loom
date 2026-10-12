import { expect } from "chai";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  CreditMerkleTree,
  LoomClient,
  createNote,
  loanDebt,
  positionValue,
  requiredCollateralLamports,
  settleReason,
  type LoanAccount,
} from "@loom/sdk";
import { PRICE, SOL, USD, createWorld, type World } from "./fixtures";

/** Deterministic PRNG so a failure reproduces exactly (mulberry32). */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Runs a long random mix of every user action and checks, after each step, that the protocol's
 * public accounting reconciles with the individual loan, reserve, pool and position accounts —
 * and that the SDK predicts what the program does. Catches regressions where a change to one
 * feature silently breaks another's bookkeeping.
 */
for (const seed of [1, 7, 42]) {
  describe(`invariants under a random mix of actions (seed ${seed})`, function () {
    this.timeout(120_000);
    let w: World;
    const rand = rng(seed);
    const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
    const between = (lo: number, hi: number) => lo + rand() * (hi - lo);

    const loans: PublicKey[] = [];
    /** Repayments per payment coin, to reconcile each reserve's `total_repaid`. */
    const repaidIn = new Map<string, bigint>();
    let price = 150;
    let borrowers: Keypair[];
    let lenders: Keypair[];

    const all = () => loans.map((a) => w.h.loan(a));

    function checkInvariants(step: string) {
      const ls = all();
      const cfg = w.h.config();
      const s = cfg.stats;
      const active = ls.filter((l) => l.status === "active");
      const count = (st: LoanAccount["status"]) => BigInt(ls.filter((l) => l.status === st).length);
      const sum = (xs: LoanAccount[], f: (l: LoanAccount) => bigint) => xs.reduce((a, l) => a + f(l), 0n);
      const at = `after ${step}`;

      expect(s.loansOpened, at).to.equal(BigInt(ls.length));
      expect(cfg.nextLoanId, at).to.equal(BigInt(ls.length));
      expect(s.activeLoans, at).to.equal(BigInt(active.length));
      expect(s.loansRepaid, at).to.equal(count("repaid"));
      expect(s.loansLiquidated, at).to.equal(count("liquidated"));
      expect(s.loansDefaulted, at).to.equal(count("defaulted"));
      expect(s.totalPrincipalIssued, at).to.equal(sum(ls, (l) => l.principal));
      expect(s.totalRepaid, at).to.equal(sum(ls, (l) => l.repaid));
      expect(s.outstandingDebt, at).to.equal(sum(active, (l) => l.principal - l.principalRepaid));
      expect(s.collateralLockedLamports, at).to.equal(sum(active, (l) => l.collateralLamports));

      const rent = w.escrowRent();
      for (const l of ls) {
        const escrow = w.h.svm.getAccount(w.client.pda.escrow(l.address));
        if (l.status === "active") {
          expect(escrow?.lamports, `${at}: escrow of loan ${l.id}`).to.equal(l.collateralLamports + rent);
          expect(l.repaid <= l.totalDue, at).to.be.true;
        } else {
          expect(escrow, `${at}: closed escrow of loan ${l.id}`).to.equal(null);
          expect(l.closedTs > 0n, at).to.be.true;
        }
      }

      for (const mint of [w.usdc, w.usdt]) {
        const r = w.reserve(mint);
        expect(r.totalDisbursed, at).to.equal(sum(ls.filter((l) => l.mint.equals(mint)), (l) => l.principal));
        expect(r.totalRepaid, at).to.equal(repaidIn.get(mint.toBase58()) ?? 0n);

        const p = w.pool(mint);
        expect(w.h.tokenAccountBalance(p.vault), at).to.equal(p.cash);
        expect(p.principalOut, at).to.equal(sum(active.filter((l) => l.fromPool && l.mint.equals(mint)), (l) => l.principal - l.principalRepaid));
        const positions = lenders.map((o) => w.position(o.publicKey, mint)).filter((x) => x !== null);
        expect(p.totalShares, at).to.equal(positions.reduce((a, x) => a + x!.shares, 0n));
        // what all positions are worth never exceeds what the pool holds (rounding favours the pool)
        expect(positions.reduce((a, x) => a + positionValue(p, x!.shares), 0n) <= p.cash + p.principalOut, at).to.be.true;
      }

      const leaves = LoomClient.creditLeaves(ls);
      expect(w.h.creditTree(), at).to.deep.equal({ root: new CreditMerkleTree(leaves).root, nextIndex: BigInt(leaves.length) });
    }

    before(async () => {
      w = await createWorld();
      borrowers = [w.borrower, w.h.wallet(100_000), w.h.wallet(100_000)];
      lenders = [w.h.wallet(10), w.h.wallet(10)];
      for (const mint of [w.usdc, w.usdt]) {
        await w.initPool(mint);
        for (const b of borrowers) w.fund(mint, b.publicKey, USD(200_000));
      }
    });

    it("keeps every invariant through 150 random steps", async () => {
      checkInvariants("setup");
      for (let i = 0; i < 150; i++) {
        const now = Number(w.h.now());
        const ls = all();
        const active = ls.filter((l) => l.status === "active");
        const live = active.filter((l) => now <= Number(l.maturityTs));
        const action = pick(["open", "open", "repay", "repay", "topup", "time", "price", "settle", "deposit", "withdraw"]);
        let step = `${i}:${action}`;
        w.h.setPrice(price);

        if (action === "open") {
          const who = pick(borrowers);
          const mint = pick([w.usdc, w.usdt]);
          const principal = USD(Math.round(between(10, 3_000)));
          const collateral = requiredCollateralLamports(principal, PRICE(price), PRICE(0.05), -8, BigInt(Math.floor(between(0, 10_000))));
          const loan = await w.openLoan({ who, mint, principal, priceUsd: price, collateral, pool: rand() < 0.6, note: rand() < 0.7 ? createNote() : undefined });
          loans.push(loan.address);
          step += ` $${Number(principal) / 1e6} ${loan.fromPool ? "pool" : "treasury"}`;
        } else if (action === "repay" && live.length) {
          const loan = pick(live);
          const owed = loanDebt(loan, now).owed;
          const amount = rand() < 0.4 ? owed + USD(between(0, 50)) : BigInt(Math.max(1, Math.floor(Number(owed) * between(0.05, 0.9))));
          const mint = loan.fromPool ? loan.mint : pick([w.usdc, w.usdt]);
          const payer = pick(borrowers);
          const after = await w.repay(loan, amount, { mint, payer });
          const paid = after.repaid - loan.repaid;
          expect(paid, step).to.equal(amount < owed ? amount : owed); // the SDK predicted the cap exactly
          repaidIn.set(mint.toBase58(), (repaidIn.get(mint.toBase58()) ?? 0n) + paid);
          step += ` ${after.status}`;
        } else if (action === "topup" && live.length) {
          await w.addCollateral(pick(live).address, SOL(between(0.01, 5)), pick(borrowers));
        } else if (action === "time") {
          w.h.warp(Math.floor(between(0, 60 * 86_400)));
        } else if (action === "price") {
          price = Math.max(40, Math.min(250, Math.round(price * between(0.8, 1.2) * 100) / 100));
          w.h.setPrice(price);
        } else if (action === "settle" && active.length) {
          // the SDK predicts whether the program will accept a settlement
          for (const loan of active) {
            const reason = settleReason(loan, PRICE(price), -8, now);
            const ix = await w.liquidateIx(loan);
            if (reason === null) {
              w.fails([ix], [w.keeper], "NotLiquidatable");
            } else {
              w.h.send([ix], [w.keeper]);
              expect(w.h.loan(loan.address).status, step).to.equal(reason === "matured" ? "defaulted" : "liquidated");
            }
          }
        } else if (action === "deposit") {
          await w.deposit(pick(lenders), USD(Math.round(between(1, 5_000))), pick([w.usdc, w.usdt]));
        } else if (action === "withdraw") {
          const owner = pick(lenders);
          const mint = pick([w.usdc, w.usdt]);
          const pos = w.position(owner.publicKey, mint);
          const pool = w.pool(mint);
          const liquid = pool.totalShares === 0n ? 0n : (pool.cash * pool.totalShares) / (pool.cash + pool.principalOut);
          const shares = pos ? [pos.shares, liquid].reduce((a, b) => (a < b ? a : b)) : 0n;
          if (shares > 0n && positionValue(pool, shares) > 0n) {
            w.fund(mint, owner.publicKey, 0n);
            w.h.send([await w.client.withdraw(owner.publicKey, mint, shares)], [owner]);
          }
        }
        checkInvariants(step);
      }
      // the random walk must actually have exercised every path
      const end = all();
      const s = w.h.config().stats;
      console.log(`      ${end.length} loans: ${s.loansRepaid} repaid, ${s.loansLiquidated} liquidated, ${s.loansDefaulted} defaulted, ${end.filter((l) => l.fromPool).length} pool-funded`);
      expect(end.some((l) => l.fromPool) && end.some((l) => !l.fromPool), "pool and treasury loans").to.be.true;
      expect(s.loansRepaid > 0n && s.loansLiquidated + s.loansDefaulted > 0n, "repaid and settled loans").to.be.true;
    });
  });
}
