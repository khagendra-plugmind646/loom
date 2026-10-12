"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { CLUSTER } from "@/lib/env";
import { OpenInWallet } from "./open-in-wallet";
import { ThemeToggle } from "./theme-toggle";
import { cx } from "./ui";

// The wallet button reads browser-only wallet state; render it on the client only.
const WalletMultiButton = dynamic(() => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton), {
  ssr: false,
  loading: () => <div className="h-10 w-36 rounded-[10px] bg-surface-2" />,
});

const links = [
  { href: "/borrow", label: "Borrow" },
  { href: "/loans", label: "My loans" },
  { href: "/earn", label: "Earn" },
  { href: "/wallet", label: "Wallet" },
  { href: "/certificate", label: "ZK certificate" },
  { href: "/transparency", label: "Transparency" },
];

export function Nav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-border/80 bg-surface/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:gap-6">
        <Link href="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <Logo />
          <Wordmark />
          {CLUSTER !== "mainnet-beta" && <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-accent">{CLUSTER}</span>}
        </Link>
        <nav className="hidden flex-1 items-center justify-center gap-1 md:flex">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={cx("rounded-lg px-3 py-2 text-sm transition", pathname.startsWith(l.href) ? "bg-surface-2 font-medium text-fg" : "text-muted hover:text-fg")}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2 md:ml-0 ml-auto">
          {/* on phones the theme toggle moves into the menu, leaving room for the wallet button */}
          <div className="hidden sm:block">
            <ThemeToggle />
          </div>
          <WalletMultiButton />
          <button className="rounded-lg p-2 md:hidden" aria-label="Menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
              <path d="M3 6h14M3 10h14M3 14h14" />
            </svg>
          </button>
        </div>
      </div>
      <OpenInWallet />
      {open && (
        <nav className="border-t border-border bg-surface px-4 py-2 md:hidden">
          {links.map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2.5 text-sm hover:bg-surface-2">
              {l.label}
            </Link>
          ))}
          <div className="flex items-center justify-between px-3 py-2 text-sm sm:hidden">
            <span className="text-muted">Theme</span>
            <ThemeToggle />
          </div>
        </nav>
      )}
    </header>
  );
}

export function Logo() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden>
      <defs>
        <linearGradient id="loom-logo" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#6142f5" />
          <stop offset="1" stopColor="#12b886" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#loom-logo)" />
      <path d="M10 9h3v11h10v3H10z" fill="white" />
      <circle cx="21.5" cy="13" r="3" fill="white" opacity=".9" />
    </svg>
  );
}

/** "Loom" with a small raised "zk", as in brand/banner.svg. */
export function Wordmark() {
  return (
    <span>
      Loom<sup className="ml-px text-[0.6em] font-bold text-accent">zk</sup>
    </span>
  );
}
