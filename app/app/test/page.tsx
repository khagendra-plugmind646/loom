"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useQueryClient } from "@tanstack/react-query";
import { formatStable } from "@loom/sdk";
import { AddrCopy } from "@/components/addr-copy";
import { Badge, Button, Card, Notice, PageHeader } from "@/components/ui";
import { useToast } from "@/components/toast";
import { CLUSTER, explorerUrl } from "@/lib/env";
import { useBalances, useCertificates, useLenderPositions, useLoans } from "@/lib/hooks";

type Step = { title: string; done: boolean | null; body: ReactNode };

/** Guided devnet test of every feature; each step ticks itself off from the tester's on-chain activity. */
export default function TestPage() {
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const balances = useBalances();
  const loans = useLoans(publicKey);
  const certificates = useCertificates(publicKey);
  const positions = useLenderPositions(publicKey);
  const qc = useQueryClient();
  const toast = useToast();
  const [faucet, setFaucet] = useState<{ enabled: boolean; amount: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/faucet")
      .then((r) => r.json())
      .then(setFaucet)
      .catch(() => setFaucet({ enabled: false, amount: "0" }));
  }, []);

  async function claim() {
    if (!publicKey) return setVisible(true);
    setBusy(true);
    try {
      const res = await fetch("/api/faucet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet: publicKey.toBase58() }) });
      const body = (await res.json()) as { error?: string; signature?: string; sent?: string[] };
      if (!res.ok) throw new Error(body.error ?? "The faucet couldn't send tokens");
      toast({ kind: "success", title: `Sent test ${body.sent?.join(" and ")}`, tx: body.signature });
      await qc.invalidateQueries({ queryKey: ["balances"] });
    } catch (e) {
      toast({ kind: "error", title: "Faucet", body: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const known = (v: unknown) => (publicKey ? (v === undefined ? null : !!v) : false);
  const all = loans.data ?? [];
  const stable = balances.data?.tokens.reduce((s, t) => s + t.amount, 0n);
  const steps: Step[] = [
    {
      title: "Connect a Solana wallet on devnet",
      done: !!publicKey,
      body: (
        <>
          Use Phantom or Backpack and switch it to <span className="font-medium">Devnet</span> (Phantom: Settings → Developer settings → Testnet mode).
          Nothing here uses real money.
          {!publicKey && (
            <div className="mt-3">
              <Button onClick={() => setVisible(true)}>Connect wallet</Button>
            </div>
          )}
        </>
      ),
    },
    {
      title: "Get devnet SOL for collateral",
      done: known(balances.data && balances.data.sol >= 500_000_000n),
      body: (
        <>
          Paste your address into{" "}
          <a className="font-medium text-accent hover:underline" href="https://faucet.solana.com" target="_blank" rel="noreferrer">
            faucet.solana.com ↗
          </a>{" "}
          and request a few SOL. A $50 loan locks roughly 1 SOL.
          {publicKey && (
            <div className="mt-2">
              <AddrCopy value={publicKey.toBase58()} full />
              {balances.data && <span className="ml-2 text-xs">· you have {balances.data.solUi.toFixed(2)} SOL</span>}
            </div>
          )}
        </>
      ),
    },
    {
      title: "Get test USDC and USDT",
      done: known(stable !== undefined && stable >= 1_000_000n),
      body: (
        <>
          You&apos;ll need a little more than you borrow to repay with interest, and some to try the lending pool.
          {faucet?.enabled ? (
            <div className="mt-3">
              <Button variant="secondary" loading={busy} onClick={claim}>
                Send me {formatStable(BigInt(faucet.amount), 0)} test USDC + USDT
              </Button>
            </div>
          ) : (
            <span> Ask the Loom team for test tokens with the Feedback button.</span>
          )}
        </>
      ),
    },
    {
      title: "Borrow against your SOL",
      done: known(all.length > 0),
      body: (
        <>
          On <Link href="/borrow" className="font-medium text-accent hover:underline">Borrow</Link>, pick an amount, read the checklist (it shows exactly what
          happens to your SOL in every case) and sign.
        </>
      ),
    },
    {
      title: "Repay it in full",
      done: known(all.some((l) => l.status === "repaid")),
      body: (
        <>
          On <Link href="/loans" className="font-medium text-accent hover:underline">My loans</Link>, pay in full. Your SOL comes back in the same
          transaction, and interest is only charged for the time you borrowed.
        </>
      ),
    },
    {
      title: "Mint your ZK credit certificate",
      done: known(certificates.data && certificates.data.length > 0),
      body: (
        <>
          On <Link href="/certificate" className="font-medium text-accent hover:underline">ZK certificate</Link>, prove you repaid without revealing which
          loan. You can send the certificate to a fresh wallet.
        </>
      ),
    },
    {
      title: "Borrow again at the 8% credit rate",
      done: known(all.some((l) => l.creditCertificate)),
      body: <>From the wallet holding the certificate, borrow up to 2× your repaid loan. The borrow page applies the lower rate automatically.</>,
    },
    {
      title: "Deposit into the lending pool",
      done: known(positions.data?.some((p) => p.shares > 0n)),
      body: (
        <>
          On <Link href="/earn" className="font-medium text-accent hover:underline">Earn</Link>, deposit test USDC or USDT and watch it earn interest from
          borrowers.
        </>
      ),
    },
  ];
  const done = steps.filter((s) => s.done).length;

  return (
    <>
      <PageHeader
        title="Help us test Loom"
        subtitle="Try every feature on Solana devnet in about 10 minutes, then tell us what was confusing or missing. Each step ticks itself off from your wallet's on-chain activity."
      >
        <Badge tone={done === steps.length ? "good" : "neutral"}>
          {done}/{steps.length} done
        </Badge>
      </PageHeader>
      {CLUSTER === "mainnet-beta" && <Notice tone="warn">This guide is for devnet. On mainnet, loans use real money.</Notice>}
      <div className="grid gap-4">
        {steps.map((s, i) => (
          <Card key={s.title}>
            <div className="flex items-start gap-4">
              <div
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${s.done ? "bg-good-soft text-good" : "bg-surface-2 text-muted"}`}
              >
                {s.done ? "✓" : i + 1}
              </div>
              <div className="text-sm">
                <div className="text-base font-semibold">{s.title}</div>
                <div className="mt-1 text-muted">{s.body}</div>
              </div>
            </div>
          </Card>
        ))}
        <Card>
          <div className="text-base font-semibold">Tell us what you think</div>
          <p className="mt-1 text-sm text-muted">
            Use the <span className="font-medium text-fg">Feedback</span> button in the corner at any step: what you tried, what confused you, what
            you&apos;d need to use this with real money. Every message is read by the team.
          </p>
          {publicKey && (
            <a className="mt-3 inline-block text-sm font-medium text-accent hover:underline" href={explorerUrl("address", publicKey.toBase58())} target="_blank" rel="noreferrer">
              See your wallet&apos;s activity on Solscan ↗
            </a>
          )}
        </Card>
      </div>
    </>
  );
}
