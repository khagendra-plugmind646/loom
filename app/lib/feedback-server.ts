import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Feedback } from "./feedback";
import { appDb } from "./db-server";

// Postgres when DATABASE_URL is set (required when hosted), otherwise a local JSON file for development.
const FILE = path.join(process.cwd(), ".data", "feedback.json");
const MAX = 2_000;

async function readFileFeedback(): Promise<Feedback[]> {
  try {
    return JSON.parse(await readFile(FILE, "utf8")) as Feedback[];
  } catch {
    return [];
  }
}

export async function addFeedback(f: Feedback) {
  const pool = await appDb();
  if (pool) {
    await pool.query(
      "INSERT INTO feedback (id, created_at, rating, area, message, contact, wallet, page) VALUES ($1, to_timestamp($2 / 1000.0), $3, $4, $5, $6, $7, $8)",
      [f.id, f.createdAt, f.rating, f.area, f.message, f.contact, f.wallet, f.page],
    );
    return;
  }
  await mkdir(path.dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify([...(await readFileFeedback()), f].slice(-MAX), null, 2));
}

/** Newest first. */
export async function listFeedback(): Promise<Feedback[]> {
  const pool = await appDb();
  if (!pool) return (await readFileFeedback()).reverse();
  const { rows } = await pool.query(
    "SELECT id, (extract(epoch from created_at) * 1000)::bigint AS created_at, rating, area, message, contact, wallet, page FROM feedback ORDER BY created_at DESC LIMIT $1",
    [MAX],
  );
  return rows.map((r) => ({ ...r, createdAt: Number(r.created_at) }) as Feedback);
}
