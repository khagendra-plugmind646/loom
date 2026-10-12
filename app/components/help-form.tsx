"use client";

import { useState } from "react";
import { SUPPORT_LIMITS, type SupportMessage } from "@/lib/support";
import { Button, Field, Input, Notice } from "./ui";

/** Sends a message to the admin's inbox on the Operator page. */
export function HelpForm({
  kind,
  wallet,
  coin,
  amount,
  defaultMessage = "",
}: {
  kind: SupportMessage["kind"];
  wallet?: string | null;
  coin?: string;
  amount?: string;
  defaultMessage?: string;
}) {
  const [contact, setContact] = useState("");
  const [message, setMessage] = useState(defaultMessage);
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setState("sending");
    setError(null);
    try {
      const res = await fetch("/api/support", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, wallet, coin, amount, contact, message }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Couldn't send your message");
      setState("sent");
    } catch (e) {
      setError((e as Error).message);
      setState("idle");
    }
  }

  if (state === "sent") return <Notice tone="good">Message sent. We&apos;ll get back to you at {contact}.</Notice>;

  return (
    <div className="flex flex-col gap-3">
      <Field label="How can we reach you?">
        <Input
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          placeholder="Email, Telegram @handle or phone"
          maxLength={SUPPORT_LIMITS.contact}
        />
      </Field>
      <Field label="Message">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          maxLength={SUPPORT_LIMITS.message}
          className="w-full rounded-lg border border-border bg-bg/60 px-4 py-3 text-sm outline-none transition placeholder:text-muted hover:border-border-strong focus:border-accent"
        />
      </Field>
      {error && <Notice tone="bad">{error}</Notice>}
      <Button variant="secondary" loading={state === "sending"} disabled={!contact.trim() || !message.trim()} onClick={submit}>
        Send to the Loomzk team
      </Button>
    </div>
  );
}
