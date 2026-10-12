import { Clock, FailedTransactionMetadata, LiteSVM, TransactionMetadata } from "litesvm";
import { address, lamports as kitLamports, type Address } from "@solana/kit";
import { fromVersionedTransaction } from "@solana/compat";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  AccountLayout,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  CHAINLINK_SOL_USD_FEED,
  CHAINLINK_STORE_PROGRAM_ID,
  encodeChainlinkFeed,
  LOOM_PROGRAM_ID,
  LoomClient,
  PYTH_RECEIVER_PROGRAM_ID,
  SOL_USD_PRICE_ACCOUNT,
  encodePriceUpdateV2,
  type LoanAccount,
} from "@loom/sdk";

export class TxFailed extends Error {
  constructor(readonly logs: string[], err: string) {
    super(`transaction failed: ${err}\n${logs.join("\n")}`);
  }
}

const kit = (pk: PublicKey): Address => address(pk.toBase58());

/**
 * Thin web3.js-v1 facade over LiteSVM 1.x (which speaks @solana/kit types), so the
 * tests exercise exactly the same SDK code the Next.js app uses.
 */
class Svm {
  readonly inner = new LiteSVM();
  addProgramFromFile(id: PublicKey, path: string) {
    this.inner.addProgramFromFile(kit(id), path);
  }
  getAccount(pk: PublicKey): { data: Uint8Array; lamports: bigint; owner: PublicKey } | null {
    const a = this.inner.getAccount(kit(pk));
    return a.exists ? { data: a.data, lamports: a.lamports, owner: new PublicKey(a.programAddress) } : null;
  }
  setAccount(pk: PublicKey, a: { owner: PublicKey; lamports: number; data: Uint8Array; executable: boolean }) {
    this.inner.setAccount({
      address: kit(pk),
      programAddress: kit(a.owner),
      lamports: kitLamports(BigInt(a.lamports)),
      data: a.data,
      executable: a.executable,
      space: BigInt(a.data.length),
    });
  }
  getBalance(pk: PublicKey): bigint | null {
    return this.inner.getBalance(kit(pk));
  }
  airdrop(pk: PublicKey, amount: bigint) {
    this.inner.airdrop(kit(pk), kitLamports(amount));
  }
  latestBlockhash(): string {
    return this.inner.latestBlockhash();
  }
  expireBlockhash() {
    this.inner.expireBlockhash();
  }
  getClock() {
    return this.inner.getClock();
  }
  setClock(c: Clock) {
    this.inner.setClock(c);
  }
  minimumBalanceForRentExemption(len: bigint): bigint {
    return this.inner.minimumBalanceForRentExemption(len);
  }
  sendTransaction(tx: VersionedTransaction) {
    return this.inner.sendTransaction(fromVersionedTransaction(tx as never) as never);
  }
}

export class Harness {
  readonly svm = new Svm();
  readonly client = new LoomClient(new Connection("http://127.0.0.1:8899"));
  lastLogs: string[] = [];
  lastComputeUnits = 0n;

  constructor() {
    // LOOM_SO lets a test run load another build (e.g. a deliberately broken one, to check the tests catch it).
    this.svm.addProgramFromFile(LOOM_PROGRAM_ID, process.env.LOOM_SO ?? "target/deploy/loom.so");
    this.setTime(1_800_000_000n);
  }

  // ---------------- clock ----------------
  now(): bigint {
    return this.svm.getClock().unixTimestamp;
  }

  setTime(ts: bigint) {
    const c = this.svm.getClock();
    this.svm.setClock(new Clock(c.slot + 1n, c.epochStartTimestamp, c.epoch, c.leaderScheduleEpoch, ts));
  }

  warp(secs: number) {
    this.setTime(this.now() + BigInt(secs));
  }

  // ---------------- oracle ----------------
  /** Writes a Pyth SOL/USD PriceUpdateV2 account. Price in USD, 8-decimal exponent. */
  setPrice(usd: number, opts: { confUsd?: number; ageSecs?: number; owner?: PublicKey; fullyVerified?: boolean; feedIdHex?: string } = {}) {
    const data = encodePriceUpdateV2({
      price: BigInt(Math.round(usd * 1e8)),
      conf: BigInt(Math.round((opts.confUsd ?? 0.05) * 1e8)),
      expo: -8,
      publishTime: Number(this.now()) - (opts.ageSecs ?? 0),
      fullyVerified: opts.fullyVerified,
      feedIdHex: opts.feedIdHex,
    });
    this.svm.setAccount(SOL_USD_PRICE_ACCOUNT, {
      executable: false,
      owner: opts.owner ?? PYTH_RECEIVER_PROGRAM_ID,
      lamports: 1_000_000_000,
      data,
    });
    // Both oracles agree unless a test sets Chainlink separately.
    this.setChainlinkPrice(usd, { ageSecs: opts.ageSecs });
  }

