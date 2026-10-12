"use client";

import { useMemo } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  CHAINLINK_SOL_USD_FEED,
  LoomClient,
  SOL_USD_PRICE_ACCOUNT,
  combinePrices,
  parseChainlinkFeed,
  parsePriceUpdateV2,
  type LoanAccount,
} from "@loom/sdk";
import { PROGRAM_ID, STABLECOINS } from "./env";

export function useLoom(): LoomClient {
  const { connection } = useConnection();
  return useMemo(() => new LoomClient(connection, PROGRAM_ID), [connection]);
}

export function useConfig() {
  const client = useLoom();
  return useQuery({ queryKey: ["config"], queryFn: () => client.fetchConfig(), refetchInterval: 20_000 });
}

export function useReserves() {
  const client = useLoom();
  const { connection } = useConnection();
  return useQuery({
    queryKey: ["reserves"],
    queryFn: async () => {
      const reserves = await client.fetchReserves();
      const balances = await Promise.all(
        reserves.map((r) => connection.getTokenAccountBalance(r.vault).then((b) => BigInt(b.value.amount)).catch(() => 0n)),
      );
      return reserves.map((r, i) => ({ ...r, vaultBalance: balances[i] }));
    },
    refetchInterval: 20_000,
  });
}

/** Loans only move forward: `repaid` grows and status leaves "active" once, never back. */
function newerLoan(a: LoanAccount, b: LoanAccount): LoanAccount {
  if (a.status !== b.status) return a.status === "active" ? b : a;
  return b.repaid > a.repaid ? b : a;
}

function mergeLoans(lists: (LoanAccount[] | undefined)[]): LoanAccount[] {
  const byAddress = new Map<string, LoanAccount>();
  for (const loan of lists.flatMap((l) => l ?? [])) {
    const key = loan.address.toBase58();
    const prev = byAddress.get(key);
    byAddress.set(key, prev ? newerLoan(prev, loan) : loan);
  }
  return [...byAddress.values()].sort((a, b) => Number(b.id - a.id));
}

export function useLoans(borrower?: PublicKey | null) {
  const client = useLoom();
  const qc = useQueryClient();
  const queryKey = ["loans", borrower?.toBase58() ?? "all"];
  return useQuery({
    queryKey,
    // Load-balanced RPCs can route a refetch to a lagging node that is missing recent accounts.
    // Loan accounts are never closed, so keep every loan already seen instead of letting it vanish.
    queryFn: async () => mergeLoans([qc.getQueryData<LoanAccount[]>(queryKey), await client.fetchLoans(borrower ?? undefined)]),
    enabled: borrower !== null,
    refetchInterval: 20_000,
  });
}

/** What the payout (treasury) wallet can pay out right now, per stablecoin. */
/** How a settled loan's SOL was split between the treasury and the borrower. Never changes once settled. */
export function useSettlement(loan: LoanAccount) {
  const client = useLoom();
  const settled = loan.status === "liquidated" || loan.status === "defaulted";
  return useQuery({
    queryKey: ["settlement", loan.address.toBase58()],
    queryFn: () => client.fetchSettlement(loan.address),
    enabled: settled,
    staleTime: Infinity,
  });
}

/** Credit certificates held by `holder` (each unlocks the credit rate on loans up to 2x its proven amount). */
export function useCertificates(holder?: PublicKey | null) {
  const client = useLoom();
  return useQuery({
    queryKey: ["certificates", holder?.toBase58() ?? "none"],
    queryFn: () => client.fetchCertificates(holder!),
    enabled: !!holder,
    refetchInterval: 60_000,
  });
}

/** Lending pools (one per stablecoin) once the admin has created them, with each vault's live token balance. */
export function usePools() {
  const client = useLoom();
  const { connection } = useConnection();
  return useQuery({
    queryKey: ["pools"],
    queryFn: async () => {
      const pools = await client.fetchPools();
      const balances = await Promise.all(
        pools.map((p) => connection.getTokenAccountBalance(p.vault).then((b) => BigInt(b.value.amount)).catch(() => 0n)),
      );
      return pools.map((p, i) => ({ ...p, vaultBalance: balances[i] }));
    },
    refetchInterval: 20_000,
  });
}

