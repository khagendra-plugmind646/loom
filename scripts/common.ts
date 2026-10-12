import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import {
  Connection,
  Keypair,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  clusterApiUrl,
} from "@solana/web3.js";

export type Cluster = "localnet" | "devnet" | "mainnet-beta";

export const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");

export function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : (process.env[name.toUpperCase().replace(/-/g, "_")] ?? fallback);
}

/**
 * Reads a setting from app/.env.local, then app/.env (the same files the website uses).
 * Only public values belong there — never a private key.
 */
export function appEnv(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  for (const file of [".env.local", ".env"]) {
    const p = resolve(ROOT, "app", file);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && m[1] === name && m[2]) return m[2].replace(/^["']|["']$/g, "");
    }
  }
  return undefined;
}

export function cluster(): Cluster {
  return (arg("cluster", "localnet") as Cluster);
}

export function connection(c: Cluster = cluster()): Connection {
  const url = arg("rpc") ?? (c === "localnet" ? "http://127.0.0.1:8899" : clusterApiUrl(c));
  return new Connection(url, "confirmed");
}

/** Loads a keypair file, or creates one (project-local, gitignored) when allowed. */
export function loadKeypair(path: string, create = false): Keypair {
  const p = path.replace(/^~/, homedir());
  if (!existsSync(p)) {
    if (!create) throw new Error(`keypair not found: ${p}`);
    mkdirSync(dirname(p), { recursive: true });
    const kp = Keypair.generate();
    writeFileSync(p, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
    console.log(`created keypair ${p} (${kp.publicKey.toBase58()})`);
    return kp;
  }
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, "utf8"))));
}

export async function sendIxs(conn: Connection, ixs: TransactionInstruction[], signers: Keypair[]): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
  const tx = new VersionedTransaction(
    new TransactionMessage({ payerKey: signers[0].publicKey, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message(),
  );
  tx.sign(signers);
  const sig = await conn.sendTransaction(tx);
  const res = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  if (res.value.err) {
    const logs = (await conn.getTransaction(sig, { maxSupportedTransactionVersion: 0 }))?.meta?.logMessages ?? [];
    throw new Error(`tx ${sig} failed: ${JSON.stringify(res.value.err)}\n${logs.join("\n")}`);
  }
  return sig;
}

export async function airdropIfNeeded(conn: Connection, kp: Keypair, minSol: number, c: Cluster) {
  const bal = await conn.getBalance(kp.publicKey);
  if (bal >= minSol * 1e9) return;
  if (c === "mainnet-beta") throw new Error(`${kp.publicKey.toBase58()} needs at least ${minSol} SOL`);
  try {
    const sig = await conn.requestAirdrop(kp.publicKey, Math.ceil((minSol * 1e9 - bal) / 1e9 + 1) * 1e9);
    await conn.confirmTransaction(sig, "confirmed");
  } catch (e) {
    // the public devnet faucet is rate-limited; carry on with what the wallet already holds
    if (c === "localnet" || bal === 0) throw e;
    console.warn(`• airdrop failed (${(e as Error).message}); continuing with ${bal / 1e9} SOL — top up at https://faucet.solana.com if needed`);
  }
}
