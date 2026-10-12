import { randomUUID } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { SUPPORT_LIMITS, type SupportMessage } from "@/lib/support";
import { isAdminRequest } from "@/lib/admin-server";
import { STORAGE_UNAVAILABLE } from "@/lib/db-server";
import { addMessage, listMessages, setHandled } from "@/lib/support-server";

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Anyone can send a message to the admin. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "Invalid request" }, { status: 400 });
  const contact = text(body.contact, SUPPORT_LIMITS.contact);
  const message = text(body.message, SUPPORT_LIMITS.message);
  if (!contact || !message) return Response.json({ error: "Add your contact details and a message" }, { status: 400 });
  let wallet: string | null = null;
  try {
    wallet = typeof body.wallet === "string" && body.wallet ? new PublicKey(body.wallet).toBase58() : null;
  } catch {
    return Response.json({ error: "Invalid wallet address" }, { status: 400 });
  }
  const entry: SupportMessage = {
    id: randomUUID(),
    createdAt: Date.now(),
    kind: body.kind === "insufficient-funds" ? "insufficient-funds" : "general",
    wallet,
    coin: text(body.coin, 10) || null,
    amount: text(body.amount, 30) || null,
    contact,
    message,
    handled: false,
  };
  try {
    await addMessage(entry);
  } catch {
    return Response.json({ error: STORAGE_UNAVAILABLE }, { status: 503 });
  }
  return Response.json({ ok: true });
}

/** Admin only: the inbox, newest first. */
export async function GET(req: Request) {
  if (!isAdminRequest(req)) return Response.json({ error: "Admin signature required" }, { status: 401 });
  return Response.json(await listMessages());
}

/** Admin only: mark a message handled / not handled. */
export async function PATCH(req: Request) {
  if (!isAdminRequest(req)) return Response.json({ error: "Admin signature required" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { id?: string; handled?: boolean } | null;
  if (!body?.id || !(await setHandled(body.id, !!body.handled))) return Response.json({ error: "Message not found" }, { status: 404 });
  return Response.json({ ok: true });
}
