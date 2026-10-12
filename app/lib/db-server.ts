import "server-only";
import pg from "pg";

// The admin database. DATABASE_URL is server-only: no NEXT_PUBLIC_ prefix, so it never reaches the
// browser. The indexer (`pnpm indexer`) fills the on-chain copy; the app itself stores only help
// messages, tester feedback and faucet claims, and only admin-signed API routes read any of it.
const globalForDb = globalThis as unknown as { loomDb?: pg.Pool; loomDbReady?: Promise<void> };

export function db(): pg.Pool | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  // Reuse one small pool across hot reloads in development.
  globalForDb.loomDb ??= new pg.Pool({ connectionString: url, max: 3 });
  return globalForDb.loomDb;
}

// Tables the app writes (also in db/schema.sql), created on first use so a fresh database works before the indexer runs.
const APP_SCHEMA = `
CREATE TABLE IF NOT EXISTS support_messages (
  id text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(), kind text NOT NULL, wallet text, coin text, amount text,
  contact text NOT NULL, message text NOT NULL, handled boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS feedback (
  id text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(), rating integer, area text NOT NULL, message text NOT NULL,
  contact text, wallet text, page text
);
CREATE TABLE IF NOT EXISTS faucet_claims (
  wallet text PRIMARY KEY, claimed_at timestamptz NOT NULL DEFAULT now(), count integer NOT NULL DEFAULT 1
);`;

/** Hosted (serverless, read-only file system) without DATABASE_URL: messages can't be saved. */
export const STORAGE_UNAVAILABLE = "Saving messages isn't set up on this site yet. Please reach the Loomzk team on X or Telegram.";

/** The database with the app's own tables ready, or null when DATABASE_URL isn't set (local file fallback). */
export async function appDb(): Promise<pg.Pool | null> {
  const pool = db();
  if (!pool) return null;
  globalForDb.loomDbReady ??= pool.query(APP_SCHEMA).then(() => undefined);
  await globalForDb.loomDbReady;
  return pool;
}
