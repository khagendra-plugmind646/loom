import { expect } from "chai";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  CREDIT_INTEREST_BPS,
  CREDIT_LEVEL_RATES_BPS,
  INTEREST_BPS,
  LOAN_TERM_SECS,
  creditLimit,
  creditRateBps,
  creditTerms,
  interestFor,
  loanDebt,
  minInterestSecs,
  totalDue,
} from "@loom/sdk";
import { SOL, USD, createWorld, type World } from "./fixtures";

/**
 * Credit levels and limits. Certificates are written straight into the SVM (as `claim_certificate`
 * would create them), so these tests don't depend on the ZK prover — see zk.test.ts for that.
 */
describe("credit: rates unlocked by repayment certificates", () => {
  let w: World;
  let holder: Keypair;
  beforeEach(async () => {
    w = await createWorld();
    holder = w.h.wallet(10_000);
  });

  const certs = (n: number, each = USD(1_000)) => Promise.all(Array.from({ length: n }, () => w.injectCertificate(holder.publicKey, each)));

  it("no certificate: the standard 12% rate", async () => {
    const loan = await w.openLoan({ principal: USD(100), who: holder });
    expect(loan.rateBps).to.equal(Number(INTEREST_BPS));
    expect(loan.creditLevel).to.equal(0);
    expect(loan.creditCertificate).to.equal(null);
  });

  it("one certificate: 8% a year, recorded on the loan and in the event", async () => {
    const [cert] = await certs(1);
    const loan = await w.openLoan({ principal: USD(2_000), who: holder, creditCertificates: [cert] });
    expect(loan.rateBps).to.equal(Number(CREDIT_INTEREST_BPS));
    expect(loan.creditLevel).to.equal(1);
    expect(loan.creditCertificate?.equals(cert)).to.be.true;
    expect(loan.totalDue).to.equal(totalDue(USD(2_000), CREDIT_INTEREST_BPS));
    const ev = w.event("loanOpened");
    expect(ev.rateBps).to.equal(Number(CREDIT_INTEREST_BPS));
    expect(ev.creditCertificate.equals(cert)).to.be.true;
  });

  for (const [n, rate] of [
    [2, 700n],
    [3, 600n],
    [4, 600n],
    [5, 600n],
  ] as const) {
    it(`${n} certificates: ${Number(rate) / 100}% a year (level ${n})`, async () => {
      const cs = await certs(n);
      const loan = await w.openLoan({ principal: USD(100), who: holder, creditCertificates: cs });
      expect(loan.rateBps).to.equal(Number(rate));
      expect(loan.creditLevel).to.equal(n);
      expect(loan.creditCertificate?.equals(cs[0])).to.be.true;
      expect(BigInt(loan.rateBps)).to.equal(creditRateBps(n));
    });
  }

  it("a sixth certificate is ignored (at most five count toward the level and the limit)", async () => {
    const five = await certs(5);
    const big = await w.injectCertificate(holder.publicKey, USD(100_000));
    const limit = USD(5_000) * 2n;
    const loan = await w.openLoan({ principal: limit, who: holder, creditCertificates: [...five, big] });
    expect(loan.creditLevel).to.equal(5);
    const { ix } = w.openLoanIx({ principal: limit + 1n, who: holder, creditCertificates: [...five, big] });
    w.fails([await ix], [holder], "AboveCreditLimit");
  });

  it("the credit rate is what repayment charges", async () => {
    const [cert] = await certs(1);
    const loan = await w.openLoan({ principal: USD(1_000), who: holder, creditCertificates: [cert] });
    w.h.warp(Math.floor(LOAN_TERM_SECS / 2));
    const owed = USD(1_000) + interestFor(USD(1_000), CREDIT_INTEREST_BPS, Math.floor(LOAN_TERM_SECS / 2));
    expect(loanDebt(loan, Number(w.h.now())).owed).to.equal(owed);
    w.fund(w.usdc, holder.publicKey, USD(100));
    w.h.send([await w.repayIx(loan, owed + USD(10), { payer: holder })], [holder]);
    expect(w.h.loan(loan.address).repaid).to.equal(owed);
  });

  it("the minimum interest period applies at the credit rate", async () => {
    const [cert] = await certs(1);
    const loan = await w.openLoan({ principal: USD(1_000), who: holder, creditCertificates: [cert] });
    expect(loanDebt(loan, Number(w.h.now())).interest).to.equal(interestFor(USD(1_000), CREDIT_INTEREST_BPS, minInterestSecs()));
  });

  it("a certificate isn't consumed: it can back several loans", async () => {
    const [cert] = await certs(1);
    for (let i = 0; i < 3; i++) {
      expect((await w.openLoan({ principal: USD(500), who: holder, creditCertificates: [cert] })).rateBps).to.equal(Number(CREDIT_INTEREST_BPS));
    }
  });
});

