import "server-only";
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { CLUSTER, RPC_URL, STABLECOINS } from "./env";
import { appDb } from "./db-server";

/** Test USDC and USDT sent per claim: enough to borrow, repay with interest, and try the lending pool. */
export const FAUCET_AMOUNT = 100_000_000n;
/** Wallets holding at least this much of a coin don't get more of it. */
const ENOUGH = 50_000_000n;
const COOLDOWN_HOURS = 12;

/**
 * Devnet-only faucet wallet (FAUCET_SECRET_KEY, a JSON byte array, server-only). It holds worthless
 * test tokens and pays network fees; it is never the program's deploy key or a mint authority.
 */
function faucetKeypair(): Keypair | null {
  const raw = process.env.FAUCET_SECRET_KEY;
  if (!raw || CLUSTER === "mainnet-beta") return null;
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw) as number[]));
}

export const faucetEnabled = () => faucetKeypair() !== null;

export type FaucetResult = { ok: true; signature: string; sent: string[] } | { ok: false; error: string; status: number };

export async function claim(wallet: PublicKey): Promise<FaucetResult> {
  const faucet = faucetKeypair();
  if (!faucet) return { ok: false, status: 503, error: "The test-token faucet isn't available here" };

  const pool = await appDb();
  if (pool) {
    const { rows } = await pool.query("SELECT claimed_at FROM faucet_claims WHERE wallet = $1 AND claimed_at > now() - make_interval(hours => $2)", [
      wallet.toBase58(),
      COOLDOWN_HOURS,
    ]);
    if (rows.length) return { ok: false, status: 429, error: `This wallet already got test tokens in the last ${COOLDOWN_HOURS} hours` };
  }

  const conn = new Connection(RPC_URL, "confirmed");
  const tx = new Transaction();
  const sent: string[] = [];
  for (const coin of STABLECOINS) {
    const to = getAssociatedTokenAddressSync(coin.mint, wallet, true);
    const balance = await getAccount(conn, to).then((a) => a.amount).catch(() => 0n);
    if (balance >= ENOUGH) continue;
    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(faucet.publicKey, to, wallet, coin.mint),
      createTransferCheckedInstruction(getAssociatedTokenAddressSync(coin.mint, faucet.publicKey), coin.mint, to, faucet.publicKey, FAUCET_AMOUNT, 6),
    );
    sent.push(coin.symbol);
  }
  if (!sent.length) return { ok: false, status: 429, error: "This wallet already has enough test USDC and USDT" };

  try {
    const signature = await sendAndConfirmTransaction(conn, tx, [faucet], { commitment: "confirmed" });
    await pool?.query(
      "INSERT INTO faucet_claims (wallet) VALUES ($1) ON CONFLICT (wallet) DO UPDATE SET claimed_at = now(), count = faucet_claims.count + 1",
      [wallet.toBase58()],
    );
    return { ok: true, signature, sent };
  } catch (e) {
    return { ok: false, status: 502, error: `The faucet couldn't send tokens right now: ${(e as Error).message.split("\n")[0]}` };
  }
}
