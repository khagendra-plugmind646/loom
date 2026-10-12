/**
 * Indexer: copies everything Loomzk stores on-chain into the admin's private Postgres database.
 *
 *   pnpm indexer --cluster devnet [--interval 15] [--once]
 *
 * DATABASE_URL comes from app/.env (server-only; never NEXT_PUBLIC_). Every run:
 *   1. applies db/schema.sql (idempotent),
 *   2. upserts the current state of every program account: config, reserves, loans, certificates,
 *   3. stores the events of every finalized program transaction since the last one it saw,
 *   4. fills each settled loan's SOL split from its LoanLiquidated event.
 * The chain stays the source of truth; the database can be dropped and rebuilt with one run.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { PublicKey, type ConfirmedSignatureInfo } from "@solana/web3.js";
import { LoomClient } from "@loom/sdk";
import { ROOT, appEnv, arg, cluster, connection } from "./common";

const c = cluster();
const conn = connection(c);
const client = new LoomClient(conn);
const intervalSecs = Number(arg("interval", "15"));
const databaseUrl = appEnv("DATABASE_URL");
if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Add it to app/.env (see app/.env.local.example).");
  process.exit(1);
}
const db = new pg.Pool({ connectionString: databaseUrl, max: 2 });

const log = (msg: string) => console.log(`${new Date().toISOString()}  ${msg}`);
const coins = new Map(
  (["USDC", "USDT"] as const).flatMap((s) => {
    const mint = appEnv(`NEXT_PUBLIC_${s}_MINT`);
    return mint ? [[mint, s] as const] : [];
  }),
);
const coin = (mint: PublicKey) => coins.get(mint.toBase58()) ?? null;
const ts = (secs: bigint | number) => new Date(Number(secs) * 1000);
const SIG_KEY = `last_signature:${client.programId.toBase58()}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retries an RPC call while the node rate-limits us (public devnet RPCs return 429 under load). */
async function rpc<T>(what: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const msg = (e as Error).message;
      if (!msg.includes("429") || attempt >= 6) throw new Error(`${what}: ${msg.split("\n")[0]}`);
      await sleep(2_000 * 2 ** attempt);
    }
  }
}

/** bn.js instances (Anchor's u64/i64 fields), detected by shape to avoid a direct bn.js dependency. */
const isBN = (v: unknown): boolean =>
  !!v && typeof v === "object" && Array.isArray((v as { words?: unknown }).words) && "negative" in v;

/** Anchor event data → plain JSON (keys as base58, big numbers as strings, byte arrays as hex). */
function plain(v: unknown): unknown {
  if (v instanceof PublicKey) return v.toBase58();
  if (isBN(v)) return String(v);
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return v.every((x) => typeof x === "number") ? Buffer.from(v as number[]).toString("hex") : v.map(plain);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
  return v;
}

async function syncAccounts() {
  const config = await rpc("config", () => client.fetchConfig());
  if (!config) throw new Error("Loomzk is not initialized on this cluster");
  await db.query(
    `INSERT INTO protocol (program_id, cluster, admin, treasury, paused, liquidation_threshold_bps, liquidation_penalty_bps,
       max_price_age_secs, max_confidence_bps, min_principal, max_principal, next_loan_id, stats, synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now())
     ON CONFLICT (program_id) DO UPDATE SET cluster=$2, admin=$3, treasury=$4, paused=$5, liquidation_threshold_bps=$6,
       liquidation_penalty_bps=$7, max_price_age_secs=$8, max_confidence_bps=$9, min_principal=$10, max_principal=$11,
       next_loan_id=$12, stats=$13, synced_at=now()`,
    [
      client.programId.toBase58(),
      c,
      config.admin.toBase58(),
      config.treasury.toBase58(),
      config.paused,
      config.liquidationThresholdBps,
      config.liquidationPenaltyBps,
      config.maxPriceAgeSecs,
      config.maxConfidenceBps,
      config.minPrincipal.toString(),
      config.maxPrincipal.toString(),
      config.nextLoanId.toString(),
      JSON.stringify(plain(config.stats)),
    ],
  );

  const reserves = await rpc("reserves", () => client.fetchReserves());
  for (const r of reserves) {
    await db.query(
      `INSERT INTO reserves (address, mint, coin, vault, total_funded, total_withdrawn, total_disbursed, total_repaid, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
       ON CONFLICT (address) DO UPDATE SET coin=$3, total_funded=$5, total_withdrawn=$6, total_disbursed=$7, total_repaid=$8, synced_at=now()`,
      [r.address.toBase58(), r.mint.toBase58(), coin(r.mint), r.vault.toBase58(), r.totalFunded.toString(), r.totalWithdrawn.toString(), r.totalDisbursed.toString(), r.totalRepaid.toString()],
    );
  }

  const loans = await rpc("loans", () => client.fetchLoans());
  for (const l of loans) {
    await db.query(
      `INSERT INTO loans (address, loan_id, borrower, recipient, mint, coin, principal, total_due, repaid, collateral_lamports,
         open_price, open_price_expo, opened_at, maturity_at, closed_at, status, liquidation_threshold_bps, zk_opted_in,
         credit_leaf_index, rate_bps, principal_repaid, interest_accrued, credit_certificate, from_pool, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24, now())
       ON CONFLICT (address) DO UPDATE SET repaid=$9, closed_at=$15, status=$16, credit_leaf_index=$19, coin=$6,
         rate_bps=$20, principal_repaid=$21, interest_accrued=$22, credit_certificate=$23, from_pool=$24, synced_at=now()`,
      [
        l.address.toBase58(),
        l.id.toString(),
        l.borrower.toBase58(),
        l.recipient.toBase58(),
        l.mint.toBase58(),
        coin(l.mint),
        l.principal.toString(),
        l.totalDue.toString(),
        l.repaid.toString(),
        l.collateralLamports.toString(),
        l.openPrice.toString(),
        l.openPriceExpo,
        ts(l.startTs),
        ts(l.maturityTs),
        l.closedTs > 0n ? ts(l.closedTs) : null,
        l.status,
        l.liquidationThresholdBps,
        l.identityCommitment !== 0n,
        l.creditLeafIndex?.toString() ?? null,
        l.rateBps,
        l.principalRepaid.toString(),
        l.interestAccrued.toString(),
        l.creditCertificate?.toBase58() ?? null,
        l.fromPool,
      ],
    );
  }

  const pools = await rpc("pools", () => client.fetchPools());
  for (const p of pools) {
    await db.query(
      `INSERT INTO pools (address, mint, coin, cash, principal_out, total_shares, total_deposited, total_withdrawn, interest_earned, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
       ON CONFLICT (address) DO UPDATE SET cash=$4, principal_out=$5, total_shares=$6, total_deposited=$7, total_withdrawn=$8,
         interest_earned=$9, synced_at=now()`,
      [p.address.toBase58(), p.mint.toBase58(), coin(p.mint), p.cash.toString(), p.principalOut.toString(), p.totalShares.toString(), p.totalDeposited.toString(), p.totalWithdrawn.toString(), p.interestEarned.toString()],
    );
  }
  const positions = await rpc("lender positions", () => client.fetchLenderPositions());
  for (const p of positions) {
    await db.query(
      `INSERT INTO lender_positions (address, owner, mint, coin, shares, deposited, withdrawn, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now())
       ON CONFLICT (address) DO UPDATE SET shares=$5, deposited=$6, withdrawn=$7, synced_at=now()`,
      [p.address.toBase58(), p.owner.toBase58(), p.mint.toBase58(), coin(p.mint), p.shares.toString(), p.deposited.toString(), p.withdrawn.toString()],
    );
  }

  const certificates = await rpc("certificates", () => client.fetchCertificates());
  for (const cert of certificates) {
    await db.query(
      `INSERT INTO certificates (address, holder, nullifier_hash, root, min_principal, issued_at, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6, now()) ON CONFLICT (address) DO UPDATE SET synced_at=now()`,
      [cert.address.toBase58(), cert.holder.toBase58(), cert.nullifierHash.toString(16), cert.root.toString(16), cert.minPrincipal.toString(), ts(cert.issuedAt)],
    );
  }
  return { loans: loans.length, reserves: reserves.length, pools: pools.length, depositors: positions.length, certificates: certificates.length };
}