describe("credit: limits", () => {
  let w: World;
  let holder: Keypair;
  beforeEach(async () => {
    w = await createWorld();
    holder = w.h.wallet(10_000);
  });

  it("covers loans up to 2x the proven principal, and no more", async () => {
    const cert = await w.injectCertificate(holder.publicKey, USD(1_000));
    expect((await w.openLoan({ principal: USD(2_000), who: holder, creditCertificates: [cert] })).rateBps).to.equal(800);
    const { ix } = w.openLoanIx({ principal: USD(2_000) + 1n, who: holder, creditCertificates: [cert] });
    w.fails([await ix], [holder], "AboveCreditLimit");
  });

  it("combines the proven amounts of several certificates", async () => {
    const a = await w.injectCertificate(holder.publicKey, USD(1_000));
    const b = await w.injectCertificate(holder.publicKey, USD(250));
    const limit = (USD(1_000) + USD(250)) * 2n;
    expect(creditLimit([{ minPrincipal: USD(1_000) }, { minPrincipal: USD(250) }])).to.equal(limit);
    expect((await w.openLoan({ principal: limit, who: holder, creditCertificates: [a, b] })).rateBps).to.equal(700);
    const { ix } = w.openLoanIx({ principal: limit + 1n, who: holder, creditCertificates: [a, b] });
    w.fails([await ix], [holder], "AboveCreditLimit");
  });

  it("the SDK's creditTerms picks the certificates and rate the program applies", async () => {
    const proven = [USD(100), USD(5_000), USD(700)];
    const addrs = await Promise.all(proven.map((p) => w.injectCertificate(holder.publicKey, p)));
    const mine = proven.map((minPrincipal, i) => ({ minPrincipal, address: addrs[i] }));
    const terms = creditTerms(mine, USD(10_000))!;
    expect(terms.certificates.map((c) => c.minPrincipal)).to.deep.equal([USD(5_000), USD(700), USD(100)]);
    const loan = await w.openLoan({ principal: USD(10_000), who: holder, creditCertificates: terms.certificates.map((c) => c.address) });
    expect(BigInt(loan.rateBps)).to.equal(terms.rateBps);
    expect(creditTerms(mine, USD(20_000) + 1n)).to.equal(null);
  });
});

describe("credit: certificate validation", () => {
  let w: World;
  let holder: Keypair;
  beforeEach(async () => {
    w = await createWorld();
    holder = w.h.wallet(10_000);
  });

  const tryOpen = async (who: Keypair, creditCertificates: PublicKey[], code: string) => {
    const { ix } = w.openLoanIx({ principal: USD(100), who, collateral: SOL(10), creditCertificates });
    w.fails([await ix], [who], code);
  };

  it("only the certificate's holder can use it (first or additional certificate)", async () => {
    const mine = await w.injectCertificate(holder.publicKey, USD(1_000));
    const theirs = await w.injectCertificate(w.keeper.publicKey, USD(1_000));
    await tryOpen(w.borrower, [mine], "NotCertificateHolder");
    await tryOpen(holder, [mine, theirs], "NotCertificateHolder");
    await tryOpen(holder, [theirs, mine], "NotCertificateHolder");
  });

  it("the same certificate can't be counted twice", async () => {
    const a = await w.injectCertificate(holder.publicKey, USD(1_000));
    const b = await w.injectCertificate(holder.publicKey, USD(1_000));
    await tryOpen(holder, [a, a], "DuplicateCertificate");
    await tryOpen(holder, [a, b, b], "DuplicateCertificate");
  });

  it("additional certificates must be program-owned CreditCertificate accounts", async () => {
    const a = await w.injectCertificate(holder.publicKey, USD(1_000));
    // a token account (owned by the token program)
    const ata = w.fund(w.usdc, holder.publicKey, 0n);
    await tryOpen(holder, [a, ata], "InvalidCertificate");
    // a Loomzk account of another type (the config)
    await tryOpen(holder, [a, w.client.pda.config()], "InvalidCertificate");
    // a non-existent account
    await tryOpen(holder, [a, Keypair.generate().publicKey], "InvalidCertificate");
    // a forged certificate: the right bytes, owned by another program
    const real = w.h.svm.getAccount(a)!;
    const forged = Keypair.generate().publicKey;
    w.h.svm.setAccount(forged, { owner: Keypair.generate().publicKey, lamports: 10_000_000, data: real.data, executable: false });
    await tryOpen(holder, [a, forged], "InvalidCertificate");
  });

  it("the first certificate must be a program-owned CreditCertificate account", async () => {
    const real = w.h.svm.getAccount(await w.injectCertificate(holder.publicKey, USD(1_000)))!;
    const forged = Keypair.generate().publicKey;
    w.h.svm.setAccount(forged, { owner: Keypair.generate().publicKey, lamports: 10_000_000, data: real.data, executable: false });
    await tryOpen(holder, [forged], "AccountOwnedByWrongProgram");
    await tryOpen(holder, [w.client.pda.config()], "AccountDiscriminatorMismatch");
  });
});

describe("credit: SDK helpers", () => {
  it("creditRateBps follows the level table", () => {
    expect(creditRateBps(0)).to.equal(null);
    expect([1, 2, 3, 4, 10].map(creditRateBps)).to.deep.equal([...CREDIT_LEVEL_RATES_BPS, 600n, 600n]);
  });
});
