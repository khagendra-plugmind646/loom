/**
 * One-shot protocol setup for localnet / devnet:
 *   - creates test USDC + USDT mints (6 decimals) unless --usdc / --usdt are given
 *   - initializes the Loom config + ZK credit tree
 *   - creates both reserves, mints test USDC/USDT into the treasury (payout) wallet and
 *     approves the program to pay loans from it
 *   - writes app/.env.local so the UI points at the right cluster and mints
 *
 * Usage:
 *   pnpm bootstrap --cluster localnet
 *   pnpm bootstrap --cluster devnet --admin ~/.config/solana/id.json [--treasury <pubkey>] [--fund 250000]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  getMinimumBalanceForRentExemptMint,
} from "@solana/spl-token";
import { LoomClient } from "@loom/sdk";
import { ROOT, airdropIfNeeded, appEnv, arg, cluster, connection, loadKeypair, sendIxs } from "./common";

const c = cluster();
if (c === "mainnet-beta") throw new Error("bootstrap creates test mints; configure mainnet manually from the Operator page");
const conn = connection(c);
const client = new LoomClient(conn);
const admin = loadKeypair(arg("admin", `${ROOT}/.keys/admin.json`)!, true);
// The payout/treasury wallet: --treasury, else LOOM_ADMIN_WALLET from app/.env, else the admin itself.
const treasury = new PublicKey(arg("treasury") ?? appEnv("LOOM_ADMIN_WALLET") ?? admin.publicKey.toBase58());
const fund = BigInt(arg("fund", "250000")!) * 1_000_000n;

async function createMint(): Promise<PublicKey> {
  const mint = Keypair.generate();
  await sendIxs(
    conn,
    [
      SystemProgram.createAccount({
        fromPubkey: admin.publicKey,
        newAccountPubkey: mint.publicKey,
        lamports: await getMinimumBalanceForRentExemptMint(conn),
        space: MINT_SIZE,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(mint.publicKey, 6, admin.publicKey, null),
    ],
    [admin, mint],
  );
  return mint.publicKey;
}

async function main() {
  console.log(`cluster ${c} · admin ${admin.publicKey.toBase58()} · program ${client.programId.toBase58()}`);
  await airdropIfNeeded(conn, admin, 5, c);

  const usdc = arg("usdc") ? new PublicKey(arg("usdc")!) : await createMint();
  const usdt = arg("usdt") ? new PublicKey(arg("usdt")!) : await createMint();
  console.log(`USDC mint ${usdc.toBase58()}\nUSDT mint ${usdt.toBase58()}`);

  if (!(await client.fetchConfig())) {
    await sendIxs(
      conn,
      [
        await client.initialize(admin.publicKey, {
          treasury,
          // The 60%-of-opening-price rule (in the program) is the main trigger; this debt
          // backstop only fires once collateral is worth less than 101% of what is owed.
          liquidationThresholdBps: 10_100,
          liquidationPenaltyBps: 500,
          // localnet clones a Pyth snapshot at startup, so allow an hour of staleness there
          maxPriceAgeSecs: c === "localnet" ? 3_600 : 120,
          maxConfidenceBps: 200,
          minPrincipal: 10_000_000n,
          maxPrincipal: 100_000_000_000n,
        }),
      ],
      [admin],
    );
    console.log("✔ protocol initialized");
  } else {
    console.log("• config already exists — skipping initialize");
  }

  for (const [symbol, mint] of [["USDC", usdc], ["USDT", usdt]] as const) {
    const reserves = await client.fetchReserves();
    if (!reserves.some((r) => r.mint.equals(mint))) {
      await sendIxs(conn, [await client.initReserve(admin.publicKey, mint, treasury)], [admin]);
    }
    // Loans are paid from the treasury wallet's token account, which must approve the program.
    const ata = getAssociatedTokenAddressSync(mint, treasury, true);
    const ownMint = !arg(symbol.toLowerCase());
    const ixs = [createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, ata, treasury, mint)];
    // Only mint into test mints this script created; real mints must be funded by the treasury.
    if (ownMint) ixs.push(createMintToInstruction(mint, ata, admin.publicKey, fund));
    if (treasury.equals(admin.publicKey)) ixs.push(client.approvePayouts(treasury, mint, fund));
    await sendIxs(conn, ixs, [admin]);
    console.log(
      `✔ ${symbol}: ${ownMint ? `minted ${fund / 1_000_000n} to the treasury` : "external mint"}; ` +
        (treasury.equals(admin.publicKey) ? `payouts approved up to ${fund / 1_000_000n}` : "approve payouts from the Operator page with the treasury wallet"),
    );
  }

  const env = [
    `NEXT_PUBLIC_SOLANA_CLUSTER=${c}`,
    ...(arg("rpc") ? [`NEXT_PUBLIC_RPC_URL=${arg("rpc")}`] : []),
    `NEXT_PUBLIC_PROGRAM_ID=${client.programId.toBase58()}`,
    `NEXT_PUBLIC_USDC_MINT=${usdc.toBase58()}`,
    `NEXT_PUBLIC_USDT_MINT=${usdt.toBase58()}`,
    "",
  ].join("\n");
  writeFileSync(`${ROOT}/app/.env.local`, env);
  mkdirSync(`${ROOT}/.keys`, { recursive: true });
  writeFileSync(`${ROOT}/.keys/mints.${c}.json`, JSON.stringify({ usdc: usdc.toBase58(), usdt: usdt.toBase58() }, null, 2));
  console.log(`✔ wrote app/.env.local\n\nNext: pnpm faucet --cluster ${c} --to <your wallet>   then   pnpm --filter app dev`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
