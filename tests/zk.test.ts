import { expect } from "chai";
import { Keypair } from "@solana/web3.js";
import {
  CREDIT_INTEREST_BPS,
  CreditMerkleTree,
  LOAN_TERM_SECS,
  buildCertificateInput,
  createNote,
  fromBytes32,
  nullifierHash,
  toBytes32,
  type CertificateProof,
  type CreditNote,
  type LoanAccount,
} from "@loom/sdk";
import { groth16, proveRepaymentCertificate } from "@loom/sdk/prover";
import { USD, createWorld, type World } from "./fixtures";

const WASM = "zk/build/repayment_certificate_js/repayment_certificate.wasm";
const ZKEY = "zk/build/repayment_certificate.zkey";

/**
 * Real Groth16 proofs verified on-chain. Every test gets a fresh world with two repaid loans
 * (A: $5,000, B: $300), so no test depends on another's claims.
 */
describe("zk: repayment certificates", function () {
  this.timeout(120_000);
  let w: World;
  let noteA: CreditNote;
  let noteB: CreditNote;
  let loanA: LoanAccount;
  let loanB: LoanAccount;
  let rootAfterA: bigint;

  const witness = (l: LoanAccount) => ({ principal: l.principal, totalRepaid: l.repaid, startTs: l.startTs, closedTs: l.closedTs, leafIndex: Number(l.creditLeafIndex) });
  const leaves = () => [loanA.creditLeaf, loanB.creditLeaf];
  const prove = (note: CreditNote, loan: LoanAccount, recipient: Keypair, minPrincipal: bigint, treeLeaves = leaves()) =>
    proveRepaymentCertificate({ note, loan: witness(loan), leaves: treeLeaves, minPrincipal, recipient: recipient.publicKey, wasm: WASM, zkey: ZKEY });
  const certAddress = (p: CertificateProof) => w.client.pda.certificate(Uint8Array.from(p.nullifierHash));

  beforeEach(async () => {
    w = await createWorld();
    w.fund(w.usdc, w.borrower.publicKey, USD(10_000));
    noteA = createNote();
    noteB = createNote();
    loanA = await w.openLoan({ principal: USD(5_000), note: noteA });
    w.h.warp(86_400 * 40);
    loanA = await w.repay(loanA, USD(10_000));
    rootAfterA = w.h.creditTree().root;
    loanB = await w.openLoan({ principal: USD(300), note: noteB });
    w.h.warp(86_400 * 3);
    loanB = await w.repay(loanB, USD(1_000));
    expect(w.h.creditTree().root).to.equal(new CreditMerkleTree(leaves()).root);
  });

  it("a fresh wallet claims a certificate: fields, stats and event", async () => {
    const anon = w.h.wallet(1);
    const proof = await prove(noteA, loanA, anon, USD(1_000));
    w.h.send(await w.client.claimCertificate(anon.publicKey, proof), [anon]);
    console.log(`      groth16 verification: ${w.h.lastComputeUnits} CU`);
    expect(Number(w.h.lastComputeUnits)).to.be.below(600_000); // the SDK's compute budget

    const address = certAddress(proof);
    const cert = w.client.decodeCertificate(address, w.h.svm.getAccount(address)!.data);
    expect(cert.holder.equals(anon.publicKey)).to.be.true;
    expect(cert.minPrincipal).to.equal(USD(1_000));
    expect(cert.nullifierHash).to.equal(nullifierHash(noteA));
    expect(cert.root).to.equal(w.h.creditTree().root);
    expect(cert.issuedAt).to.equal(w.h.now());
    expect(w.h.config().stats.certificatesIssued).to.equal(1n);

    const ev = w.event("certificateIssued");
    expect(ev.certificate.equals(address)).to.be.true;
    expect(ev.holder.equals(anon.publicKey)).to.be.true;
    expect(ev.minPrincipal.toString()).to.equal(USD(1_000).toString());
  });

  it("nothing in the certificate links it to the borrower or the loan", async () => {
    const anon = w.h.wallet(1);
    const proof = await prove(noteA, loanA, anon, USD(1_000));
    w.h.send(await w.client.claimCertificate(anon.publicKey, proof), [anon]);
    const raw = Buffer.from(w.h.svm.getAccount(certAddress(proof))!.data);
    expect(raw.includes(w.borrower.publicKey.toBuffer())).to.be.false;
    expect(raw.includes(loanA.address.toBuffer())).to.be.false;
    expect(raw.includes(Buffer.from(toBytes32(loanA.creditLeaf)))).to.be.false;
  });

  it("a claimed certificate unlocks the credit rate for its wallet (end to end)", async () => {
    const anon = w.h.wallet(1_000);
    const proof = await prove(noteA, loanA, anon, USD(1_000));
    w.h.send(await w.client.claimCertificate(anon.publicKey, proof), [anon]);
    const loan = await w.openLoan({ principal: USD(2_000), who: anon, creditCertificates: [certAddress(proof)] });
    expect(loan.rateBps).to.equal(Number(CREDIT_INTEREST_BPS));
  });

  it("minPrincipal may equal the loan's principal", async () => {
    const anon = w.h.wallet(1);
    const proof = await prove(noteB, loanB, anon, USD(300));
    w.h.send(await w.client.claimCertificate(anon.publicKey, proof), [anon]);
    expect(w.client.decodeCertificate(certAddress(proof), w.h.svm.getAccount(certAddress(proof))!.data).minPrincipal).to.equal(USD(300));
  });

  it("each loan yields one certificate: a second claim is refused (nullifier), whoever submits it", async () => {
    const first = w.h.wallet(1);
    const second = w.h.wallet(1);
    w.h.send(await w.client.claimCertificate(first.publicKey, await prove(noteB, loanB, first, USD(100))), [first]);
    const again = await prove(noteB, loanB, second, USD(10));
    expect(w.h.sendExpectFail(await w.client.claimCertificate(second.publicKey, again), [second])).to.match(/already in use/);
    // a different loan of the same borrower can still be claimed
    w.h.send(await w.client.claimCertificate(second.publicKey, await prove(noteA, loanA, second, USD(10))), [second]);
  });

  it("a proof is bound to its recipient: another wallet can't submit it (no front-running)", async () => {
    const intended = w.h.wallet(1);
    const thief = w.h.wallet(1);
    const proof = await prove(noteB, loanB, intended, USD(50));
    w.fails(await w.client.claimCertificate(thief.publicKey, proof), [thief], "InvalidProof");
    w.h.send(await w.client.claimCertificate(intended.publicKey, proof), [intended]);
  });

  it("tampering with any public input or the proof invalidates it", async () => {
    const anon = w.h.wallet(1);
    const proof = await prove(noteA, loanA, anon, USD(1_000));
    const flipped = (bytes: number[]) => bytes.map((b, i) => (i === 40 ? b ^ 1 : b));
    for (const forged of [
      { ...proof, minPrincipal: USD(5_000) },
      { ...proof, nullifierHash: [...toBytes32(nullifierHash(noteB) + 1n)] },
      { ...proof, root: [...toBytes32(rootAfterA)] }, // a known root, but not the one proven
      { ...proof, proofA: flipped(proof.proofA) },
      { ...proof, proofB: flipped(proof.proofB) },
      { ...proof, proofC: flipped(proof.proofC) },
    ]) {
      w.fails(await w.client.claimCertificate(anon.publicKey, forged), [anon], "InvalidProof");
    }
    w.h.send(await w.client.claimCertificate(anon.publicKey, proof), [anon]); // the honest one still works
  });

  it("a proof against an older root (still in the history) is accepted", async () => {
    const anon = w.h.wallet(1);
    const proof = await prove(noteA, loanA, anon, USD(10), [loanA.creditLeaf]); // the tree right after loan A
    expect(fromBytes32(proof.root)).to.equal(rootAfterA);
    expect(rootAfterA).to.not.equal(w.h.creditTree().root);
    w.h.send(await w.client.claimCertificate(anon.publicKey, proof), [anon]);
  });

  it("rejects a root that was never on-chain before checking the proof", async () => {
    const anon = w.h.wallet(1);
    const proof = await prove(noteA, loanA, anon, USD(10));
    w.fails(await w.client.claimCertificate(anon.publicKey, { ...proof, root: Array(32).fill(7), nullifierHash: Array(32).fill(9) }), [anon], "UnknownRoot");
  });

  it("the circuit itself refuses minPrincipal above the loan's principal", async () => {
    const { input } = buildCertificateInput({ note: noteB, loan: witness(loanB), leaves: leaves(), minPrincipal: USD(300), recipient: Keypair.generate().publicKey });
    let threw = false;
    try {
      await groth16.fullProve({ ...input, minPrincipal: (USD(300) + 1n).toString() }, WASM, ZKEY);
    } catch {
      threw = true;
    }
    expect(threw).to.be.true;
  });

  it("the SDK refuses to build a proof for the wrong note or too high a minimum", () => {
    const recipient = Keypair.generate().publicKey;
    expect(() => buildCertificateInput({ note: createNote(), loan: witness(loanA), leaves: leaves(), minPrincipal: 1n, recipient })).to.throw(/leaf mismatch/);
    expect(() => buildCertificateInput({ note: noteA, loan: witness(loanA), leaves: leaves(), minPrincipal: USD(5_000) + 1n, recipient })).to.throw(/minPrincipal/);
  });

  it("unrepaid and settled loans never enter the tree, so they can't be proven", async () => {
    const open = await w.openLoan({ principal: USD(100), note: createNote() });
    expect(open.creditLeafIndex).to.equal(null);
    const settled = await w.openLoan({ principal: USD(100), note: createNote() });
    w.h.warp(LOAN_TERM_SECS + 1);
    w.h.setPrice(150);
    expect((await w.liquidate(settled)).creditLeafIndex).to.equal(null);
    expect(w.h.creditTree().nextIndex).to.equal(2n);
  });
});
