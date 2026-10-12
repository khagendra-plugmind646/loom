"use client";

import { useState, useSyncExternalStore } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState } from "@solana/wallet-adapter-base";

/**
 * Phone browsers have no wallet extensions, so wallets can't connect there. Offer to reopen this page
 * inside a wallet app's built-in browser instead (universal links; nothing is sent anywhere else).
 */
const APPS = [
  { name: "Phantom", link: (url: string, ref: string) => `https://phantom.app/ul/browse/${url}?ref=${ref}` },
  { name: "Solflare", link: (url: string, ref: string) => `https://solflare.com/ul/v1/browse/${url}?ref=${ref}` },
  { name: "Backpack", link: (url: string, ref: string) => `https://backpack.app/ul/v1/browse/${url}?ref=${ref}` },
];
const DISMISS_KEY = "loom:open-in-wallet-dismissed";
const noop = () => () => {};

function wasDismissed() {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function OpenInWallet() {
  const { wallets, connected } = useWallet();
  const [dismissed, setDismissed] = useState(false);
  // browser-only checks; false during server rendering
  const isClient = useSyncExternalStore(noop, () => true, () => false);
  const phone = isClient && window.matchMedia("(pointer: coarse)").matches && window.innerWidth < 768;
  const noWallet = !wallets.some((w) => w.readyState === WalletReadyState.Installed);
  const show = phone && noWallet && !connected && !dismissed && !wasDismissed();
  const here = isClient ? { url: encodeURIComponent(window.location.href), ref: encodeURIComponent(window.location.origin) } : { url: "", ref: "" };

  if (!show) return null;
  return (
    <div className="border-b border-border bg-accent-soft px-4 py-2.5 text-sm">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-fg">On a phone? Open Loomzk in your wallet app to connect:</span>
        <div className="flex gap-2">
          {APPS.map((a) => (
            <a key={a.name} href={a.link(here.url, here.ref)} className="rounded-lg bg-surface px-2.5 py-1 font-medium text-accent">
              {a.name}
            </a>
          ))}
        </div>
        <button
          className="ml-auto text-xs text-muted"
          onClick={() => {
            try {
              localStorage.setItem(DISMISS_KEY, "1");
            } catch {
              // private mode: hiding it for this visit is enough
            }
            setDismissed(true);
          }}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
