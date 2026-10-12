"use client";

import { useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  defaultBreakEvenUsd,
  defaultSplit,
  formatRate,
  formatSol,
  formatStable,
  loanDebt,
  parseUnits,
  priceToNumber,
  seizePriceAfterTopUp,
  seizePriceUsd,
  type LoanAccount,
} from "@loom/sdk";
import { Addr, Badge, Button, buttonBase, buttonVariant, Card, cx, EmptyState, Input, Notice, PageHeader, Progress, Row, Segmented, Skeleton } from "@/components/ui";
import { useToast } from "@/components/toast";
import { AddrCopy } from "@/components/addr-copy";
import { STABLECOINS, explorerUrl, symbolForMint } from "@/lib/env";
import { useBalances, useConfig, useLoans, useLoom, useSettlement, useSolPrice } from "@/lib/hooks";
import { downloadCalendarEvent } from "@/lib/calendar";
import { loadNote } from "@/lib/notes";
import { useNow } from "@/lib/now";
import { explainError, useSendTx } from "@/lib/send";

const DAY = 86_400;

export default function LoansPage() {
  const { publicKey, connecting } = useWallet();
  const loans = useLoans(publicKey);

  return (
    <>
      <PageHeader title="My loans" subtitle="Repay any time before maturity. The final payment releases your SOL from escrow automatically.">
        <Link href="/borrow" className={cx(buttonBase, buttonVariant.primary)}>
          New loan
        </Link>
      </PageHeader>
      {!publicKey && !connecting ? (
        <EmptyState title="Connect your wallet">Your loans are read directly from the blockchain for the connected address.</EmptyState>
      ) : !publicKey || loans.isLoading ? (
        <div className="grid gap-4">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      ) : !loans.data?.length ? (
        <EmptyState title="No loans yet">
          <Link href="/borrow" className="text-accent hover:underline">Borrow against your SOL →</Link>
        </EmptyState>
      ) : (
        <div className="grid gap-4">
          {loans.data.map((l) => (
            <LoanCard key={l.address.toBase58()} loan={l} />
          ))}
        </div>
      )}
    </>
  );
}

