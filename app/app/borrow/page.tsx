"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState, type Adapter } from "@solana/wallet-adapter-base";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import {
  CREDIT_INTEREST_BPS,
  INTEREST_BPS,
  LOAN_TERM_SECS,
  YEAR_SECS,
  createNote,
  creditCertificatesToUse,
  creditRateBps,
  creditTerms,
  creditLimit,
  defaultBreakEvenUsd,
  defaultSplit,
  formatDuration,
  formatRate,
  formatSol,
  formatStable,
  interestFor,
  minInterestSecs,
  identityCommitment,
  lamportsToStable,
  parseUnits,
  priceToNumber,
  requiredCollateralLamports,
  seizePriceUsd,
  totalDue,
  type CreditNote,
} from "@loom/sdk";
import { Badge, Button, Card, CardTitle, Field, Input, Notice, PageHeader, Row, Segmented, Skeleton, cx } from "@/components/ui";
import { AddrCopy } from "@/components/addr-copy";
import { HelpForm } from "@/components/help-form";
import { useToast } from "@/components/toast";
import { STABLECOINS, explorerUrl } from "@/lib/env";
import { useBalances, useCertificates, useConfig, useLoom, usePayoutCapacity, usePools, useSolPrice } from "@/lib/hooks";
import { downloadNote, saveNote } from "@/lib/notes";
import { useNow } from "@/lib/now";
import { explainError, useSendTx } from "@/lib/send";

const BUFFER_BPS = 100n; // +1% headroom for price moves between quote and signature
const KEEP_BPS = 25n; // a SOL amount the borrower is ticking through is kept while it still covers the loan with this headroom

type Quote = {
  principal?: bigint;
  collateral?: bigint;
  /** Annual rate: 12%, or 8% with a credit certificate. */
  rateBps?: bigint;
  /** Credit certificates presented with this loan (their count sets the credit level). */
  certificates?: PublicKey[];
  /** The most it can cost: principal + interest until the deadline. */
  due?: bigint;
  /** Interest if repaid right away (the minimum period). */
  minInterest?: bigint;
  seizePrice?: number;
  /** Collateral value today, and at the seizure price (stablecoin base units / USD float). */
  collateralValue?: bigint;
  valueAtSeize?: number;
  maturity?: Date;
  /** Where the SOL goes if nothing is repaid by the deadline, at today's price. */
  onDefault?: { toTreasury: bigint; toBorrower: bigint; returnedValue: bigint; breakEven: number };
  /** The payout wallet can't fund this amount right now. */
  unfunded?: boolean;
  /** Paid from the lending pool (it has the cash) rather than the treasury. */
  fromPool?: boolean;
  error?: string;
};

/** A normal (on-curve) wallet address, or an error message. */
function parseWallet(value: string): PublicKey | string {
  try {
    const pk = new PublicKey(value.trim());
    return PublicKey.isOnCurve(pk.toBytes()) ? pk : "That's a program account, not a wallet. Funds sent there could be lost.";
  } catch {
    return "Enter a valid Solana wallet address";
  }
}

