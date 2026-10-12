import { expect } from "chai";
import { Keypair, PublicKey } from "@solana/web3.js";
import { AccountLayout, createTransferInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  CreditMerkleTree,
  LOAN_TERM_SECS,
  LoomClient,
  CREDIT_INTEREST_BPS,
  INTEREST_BPS,
  BPS,
  PROTOCOL_FEE_BPS,
  createNote,
  defaultSplit,
  positionValue,
  interestFor,
  loanDebt,
  minInterestSecs,
  encodeChainlinkFeed,
  identityCommitment,
  parseChainlinkFeed,
  stableToLamports,
  lamportsToStable,
  requiredCollateralLamports,
  totalDue,
  type CreditNote,
  type LoanAccount,
} from "@loom/sdk";
import { proveRepaymentCertificate } from "@loom/sdk/prover";
import { Harness } from "./harness";

const USD = (n: number) => BigInt(Math.round(n * 1e6));
const PRICE = (usd: number) => BigInt(Math.round(usd * 1e8));
const WASM = "zk/build/repayment_certificate_js/repayment_certificate.wasm";
/** Test time steps are fractions of the loan term, so the suite passes for any LOAN_TERM_SECS. */
const T = LOAN_TERM_SECS;
const ZKEY = "zk/build/repayment_certificate.zkey";

