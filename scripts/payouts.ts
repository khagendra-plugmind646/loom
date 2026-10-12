/**
 * Points Loomzk at the payout wallet and sets how much USDC/USDT the program may pay out from it.
 *
 *   pnpm payouts --cluster devnet --admin ~/.config/solana/id.json [--limit 250000] [--sweep-vaults]
 *
 *   - LOOM_ADMIN_WALLET in app/.env (public address only) is the payout wallet. If the on-chain
 *     treasury differs, the admin keypair updates it.
 *   - The payout wallet approves the program to spend up to --limit (default: its whole balance)
 *     of each stablecoin. Only possible here when --admin is that wallet's keypair file;
 *     otherwise approve from the website's Operator page.
 *   - --sweep-vaults moves anything left in the old program vaults back to the payout wallet.
 *
 * The private key stays in the keypair file / your wallet app. It never goes into .env.
 */
import { PublicKey } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { LoomClient, formatStable, parseUnits } from "@loom/sdk";
import { ROOT, appEnv, arg, cluster, connection, loadKeypair, sendIxs } from "./common";

const c = cluster();
const conn = connection(c);
const client = new LoomClient(conn);
const admin = loadKeypair(arg("admin", `${ROOT}/.keys/admin.json`)!);

async function main() {
  const config = await client.fetchConfig();
  if (!config) throw new Error("Loomzk is not initialized on this cluster — run pnpm bootstrap first");
  const wallet = new PublicKey(appEnv("LOOM_ADMIN_WALLET") ?? config.treasury.toBase58());
  console.log(`cluster ${c} · payout wallet ${wallet.toBase58()}`);

  if (!config.treasury.equals(wallet)) {
    if (!config.admin.equals(admin.publicKey)) throw new Error(`on-chain treasury is ${config.treasury.toBase58()}; only the admin can change it`);
    await sendIxs(conn, [await client.updateConfig(admin.publicKey, { treasury: wallet })], [admin]);
    console.log(`✔ on-chain treasury changed ${config.treasury.toBase58()} → ${wallet.toBase58()}`);
  }

  const reserves = await client.fetchReserves();
  if (process.argv.includes("--sweep-vaults")) {
    for (const r of reserves) {
      const left = BigInt((await conn.getTokenAccountBalance(r.vault)).value.amount);
      if (left === 0n) continue;
      const dest = getAssociatedTokenAddressSync(r.mint, wallet, true);
      await sendIxs(
        conn,
        [
          createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, dest, wallet, r.mint),
          await client.withdrawReserve(admin.publicKey, r.mint, left, dest),
        ],
        [admin],
      );
      console.log(`✔ moved ${formatStable(left)} from the old ${r.mint.toBase58()} vault to the payout wallet`);
    }
  }

  const mints = reserves.map((r) => r.mint);
  if (wallet.equals(admin.publicKey)) {
    const before = await client.fetchPayoutCapacity(wallet, mints);
    const limit = arg("limit");
    const ixs = before.map((p) => client.approvePayouts(wallet, p.mint, limit ? parseUnits(limit, 6) : p.balance));
    await sendIxs(conn, ixs, [admin]);
  } else {
    console.log("• --admin is not the payout wallet: approve the payout limit from the Operator page with that wallet");
  }

  for (const p of await client.fetchPayoutCapacity(wallet, mints)) {
    console.log(`  ${p.mint.toBase58()}  balance ${formatStable(p.balance)}  approved ${formatStable(p.approved)}  available ${formatStable(p.available)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
