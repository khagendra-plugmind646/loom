"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { FEEDBACK_AREAS, FEEDBACK_LIMITS, type FeedbackArea } from "@/lib/feedback";
import { Button, Field, Input, Notice } from "./ui";

/** Floating "Feedback" button on every page: testers rate what they tried and say what happened. */
export function FeedbackButton() {
  const pathname = usePathname();
  const { publicKey } = useWallet();
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState<number | null>(null);
  const [area, setArea] = useState<FeedbackArea>(FEEDBACK_AREAS[0]);
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setState("sending");
    setError(null);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rating, area, message, contact, wallet: publicKey?.toBase58(), page: pathname }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Couldn't send your feedback");
      setState("sent");
      setMessage("");
      setRating(null);
    } catch (e) {
      setError((e as Error).message);
      setState("idle");
    }
  }

  function close() {
    setOpen(false);
    if (state === "sent") setState("idle");
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed right-3 bottom-3 z-40 rounded-full border border-border bg-surface/90 px-3 py-1.5 text-xs font-semibold shadow-[0_8px_24px_-8px_#0b122055] backdrop-blur transition hover:border-accent sm:right-4 sm:bottom-4 sm:bg-surface sm:px-4 sm:py-2 sm:text-sm"
      >
        Feedback
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={close}>
          <div
            role="dialog"
            aria-label="Send feedback"
            className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="text-base font-semibold">Help us improve Loomzk</div>
              <button onClick={close} className="text-sm text-muted hover:text-fg" aria-label="Close">
                ✕
              </button>
            </div>
            {state === "sent" ? (
              <div className="mt-4">
                <Notice tone="good">Thanks! Your feedback goes straight to the Loomzk team.</Notice>
                <Button className="mt-4 w-full" variant="secondary" onClick={close}>
                  Close
                </Button>
              </div>
            ) : (
              <div className="mt-4 flex flex-col gap-4">
                <Field label="How was it?">
                  <div className="flex gap-2">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        onClick={() => setRating(rating === n ? null : n)}
                        className={`h-9 w-9 rounded-lg border text-sm font-semibold transition ${rating === n ? "border-accent bg-accent-soft text-accent" : "border-border hover:border-border-strong"}`}
                        aria-pressed={rating === n}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label="What were you trying?">
                  <select
                    value={area}
                    onChange={(e) => setArea(e.target.value as FeedbackArea)}
                    className="h-11 w-full rounded-lg border border-border bg-bg/60 px-3 text-sm outline-none focus:border-accent"
                  >
                    {FEEDBACK_AREAS.map((a) => (
                      <option key={a}>{a}</option>
                    ))}
                  </select>
                </Field>
                <Field label="What happened? What was confusing or missing?">
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={4}
                    maxLength={FEEDBACK_LIMITS.message}
                    className="w-full rounded-lg border border-border bg-bg/60 px-4 py-3 text-sm outline-none transition placeholder:text-muted hover:border-border-strong focus:border-accent"
                  />
                </Field>
                <Field label="Contact (optional)" hint="If you're happy to answer a follow-up question">
                  <Input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Email, Telegram or X handle" maxLength={FEEDBACK_LIMITS.contact} />
                </Field>
                {error && <Notice tone="bad">{error}</Notice>}
                <Button loading={state === "sending"} disabled={!message.trim()} onClick={submit}>
                  Send feedback
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
