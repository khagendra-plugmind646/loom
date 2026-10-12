/**
 * Keeper: watches every active loan and settles the ones the program allows, so seized SOL goes
 * to the treasury automatically. Also warns when the payout wallet runs low.
 *
 *   pnpm keeper --cluster devnet [--keypair .keys/keeper.json] [--interval 30] [--once]
 *
 * Prices: the program reads Pyth AND Chainlink and settles at the higher of the two, so the keeper does too.
 *
 * A loan is settled when (same rules as the program):
 *   - SOL trades at or below 60% of its price when the loan opened, or
 *   - its collateral is worth less than the debt threshold, or
 *   - it is past its term (the treasury gets SOL worth the debt; the rest goes back to the borrower).
 *
 * The keeper wallet only pays transaction fees (fund it with ~0.5 SOL). Settlement is
 * permissionless and the program decides where the SOL goes, so this key cannot move funds
 * and must NOT be the admin key.
 */
import { Wallet } from "@coral-xyz/anchor";
import { HermesClient } from "@pythnetwork/hermes-client";
import type { PublicKey } from "@solana/web3.js";
import { PythSolanaReceiver } from "@pythnetwork/pyth-solana-receiver";
import {
  CHAINLINK_SOL_USD_FEED,
  LoomClient,
  SOL_USD_FEED_ID_HEX,
  SOL_USD_PRICE_ACCOUNT,
  defaultSplit,
  formatSol,
  formatStable,
  loanDebt,
  parseChainlinkFeed,
  parsePriceUpdateV2,
  settleReason,
  type LoanAccount,
} from "@loom/sdk";
import { ROOT, appEnv, arg, cluster, connection, loadKeypair, sendIxs } from "./common";

const c = cluster();
const conn = connection(c);
const client = new LoomClient(conn);
const keeper = loadKeypair(arg("keypair", `${ROOT}/.keys/keeper.json`)!, true);
const intervalSecs = Number(arg("interval", "30"));
const hermes = new HermesClient(appEnv("NEXT_PUBLIC_HERMES_URL") ?? "https://hermes.pyth.network");

const log = (msg: string) => console.log(`${new Date().toISOString()}  ${msg}`);

type Price = { price: bigint; expo: number; publishTime: number };

/** Pyth's sponsored on-chain feed when fresh enough for the program, else null. */
async function sponsoredPrice(maxAgeSecs: number): Promise<Price | null> {
  const info = await conn.getAccountInfo(SOL_USD_PRICE_ACCOUNT);
  if (!info) return null;
  const p = parsePriceUpdateV2(info.data);
  return p.fullyVerified && Date.now() / 1000 - p.publishTime < maxAgeSecs - 20 ? p : null;
}

/** The higher of `pyth` and Chainlink, at Pyth's exponent: the price the program settles at. */
async function settlementPrice(pyth: Price): Promise<{ price: bigint; expo: number; chainlinkUsd: number }> {
  const info = await conn.getAccountInfo(CHAINLINK_SOL_USD_FEED);
  if (!info) throw new Error("Chainlink SOL/USD feed not found on this cluster");
  const cl = parseChainlinkFeed(info.data);
  const d = cl.expo - pyth.expo;
  const clAtExpo = d >= 0 ? cl.price * 10n ** BigInt(d) : cl.price / 10n ** BigInt(-d);
  return { price: clAtExpo > pyth.price ? clAtExpo : pyth.price, expo: pyth.expo, chainlinkUsd: Number(cl.price) * 10 ** cl.expo };
}

async function hermesPrice(): Promise<Price> {
  const res = await hermes.getLatestPriceUpdates([SOL_USD_FEED_ID_HEX]);
  const p = res.parsed![0].price;
  return { price: BigInt(p.price), expo: p.expo, publishTime: p.publish_time };
}

