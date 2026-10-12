import { PublicKey } from "@solana/web3.js";
import { poseidon1, poseidon2, poseidon5 } from "poseidon-lite";
import { fromBytes32, toBytes32 } from "./bytes";
import { CREDIT_TREE_DEPTH } from "./constants";

/** BN254 scalar field (circuit field). */
export const FR = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
/** BN254 base field (curve coordinates). */
export const FQ = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;

// ---------------------------------------------------------------------------
// encoding helpers
// ---------------------------------------------------------------------------
export { fromBytes32, toBytes32 } from "./bytes";

function randomFieldElement(): bigint {
  const bytes = new Uint8Array(31); // 248 bits < FR
  crypto.getRandomValues(bytes);
  return fromBytes32(bytes);
}

// ---------------------------------------------------------------------------
// Credit note — the borrower's private key material for one loan.
// ---------------------------------------------------------------------------
export interface CreditNote {
  secret: bigint;
  nullifier: bigint;
}

export const createNote = (): CreditNote => ({ secret: randomFieldElement(), nullifier: randomFieldElement() });
export const identityCommitment = (n: CreditNote) => poseidon2([n.secret, n.nullifier]);
export const nullifierHash = (n: CreditNote) => poseidon1([n.nullifier]);

const NOTE_PREFIX = "loom-note-v1";
export const encodeNote = (n: CreditNote) =>
  `${NOTE_PREFIX}:${n.secret.toString(16).padStart(62, "0")}:${n.nullifier.toString(16).padStart(62, "0")}`;

export function decodeNote(s: string): CreditNote {
  const [prefix, secret, nullifier] = s.trim().split(":");
  if (prefix !== NOTE_PREFIX || !secret || !nullifier) throw new Error("invalid Loom credit note");
  return { secret: BigInt("0x" + secret), nullifier: BigInt("0x" + nullifier) };
}

/** Must match programs/loom/src/merkle.rs::credit_leaf and the circuit. */
export const creditLeaf = (identity: bigint, principal: bigint, totalRepaid: bigint, startTs: bigint, closedTs: bigint) =>
  poseidon5([identity, principal, totalRepaid, startTs, closedTs]);

// ---------------------------------------------------------------------------
// Off-chain mirror of the on-chain incremental Poseidon Merkle tree.
// ---------------------------------------------------------------------------
export class CreditMerkleTree {
  readonly zeros: bigint[];
  private layers: bigint[][];

  constructor(leaves: bigint[] = [], readonly depth = CREDIT_TREE_DEPTH) {
    this.zeros = [0n];
    for (let i = 1; i <= depth; i++) this.zeros.push(poseidon2([this.zeros[i - 1], this.zeros[i - 1]]));
    this.layers = [leaves.slice()];
    this.rebuild();
  }

  private rebuild() {
    for (let level = 0; level < this.depth; level++) {
      const cur = this.layers[level];
      const next: bigint[] = [];
      for (let i = 0; i < cur.length; i += 2) {
        next.push(poseidon2([cur[i], i + 1 < cur.length ? cur[i + 1] : this.zeros[level]]));
      }
      this.layers[level + 1] = next;
    }
  }

  get root(): bigint {
    return this.layers[this.depth][0] ?? this.zeros[this.depth];
  }

  path(index: number): { pathElements: bigint[]; pathIndices: number[] } {
    if (index < 0 || index >= this.layers[0].length) throw new Error("leaf index out of range");
    const pathElements: bigint[] = [];
    const pathIndices: number[] = [];
    let idx = index;
    for (let level = 0; level < this.depth; level++) {
      const sibling = idx ^ 1;
      pathElements.push(this.layers[level][sibling] ?? this.zeros[level]);
      pathIndices.push(idx & 1);
      idx >>= 1;
    }
    return { pathElements, pathIndices };
  }
}

// ---------------------------------------------------------------------------
// Proof generation
// ---------------------------------------------------------------------------
export function pubkeyToFields(key: PublicKey): [bigint, bigint] {
  const b = key.toBytes();
  return [fromBytes32(b.subarray(0, 16)), fromBytes32(b.subarray(16, 32))];
}

