import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { LiveStats } from "@/components/live-stats";
import { LoanPreview } from "@/components/loan-preview";
import { Wordmark } from "@/components/nav";
import { RevealObserver } from "@/components/motion";
import { SolPrice } from "@/components/sol-price";
import { Vault } from "@/components/vault";
import {
  IconAlert,
  IconArrow,
  IconBolt,
  IconChart,
  IconCheck,
  IconClock,
  IconEye,
  IconFile,
  IconKey,
  IconLock,
  IconPlus,
  IconShield,
  IconX,
  ChainlinkIcon,
  SolIcon,
  UsdcIcon,
  UsdtIcon,
} from "@/components/icons";
import { buttonBase, buttonVariant, cx } from "@/components/ui";

const steps = [
  {
    n: "01",
    title: "Lock SOL in escrow",
    body: "Your SOL moves into an escrow account owned by the Loomzk program, not by us. It must be worth at least 2× the loan.",
  },
  {
    n: "02",
    title: "Receive USDC or USDT instantly",
    body: "In the same transaction, the program sends the stablecoin you chose, from the lending pool or the Loomzk treasury, straight to your wallet or to another wallet you pick.",
  },
  {
    n: "03",
    title: "Repay any time within 12 months",
    body: "Pay back the loan plus 12% a year, only for the time you borrow, in USDC or USDT, in one go or in parts.",
  },
  {
    n: "04",
    title: "Get your SOL back, plus a ZK credit proof",
    body: "The final payment releases your collateral automatically. Then mint a zero-knowledge certificate that lowers your rate next time.",
  },
];

const pillars = [
  {
    icon: <IconLock />,
    title: "Escrow enforced by code",
    body: "Each loan has its own escrow PDA. Only the program's published rules can move it: full repayment (all back to you), a 40% SOL drop (to the treasury), or an unpaid deadline (what you owe to the treasury, the rest back to you).",
  },
  {
    icon: <IconEye />,
    title: "Reserves you can audit",
    body: "Every loan, escrow and payout is a public Solana transaction. Check any of them on Solscan, or see the live totals on the Transparency page.",
  },
  {
    icon: <IconFile />,
    title: "Terms that can't change",
    body: "2× collateral, 12% yearly interest, the credit rates and the 12-month term are compiled into the program. Risk settings are snapshotted on every loan.",
  },
  {
    icon: <IconKey />,
    title: "Zero-knowledge certificates",
    body: "Prove “I repaid a loan of at least $X in full and on time” from a fresh wallet. Groth16 proofs are verified on-chain.",
  },
];

const problems = [
  {
    title: "Your collateral wasn't yours",
    body: "Centralized lenders pooled customer deposits and lent them on. When markets turned in 2022, Celsius, Voyager and BlockFi froze withdrawals and filed for bankruptcy.",
  },
  {
    title: "Reserves you couldn't check",
    body: "Borrowers had to take solvency on faith: occasional attestations at best, never a live view of where the money actually was.",
  },
  {
    title: "Credit that doesn't travel",
    body: "A clean repayment record either stays locked in one company's database, or, on-chain, exposes your whole wallet history to anyone who looks.",
  },
];

const features = [
  { icon: <IconLock />, title: "One escrow per loan", body: "Collateral is never pooled or lent on. Each loan's SOL sits in its own program-owned account." },
  { icon: <IconClock />, title: "Fixed, simple terms", body: "12% a year, charged only while you borrow, down to 6% as your ZK credit history grows. No variable rates, no compounding, no early-repayment penalty." },
  { icon: <IconEye />, title: "Live proof of reserves", body: "Liquidity, escrows and outstanding debt are read straight from Solana, in real time, by anyone." },
  { icon: <IconBolt />, title: "Funds in one transaction", body: "Collateral in, stablecoins out, atomically. Send the USDC or USDT to your wallet or to any other address." },
  { icon: <IconChart />, title: "Oracle-priced", body: "Collateral is valued with two SOL/USD oracles, Pyth (Wormhole-verified) and Chainlink, at the lower price. Seizing needs both to agree." },
  { icon: <IconKey />, title: "Private credit history", body: "Mint a zero-knowledge certificate proving you repaid, without revealing which loan or which wallet." },
];