describe("loom", () => {
  const h = new Harness();
  const { client } = h;
  const admin = h.wallet();
  const treasury = h.wallet(1);
  const borrower = h.wallet();
  const keeper = h.wallet(10);
  let usdc: PublicKey;
  let usdt: PublicKey;
  let nonce = 1n;

  /** Opens a loan at the current oracle price with exactly-enough (+buffer) collateral. */
  /** Every loan opened through `openLoan`, for the accounting reconciliation. */
  const opened: PublicKey[] = [];

  async function openLoan(opts: {
    who?: Keypair;
    mint?: PublicKey;
    principal: bigint;
    priceUsd: number;
    /** Chainlink SOL/USD; defaults to the Pyth price. */
    chainlinkUsd?: number;
    confUsd?: number;
    collateral?: bigint;
    note?: CreditNote;
    recipient?: PublicKey;
    creditCertificates?: PublicKey[];
    pool?: boolean;
  }): Promise<LoanAccount> {
    const who = opts.who ?? borrower;
    const confUsd = opts.confUsd ?? 0.05;
    h.setPrice(opts.priceUsd, { confUsd });
    if (opts.chainlinkUsd !== undefined) h.setChainlinkPrice(opts.chainlinkUsd);
    const collateral =
      opts.collateral ?? requiredCollateralLamports(opts.principal, PRICE(opts.priceUsd), PRICE(confUsd), -8);
    const n = nonce++;
    h.send(
      [
        await client.openLoan({
          borrower: who.publicKey,
          treasury: treasury.publicKey,
          recipient: opts.recipient,
          mint: opts.mint ?? usdc,
          nonce: n,
          principal: opts.principal,
          collateralLamports: collateral,
          identityCommitment: opts.note ? identityCommitment(opts.note) : undefined,
          creditCertificates: opts.creditCertificates,
          pool: opts.pool,
        }),
      ],
      [who],
    );
    const address = client.pda.loan(who.publicKey, n);
    opened.push(address);
    return h.loan(address);
  }

  /** Treasury token account balance and the amount it approved the reserve PDA to spend. */
  function payoutSource(mint: PublicKey) {
    const acc = AccountLayout.decode(h.svm.getAccount(getAssociatedTokenAddressSync(mint, treasury.publicKey, true))!.data);
    const approved = acc.delegateOption && new PublicKey(acc.delegate).equals(client.pda.reserve(mint)) ? acc.delegatedAmount : 0n;
    return { balance: acc.amount, approved };
  }

  async function repay(loan: LoanAccount, amount: bigint, mint = usdc, payer = borrower) {
    h.send([await client.repay({ payer: payer.publicKey, loan, mint, amount, treasury: treasury.publicKey })], [payer]);
    return h.loan(loan.address);
  }

  // =========================================================================
  describe("setup & admin", () => {
    it("initializes the protocol, credit tree and USDC/USDT reserves", async () => {
      usdc = h.createMint(admin);
      usdt = h.createMint(admin);
      h.mintTo(usdc, admin, admin.publicKey, USD(1_000_000));
      h.mintTo(usdt, admin, admin.publicKey, USD(1_000_000));

      h.send(
        [
          await client.initialize(admin.publicKey, {
            treasury: treasury.publicKey,
            liquidationThresholdBps: 13_000,
            liquidationPenaltyBps: 500,
            maxPriceAgeSecs: 120,
            maxConfidenceBps: 200,
            minPrincipal: USD(10),
            maxPrincipal: USD(500_000),
          }),
        ],
        [admin],
      );
      for (const mint of [usdc, usdt]) {
        h.send(
          [
            await client.initReserve(admin.publicKey, mint, treasury.publicKey),
            await client.fundReserve(admin.publicKey, mint, USD(250_000)),
          ],
          [admin],
        );
        expect(h.tokenAccountBalance(client.pda.vault(mint))).to.equal(USD(250_000));
        // Loans are paid from the treasury wallet, up to the limit it approves once.
        h.mintTo(mint, admin, treasury.publicKey, USD(1_000_000));
        h.send([client.approvePayouts(treasury.publicKey, mint, USD(600_000))], [treasury]);
        expect(payoutSource(mint)).to.deep.equal({ balance: USD(1_000_000), approved: USD(600_000) });
      }

      const cfg = h.config();
      expect(cfg.admin.equals(admin.publicKey)).to.be.true;
      expect(cfg.treasury.equals(treasury.publicKey)).to.be.true;
      // empty on-chain tree root == off-chain empty root
      expect(h.creditTree().root).to.equal(new CreditMerkleTree().root);
    });

    it("rejects re-initialization", async () => {
      const logs = h.sendExpectFail(
        [
          await client.initialize(keeper.publicKey, {
            treasury: keeper.publicKey,
            liquidationThresholdBps: 13_000,
            liquidationPenaltyBps: 500,
            maxPriceAgeSecs: 120,
            maxConfidenceBps: 200,
            minPrincipal: 1n,
            maxPrincipal: 2n,
          }),
        ],
        [keeper],
      );
      expect(logs).to.match(/already in use/);
    });

    it("only the admin can move reserve liquidity or change config", async () => {
      const attackerToken = h.mintTo(usdc, admin, keeper.publicKey, USD(1));
      let logs = h.sendExpectFail([await client.withdrawReserve(keeper.publicKey, usdc, USD(1), attackerToken)], [keeper]);
      expect(logs).to.include("ConstraintHasOne");
      logs = h.sendExpectFail([await client.updateConfig(keeper.publicKey, { paused: true })], [keeper]);
      expect(logs).to.include("ConstraintHasOne");
    });

    it("validates risk parameters", async () => {
      // liquidation threshold must be strictly below the 200% origination ratio
      const logs = h.sendExpectFail([await client.updateConfig(admin.publicKey, { liquidationThresholdBps: 20_000 })], [admin]);
      expect(logs).to.include("InvalidParameter");
    });
  });

  // =========================================================================
  describe("origination: 2x SOL collateral -> stablecoin", () => {
    it("rejects collateral below 200% of principal", async () => {
      h.setPrice(150);
      const needed = requiredCollateralLamports(USD(1_000), PRICE(150), PRICE(0.05), -8);
      const logs = h.sendExpectFail(
        [
          await client.openLoan({
            borrower: borrower.publicKey,
            treasury: treasury.publicKey,
            mint: usdc,
            nonce: 999n,
            principal: USD(1_000),
            collateralLamports: needed - 1n,
          }),
        ],
        [borrower],
      );
      expect(logs).to.include("InsufficientCollateral");
    });

    it("rejects stale, unverified, foreign or wrong-feed oracle accounts", async () => {
      const ix = await client.openLoan({
        borrower: borrower.publicKey,
        treasury: treasury.publicKey,
        mint: usdc,
        nonce: 998n,
        principal: USD(100),
        collateralLamports: 10n ** 10n,
      });
      h.setPrice(150, { ageSecs: 500 });
      expect(h.sendExpectFail([ix], [borrower])).to.include("StalePrice");
      h.setPrice(150, { fullyVerified: false });
      expect(h.sendExpectFail([ix], [borrower])).to.include("OracleNotFullyVerified");
      h.setPrice(150, { owner: Keypair.generate().publicKey });
      expect(h.sendExpectFail([ix], [borrower])).to.include("InvalidOracle");
      h.setPrice(150, { feedIdHex: "11".repeat(32) });
      expect(h.sendExpectFail([ix], [borrower])).to.include("WrongPriceFeed");
      h.setPrice(150, { confUsd: 10 });
      expect(h.sendExpectFail([ix], [borrower])).to.include("PriceTooUncertain");
    });

    it("rejects principal outside configured bounds", async () => {
      h.setPrice(150);
      const logs = h.sendExpectFail(
        [
          await client.openLoan({
            borrower: borrower.publicKey,
            treasury: treasury.publicKey,
            mint: usdc,
            nonce: 997n,
            principal: USD(5),
            collateralLamports: 10n ** 10n,
          }),
        ],
        [borrower],
      );
      expect(logs).to.include("PrincipalOutOfRange");
    });

    it("locks SOL in a per-loan escrow and pays USDC from the treasury wallet to the borrower", async () => {
      const before = h.tokenBalance(usdc, borrower.publicKey);
      const source = payoutSource(usdc);
      const vaultBefore = h.tokenAccountBalance(client.pda.vault(usdc));
      const loan = await openLoan({ principal: USD(1_000), priceUsd: 150 });

      expect(h.tokenBalance(usdc, borrower.publicKey) - before).to.equal(USD(1_000));
      expect(payoutSource(usdc)).to.deep.equal({ balance: source.balance - USD(1_000), approved: source.approved - USD(1_000) });
      expect(h.tokenAccountBalance(client.pda.vault(usdc))).to.equal(vaultBefore); // the legacy vault is not used
      expect(loan.recipient.equals(borrower.publicKey)).to.be.true;
      expect(loan.status).to.equal("active");
      expect(loan.rateBps).to.equal(Number(INTEREST_BPS)); // 12% a year
      expect(loan.totalDue).to.equal(USD(1_000) + interestFor(USD(1_000), INTEREST_BPS, T)); // the most it can cost
      expect(loan.maturityTs - loan.startTs).to.equal(BigInt(LOAN_TERM_SECS));
      expect(loan.creditCertificate).to.equal(null);

      const escrow = client.pda.escrow(loan.address);
      const rent = h.svm.minimumBalanceForRentExemption(8n + 33n);
      expect(h.lamports(escrow)).to.equal(loan.collateralLamports + rent);
      // collateral (at conservative price) is worth >= 2x principal
      expect(lamportsToStable(loan.collateralLamports, PRICE(150 - 0.05), -8) >= USD(2_000)).to.be.true;

      const ev = h.events().find((e) => e.name === "loanOpened");
      expect(ev, "LoanOpened event").to.exist;
      expect(h.config().stats.activeLoans).to.equal(1n);
    });

    it("can disburse USDT too", async () => {
      const before = h.tokenBalance(usdt, borrower.publicKey);
      const loan = await openLoan({ mint: usdt, principal: USD(50), priceUsd: 150 });
      expect(loan.mint.equals(usdt)).to.be.true;
      expect(h.tokenBalance(usdt, borrower.publicKey) - before).to.equal(USD(50));
    });

    it("pays a different wallet when the borrower chooses one; the loan stays the borrower's", async () => {
      const friend = Keypair.generate().publicKey; // no SOL, no token account yet
      const loan = await openLoan({ principal: USD(200), priceUsd: 150, recipient: friend });
      expect(h.tokenBalance(usdc, friend)).to.equal(USD(200));
      expect(loan.borrower.equals(borrower.publicKey)).to.be.true;
      expect(loan.recipient.equals(friend)).to.be.true;
      expect(h.events().find((e) => e.name === "loanOpened")?.data.recipient.equals(friend)).to.be.true;
    });

    it("never pays more than the treasury approved, and stops when the approval is revoked", async () => {
      h.send([client.approvePayouts(treasury.publicKey, usdt, USD(60))], [treasury]);
      h.setPrice(150);
      const ix = async (principal: bigint) =>
        client.openLoan({
          borrower: borrower.publicKey,
          treasury: treasury.publicKey,
          mint: usdt,
          nonce: 996n,
          principal,
          collateralLamports: requiredCollateralLamports(principal, PRICE(150), PRICE(0.05), -8),
        });
      expect(h.sendExpectFail([await ix(USD(100))], [borrower])).to.include("PayoutNotApproved");
      h.send([client.approvePayouts(treasury.publicKey, usdt, 0n)], [treasury]);
      expect(h.sendExpectFail([await ix(USD(50))], [borrower])).to.include("PayoutNotApproved");
      h.send([client.approvePayouts(treasury.publicKey, usdt, USD(600_000))], [treasury]);
    });

    it("rejects loans the treasury wallet can't cover", async () => {
      const dai = h.createMint(admin);
      h.send([await client.initReserve(admin.publicKey, dai, treasury.publicKey)], [admin]);
      h.mintTo(dai, admin, treasury.publicKey, USD(20));
      h.send([client.approvePayouts(treasury.publicKey, dai, USD(1_000))], [treasury]);
      h.setPrice(150);
      const logs = h.sendExpectFail(
        [
          await client.openLoan({
            borrower: borrower.publicKey,
            treasury: treasury.publicKey,
            mint: dai,
            nonce: 995n,
            principal: USD(100),
            collateralLamports: 10n ** 10n,
          }),
        ],
        [borrower],
      );
      expect(logs).to.include("InsufficientLiquidity");
    });

    it("rejects a forged payout wallet and paying the payout wallet itself", async () => {
      h.setPrice(150);
      const open = (t: PublicKey, recipient?: PublicKey) =>
        client.openLoan({ borrower: borrower.publicKey, treasury: t, recipient, mint: usdc, nonce: 994n, principal: USD(100), collateralLamports: 10n ** 10n });
      expect(h.sendExpectFail([await open(keeper.publicKey)], [borrower])).to.include("ConstraintHasOne");
      expect(h.sendExpectFail([await open(treasury.publicKey, treasury.publicKey)], [borrower])).to.include("InvalidRecipient");
    });
  });

  // =========================================================================
  describe("repayment: principal + interest for the time borrowed, to the treasury", () => {
    let note: CreditNote;
    let loan: LoanAccount;

    it("accepts partial repayments in USDC and the rest in USDT; releases collateral", async () => {
      note = createNote();
      loan = await openLoan({ principal: USD(2_000), priceUsd: 150, note });
      h.mintTo(usdt, admin, borrower.publicKey, USD(1_000)); // borrower sources USDT for the interest

      const tUsdc = h.tokenBalance(usdc, treasury.publicKey);
      const tUsdt = h.tokenBalance(usdt, treasury.publicKey);

      h.warp(Math.floor(T / 4));
      const first = loanDebt(loan, Number(h.now()));
      loan = await repay(loan, USD(1_500), usdc);
      expect(loan.repaid).to.equal(USD(1_500));
      // interest is paid first, the rest reduces the principal that keeps accruing interest
      expect(loan.principalRepaid).to.equal(USD(1_500) - first.interest);
      expect(loan.status).to.equal("active");

      h.warp(Math.floor(T / 3));
      const owed = loanDebt(loan, Number(h.now())).owed; // the SDK predicts exactly what the program charges
      const borrowerSolBefore = h.lamports(borrower.publicKey);
      const escrowLamports = h.lamports(client.pda.escrow(loan.address));
      loan = await repay(loan, USD(5_000), usdt); // overpayment is capped at what's owed
      console.log(`      final repayment (escrow release + Poseidon tree insert): ${h.lastComputeUnits} CU`);
      expect(Number(h.lastComputeUnits)).to.be.below(200_000); // fits the default compute budget

      expect(loan.status).to.equal("repaid");
      expect(loan.repaid).to.equal(USD(1_500) + owed);
      // never more than the full-term maximum (less, once the loan was held past the minimum interest period)
      expect(loan.repaid <= totalDue(USD(2_000))).to.be.true;
      expect(h.tokenBalance(usdc, treasury.publicKey) - tUsdc).to.equal(USD(1_500));
      expect(h.tokenBalance(usdt, treasury.publicKey) - tUsdt).to.equal(owed);
      // escrow closed, SOL (+ escrow rent) back with the borrower (minus the 5000-lamport tx fee)
      expect(h.svm.getAccount(client.pda.escrow(loan.address))).to.equal(null);
      expect(h.lamports(borrower.publicKey) - borrowerSolBefore).to.equal(escrowLamports - 5_000n);
      expect(loan.creditLeafIndex).to.equal(0n);
    });

    it("on-chain credit tree root matches the off-chain mirror", () => {
      const tree = new CreditMerkleTree([loan.creditLeaf]);
      expect(h.creditTree().root).to.equal(tree.root);
      expect(h.creditTree().nextIndex).to.equal(1n);
    });

    it("rejects payments on a closed loan", async () => {
      const logs = h.sendExpectFail(
        [await client.repay({ payer: borrower.publicKey, loan, mint: usdc, amount: 1n, treasury: treasury.publicKey })],
        [borrower],
      );
      // the escrow PDA is already closed, so the transaction is rejected before the handler runs
      expect(logs).to.match(/LoanNotActive|AccountNotInitialized/);
    });

    it("charges interest only for the time borrowed, with a minimum", async () => {
      const l = await openLoan({ principal: USD(1_000), priceUsd: 150 });
      // repaid right away: the minimum (30 days, or the whole term if shorter) applies
      expect(loanDebt(l, Number(h.now())).owed).to.equal(USD(1_000) + interestFor(USD(1_000), INTEREST_BPS, minInterestSecs()));

      const held = Math.floor(T / 2);
      h.warp(held);
      const expected = USD(1_000) + interestFor(USD(1_000), INTEREST_BPS, Math.max(held, minInterestSecs()));
      expect(loanDebt(l, Number(h.now())).owed).to.equal(expected);
      const repaid = await repay(l, expected + USD(50)); // a little extra is capped
      expect(repaid.status).to.equal("repaid");
      expect(repaid.repaid).to.equal(expected);
    });

    it("rejects a forged treasury account", async () => {
      const open = await openLoan({ principal: USD(100), priceUsd: 150 });
      const logs = h.sendExpectFail(
        [await client.repay({ payer: borrower.publicKey, loan: open, mint: usdc, amount: USD(10), treasury: keeper.publicKey })],
        [borrower],
      );
      expect(logs).to.include("ConstraintHasOne");
    });

    // ---------------------------------------------------------------------
    describe("zero-knowledge repayment certificate", () => {
      let note2: CreditNote;
      let loan2: LoanAccount;
      let leaves: bigint[];
      let anon: Keypair;
      let certAddr: PublicKey;
      let secondCert: PublicKey;

      before(async () => {
        // A second repaid loan so the tree has more than one leaf.
        note2 = createNote();
        loan2 = await openLoan({ principal: USD(5_000), priceUsd: 140, note: note2 });
        h.mintTo(usdc, admin, borrower.publicKey, USD(1_000));
        h.warp(Math.floor(T / 10));
        loan2 = await repay(loan2, totalDue(USD(5_000))); // capped at what's owed
        expect(loan2.status).to.equal("repaid");
        // repaid early, so well under the old flat "principal + 12%": the circuit must still accept it
        expect(loan2.repaid < USD(5_600)).to.be.true;
        expect(loan2.creditLeafIndex).to.equal(1n);
        leaves = [loan.creditLeaf, loan2.creditLeaf];
        expect(h.creditTree().root).to.equal(new CreditMerkleTree(leaves).root);
      });

      const witness = (l: LoanAccount) => ({
        principal: l.principal,
        totalRepaid: l.repaid,
        startTs: l.startTs,
        closedTs: l.closedTs,
        leafIndex: Number(l.creditLeafIndex),
      });

      it("a fresh wallet proves 'repaid >= $1,000 loan in full, on time' and gets a certificate", async () => {
        anon = h.wallet(100); // no on-chain link to the borrower
        const proof = await proveRepaymentCertificate({
          note: note2,
          loan: witness(loan2),
          leaves,
          minPrincipal: USD(1_000),
          recipient: anon.publicKey,
          wasm: WASM,
          zkey: ZKEY,
        });
        h.send(await client.claimCertificate(anon.publicKey, proof), [anon]);
        console.log(`      groth16 verification: ${h.lastComputeUnits} CU`);

        certAddr = client.pda.certificate(Uint8Array.from(proof.nullifierHash));
        const cert = client.decodeCertificate(certAddr, h.svm.getAccount(certAddr)!.data);
        expect(cert.holder.equals(anon.publicKey)).to.be.true;
        expect(cert.minPrincipal).to.equal(USD(1_000));
        expect(h.config().stats.certificatesIssued).to.equal(1n);
        // the certificate account contains nothing that links it to the borrower or loan
        const raw = Buffer.from(h.svm.getAccount(certAddr)!.data);
        expect(raw.includes(borrower.publicKey.toBuffer())).to.be.false;
        expect(raw.includes(loan2.address.toBuffer())).to.be.false;
      });

      it("the certificate's wallet borrows at the credit rate, up to 2x the proven amount", async () => {
        const loan3 = await openLoan({ who: anon, principal: USD(2_000), priceUsd: 150, creditCertificates: [certAddr] });
        expect(loan3.rateBps).to.equal(Number(CREDIT_INTEREST_BPS)); // 8% instead of 12%
        expect(loan3.creditCertificate?.equals(certAddr)).to.be.true;
        expect(loan3.totalDue).to.equal(totalDue(USD(2_000), CREDIT_INTEREST_BPS));
        expect(h.events().find((e) => e.name === "loanOpened")?.data.rateBps).to.equal(Number(CREDIT_INTEREST_BPS));

        // above the credit limit
        h.setPrice(150);
        const above = USD(2_000) + 1n;
        const logs = h.sendExpectFail(
          [
            await client.openLoan({
              borrower: anon.publicKey,
              treasury: treasury.publicKey,
              mint: usdc,
              nonce: 9_100n,
              principal: above,
              collateralLamports: requiredCollateralLamports(above, PRICE(150), PRICE(0.05), -8),
              creditCertificates: [certAddr],
            }),
          ],
          [anon],
        );
        expect(logs).to.include("AboveCreditLimit");
      });

      it("only the certificate's wallet can use it", async () => {
        h.setPrice(150);
        const logs = h.sendExpectFail(
          [
            await client.openLoan({
              borrower: borrower.publicKey,
              treasury: treasury.publicKey,
              mint: usdc,
              nonce: 9_101n,
              principal: USD(100),
              collateralLamports: 10n ** 10n,
              creditCertificates: [certAddr],
            }),
          ],
          [borrower],
        );
        expect(logs).to.include("NotCertificateHolder");
      });

      it("prevents double-claiming with the nullifier", async () => {
        const other = h.wallet(1);
        const proof = await proveRepaymentCertificate({
          note: note2,
          loan: witness(loan2),
          leaves,
          minPrincipal: USD(10),
          recipient: other.publicKey,
          wasm: WASM,
          zkey: ZKEY,
        });
        const logs = h.sendExpectFail(await client.claimCertificate(other.publicKey, proof), [other]);
        expect(logs).to.match(/already in use/);
      });

      it("rejects a proof submitted by a different wallet (front-running)", async () => {
        const intended = anon; // the same wallet ends up holding two certificates (credit levels test)
        const thief = h.wallet(1);
        const proof = await proveRepaymentCertificate({
          note,
          loan: witness(loan),
          leaves,
          minPrincipal: USD(100),
          recipient: intended.publicKey,
          wasm: WASM,
          zkey: ZKEY,
        });
        const logs = h.sendExpectFail(await client.claimCertificate(thief.publicKey, proof), [thief]);
        expect(logs).to.include("InvalidProof");

        // inflating the public claim invalidates the proof too
        const inflated = { ...proof, minPrincipal: USD(1_000_000) };
        expect(h.sendExpectFail(await client.claimCertificate(intended.publicKey, inflated), [intended])).to.include("InvalidProof");

        // the honest submission works
        h.send(await client.claimCertificate(intended.publicKey, proof), [intended]);
        secondCert = client.pda.certificate(Uint8Array.from(proof.nullifierHash));
      });

      it("credit levels: two certificates give 7% a year, up to 2x their combined proven amounts", async () => {
        const limit = (USD(1_000) + USD(100)) * 2n;
        const loan = await openLoan({ who: anon, principal: limit, priceUsd: 150, creditCertificates: [certAddr, secondCert] });
        expect(loan.rateBps).to.equal(700);
        expect(loan.creditLevel).to.equal(2);

        h.setPrice(150);
        const open = async (principal: bigint, certificates: PublicKey[], nonce: bigint) =>
          client.openLoan({
            borrower: anon.publicKey,
            treasury: treasury.publicKey,
            mint: usdc,
            nonce,
            principal,
            collateralLamports: requiredCollateralLamports(principal, PRICE(150), PRICE(0.05), -8),
            creditCertificates: certificates,
          });
        expect(h.sendExpectFail([await open(limit + 1n, [certAddr, secondCert], 9_200n)], [anon])).to.include("AboveCreditLimit");
        expect(h.sendExpectFail([await open(USD(100), [certAddr, certAddr], 9_201n)], [anon])).to.include("DuplicateCertificate");
      });

      it("rejects unknown roots", async () => {
        const anon = h.wallet(1);
        const proof = await proveRepaymentCertificate({
          note,
          loan: witness(loan),
          leaves,
          minPrincipal: USD(1),
          recipient: anon.publicKey,
          wasm: WASM,
          zkey: ZKEY,
        });
        // fresh nullifier hash so the certificate PDA is new and the root check is what fails
        const bad = { ...proof, root: Array(32).fill(7), nullifierHash: Array(32).fill(9) };
        expect(h.sendExpectFail(await client.claimCertificate(anon.publicKey, bad), [anon])).to.include("UnknownRoot");
      });

      it("cannot prove a loan that was never repaid (no leaf)", async () => {
        const n = createNote();
        const open = await openLoan({ principal: USD(100), priceUsd: 150, note: n });
        expect(open.creditLeafIndex).to.equal(null);
        let threw = false;
        try {
          await proveRepaymentCertificate({
            note: n,
            loan: { principal: open.principal, totalRepaid: open.totalDue, startTs: open.startTs, closedTs: open.startTs, leafIndex: 0 },
            leaves,
            minPrincipal: 1n,
            recipient: borrower.publicKey,
            wasm: WASM,
            zkey: ZKEY,
          });
        } catch {
          threw = true;
        }
        expect(threw).to.be.true;
      });
    });
  });

  // =========================================================================
  describe("liquidation & default (permissionless, rule-based)", () => {
    it("a healthy loan cannot be liquidated", async () => {
      const loan = await openLoan({ principal: USD(1_000), priceUsd: 150 });
      h.setPrice(150);
      const logs = h.sendExpectFail([await client.liquidate({ caller: keeper.publicKey, loan, treasury: treasury.publicKey })], [keeper]);
      expect(logs).to.include("NotLiquidatable");
    });

    it("settles below the 130% debt threshold and sends ALL collateral to the treasury", async () => {
      const loan = await openLoan({ principal: USD(1_000), priceUsd: 150 });
      h.setPrice(95); // collateral ≈ 2000 * 95/150 ≈ $1267 < $1120 * 1.3 = $1456
      const tBefore = h.lamports(treasury.publicKey);
      const bBefore = h.lamports(borrower.publicKey);
      const escrowLamports = h.lamports(client.pda.escrow(loan.address));

      h.send([await client.liquidate({ caller: keeper.publicKey, loan, treasury: treasury.publicKey })], [keeper]);

      const after = h.loan(loan.address);
      expect(after.status).to.equal("liquidated");
      // all of the SOL goes to the treasury; only the escrow's rent returns to the borrower
      expect(h.lamports(treasury.publicKey) - tBefore).to.equal(loan.collateralLamports);
      expect(h.lamports(borrower.publicKey) - bBefore).to.equal(escrowLamports - loan.collateralLamports);
      expect(h.events().find((e) => e.name === "loanLiquidated")?.data.returnedLamports.toString()).to.equal("0");
    });

    it("settles once SOL falls to 60% of its opening price", async () => {
      // A 101% debt threshold isolates the price rule.
      h.send([await client.updateConfig(admin.publicKey, { liquidationThresholdBps: 10_100 })], [admin]);
      const loan = await openLoan({ principal: USD(1_000), priceUsd: 150 });
      h.send([await client.updateConfig(admin.publicKey, { liquidationThresholdBps: 13_000 })], [admin]);

      h.setPrice(90.01); // 60.007% of the opening price
      const logs = h.sendExpectFail([await client.liquidate({ caller: keeper.publicKey, loan, treasury: treasury.publicKey })], [keeper]);
      expect(logs).to.include("NotLiquidatable");

      h.setPrice(90); // exactly 60%
      const tBefore = h.lamports(treasury.publicKey);
      h.send([await client.liquidate({ caller: keeper.publicKey, loan, treasury: treasury.publicKey })], [keeper]);
      expect(h.loan(loan.address).status).to.equal("liquidated");
      expect(h.lamports(treasury.publicKey) - tBefore).to.equal(loan.collateralLamports);
    });

    it("after the term the loan can't be repaid; on default the treasury gets SOL worth the debt and the rest goes back", async () => {
      const loan = await openLoan({ principal: USD(500), priceUsd: 150 });
      h.warp(LOAN_TERM_SECS + 1);
      h.setPrice(120);
      const logs = h.sendExpectFail(
        [await client.repay({ payer: borrower.publicKey, loan, mint: usdc, amount: USD(1), treasury: treasury.publicKey })],
        [borrower],
      );
      expect(logs).to.include("LoanMatured");

      const tBefore = h.lamports(treasury.publicKey);
      const bBefore = h.lamports(borrower.publicKey);
      const escrowLamports = h.lamports(client.pda.escrow(loan.address));
      h.send([await client.liquidate({ caller: keeper.publicKey, loan, treasury: treasury.publicKey })], [keeper]);
      const after = h.loan(loan.address);
      expect(after.status).to.equal("defaulted");

      // nothing repaid: principal + interest for the whole term, at $120/SOL (rounded up) to the treasury
      const owed = stableToLamports(totalDue(USD(500)), 120_00000000n, -8, true);
      const returned = loan.collateralLamports - owed;
      expect(h.lamports(treasury.publicKey) - tBefore).to.equal(owed);
      expect(h.lamports(borrower.publicKey) - bBefore).to.equal(escrowLamports - owed);
      const ev = h.events().find((e) => e.name === "loanLiquidated")?.data;
      expect(ev.defaulted).to.equal(true);
      expect(ev.seizedLamports.toString()).to.equal(owed.toString());
      expect(ev.returnedLamports.toString()).to.equal(returned.toString());
      expect(defaultSplit(loan.collateralLamports, totalDue(USD(500)), 120_00000000n, -8)).to.deep.equal({ toTreasury: owed, toBorrower: returned });
    });

    it("on default after partial repayments only the remaining debt is taken", async () => {
      const loan = await openLoan({ principal: USD(500), priceUsd: 150 });
      h.setPrice(150);
      const paid = await repay(loan, USD(200));
      h.warp(LOAN_TERM_SECS + 1);
      h.setPrice(150);
      // interest stops at the deadline: principal left + interest on it for the term (at least the minimum)
      const owed = loanDebt(paid, Number(h.now())).owed;
      expect(owed < USD(500)).to.be.true;
      const tBefore = h.lamports(treasury.publicKey);
      h.send([await client.liquidate({ caller: keeper.publicKey, loan, treasury: treasury.publicKey })], [keeper]);
      expect(h.lamports(treasury.publicKey) - tBefore).to.equal(stableToLamports(owed, PRICE(150), -8, true));
      expect(h.events().find((e) => e.name === "loanLiquidated")?.data.outstandingDebt.toString()).to.equal(owed.toString());
    });

    it("on default with SOL worth less than the debt, all of it goes to the treasury", async () => {
      const loan = await openLoan({ principal: USD(500), priceUsd: 150 });
      h.warp(LOAN_TERM_SECS + 1);
      h.setPrice(50); // collateral ≈ 6.73 SOL * $50 ≈ $337 < $560 owed
      const tBefore = h.lamports(treasury.publicKey);
      h.send([await client.liquidate({ caller: keeper.publicKey, loan, treasury: treasury.publicKey })], [keeper]);
      expect(h.lamports(treasury.publicKey) - tBefore).to.equal(loan.collateralLamports);
      expect(h.events().find((e) => e.name === "loanLiquidated")?.data.returnedLamports.toString()).to.equal("0");
    });

    it("adding SOL lowers the seizure price in proportion; an untouched loan keeps the exact 60% line", async () => {
      h.send([await client.updateConfig(admin.publicKey, { liquidationThresholdBps: 10_100 })], [admin]); // isolate the price rule
      const loan = await openLoan({ principal: USD(1_000), priceUsd: 150 });
      h.send([await client.updateConfig(admin.publicKey, { liquidationThresholdBps: 13_000 })], [admin]);
      expect(loan.openingCollateralLamports).to.equal(loan.collateralLamports);

      const locked = h.config().stats.collateralLockedLamports;
      const escrow = h.lamports(client.pda.escrow(loan.address));
      h.send([await client.addCollateral(borrower.publicKey, loan.address, loan.collateralLamports)], [borrower]); // double it
      const topped = h.loan(loan.address);
      expect(topped.collateralLamports).to.equal(loan.collateralLamports * 2n);
      expect(topped.openingCollateralLamports).to.equal(loan.collateralLamports);
      expect(h.lamports(client.pda.escrow(loan.address)) - escrow).to.equal(loan.collateralLamports);
      expect(h.config().stats.collateralLockedLamports - locked).to.equal(loan.collateralLamports);
      expect(h.events().find((e) => e.name === "collateralAdded")).to.exist;

      // the line halves: 60% of $150 = $90 before, $45 now
      const settle = async () => client.liquidate({ caller: keeper.publicKey, loan: topped, treasury: treasury.publicKey });
      h.setPrice(90);
      expect(h.sendExpectFail([await settle()], [keeper])).to.include("NotLiquidatable");
      h.setPrice(45.01);
      expect(h.sendExpectFail([await settle()], [keeper])).to.include("NotLiquidatable");
      h.setPrice(45);
      const tBefore = h.lamports(treasury.publicKey);
      h.send([await settle()], [keeper]);
      expect(h.loan(loan.address).status).to.equal("liquidated");
      expect(h.lamports(treasury.publicKey) - tBefore).to.equal(topped.collateralLamports);
    });

    it("repaying principal lowers the seizure price too", async () => {
      h.send([await client.updateConfig(admin.publicKey, { liquidationThresholdBps: 10_100 })], [admin]);
      const loan = await openLoan({ principal: USD(1_000), priceUsd: 150 });
      h.send([await client.updateConfig(admin.publicKey, { liquidationThresholdBps: 13_000 })], [admin]);
      const paid = await repay(loan, USD(600));
      expect(paid.principalRepaid > USD(500)).to.be.true;
      h.setPrice(90); // would seize an untouched loan
      const logs = h.sendExpectFail([await client.liquidate({ caller: keeper.publicKey, loan: paid, treasury: treasury.publicKey })], [keeper]);
      expect(logs).to.include("NotLiquidatable");
    });

    it("SOL can't be added after the deadline", async () => {
      const loan = await openLoan({ principal: USD(100), priceUsd: 150 });
      h.warp(LOAN_TERM_SECS + 1);
      const logs = h.sendExpectFail([await client.addCollateral(borrower.publicKey, loan.address, 1_000_000n)], [borrower]);
      expect(logs).to.include("LoanMatured");
    });

    it("rejects a forged borrower account on settlement", async () => {
      h.setPrice(150);
      const loan = await openLoan({ principal: USD(100), priceUsd: 150 });
      h.warp(LOAN_TERM_SECS + 1);
      h.setPrice(150);
      const logs = h.sendExpectFail(
        [await client.liquidate({ caller: keeper.publicKey, loan: { ...loan, borrower: keeper.publicKey }, treasury: treasury.publicKey })],
        [keeper],
      );
      expect(logs).to.include("ConstraintHasOne");
    });
  });

  // =========================================================================
  describe("two oracles: Pyth + Chainlink", () => {
    it("values collateral at the lower of the two when a loan opens", async () => {
      h.setPrice(150);
      h.setChainlinkPrice(140);
      // Enough at Pyth's $150, not at Chainlink's $140.
      const atPyth = requiredCollateralLamports(USD(1_000), PRICE(150), PRICE(0.05), -8);
      const logs = h.sendExpectFail(
        [
          await client.openLoan({
            borrower: borrower.publicKey,
            treasury: treasury.publicKey,
            mint: usdc,
            nonce: 9_000n,
            principal: USD(1_000),
            collateralLamports: atPyth,
          }),
        ],
        [borrower],
      );
      expect(logs).to.include("InsufficientCollateral");

      const atChainlink = requiredCollateralLamports(USD(1_000), PRICE(140), 0n, -8);
      const loan = await openLoan({ principal: USD(1_000), priceUsd: 150, chainlinkUsd: 140, collateral: atChainlink });
      expect(loan.openPrice).to.equal(PRICE(140)); // the 60% rule is measured from the lower price
    });

    it("seizes on a price drop only when both oracles show it", async () => {
      h.send([await client.updateConfig(admin.publicKey, { liquidationThresholdBps: 10_100 })], [admin]);
      const loan = await openLoan({ principal: USD(1_000), priceUsd: 150 });
      h.send([await client.updateConfig(admin.publicKey, { liquidationThresholdBps: 13_000 })], [admin]);

      h.setPrice(90); // Pyth at 60%…
      h.setChainlinkPrice(100); // …but Chainlink isn't
      let logs = h.sendExpectFail([await client.liquidate({ caller: keeper.publicKey, loan, treasury: treasury.publicKey })], [keeper]);
      expect(logs).to.include("NotLiquidatable");

      h.setPrice(100);
      h.setChainlinkPrice(90); // and the other way round
      logs = h.sendExpectFail([await client.liquidate({ caller: keeper.publicKey, loan, treasury: treasury.publicKey })], [keeper]);
      expect(logs).to.include("NotLiquidatable");

      h.setPrice(90); // both at 60%
      const tBefore = h.lamports(treasury.publicKey);
      h.send([await client.liquidate({ caller: keeper.publicKey, loan, treasury: treasury.publicKey })], [keeper]);
      expect(h.loan(loan.address).status).to.equal("liquidated");
      expect(h.lamports(treasury.publicKey) - tBefore).to.equal(loan.collateralLamports);
    });

    it("on default the treasury's share is priced at the higher of the two", async () => {
      const loan = await openLoan({ principal: USD(500), priceUsd: 150 });
      h.warp(LOAN_TERM_SECS + 1);
      h.setPrice(120);
      h.setChainlinkPrice(100);
      const tBefore = h.lamports(treasury.publicKey);
      h.send([await client.liquidate({ caller: keeper.publicKey, loan, treasury: treasury.publicKey })], [keeper]);
      // $560 at $120 (not $100)
      expect(h.lamports(treasury.publicKey) - tBefore).to.equal(stableToLamports(totalDue(USD(500)), PRICE(120), -8, true));
    });

    it("rejects a stale Chainlink price", async () => {
      const loan = await openLoan({ principal: USD(100), priceUsd: 150 });
      h.warp(LOAN_TERM_SECS + 1);
      h.setPrice(150);
      h.setChainlinkPrice(150, { ageSecs: 4_000 });
      const logs = h.sendExpectFail([await client.liquidate({ caller: keeper.publicKey, loan, treasury: treasury.publicKey })], [keeper]);
      expect(logs).to.include("StaleChainlinkPrice");
    });

    it("rejects a Chainlink feed account not owned by the Chainlink store program", async () => {
      h.setPrice(150);
      h.setChainlinkPrice(150, { owner: keeper.publicKey });
      const logs = h.sendExpectFail(
        [
          await client.openLoan({
            borrower: borrower.publicKey,
            treasury: treasury.publicKey,
            mint: usdc,
            nonce: 9_001n,
            principal: USD(100),
            collateralLamports: 10n ** 10n,
          }),
        ],
        [borrower],
      );
      expect(logs).to.include("InvalidChainlinkFeed");
      h.setPrice(150);
    });

    it("SDK reads the Chainlink feed layout the program reads", () => {
      const parsed = parseChainlinkFeed(encodeChainlinkFeed({ price: 10_959_636_090n, timestamp: 1_791_730_090 }));
      expect(parsed).to.deep.equal({ description: "SOL / USD", roundId: 1, price: 10_959_636_090n, expo: -8, timestamp: 1_791_730_090 });
    });
  });

  // =========================================================================
  describe("lending pool: depositors fund loans and earn the interest", () => {
    const lenderA = h.wallet(10);
    const lenderB = h.wallet(10);
    const pool = () => client.decodePool(client.pda.pool(usdc), h.svm.getAccount(client.pda.pool(usdc))!.data);
    const position = (owner: Keypair) => {
      const a = client.pda.lender(usdc, owner.publicKey);
      return client.decodeLenderPosition(a, h.svm.getAccount(a)!.data);
    };
    const deposit = async (owner: Keypair, amount: bigint) => {
      h.mintTo(usdc, admin, owner.publicKey, amount);
      h.send([await client.deposit(owner.publicKey, usdc, amount)], [owner]);
    };
    let poolLoan: LoanAccount;

    it("only the admin can create a pool", async () => {
      expect(h.sendExpectFail([await client.initPool(keeper.publicKey, usdc)], [keeper])).to.include("ConstraintHasOne");
      h.send([await client.initPool(admin.publicKey, usdc)], [admin]);
      expect(pool().cash).to.equal(0n);
    });

    it("deposits mint shares at the pool's value; tokens sent straight to the vault change nothing", async () => {
      await deposit(lenderA, USD(1_000));
      expect(position(lenderA).shares).to.equal(USD(1_000));
      expect(pool().cash).to.equal(USD(1_000));

      // the classic share-inflation attack: send tokens straight to the vault
      const before = pool();
      const donor = h.mintTo(usdc, admin, keeper.publicKey, USD(500));
      h.send([createTransferInstruction(donor, client.pda.poolVault(usdc), keeper.publicKey, USD(500))], [keeper]);
      expect(pool()).to.deep.equal(before);

      await deposit(lenderB, USD(1_000));
      expect(position(lenderB).shares).to.equal(USD(1_000)); // same price per share as lender A
    });

    it("funds new loans from the pool first, leaving the treasury untouched", async () => {
      const source = payoutSource(usdc);
      poolLoan = await openLoan({ principal: USD(1_500), priceUsd: 150, pool: true });
      expect(poolLoan.fromPool).to.be.true;
      expect(payoutSource(usdc)).to.deep.equal(source);
      expect(pool().cash).to.equal(USD(500));
      expect(pool().principalOut).to.equal(USD(1_500));
      expect(h.events().find((e) => e.name === "loanOpened")?.data.fromPool).to.be.true;
    });

    it("falls back to the treasury when the pool can't cover a loan", async () => {
      const source = payoutSource(usdc);
      const loan = await openLoan({ principal: USD(800), priceUsd: 150, pool: true }); // the pool has 500
      expect(loan.fromPool).to.be.false;
      expect(source.balance - payoutSource(usdc).balance).to.equal(USD(800));
      expect(pool().cash).to.equal(USD(500));
    });

    it("withdrawals are limited to cash that isn't lent out, and to your shares", async () => {
      expect(h.sendExpectFail([await client.withdraw(lenderA.publicKey, usdc, USD(600))], [lenderA])).to.include("InsufficientPoolLiquidity");
      const before = h.tokenBalance(usdc, lenderA.publicKey);
      h.send([await client.withdraw(lenderA.publicKey, usdc, USD(200))], [lenderA]);
      expect(h.tokenBalance(usdc, lenderA.publicKey) - before).to.equal(USD(200));
      expect(h.sendExpectFail([await client.withdraw(lenderA.publicKey, usdc, USD(900))], [lenderA])).to.include("InsufficientShares");
    });

    it("a pool-funded loan must be repaid in its own coin", async () => {
      const logs = h.sendExpectFail(
        [await client.repay({ payer: borrower.publicKey, loan: poolLoan, mint: usdt, amount: USD(10), treasury: treasury.publicKey })],
        [borrower],
      );
      expect(logs).to.match(/RepayInLoanCoin|AccountNotInitialized|ConstraintSeeds/);
    });

    it("repayments go back to the pool: depositors earn the interest, minus the protocol fee", async () => {
      h.warp(Math.floor(T / 2));
      const debt = loanDebt(poolLoan, Number(h.now()));
      const fee = (debt.interest * PROTOCOL_FEE_BPS) / BPS;
      const before = pool();
      const treasuryBefore = h.tokenBalance(usdc, treasury.publicKey);
      h.mintTo(usdc, admin, borrower.publicKey, debt.owed);
      const repaid = await repay(poolLoan, debt.owed);
      expect(repaid.status).to.equal("repaid");

      expect(h.tokenBalance(usdc, treasury.publicKey) - treasuryBefore).to.equal(fee);
      const after = pool();
      expect(after.cash - before.cash).to.equal(debt.owed - fee);
      expect(after.principalOut).to.equal(0n);
      expect(after.interestEarned - before.interestEarned).to.equal(debt.interest - fee);

      // lender B never withdrew: their share is now worth more than they put in
      const value = positionValue(after, position(lenderB).shares);
      expect(value > USD(1_000)).to.be.true;
      const walletBefore = h.tokenBalance(usdc, lenderB.publicKey);
      h.send([await client.withdraw(lenderB.publicKey, usdc, position(lenderB).shares)], [lenderB]);
      expect(h.tokenBalance(usdc, lenderB.publicKey) - walletBefore).to.equal(value);
      expect(position(lenderB).shares).to.equal(0n);
    });

    it("a defaulted pool loan is bought out by the treasury, so depositors are repaid in full", async () => {
      const lenderC = h.wallet(10);
      await deposit(lenderC, USD(2_000));
      const loan = await openLoan({ principal: USD(1_000), priceUsd: 150, pool: true });
      expect(loan.fromPool).to.be.true;
      h.warp(LOAN_TERM_SECS + 1);
      h.setPrice(150);
      const owed = loanDebt(loan, Number(h.now())).owed;

      // the buy-out needs the treasury's approval
      h.send([client.approvePayouts(treasury.publicKey, usdc, 0n)], [treasury]);
      const logs = h.sendExpectFail([await client.liquidate({ caller: keeper.publicKey, loan, treasury: treasury.publicKey })], [keeper]);
      expect(logs).to.include("PoolBackstopUnfunded");
      h.send([client.approvePayouts(treasury.publicKey, usdc, USD(600_000))], [treasury]);

      const before = pool();
      const treasuryUsdc = h.tokenBalance(usdc, treasury.publicKey);
      const treasurySol = h.lamports(treasury.publicKey);
      h.send([await client.liquidate({ caller: keeper.publicKey, loan, treasury: treasury.publicKey })], [keeper]);
      expect(h.loan(loan.address).status).to.equal("defaulted");
      expect(pool().cash - before.cash).to.equal(owed);
      expect(pool().principalOut).to.equal(before.principalOut - USD(1_000));
      expect(treasuryUsdc - h.tokenBalance(usdc, treasury.publicKey)).to.equal(owed);
      // the treasury takes SOL worth what was owed; the rest goes back to the borrower as usual
      expect(h.lamports(treasury.publicKey) - treasurySol).to.equal(stableToLamports(owed, PRICE(150), -8, true));
      expect(h.events().find((e) => e.name === "poolLoanBoughtOut")?.data.amount.toString()).to.equal(owed.toString());
    });
  });

  // =========================================================================
  describe("protocol accounting", () => {
    it("pause blocks new loans", async () => {
      h.send([await client.updateConfig(admin.publicKey, { paused: true })], [admin]);
      h.setPrice(150);
      const logs = h.sendExpectFail(
        [
          await client.openLoan({
            borrower: borrower.publicKey,
            treasury: treasury.publicKey,
            mint: usdc,
            nonce: 5_000n,
            principal: USD(100),
            collateralLamports: 10n ** 10n,
          }),
        ],
        [borrower],
      );
      expect(logs).to.include("Paused");
      h.send([await client.updateConfig(admin.publicKey, { paused: false })], [admin]);
    });

    it("admin can withdraw idle reserve liquidity", async () => {
      const dest = h.mintTo(usdc, admin, admin.publicKey, 0n);
      const before = h.tokenAccountBalance(dest);
      h.send([await client.withdrawReserve(admin.publicKey, usdc, USD(1_000), dest)], [admin]);
      expect(h.tokenAccountBalance(dest) - before).to.equal(USD(1_000));
    });

    it("public stats reconcile with individual loan accounts", () => {
      const cfg = h.config();
      const loans = opened.map((a) => h.loan(a));
      const active = loans.filter((l) => l.status === "active");
      expect(cfg.stats.loansOpened).to.equal(BigInt(loans.length));
      expect(cfg.stats.activeLoans).to.equal(BigInt(active.length));
      // outstanding_debt tracks principal still owed; interest accrues per loan on top
      expect(cfg.stats.outstandingDebt).to.equal(active.reduce((s, l) => s + l.principal - l.principalRepaid, 0n));
      expect(cfg.stats.collateralLockedLamports).to.equal(active.reduce((s, l) => s + l.collateralLamports, 0n));
      // every active loan's escrow holds exactly its collateral + rent
      const rent = h.svm.minimumBalanceForRentExemption(8n + 33n);
      for (const l of active) expect(h.lamports(client.pda.escrow(l.address))).to.equal(l.collateralLamports + rent);
      expect(LoomClient.creditLeaves(loans)).to.have.length(2);
    });
  });
});
