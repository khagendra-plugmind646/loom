import { expect } from "chai";
import { CreditMerkleTree, createNote, toBytes32, type CertificateProof } from "@loom/sdk";
import { TX_FEE, USD, createWorld, type World } from "./fixtures";

const CREDIT_TREE_DEPTH = 20;
const CREDIT_ROOT_HISTORY = 32;

/** A syntactically valid claim with a garbage proof: the program checks the root before the proof. */
const garbageClaim = (root: bigint, nullifierSeed: number): CertificateProof => ({
  proofA: Array(64).fill(1),
  proofB: Array(128).fill(1),
  proofC: Array(64).fill(1),
  root: [...toBytes32(root)],
  nullifierHash: Array(32).fill(nullifierSeed),
  minPrincipal: 1n,
  publicSignals: [],
});

describe("credit tree", () => {
  let w: World;
  beforeEach(async () => {
    w = await createWorld();
    w.fund(w.usdc, w.borrower.publicKey, USD(100_000));
  });

  /** Opens and fully repays a loan with a fresh identity commitment; returns its leaf. */
  const repaidLeaf = async () => {
    const loan = await w.openLoan({ principal: USD(10), note: createNote() });
    return (await w.repay(loan, USD(100))).creditLeaf;
  };

  it("starts as the empty Poseidon tree", () => {
    expect(w.h.creditTree()).to.deep.equal({ root: new CreditMerkleTree().root, nextIndex: 0n });
  });

  it("tracks the off-chain mirror leaf by leaf", async () => {
    const leaves: bigint[] = [];
    for (let i = 0; i < 5; i++) {
      leaves.push(await repaidLeaf());
      expect(w.h.creditTree().root).to.equal(new CreditMerkleTree(leaves).root);
    }
  });

  it("a full tree never blocks repayment: collateral is still released, just without a leaf", async () => {
    w.setCreditTreeNextIndex(2n ** BigInt(CREDIT_TREE_DEPTH));
    expect(w.h.creditTree().nextIndex).to.equal(2n ** 20n);
    const before = w.h.creditTree();
    const loan = await w.openLoan({ principal: USD(100), note: createNote() });
    const escrow = w.escrowLamports(loan.address);
    const sol = w.h.lamports(w.borrower.publicKey);
    const l = await w.repay(loan, USD(1_000));
    expect(l.status).to.equal("repaid");
    expect(l.creditLeafIndex).to.equal(null);
    expect(w.h.lamports(w.borrower.publicKey) - sol).to.equal(escrow - TX_FEE);
    expect(w.h.creditTree()).to.deep.equal(before);
    expect(w.h.events().some((e) => e.name === "creditLeafInserted")).to.be.false;
  });

  describe("root history (claims may use any of the last 32 roots)", () => {
    it("rejects the all-zero root even though unused history slots are zero", async () => {
      w.fails(await w.client.claimCertificate(w.keeper.publicKey, garbageClaim(0n, 1)), [w.keeper], "UnknownRoot");
    });

    it("rejects a root that was never on-chain", async () => {
      w.fails(await w.client.claimCertificate(w.keeper.publicKey, garbageClaim(12345n, 1)), [w.keeper], "UnknownRoot");
    });

    it("accepts the current root (the proof is then checked)", async () => {
      await repaidLeaf();
      w.fails(await w.client.claimCertificate(w.keeper.publicKey, garbageClaim(w.h.creditTree().root, 1)), [w.keeper], "InvalidProof");
    });

    it("keeps exactly the last 32 roots", async () => {
      const roots = [w.h.creditTree().root]; // the empty root, roots[0]
      for (let i = 0; i < CREDIT_ROOT_HISTORY; i++) {
        await repaidLeaf();
        roots.push(w.h.creditTree().root);
      }
      // 32 inserts later: roots[1..=32] are known, the empty root has been overwritten
      w.fails(await w.client.claimCertificate(w.keeper.publicKey, garbageClaim(roots[0], 1)), [w.keeper], "UnknownRoot");
      w.fails(await w.client.claimCertificate(w.keeper.publicKey, garbageClaim(roots[1], 2)), [w.keeper], "InvalidProof");
      w.fails(await w.client.claimCertificate(w.keeper.publicKey, garbageClaim(roots[32], 3)), [w.keeper], "InvalidProof");
    });
  });
});