const compareRows: [string, ReactNode, string, string][] = [
  ["Who holds the collateral", "A program escrow, one per loan", "The company", "A shared pool contract"],
  ["Cost of borrowing", "12% a year, only while you borrow; 6–8% with credit", "Set by the provider", "Variable, moves with utilization"],
  ["When collateral is taken", "One published line (60% of the opening price), lowered by adding SOL", "Margin calls set by the provider", "LTV thresholds, with liquidation penalties"],
  ["Proof of reserves", "Live, every account on-chain", "Periodic attestations, if any", "On-chain"],
  ["Portable, private credit record", "ZK repayment certificates", "No", "No"],
  ["What you need", "Any Solana wallet", "An account with KYC", "Any wallet"],
];

const architecture = [
  { title: "Escrow PDA", body: "One per loan. Holds the SOL; only repay or the seizure rule can move it." },
  { title: "Lending pool + treasury", body: "Depositors' pool funds loans first and earns the interest; the treasury lends through a capped SPL approval and backstops the pool." },
  { title: "Pyth + Chainlink", body: "Two SOL/USD oracles, checked for freshness. Opening uses the lower price; seizing needs both." },
  { title: "Keeper", body: "Anyone can settle loans past the rules; the program decides where SOL goes." },
  { title: "ZK verifier", body: "Groth16 proofs over a Poseidon Merkle tree of repaid loans." },
];

const roadmap = [
  {
    phase: "Shipped",
    tag: "Live on devnet",
    tone: "good" as const,
    items: [
      "SOL-backed USDC and USDT loans",
      "Interest only for the time borrowed",
      "Lending pool for depositors",
      "ZK credit levels: 8% → 7% → 6%",
      "Add SOL to protect a loan",
      "Pyth + Chainlink price checks",
      "Live proof of reserves",
      "Permissionless liquidation keeper",
    ],
  },
  {
    phase: "Next",
    tag: "Before mainnet",
    tone: "accent" as const,
    items: [
      "Independent audit of the program and circuit",
      "Multi-party trusted setup ceremony",
      "Multisig for upgrades, admin and treasury",
      "Keeper monitoring and alerts",
      "Dedicated RPC and a hosted keeper",
    ],
  },
  {
    phase: "Later",
    tag: "Exploring",
    tone: "neutral" as const,
    items: ["More collateral, such as liquid staking tokens", "ZK credit history other Solana lenders can use", "Loan extensions at the deadline"],
  },
];

const faqs = [
  { q: "How much can I borrow?", a: "Each loan is currently between $10 and $100,000 in USDC or USDT, limited by the SOL you lock (at least 2× the loan) and by what the lending pool and treasury can lend." },
  { q: "What does a loan cost?", a: "12% a year on what you still owe, charged only for the time you borrow (minimum 30 days), fixed when the loan opens. Repay on time and your ZK credit certificates lower it to 8%, then 7%, then 6%. No other Loomzk fees and no early-repayment penalty; you only pay normal Solana network fees." },
  { q: "Can I repay early or in parts?", a: "Yes. Repay any time within 12 months, all at once or in several payments, in USDC or USDT. The final payment releases your SOL automatically." },
  { q: "What happens if the SOL price falls?", a: "If SOL trades at or below 60% of its price when your loan opened, the loan is closed and all the escrowed SOL goes to the treasury. You keep the stablecoins you borrowed. You can add SOL to a loan at any time to lower that line. If the loan isn't repaid by its deadline, the treasury takes only SOL worth what you still owe and the rest is sent back to your wallet." },
  { q: "Who holds my SOL while the loan is open?", a: "A program-derived escrow account owned by the Loomzk program. No person, including the Loomzk team, holds a key to it. Only a full repayment or the published seizure rule can move it." },
  { q: "Where does the money come from?", a: "From the lending pool, where depositors supply USDC and USDT and earn the interest, or from the Loomzk treasury when the pool can't cover a loan. The program pays you in the same transaction that locks your collateral." },
  { q: "What is a ZK repayment certificate?", a: "A zero-knowledge proof that you repaid a Loomzk loan of at least a chosen amount, in full and on time. You can claim it from a fresh wallet, so it proves your track record without linking back to the loan." },
  { q: "Is Loomzk live on mainnet?", a: "Not yet. Loomzk runs on Solana devnet today. An independent audit, a trusted-setup ceremony and multisig controls come before mainnet." },
];