export default function BorrowPage() {
  const { publicKey, wallet, wallets } = useWallet();
  const { setVisible } = useWalletModal();
  const client = useLoom();
  const config = useConfig();
  const capacity = usePayoutCapacity();
  const pools = usePools();
  const price = useSolPrice();
  const balances = useBalances();
  const certificates = useCertificates(publicKey);
  const { sendWithPrice } = useSendTx();
  const toast = useToast();

  const [symbol, setSymbol] = useState<"USDC" | "USDT">(STABLECOINS[0]?.symbol ?? "USDC");
  const [amount, setAmount] = useState("1000");
  const [receiveTo, setReceiveTo] = useState<"self" | "other">("self");
  const [recipientInput, setRecipientInput] = useState("");
  const [reading, setReading] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<{ key: string; items: boolean[] }>({ key: "", items: [] });
  // The SOL amount shown when the borrower started ticking the checklist (see `quote`).
  const [agreed, setAgreed] = useState<{ principal: bigint; collateral: bigint } | null>(null);
  const [zk, setZk] = useState(true);
  const [note, setNote] = useState<CreditNote | null>(null);
  const [nonce, setNonce] = useState<bigint | null>(null);
  const [noteSaved, setNoteSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState<{ sig: string; text: string } | null>(null);

  const now = useNow();
  const coin = STABLECOINS.find((s) => s.symbol === symbol);
  // Loans are funded by the lending pool when it has the cash, otherwise by the treasury's approved payouts.
  const poolCash = pools.data?.find((p) => coin && p.mint.equals(coin.mint))?.cash;
  const treasuryAvailable = capacity.data?.find((c) => coin && c.mint.equals(coin.mint))?.available;
  const available =
    treasuryAvailable === undefined && poolCash === undefined
      ? undefined
      : (poolCash ?? 0n) > (treasuryAvailable ?? 0n)
        ? (poolCash ?? 0n)
        : (treasuryAvailable ?? 0n);

  const recipientParsed = receiveTo === "self" ? publicKey : recipientInput.trim() ? parseWallet(recipientInput) : null;
  const recipient = recipientParsed instanceof PublicKey ? recipientParsed : null;
  const recipientError = typeof recipientParsed === "string" ? recipientParsed : null;

  const quote = useMemo((): Quote | null => {
    let principal: bigint;
    try {
      principal = parseUnits(amount || "0", 6);
    } catch {
      return { error: "Enter a valid amount" };
    }
    if (principal === 0n || !price.data || !config.data) return null;
    const p = price.data;
    // Same rules as the program: collateral valued at the lower of Pyth (price − conf) and Chainlink,
    // the 60% line measured from the lower of the two, and a default priced at the higher of the two.
    // The price refreshes every 10 s. Once the checklist is being ticked, keep its SOL amount while it still covers
    // the loan, so the numbers (and the ticks) don't change under the borrower; a real drop asks for a new amount.
    const collateral =
      agreed?.principal === principal && agreed.collateral >= requiredCollateralLamports(principal, p.lowest, 0n, p.expo, KEEP_BPS)
        ? agreed.collateral
        : requiredCollateralLamports(principal, p.lowest, 0n, p.expo, BUFFER_BPS);
    // Credit certificates held by this wallet lower the rate (more certificates, lower rate), up to their combined limit.
    const credit = creditTerms(certificates.data ?? [], principal);
    const rateBps = credit?.rateBps ?? INTEREST_BPS;
    const due = totalDue(principal, rateBps);
    const seizePrice = seizePriceUsd(
      {
        collateralLamports: collateral,
        openingCollateralLamports: collateral,
        principal,
        principalRepaid: 0n,
        openPrice: p.openPrice,
        openPriceExpo: p.expo,
        liquidationThresholdBps: config.data.liquidationThresholdBps,
      },
      due,
    );
    const errors: string[] = [];
    if (principal < config.data.minPrincipal) errors.push(`Minimum loan is $${formatStable(config.data.minPrincipal, 0)}`);
    if (principal > config.data.maxPrincipal) errors.push(`Maximum loan is $${formatStable(config.data.maxPrincipal, 0)}`);
    if (balances.data && collateral + 10_000_000n > balances.data.sol) errors.push("Not enough SOL in your wallet for collateral + fees");
    if (config.data.paused) errors.push("New loans are paused by the operator");
    return {
      principal,
      collateral,
      rateBps,
      certificates: credit?.certificates.map((c) => c.address),
      due,
      minInterest: interestFor(principal, rateBps, minInterestSecs()),
      seizePrice,
      collateralValue: lamportsToStable(collateral, p.openPrice, p.expo),
      valueAtSeize: (Number(collateral) / 1e9) * seizePrice,
      maturity: now ? new Date((now + LOAN_TERM_SECS) * 1000) : undefined,
      onDefault: (() => {
        const split = defaultSplit(collateral, due, p.highest, p.expo);
        return { ...split, returnedValue: lamportsToStable(split.toBorrower, p.highest, p.expo), breakEven: defaultBreakEvenUsd(collateral, due) };
      })(),
      unfunded: available !== undefined && principal > available,
      fromPool: poolCash !== undefined && principal <= poolCash,
      error: errors[0],
    };
  }, [amount, price.data, config.data, available, poolCash, balances.data, now, certificates.data, agreed]);

  // The checklist must be re-accepted whenever the numbers in it change.
  const termsKey = `${symbol}|${quote?.principal}|${quote?.collateral}|${quote?.rateBps}|${recipient?.toBase58()}`;
  const ticks = accepted.key === termsKey ? accepted.items : [];
  const repriced = agreed?.principal === quote?.principal && agreed?.collateral !== quote?.collateral && ticks.length === 0;
  const needsNoteBackup = zk && !noteSaved;

  const usd = (v: bigint) => (price.data ? (Number(v) * 10 ** price.data.expo).toFixed(2) : "—");
  const deadline = quote?.maturity?.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  const treasury = config.data?.treasury.toBase58();
  const checklist =
    quote?.principal && quote.collateral && quote.rateBps && quote.minInterest !== undefined && quote.due && quote.seizePrice !== undefined && quote.collateralValue !== undefined && quote.valueAtSeize !== undefined && quote.onDefault && deadline && treasury && price.data && recipient
      ? [
          {
            title: (
              <>
                Lock <Fig>{formatSol(quote.collateral)} SOL</Fig> in escrow
              </>
            ),
            detail: <>Worth ≈ ${formatStable(quote.collateralValue, 0)} today. Only the Loomzk program&apos;s rules can move it.</>,
          },
          {
            title: (
              <>
                All SOL is seized if SOL falls to <Fig tone="warn">${quote.seizePrice.toFixed(2)}</Fig>
              </>
            ),
            detail: (
              <>
                A 40% drop before the deadline. You keep the {formatStable(quote.principal, 0)} {symbol}. Adding SOL or repaying part lowers this price.
              </>
            ),
          },
          {
            title: (
              <>
                Repay by <Fig>{quote.maturity?.toLocaleDateString(undefined, { dateStyle: "medium" })}</Fig>
              </>
            ),
            detail: (
              <>
                If you don&apos;t, Loomzk takes SOL worth what you owe (≈ {formatSol(quote.onDefault.toTreasury, 2)} SOL today) and ≈{" "}
                {formatSol(quote.onDefault.toBorrower, 2)} SOL comes back to you.
              </>
            ),
          },
          {
            title: (
              <>
                Interest: <Fig>{formatRate(quote.rateBps)} a year</Fig>, only while you borrow
              </>
            ),
            detail: (
              <>
                You&apos;ll repay between {formatStable(quote.principal + quote.minInterest)} (minimum {formatDuration(minInterestSecs())}) and{" "}
                {formatStable(quote.due)} (at the deadline), in USDC or USDT.
              </>
            ),
          },
          { title: <>Final once you confirm</>, detail: <>The loan can&apos;t be cancelled or reversed after you sign.</> },
          {
            title: (
              <>
                {symbol} is sent to <Fig mono>{short(recipient.toBase58())}</Fig>
              </>
            ),
            detail:
              receiveTo === "other" && !(publicKey && recipient.equals(publicKey))
                ? "Another wallet. The loan and the SOL stay yours."
                : "Your connected wallet.",
          },
        ]
      : [];
  const allAccepted = checklist.length > 0 && checklist.every((_, i) => ticks[i]);

  function tick(i: number, value: boolean) {
    const items = checklist.map((_, j) => (j === i ? value : !!ticks[j]));
    setAccepted({ key: termsKey, items });
    if (quote?.principal && quote.collateral) setAgreed({ principal: quote.principal, collateral: quote.collateral });
  }

  async function submit() {
    if (!publicKey) return setVisible(true);
    if (!quote?.principal || !quote.collateral || quote.error || !coin || !config.data || !recipient || !allAccepted) return;
    const { principal, collateral } = quote;
    setBusy(true);
    try {
      // Re-check the pool and the payout wallet right before signing.
      const freshPool = (await pools.refetch()).data?.find((p) => p.mint.equals(coin.mint));
      const fresh = (await capacity.refetch()).data?.find((c) => c.mint.equals(coin.mint));
      if ((freshPool?.cash ?? 0n) < principal && (fresh?.available ?? 0n) < principal) {
        toast({ kind: "error", title: "We can't fund this loan right now", body: "Your SOL was not touched. Send us a message below." });
        return;
      }
      const loanNonce = nonce ?? BigInt(Date.now());
      const loanAddress = client.pda.loan(publicKey, loanNonce);
      const n = zk ? (note ?? createNote()) : null;
      if (n) saveNote(loanAddress.toBase58(), n);
      const sig = await sendWithPrice(
        async (priceUpdate) => [
          await client.openLoan({
            borrower: publicKey,
            treasury: config.data!.treasury,
            recipient,
            mint: coin.mint,
            nonce: loanNonce,
            principal,
            collateralLamports: collateral,
            identityCommitment: n ? identityCommitment(n) : undefined,
            creditCertificates: quote.certificates,
            pool: !!freshPool,
            priceUpdate,
          }),
        ],
        config.data.maxPriceAgeSecs,
      );
      const text = `${formatSol(collateral)} SOL locked; ${formatStable(principal)} ${symbol} sent to ${recipient.toBase58()}.`;
      setOpened({ sig, text });
      toast({ kind: "success", title: `Loan opened — ${formatStable(principal)} ${symbol} sent`, body: text, tx: sig });
      setNote(null);
      setNonce(null);
      setNoteSaved(false);
      setAccepted({ key: "", items: [] });
      setAgreed(null);
    } catch (e) {
      toast({ kind: "error", title: "Couldn't open loan", body: explainError(e) });
    } finally {
      setBusy(false);
    }
  }

  function prepareNote() {
    if (!publicKey) return setVisible(true);
    // Fix the loan address now so the downloaded note names it.
    const loanNonce = nonce ?? BigInt(Date.now());
    const n = note ?? createNote();
    setNonce(loanNonce);
    setNote(n);
    downloadNote(client.pda.loan(publicKey, loanNonce).toBase58(), n);
    setNoteSaved(true);
  }

  // Other installed wallet extensions (e.g. Backpack while Phantom holds the SOL). Connecting one
  // directly only reads its address; the wallet that signs the loan stays connected.
  const otherWallets = wallets.filter(
    (w) => w.readyState === WalletReadyState.Installed && w.adapter.name !== wallet?.adapter.name,
  );

  async function readAddressFrom(adapter: Adapter) {
    setReading(adapter.name);
    try {
      await adapter.connect();
      if (adapter.publicKey) setRecipientInput(adapter.publicKey.toBase58());
    } catch (e) {
      toast({ kind: "error", title: `Couldn't read the address from ${adapter.name}`, body: explainError(e) });
    } finally {
      await adapter.disconnect().catch(() => {});
      setReading(null);
    }
  }

  const canSubmit = !!quote && !quote.error && !quote.unfunded && !!recipient && allAccepted && !needsNoteBackup && !!config.data;

  return (
    <>
      <PageHeader
        title="Borrow stablecoins"
        subtitle="Lock SOL worth 2× the loan. In the same transaction, the USDC or USDT you choose is sent to your wallet automatically."
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <Card>
          <div className="flex flex-col gap-5">
            <Field label="You receive">
              <div className="flex flex-col gap-3 sm:flex-row">
                <div className="flex-1">
                  <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Loan amount" suffix={symbol} />
                </div>
                {STABLECOINS.length > 1 && (
                  <Segmented value={symbol} onChange={setSymbol} options={STABLECOINS.map((s) => ({ value: s.symbol, label: s.symbol }))} />
                )}
              </div>
            </Field>
            {STABLECOINS.length === 0 && (
              <Notice tone="warn">No stablecoin mints are configured for this cluster. Set NEXT_PUBLIC_USDC_MINT / NEXT_PUBLIC_USDT_MINT.</Notice>
            )}

            <div className="rounded-xl bg-surface-2 p-4">
              <div className="text-xs text-muted">Step 1 · SOL to lock in escrow</div>
              <div className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">
                {quote?.collateral ? `${formatSol(quote.collateral)} SOL` : price.isLoading ? <Skeleton className="h-8 w-40" /> : "—"}
              </div>
              <div className="mt-1 text-xs text-muted">
                200% of the loan at the lower of the Pyth and Chainlink prices, plus 1% headroom. Wallet balance:{" "}
                {balances.data ? `${balances.data.solUi.toFixed(4)} SOL` : "—"}
              </div>
            </div>

            <div className="rounded-xl border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm font-medium">Step 2 · Where should the {symbol} go?</div>
                <Segmented
                  value={receiveTo}
                  onChange={setReceiveTo}
                  options={[
                    { value: "self", label: "My wallet" },
                    { value: "other", label: "Another wallet" },
                  ]}
                />
              </div>
              {receiveTo === "self" ? (
                <div className="mt-3 text-sm text-muted">
                  {publicKey ? <AddrCopy value={publicKey.toBase58()} full /> : "Connect your wallet to borrow."}
                </div>
              ) : (
                <div className="mt-3 flex flex-col gap-3">
                  <Input value={recipientInput} onChange={(e) => setRecipientInput(e.target.value)} placeholder="Paste the receiving wallet address" spellCheck={false} aria-label="Receiving wallet address" />
                  {recipientError && <div className="text-xs text-bad">{recipientError}</div>}
                  {!recipient && otherWallets.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-muted">Or take the address from another wallet app:</span>
                      {otherWallets.map((w) => (
                        <Button key={w.adapter.name} variant="secondary" className="h-8 px-3 text-xs" loading={reading === w.adapter.name} onClick={() => readAddressFrom(w.adapter)}>
                          Use my {w.adapter.name} address
                        </Button>
                      ))}
                    </div>
                  )}
                  {recipient && <div className="text-xs text-muted">The loan and the SOL stay with the wallet that signs. Only the {symbol} goes to this address.</div>}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-border p-4">
              <label className="flex cursor-pointer items-start gap-3">
                <input type="checkbox" className="mt-1 accent-[var(--accent)]" checked={zk} onChange={(e) => { setZk(e.target.checked); setNoteSaved(false); }} />
                <span>
                  <span className="font-medium">Enable zero-knowledge credit certificate</span>
                  <span className="mt-1 block text-sm text-muted">
                    We generate a private note in your browser. After you repay, it lets you prove, from any wallet and without revealing this loan,
                    that you repaid in full and on time.
                  </span>
                </span>
              </label>
              {zk && (
                <div className="mt-3 flex flex-wrap items-center gap-3 pl-7">
                  <Button variant="secondary" onClick={prepareNote}>
                    {noteSaved ? "Download again" : "Download private note"}
                  </Button>
                  {noteSaved ? <Badge tone="good">Note saved</Badge> : <span className="text-xs text-muted">Required before borrowing</span>}
                </div>
              )}
            </div>

            <CreditNotice certificates={certificates.data ?? []} applied={!!quote?.certificates?.length} />

            {quote?.error && <Notice tone="bad">{quote.error}</Notice>}

            {quote?.unfunded ? (
              <div className="rounded-xl border border-warn/40 bg-warn-soft p-4">
                <div className="font-medium text-warn">We can&apos;t fund {formatStable(quote.principal ?? 0n, 0)} {symbol} right now</div>
                <p className="mt-1 text-sm text-muted">
                  {available && available >= (config.data?.minPrincipal ?? 0n)
                    ? `You can borrow up to ${formatStable(available, 0)} ${symbol} at the moment, or ask us for more.`
                    : `${symbol} loans are temporarily unavailable. Send us a message and we'll get back to you.`}{" "}
                  Nothing has been taken from your wallet.
                </p>
                <div className="mt-4">
                  <HelpForm
                    kind="insufficient-funds"
                    wallet={publicKey?.toBase58()}
                    coin={symbol}
                    amount={amount}
                    defaultMessage={`I'd like to borrow ${amount} ${symbol}.`}
                  />
                </div>
              </div>
            ) : (
              checklist.length > 0 && (
                <div className="overflow-hidden rounded-xl border border-border">
                  <div className="flex items-center justify-between gap-3 border-b border-border bg-surface-2/60 px-4 py-3">
                    <div>
                      <div className="text-sm font-semibold tracking-tight">Step 3 · Confirm before you borrow</div>
                      <div className={cx("mt-0.5 text-xs", repriced ? "text-warn" : "text-muted")}>
                        {repriced
                          ? "SOL's price fell, so this loan needs more SOL. Please check the amounts and tick again."
                          : "These are the exact rules the program enforces. Tick each one."}
                      </div>
                    </div>
                    <span
                      className={cx(
                        "shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums transition-colors",
                        allAccepted ? "bg-good-soft text-good" : "bg-surface text-muted",
                      )}
                    >
                      {checklist.filter((_, i) => ticks[i]).length}/{checklist.length}
                    </span>
                  </div>
                  <ul className="divide-y divide-border">
                    {checklist.map((item, i) => (
                      <li key={i}>
                        <label
                          className={cx(
                            "group flex cursor-pointer items-start gap-3.5 px-4 py-3.5 transition-colors",
                            ticks[i] ? "bg-good-soft/40" : "hover:bg-surface-2/60",
                          )}
                        >
                          <input type="checkbox" className="peer sr-only" checked={!!ticks[i]} onChange={(e) => tick(i, e.target.checked)} />
                          <span
                            aria-hidden
                            className={cx(
                              "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors peer-focus-visible:ring-4 peer-focus-visible:ring-accent/20",
                              ticks[i] ? "border-accent bg-accent text-accent-fg" : "border-border-strong bg-surface group-hover:border-accent",
                            )}
                          >
                            {ticks[i] && (
                              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M2.5 6.2 4.9 8.5 9.5 3.5" />
                              </svg>
                            )}
                          </span>
                          <span className="min-w-0">
                            <span className="block text-[15px] font-medium leading-snug tracking-tight text-fg">{item.title}</span>
                            <span className="mt-1 block text-[13px] leading-relaxed text-muted">{item.detail}</span>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            )}

            <Button className="h-12 text-base" loading={busy} disabled={!!publicKey && !canSubmit} onClick={submit}>
              {publicKey ? `Lock SOL & receive ${symbol}` : "Connect wallet"}
            </Button>
            {publicKey && !canSubmit && !quote?.error && !quote?.unfunded && (
              <div className="-mt-3 text-center text-xs text-muted">
                {!recipient
                  ? "Enter the wallet that should receive the coins (Step 2)."
                  : !allAccepted
                    ? "Tick every point in Step 3 to continue."
                    : needsNoteBackup
                      ? "Download your private note for this loan (or untick the ZK certificate option)."
                      : null}
              </div>
            )}
            {!config.isLoading && !config.data && <Notice tone="warn">The program isn&apos;t initialized on this cluster yet.</Notice>}

            {opened && (
              <Notice tone="good">
                <div className="font-medium">Loan opened</div>
                <div className="mt-1 break-words">{opened.text}</div>
                <a className="mt-2 inline-block font-medium underline" href={explorerUrl("tx", opened.sig)} target="_blank" rel="noreferrer">
                  Verify the transaction on Solscan ↗
                </a>{" "}
                · <Link href="/loans" className="font-medium underline">My loans</Link>
              </Notice>
            )}
          </div>
        </Card>

        <Card className="self-start">
          <CardTitle hint={price.data ? `SOL $${usd(price.data.openPrice)}` : undefined}>Summary</CardTitle>
          {price.data && (
            <div className="mb-3 rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
              Pyth ${priceToNumber(price.data).toFixed(2)} · Chainlink ${usd(price.data.chainlinkPrice)}. Opening uses the lower price, seizing needs both.
            </div>
          )}
          {quote?.due && quote.principal && quote.collateral && quote.maturity && quote.onDefault && deadline && quote.seizePrice !== undefined ? (
            <>
              <Row label="You receive now">{formatStable(quote.principal)} {symbol}</Row>
              <Row label="Collateral locked">{formatSol(quote.collateral)} SOL</Row>
              <Row label="Interest">
                {formatRate(quote.rateBps ?? INTEREST_BPS)} a year
                {!!quote.certificates?.length && <span className="text-good"> · credit level {quote.certificates.length}</span>}
              </Row>
              <CostTable principal={quote.principal} rateBps={quote.rateBps ?? INTEREST_BPS} />
              <Row label="Repay by">{deadline}</Row>
              <Row label="Funded by">{quote.fromPool ? "Loomzk lending pool" : "Loomzk treasury"}</Row>
              <div className="mt-4 border-t border-border pt-4">
                <div className="text-sm font-medium">If SOL drops before the deadline</div>
                <Row label="Collateral value today">${formatStable(quote.collateralValue ?? 0n)}</Row>
                <Row label="All SOL seized if SOL falls to">
                  ${quote.seizePrice.toFixed(2)}
                  {price.data && <span className="text-muted"> ({((quote.seizePrice / (Number(price.data.openPrice) * 10 ** price.data.expo)) * 100).toFixed(0)}% of today)</span>}
                </Row>
                <Row label="Collateral value at that price">≈ ${quote.valueAtSeize?.toFixed(2)}</Row>
                <Row label="SOL seized">
                  {formatSol(quote.collateral)} SOL <span className="text-muted">(all of it)</span>
                </Row>
              </div>
              <div className="mt-4 border-t border-border pt-4">
                <div className="text-sm font-medium">If not repaid by the deadline</div>
                <div className="mt-1 text-xs text-muted">At today&apos;s SOL price{price.data ? ` ($${usd(price.data.highest)}, the higher of the two oracles)` : ""}:</div>
                <Row label="To Loomzk treasury">
                  {formatSol(quote.onDefault.toTreasury)} SOL <span className="text-muted">(≈ ${formatStable(quote.due)} owed)</span>
                </Row>
                <Row label="Back to your wallet">
                  {formatSol(quote.onDefault.toBorrower)} SOL <span className="text-muted">(≈ ${formatStable(quote.onDefault.returnedValue)})</span>
                </Row>
                {treasury && (
                  <Row label="Treasury">
                    <AddrCopy value={treasury} />
                  </Row>
                )}
                {publicKey && (
                  <Row label="Your wallet">
                    <AddrCopy value={publicKey.toBase58()} />
                  </Row>
                )}
                <Row label="Nothing returned if SOL is below">${quote.onDefault.breakEven.toFixed(2)}</Row>
              </div>
              <div className="mt-4 border-t border-border pt-4 text-xs text-muted">
                Interest is charged only for the time you borrow, on what you still owe, so repaying early costs less. Repay any time before the
                deadline, in one go or in parts, in USDC or USDT. The last payment releases your SOL automatically. If the
                deadline passes, Loomzk keeps only SOL worth what you still owe, at the SOL price when the loan is settled, and the rest returns to the
                wallet that opened the loan. If SOL falls to 60% of its price when your loan opens, before the deadline, all of the SOL goes to Loomzk.
                Either way the loan is closed and you keep the stablecoin.
              </div>
            </>
          ) : (
            <p className="text-sm text-muted">Enter an amount to see your quote.</p>
          )}
          {recipient && coin && <Recipient wallet={recipient} mint={coin.mint} symbol={symbol} />}
          <div className="mt-4 text-xs">
            <Link href="/transparency" className="text-accent hover:underline">How is my SOL held? →</Link>
          </div>
        </Card>
      </div>
    </>
  );
}

/** What the loan costs if repaid after 1, 3, 6 or 12 months (interest is charged only for the time borrowed). */
function CostTable({ principal, rateBps }: { principal: bigint; rateBps: bigint }) {
  const rows = [1, 3, 6, 12]
    .map((months) => ({ months, secs: (YEAR_SECS / 12) * months }))
    .filter((r) => r.secs <= LOAN_TERM_SECS);
  return (
    <div className="my-2 rounded-lg bg-surface-2 px-3 py-2 text-sm">
      <div className="mb-1 text-xs text-muted">If you repay after… (minimum {formatDuration(minInterestSecs())} of interest)</div>
      {rows.map((r) => (
        <div key={r.months} className="flex justify-between py-0.5 tabular-nums">
          <span className="text-muted">
            {r.months} month{r.months === 1 ? "" : "s"}
          </span>
          <span>
            {formatStable(principal + interestFor(principal, rateBps, Math.max(r.secs, minInterestSecs())))}{" "}
            <span className="text-xs text-muted">(+{formatStable(interestFor(principal, rateBps, Math.max(r.secs, minInterestSecs())))})</span>
          </span>
        </div>
      ))}
    </div>
  );
}

/** A key figure in a checklist headline: tabular digits, optionally in the warning color or monospace (addresses). */
function Fig({ children, tone, mono }: { children: ReactNode; tone?: "warn"; mono?: boolean }) {
  return (
    <span className={cx("font-semibold tabular-nums", tone === "warn" ? "text-warn" : "text-fg", mono && "font-mono text-[13px] tracking-normal")}>
      {children}
    </span>
  );
}

const short = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;

/** Explains the credit rate: applied (with its level), available up to a limit, or how to earn it. */
function CreditNotice({ certificates, applied }: { certificates: { minPrincipal: bigint }[]; applied: boolean }) {
  const used = creditCertificatesToUse(certificates);
  const limit = creditLimit(certificates);
  const rate = creditRateBps(used.length);
  const nextRate = creditRateBps(used.length + 1);
  const next =
    rate !== null && nextRate !== null && nextRate < rate ? ` Repay one more loan on time to reach ${formatRate(nextRate)}.` : "";
  if (applied && rate !== null) {
    return (
      <Notice tone="good">
        <span className="font-medium">
          Credit level {used.length} applied: {formatRate(rate)} a year
        </span>{" "}
        instead of {formatRate(INTEREST_BPS)}. Your certificates cover loans up to ${formatStable(limit, 0)}.{next}
      </Notice>
    );
  }
  if (rate !== null) {
    return (
      <Notice tone="neutral">
        Your {used.length === 1 ? "credit certificate gives" : `${used.length} credit certificates give`} {formatRate(rate)} a year on loans up to $
        {formatStable(limit, 0)}. Larger loans use the standard {formatRate(INTEREST_BPS)}.
      </Notice>
    );
  }
  return (
    <div className="text-xs text-muted">
      Repay on time to earn a ZK credit certificate: {formatRate(CREDIT_INTEREST_BPS)} a year on your next loan, down to{" "}
      {formatRate(creditRateBps(3)!)} after three, from any wallet.{" "}
      <Link href="/certificate" className="text-accent hover:underline">How it works →</Link>
    </div>
  );
}

/** The program pays the recipient wallet's associated token account for the chosen coin. */
function Recipient({ wallet, mint, symbol }: { wallet: PublicKey; mint: PublicKey; symbol: string }) {
  return (
    <div className="mt-4 border-t border-border pt-4">
      <div className="text-sm font-medium">Sent to</div>
      <Row label="Wallet">
        <AddrCopy value={wallet.toBase58()} />
      </Row>
      <Row label={`${symbol} account`}>
        <AddrCopy value={getAssociatedTokenAddressSync(mint, wallet, true).toBase58()} />
      </Row>
      <div className="mt-1 text-xs text-muted">
        The {symbol} arrives in the same transaction that locks your SOL. The {symbol} account is created automatically if it doesn&apos;t exist yet.
      </div>
    </div>
  );
}
