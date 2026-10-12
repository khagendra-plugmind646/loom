"use client";

import { useCallback } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { SOL_USD_FEED_ID_HEX, SOL_USD_PRICE_ACCOUNT, parsePriceUpdateV2 } from "@loom/sdk";
import { HERMES_URL } from "./env";

export type BuildIxs = (priceUpdate: PublicKey) => Promise<TransactionInstruction[]>;

async function confirm(connection: Connection, signature: string) {
  const latest = await connection.getLatestBlockhash();
  const res = await connection.confirmTransaction({ signature, ...latest }, "confirmed");
  if (res.value.err) throw new Error(`Transaction failed: ${JSON.stringify(res.value.err)}`);
}

/** Pulls the program's error message out of simulation logs for a readable toast. */
export function explainError(e: unknown): string {
  const err = e as { logs?: string[]; message?: string; error?: { message?: string } };
  const logs = err.logs ?? [];
  const anchor = logs.map((l) => l.match(/Error Message: (.*)$/)?.[1]).find(Boolean);
  if (anchor) return anchor;
  // Wallet adapter errors wrap the wallet's own error; its message is the useful part.
  const msg = err.error?.message || err.message || String(e);
  if (/User rejected/i.test(msg)) return "Request rejected in wallet";
  return msg.length > 220 ? msg.slice(0, 220) + "…" : msg;
}

/**
 * Sends instructions with the connected wallet. Returns the signature after confirmation
 * and invalidates cached on-chain queries so the UI refreshes.
 */
export function useSendTx() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const qc = useQueryClient();

  const send = useCallback(
    async (ixs: TransactionInstruction[], computeUnits?: number): Promise<string> => {
      if (!wallet.publicKey) throw new Error("Connect a wallet first");
      const budget = computeUnits ? [ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits })] : [];
      const { blockhash } = await connection.getLatestBlockhash();
      const tx = new VersionedTransaction(
        new TransactionMessage({ payerKey: wallet.publicKey, recentBlockhash: blockhash, instructions: [...budget, ...ixs] }).compileToV0Message(),
      );
      const sim = await connection.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true });
      if (sim.value.err) throw Object.assign(new Error(`Simulation failed: ${JSON.stringify(sim.value.err)}`), { logs: sim.value.logs ?? [] });
      // Sign in the wallet but submit through the app's own RPC, so the transaction reaches this
      // cluster even when the wallet extension is set to a different network.
      const signature = wallet.signTransaction
        ? await connection.sendRawTransaction((await wallet.signTransaction(tx)).serialize())
        : await wallet.sendTransaction(tx, connection);
      await confirm(connection, signature);
      await qc.invalidateQueries();
      return signature;
    },
    [connection, wallet, qc],
  );

  /**
   * Runs instructions that need a SOL/USD price. Uses Pyth's sponsored feed when it is
   * fresh; otherwise fetches a signed update from Hermes, posts + verifies it on-chain via
   * the Pyth receiver (Wormhole-verified) and runs our instructions against it.
   */
  const sendWithPrice = useCallback(
    async (build: BuildIxs, maxAgeSecs: number): Promise<string> => {
      if (!wallet.publicKey || !wallet.signAllTransactions || !wallet.signTransaction) throw new Error("Connect a wallet first");
      const info = await connection.getAccountInfo(SOL_USD_PRICE_ACCOUNT);
      const sponsored = info ? parsePriceUpdateV2(info.data) : null;
      const now = Math.floor(Date.now() / 1000);
      if (sponsored?.fullyVerified && now - sponsored.publishTime < maxAgeSecs - 20) {
        return send(await build(SOL_USD_PRICE_ACCOUNT));
      }

      // Loaded only when a fresh Pyth price has to be posted: these libraries are large (the receiver
      // brings its own Anchor), so they stay out of the bundle every page downloads.
      const [{ HermesClient }, { PythSolanaReceiver }] = await Promise.all([
        import("@pythnetwork/hermes-client"),
        import("@pythnetwork/pyth-solana-receiver"),
      ]);
      const hermes = new HermesClient(HERMES_URL);
      const updates = await hermes.getLatestPriceUpdates([SOL_USD_FEED_ID_HEX], { encoding: "base64" });
      const receiver = new PythSolanaReceiver({
        connection,
        wallet: {
          publicKey: wallet.publicKey,
          signTransaction: wallet.signTransaction,
          signAllTransactions: wallet.signAllTransactions,
        } as never,
      });
      const builder = receiver.newTransactionBuilder({ closeUpdateAccounts: true });
      await builder.addPostPriceUpdates(updates.binary.data);
      await builder.addPriceConsumerInstructions(async (getPriceUpdateAccount) =>
        (await build(getPriceUpdateAccount("0x" + SOL_USD_FEED_ID_HEX))).map((instruction) => ({ instruction, signers: [] })),
      );
      const txs = await builder.buildVersionedTransactions({ computeUnitPriceMicroLamports: 50_000, tightComputeBudget: true });
      txs.forEach(({ tx, signers }) => tx.sign(signers));
      const signed = await wallet.signAllTransactions(txs.map((t) => t.tx));
      let last = "";
      for (const tx of signed) {
        last = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
        await confirm(connection, last);
      }
      await qc.invalidateQueries();
      return last;
    },
    [connection, wallet, send, qc],
  );

  return { send, sendWithPrice };
}
