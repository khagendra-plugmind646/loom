"use client";

import { useState, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RPC_URL } from "@/lib/env";
import { ToastProvider } from "./toast";
import "@solana/wallet-adapter-react-ui/styles.css";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 5_000, retry: 1 } } }));
  return (
    <QueryClientProvider client={queryClient}>
      <ConnectionProvider endpoint={RPC_URL} config={{ commitment: "confirmed" }}>
        {/* Phantom, Solflare, Backpack, etc. register themselves via the Wallet Standard. */}
        <WalletProvider wallets={[]} autoConnect>
          <WalletModalProvider>
            <ToastProvider>{children}</ToastProvider>
          </WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
    </QueryClientProvider>
  );
}
