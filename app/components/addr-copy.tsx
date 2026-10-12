"use client";

import { useState } from "react";
import { explorerUrl } from "@/lib/env";

/** Address with an explorer link and a copy button; `full` shows the whole address instead of a short form. */
export function AddrCopy({ value, full }: { value: string; full?: boolean }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <a href={explorerUrl("address", value)} target="_blank" rel="noreferrer" className="break-all font-mono text-xs text-accent hover:underline" title={value}>
        {full ? value : `${value.slice(0, 4)}…${value.slice(-4)}`}
      </a>
      <button type="button" onClick={copy} className="shrink-0 rounded px-1 text-xs text-muted hover:bg-surface-2 hover:text-fg" aria-label="Copy address">
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}