/** Program transactions newer than the last one stored, oldest first. */
async function newSignatures(until?: string): Promise<ConfirmedSignatureInfo[]> {
  const out: ConfirmedSignatureInfo[] = [];
  let before: string | undefined;
  for (;;) {
    const page = await rpc("signatures", () => conn.getSignaturesForAddress(client.programId, { before, until, limit: 1000 }, "finalized"));
    out.push(...page);
    if (page.length < 1000) break;
    before = page[page.length - 1].signature;
  }
  return out.reverse();
}

async function syncEvents() {
  const last = (await db.query<{ value: string }>("SELECT value FROM sync_state WHERE key = $1", [SIG_KEY])).rows[0]?.value;
  const sigs = await newSignatures(last);
  let events = 0;
  for (const s of sigs) {
    if (!s.err) {
      const tx = await rpc("transaction", () => conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: "finalized" }));
      await sleep(250); // stay well under public RPC rate limits during the first backfill
      const parsed = client.parseEvents(tx?.meta?.logMessages ?? []);
      for (const [idx, e] of parsed.entries()) {
        const data = plain(e.data) as Record<string, unknown>;
        await db.query(
          `INSERT INTO events (signature, idx, slot, block_time, name, loan, data) VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (signature, idx) DO NOTHING`,
          [s.signature, idx, s.slot, s.blockTime ? ts(s.blockTime) : null, e.name, typeof data.loan === "string" ? data.loan : null, JSON.stringify(data)],
        );
        events++;
      }
    }
    // Advance after each transaction so an interrupted run resumes where it stopped.
    await db.query(
      `INSERT INTO sync_state (key, value, updated_at) VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=now()`,
      [SIG_KEY, s.signature],
    );
  }

  // Each settled loan's SOL split, from its LoanLiquidated event.
  await db.query(
    `UPDATE loans l SET settled_to_treasury_lamports = (e.data->>'seizedLamports')::numeric,
       settled_to_borrower_lamports = (e.data->>'returnedLamports')::numeric, settlement_signature = e.signature
     FROM events e WHERE e.name = 'loanLiquidated' AND e.loan = l.address AND l.settlement_signature IS DISTINCT FROM e.signature`,
  );
  return { transactions: sigs.length, events };
}

async function tick() {
  const a = await syncAccounts();
  const e = await syncEvents();
  await db.query(
    `INSERT INTO sync_state (key, value, updated_at) VALUES ('last_run', $1, now()) ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=now()`,
    [JSON.stringify({ cluster: c, ...a, ...e })],
  );
  log(`synced ${a.loans} loans, ${a.reserves} reserves, ${a.pools} pools, ${a.depositors} depositors, ${a.certificates} certificates · ${e.transactions} new tx, ${e.events} events`);
}

async function main() {
  await db.query(readFileSync(resolve(ROOT, "db/schema.sql"), "utf8"));
  log(`indexer for ${client.programId.toBase58()} on ${c} · every ${intervalSecs}s`);
  for (;;) {
    await tick().catch((err) => log(`sync failed: ${(err as Error).message}`));
    if (process.argv.includes("--once")) break;
    await new Promise((r) => setTimeout(r, intervalSecs * 1000));
  }
  await db.end();
}

main();
