import { isAdminRequest } from "@/lib/admin-server";
import { db } from "@/lib/db-server";

/** Admin only: the indexed copy of Loomzk's on-chain data. */
export async function GET(req: Request) {
  if (!isAdminRequest(req)) return Response.json({ error: "Admin signature required" }, { status: 401 });
  const pool = db();
  if (!pool) return Response.json({ error: "DATABASE_URL is not set in app/.env" }, { status: 503 });
  try {
    const [lastRun, counts, loans, events] = await Promise.all([
      pool.query("SELECT value, updated_at FROM sync_state WHERE key = 'last_run'"),
      pool.query("SELECT status, count(*)::int AS n FROM loans GROUP BY status"),
      pool.query("SELECT * FROM loans_readable ORDER BY loan_id DESC LIMIT 500"),
      pool.query(
        `SELECT e.signature, e.block_time, e.name, l.loan_id, e.data
         FROM events e LEFT JOIN loans l ON l.address = e.loan
         ORDER BY e.block_time DESC NULLS LAST, e.idx DESC LIMIT 200`,
      ),
    ]);
    const eventCount = await pool.query("SELECT count(*)::int AS n FROM events");
    return Response.json({
      lastRun: lastRun.rows[0] ? { ...JSON.parse(lastRun.rows[0].value), at: lastRun.rows[0].updated_at } : null,
      loanCounts: Object.fromEntries(counts.rows.map((r) => [r.status, r.n])),
      eventCount: eventCount.rows[0].n,
      loans: loans.rows,
      events: events.rows,
    });
  } catch (e) {
    const msg = (e as Error).message;
    // A missing table means the indexer hasn't run yet.
    const hint = msg.includes("does not exist") ? " Run `pnpm indexer --cluster devnet` once to create the tables." : "";
    return Response.json({ error: `Database error: ${msg}.${hint}` }, { status: 500 });
  }
}
