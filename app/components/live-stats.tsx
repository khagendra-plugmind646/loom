"use client";

import { useConfig, usePayoutCapacity, useSolPrice } from "@/lib/hooks";
import type { ReactNode } from "react";
import { CountUp } from "./motion";
import { Skeleton } from "./ui";

const usd0 = (n: number) => `$${Math.round(n).toLocaleString()}`;

export function LiveStats() {
  const config = useConfig();
  const capacity = usePayoutCapacity();
  const price = useSolPrice();

  if (config.isLoading) return <Skeleton className="h-20" />;
  if (!config.data) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-surface p-6 text-sm text-muted">
        The Loomzk program isn&apos;t initialized on this cluster yet. The operator can set it up from the Operator page.
      </div>
    );
  }
  const s = config.data.stats;
  const liquidity = (capacity.data ?? []).reduce((a, c) => a + c.available, 0n);
  // the price new loans open at: the lower of Pyth and Chainlink
  const sol = price.data ? Number(price.data.openPrice) * 10 ** price.data.expo : null;
  const collateralUsd = sol ? (Number(s.collateralLockedLamports) / 1e9) * sol : null;

  return (
    <section className="grid grid-cols-2 overflow-hidden rounded-2xl border border-border bg-surface shadow-[0_1px_2px_#0b12200a] lg:grid-cols-5" aria-label="Live protocol statistics">
      <Figure label="Available liquidity" value={<CountUp value={Number(liquidity) / 1e6} format={usd0} />} sub="USDC + USDT ready to lend" />
      <Figure
        label="SOL in escrow"
        value={<CountUp value={Number(s.collateralLockedLamports) / 1e9} format={(n) => `${n.toFixed(2)} SOL`} />}
        sub={collateralUsd !== null ? `≈ $${collateralUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : undefined}
      />
      <Figure label="Outstanding debt" value={<CountUp value={Number(s.outstandingDebt) / 1e6} format={usd0} />} sub={`${s.activeLoans} active loans`} />
      <Figure label="Repaid to date" value={<CountUp value={Number(s.totalRepaid) / 1e6} format={usd0} />} sub={`${s.loansRepaid} loans closed`} />
      <Figure
        label="SOL / USD"
        value={sol ? <CountUp value={sol} format={(n) => `$${n.toFixed(2)}`} /> : "—"}
        sub="Pyth + Chainlink"
        // fifth tile: full width on the 2-column phone grid instead of sitting next to an empty cell
        className="col-span-2 border-r-0 border-b-0 lg:col-span-1"
      />
    </section>
  );
}

/** One figure in the hairline-divided stats strip. */
function Figure({ label, value, sub, className }: { label: string; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={`border-b border-r border-border p-5 lg:border-b-0 lg:last:border-r-0 sm:p-6 ${className ?? ""}`}>
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
}