/** The connected wallet's pool positions. */
export function useLenderPositions(owner?: PublicKey | null) {
  const client = useLoom();
  return useQuery({
    queryKey: ["lender-positions", owner?.toBase58() ?? "none"],
    queryFn: () => client.fetchLenderPositions(owner!),
    enabled: !!owner,
    refetchInterval: 20_000,
  });
}

export function usePayoutCapacity() {
  const client = useLoom();
  const treasury = useConfig().data?.treasury;
  return useQuery({
    queryKey: ["payout-capacity", treasury?.toBase58()],
    enabled: !!treasury,
    queryFn: () => client.fetchPayoutCapacity(treasury!, STABLECOINS.map((s) => s.mint)),
    refetchInterval: 15_000,
  });
}

/** Live escrow balances — proof that each loan's SOL really sits in its escrow PDA. */
export function useEscrowBalances(loans: LoanAccount[] | undefined) {
  const client = useLoom();
  const { connection } = useConnection();
  const active = (loans ?? []).filter((l) => l.status === "active");
  return useQuery({
    queryKey: ["escrows", active.map((l) => l.address.toBase58()).join(",")],
    // Runs even with zero active loans so integrity checks resolve to "passed" instead of hanging.
    enabled: loans !== undefined,
    queryFn: async () => {
      const addrs = active.map((l) => client.pda.escrow(l.address));
      const out = new Map<string, bigint>();
      for (let i = 0; i < addrs.length; i += 100) {
        const infos = await connection.getMultipleAccountsInfo(addrs.slice(i, i + 100));
        infos.forEach((info, j) => out.set(active[i + j].address.toBase58(), BigInt(info?.lamports ?? 0)));
      }
      return out;
    },
    refetchInterval: 30_000,
  });
}

/** SOL/USD from Pyth and Chainlink, combined with the program's rules (see `combinePrices`). */
export function useSolPrice() {
  const { connection } = useConnection();
  return useQuery({
    queryKey: ["sol-price"],
    queryFn: async () => {
      const [pyth, chainlink] = await connection.getMultipleAccountsInfo([SOL_USD_PRICE_ACCOUNT, CHAINLINK_SOL_USD_FEED]);
      if (!pyth) throw new Error("Pyth SOL/USD feed not found on this cluster");
      if (!chainlink) throw new Error("Chainlink SOL/USD feed not found on this cluster");
      return combinePrices(parsePriceUpdateV2(pyth.data), parseChainlinkFeed(chainlink.data));
    },
    refetchInterval: 10_000,
  });
}

export function useCreditTree() {
  const client = useLoom();
  const { connection } = useConnection();
  return useQuery({
    queryKey: ["credit-tree"],
    queryFn: async () => {
      const info = await connection.getAccountInfo(client.pda.creditTree());
      return info ? client.decodeCreditTreeRoot(info.data) : null;
    },
    refetchInterval: 30_000,
  });
}

/** Each configured stablecoin's token account (ATA) for `owner` and its balance (0 if the account doesn't exist yet). */
async function fetchStableBalances(connection: Connection, owner: PublicKey) {
  return Promise.all(
    STABLECOINS.map(async (s) => {
      const ata = getAssociatedTokenAddressSync(s.mint, owner, true);
      const amount = await connection
        .getTokenAccountBalance(ata)
        .then((b) => BigInt(b.value.amount))
        .catch(() => 0n);
      return { ...s, ata, amount };
    }),
  );
}

export function useBalances() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  return useQuery({
    queryKey: ["balances", publicKey?.toBase58()],
    enabled: !!publicKey,
    queryFn: async () => {
      const owner = publicKey!;
      const sol = BigInt(await connection.getBalance(owner));
      const tokens = await fetchStableBalances(connection, owner);
      return { sol, solUi: Number(sol) / LAMPORTS_PER_SOL, tokens };
    },
    refetchInterval: 15_000,
  });
}

/** Stablecoin balances of any wallet, e.g. the admin and treasury on the Operator page. */
export function useStableBalances(owner?: PublicKey | null) {
  const { connection } = useConnection();
  return useQuery({
    queryKey: ["stable-balances", owner?.toBase58()],
    enabled: !!owner,
    queryFn: () => fetchStableBalances(connection, owner!),
    refetchInterval: 15_000,
  });
}
