"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useQuery } from "@tanstack/react-query";
import {
  LoomClient,
  formatStable,
  identityCommitment,
  nullifierHash,
  proveRepaymentCertificate,
  type CertificateProof,
  type CreditNote,
  type LoanAccount,
} from "@loom/sdk";
import { Badge, Button, Card, CardTitle, Field, Input, Notice, PageHeader, Row, Segmented, Skeleton, Addr } from "@/components/ui";
import { useToast } from "@/components/toast";
import { useLoans, useLoom } from "@/lib/hooks";
import { extractNote, savedNotes } from "@/lib/notes";
import { explainError, useSendTx } from "@/lib/send";
import { ZK_VKEY, ZK_WASM, ZK_ZKEY, loadSnarkjs } from "@/lib/zk-browser";

const noop = () => () => {};
const THRESHOLDS = [100, 500, 1_000, 5_000, 10_000, 50_000, 100_000].map((n) => BigInt(n) * 1_000_000n);

export default function CertificatePage() {
  const [tab, setTab] = useState<"mint" | "verify">("mint");
  return (
    <>
      <PageHeader
        title="Zero-knowledge repayment certificate"
        subtitle="Prove you repaid a Loom loan in full and on time, without revealing which loan, how much exactly, or your borrowing wallet. The wallet holding the certificate borrows at 8% a year instead of 12%."
      >
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "mint", label: "Mint" },
            { value: "verify", label: "Verify" },
          ]}
        />
      </PageHeader>
      {tab === "mint" ? <MintCertificate /> : <VerifyCertificate />}
      <HowItWorks />
    </>
  );
}

