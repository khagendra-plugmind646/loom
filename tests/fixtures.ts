import { expect } from "chai";
import { BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { AccountLayout, createApproveCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  LoomClient,
  identityCommitment,
  requiredCollateralLamports,
  type CreditNote,
  type LoanAccount,
  type PoolAccount,
  type ReserveAccount,
} from "@loom/sdk";
import { Harness } from "./harness";

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------
export const USD = (n: number) => BigInt(Math.round(n * 1e6));
export const PRICE = (usd: number) => BigInt(Math.round(usd * 1e8));
export const SOL = (n: number) => BigInt(Math.round(n * 1e9));
/** Rent of a loan's collateral escrow (discriminator + CollateralEscrow::INIT_SPACE). */
export const ESCROW_SPACE = 8n + 33n;
export const TX_FEE = 5_000n;

export const DEFAULT_PARAMS = {
  liquidationThresholdBps: 13_000,
  liquidationPenaltyBps: 500,
  maxPriceAgeSecs: 120,
  maxConfidenceBps: 200,
  minPrincipal: USD(10),
  maxPrincipal: USD(500_000),
};

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------
/** Asserts the failure logs carry this Anchor error code (program or constraint error). */
export function expectError(logs: string, code: string) {
  expect(logs, `expected error ${code}`).to.include(`Error Code: ${code}.`);
}

/** Replaces every account meta `from` with `to` (to forge accounts the SDK would derive correctly). */
export function swapAccount(ix: TransactionInstruction, from: PublicKey, to: PublicKey): TransactionInstruction {
  let found = false;
  const keys = ix.keys.map((k) => {
    if (!k.pubkey.equals(from)) return k;
    found = true;
    return { ...k, pubkey: to };
  });
  if (!found) throw new Error(`account ${from.toBase58()} not in instruction`);
  return new TransactionInstruction({ programId: ix.programId, data: ix.data, keys });
}

export interface OpenLoanOpts {
  who?: Keypair;
  mint?: PublicKey;
  principal: bigint;
  /** Pyth price; also sets Chainlink to the same price unless `chainlinkUsd` is given. Default $150. */
  priceUsd?: number;
  chainlinkUsd?: number;
  confUsd?: number;
  /** Defaults to exactly the 200% minimum at the given price. */
  collateral?: bigint;
  note?: CreditNote;
  /** Raw commitment (overrides `note`). */
  commitment?: bigint;
  recipient?: PublicKey;
  creditCertificates?: PublicKey[];
  pool?: boolean;
  nonce?: bigint;
  /** Skip writing oracle prices (the test set them up). */
  keepPrices?: boolean;
}

/**
 * A fresh LiteSVM with the Loomzk program deployed, initialized, and USDC/USDT reserves whose
 * payouts are approved by the treasury. Every test that calls this starts from the same clean
 * state, so tests never depend on each other's side effects.
 */
export async function createWorld(opts: { initialize?: boolean; reserves?: boolean; params?: Partial<typeof DEFAULT_PARAMS> } = {}) {
  const h = new Harness();
  const { client } = h;
  const admin = h.wallet();
  const treasury = h.wallet(1);
  const borrower = h.wallet();
  const keeper = h.wallet(10);
  const usdc = h.createMint(admin);
  const usdt = h.createMint(admin);
  h.mintTo(usdc, admin, admin.publicKey, USD(1_000_000));
  h.mintTo(usdt, admin, admin.publicKey, USD(1_000_000));
  h.setPrice(150);

  const params = { ...DEFAULT_PARAMS, ...opts.params };
  if (opts.initialize !== false) {
    h.send([await client.initialize(admin.publicKey, { treasury: treasury.publicKey, ...params })], [admin]);
    if (opts.reserves !== false) {
      for (const mint of [usdc, usdt]) {
        h.send([await client.initReserve(admin.publicKey, mint, treasury.publicKey)], [admin]);
        h.mintTo(mint, admin, treasury.publicKey, USD(1_000_000));
        h.send([client.approvePayouts(treasury.publicKey, mint, USD(1_000_000))], [treasury]);
      }
    }
  }

  let nextNonce = 1n;

  const w = {
    h,
    client,
    admin,
    treasury,
    borrower,
    keeper,
    usdc,
    usdt,
    params,

    /** Expects the transaction to fail with this Anchor error code; returns the logs. */
    fails(ixs: TransactionInstruction[], signers: Keypair[], code: string): string {
      const logs = h.sendExpectFail(ixs, signers);
      expectError(logs, code);
      return logs;
    },

    nonce: () => nextNonce++,

    openLoanIx(o: OpenLoanOpts) {
      const priceUsd = o.priceUsd ?? 150;
      const confUsd = o.confUsd ?? 0.05;
      if (!o.keepPrices) {
        h.setPrice(priceUsd, { confUsd });
        if (o.chainlinkUsd !== undefined) h.setChainlinkPrice(o.chainlinkUsd);
      }
      const nonce = o.nonce ?? nextNonce++;
      const who = o.who ?? borrower;
      return {
        nonce,
        address: client.pda.loan(who.publicKey, nonce),
        ix: client.openLoan({
          borrower: who.publicKey,
          treasury: treasury.publicKey,
          recipient: o.recipient,
          mint: o.mint ?? usdc,
          nonce,
          principal: o.principal,
          collateralLamports: o.collateral ?? requiredCollateralLamports(o.principal, PRICE(priceUsd), PRICE(confUsd), -8),
          identityCommitment: o.commitment ?? (o.note ? identityCommitment(o.note) : undefined),
          creditCertificates: o.creditCertificates,
          pool: o.pool,
        }),
      };
    },

    async openLoan(o: OpenLoanOpts): Promise<LoanAccount> {
      const { ix, address } = w.openLoanIx(o);
      h.send([await ix], [o.who ?? borrower]);
      return h.loan(address);
    },

    async repayIx(loan: LoanAccount, amount: bigint, o: { mint?: PublicKey; payer?: Keypair; treasury?: PublicKey } = {}) {
      return client.repay({
        payer: (o.payer ?? borrower).publicKey,
        loan,
        mint: o.mint ?? loan.mint,
        amount,
        treasury: o.treasury ?? treasury.publicKey,
      });
    },

    async repay(loan: LoanAccount, amount: bigint, o: { mint?: PublicKey; payer?: Keypair } = {}): Promise<LoanAccount> {
      h.send([await w.repayIx(loan, amount, o)], [o.payer ?? borrower]);
      return h.loan(loan.address);
    },

    async liquidateIx(loan: LoanAccount, o: { caller?: Keypair; treasury?: PublicKey } = {}) {
      return client.liquidate({ caller: (o.caller ?? keeper).publicKey, loan, treasury: o.treasury ?? treasury.publicKey });
    },

    async liquidate(loan: LoanAccount, o: { caller?: Keypair } = {}): Promise<LoanAccount> {
      h.send([await w.liquidateIx(loan, o)], [o.caller ?? keeper]);
      return h.loan(loan.address);
    },

    async addCollateral(loan: PublicKey, lamports: bigint, payer: Keypair = borrower) {
      h.send([await client.addCollateral(payer.publicKey, loan, lamports)], [payer]);
      return h.loan(loan);
    },

    /** Sets the liquidation threshold just for opening one loan, so a test can isolate the 60% price rule. */
    async withThreshold<T>(bps: number, fn: () => Promise<T>): Promise<T> {
      h.send([await client.updateConfig(admin.publicKey, { liquidationThresholdBps: bps })], [admin]);
      try {
        return await fn();
      } finally {
        h.send([await client.updateConfig(admin.publicKey, { liquidationThresholdBps: params.liquidationThresholdBps })], [admin]);
      }
    },

    /** Gives `owner` tokens (creating the ATA) and returns the ATA. */
    fund(mint: PublicKey, owner: PublicKey, amount: bigint) {
      return h.mintTo(mint, admin, owner, amount);
    },

    approvePayouts(mint: PublicKey, amount: bigint) {
      h.send([client.approvePayouts(treasury.publicKey, mint, amount)], [treasury]);
    },

    /** Treasury token account balance and the amount it approved the reserve PDA to spend. */
    payoutSource(mint: PublicKey) {
      const acc = AccountLayout.decode(h.svm.getAccount(getAssociatedTokenAddressSync(mint, treasury.publicKey, true))!.data);
      const approved = acc.delegateOption && new PublicKey(acc.delegate).equals(client.pda.reserve(mint)) ? acc.delegatedAmount : 0n;
      return { balance: acc.amount, approved };
    },

    reserve(mint: PublicKey): ReserveAccount {
      const a = client.pda.reserve(mint);
      return client.decodeReserve(a, h.svm.getAccount(a)!.data);
    },

    pool(mint: PublicKey = usdc): PoolAccount {
      const a = client.pda.pool(mint);
      return client.decodePool(a, h.svm.getAccount(a)!.data);
    },

    position(owner: PublicKey, mint: PublicKey = usdc) {
      const a = client.pda.lender(mint, owner);
      const acc = h.svm.getAccount(a);
      return acc ? client.decodeLenderPosition(a, acc.data) : null;
    },

    async initPool(mint: PublicKey = usdc) {
      h.send([await client.initPool(admin.publicKey, mint)], [admin]);
    },

    async deposit(owner: Keypair, amount: bigint, mint: PublicKey = usdc) {
      w.fund(mint, owner.publicKey, amount);
      h.send([await client.deposit(owner.publicKey, mint, amount)], [owner]);
    },

    escrowLamports(loan: PublicKey) {
      return h.lamports(client.pda.escrow(loan));
    },

    escrowRent() {
      return h.svm.minimumBalanceForRentExemption(ESCROW_SPACE);
    },

    event(name: string) {
      const e = h.events().find((x) => x.name === name);
      expect(e, `${name} event`).to.exist;
      return e!.data as Record<string, any>;
    },

    /**
     * Writes a credit certificate account straight into the SVM, exactly as `claim_certificate` would
     * leave it. Lets credit-rate tests run without generating Groth16 proofs.
     */
    async injectCertificate(holder: PublicKey, minPrincipal: bigint): Promise<PublicKey> {
      const nullifierHash = Keypair.generate().publicKey.toBytes();
      const address = client.pda.certificate(nullifierHash);
      const data = await client.program.coder.accounts.encode("creditCertificate", {
        holder,
        nullifierHash: [...nullifierHash],
        root: [...new Uint8Array(32)],
        minPrincipal: new BN(minPrincipal.toString()),
        issuedAt: new BN(h.now().toString()),
        bump: 255,
      });
      h.svm.setAccount(address, { owner: client.programId, lamports: 10_000_000, data, executable: false });
      return address;
    },

    /** Overwrites the credit tree's `next_index` (the u64 right after the discriminator), e.g. to simulate a full tree. */
    setCreditTreeNextIndex(nextIndex: bigint) {
      const address = client.pda.creditTree();
      const acc = h.svm.getAccount(address)!;
      const data = Uint8Array.from(acc.data);
      new DataView(data.buffer).setBigUint64(8, nextIndex, true);
      h.svm.setAccount(address, { owner: client.programId, lamports: Number(acc.lamports), data, executable: false });
    },

    /** A token account for `owner` that approves the reserve PDA of `mint` (to forge a payout source). */
    approveFrom(owner: Keypair, mint: PublicKey, amount: bigint) {
      const ata = w.fund(mint, owner.publicKey, amount);
      h.send([createApproveCheckedInstruction(ata, mint, client.pda.reserve(mint), owner.publicKey, amount, 6)], [owner]);
      return ata;
    },
  };
  return w;
}

export type World = Awaited<ReturnType<typeof createWorld>>;
export { BN, LoomClient };