/** Settles `loan`, posting a fresh Wormhole-verified Pyth price first when the sponsored feed is stale. */
async function settle(loan: LoanAccount, treasury: PublicKey, useSponsored: boolean) {
  if (useSponsored) {
    return sendIxs(conn, [await client.liquidate({ caller: keeper.publicKey, loan, treasury })], [keeper]);
  }
  const updates = await hermes.getLatestPriceUpdates([SOL_USD_FEED_ID_HEX], { encoding: "base64" });
  const receiver = new PythSolanaReceiver({ connection: conn, wallet: new Wallet(keeper) });
  const builder = receiver.newTransactionBuilder({ closeUpdateAccounts: true });
  await builder.addPostPriceUpdates(updates.binary.data);
  await builder.addPriceConsumerInstructions(async (priceAccount) => [
    { instruction: await client.liquidate({ caller: keeper.publicKey, loan, treasury, priceUpdate: priceAccount("0x" + SOL_USD_FEED_ID_HEX) }), signers: [] },
  ]);
  const sigs = await receiver.provider.sendAll(await builder.buildVersionedTransactions({ computeUnitPriceMicroLamports: 50_000 }), {
    skipPreflight: false,
  });
  return sigs[sigs.length - 1];
}

async function tick() {
  const config = await client.fetchConfig();
  if (!config) return log("Loomzk is not initialized on this cluster");
  const loans = (await client.fetchLoans()).filter((l) => l.status === "active");
  const sponsored = await sponsoredPrice(config.maxPriceAgeSecs);
  const pyth = sponsored ?? (await hermesPrice());
  const price = await settlementPrice(pyth);
  const now = Math.floor(Date.now() / 1000);
  log(`SOL Pyth $${(Number(pyth.price) * 10 ** pyth.expo).toFixed(2)} · Chainlink $${price.chainlinkUsd.toFixed(2)} · ${loans.length} active loan(s)`);

  for (const loan of loans) {
    const reason = settleReason(loan, price.price, price.expo, now);
    if (!reason) continue;
    try {
      const sig = await settle(loan, config.treasury, !!sponsored);
      const split = reason === "matured" ? defaultSplit(loan.collateralLamports, loanDebt(loan, now).owed, price.price, price.expo) : null;
      const moved = split
        ? `≈${formatSol(split.toTreasury)} SOL → treasury, ≈${formatSol(split.toBorrower)} SOL → borrower`
        : `${formatSol(loan.collateralLamports)} SOL → treasury`;
      log(`✔ settled loan #${loan.id} (${reason}): ${moved} · tx ${sig}`);
    } catch (e) {
      log(`✖ loan #${loan.id} (${reason}) not settled: ${(e as Error).message.split("\n")[0]}`);
    }
  }

  // Payout wallet health: can the next loans still be paid?
  const mints = (await client.fetchReserves()).map((r) => r.mint);
  for (const p of await client.fetchPayoutCapacity(config.treasury, mints)) {
    if (p.available < config.minPrincipal) log(`⚠ payout wallet can't fund any ${p.mint.toBase58().slice(0, 4)}… loan (available ${formatStable(p.available)})`);
    else if (p.available < config.maxPrincipal) log(`• ${p.mint.toBase58().slice(0, 4)}… payouts available: ${formatStable(p.available)}`);
    // Pool-funded loans are bought out from the same approval when they are settled.
    const poolOwed = loans.filter((l) => l.fromPool && l.mint.equals(p.mint)).reduce((s, l) => s + loanDebt(l, now).owed, 0n);
    if (poolOwed > p.available) log(`⚠ approve at least ${formatStable(poolOwed)} for ${p.mint.toBase58().slice(0, 4)}… so pool loans can be bought out if they default`);
  }
}

async function main() {
  const sol = (await conn.getBalance(keeper.publicKey)) / 1e9;
  log(`keeper ${keeper.publicKey.toBase58()} on ${c} · ${sol} SOL for fees · every ${intervalSecs}s`);
  if (sol < 0.05) log(`⚠ fund the keeper with ~0.5 SOL: solana transfer ${keeper.publicKey.toBase58()} 0.5 -u ${c}`);
  for (;;) {
    await tick().catch((e) => log(`tick failed: ${(e as Error).message}`));
    if (process.argv.includes("--once")) return;
    await new Promise((r) => setTimeout(r, intervalSecs * 1000));
  }
}

main();