  /** Writes the Chainlink SOL/USD feed account. Price in USD, 8 decimals. */
  setChainlinkPrice(usd: number, opts: { ageSecs?: number; owner?: PublicKey; decimals?: number } = {}) {
    const decimals = opts.decimals ?? 8;
    const data = encodeChainlinkFeed({
      price: BigInt(Math.round(usd * 10 ** decimals)),
      decimals,
      timestamp: Number(this.now()) - (opts.ageSecs ?? 0),
    });
    this.svm.setAccount(CHAINLINK_SOL_USD_FEED, {
      executable: false,
      owner: opts.owner ?? CHAINLINK_STORE_PROGRAM_ID,
      lamports: 1_000_000_000,
      data,
    });
  }

  // ---------------- transactions ----------------
  wallet(sol = 1_000): Keypair {
    const kp = Keypair.generate();
    this.svm.airdrop(kp.publicKey, BigInt(sol * LAMPORTS_PER_SOL));
    return kp;
  }

  private build(ixs: TransactionInstruction[], signers: Keypair[]) {
    const message = new TransactionMessage({
      payerKey: signers[0].publicKey,
      recentBlockhash: this.svm.latestBlockhash(),
      instructions: ixs,
    }).compileToLegacyMessage();
    const tx = new VersionedTransaction(message);
    tx.sign(signers);
    return tx;
  }

  send(ixs: TransactionInstruction[], signers: Keypair[]): TransactionMetadata {
    const res = this.svm.sendTransaction(this.build(ixs, signers));
    this.svm.expireBlockhash();
    if (res instanceof FailedTransactionMetadata) {
      this.lastLogs = res.meta().logs();
      throw new TxFailed(this.lastLogs, res.toString());
    }
    this.lastLogs = res.logs();
    this.lastComputeUnits = res.computeUnitsConsumed();
    return res;
  }

  /** Sends and returns the failure logs; throws if the transaction succeeds. */
  sendExpectFail(ixs: TransactionInstruction[], signers: Keypair[]): string {
    try {
      this.send(ixs, signers);
    } catch (e) {
      if (e instanceof TxFailed) return e.logs.join("\n");
      throw e;
    }
    throw new Error("expected transaction to fail");
  }

  // ---------------- tokens ----------------
  createMint(authority: Keypair, decimals = 6): PublicKey {
    const mint = Keypair.generate();
    this.send(
      [
        SystemProgram.createAccount({
          fromPubkey: authority.publicKey,
          newAccountPubkey: mint.publicKey,
          lamports: Number(this.svm.minimumBalanceForRentExemption(BigInt(MINT_SIZE))),
          space: MINT_SIZE,
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMint2Instruction(mint.publicKey, decimals, authority.publicKey, null),
      ],
      [authority, mint],
    );
    return mint.publicKey;
  }

  mintTo(mint: PublicKey, authority: Keypair, owner: PublicKey, amount: bigint): PublicKey {
    const ata = getAssociatedTokenAddressSync(mint, owner, true);
    this.send(
      [
        createAssociatedTokenAccountIdempotentInstruction(authority.publicKey, ata, owner, mint),
        createMintToInstruction(mint, ata, authority.publicKey, amount),
      ],
      [authority],
    );
    return ata;
  }

  tokenBalance(mint: PublicKey, owner: PublicKey): bigint {
    return this.tokenAccountBalance(getAssociatedTokenAddressSync(mint, owner, true));
  }

  tokenAccountBalance(address: PublicKey): bigint {
    const acc = this.svm.getAccount(address);
    if (!acc) return 0n;
    return AccountLayout.decode(acc.data).amount;
  }

  lamports(address: PublicKey): bigint {
    return this.svm.getBalance(address) ?? 0n;
  }

  // ---------------- program accounts ----------------
  config() {
    return this.client.decodeConfig(this.svm.getAccount(this.client.pda.config())!.data);
  }

  loan(address: PublicKey): LoanAccount {
    return this.client.decodeLoan(address, this.svm.getAccount(address)!.data);
  }

  creditTree() {
    return this.client.decodeCreditTreeRoot(this.svm.getAccount(this.client.pda.creditTree())!.data);
  }

  events() {
    return this.client.parseEvents(this.lastLogs);
  }
}