export interface RepaidLoanWitness {
  principal: bigint;
  totalRepaid: bigint;
  startTs: bigint;
  closedTs: bigint;
  leafIndex: number;
}

export interface CertificateProof {
  proofA: number[];
  proofB: number[];
  proofC: number[];
  root: number[];
  nullifierHash: number[];
  minPrincipal: bigint;
  publicSignals: string[];
}

export type SnarkjsProof = { pi_a: string[]; pi_b: string[][]; pi_c: string[] };

/** Converts a snarkjs Groth16 proof into the byte layout `groth16-solana` expects. */
export function proofToSolana(proof: SnarkjsProof) {
  const g1 = (x: string, y: string) => [...toBytes32(BigInt(x)), ...toBytes32(BigInt(y))];
  // A is negated: (x, -y)
  const ay = BigInt(proof.pi_a[1]);
  const proofA = [...toBytes32(BigInt(proof.pi_a[0])), ...toBytes32((FQ - ay) % FQ)];
  const proofB = [
    ...toBytes32(BigInt(proof.pi_b[0][1])),
    ...toBytes32(BigInt(proof.pi_b[0][0])),
    ...toBytes32(BigInt(proof.pi_b[1][1])),
    ...toBytes32(BigInt(proof.pi_b[1][0])),
  ];
  const proofC = g1(proof.pi_c[0], proof.pi_c[1]);
  return { proofA, proofB, proofC };
}

export type CircuitInput = Record<string, string | string[]>;

/** Builds the circuit witness input for a repayment certificate (no proving). */
export function buildCertificateInput(params: {
  note: CreditNote;
  loan: RepaidLoanWitness;
  leaves: bigint[];
  minPrincipal: bigint;
  recipient: PublicKey;
}): { input: CircuitInput; root: bigint; nullifierHash: bigint } {
  const { note, loan, leaves, minPrincipal, recipient } = params;
  const identity = identityCommitment(note);
  const leaf = creditLeaf(identity, loan.principal, loan.totalRepaid, loan.startTs, loan.closedTs);
  if (leaves[loan.leafIndex] !== leaf) throw new Error("credit leaf mismatch — wrong note or loan");
  if (loan.principal < minPrincipal) throw new Error("minPrincipal exceeds the loan principal");

  const tree = new CreditMerkleTree(leaves);
  const { pathElements, pathIndices } = tree.path(loan.leafIndex);
  const [recipientHi, recipientLo] = pubkeyToFields(recipient);
  const nHash = nullifierHash(note);

  return {
    root: tree.root,
    nullifierHash: nHash,
    input: {
      root: tree.root.toString(),
      nullifierHash: nHash.toString(),
      minPrincipal: minPrincipal.toString(),
      recipientHi: recipientHi.toString(),
      recipientLo: recipientLo.toString(),
      secret: note.secret.toString(),
      nullifier: note.nullifier.toString(),
      principal: loan.principal.toString(),
      totalRepaid: loan.totalRepaid.toString(),
      startTs: loan.startTs.toString(),
      closedTs: loan.closedTs.toString(),
      pathElements: pathElements.map(String),
      pathIndices: pathIndices.map(String),
    },
  };
}

/** Minimal shape of `snarkjs.groth16` — Node passes the module, the browser passes `window.snarkjs.groth16`. */
export interface Groth16Prover {
  fullProve(input: CircuitInput, wasm: string, zkey: string): Promise<{ proof: SnarkjsProof; publicSignals: string[] }>;
}

/**
 * Generates a repayment-certificate proof.
 * @param leaves all credit leaves in on-chain insertion order
 * @param wasm / zkey: file paths (Node) or URLs (browser)
 */
export async function proveRepaymentCertificate(
  params: Parameters<typeof buildCertificateInput>[0] & { wasm: string; zkey: string },
  groth16: Groth16Prover,
): Promise<CertificateProof> {
  const { input, root, nullifierHash: nHash } = buildCertificateInput(params);
  const { proof, publicSignals } = await groth16.fullProve(input, params.wasm, params.zkey);
  return {
    ...proofToSolana(proof),
    root: [...toBytes32(root)],
    nullifierHash: [...toBytes32(nHash)],
    minPrincipal: params.minPrincipal,
    publicSignals,
  };
}