function MintCertificate() {
  const client = useLoom();
  const { publicKey } = useWallet();
  const allLoans = useLoans(undefined);
  const { send } = useSendTx();
  const toast = useToast();

  const [noteText, setNoteText] = useState("");
  const [minPrincipal, setMinPrincipal] = useState<bigint | null>(null);
  const [proof, setProof] = useState<CertificateProof | null>(null);
  const [proving, setProving] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [claimed, setClaimed] = useState<string | null>(null);
  const [quick, setQuick] = useState<string | null>(null);
  const certificates = useQuery({ queryKey: ["certificates", "all"], queryFn: () => client.fetchCertificates() });

  // Repaid loans whose private note is saved in this browser: mint in one click (browser only).
  const isClient = useSyncExternalStore(noop, () => true, () => false);
  const ready = useMemo(() => {
    if (!isClient || !allLoans.data) return [];
    const minted = new Set((certificates.data ?? []).map((c) => c.nullifierHash));
    return savedNotes().flatMap(({ loan, note }) => {
      const l = allLoans.data.find((x) => x.address.toBase58() === loan);
      const best = l ? THRESHOLDS.filter((t) => t <= l.principal).at(-1) : undefined;
      if (!l || l.status !== "repaid" || l.creditLeafIndex === null || best === undefined) return [];
      return [{ loan: l, note, claim: best, minted: minted.has(nullifierHash(note)) }];
    });
  }, [isClient, allLoans.data, certificates.data]);

  async function quickMint(loan: LoanAccount, note: CreditNote, claimAmount: bigint) {
    if (!publicKey || !allLoans.data || loan.creditLeafIndex === null) return;
    setQuick(loan.address.toBase58());
    try {
      const snarkjs = await loadSnarkjs();
      const p = await proveRepaymentCertificate(
        {
          note,
          loan: { principal: loan.principal, totalRepaid: loan.repaid, startTs: loan.startTs, closedTs: loan.closedTs, leafIndex: Number(loan.creditLeafIndex) },
          leaves: LoomClient.creditLeaves(allLoans.data),
          minPrincipal: claimAmount,
          recipient: publicKey,
          wasm: ZK_WASM,
          zkey: ZK_ZKEY,
        },
        snarkjs.groth16,
      );
      const sig = await send(await client.claimCertificate(publicKey, p));
      setClaimed(sig);
      toast({ kind: "success", title: `Certificate minted: repaid ≥ $${formatStable(claimAmount, 0)}`, body: "Verified on-chain. This wallet now borrows at the credit rate.", tx: sig });
      await certificates.refetch();
    } catch (e) {
      toast({ kind: "error", title: "Couldn't mint the certificate", body: explainError(e) });
    } finally {
      setQuick(null);
    }
  }

  const parsed = useMemo((): { note?: CreditNote; error?: string } => {
    if (!noteText.trim()) return {};
    try {
      return { note: extractNote(noteText) };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [noteText]);

  const match = useMemo((): LoanAccount | null | undefined => {
    if (!parsed.note || !allLoans.data) return undefined;
    const id = identityCommitment(parsed.note);
    return allLoans.data.find((l) => l.identityCommitment === id) ?? null;
  }, [parsed.note, allLoans.data]);

  const thresholds = match ? THRESHOLDS.filter((t) => t <= match.principal) : [];
  const claim = minPrincipal ?? thresholds.at(-1) ?? null;
  const linked = match && publicKey && match.borrower.equals(publicKey);

  async function generate() {
    if (!parsed.note || !match || match.creditLeafIndex === null || !publicKey || claim === null || !allLoans.data) return;
    setProving(true);
    setProof(null);
    try {
      const snarkjs = await loadSnarkjs();
      const p = await proveRepaymentCertificate(
        {
          note: parsed.note,
          loan: {
            principal: match.principal,
            totalRepaid: match.repaid,
            startTs: match.startTs,
            closedTs: match.closedTs,
            leafIndex: Number(match.creditLeafIndex),
          },
          leaves: LoomClient.creditLeaves(allLoans.data),
          minPrincipal: claim,
          recipient: publicKey,
          wasm: ZK_WASM,
          zkey: ZK_ZKEY,
        },
        snarkjs.groth16,
      );
      setProof(p);
    } catch (e) {
      toast({ kind: "error", title: "Proof generation failed", body: explainError(e) });
    } finally {
      setProving(false);
    }
  }

  async function submit() {
    if (!proof || !publicKey) return;
    setClaiming(true);
    try {
      const sig = await send(await client.claimCertificate(publicKey, proof));
      setClaimed(sig);
      toast({ kind: "success", title: "Certificate minted", body: "The Groth16 proof was verified on-chain.", tx: sig });
    } catch (e) {
      toast({ kind: "error", title: "Claim failed", body: explainError(e) });
    } finally {
      setClaiming(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <Card>
        <div className="flex flex-col gap-5">
          {ready.length > 0 && (
            <div className="rounded-xl bg-good-soft p-4">
              <div className="text-sm font-medium text-good">Ready to mint from this browser</div>
              <p className="mt-1 text-xs text-muted">
                Your private notes for these repaid loans are saved here. The proof is made on this device and the certificate goes to the connected
                wallet{publicKey ? "" : " (connect one first)"}. Use a fresh wallet to keep it unlinked from your borrowing wallet.
              </p>
              <div className="mt-3 flex flex-col gap-2">
                {ready.map((r) => (
                  <div key={r.loan.address.toBase58()} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface px-3 py-2 text-sm">
                    <span>
                      Loan #{r.loan.id.toString()} · ${formatStable(r.loan.principal, 0)} · repaid {new Date(Number(r.loan.closedTs) * 1000).toLocaleDateString()}
                    </span>
                    {r.minted ? (
                      <Badge tone="good">Certificate minted</Badge>
                    ) : (
                      <Button
                        className="h-8 px-3 text-xs"
                        disabled={!publicKey || (quick !== null && quick !== r.loan.address.toBase58())}
                        loading={quick === r.loan.address.toBase58()}
                        onClick={() => quickMint(r.loan, r.note, r.claim)}
                      >
                        Mint certificate (≥ ${formatStable(r.claim, 0)})
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-3 text-xs text-muted">Or use a note file below.</div>
            </div>
          )}
          <Field label="1. Your private credit note" hint="Downloaded when you opened the loan">
            <textarea
              className="h-24 w-full resize-none rounded-[10px] border border-border bg-surface p-3 font-mono text-xs outline-none focus:border-accent"
              placeholder="loom-note-v1:…"
              value={noteText}
              onChange={(e) => {
                setNoteText(e.target.value);
                setProof(null);
                setMinPrincipal(null);
              }}
              spellCheck={false}
            />
          </Field>
          <input
            type="file"
            accept=".txt"
            className="text-sm text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-surface-2 file:px-3 file:py-2 file:text-sm"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) setNoteText(await f.text());
            }}
          />
          {parsed.error && <Notice tone="bad">{parsed.error}</Notice>}
          {parsed.note && allLoans.isLoading && <Skeleton className="h-10" />}
          {match === null && <Notice tone="bad">No Loom loan was opened with this note.</Notice>}
          {match && match.status !== "repaid" && (
            <Notice tone="warn">This loan is {match.status}. Certificates are only available for loans repaid in full within the term.</Notice>
          )}

          {match?.status === "repaid" && (
            <>
              <Field label="2. What do you want to prove?">
                <div className="flex flex-wrap gap-2">
                  {thresholds.map((t) => (
                    <button
                      key={t.toString()}
                      type="button"
                      onClick={() => {
                        setMinPrincipal(t);
                        setProof(null);
                      }}
                      className={`h-9 rounded-lg border px-3 text-sm ${claim === t ? "border-accent bg-accent-soft text-accent" : "border-border"}`}
                    >
                      ≥ ${formatStable(t, 0)}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted">
                  Statement: “I borrowed at least ${claim !== null ? formatStable(claim, 0) : "—"} on Loom and repaid principal + 12% within 12 months.” Round thresholds keep you inside a larger anonymity set.
                </p>
              </Field>

              <div>
                <div className="mb-1.5 text-sm font-medium">3. Certificate holder</div>
                {publicKey ? (
                  <div className="text-sm">
                    <span className="font-mono">{publicKey.toBase58()}</span>
                  </div>
                ) : (
                  <Notice>Connect the wallet that should hold the certificate.</Notice>
                )}
                {linked && (
                  <Notice tone="warn">
                    You are connected with the wallet that took the loan, so the certificate would be linkable to it. For privacy, switch to a fresh wallet first.
                  </Notice>
                )}
              </div>

              <div className="flex flex-wrap gap-3">
                <Button loading={proving} disabled={!publicKey || claim === null} onClick={generate}>
                  {proving ? "Generating proof in your browser…" : "Generate ZK proof"}
                </Button>
                {proof && (
                  <Button loading={claiming} disabled={!!claimed} onClick={submit}>
                    {claimed ? "Certificate minted" : "Verify on-chain & mint certificate"}
                  </Button>
                )}
              </div>
              {proof && (
                <div className="rounded-xl bg-surface-2 p-4 font-mono text-xs">
                  <div className="mb-2 font-sans text-sm font-medium">Public inputs (everything the verifier sees)</div>
                  <div className="break-all">root: {proof.publicSignals[0]}</div>
                  <div className="break-all">nullifierHash: {proof.publicSignals[1]}</div>
                  <div>minPrincipal: {proof.publicSignals[2]}</div>
                  <div className="break-all">recipient: {proof.publicSignals[3]} · {proof.publicSignals[4]}</div>
                </div>
              )}
            </>
          )}
        </div>
      </Card>
      <Card>
        <CardTitle>What stays private</CardTitle>
        <ul className="space-y-2 text-sm text-muted">
          <li>• Which loan, and which wallet borrowed</li>
          <li>• The exact amount borrowed and repaid</li>
          <li>• When the loan was opened and closed</li>
        </ul>
        <h3 className="mb-3 mt-6 text-base font-semibold">What is proven</h3>
        <ul className="space-y-2 text-sm text-muted">
          <li>• The loan is in Loom&apos;s on-chain credit tree, which only fully repaid loans enter</li>
          <li>• Repaid in full: principal + interest for the time borrowed (the tree only accepts full, on-time repayments)</li>
          <li>• Closed ≤ 365 days after opening</li>
          <li>• Principal ≥ your chosen threshold</li>
          <li>• One certificate per loan (nullifier)</li>
        </ul>
      </Card>
    </div>
  );
}

function VerifyCertificate() {
  const client = useLoom();
  const [input, setInput] = useState("");
  const certificates = useQuery({ queryKey: ["certificates"], queryFn: () => client.fetchCertificates() });
  const vkey = useQuery({ queryKey: ["vkey"], queryFn: () => fetch(ZK_VKEY).then((r) => r.json()) });

  let holder: PublicKey | null = null;
  try {
    holder = input ? new PublicKey(input.trim()) : null;
  } catch {
    holder = null;
  }
  const held = holder ? (certificates.data ?? []).filter((c) => c.holder.equals(holder!)) : [];

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <Card>
        <Field label="Wallet address to check">
          <Input placeholder="Solana address" value={input} onChange={(e) => setInput(e.target.value)} spellCheck={false} />
        </Field>
        <div className="mt-5">
          {!holder ? (
            <p className="text-sm text-muted">Enter an address to see its repayment certificates.</p>
          ) : certificates.isLoading ? (
            <Skeleton className="h-20" />
          ) : held.length === 0 ? (
            <Notice>This wallet holds no Loom repayment certificate.</Notice>
          ) : (
            held.map((c) => (
              <div key={c.address.toBase58()} className="mb-3 rounded-xl bg-good-soft p-4 text-sm">
                <div className="flex items-center gap-2 font-medium text-good">
                  <Badge tone="good">Verified on-chain</Badge> Repaid a loan of at least ${formatStable(c.minPrincipal, 0)} in full, on time
                </div>
                <div className="mt-2 text-fg">
                  Unlocks <span className="font-medium">8% a year</span> (instead of 12%) on loans up to ${formatStable(c.minPrincipal * 2n, 0)}{" "}
                  borrowed from this wallet.{" "}
                  <Link href="/borrow" className="font-medium text-accent hover:underline">Borrow at the credit rate →</Link>
                </div>
                <div className="mt-3 text-fg">
                  <Row label="Issued">{new Date(Number(c.issuedAt) * 1000).toLocaleString()}</Row>
                  <Row label="Certificate account">
                    <Addr value={c.address.toBase58()} />
                  </Row>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>
      <Card>
        <CardTitle hint={`${certificates.data?.length ?? "—"} issued`}>Verifying key</CardTitle>
        <p className="text-sm text-muted">
          Proofs are checked by the Loom program with Solana&apos;s alt_bn128 syscalls against a verifying key compiled into the program. The same key is published here so anyone can verify proofs off-chain too.
        </p>
        {vkey.data && (
          <Row label="Public inputs">
            {vkey.data.nPublic} · {vkey.data.protocol}/{vkey.data.curve}
          </Row>
        )}
        <a href={ZK_VKEY} className="mt-3 inline-block text-sm text-accent hover:underline" target="_blank" rel="noreferrer">
          Download verification_key.json ↗
        </a>
      </Card>
    </div>
  );
}

function HowItWorks() {
  return (
    <Card className="mt-6">
      <CardTitle>How it works</CardTitle>
      <ol className="grid gap-4 text-sm text-muted sm:grid-cols-3">
        <li>
          <span className="font-medium text-fg">At borrowing.</span> Your browser creates a secret note and sends only its Poseidon commitment to the program.
        </li>
        <li>
          <span className="font-medium text-fg">At full repayment.</span> The program hashes (commitment, principal, repaid, start, close) into a leaf of an on-chain Poseidon Merkle tree.
        </li>
        <li>
          <span className="font-medium text-fg">Any time later.</span> You prove membership plus the repayment statement in a Groth16 circuit; the program verifies it and records a certificate for your chosen wallet.
        </li>
      </ol>
    </Card>
  );
}
