"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { formatSol, formatStable, loanDebt, parseUnits, type LoanAccount } from "@loom/sdk";
import { Addr, Badge, Button, Card, CardTitle, EmptyState, Field, Input, Notice, PageHeader, Row, Segmented, Skeleton } from "@/components/ui";
import { AddrCopy } from "@/components/addr-copy";
import { useToast } from "@/components/toast";
import { STABLECOINS, explorerUrl, symbolForMint } from "@/lib/env";
import { useConfig, useLoans, useLoom, usePayoutCapacity, usePools, useReserves, useSettlement } from "@/lib/hooks";
import { useNow } from "@/lib/now";
import { explainError, useSendTx } from "@/lib/send";
import { adminAuthMessage, adminHeaders, type AdminAuth } from "@/lib/admin";
import type { Feedback } from "@/lib/feedback";
import type { SupportMessage } from "@/lib/support";

/** Headers proving the admin wallet signed recently. One signature (valid 5 minutes) unlocks the inbox and the database. */
type AuthHeaders = () => Promise<Record<string, string>>;

function useAdminAuth(): AuthHeaders {
  const { publicKey, signMessage } = useWallet();
  const [auth, setAuth] = useState<AdminAuth | null>(null);
  return async () => {
    if (!publicKey || !signMessage) throw new Error("This wallet can't sign messages");
    let a = auth;
    // Re-sign when the previous signature is close to the server's 5-minute window.
    if (!a || a.wallet !== publicKey.toBase58() || Date.now() - a.signedAt > 4 * 60 * 1000) {
      const signedAt = Date.now();
      const sig = await signMessage(new TextEncoder().encode(adminAuthMessage(signedAt)));
      a = { wallet: publicKey.toBase58(), signedAt, signature: btoa(String.fromCharCode(...sig)) };
      setAuth(a);
    }
    return adminHeaders(a);
  };
}

export default function AdminPage() {
  const { publicKey } = useWallet();
  const config = useConfig();
  const authHeaders = useAdminAuth();

  if (config.isLoading) return <Skeleton className="h-64" />;
  if (!publicKey) return <EmptyState title="Connect the admin wallet" />;
  if (!config.data) return <InitializeCard />;
  if (!config.data.admin.equals(publicKey) && !config.data.treasury.equals(publicKey)) {
    return <EmptyState title="This page is only for the Loom admin wallet" />;
  }

  const isAdmin = config.data.admin.equals(publicKey);
  const isTreasury = config.data.treasury.equals(publicKey);
  return (
    <>
      <PageHeader title="Operator" subtitle="Set how much USDC/USDT Loom may pay out, watch the payout wallet, and answer borrowers.">
        <div className="flex gap-2">
          {isAdmin && <Badge tone="good">Admin</Badge>}
          {isTreasury && <Badge tone="good">Payout wallet</Badge>}
        </div>
      </PageHeader>
      <div className="grid gap-6 lg:grid-cols-2">
        <FundsFlowCard treasury={config.data.treasury} />
        {STABLECOINS.map((s) => (
          <PayoutCard key={s.symbol} symbol={s.symbol} mint={s.mint} isAdmin={isAdmin} isTreasury={isTreasury} />
        ))}
        {STABLECOINS.length === 0 && <Notice tone="warn">Configure NEXT_PUBLIC_USDC_MINT and NEXT_PUBLIC_USDT_MINT for this cluster.</Notice>}
        <PoolsCard isAdmin={isAdmin} />
        <RiskCard disabled={!isAdmin} />
        <InboxCard authHeaders={authHeaders} />
        <FeedbackCard authHeaders={authHeaders} />
        <PayoutsCard />
        <DatabaseCard authHeaders={authHeaders} />
      </div>
    </>
  );
}

