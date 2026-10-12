import { PublicKey } from "@solana/web3.js";
import { LOOM_PROGRAM_ID, SEEDS } from "./constants";

const enc = (s: string) => new TextEncoder().encode(s);

function u64le(v: bigint): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, v, true);
  return out;
}

const find = (seeds: Uint8Array[], programId: PublicKey) => PublicKey.findProgramAddressSync(seeds, programId)[0];

export const pda = (programId: PublicKey = LOOM_PROGRAM_ID) => ({
  config: () => find([enc(SEEDS.config)], programId),
  creditTree: () => find([enc(SEEDS.creditTree)], programId),
  reserve: (mint: PublicKey) => find([enc(SEEDS.reserve), mint.toBytes()], programId),
  vault: (mint: PublicKey) => find([enc(SEEDS.vault), mint.toBytes()], programId),
  loan: (borrower: PublicKey, nonce: bigint) => find([enc(SEEDS.loan), borrower.toBytes(), u64le(nonce)], programId),
  escrow: (loan: PublicKey) => find([enc(SEEDS.escrow), loan.toBytes()], programId),
  certificate: (nullifierHash: Uint8Array) => find([enc(SEEDS.certificate), nullifierHash], programId),
  pool: (mint: PublicKey) => find([enc(SEEDS.pool), mint.toBytes()], programId),
  poolVault: (mint: PublicKey) => find([enc(SEEDS.poolVault), mint.toBytes()], programId),
  lender: (mint: PublicKey, owner: PublicKey) => find([enc(SEEDS.lender), mint.toBytes(), owner.toBytes()], programId),
});