function LoanCard({ loan }: { loan: LoanAccount }) {
  const client = useLoom();
  const config = useConfig();
  const price = useSolPrice();
  const balances = useBalances();
  const { send } = useSendTx();
  const toast = useToast();
  const { publicKey } = useWallet();

  const [payWith, setPayWith] = useState<"USDC" | "USDT">(
    STABLECOINS.find((s) => s.mint.equals(loan.mint))?.symbol ?? STABLECOINS[0]?.symbol ?? "USDC",
  );
  const [amount, setAmount] = useState("");
  const [topUp, setTopUp] = useState("");
  const [busy, setBusy] = useState(false);

  const now = useNow();
  // Interest accrues every second; this is what the program would charge right now.
  const nowSecs = now || Number(loan.startTs);
  const debt = loanDebt(loan, nowSecs);
  const outstanding = debt.owed;
  // "Pay in full" adds 10 minutes of interest for the time until the transaction lands; the program only takes what is owed.
  const payFull = loanDebt(loan, nowSecs + 600).owed;
  const daysLeft = Math.max(0, Math.ceil((Number(loan.maturityTs) - now) / DAY));
  const matured = now > 0 && now > Number(loan.maturityTs);
  // How far SOL is above the price at which all collateral is seized.
  const seizeAt = seizePriceUsd(loan, outstanding);
  // Settlement uses the higher of Pyth and Chainlink.
  const settlePrice = price.data ? Number(price.data.highest) * 10 ** price.data.expo : null;
  const cushion = settlePrice === null ? null : settlePrice / seizeAt;
  const health = cushion === null ? null : cushion >= 1.15 ? "good" : cushion > 1 ? "warn" : "bad";
  const coin = STABLECOINS.find((s) => s.symbol === payWith);
  const balance = balances.data?.tokens.find((t) => t.symbol === payWith)?.amount ?? 0n;
  const hasNote = loan.identityCommitment !== 0n && !!loadNote(loan.address.toBase58());
  // Where the SOL would go if the loan were settled after its deadline at today's price.
  const onDefault = price.data ? defaultSplit(loan.collateralLamports, outstanding, price.data.highest, price.data.expo) : null;
  const settlement = useSettlement(loan);

  let topUpLamports = 0n;
  try {
    topUpLamports = topUp ? parseUnits(topUp, 9) : 0n;
  } catch {
    topUpLamports = 0n;
  }
  const seizeAfterTopUp = topUpLamports > 0n ? seizePriceAfterTopUp(loan, outstanding, topUpLamports) : null;
  const dueSoon = !matured && loan.status === "active" && now > 0 && Number(loan.maturityTs) - now < 7 * DAY;

  async function addSol() {
    if (!publicKey || topUpLamports <= 0n) return;
    setBusy(true);
    try {
      const sig = await send([await client.addCollateral(publicKey, loan.address, topUpLamports)]);
      toast({ kind: "success", title: `Added ${formatSol(topUpLamports)} SOL`, body: seizeAfterTopUp ? `New seizure price: $${seizeAfterTopUp.toFixed(2)}` : undefined, tx: sig });
      setTopUp("");
    } catch (e) {
      toast({ kind: "error", title: "Couldn't add SOL", body: explainError(e) });
    } finally {
      setBusy(false);
    }
  }

  function addToCalendar() {
    const deadline = new Date(Number(loan.maturityTs) * 1000);
    downloadCalendarEvent({
      title: `Repay Loom loan #${loan.id} (${formatStable(loan.principal)} ${symbolForMint(loan.mint)})`,
      at: deadline,
      description: `Repay by ${deadline.toLocaleString()}. If it isn't repaid, SOL worth what you still owe goes to Loom and the rest comes back to your wallet. Repay at ${window.location.origin}/loans`,
      url: `${window.location.origin}/loans`,
      filename: `loom-loan-${loan.id}`,
    });
  }

  async function repay(full: boolean) {
    if (!publicKey || !coin || !config.data) return;
    let value: bigint;
    try {
      value = full ? payFull : parseUnits(amount, 6);
    } catch {
      return toast({ kind: "error", title: "Enter a valid amount" });
    }
    if (value <= 0n) return;
    setBusy(true);
    try {
      const sig = await send([await client.repay({ payer: publicKey, loan, mint: coin.mint, amount: value, treasury: config.data.treasury })]);
      const done = value >= outstanding;
      toast({
        kind: "success",
        title: done ? "Loan repaid — your SOL is back in your wallet" : `Paid ${formatStable(value)} ${payWith}`,
        tx: sig,
      });
      setAmount("");
    } catch (e) {
      toast({ kind: "error", title: "Repayment failed", body: explainError(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="text-xl font-semibold tracking-tight">
            {formatStable(loan.principal)} {symbolForMint(loan.mint)}
          </div>
          <Badge tone={loan.status}>{loan.status}</Badge>
          {loan.status === "active" && health && (
            <Badge tone={health}>{health === "good" ? "Healthy" : health === "warn" ? "Close to seizure" : "SOL can be seized"}</Badge>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-muted">
          Loan #{loan.id.toString()} · <Addr value={loan.address.toBase58()} /> · escrow <Addr value={client.pda.escrow(loan.address).toBase58()} />
        </div>
      </div>

      {loan.status === "active" && !matured && (health === "warn" || health === "bad") && (
        <div className="mt-4">
          <Notice tone={health === "bad" ? "bad" : "warn"}>
            <span className="font-medium">
              {health === "bad" ? "This loan can be seized now." : `SOL is close to this loan's seizure price ($${seizeAt.toFixed(2)}).`}
            </span>{" "}
            Add SOL or repay part of the loan to lower the seizure price.
          </Notice>
        </div>
      )}
      {dueSoon && (
        <div className="mt-4">
          <Notice tone="warn">
            <span className="font-medium">Due in {daysLeft} day{daysLeft === 1 ? "" : "s"}.</span> Repay by{" "}
            {new Date(Number(loan.maturityTs) * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}, or SOL worth what you
            still owe goes to Loom.
          </Notice>
        </div>
      )}

      <div className="mt-5 grid gap-6 lg:grid-cols-2">
        <div>
          <div className="mb-2 flex justify-between text-sm">
            <span className="text-muted">Repaid</span>
            <span className="tabular-nums">
              {formatStable(loan.repaid)} / {formatStable(loan.repaid + outstanding)}
            </span>
          </div>
          <Progress value={loan.status === "repaid" ? 1 : Number(loan.repaid) / Number(loan.repaid + outstanding || 1n)} tone={loan.status === "repaid" ? "good" : "accent"} />
          <div className="mt-4">
            <Row label={loan.status === "active" ? "Collateral in escrow" : loan.status === "repaid" ? "Collateral (returned to you)" : "Collateral (seized)"}>
              {formatSol(loan.collateralLamports)} SOL
            </Row>
            <Row label="Opened">{new Date(Number(loan.startTs) * 1000).toLocaleDateString()}</Row>
            <Row label={`${symbolForMint(loan.mint)} paid out to`}>
              <AddrCopy value={loan.recipient.toBase58()} />
            </Row>
            <Row label={`Receiving ${symbolForMint(loan.mint)} account`}>
              <AddrCopy value={getAssociatedTokenAddressSync(loan.mint, loan.recipient, true).toBase58()} />
            </Row>
            {loan.status === "active" ? (
              <>
                <Row label="Repay by">
                  {new Date(Number(loan.maturityTs) * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}{" "}
                  {matured ? <span className="text-bad">(matured)</span> : <span className="text-muted">({daysLeft} days)</span>}
                </Row>
                <Row label="Interest">
                  {loan.rateBps === 0 ? "12% flat (older loan)" : `${formatRate(loan.rateBps)} a year`}
                  {loan.creditCertificate && <span className="text-good"> · credit rate</span>}
                </Row>
                {loan.rateBps > 0 && (
                  <Row label="Owed now">
                    {formatStable(debt.principal)} principal + {formatStable(debt.interest)} interest
                  </Row>
                )}
                <Row label="SOL price when opened">${(Number(loan.openPrice) * 10 ** loan.openPriceExpo).toFixed(2)}</Row>
                {!matured && <Row label="All SOL seized if SOL falls to">${seizeAt.toFixed(2)}</Row>}
                {onDefault && (
                  <>
                    <Row label={matured ? "On settlement, to Loom treasury" : "If unpaid by deadline, to Loom treasury"}>
                      {formatSol(onDefault.toTreasury)} SOL <span className="text-muted">(at today&apos;s price)</span>
                    </Row>
                    <Row label={matured ? "On settlement, back to your wallet" : "If unpaid by deadline, back to your wallet"}>
                      {formatSol(onDefault.toBorrower)} SOL <span className="text-muted">(at today&apos;s price)</span>
                    </Row>
                    {config.data && (
                      <Row label="Loom treasury">
                        <AddrCopy value={config.data.treasury.toBase58()} />
                      </Row>
                    )}
                    <Row label="SOL returned to">
                      <AddrCopy value={loan.borrower.toBase58()} />
                    </Row>
                    <Row label="Nothing returned if SOL is below">${defaultBreakEvenUsd(loan.collateralLamports, outstanding).toFixed(2)}</Row>
                  </>
                )}
              </>
            ) : (
              <Row label="Closed">{new Date(Number(loan.closedTs) * 1000).toLocaleDateString()}</Row>
            )}
            {price.data && loan.status === "active" && (
              <Row label="SOL price now">
                Pyth ${priceToNumber(price.data).toFixed(2)} · Chainlink ${(Number(price.data.chainlinkPrice) * 10 ** price.data.expo).toFixed(2)}
              </Row>
            )}
          </div>
        </div>

        {loan.status === "active" ? (
          matured ? (
            <Notice tone="bad">
              This loan passed its deadline and can no longer be repaid. When it is settled, Loom keeps SOL worth the {formatStable(outstanding)} still
              owed, at the SOL price at that moment, and the rest of the {formatSol(loan.collateralLamports)} SOL is sent back to your wallet.
            </Notice>
          ) : (
            <div className="rounded-xl bg-surface-2 p-4">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">Make a payment</div>
                <Segmented
                  value={payWith}
                  onChange={setPayWith}
                  // pool-funded loans are repaid into the pool of the coin that was borrowed
                  options={STABLECOINS.filter((s) => !loan.fromPool || s.mint.equals(loan.mint)).map((s) => ({ value: s.symbol, label: s.symbol }))}
                />
              </div>
              <div className="mt-3 text-xs text-muted">
                Outstanding: <span className="font-medium text-fg">{formatStable(outstanding)}</span> · Your {payWith}: {formatStable(balance)}
              </div>
              <div className="mt-3 flex gap-2">
                <div className="flex-1">
                  <Input inputMode="decimal" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} suffix={payWith} aria-label="Repayment amount" />
                </div>
                <Button variant="secondary" loading={busy} disabled={!amount} onClick={() => repay(false)}>
                  Pay
                </Button>
              </div>
              <Button className="mt-3 w-full" loading={busy} disabled={balance < payFull} onClick={() => repay(true)}>
                Pay in full · {formatStable(outstanding)} {payWith}
              </Button>
              {balance < payFull && <div className="mt-2 text-xs text-muted">You need {formatStable(payFull - balance)} more {payWith} to pay in full.</div>}
              <div className="mt-3 text-xs text-muted">
                Payments go straight to the treasury&apos;s {payWith} account and cover interest first. Interest only runs while the loan is open, so
                paying early costs less.
              </div>

              <div className="mt-5 border-t border-border pt-4">
                <div className="text-sm font-medium">Protect it: add SOL</div>
                <div className="mt-1 text-xs text-muted">
                  More SOL in escrow lowers the price at which it can be seized (now ${seizeAt.toFixed(2)}). It all comes back when you repay. Your
                  SOL: {balances.data ? balances.data.solUi.toFixed(4) : "—"}
                </div>
                <div className="mt-3 flex gap-2">
                  <div className="flex-1">
                    <Input inputMode="decimal" placeholder="SOL to add" value={topUp} onChange={(e) => setTopUp(e.target.value)} suffix="SOL" aria-label="SOL to add" />
                  </div>
                  <Button variant="secondary" loading={busy} disabled={topUpLamports <= 0n || (!!balances.data && topUpLamports + 10_000n > balances.data.sol)} onClick={addSol}>
                    Add SOL
                  </Button>
                </div>
                {seizeAfterTopUp !== null && (
                  <div className="mt-2 text-xs">
                    Seizure price after adding: <span className="font-medium text-good">${seizeAfterTopUp.toFixed(2)}</span>
                  </div>
                )}
              </div>

              <Button variant="ghost" className="mt-4 w-full" onClick={addToCalendar}>
                Add the deadline to my calendar
              </Button>
            </div>
          )
        ) : loan.status === "repaid" && loan.creditLeafIndex !== null ? (
          <div className="rounded-xl bg-good-soft p-4 text-sm text-good">
            <div className="font-medium">Repaid in full and on time.</div>
            <div className="mt-1">
              This loan is in the on-chain credit tree (leaf #{loan.creditLeafIndex.toString()}).{" "}
              {hasNote ? "Your private note is saved in this browser." : "Use the note you downloaded when borrowing."}
            </div>
            <Link href="/certificate" className="mt-3 inline-block font-medium underline">Mint a ZK repayment certificate →</Link>
          </div>
        ) : loan.status === "liquidated" || loan.status === "defaulted" ? (
          <Notice tone="bad">
            {loan.status === "liquidated" ? "SOL fell to the seizure price" : "The loan wasn't repaid by its deadline"}, so it was closed.{" "}
            {settlement.data ? (
              <>
                {formatSol(settlement.data.seizedLamports)} SOL went to the Loom treasury
                {settlement.data.returnedLamports > 0n ? ` and ${formatSol(settlement.data.returnedLamports)} SOL was sent back to your wallet` : ""}, at a SOL
                price of ${(Number(settlement.data.price) * 10 ** settlement.data.priceExpo).toFixed(2)}.{" "}
                <a className="font-medium underline" href={explorerUrl("tx", settlement.data.signature)} target="_blank" rel="noreferrer">
                  View transaction ↗
                </a>
              </>
            ) : loan.status === "liquidated" ? (
              `All ${formatSol(loan.collateralLamports)} SOL went to Loom.`
            ) : (
              "SOL worth the amount owed went to Loom and the rest was sent back to your wallet."
            )}{" "}
            The {symbolForMint(loan.mint)} you received is yours to keep.
          </Notice>
        ) : null}
      </div>
    </Card>
  );
}
