/**
 * Test faucet (localnet / devnet): sends SOL and mints test USDC + USDT to a wallet,
 * so you can borrow and still have stablecoins to pay the 12% fee.
 *
 *   pnpm faucet --cluster localnet --to <wallet> [--sol 20] [--usd 5000]
 */
import { readFileSync } from "node:fs";
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createMintToInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { ROOT, airdropIfNeeded, arg, cluster, connection, loadKeypair, sendIxs } from "./common";

const c = cluster();
if (c === "mainnet-beta") throw new Error("faucet is for test clusters only");
const conn = connection(c);
const admin = loadKeypair(arg("admin", `${ROOT}/.keys/admin.json`)!);
const to = new PublicKey(arg("to") ?? (() => { throw new Error("--to <wallet> is required"); })());
const sol = Number(arg("sol", c === "localnet" ? "20" : "0"));
const usd = BigInt(arg("usd", "5000")!) * 1_000_000n;
const mints = JSON.parse(readFileSync(`${ROOT}/.keys/mints.${c}.json`, "utf8")) as { usdc: string; usdt: string };

async function main() {
  await airdropIfNeeded(conn, admin, sol + 2, c);
  const ixs = sol > 0 ? [SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: to, lamports: sol * LAMPORTS_PER_SOL })] : [];
  for (const m of [mints.usdc, mints.usdt].map((x) => new PublicKey(x))) {
    const ata = getAssociatedTokenAddressSync(m, to, true);
    ixs.push(createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, ata, to, m), createMintToInstruction(m, ata, admin.publicKey, usd));
  }
  const sig = await sendIxs(conn, ixs, [admin]);
  console.log(`✔ sent ${sol} SOL + ${usd / 1_000_000n} USDC + ${usd / 1_000_000n} USDT to ${to.toBase58()} (${sig})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