function InitializeCard() {
  const client = useLoom();
  const { publicKey } = useWallet();
  const { send } = useSendTx();
  const toast = useToast();
  const [treasury, setTreasury] = useState(publicKey?.toBase58() ?? "");
  const [busy, setBusy] = useState(false);

  async function init() {
    if (!publicKey) return;
    setBusy(true);
    try {
      const sig = await send([
        await client.initialize(publicKey, {
          treasury: new PublicKey(treasury),
          liquidationThresholdBps: 10_100,
          liquidationPenaltyBps: 0,
          maxPriceAgeSecs: 120,
          maxConfidenceBps: 200,
          minPrincipal: 10_000_000n,
          maxPrincipal: 100_000_000_000n,
        }),
      ]);
      toast({ kind: "success", title: "Protocol initialized", tx: sig });
    } catch (e) {
      toast({ kind: "error", title: "Initialization failed", body: explainError(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Initialize Loom" subtitle="One-time setup. The connected wallet becomes the admin." />
      <Card className="max-w-xl">
        <Field label="Payout (treasury) wallet" hint="Pays out loans; receives repayments and seized SOL">
          <Input value={treasury} onChange={(e) => setTreasury(e.target.value)} spellCheck={false} />
        </Field>
        <div className="mt-4 text-sm text-muted">
          Defaults: SOL seized at 60% of its opening price (fixed in the program) or below 101% of the debt, Pyth and Chainlink prices ≤ 120s
          old (Pyth confidence band ≤ 2%), loans $10–$100,000.
        </div>
        <Button className="mt-5" loading={busy} onClick={init}>
          Initialize
        </Button>
      </Card>
    </>
  );
}

function FundsFlowCard({ treasury }: { treasury: PublicKey }) {
  return (
    <Card className="lg:col-span-2">
      <CardTitle hint="Automatic: no one pays loans by hand">How funds flow</CardTitle>
      <ol className="grid gap-4 text-sm sm:grid-cols-3">
        <li className="rounded-xl bg-surface-2 p-4">
          <div className="font-medium">1 · Payout wallet approves a limit</div>
          <p className="mt-1 text-muted">
            The payout wallet signs one approval per coin: &ldquo;Loom may pay out up to X&rdquo;. The coins stay in the wallet until a loan uses
            them. No private key is stored anywhere.
          </p>
          <div className="mt-2">
            <AddrCopy value={treasury.toBase58()} />
          </div>
        </li>
        <li className="rounded-xl bg-surface-2 p-4">
          <div className="font-medium">2 · SOL locked → coins sent</div>
          <p className="mt-1 text-muted">
            When a borrower locks 2× SOL, the program sends the USDC/USDT from the payout wallet to the wallet they chose, in the same
            transaction. If the wallet can&apos;t cover it, the borrower is asked to contact you.
          </p>
        </li>
        <li className="rounded-xl bg-surface-2 p-4">
          <div className="font-medium">3 · Repayments and seized SOL</div>
          <p className="mt-1 text-muted">
            Repayments land back in the payout wallet. The keeper (<code>pnpm keeper</code>) sends all SOL from loans at 60% of their opening
            price to the same wallet. For loans past their deadline it sends SOL worth the amount still owed, and the rest goes back to the borrower.
          </p>
        </li>
      </ol>
    </Card>
  );
}

/** Lending pools: create one per stablecoin; shows what depositors have supplied and what is lent out. */
function PoolsCard({ isAdmin }: { isAdmin: boolean }) {
  const client = useLoom();
  const pools = usePools();
  const { publicKey } = useWallet();
  const { send } = useSendTx();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function create(symbol: string, mint: PublicKey) {
    if (!publicKey) return;
    setBusy(symbol);
    try {
      const sig = await send([await client.initPool(publicKey, mint)]);
      toast({ kind: "success", title: `${symbol} lending pool created`, tx: sig });
    } catch (e) {
      toast({ kind: "error", title: "Couldn't create the pool", body: explainError(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="lg:col-span-2">
      <CardTitle hint="Depositors fund loans first; the treasury buys out seized or unpaid pool loans">Lending pools</CardTitle>
      <div className="grid gap-4 sm:grid-cols-2">
        {STABLECOINS.map((s) => {
          const pool = pools.data?.find((p) => p.mint.equals(s.mint));
          return (
            <div key={s.symbol} className="rounded-xl bg-surface-2 p-4 text-sm">
              <div className="font-medium">{s.symbol} pool</div>
              {pool ? (
                <div className="mt-2">
                  <Row label="Available">${formatStable(pool.cash)}</Row>
                  <Row label="Lent out">${formatStable(pool.principalOut)}</Row>
                  <Row label="Depositors earned">${formatStable(pool.interestEarned)}</Row>
                </div>
              ) : pools.isLoading ? (
                <Skeleton className="mt-2 h-16" />
              ) : (
                <Button className="mt-3" variant="secondary" disabled={!isAdmin} loading={busy === s.symbol} onClick={() => create(s.symbol, s.mint)}>
                  Create {s.symbol} pool
                </Button>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-muted">
        Keep the payout approvals above at least as large as what pool loans could owe: if a pool-funded loan is seized or not repaid, the treasury
        pays the pool from that approval and receives the SOL.
      </p>
    </Card>
  );
}

function PayoutCard({ symbol, mint, isAdmin, isTreasury }: { symbol: string; mint: PublicKey; isAdmin: boolean; isTreasury: boolean }) {
  const client = useLoom();
  const config = useConfig();
  const reserves = useReserves();
  const capacity = usePayoutCapacity();
  const { publicKey } = useWallet();
  const { send } = useSendTx();
  const toast = useToast();
  const [limit, setLimit] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const reserve = reserves.data?.find((r) => r.mint.equals(mint));
  const cap = capacity.data?.find((c) => c.mint.equals(mint));

  async function run(kind: "create" | "approve" | "stop" | "sweep") {
    if (!publicKey || !config.data) return;
    setBusy(kind);
    try {
      let sig: string;
      let title: string;
      if (kind === "create") {
        sig = await send([await client.initReserve(publicKey, mint, config.data.treasury)]);
        title = `${symbol} enabled`;
      } else if (kind === "sweep") {
        const dest = getAssociatedTokenAddressSync(mint, config.data.treasury, true);
        sig = await send([
          createAssociatedTokenAccountIdempotentInstruction(publicKey, dest, config.data.treasury, mint),
          await client.withdrawReserve(publicKey, mint, reserve!.vaultBalance, dest),
        ]);
        title = `Moved ${formatStable(reserve!.vaultBalance)} ${symbol} from the old vault to the payout wallet`;
      } else {
        const value = kind === "stop" ? 0n : parseUnits(limit, 6);
        sig = await send([client.approvePayouts(publicKey, mint, value)]);
        title = kind === "stop" ? `${symbol} payouts stopped` : `${symbol} payout limit set to ${formatStable(value)}`;
        setLimit("");
      }
      toast({ kind: "success", title, tx: sig });
    } catch (e) {
      toast({ kind: "error", title: "Transaction failed", body: explainError(e) });
    } finally {
      setBusy(null);
    }
  }

  let limitTooHigh = false;
  try {
    limitTooHigh = !!limit && !!cap && parseUnits(limit, 6) > cap.balance;
  } catch {
    // invalid input is reported when the transaction is attempted
  }

  return (
    <Card>
      <CardTitle hint={<Addr value={mint.toBase58()} />}>{symbol} payouts</CardTitle>
      {reserves.isLoading || capacity.isLoading ? (
        <Skeleton className="h-24" />
      ) : !reserve ? (
        <>
          <p className="text-sm text-muted">{symbol} loans aren&apos;t enabled yet.</p>
          <Button className="mt-4" disabled={!isAdmin} loading={busy === "create"} onClick={() => run("create")}>
            Enable {symbol} loans
          </Button>
        </>
      ) : (
        <>
          <Row label="Payout wallet balance">{cap ? `$${formatStable(cap.balance)}` : "—"}</Row>
          <Row label="Approved for loans">{cap ? `$${formatStable(cap.approved)}` : "—"}</Row>
          <Row label="Available to lend now">{cap ? <span className="font-semibold text-good">${formatStable(cap.available)}</span> : "—"}</Row>
          <Row label="Lent out / repaid in">
            ${formatStable(reserve.totalDisbursed, 0)} / ${formatStable(reserve.totalRepaid, 0)}
          </Row>
          {cap && config.data && cap.available < config.data.minPrincipal ? (
            <div className="mt-3">
              <Notice tone="bad">
                Borrowers can&apos;t get {symbol} right now: they see a &ldquo;contact us&rdquo; form instead.{" "}
                {cap.balance < config.data.minPrincipal ? `Add ${symbol} to the payout wallet.` : "Raise the payout limit."}
              </Notice>
            </div>
          ) : cap && config.data && cap.available < config.data.maxPrincipal ? (
            <div className="mt-3">
              <Notice tone="warn">Loans above ${formatStable(cap.available, 0)} will be turned away until you add funds or raise the limit.</Notice>
            </div>
          ) : null}

          {isTreasury ? (
            <>
              <div className="mt-4 flex gap-2">
                <div className="flex-1">
                  <Input inputMode="decimal" placeholder="New payout limit" value={limit} onChange={(e) => setLimit(e.target.value)} suffix={symbol} />
                </div>
                <Button disabled={!limit || limitTooHigh} loading={busy === "approve"} onClick={() => run("approve")}>
                  Set limit
                </Button>
                <Button variant="secondary" disabled={!cap?.approved} loading={busy === "stop"} onClick={() => run("stop")}>
                  Stop
                </Button>
              </div>
              <div className="mt-2 text-xs text-muted">
                {limitTooHigh ? (
                  <span className="text-bad">The payout wallet only holds ${formatStable(cap!.balance)} {symbol}.</span>
                ) : (
                  <>Replaces the current limit. Each loan lowers it by the amount paid out; &ldquo;Stop&rdquo; sets it to 0.</>
                )}
              </div>
            </>
          ) : (
            <div className="mt-4 text-xs text-muted">Connect the payout wallet to change the limit.</div>
          )}

          {reserve.vaultBalance > 0n && (
            <div className="mt-4 rounded-xl bg-surface-2 p-3 text-sm">
              ${formatStable(reserve.vaultBalance)} {symbol} is still in the old program vault and is no longer used for loans.
              <Button className="mt-2 w-full" variant="secondary" disabled={!isAdmin} loading={busy === "sweep"} onClick={() => run("sweep")}>
                Move it to the payout wallet
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function RiskCard({ disabled }: { disabled: boolean }) {
  const client = useLoom();
  const config = useConfig();
  const { publicKey } = useWallet();
  const { send } = useSendTx();
  const toast = useToast();
  const c = config.data!;
  const [threshold, setThreshold] = useState(String(c.liquidationThresholdBps / 100));
  const [maxAge, setMaxAge] = useState(String(c.maxPriceAgeSecs));
  const [busy, setBusy] = useState(false);

  async function update(params: Parameters<typeof client.updateConfig>[1], label: string) {
    if (!publicKey) return;
    setBusy(true);
    try {
      const sig = await send([await client.updateConfig(publicKey, params)]);
      toast({ kind: "success", title: label, tx: sig });
    } catch (e) {
      toast({ kind: "error", title: "Update failed", body: explainError(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardTitle hint="Applies to new loans only">Risk settings</CardTitle>
      <p className="mb-4 text-sm text-muted">
        All SOL is seized when SOL falls to <span className="font-medium text-fg">60% of its opening price</span>. A loan past its deadline gives
        the treasury SOL worth what is still owed and returns the rest to the borrower. Those rules are fixed in the program. The backstop below also seizes a loan whose SOL is worth less than this share of what is still owed.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Debt backstop">
          <Input value={threshold} onChange={(e) => setThreshold(e.target.value)} suffix="% of debt" inputMode="decimal" />
        </Field>
        <Field label="Max price age">
          <Input value={maxAge} onChange={(e) => setMaxAge(e.target.value)} suffix="s" inputMode="numeric" />
        </Field>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          disabled={disabled}
          loading={busy}
          onClick={() => update({ liquidationThresholdBps: Math.round(Number(threshold) * 100), maxPriceAgeSecs: Number(maxAge) }, "Risk settings updated")}
        >
          Save
        </Button>
        <Button variant={c.paused ? "primary" : "danger"} disabled={disabled} loading={busy} onClick={() => update({ paused: !c.paused }, c.paused ? "New loans resumed" : "New loans paused")}>
          {c.paused ? "Resume new loans" : "Pause new loans"}
        </Button>
      </div>
      <div className="mt-4 text-xs text-muted">Pausing never affects repayments or collateral release.</div>
    </Card>
  );
}

function InboxCard({ authHeaders }: { authHeaders: AuthHeaders }) {
  const toast = useToast();
  const [messages, setMessages] = useState<SupportMessage[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    try {
      const res = await fetch("/api/support", { headers: await authHeaders() });
      if (res.status === 401) throw new Error("Not authorized. Is LOOM_ADMIN_WALLET in app/.env set to this wallet?");
      if (!res.ok) throw new Error("Couldn't load messages");
      setMessages((await res.json()) as SupportMessage[]);
    } catch (e) {
      toast({ kind: "error", title: "Inbox", body: explainError(e) });
    } finally {
      setBusy(false);
    }
  }

  async function setHandled(m: SupportMessage) {
    try {
      const res = await fetch("/api/support", {
        method: "PATCH",
        headers: { "content-type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ id: m.id, handled: !m.handled }),
      });
      if (!res.ok) throw new Error("Couldn't update the message. Reload the inbox and try again.");
      setMessages((ms) => ms?.map((x) => (x.id === m.id ? { ...x, handled: !m.handled } : x)) ?? null);
    } catch (e) {
      toast({ kind: "error", title: "Inbox", body: explainError(e) });
    }
  }

  const open = messages?.filter((m) => !m.handled).length ?? 0;
  return (
    <Card>
      <CardTitle hint={messages ? `${open} open` : "Sign in with the admin wallet to read"}>Help messages</CardTitle>
      {!messages ? (
        <Button variant="secondary" loading={busy} onClick={load}>
          Open inbox
        </Button>
      ) : messages.length === 0 ? (
        <p className="text-sm text-muted">No messages yet.</p>
      ) : (
        <div className="flex max-h-96 flex-col gap-3 overflow-y-auto">
          {messages.map((m) => (
            <div key={m.id} className={`rounded-xl border border-border p-3 text-sm ${m.handled ? "opacity-60" : ""}`}>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                <span>
                  {new Date(m.createdAt).toLocaleString()} · {m.kind === "insufficient-funds" ? `wants ${m.amount ?? "?"} ${m.coin ?? ""}` : "general"}
                </span>
                <Button variant="ghost" className="h-7 px-2 text-xs" onClick={() => setHandled(m)}>
                  {m.handled ? "Reopen" : "Mark handled"}
                </Button>
              </div>
              <div className="mt-1 whitespace-pre-wrap break-words">{m.message}</div>
              <div className="mt-2 text-xs">
                Reply to: <span className="font-medium">{m.contact}</span>
                {m.wallet && (
                  <>
                    {" "}· wallet <AddrCopy value={m.wallet} />
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {messages && (
        <Button variant="ghost" className="mt-3" loading={busy} onClick={load}>
          Refresh
        </Button>
      )}
    </Card>
  );
}

/** Where a loan's SOL is, or went: locked, returned on repayment, or split on settlement (read from the settlement transaction). */
function CollateralCell({ loan }: { loan: LoanAccount }) {
  const settlement = useSettlement(loan);
  const sol = formatSol(loan.collateralLamports);
  if (loan.status === "active") return <span className="text-muted">{sol} SOL locked</span>;
  if (loan.status === "repaid") return <span className="text-muted">{sol} SOL returned</span>;
  if (settlement.isLoading) return <Skeleton className="h-5 w-40" />;
  if (!settlement.data) return <span className="text-muted">{sol} SOL settled</span>;
  const { seizedLamports, returnedLamports, signature } = settlement.data;
  return (
    <a href={explorerUrl("tx", signature)} target="_blank" rel="noreferrer" className="group block leading-tight">
      <span className="block">{formatSol(seizedLamports)} SOL → treasury</span>
      <span className="block text-muted">
        {formatSol(returnedLamports)} SOL → borrower <span className="text-accent group-hover:underline">tx ↗</span>
      </span>
    </a>
  );
}

function PayoutsCard() {
  const loans = useLoans(undefined);
  const now = useNow();
  return (
    <Card className="lg:col-span-2">
      <CardTitle hint={loans.data ? `${loans.data.length} loan${loans.data.length === 1 ? "" : "s"}` : undefined}>Payouts</CardTitle>
      {loans.isLoading ? (
        <Skeleton className="h-24" />
      ) : !loans.data?.length ? (
        <p className="text-sm text-muted">No loans yet. Each loan&apos;s payout will appear here.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1120px] text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="py-2 font-normal">Loan</th>
                <th className="py-2 font-normal">Borrower</th>
                <th className="py-2 font-normal">Paid to wallet</th>
                <th className="py-2 font-normal">Receiving account</th>
                <th className="py-2 text-right font-normal">Paid out</th>
                <th className="py-2 pl-6 font-normal">Opened</th>
                <th className="py-2 text-right font-normal">Repaid / due</th>
                <th className="py-2 pl-4 font-normal">Status</th>
                <th className="py-2 pl-4 font-normal">SOL collateral</th>
              </tr>
            </thead>
            <tbody>
              {loans.data.map((l) => (
                <tr key={l.address.toBase58()} className="border-t border-border">
                  <td className="py-2.5">
                    <span className="mr-2 text-muted">#{l.id.toString()}</span>
                    <Addr value={l.address.toBase58()} />
                  </td>
                  <td className="py-2.5">
                    <AddrCopy value={l.borrower.toBase58()} />
                  </td>
                  <td className="py-2.5">
                    <AddrCopy value={l.recipient.toBase58()} />
                  </td>
                  <td className="py-2.5">
                    <AddrCopy value={getAssociatedTokenAddressSync(l.mint, l.recipient, true).toBase58()} />
                  </td>
                  <td className="py-2.5 text-right tabular-nums">
                    {formatStable(l.principal)} {symbolForMint(l.mint)}
                  </td>
                  <td className="py-2.5 pl-6">{new Date(Number(l.startTs) * 1000).toLocaleDateString()}</td>
                  <td className="py-2.5 text-right tabular-nums">
                    {formatStable(l.repaid)} / {formatStable(l.repaid + (l.status === "active" ? loanDebt(l, now).owed : 0n))}
                  </td>
                  <td className="py-2.5 pl-4">
                    <Badge tone={l.status}>{l.status}</Badge>
                  </td>
                  <td className="py-2.5 pl-4 tabular-nums">
                    <CollateralCell loan={l} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/** Tester feedback from the Feedback button, newest first. */
function FeedbackCard({ authHeaders }: { authHeaders: AuthHeaders }) {
  const toast = useToast();
  const [items, setItems] = useState<Feedback[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    try {
      const res = await fetch("/api/feedback", { headers: await authHeaders() });
      if (res.status === 401) throw new Error("Not authorized. Is LOOM_ADMIN_WALLET in app/.env set to this wallet?");
      if (!res.ok) throw new Error("Couldn't load feedback");
      setItems((await res.json()) as Feedback[]);
    } catch (e) {
      toast({ kind: "error", title: "Feedback", body: explainError(e) });
    } finally {
      setBusy(false);
    }
  }

  const rated = items?.filter((f) => f.rating !== null) ?? [];
  const average = rated.length ? rated.reduce((s, f) => s + (f.rating ?? 0), 0) / rated.length : null;
  return (
    <Card>
      <CardTitle hint={items ? `${items.length} · ${average !== null ? `avg ${average.toFixed(1)}/5` : "no ratings"}` : "Sign in with the admin wallet to read"}>
        Tester feedback
      </CardTitle>
      {!items ? (
        <Button variant="secondary" loading={busy} onClick={load}>
          Open feedback
        </Button>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted">No feedback yet. Share the /test page with testers.</p>
      ) : (
        <div className="flex max-h-96 flex-col gap-3 overflow-y-auto">
          {items.map((f) => (
            <div key={f.id} className="rounded-xl border border-border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                <span>
                  {new Date(f.createdAt).toLocaleString()} · {f.area}
                  {f.page ? ` · ${f.page}` : ""}
                </span>
                {f.rating !== null && <Badge tone={f.rating >= 4 ? "good" : f.rating >= 3 ? "warn" : "bad"}>{f.rating}/5</Badge>}
              </div>
              <div className="mt-1 whitespace-pre-wrap break-words">{f.message}</div>
              {(f.contact || f.wallet) && (
                <div className="mt-2 text-xs">
                  {f.contact && (
                    <>
                      Reply to: <span className="font-medium">{f.contact}</span>{" "}
                    </>
                  )}
                  {f.wallet && (
                    <>
                      · wallet <AddrCopy value={f.wallet} />
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {items && (
        <Button variant="ghost" className="mt-3" loading={busy} onClick={load}>
          Refresh
        </Button>
      )}
    </Card>
  );
}

type DbLoan = {
  loan_id: string;
  status: LoanAccount["status"];
  coin: string | null;
  principal: string;
  total_due: string;
  repaid: string;
  collateral_sol: string;
  settled_to_treasury_sol: string | null;
  settled_to_borrower_sol: string | null;
  opened_at: string;
  borrower: string;
  address: string;
};
type DbEvent = { signature: string; block_time: string | null; name: string; loan_id: string | null };
type DbData = {
  lastRun: { at: string; transactions: number; events: number } | null;
  loanCounts: Record<string, number>;
  eventCount: number;
  loans: DbLoan[];
  events: DbEvent[];
};

const EVENT_LABELS: Record<string, string> = {
  loanOpened: "Loan opened",
  repaymentMade: "Repayment",
  loanRepaid: "Loan repaid, SOL released",
  loanLiquidated: "Loan settled",
  creditLeafInserted: "Added to credit tree",
  certificateIssued: "ZK certificate issued",
  reserveFunded: "Reserve funded",
  reserveWithdrawn: "Reserve withdrawn",
};

/** The admin's private Postgres copy of the on-chain data, read through an admin-signed API route. */
function DatabaseCard({ authHeaders }: { authHeaders: AuthHeaders }) {
  const toast = useToast();
  const [data, setData] = useState<DbData | null>(null);
  const [view, setView] = useState<"loans" | "events">("loans");
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/db", { headers: await authHeaders() });
      const body = await res.json().catch(() => ({}));
      if (res.status === 401) throw new Error("Not authorized. Is LOOM_ADMIN_WALLET in app/.env set to this wallet?");
      if (!res.ok) throw new Error((body as { error?: string }).error ?? "Couldn't load the database");
      setData(body as DbData);
    } catch (e) {
      toast({ kind: "error", title: "Database", body: explainError(e) });
    } finally {
      setBusy(false);
    }
  }

  const sol = (v: string | null) => (v === null ? "—" : Number(v).toLocaleString(undefined, { maximumFractionDigits: 4 }));
  return (
    <Card className="lg:col-span-2">
      <CardTitle hint={data?.lastRun ? `Last synced ${new Date(data.lastRun.at).toLocaleString()}` : "Admin only · sign in with the admin wallet"}>
        Database
      </CardTitle>
      {!data ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" loading={busy} onClick={load}>
            Open database
          </Button>
          <span className="text-xs text-muted">Private Postgres copy of every loan and on-chain event, kept in sync by pnpm indexer.</span>
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2 text-xs">
              {Object.entries(data.loanCounts).map(([status, n]) => (
                <Badge key={status} tone={status as LoanAccount["status"]}>
                  {n} {status}
                </Badge>
              ))}
              <Badge tone="neutral">{data.eventCount} events</Badge>
            </div>
            <div className="flex items-center gap-2">
              <Segmented
                value={view}
                onChange={setView}
                options={[
                  { value: "loans", label: "Loans" },
                  { value: "events", label: "Events" },
                ]}
              />
              <Button variant="ghost" loading={busy} onClick={load}>
                Refresh
              </Button>
            </div>
          </div>
          <div className="max-h-[480px] overflow-auto">
            {view === "loans" ? (
              <table className="w-full min-w-[960px] text-sm">
                <thead className="sticky top-0 bg-surface text-left text-xs text-muted">
                  <tr>
                    <th className="py-2 font-normal">Loan</th>
                    <th className="py-2 font-normal">Status</th>
                    <th className="py-2 text-right font-normal">Principal</th>
                    <th className="py-2 text-right font-normal">Repaid / due</th>
                    <th className="py-2 text-right font-normal">Collateral</th>
                    <th className="py-2 text-right font-normal">To treasury</th>
                    <th className="py-2 text-right font-normal">To borrower</th>
                    <th className="py-2 pl-6 font-normal">Opened</th>
                    <th className="py-2 font-normal">Borrower</th>
                  </tr>
                </thead>
                <tbody>
                  {data.loans.map((l) => (
                    <tr key={l.address} className="border-t border-border tabular-nums">
                      <td className="py-2.5">#{l.loan_id}</td>
                      <td className="py-2.5">
                        <Badge tone={l.status}>{l.status}</Badge>
                      </td>
                      <td className="py-2.5 text-right">
                        {l.principal} {l.coin ?? ""}
                      </td>
                      <td className="py-2.5 text-right">
                        {l.repaid} / {l.total_due}
                      </td>
                      <td className="py-2.5 text-right">{sol(l.collateral_sol)} SOL</td>
                      <td className="py-2.5 text-right">{sol(l.settled_to_treasury_sol)}</td>
                      <td className="py-2.5 text-right">{sol(l.settled_to_borrower_sol)}</td>
                      <td className="py-2.5 pl-6">{new Date(l.opened_at).toLocaleString()}</td>
                      <td className="py-2.5">
                        <AddrCopy value={l.borrower} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="w-full min-w-[720px] text-sm">
                <thead className="sticky top-0 bg-surface text-left text-xs text-muted">
                  <tr>
                    <th className="py-2 font-normal">Time</th>
                    <th className="py-2 font-normal">Event</th>
                    <th className="py-2 font-normal">Loan</th>
                    <th className="py-2 font-normal">Transaction</th>
                  </tr>
                </thead>
                <tbody>
                  {data.events.map((e, i) => (
                    <tr key={`${e.signature}-${i}`} className="border-t border-border">
                      <td className="py-2.5 tabular-nums">{e.block_time ? new Date(e.block_time).toLocaleString() : "—"}</td>
                      <td className="py-2.5">{EVENT_LABELS[e.name] ?? e.name}</td>
                      <td className="py-2.5">{e.loan_id !== null ? `#${e.loan_id}` : "—"}</td>
                      <td className="py-2.5">
                        <a className="text-accent hover:underline" href={explorerUrl("tx", e.signature)} target="_blank" rel="noreferrer">
                          {e.signature.slice(0, 8)}…{e.signature.slice(-4)} ↗
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