const builtWith = [
  { name: "Solana", role: "On-chain loans and escrow", href: "https://solana.com", icon: <SolIcon size={36} /> },
  { name: "Chainlink", role: "SOL/USD price feed", href: "https://chain.link", icon: <ChainlinkIcon size={36} /> },
];

export default function Home() {
  return (
    <div className="flex flex-col">
      <RevealObserver />
      {/* Hero */}
      <section className="hero-bg relative left-1/2 -mt-8 w-screen -translate-x-1/2 sm:-mt-12">
        <div className="grid-bg pointer-events-none absolute inset-0" aria-hidden />
        <div className="relative mx-auto grid max-w-6xl items-center gap-6 px-4 pt-16 pb-16 sm:pt-20 sm:pb-20 lg:grid-cols-[1.1fr_1fr] lg:gap-10">
          <div>
            <div className="rise inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-muted shadow-[0_1px_2px_#0b12200a]">
              <SolIcon size={16} /> Built on Solana
              <span className="h-3 w-px bg-border" />
              <span className="text-good">Live on devnet</span>
            </div>
            <h1 style={d(80)} className="rise mt-6 text-5xl leading-[1.04] font-semibold tracking-[-0.035em] sm:text-6xl lg:text-[68px]">
              Borrow dollars against your SOL. <span className="text-gradient">Verify every step.</span>
            </h1>
            <p style={d(160)} className="rise mt-6 max-w-xl text-lg text-muted">
              Lock SOL, receive USDC or USDT in seconds, and repay any time within a year at 12% a year, only for the time you borrow. Collateral, reserves and repayments
              all live on the blockchain, where anyone can audit them.
            </p>
            <div style={d(240)} className="rise mt-9 flex flex-wrap gap-3">
              <Link href="/borrow" className={cx(buttonBase, buttonVariant.primary, "h-12 px-6 text-base")}>
                Get a loan <IconArrow />
              </Link>
              <Link href="/transparency" className={cx(buttonBase, buttonVariant.secondary, "h-12 px-6 text-base")}>
                See proof of reserves
              </Link>
            </div>
            <ul style={d(320)} className="rise mt-9 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
              {["No custodian", "12% a year, fixed", "Repay any time", "Funds in one transaction"].map((t) => (
                <li key={t} className="flex items-center gap-1.5">
                  <IconCheck width={16} height={16} className="text-good" /> {t}
                </li>
              ))}
            </ul>
            <div style={d(400)} className="rise mt-8 max-w-md">
              <SolPrice />
            </div>
          </div>
          <div style={d(200)} className="rise">
            <Vault />
          </div>
        </div>
      </section>

      {/* Built with */}
      <section className="relative left-1/2 w-screen -translate-x-1/2 border-y border-border bg-surface">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-5 px-4 py-8 sm:flex-row sm:justify-center sm:gap-10">
          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Built with</span>
          <ul className="grid w-full max-w-sm gap-3 sm:flex sm:w-auto sm:max-w-none">
            {builtWith.map((b) => (
              <li key={b.name}>
                <a
                  href={b.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-center gap-3 rounded-2xl border border-border bg-bg py-3 pr-5 pl-3 transition sm:min-w-60 duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-[0_8px_24px_-12px_#0b122040]"
                >
                  {b.icon}
                  <span className="flex flex-col">
                    <span className="flex items-center gap-1 text-[15px] font-semibold tracking-tight">
                      {b.name}
                      <IconArrow width={14} height={14} className="-rotate-45 text-muted opacity-0 transition group-hover:opacity-100" />
                    </span>
                    <span className="text-xs text-muted">{b.role}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Try it */}
      <section className="mt-28 grid items-center gap-12 sm:mt-36 lg:grid-cols-[1fr_1.05fr] lg:gap-16">
        <div className="reveal">
          <div className="eyebrow">Try it</div>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-[40px] sm:leading-[1.12]">See your loan before you connect a wallet.</h2>
          <p className="mt-4 max-w-md text-muted">
            Pick an amount and watch the terms update from the live Pyth and Chainlink SOL price: how much SOL is locked, what you repay, and the exact
            price at which the collateral would be seized. No surprises later.
          </p>
          <ul className="mt-8 space-y-4">
            {[
              ["Collateral", "At least 2× the loan, valued at a conservative oracle price"],
              ["Cost", "12% a year, only for the time you borrow; 8% with a credit certificate"],
              ["Risk line", "All SOL is seized only if SOL falls to 60% of today's price"],
            ].map(([k, v]) => (
              <li key={k} className="flex gap-3">
                <IconCheck className="mt-0.5 shrink-0 text-good" />
                <span className="text-sm">
                  <span className="font-semibold">{k}.</span> <span className="text-muted">{v}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div style={d(120)} className="reveal">
          <LoanPreview />
        </div>
      </section>

      {/* Live stats */}
      <Section
        eyebrow="Live from the chain"
        title="Every number here is read from Solana, right now."
        aside={
          <Link href="/transparency" className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:text-accent-hover">
            Verify on the Transparency page <IconArrow />
          </Link>
        }
      >
        <LiveStats />
      </Section>

      {/* Problem */}
      <Section eyebrow="The problem" title="Crypto lending asked you to trust a balance sheet. In 2022, that trust broke.">
        <div className="grid gap-4 md:grid-cols-3">
          {problems.map((p, i) => (
            <div key={p.title} style={d(i * 90)} className="reveal rounded-2xl border border-border bg-surface p-6">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-bad-soft text-bad">
                <IconX />
              </div>
              <h3 className="mt-5 text-lg font-semibold tracking-tight">{p.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{p.body}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Solution */}
      <Section eyebrow="The Loomzk approach" title="A lender that is a public program, not a company.">
        <div className="grid overflow-hidden rounded-3xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3 [&>*]:bg-surface" style={{ gap: 1 }}>
          {features.map((f, i) => (
            <div key={f.title} style={d((i % 3) * 90)} className="reveal p-7">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent">{f.icon}</div>
              <h3 className="mt-5 font-semibold tracking-tight">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{f.body}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* How it works */}
      <Section eyebrow="How it works" title="From SOL to stablecoins in one transaction.">
        <ol className="relative grid gap-8 lg:grid-cols-4 lg:gap-6">
          <div className="reveal-line absolute top-5 right-[24%] left-5 hidden h-px bg-gradient-to-r from-accent/40 via-accent/40 to-mint/50 lg:block" aria-hidden />
          {steps.map((s, i) => (
            <li key={s.n} style={d(200 + i * 220)} className="reveal relative">
              <div className="relative z-10 flex h-10 w-10 items-center justify-center rounded-full border border-accent/30 bg-surface font-mono text-sm font-semibold text-accent shadow-[0_0_0_6px_var(--bg)]">
                {s.n}
              </div>
              <h3 className="mt-5 text-lg font-semibold tracking-tight">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
            </li>
          ))}
        </ol>
        <div className="reveal mt-12 flex flex-wrap items-center justify-center gap-3 rounded-2xl border border-border bg-surface p-5 text-sm">
          <span className="flex items-center gap-2 font-semibold">
            <SolIcon /> Lock ≥ $2,000 of SOL
          </span>
          <IconArrow className="text-muted" />
          <span className="flex items-center gap-2 font-semibold">
            <UsdcIcon /> Receive $1,000
          </span>
          <IconArrow className="text-muted" />
          <span className="flex items-center gap-2 font-semibold">
            <UsdtIcon /> Repay at most $1,120 within 12 months
          </span>
          <IconArrow className="text-muted" />
          <span className="flex items-center gap-2 font-semibold text-good">
            <IconCheck /> Your SOL comes back
          </span>
        </div>
      </Section>

      {/* Risk rules */}
      <Section eyebrow="Clear rules" title="Three outcomes, all written in the program.">
        <div className="grid gap-4 md:grid-cols-3">
          <Outcome delay={0} tone="good" icon={<IconCheck />} label="You repay in full" body="Within 12 months, in one go or in parts. Your SOL is released back to your wallet in the same transaction as the final payment." />
          <Outcome delay={90} tone="warn" icon={<IconAlert />} label="SOL falls to 60%" body="If SOL trades at or below 60% of its price when the loan opened, the loan closes and all the escrowed SOL goes to the treasury. You keep the stablecoins. Adding SOL lowers that line." />
          <Outcome delay={180} tone="bad" icon={<IconClock />} label="12 months pass unpaid" body="The loan has matured. SOL worth what you still owe goes to the treasury, the rest returns to your wallet, and the loan is closed. You keep the stablecoins." />
        </div>
      </Section>

      {/* ZK certificates */}
      <section className="ink-band relative left-1/2 mt-28 w-screen -translate-x-1/2 sm:mt-36">
        <div className="mx-auto grid max-w-6xl items-center gap-14 px-4 py-20 sm:py-28 lg:grid-cols-2">
          <div className="reveal">
            <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[#a99bff]">Zero-knowledge credit</div>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-[42px] sm:leading-[1.1]">Prove you&apos;re a good borrower without revealing who you are.</h2>
            <p className="mt-5 max-w-lg text-[#b8c0d0]">
              When your loan is repaid, the program adds it to an on-chain credit tree. Later, from any wallet, you can prove you repaid a loan
              of at least a chosen amount, in full and on time, and borrow at 8%, then 7%, then 6% as your record grows. The proof reveals nothing
              else.
            </p>
            <ul className="mt-8 grid gap-3 text-sm sm:grid-cols-2">
              {["Which loan stays hidden", "Your borrowing wallet stays hidden", "Exact amounts stay hidden", "Verified on-chain (Groth16)"].map((t) => (
                <li key={t} className="flex items-center gap-2 text-[#dfe4ee]">
                  <IconCheck width={16} height={16} className="text-mint" /> {t}
                </li>
              ))}
            </ul>
            <Link href="/certificate" className={cx(buttonBase, "mt-9 h-12 bg-white px-6 text-base text-[#0b1220] hover:bg-white/90")}>
              Explore ZK certificates <IconArrow />
            </Link>
          </div>
          <div style={d(150)} className="reveal relative mx-auto w-full max-w-md">
            <div className="absolute -inset-8 rounded-[40px] bg-gradient-to-br from-accent/40 to-mint/30 blur-3xl" aria-hidden />
            <div className="relative rounded-3xl border border-white/15 bg-white/[0.06] p-7 backdrop-blur-xl">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-[#a99bff]">Loomzk credit certificate</span>
                <span className="rounded-full bg-mint/15 px-2.5 py-1 text-xs font-semibold text-mint">Verified</span>
              </div>
              <div className="mt-8 text-sm text-[#b8c0d0]">This wallet proved it repaid a loan of at least</div>
              <div className="mt-1 text-5xl font-semibold tracking-tight">$1,000</div>
              <div className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-white/10 text-sm">
                {[
                  ["Repaid", "In full"],
                  ["Timing", "Within 12 months"],
                  ["Original loan", "Hidden"],
                  ["Borrowing wallet", "Hidden"],
                ].map(([k, v]) => (
                  <div key={k} className="bg-[#0b1220]/60 p-3.5">
                    <div className="text-xs text-[#8e98ab]">{k}</div>
                    <div className="mt-0.5 font-medium">{v}</div>
                  </div>
                ))}
              </div>
              <div className="mt-6 flex items-center justify-between font-mono text-[11px] text-[#8e98ab]">
                <span>proof: groth16 · bn254</span>
                <span>Example</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Architecture */}
      <Section eyebrow="Under the hood" title="One Anchor program. Every account public.">
        <div className="reveal grid items-center gap-6 lg:grid-cols-[1fr_1.1fr_1fr]">
          <div className="flex flex-col gap-4">
            <ArchCard title="Borrower wallet" body="Signs open_loan and repay. Receives the stablecoins, or names another wallet to receive them." />
            {architecture.slice(0, 2).map((a) => (
              <ArchCard key={a.title} {...a} />
            ))}
          </div>
          <div className="relative rounded-3xl bg-[#0b1220] p-7 text-white shadow-[0_24px_64px_-20px_#0b122066] dark:border dark:border-border dark:bg-surface-2">
            <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[#a99bff]">Loomzk program · Anchor</div>
            <div className="mt-3 text-2xl font-semibold tracking-tight">The only one who can move funds</div>
            <ul className="mt-6 space-y-2 font-mono text-sm">
              {[
                ["open_loan", "lock SOL, pay stablecoin"],
                ["repay", "partial or full, release SOL"],
                ["add_collateral", "add SOL, lower the seizure price"],
                ["deposit · withdraw", "lending pool shares"],
                ["liquidate", "seize at 60%; at maturity take what's owed"],
                ["claim_certificate", "verify a ZK proof"],
              ].map(([ix, what]) => (
                <li key={ix} className="flex flex-wrap items-baseline justify-between gap-2 rounded-xl bg-white/[0.06] px-3.5 py-2.5">
                  <span className="text-mint">{ix}</span>
                  <span className="font-sans text-xs text-[#b8c0d0]">{what}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-col gap-4">
            {architecture.slice(2).map((a) => (
              <ArchCard key={a.title} {...a} />
            ))}
          </div>
        </div>
      </Section>

      {/* Comparison */}
      <Section eyebrow="Why Loomzk" title="How Loomzk compares.">
        {/* phones: one card per row, so nothing hides off-screen */}
        <div className="reveal divide-y divide-border rounded-3xl border border-border bg-surface sm:hidden">
          {compareRows.map(([label, loom, cefi, pools]) => (
            <div key={label} className="p-5">
              <div className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">{label}</div>
              <div className="mt-2 flex items-start gap-2 text-[15px] font-medium">
                <IconCheck width={16} height={16} className="mt-1 shrink-0 text-good" /> <span>Loomzk: {loom}</span>
              </div>
              <div className="mt-2 space-y-1 text-sm text-muted">
                <div>Centralized lenders: {cefi}</div>
                <div>Variable-rate DeFi pools: {pools}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="reveal hidden overflow-x-auto rounded-3xl border border-border bg-surface sm:block">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="w-1/4 p-5 font-medium text-muted" />
                <th className="w-1/4 bg-accent-soft/60 p-5">
                  <span className="flex items-center gap-2 font-semibold"><Wordmark /></span>
                </th>
                <th className="w-1/4 p-5 font-semibold">Centralized lenders</th>
                <th className="w-1/4 p-5 font-semibold">Variable-rate DeFi pools</th>
              </tr>
            </thead>
            <tbody>
              {compareRows.map(([label, loom, cefi, pools]) => (
                <tr key={label} className="border-b border-border last:border-b-0">
                  <td className="p-5 font-medium">{label}</td>
                  <td className="bg-accent-soft/60 p-5">
                    <span className="flex items-start gap-2 font-medium">
                      <IconCheck width={16} height={16} className="mt-0.5 shrink-0 text-good" /> {loom}
                    </span>
                  </td>
                  <td className="p-5 text-muted">{cefi}</td>
                  <td className="p-5 text-muted">{pools}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Security */}
      <Section eyebrow="Security" title="Why you don't have to trust us.">
        <div className="grid gap-4 sm:grid-cols-2">
          {pillars.map((p, i) => (
            <div key={p.title} style={d((i % 2) * 90)} className="reveal flex gap-5 rounded-2xl border border-border bg-surface p-6">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#0b1220] text-white dark:bg-accent-soft dark:text-accent">{p.icon}</div>
              <div>
                <h3 className="font-semibold tracking-tight">{p.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{p.body}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="reveal mt-4 flex flex-col items-start gap-3 rounded-2xl border border-border bg-surface p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-good-soft text-good">
              <IconShield />
            </div>
            <div>
              <div className="font-semibold">Don&apos;t take our word for it</div>
              <div className="text-sm text-muted">Integrity checks run live against the program&apos;s accounts.</div>
            </div>
          </div>
          <Link href="/transparency" className={cx(buttonBase, buttonVariant.secondary)}>
            Run the checks <IconArrow />
          </Link>
        </div>
      </Section>

      {/* Roadmap */}
      <Section eyebrow="Roadmap" title="Where Loomzk is going.">
        <div className="grid gap-4 lg:grid-cols-3">
          {roadmap.map((r, i) => (
            <div key={r.phase} style={d(i * 110)} className={cx("reveal rounded-2xl border bg-surface p-6", r.tone === "accent" ? "border-accent/40 ring-4 ring-accent/5" : "border-border")}>
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold tracking-tight">{r.phase}</h3>
                <span
                  className={cx(
                    "rounded-full px-2.5 py-0.5 text-xs font-semibold",
                    r.tone === "good" && "bg-good-soft text-good",
                    r.tone === "accent" && "bg-accent-soft text-accent",
                    r.tone === "neutral" && "bg-surface-2 text-muted",
                  )}
                >
                  {r.tag}
                </span>
              </div>
              <ul className="mt-5 space-y-3 text-sm">
                {r.items.map((i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span
                      className={cx(
                        "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full",
                        r.tone === "good" ? "bg-good text-white" : "border border-border-strong",
                      )}
                    >
                      {r.tone === "good" && <IconCheck width={10} height={10} strokeWidth={3} />}
                    </span>
                    <span className={r.tone === "good" ? "" : "text-muted"}>{i}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>

      {/* FAQ */}
      <Section eyebrow="FAQ" title="Questions, answered.">
        <div className="reveal divide-y divide-border rounded-3xl border border-border bg-surface">
          {faqs.map((f) => (
            <details key={f.q} className="group px-6">
              <summary className="flex cursor-pointer items-center justify-between gap-4 py-5 font-semibold">
                {f.q}
                <IconPlus className="faq-icon shrink-0 text-muted transition-transform" />
              </summary>
              <p className="-mt-1 pb-5 text-sm leading-relaxed text-muted">{f.a}</p>
            </details>
          ))}
        </div>
      </Section>

      {/* Final CTA */}
      <section className="reveal ink-band mt-28 overflow-hidden rounded-3xl border border-(--band-border) px-6 py-16 text-center sm:mt-36 sm:py-24">
        <h2 className="mx-auto max-w-2xl text-3xl font-semibold tracking-tight sm:text-5xl sm:leading-[1.08]">
          Put your SOL to work, without handing it to anyone.
        </h2>
        <p className="mx-auto mt-5 max-w-lg text-[#b8c0d0]">Connect a wallet, pick an amount, and receive USDC or USDT in the same transaction.</p>
        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <Link href="/borrow" className={cx(buttonBase, "h-12 bg-white px-6 text-base text-[#0b1220] hover:bg-white/90")}>
            Get a loan <IconArrow />
          </Link>
          <Link href="/transparency" className={cx(buttonBase, "h-12 border border-white/20 px-6 text-base text-white hover:bg-white/10")}>
            See proof of reserves
          </Link>
        </div>
      </section>
    </div>
  );
}

/** Stagger delay for `.reveal` elements. */
const d = (ms: number) => ({ "--d": `${ms}ms` }) as CSSProperties;

function Section({ eyebrow, title, aside, children }: { eyebrow: string; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-28 sm:mt-36">
      <div className="reveal mb-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="eyebrow">{eyebrow}</div>
          <h2 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight sm:text-[40px] sm:leading-[1.12]">{title}</h2>
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Outcome({ delay, tone, icon, label, body }: { delay: number; tone: "good" | "warn" | "bad"; icon: ReactNode; label: string; body: string }) {
  return (
    <div style={d(delay)} className="reveal rounded-2xl border border-border bg-surface p-6">
      <div
        className={cx(
          "flex h-10 w-10 items-center justify-center rounded-xl",
          tone === "good" && "bg-good-soft text-good",
          tone === "warn" && "bg-warn-soft text-warn",
          tone === "bad" && "bg-bad-soft text-bad",
        )}
      >
        {icon}
      </div>
      <h3 className="mt-5 text-lg font-semibold tracking-tight">{label}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
    </div>
  );
}

function ArchCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="font-semibold">{title}</div>
      <p className="mt-1 text-sm text-muted">{body}</p>
    </div>
  );
}
