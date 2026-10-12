import { randomUUID } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { isAdminRequest } from "@/lib/admin-server";
import { FEEDBACK_AREAS, FEEDBACK_LIMITS, type Feedback, type FeedbackArea } from "@/lib/feedback";
import { STORAGE_UNAVAILABLE } from "@/lib/db-server";
import { addFeedback, listFeedback } from "@/lib/feedback-server";

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Anyone can leave feedback. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const message = text(body?.message, FEEDBACK_LIMITS.message);
  if (!body || !message) return Response.json({ error: "Tell us what happened" }, { status: 400 });
  let wallet: string | null = null;
  try {
    wallet = typeof body.wallet === "string" && body.wallet ? new PublicKey(body.wallet).toBase58() : null;
  } catch {
    wallet = null;
  }
  const rating = Number(body.rating);
  const entry: Feedback = {
    id: randomUUID(),
    createdAt: Date.now(),
    rating: Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null,
    area: (FEEDBACK_AREAS as readonly string[]).includes(body.area as string) ? (body.area as FeedbackArea) : "Other",
    message,
    contact: text(body.contact, FEEDBACK_LIMITS.contact) || null,
    wallet,
    page: text(body.page, 100) || null,
  };
  try {
    await addFeedback(entry);
  } catch {
    return Response.json({ error: STORAGE_UNAVAILABLE }, { status: 503 });
  }
  return Response.json({ ok: true });
}

/** Admin only: all feedback, newest first. */
export async function GET(req: Request) {
  if (!isAdminRequest(req)) return Response.json({ error: "Admin signature required" }, { status: 401 });
  return Response.json(await listFeedback());
}
