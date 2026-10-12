"use client";

import type { ReactNode } from "react";
import { priceToNumber } from "@loom/sdk";
import { useSolPrice } from "@/lib/hooks";
import { SolIcon, UsdcIcon, UsdtIcon } from "./icons";
import { Skeleton } from "./ui";

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Live price of 1 SOL in USD, USDC and USDT: the same price the Borrow page quotes from (the lower of
 * Pyth and Chainlink). Loom values USDC and USDT at $1, exactly like the program.
 */
export function SolPrice() {
  const price = useSolPrice();
  const p = price.data;
  const sol = p ? Number(p.openPrice) * 10 ** p.expo : null;

  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-[0_1px_2px_#0b12200a]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <SolIcon size={18} /> 1 SOL
        </div>
        <div className="flex items-center gap-1.5 text-xs font-medium text-good">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-good opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-good" />
          </span>
          Live
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Quote icon={<span className="inline-flex h-4 w-4 items-center justify-center text-xs leading-none font-semibold">$</span>} label="USD" value={sol} />
        <Quote icon={<UsdcIcon size={16} />} label="USDC" value={sol} />
        <Quote icon={<UsdtIcon size={16} />} label="USDT" value={sol} />
      </div>
      <div className="mt-3 text-xs text-muted">
        {p ? (
          <>
            Pyth ${fmt(priceToNumber(p))} · Chainlink ${fmt(Number(p.chainlinkPrice) * 10 ** p.expo)}. Loans use the lower price; USDC and USDT
            count as $1.
          </>
        ) : price.isError ? (
          "SOL price unavailable right now."
        ) : (
          "Reading Pyth and Chainlink…"
        )}
      </div>
    </div>
  );
}

function Quote({ icon, label, value }: { icon: ReactNode; label: string; value: number | null }) {
  return (
    <div className="rounded-xl bg-surface-2 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted">
        {icon} {label}
      </div>
      <div className="mt-1 text-lg font-semibold tracking-tight tabular-nums">
        {value === null ? <Skeleton className="h-6 w-16" /> : label === "USD" ? `$${fmt(value)}` : fmt(value)}
      </div>
    </div>
  );
}
