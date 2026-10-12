import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupportMessage } from "./support";
import { appDb } from "./db-server";

// Messages are stored in Postgres when DATABASE_URL is set (required when hosted: serverless file
// systems are read-only), otherwise in a local JSON file for development.
const FILE = path.join(process.cwd(), ".data", "support-messages.json");
const MAX_MESSAGES = 1_000;

async function readFileMessages(): Promise<SupportMessage[]> {
  try {
    return JSON.parse(await readFile(FILE, "utf8")) as SupportMessage[];
  } catch {
    return [];
  }
}

async function writeFileMessages(messages: SupportMessage[]) {
  await mkdir(path.dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(messages.slice(-MAX_MESSAGES), null, 2));
}

export async function addMessage(m: SupportMessage) {
  const pool = await appDb();
  if (!pool) return writeFileMessages([...(await readFileMessages()), m]);
  await pool.query(
    "INSERT INTO support_messages (id, created_at, kind, wallet, coin, amount, contact, message, handled) VALUES ($1, to_timestamp($2 / 1000.0), $3, $4, $5, $6, $7, $8, $9)",
    [m.id, m.createdAt, m.kind, m.wallet, m.coin, m.amount, m.contact, m.message, m.handled],
  );
}

/** Newest first. */
export async function listMessages(): Promise<SupportMessage[]> {
  const pool = await appDb();
  if (!pool) return (await readFileMessages()).reverse();
  const { rows } = await pool.query(
    "SELECT id, (extract(epoch from created_at) * 1000)::bigint AS created_at, kind, wallet, coin, amount, contact, message, handled FROM support_messages ORDER BY created_at DESC LIMIT $1",
    [MAX_MESSAGES],
  );
  return rows.map((r) => ({ ...r, createdAt: Number(r.created_at) }) as SupportMessage);
}

/** False when no message has this id. */
export async function setHandled(id: string, handled: boolean): Promise<boolean> {
  const pool = await appDb();
  if (pool) return ((await pool.query("UPDATE support_messages SET handled = $2 WHERE id = $1", [id, handled])).rowCount ?? 0) > 0;
  const messages = await readFileMessages();
  const m = messages.find((x) => x.id === id);
  if (!m) return false;
  m.handled = handled;
  await writeFileMessages(messages);
  return true;
}
