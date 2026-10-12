"use client";

import { useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  COLLATERAL_RATIO_BPS,
  CreditMerkleTree,
  CREDIT_INTEREST_BPS,
  INTEREST_BPS,
  formatDuration,
  loanDebt,
  minInterestSecs,
  LOAN_TERM_SECS,
  LoomClient,
  collateralRatioBps,
  formatSol,
  formatStable,
  lamportsToStable,
  priceToNumber,
  settleReason,
  type LoanAccount,
} from "@loom/sdk";
import { Addr, Badge, Button, Card, CardTitle, EmptyState, PageHeader, Row, Segmented, Skeleton, Stat } from "@/components/ui";
import { useToast } from "@/components/toast";
import { explorerUrl, symbolForMint } from "@/lib/env";
import { useConfig, useCreditTree, useEscrowBalances, useLoans, useLoom, usePayoutCapacity, usePools, useReserves, useSolPrice } from "@/lib/hooks";
import { useNow } from "@/lib/now";
import { explainError, useSendTx } from "@/lib/send";

type Filter = "active" | "all";

export default function TransparencyPage() {
  const client = useLoom();
  const config = useConfig();
  const reserves = useReserves();
  const pools = usePools();
  const capacity = usePayoutCapacity();
  const loans = useLoans(undefined);
  const price = useSolPrice();
  const escrows = useEscrowBalances(loans.data);
  const tree = useCreditTree();
  const [filter, setFilter] = useState<Filter>("active");

  const active = (loans.data ?? []).filter((l) => l.status === "active");
  const escrowTotal = escrows.data ? [...escrows.data.values()].reduce((a, b) => a + b, 0n) : null;
  const collateralTotal = active.reduce((a, l) => a + l.collateralLamports, 0n);
  const now = useNow();
  const outstanding = active.reduce((a, l) => a + loanDebt(l, now).owed, 0n);
  const collateralUsd = price.data ? lamportsToStable(collateralTotal, price.data.price, price.data.expo) : null;
  const protocolRatio = collateralUsd !== null && outstanding > 0n ? Number((collateralUsd * 10_000n) / outstanding) / 100 : null;

  const treeCheck = useMemo(() => {
    if (!loans.data || !tree.data) return null;
    try {
      const leaves = LoomClient.creditLeaves(loans.data);
      return { ok: new CreditMerkleTree(leaves).root === tree.data.root && BigInt(leaves.length) === tree.data.nextIndex, leaves: leaves.length };
    } catch {
      return { ok: false, leaves: 0 };
    }
  }, [loans.data, tree.data]);

  const escrowOk = escrows.data
    ? active.every((l) => (escrows.data!.get(l.address.toBase58()) ?? 0n) >= l.collateralLamports)
    : null;

  return (
    <>
      <PageHeader
        title="Proof of reserves"
        subtitle="Everything below is read live from Solana, not from our servers. Click any address to check it on a block explorer."
      />

      {config.isLoading ? (
        <Skeleton className="h-28" />
      ) : !config.data ? (
        <EmptyState title="Program not initialized on this cluster" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label="SOL held in loan escrows"
              value={escrowTotal !== null ? `${formatSol(escrowTotal, 2)} SOL` : `${formatSol(collateralTotal, 2)} SOL`}
              sub={collateralUsd !== null ? `≈ $${formatStable(collateralUsd, 0)} collateral` : undefined}
            />
            <Stat label="Outstanding debt" value={`$${formatStable(outstanding, 0)}`} sub={`${active.length} active loans`} />
            <Stat
              label="Collateralization"
              value={protocolRatio !== null ? `${protocolRatio.toFixed(0)}%` : "—"}
              sub="escrowed SOL value ÷ debt"
              tone={protocolRatio === null ? undefined : protocolRatio >= 150 ? "good" : protocolRatio >= 120 ? "warn" : "bad"}
            />
            <Stat label="Repaid to treasury" value={`$${formatStable(config.data.stats.totalRepaid, 0)}`} sub={`${config.data.stats.loansRepaid} loans repaid`} />
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardTitle hint="Loans are paid from the lending pool first, then from the treasury wallet up to the limit it approved">Lending liquidity</CardTitle>
              {reserves.isLoading ? (
                <Skeleton className="h-20" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-muted">
                      <tr>
                        <th className="py-2 font-normal">Asset</th>
                        <th className="py-2 text-right font-normal">Lending pool: available / lent out</th>
                        <th className="py-2 text-right font-normal">Treasury: available to lend</th>
                        <th className="py-2 text-right font-normal">Lent out</th>
                        <th className="py-2 text-right font-normal">Repaid in</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(reserves.data ?? []).map((r) => (
                        <tr key={r.address.toBase58()} className="border-t border-border">
                          <td className="py-2.5 font-medium">{symbolForMint(r.mint)}</td>
                          <td className="py-2.5 text-right tabular-nums">
                            {(() => {
                              const p = pools.data?.find((x) => x.mint.equals(r.mint));
                              return p ? `$${formatStable(p.cash, 0)} / $${formatStable(p.principalOut, 0)}` : "—";
                            })()}
                          </td>
                          <td className="py-2.5 text-right tabular-nums">
                            {(() => {
                              const c = capacity.data?.find((x) => x.mint.equals(r.mint));
                              return c ? `$${formatStable(c.available)}` : "—";
                            })()}
                          </td>
                          <td className="py-2.5 text-right tabular-nums">${formatStable(r.totalDisbursed, 0)}</td>
                          <td className="py-2.5 text-right tabular-nums">${formatStable(r.totalRepaid, 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card>
              <CardTitle>Integrity checks</CardTitle>
              <Check ok={escrowOk} label="Every active loan's escrow holds its collateral" />
              <Check
                ok={pools.data ? pools.data.every((p) => p.vaultBalance >= p.cash) : null}
                label="Every lending pool vault holds at least its recorded cash"
              />
              <Check
                ok={escrowTotal === null ? null : config.data.stats.collateralLockedLamports === collateralTotal}
                label="Program accounting matches loan accounts"
              />
              <Check ok={treeCheck?.ok ?? null} label={`ZK credit tree root recomputed from ${treeCheck?.leaves ?? "…"} repaid loans`} />
              <Check ok={price.data ? price.data.fullyVerified : null} label="Pyth update fully verified (Wormhole)" />
              <Check ok={price.data ? price.data.chainlink.description === "SOL / USD" : null} label="Chainlink feed is SOL / USD" />
            </Card>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Card>
              <CardTitle hint="Compiled into the program">Immutable loan terms</CardTitle>
              <Row label="Minimum collateral">{Number(COLLATERAL_RATIO_BPS) / 100}% of principal</Row>
              <Row label="Interest">
                {Number(INTEREST_BPS) / 100}% a year for the time borrowed (min. {formatDuration(minInterestSecs())})
              </Row>
              <Row label="With a ZK credit certificate">{Number(CREDIT_INTEREST_BPS) / 100}% a year, up to 2× the repaid loan it proves</Row>
              <Row label="Maximum term">{LOAN_TERM_SECS / 86_400} days</Row>
              <Row label="All SOL seized when">price ≤ 60% of its price at opening</Row>
              <Row label="Unpaid at deadline">SOL worth the debt to treasury, rest back to borrower</Row>
              <Row label="Seized SOL and repayments go to">Loom treasury (visible in each transaction)</Row>
            </Card>
            <Card>
              <CardTitle hint="Snapshotted into every loan at origination">Risk settings</CardTitle>
              <Row label="Debt backstop">collateral below {config.data.liquidationThresholdBps / 100}% of debt</Row>
              <Row label="Oracle">
                Pyth + Chainlink SOL/USD · max age {config.data.maxPriceAgeSecs}s{" "}
                {price.data && `· $${priceToNumber(price.data).toFixed(2)} / $${(Number(price.data.chainlinkPrice) * 10 ** price.data.expo).toFixed(2)}`}
              </Row>
              <Row label="Program">
                <Addr value={client.programId.toBase58()} />
              </Row>
            </Card>
          </div>

          <Card className="mt-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold">All loans</h2>
              <Segmented
                value={filter}
                onChange={setFilter}
                options={[
                  { value: "active", label: `Active (${active.length})` },
                  { value: "all", label: `All (${loans.data?.length ?? 0})` },
                ]}
              />
            </div>
            <LoanTable loans={filter === "active" ? active : (loans.data ?? [])} escrows={escrows.data} />
          </Card>

          <Card className="mt-6">
            <CardTitle>Verify it yourself</CardTitle>
            <pre className="overflow-x-auto rounded-xl bg-surface-2 p-4 text-xs leading-relaxed">
{`# Every loan, escrow and reserve is a public account of program ${client.programId.toBase58()}
solana program show ${client.programId.toBase58()}
solana account ${client.pda.config().toBase58()}          # config + live protocol stats
solana balance <escrow address>                            # SOL behind any loan
solana confirm -v <transaction signature>                  # any loan: SOL locked + stablecoin paid out

# Reproduce the build and compare the on-chain bytecode hash:
anchor build --verifiable && solana-verify get-program-hash ${client.programId.toBase58()}`}
            </pre>
          </Card>
        </>
      )}
    </>
  );
}

function Check({ ok, label }: { ok: boolean | null; label: string }) {
  return (
    <div className="flex items-start gap-3 py-2 text-sm">
      <span
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${
          ok === null ? "bg-surface-2 text-muted" : ok ? "bg-good-soft text-good" : "bg-bad-soft text-bad"
        }`}
        aria-label={ok === null ? "checking" : ok ? "passed" : "failed"}
      >
        {ok === null ? "…" : ok ? "✓" : "!"}
      </span>
      <span>{label}</span>
    </div>
  );
}

function LoanTable({ loans, escrows }: { loans: LoanAccount[]; escrows?: Map<string, bigint> }) {
  const client = useLoom();
  const price = useSolPrice();
  const config = useConfig();
  const { publicKey } = useWallet();
  const { sendWithPrice } = useSendTx();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const now = useNow();

  if (loans.length === 0) return <p className="text-sm text-muted">No loans to show.</p>;

  async function settle(loan: LoanAccount) {
    if (!publicKey || !config.data) return toast({ kind: "error", title: "Connect a wallet to settle loans" });
    setBusy(loan.address.toBase58());
    try {
      const treasury = config.data.treasury;
      const sig = await sendWithPrice(async (priceUpdate) => [await client.liquidate({ caller: publicKey, loan, treasury, priceUpdate })], config.data.maxPriceAgeSecs);
      toast({ kind: "success", title: `Loan #${loan.id} settled by the program's rule`, tx: sig });
    } catch (e) {
      toast({ kind: "error", title: "Settlement failed", body: explainError(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="text-left text-xs text-muted">
          <tr>
            <th className="py-2 font-normal">#</th>
            <th className="py-2 font-normal">Borrower</th>
            <th className="py-2 text-right font-normal">Principal</th>
            <th className="py-2 text-right font-normal">Repaid / due</th>
            <th className="py-2 text-right font-normal">Escrow</th>
            <th className="py-2 text-right font-normal">Ratio</th>
            <th className="py-2 pl-6 font-normal">Maturity</th>
            <th className="py-2 pl-4 font-normal">Status</th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody>
          {loans.map((l) => {
            const outstanding = loanDebt(l, now).owed;
            const ratio = price.data && l.status === "active" ? Number(collateralRatioBps(l.collateralLamports, outstanding, price.data.highest, price.data.expo)) : null;
            const matured = now > 0 && now > Number(l.maturityTs);
            const settleable = l.status === "active" && !!price.data && now > 0 && settleReason(l, price.data.highest, price.data.expo, now) !== null;
            const escrowBal = escrows?.get(l.address.toBase58());
            return (
              <tr key={l.address.toBase58()} className="border-t border-border">
                <td className="py-2.5">
                  <Addr value={l.address.toBase58()} />
                </td>
                <td className="py-2.5">
                  <Addr value={l.borrower.toBase58()} />
                </td>
                <td className="py-2.5 text-right tabular-nums">
                  {formatStable(l.principal, 0)} {symbolForMint(l.mint)}
                </td>
                <td className="py-2.5 text-right tabular-nums">
                  {formatStable(l.repaid, 0)} / {formatStable(l.repaid + outstanding, 0)}
                </td>
                <td className="py-2.5 text-right tabular-nums">
                  {l.status === "active" ? (
                    <a className="hover:underline" href={explorerUrl("address", client.pda.escrow(l.address).toBase58())} target="_blank" rel="noreferrer" title="Escrow account">
                      {formatSol(escrowBal ?? l.collateralLamports, 2)} SOL
                    </a>
                  ) : (
                    <span className="text-muted">released</span>
                  )}
                </td>
                <td className={`py-2.5 text-right tabular-nums ${ratio !== null && ratio < l.liquidationThresholdBps ? "text-bad" : ""}`}>
                  {ratio !== null ? `${(ratio / 100).toFixed(0)}%` : "—"}
                </td>
                <td className="py-2.5 pl-6">{new Date(Number(l.maturityTs) * 1000).toLocaleDateString()}</td>
                <td className="py-2.5 pl-4">
                  <Badge tone={l.status}>{l.status}</Badge>
                </td>
                <td className="py-2.5 text-right">
                  {settleable && (
                    <Button variant="danger" className="h-8 px-3 text-xs" loading={busy === l.address.toBase58()} onClick={() => settle(l)}>
                      {matured ? "Settle default" : "Seize SOL"}
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
