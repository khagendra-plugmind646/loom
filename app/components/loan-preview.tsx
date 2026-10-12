"use client";

import Link from "next/link";
import { useState } from "react";
import { useSolPrice } from "@/lib/hooks";
import { useNow } from "@/lib/now";
import { IconArrow, SolIcon, UsdcIcon } from "./icons";
import { buttonBase, buttonVariant, cx, Skeleton } from "./ui";

const PRESETS = [500, 1_000, 5_000, 10_000];

/**
 * Hero calculator: an estimate from the live Pyth and Chainlink prices using the published terms
 * (2× collateral + 1% headroom, 12% flat fee, seizure at 60% of the opening price).
 * The Borrow page computes the exact on-chain quote.
 */
export function LoanPreview() {
  const price = useSolPrice();
  const [amount, setAmount] = useState(1_000);
  const p = price.data;
  // Like the program: the 60% line is measured from the lower of the two oracle prices, and collateral
  // is valued at the lowest of them (Pyth's price minus its confidence band, or Chainlink).
  const sol = p ? Number(p.openPrice) * 10 ** p.expo : null;
  const lowest = p ? Number(p.lowest) * 10 ** p.expo : null;

  const collateral = lowest ? ((amount * 2) / lowest) * 1.01 : null;
  const seizeAt = sol ? sol * 0.6 : null;
  const now = useNow();
  const due = now ? new Date((now + 365 * 86_400) * 1000).toLocaleDateString(undefined, { dateStyle: "medium" }) : "In 12 months";
  const usd = (n: number, d = 2) => `$${n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })}`;

  return (
    <div className="relative">
      <div className="absolute -inset-6 -z-10 rounded-[32px] bg-gradient-to-br from-accent/20 via-transparent to-mint/20 blur-2xl" aria-hidden />
      <div className="rounded-3xl border border-border bg-surface p-6 shadow-[0_24px_64px_-16px_#0b122033] sm:p-7">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">Loan preview</div>
          <div className="flex items-center gap-1.5 rounded-full bg-good-soft px-2.5 py-1 text-xs font-medium text-good">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-good opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-good" />
            </span>
            SOL {sol ? usd(sol) : "…"} · Pyth + Chainlink
          </div>
        </div>

        <div className="mt-5 rounded-2xl bg-surface-2 p-4">
          <div className="text-xs font-medium text-muted">You receive</div>
          <div className="mt-1 flex items-center justify-between gap-3">
            <input
              aria-label="Loan amount in USDC"
              inputMode="decimal"
              value={amount.toLocaleString()}
              onChange={(e) => setAmount(Math.min(100_000, Number(e.target.value.replace(/[^0-9]/g, "")) || 0))}
              className="w-full min-w-0 bg-transparent text-3xl font-semibold tracking-tight outline-none"
            />
            <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-sm font-semibold shadow-[0_1px_2px_#0b12201a]">
              <UsdcIcon size={18} /> USDC
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setAmount(p)}
                className={cx(
                  "rounded-full border px-2.5 py-1 text-xs font-medium transition",
                  amount === p ? "border-accent bg-accent-soft text-accent" : "border-border bg-surface text-muted hover:text-fg",
                )}
              >
                ${p.toLocaleString()}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 rounded-2xl border border-border p-4">
          <div className="text-xs font-medium text-muted">You lock in escrow</div>
          <div className="mt-1 flex items-center justify-between">
            {collateral !== null ? (
              <span className="text-2xl font-semibold tracking-tight">{collateral.toLocaleString(undefined, { maximumFractionDigits: 3 })}</span>
            ) : (
              <Skeleton className="h-8 w-28" />
            )}
            <span className="flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-sm font-semibold">
              <SolIcon size={18} /> SOL
            </span>
          </div>
        </div>

        <dl className="mt-5 space-y-2.5 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">Interest</dt>
            <dd className="font-semibold">12% a year · {usd(amount * 0.01)} per month</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Repay after 12 months (most)</dt>
            <dd className="font-semibold">{usd(amount * 1.12)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Repay by</dt>
            <dd className="font-semibold">{due}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Collateral seized if SOL ≤</dt>
            <dd className="font-semibold text-warn">{seizeAt ? usd(seizeAt) : "…"}</dd>
          </div>
        </dl>

        <div className="mt-4" aria-hidden>
          <div className="relative h-1.5 rounded-full bg-gradient-to-r from-bad/70 via-warn/60 to-good/70">
            <div className="absolute top-1/2 left-[60%] h-3.5 w-0.5 -translate-y-1/2 rounded bg-fg" />
          </div>
          <div className="relative mt-1.5 h-4 text-[11px] text-muted">
            <span className="absolute left-0">$0</span>
            <span className="absolute left-[60%] -translate-x-1/2 font-medium text-fg">Seizure line · 60%</span>
            <span className="absolute right-0">Today</span>
          </div>
        </div>

        <Link href="/borrow" className={cx(buttonBase, buttonVariant.primary, "mt-6 h-12 w-full text-base")}>
          Continue to borrow <IconArrow />
        </Link>
        <p className="mt-3 text-center text-[11px] text-muted">Estimate from the live oracle price. The exact quote is computed on the Borrow page.</p>
      </div>
    </div>
  );
}
