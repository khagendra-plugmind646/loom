"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { formatStable, parseUnits } from "@loom/sdk";
import { Button, Card, CardTitle, EmptyState, Field, Input, Notice, PageHeader, Segmented, Skeleton } from "@/components/ui";
import { useToast } from "@/components/toast";
import { STABLECOINS } from "@/lib/env";
import { useBalances } from "@/lib/hooks";
import { explainError, useSendTx } from "@/lib/send";

type Asset = "SOL" | "USDC" | "USDT";

export default function WalletPage() {
  const { publicKey } = useWallet();
  const balances = useBalances();

  if (!publicKey) {
    return (
      <>
        <PageHeader title="Wallet" subtitle="Send and receive SOL, USDC and USDT." />
        <EmptyState title="Connect your wallet">Use the button at the top right. Phantom, Solflare and Backpack are supported.</EmptyState>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Wallet" subtitle="Send and receive SOL, USDC and USDT. Transfers are signed in your wallet; Loom never holds your keys." />
      <div className="grid gap-3 sm:grid-cols-3">
        <BalanceTile label="SOL" value={balances.data ? balances.data.solUi.toLocaleString(undefined, { maximumFractionDigits: 4 }) : null} />
        {STABLECOINS.map((s) => {
          const t = balances.data?.tokens.find((x) => x.symbol === s.symbol);
          return <BalanceTile key={s.symbol} label={s.symbol} value={t ? formatStable(t.amount) : null} />;
        })}
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <SendCard />
        <ReceiveCard address={publicKey} />
      </div>
    </>
  );
}

function BalanceTile({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">{value ?? <Skeleton className="h-8 w-24" />}</div>
    </div>
  );
}

function SendCard() {
  const { publicKey } = useWallet();
  const balances = useBalances();
  const { send } = useSendTx();
  const toast = useToast();
  const [asset, setAsset] = useState<Asset>("SOL");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  let recipient: PublicKey | null = null;
  try {
    recipient = to ? new PublicKey(to.trim()) : null;
  } catch {
    recipient = null;
  }

  async function submit() {
    if (!publicKey || !recipient) return;
    setBusy(true);
    try {
      let sig: string;
      if (asset === "SOL") {
        const lamports = parseUnits(amount, 9);
        sig = await send([SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: recipient, lamports })]);
      } else {
        const coin = STABLECOINS.find((s) => s.symbol === asset)!;
        const value = parseUnits(amount, 6);
        const from = getAssociatedTokenAddressSync(coin.mint, publicKey, true);
        const dest = getAssociatedTokenAddressSync(coin.mint, recipient, true);
        sig = await send([
          // Creates the recipient's token account if it doesn't exist yet (sender pays ~0.002 SOL rent).
          createAssociatedTokenAccountIdempotentInstruction(publicKey, dest, recipient, coin.mint),
          createTransferCheckedInstruction(from, coin.mint, dest, publicKey, value, 6),
        ]);
      }
      toast({ kind: "success", title: `Sent ${amount} ${asset}`, tx: sig });
      setAmount("");
    } catch (e) {
      toast({ kind: "error", title: "Transfer failed", body: explainError(e) });
    } finally {
      setBusy(false);
    }
  }

  const max =
    asset === "SOL"
      ? balances.data
        ? Math.max(0, balances.data.solUi - 0.01).toFixed(4)
        : null
      : balances.data
        ? formatStable(balances.data.tokens.find((t) => t.symbol === asset)?.amount ?? 0n).replace(/,/g, "")
        : null;

  return (
    <Card>
      <CardTitle>Send</CardTitle>
      <div className="flex flex-col gap-4">
        <Segmented<Asset> value={asset} onChange={setAsset} options={[{ value: "SOL", label: "SOL" }, ...STABLECOINS.map((s) => ({ value: s.symbol as Asset, label: s.symbol }))]} />
        <Field label="Recipient address">
          <Input placeholder="Solana address" value={to} onChange={(e) => setTo(e.target.value)} spellCheck={false} />
        </Field>
        {to && !recipient && <Notice tone="bad">That isn&apos;t a valid Solana address.</Notice>}
        <Field
          label="Amount"
          hint={
            max !== null && (
              <button type="button" className="text-accent hover:underline" onClick={() => setAmount(max)}>
                Max {max}
              </button>
            )
          }
        >
          <Input inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} suffix={asset} />
        </Field>
        <Button loading={busy} disabled={!recipient || !amount} onClick={submit}>
          Send {asset}
        </Button>
      </div>
    </Card>
  );
}

function ReceiveCard({ address }: { address: PublicKey }) {
  const [svg, setSvg] = useState("");
  const [copied, setCopied] = useState(false);
  const value = address.toBase58();

  useEffect(() => {
    // margin 2 keeps a white quiet zone around the code so phone cameras can find its edges
    QRCode.toString(value, { type: "svg", margin: 2, color: { dark: "#16171a", light: "#ffffff" } }).then(setSvg);
  }, [value]);

  return (
    <Card>
      <CardTitle>Receive</CardTitle>
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        <div
          className="h-[200px] w-[200px] shrink-0 overflow-hidden rounded-xl bg-white p-2 [&>svg]:block [&>svg]:h-full [&>svg]:w-full"
          role="img"
          aria-label="QR code of your address"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        <div className="min-w-0 flex-1">
          <div className="text-sm text-muted">Your address (SOL, USDC and USDT)</div>
          <div className="mt-2 break-all rounded-xl bg-surface-2 p-3 font-mono text-sm">{value}</div>
          <Button
            variant="secondary"
            className="mt-3"
            onClick={async () => {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? "Copied" : "Copy address"}
          </Button>
          <p className="mt-3 text-xs text-muted">
            SPL tokens (USDC/USDT) sent to this address land in your associated token account automatically. Only send assets on Solana.
          </p>
        </div>
      </div>
    </Card>
  );
}
