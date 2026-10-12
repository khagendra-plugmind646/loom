import { PublicKey, clusterApiUrl } from "@solana/web3.js";
import { MAINNET_STABLECOINS } from "@loom/sdk";

export type Cluster = "mainnet-beta" | "devnet" | "localnet";

export const CLUSTER = (process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet") as Cluster;

export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ?? (CLUSTER === "localnet" ? "http://127.0.0.1:8899" : clusterApiUrl(CLUSTER));

export const PROGRAM_ID = process.env.NEXT_PUBLIC_PROGRAM_ID ? new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID) : undefined;

export const HERMES_URL = process.env.NEXT_PUBLIC_HERMES_URL ?? "https://hermes.pyth.network";

const envKey = (v?: string) => (v ? new PublicKey(v) : undefined);

/** Supported stablecoins. On devnet set NEXT_PUBLIC_USDC_MINT / NEXT_PUBLIC_USDT_MINT (see scripts/bootstrap.ts). */
export const STABLECOINS: { symbol: "USDC" | "USDT"; mint: PublicKey }[] = (
  [
    { symbol: "USDC", mint: envKey(process.env.NEXT_PUBLIC_USDC_MINT) ?? (CLUSTER === "mainnet-beta" ? MAINNET_STABLECOINS.USDC : undefined) },
    { symbol: "USDT", mint: envKey(process.env.NEXT_PUBLIC_USDT_MINT) ?? (CLUSTER === "mainnet-beta" ? MAINNET_STABLECOINS.USDT : undefined) },
  ] as const
).filter((s): s is { symbol: "USDC" | "USDT"; mint: PublicKey } => !!s.mint);

export const symbolForMint = (mint: PublicKey) =>
  STABLECOINS.find((s) => s.mint.equals(mint))?.symbol ?? `${mint.toBase58().slice(0, 4)}…`;

/** Solscan on devnet/mainnet; Solana Explorer (which can point at a local RPC) on localnet. */
export function explorerUrl(kind: "address" | "tx", id: string) {
  if (CLUSTER === "localnet") return `https://explorer.solana.com/${kind}/${id}?cluster=custom&customUrl=${encodeURIComponent(RPC_URL)}`;
  return `https://solscan.io/${kind === "tx" ? "tx" : "account"}/${id}${CLUSTER === "devnet" ? "?cluster=devnet" : ""}`;
}
