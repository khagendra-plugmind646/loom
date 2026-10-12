"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { Card, PageHeader } from "@/components/ui";
import { HelpForm } from "@/components/help-form";

export default function HelpPage() {
  const { publicKey } = useWallet();
  return (
    <>
      <PageHeader title="Help / contact us" subtitle="Questions about a loan, or need more than we can fund right now? Send us a message." />
      <Card className="max-w-xl">
        <HelpForm kind="general" wallet={publicKey?.toBase58()} />
        <p className="mt-4 text-xs text-muted">
          {publicKey ? "Your connected wallet address is attached so we can look up your loans." : "Connect your wallet if your question is about a loan."}
        </p>
      </Card>
    </>
  );
}
