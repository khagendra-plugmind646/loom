"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import {
  PROTOCOL_FEE_BPS,
  formatStable,
  parseUnits,
  poolApyBps,
  poolValue,
  positionValue,
  type LenderPositionAccount,
  type PoolAccount,
} from "@loom/sdk";
import { Button, Card, CardTitle, EmptyState, Input, Notice, PageHeader, Row, Segmented, Skeleton, Stat } from "@/components/ui";
import { useToast } from "@/components/toast";
import { STABLECOINS } from "@/lib/env";
import { useBalances, useLenderPositions, useLoans, useLoom, usePools } from "@/lib/hooks";
import { explainError, useSendTx } from "@/lib/send";

const pct = (bps: number) => `${(bps / 100).toFixed(2)}%`;

export default function EarnPage() {
  const pools = usePools();
  const { publicKey } = useWallet();
  const positions = useLenderPositions(publicKey);

  return (
    <>
      <PageHeader
        title="Earn on USDC and USDT"
        subtitle="Deposit stablecoins into Loomzk's lending pool. New loans are funded from it first, and depositors earn the interest borrowers pay."
      />
      {pools.isLoading ? (
        <Skeleton className="h-64" />
      ) : !pools.data?.length ? (
        <EmptyState title="No lending pool yet">The operator creates a pool for each stablecoin from the Operator page.</EmptyState>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {STABLECOINS.map((coin) => {
            const pool = pools.data.find((p) => p.mint.equals(coin.mint));
            return pool ? (
              <PoolCard
                key={coin.symbol}
                symbol={coin.symbol}
                pool={pool}
                position={positions.data?.find((p) => p.mint.equals(coin.mint))}
              />
            ) : null;
          })}
        </div>
      )}
      <Card className="mt-6">
        <CardTitle>How depositors are protected</CardTitle>
        <ul className="space-y-2 text-sm text-muted">
          <li>• Every loan is backed by SOL worth at least 2× what was borrowed, locked in its own on-chain escrow.</li>
          <li>
            • If a pool-funded loan is seized or not repaid, Loomzk&apos;s treasury pays the pool everything the loan still owes and takes the SOL. Depositors
            are repaid in full; Loomzk carries the SOL price risk.
          </li>
          <li>• Depositors earn {100 - Number(PROTOCOL_FEE_BPS) / 100}% of the interest on pool-funded loans; Loomzk keeps {Number(PROTOCOL_FEE_BPS) / 100}%.</li>
          <li>
            • You can withdraw whatever the pool isn&apos;t currently lending out. Lent-out money returns as borrowers repay. If the treasury can&apos;t
            buy out a loan, settling it waits until it can, so withdrawals of that part can be delayed.
          </li>
        </ul>
      </Card>
    </>
  );
}

function PoolCard({ symbol, pool, position }: { symbol: string; pool: PoolAccount; position?: LenderPositionAccount }) {
  const client = useLoom();
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const loans = useLoans(undefined);
  const balances = useBalances();
  const { send } = useSendTx();
  const toast = useToast();
  const [mode, setMode] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  const value = poolValue(pool);
  const active = (loans.data ?? []).filter((l) => l.status === "active" && l.fromPool && l.mint.equals(pool.mint));
  const apy = poolApyBps(pool, active);
  const utilization = value === 0n ? 0 : Number((pool.principalOut * 10_000n) / value);
  const mine = position ? positionValue(pool, position.shares) : 0n;
  const earned = position ? mine + position.withdrawn - position.deposited : 0n;
  const withdrawable = mine < pool.cash ? mine : pool.cash;
  const wallet = balances.data?.tokens.find((t) => t.symbol === symbol)?.amount ?? 0n;

  async function submit() {
    if (!publicKey) return setVisible(true);
    let units: bigint;
    try {
      units = parseUnits(amount, 6);
    } catch {
      return toast({ kind: "error", title: "Enter a valid amount" });
    }
    if (units <= 0n) return;
    setBusy(true);
    try {
      if (mode === "deposit") {
        const sig = await send([await client.deposit(publicKey, pool.mint, units)]);
        toast({ kind: "success", title: `Deposited ${formatStable(units)} ${symbol}`, tx: sig });
      } else {
        if (!position || units > withdrawable) throw new Error(`You can withdraw up to ${formatStable(withdrawable)} ${symbol} right now`);
        // Shares for the amount; withdrawing everything you can uses all your shares.
        const shares = units >= mine ? position.shares : (units * pool.totalShares) / value;
        const sig = await send([await client.withdraw(publicKey, pool.mint, shares)]);
        toast({ kind: "success", title: `Withdrew ${formatStable(units)} ${symbol}`, tx: sig });
      }
      setAmount("");
    } catch (e) {
      toast({ kind: "error", title: mode === "deposit" ? "Deposit failed" : "Withdrawal failed", body: explainError(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardTitle hint={`${pct(utilization)} lent out`}>{symbol} pool</CardTitle>
      <div className="grid grid-cols-2 gap-4">
        <Stat label="Current yield" value={pct(apy)} sub="a year, from active loans" tone="good" />
        <Stat label="In the pool" value={`$${formatStable(value, 0)}`} sub={`$${formatStable(pool.cash, 0)} available`} />
      </div>
      <div className="mt-4">
        <Row label="Lent out">${formatStable(pool.principalOut)}</Row>
        <Row label="Interest earned by depositors">${formatStable(pool.interestEarned)}</Row>
      </div>

      <div className="mt-5 rounded-xl bg-surface-2 p-4">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">Your deposit</div>
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: "deposit", label: "Deposit" },
              { value: "withdraw", label: "Withdraw" },
            ]}
          />
        </div>
        {position && position.shares > 0n && (
          <div className="mt-3">
            <Row label="Worth now">
              {formatStable(mine)} {symbol}
            </Row>
            <Row label="Earned so far">
              <span className="text-good">
                {formatStable(earned > 0n ? earned : 0n)} {symbol}
              </span>
            </Row>
          </div>
        )}
        <div className="mt-3 text-xs text-muted">
          {mode === "deposit"
            ? `Your ${symbol}: ${formatStable(wallet)}`
            : `Withdrawable now: ${formatStable(withdrawable)} ${symbol}`}
        </div>
        <div className="mt-2 flex gap-2">
          <div className="flex-1">
            <Input inputMode="decimal" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} suffix={symbol} aria-label={`${mode} amount`} />
          </div>
          <Button
            variant="secondary"
            onClick={() => setAmount(formatStable(mode === "deposit" ? wallet : withdrawable, 6).replace(/,/g, ""))}
            disabled={!publicKey}
          >
            Max
          </Button>
        </div>
        <Button className="mt-3 w-full" loading={busy} disabled={!!publicKey && !amount} onClick={submit}>
          {!publicKey ? "Connect wallet" : mode === "deposit" ? `Deposit ${symbol}` : `Withdraw ${symbol}`}
        </Button>
        {mode === "withdraw" && position && mine > pool.cash && (
          <Notice tone="neutral">
            {formatStable(mine - pool.cash)} {symbol} of your deposit is lent out right now and becomes withdrawable as borrowers repay.
          </Notice>
        )}
      </div>
    </Card>
  );
}
