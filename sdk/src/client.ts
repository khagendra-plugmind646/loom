import { AnchorProvider, EventParser, Program, utils } from "@coral-xyz/anchor";
import BN from "bn.js";
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  type GetProgramAccountsFilter,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createApproveCheckedInstruction,
  getAssociatedTokenAddressSync,
  unpackAccount,
} from "@solana/spl-token";
import { IDL, type Loom } from "./idl";
import { CHAINLINK_SOL_USD_FEED, NO_LEAF, SOL_USD_PRICE_ACCOUNT } from "./constants";
import { pda } from "./pda";
import { fromBytes32, toBytes32 } from "./bytes";
import type { CertificateProof } from "./zk";

export interface Settlement {
  signature: string;
  /** SOL sent to the treasury. */
  seizedLamports: bigint;
  /** Collateral sent back to the borrower (escrow rent not included). */
  returnedLamports: bigint;
  price: bigint;
  priceExpo: number;
}

export type LoanStatus = "active" | "repaid" | "liquidated" | "defaulted";

export interface LoanAccount {
  address: PublicKey;
  id: bigint;
  borrower: PublicKey;
  nonce: bigint;
  mint: PublicKey;
  principal: bigint;
  totalDue: bigint;
  repaid: bigint;
  collateralLamports: bigint;
  openPrice: bigint;
  openPriceExpo: number;
  startTs: bigint;
  maturityTs: bigint;
  closedTs: bigint;
  liquidationThresholdBps: number;
  liquidationPenaltyBps: number;
  status: LoanStatus;
  identityCommitment: bigint;
  creditLeaf: bigint;
  creditLeafIndex: bigint | null;
  /** Wallet that received the stablecoin (the borrower unless they chose another). */
  recipient: PublicKey;
  /** Annual interest rate in bps; 0 for loans opened before time-based interest (fixed 12% fee). */
  rateBps: number;
  principalRepaid: bigint;
  interestAccrued: bigint;
  accruedTs: bigint;
  /** Credit certificate that unlocked the credit rate, or null. */
  creditCertificate: PublicKey | null;
  /** Funded by the lending pool (repayments go back to it) rather than the treasury. */
  fromPool: boolean;
  /** SOL locked at opening; `collateralLamports` grows when SOL is added (0 on older loans). */
  openingCollateralLamports: bigint;
  /** Number of credit certificates presented at opening. */
  creditLevel: number;
}

/** A lending pool for one stablecoin (see programs/loom/src/state.rs `Pool`). */
export interface PoolAccount {
  address: PublicKey;
  mint: PublicKey;
  vault: PublicKey;
  /** Stablecoin the pool holds and can lend or pay out. */
  cash: bigint;
  /** Principal lent out and not yet repaid. */
  principalOut: bigint;
  totalShares: bigint;
  totalDeposited: bigint;
  totalWithdrawn: bigint;
  /** Interest earned by depositors (after the protocol fee). */
  interestEarned: bigint;
}

/** One depositor's share of a pool. */
export interface LenderPositionAccount {
  address: PublicKey;
  owner: PublicKey;
  mint: PublicKey;
  shares: bigint;
  deposited: bigint;
  withdrawn: bigint;
}

/** What the treasury can currently pay out in one stablecoin. */
export interface PayoutCapacity {
  mint: PublicKey;
  /** The treasury's token account that loans are paid from. */
  source: PublicKey;
  balance: bigint;
  /** Amount the treasury approved the reserve PDA to spend (0 if it approved something else). */
  approved: bigint;
  /** min(balance, approved): the largest loan that can be paid out right now. */
  available: bigint;
}

export interface ConfigAccount {
  admin: PublicKey;
  treasury: PublicKey;
  liquidationThresholdBps: number;
  liquidationPenaltyBps: number;
  maxPriceAgeSecs: number;
  maxConfidenceBps: number;
  minPrincipal: bigint;
  maxPrincipal: bigint;
  paused: boolean;
  nextLoanId: bigint;
  stats: {
    loansOpened: bigint;
    loansRepaid: bigint;
    loansLiquidated: bigint;
    loansDefaulted: bigint;
    activeLoans: bigint;
    collateralLockedLamports: bigint;
    totalPrincipalIssued: bigint;
    totalRepaid: bigint;
    outstandingDebt: bigint;
    certificatesIssued: bigint;
  };
}

export interface ReserveAccount {
  address: PublicKey;
  mint: PublicKey;
  vault: PublicKey;
  decimals: number;
  totalFunded: bigint;
  totalWithdrawn: bigint;
  totalDisbursed: bigint;
  totalRepaid: bigint;
}

export interface CertificateAccount {
  address: PublicKey;
  holder: PublicKey;
  nullifierHash: bigint;
  root: bigint;
  minPrincipal: bigint;
  issuedAt: bigint;
}

// 8-byte discriminator + Loan::INIT_SPACE (current layout, including `recipient`).
const LOAN_SIZE_V1 = 8 + 8 + 32 + 8 + 32 + 8 * 5 + 4 + 8 * 3 + 2 + 2 + 1 + 32 + 32 + 8 + 1 + 1; // before `recipient`
const LOAN_SIZE_V2 = LOAN_SIZE_V1 + 32; // before time-based interest
const LOAN_V3_FIELDS = 2 + 8 + 8 + 8 + 32 + 1 + 8 + 1; // time-based interest, lending pool, top-ups, credit level

const big = (v: BN | number | bigint) => BigInt(v.toString());
const bn = (v: bigint | number) => new BN(v.toString());
const enumKey = (v: Record<string, unknown>) => Object.keys(v)[0] as LoanStatus;

// Account discriminators (first 8 bytes) straight from the IDL.
const discriminator = (name: string) => Uint8Array.from(IDL.accounts.find((a) => a.name === name)!.discriminator);

export class LoomClient {
  readonly program: Program<Loom>;
  readonly programId: PublicKey;
  readonly pda: ReturnType<typeof pda>;

  constructor(
    readonly connection: Connection,
    programId?: PublicKey,
  ) {
    // Instruction building / decoding never needs a wallet; signing happens in the caller.
    const provider = { connection } as unknown as AnchorProvider;
    const idl = programId ? ({ ...IDL, address: programId.toBase58() } as Loom) : IDL;
    this.program = new Program<Loom>(idl, provider);
    this.programId = this.program.programId;
    this.pda = pda(this.programId);
  }

  // -------------------------------------------------------------------------
  // decoding
  // -------------------------------------------------------------------------
  decodeConfig(data: Uint8Array): ConfigAccount {
    const c = this.program.coder.accounts.decode("config", Buffer.from(data));
    const s = c.stats;
    return {
      admin: c.admin,
      treasury: c.treasury,
      liquidationThresholdBps: c.liquidationThresholdBps,
      liquidationPenaltyBps: c.liquidationPenaltyBps,
      maxPriceAgeSecs: c.maxPriceAgeSecs,
      maxConfidenceBps: c.maxConfidenceBps,
      minPrincipal: big(c.minPrincipal),
      maxPrincipal: big(c.maxPrincipal),
      paused: c.paused,
      nextLoanId: big(c.nextLoanId),
      stats: Object.fromEntries(Object.entries(s).map(([k, v]) => [k, big(v as BN)])) as ConfigAccount["stats"],
    };
  }

  decodeLoan(address: PublicKey, data: Uint8Array): LoanAccount {
    // Older loans are shorter. Loans opened before `recipient` existed paid the borrower (bytes 16..48),
    // so that becomes the recipient; loans opened before time-based interest get zeroed interest
    // fields (rateBps = 0 marks the fixed 12% fee they were opened with).
    let full = Buffer.from(data);
    if (full.length < LOAN_SIZE_V2) full = Buffer.concat([full, full.subarray(16, 48)]);
    if (full.length < LOAN_SIZE_V2 + LOAN_V3_FIELDS) full = Buffer.concat([full, Buffer.alloc(LOAN_SIZE_V2 + LOAN_V3_FIELDS - full.length)]);
    const l = this.program.coder.accounts.decode("loan", full);
    const leafIndex = big(l.creditLeafIndex);
    return {
      address,
      id: big(l.id),
      borrower: l.borrower,
      nonce: big(l.nonce),
      mint: l.mint,
      principal: big(l.principal),
      totalDue: big(l.totalDue),
      repaid: big(l.repaid),
      collateralLamports: big(l.collateralLamports),
      openPrice: big(l.openPrice),
      openPriceExpo: l.openPriceExpo,
      startTs: big(l.startTs),
      maturityTs: big(l.maturityTs),
      closedTs: big(l.closedTs),
      liquidationThresholdBps: l.liquidationThresholdBps,
      liquidationPenaltyBps: l.liquidationPenaltyBps,
      status: enumKey(l.status),
      identityCommitment: fromBytes32(l.identityCommitment),
      creditLeaf: fromBytes32(l.creditLeaf),
      creditLeafIndex: leafIndex === NO_LEAF ? null : leafIndex,
      recipient: l.recipient,
      rateBps: l.rateBps,
      principalRepaid: big(l.principalRepaid),
      interestAccrued: big(l.interestAccrued),
      accruedTs: big(l.accruedTs),
      creditCertificate: (l.creditCertificate as PublicKey).equals(PublicKey.default) ? null : l.creditCertificate,
      fromPool: l.fromPool,
      openingCollateralLamports: big(l.openingCollateralLamports),
      creditLevel: l.creditLevel,
    };
  }

  /** Treasury balance and approved payout limit per stablecoin. */
  async fetchPayoutCapacity(treasury: PublicKey, mints: PublicKey[], tokenProgram = TOKEN_PROGRAM_ID): Promise<PayoutCapacity[]> {
    const sources = mints.map((m) => getAssociatedTokenAddressSync(m, treasury, true, tokenProgram));
    const infos = await this.connection.getMultipleAccountsInfo(sources);
    return mints.map((mint, i) => {
      const info = infos[i];
      if (!info) return { mint, source: sources[i], balance: 0n, approved: 0n, available: 0n };
      const acct = unpackAccount(sources[i], info, tokenProgram);
      const approved = acct.delegate?.equals(this.pda.reserve(mint)) ? acct.delegatedAmount : 0n;
      return { mint, source: sources[i], balance: acct.amount, approved, available: acct.amount < approved ? acct.amount : approved };
    });
  }

  decodeReserve(address: PublicKey, data: Uint8Array): ReserveAccount {
    const r = this.program.coder.accounts.decode("reserve", Buffer.from(data));
    return {
      address,
      mint: r.mint,
      vault: r.vault,
      decimals: r.decimals,
      totalFunded: big(r.totalFunded),
      totalWithdrawn: big(r.totalWithdrawn),
      totalDisbursed: big(r.totalDisbursed),
      totalRepaid: big(r.totalRepaid),
    };
  }

  decodeCertificate(address: PublicKey, data: Uint8Array): CertificateAccount {
    const c = this.program.coder.accounts.decode("creditCertificate", Buffer.from(data));
    return {
      address,
      holder: c.holder,
      nullifierHash: fromBytes32(c.nullifierHash),
      root: fromBytes32(c.root),
      minPrincipal: big(c.minPrincipal),
      issuedAt: big(c.issuedAt),
    };
  }

  decodeCreditTreeRoot(data: Uint8Array): { root: bigint; nextIndex: bigint } {
    const t = this.program.coder.accounts.decode("creditTree", Buffer.from(data));
    return { root: fromBytes32(t.roots[t.currentRootIndex]), nextIndex: big(t.nextIndex) };
  }

  /**
   * Program events in a transaction's logs. Events emitted by older program versions can be shorter
   * (fields were only ever appended), so those are decoded with the missing trailing fields zeroed.
   */
  parseEvents(logs: string[]) {
    const coder = this.program.coder;
    const tolerant = {
      ...coder,
      events: {
        decode: (log: string) => {
          try {
            return coder.events.decode(log);
          } catch {
            return coder.events.decode(Buffer.concat([Buffer.from(log, "base64"), Buffer.alloc(256)]).toString("base64"));
          }
        },
      },
    } as typeof coder;
    return [...new EventParser(this.programId, tolerant).parseLogs(logs)];
  }

  /** How a settled (liquidated/defaulted) loan's SOL was split, read from its settlement transaction. */
  async fetchSettlement(loan: PublicKey): Promise<Settlement | null> {
    const sigs = await this.connection.getSignaturesForAddress(loan, { limit: 10 });
    for (const { signature, err } of sigs) {
      if (err) continue;
      const tx = await this.connection.getTransaction(signature, { maxSupportedTransactionVersion: 0 });
      const event = this.parseEvents(tx?.meta?.logMessages ?? []).find((e) => e.name === "loanLiquidated");
      if (!event || !(event.data.loan as PublicKey).equals(loan)) continue;
      return {
        signature,
        seizedLamports: big(event.data.seizedLamports as BN),
        returnedLamports: big(event.data.returnedLamports as BN),
        price: big(event.data.price as BN),
        priceExpo: event.data.priceExpo as number,
      };
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // RPC fetchers (dashboard / app)
  // -------------------------------------------------------------------------
  async fetchConfig(): Promise<ConfigAccount | null> {
    const info = await this.connection.getAccountInfo(this.pda.config());
    return info ? this.decodeConfig(info.data) : null;
  }

  private async fetchByType(name: string, extra: GetProgramAccountsFilter[] = []) {
    return this.connection.getProgramAccounts(this.programId, {
      filters: [{ memcmp: { offset: 0, bytes: utils.bytes.bs58.encode(discriminator(name)) } }, ...extra],
    });
  }

  async fetchLoans(borrower?: PublicKey): Promise<LoanAccount[]> {
    // borrower lives right after discriminator (8) + id (8)
    const filters: GetProgramAccountsFilter[] = borrower ? [{ memcmp: { offset: 16, bytes: borrower.toBase58() } }] : [];
    const accounts = await this.fetchByType("Loan", filters);
    return accounts.map((a) => this.decodeLoan(a.pubkey, a.account.data)).sort((a, b) => Number(b.id - a.id));
  }

  decodePool(address: PublicKey, data: Uint8Array): PoolAccount {
    const p = this.program.coder.accounts.decode("pool", Buffer.from(data));
    return {
      address,
      mint: p.mint,
      vault: p.vault,
      cash: big(p.cash),
      principalOut: big(p.principalOut),
      totalShares: big(p.totalShares),
      totalDeposited: big(p.totalDeposited),
      totalWithdrawn: big(p.totalWithdrawn),
      interestEarned: big(p.interestEarned),
    };
  }

  decodeLenderPosition(address: PublicKey, data: Uint8Array): LenderPositionAccount {
    const p = this.program.coder.accounts.decode("lenderPosition", Buffer.from(data));
    return { address, owner: p.owner, mint: p.mint, shares: big(p.shares), deposited: big(p.deposited), withdrawn: big(p.withdrawn) };
  }

  async fetchPools(): Promise<PoolAccount[]> {
    const accounts = await this.fetchByType("Pool");
    return accounts.map((a) => this.decodePool(a.pubkey, a.account.data));
  }

  /** Pool positions of `owner` (owner is the first field after the discriminator). */
  async fetchLenderPositions(owner?: PublicKey): Promise<LenderPositionAccount[]> {
    const filters: GetProgramAccountsFilter[] = owner ? [{ memcmp: { offset: 8, bytes: owner.toBase58() } }] : [];
    const accounts = await this.fetchByType("LenderPosition", filters);
    return accounts.map((a) => this.decodeLenderPosition(a.pubkey, a.account.data));
  }

  async fetchReserves(): Promise<ReserveAccount[]> {
    const accounts = await this.fetchByType("Reserve");
    return accounts.map((a) => this.decodeReserve(a.pubkey, a.account.data));
  }

  async fetchCertificates(holder?: PublicKey): Promise<CertificateAccount[]> {
    // holder is the first field after the discriminator
    const filters: GetProgramAccountsFilter[] = holder ? [{ memcmp: { offset: 8, bytes: holder.toBase58() } }] : [];
    const accounts = await this.fetchByType("CreditCertificate", filters);
    return accounts.map((a) => this.decodeCertificate(a.pubkey, a.account.data));
  }

  /** Credit leaves in insertion order, ready for `CreditMerkleTree`. */
  static creditLeaves(loans: LoanAccount[]): bigint[] {
    const withLeaf = loans.filter((l) => l.creditLeafIndex !== null).sort((a, b) => Number(a.creditLeafIndex! - b.creditLeafIndex!));
    withLeaf.forEach((l, i) => {
      if (l.creditLeafIndex !== BigInt(i)) throw new Error(`missing credit leaf #${i}`);
    });
    return withLeaf.map((l) => l.creditLeaf);
  }

  // -------------------------------------------------------------------------
  // instruction builders — admin
  // -------------------------------------------------------------------------
  initialize(
    admin: PublicKey,
    p: {
      treasury: PublicKey;
      liquidationThresholdBps: number;
      liquidationPenaltyBps: number;
      maxPriceAgeSecs: number;
      maxConfidenceBps: number;
      minPrincipal: bigint;
      maxPrincipal: bigint;
    },
  ): Promise<TransactionInstruction> {
    return this.program.methods
      .initialize({ ...p, minPrincipal: bn(p.minPrincipal), maxPrincipal: bn(p.maxPrincipal) })
      .accountsStrict({
        admin,
        config: this.pda.config(),
        creditTree: this.pda.creditTree(),
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  updateConfig(
    admin: PublicKey,
    p: Partial<{
      newAdmin: PublicKey;
      treasury: PublicKey;
      liquidationThresholdBps: number;
      liquidationPenaltyBps: number;
      maxPriceAgeSecs: number;
      maxConfidenceBps: number;
      minPrincipal: bigint;
      maxPrincipal: bigint;
      paused: boolean;
    }>,
  ): Promise<TransactionInstruction> {
    return this.program.methods
      .updateConfig({
        newAdmin: p.newAdmin ?? null,
        treasury: p.treasury ?? null,
        liquidationThresholdBps: p.liquidationThresholdBps ?? null,
        liquidationPenaltyBps: p.liquidationPenaltyBps ?? null,
        maxPriceAgeSecs: p.maxPriceAgeSecs ?? null,
        maxConfidenceBps: p.maxConfidenceBps ?? null,
        minPrincipal: p.minPrincipal !== undefined ? bn(p.minPrincipal) : null,
        maxPrincipal: p.maxPrincipal !== undefined ? bn(p.maxPrincipal) : null,
        paused: p.paused ?? null,
      })
      .accountsStrict({ admin, config: this.pda.config() })
      .instruction();
  }

  initReserve(admin: PublicKey, mint: PublicKey, treasury: PublicKey, tokenProgram = TOKEN_PROGRAM_ID) {
    return this.program.methods
      .initReserve()
      .accountsStrict({
        admin,
        config: this.pda.config(),
        mint,
        reserve: this.pda.reserve(mint),
        vault: this.pda.vault(mint),
        treasury,
        treasuryToken: getAssociatedTokenAddressSync(mint, treasury, true, tokenProgram),
        tokenProgram,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  fundReserve(admin: PublicKey, mint: PublicKey, amount: bigint, adminToken?: PublicKey, tokenProgram = TOKEN_PROGRAM_ID) {
    return this.program.methods
      .fundReserve(bn(amount))
      .accountsStrict({
        admin,
        config: this.pda.config(),
        reserve: this.pda.reserve(mint),
        mint,
        vault: this.pda.vault(mint),
        adminToken: adminToken ?? getAssociatedTokenAddressSync(mint, admin, true, tokenProgram),
        tokenProgram,
      })
      .instruction();
  }

  /**
   * Treasury-signed approval letting the program pay loans in `mint` from the treasury's
   * token account, up to `amount` in total. Calling it again replaces the limit; 0 revokes it.
   */
  approvePayouts(treasury: PublicKey, mint: PublicKey, amount: bigint, tokenProgram = TOKEN_PROGRAM_ID): TransactionInstruction {
    const source = getAssociatedTokenAddressSync(mint, treasury, true, tokenProgram);
    return createApproveCheckedInstruction(source, mint, this.pda.reserve(mint), treasury, amount, 6, [], tokenProgram);
  }

  /** Admin: creates the lending pool for a stablecoin that already has a reserve. */
  initPool(admin: PublicKey, mint: PublicKey, tokenProgram = TOKEN_PROGRAM_ID) {
    return this.program.methods
      .initPool()
      .accountsStrict({
        admin,
        config: this.pda.config(),
        reserve: this.pda.reserve(mint),
        mint,
        pool: this.pda.pool(mint),
        vault: this.pda.poolVault(mint),
        tokenProgram,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  /** Deposit `amount` of `mint` into its lending pool for shares. */
  deposit(owner: PublicKey, mint: PublicKey, amount: bigint, tokenProgram = TOKEN_PROGRAM_ID) {
    return this.program.methods
      .deposit(bn(amount))
      .accountsStrict({
        owner,
        pool: this.pda.pool(mint),
        vault: this.pda.poolVault(mint),
        mint,
        ownerToken: getAssociatedTokenAddressSync(mint, owner, true, tokenProgram),
        position: this.pda.lender(mint, owner),
        tokenProgram,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  /** Redeem `shares` of a pool position for stablecoin, sent to the owner's token account. */
  withdraw(owner: PublicKey, mint: PublicKey, shares: bigint, tokenProgram = TOKEN_PROGRAM_ID) {
    return this.program.methods
      .withdraw(bn(shares))
      .accountsStrict({
        owner,
        pool: this.pda.pool(mint),
        vault: this.pda.poolVault(mint),
        mint,
        destination: getAssociatedTokenAddressSync(mint, owner, true, tokenProgram),
        position: this.pda.lender(mint, owner),
        tokenProgram,
      })
      .instruction();
  }

  withdrawReserve(admin: PublicKey, mint: PublicKey, amount: bigint, destination: PublicKey, tokenProgram = TOKEN_PROGRAM_ID) {
    return this.program.methods
      .withdrawReserve(bn(amount))
      .accountsStrict({
        admin,
        config: this.pda.config(),
        reserve: this.pda.reserve(mint),
        mint,
        vault: this.pda.vault(mint),
        destination,
        tokenProgram,
      })
      .instruction();
  }

  // -------------------------------------------------------------------------
  // instruction builders — borrowers
  // -------------------------------------------------------------------------
  openLoan(p: {
    borrower: PublicKey;
    /** Payout wallet (`config.treasury`); loans are paid from its token account. */
    treasury: PublicKey;
    /** Wallet that receives the stablecoin; defaults to the borrower. */
    recipient?: PublicKey;
    mint: PublicKey;
    nonce: bigint;
    principal: bigint;
    collateralLamports: bigint;
    /** Poseidon(secret, nullifier); omit to opt out of ZK credit certificates. */
    identityCommitment?: bigint;
    /** Credit certificates held by the borrower (up to 5): unlock the credit rate for their level, up to their combined limit. */
    creditCertificates?: PublicKey[];
    /** Offer the lending pool as the funding source (used when it has enough cash; otherwise the treasury pays). */
    pool?: boolean;
    priceUpdate?: PublicKey;
    tokenProgram?: PublicKey;
  }) {
    const tokenProgram = p.tokenProgram ?? TOKEN_PROGRAM_ID;
    const loan = this.pda.loan(p.borrower, p.nonce);
    const recipient = p.recipient ?? p.borrower;
    return this.program.methods
      .openLoan({
        nonce: bn(p.nonce),
        principal: bn(p.principal),
        collateralLamports: bn(p.collateralLamports),
        identityCommitment: [...toBytes32(p.identityCommitment ?? 0n)],
      })
      .accountsStrict({
        borrower: p.borrower,
        config: this.pda.config(),
        reserve: this.pda.reserve(p.mint),
        mint: p.mint,
        treasury: p.treasury,
        treasuryToken: getAssociatedTokenAddressSync(p.mint, p.treasury, true, tokenProgram),
        recipient,
        recipientToken: getAssociatedTokenAddressSync(p.mint, recipient, true, tokenProgram),
        loan,
        escrow: this.pda.escrow(loan),
        priceUpdate: p.priceUpdate ?? SOL_USD_PRICE_ACCOUNT,
        chainlinkFeed: CHAINLINK_SOL_USD_FEED,
        creditCertificate: p.creditCertificates?.[0] ?? null,
        pool: p.pool ? this.pda.pool(p.mint) : null,
        poolVault: p.pool ? this.pda.poolVault(p.mint) : null,
        tokenProgram,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts((p.creditCertificates ?? []).slice(1).map((pubkey) => ({ pubkey, isSigner: false, isWritable: false })))
      .instruction();
  }

  repay(p: {
    payer: PublicKey;
    loan: Pick<LoanAccount, "address" | "borrower" | "fromPool">;
    /** Stablecoin used for this payment (USDC or USDT). Pool-funded loans must be repaid in their own coin. */
    mint: PublicKey;
    amount: bigint;
    treasury: PublicKey;
    payerToken?: PublicKey;
    tokenProgram?: PublicKey;
  }) {
    const tokenProgram = p.tokenProgram ?? TOKEN_PROGRAM_ID;
    return this.program.methods
      .repay(bn(p.amount))
      .accountsStrict({
        payer: p.payer,
        config: this.pda.config(),
        loan: p.loan.address,
        borrower: p.loan.borrower,
        escrow: this.pda.escrow(p.loan.address),
        creditTree: this.pda.creditTree(),
        reserve: this.pda.reserve(p.mint),
        mint: p.mint,
        payerToken: p.payerToken ?? getAssociatedTokenAddressSync(p.mint, p.payer, true, tokenProgram),
        treasury: p.treasury,
        treasuryToken: getAssociatedTokenAddressSync(p.mint, p.treasury, true, tokenProgram),
        pool: p.loan.fromPool ? this.pda.pool(p.mint) : null,
        poolVault: p.loan.fromPool ? this.pda.poolVault(p.mint) : null,
        tokenProgram,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  }

  /** Adds `lamports` of SOL to an active loan's escrow (lowers its seizure price). Anyone can top up. */
  addCollateral(payer: PublicKey, loan: PublicKey, lamports: bigint) {
    return this.program.methods
      .addCollateral(bn(lamports))
      .accountsStrict({ payer, config: this.pda.config(), loan, escrow: this.pda.escrow(loan), systemProgram: SystemProgram.programId })
      .instruction();
  }

  liquidate(p: {
    caller: PublicKey;
    loan: Pick<LoanAccount, "address" | "borrower" | "mint" | "fromPool">;
    treasury: PublicKey;
    priceUpdate?: PublicKey;
    tokenProgram?: PublicKey;
  }) {
    const tokenProgram = p.tokenProgram ?? TOKEN_PROGRAM_ID;
    // Pool-funded loans are bought out by the treasury first: it pays the pool what is owed.
    const pool = p.loan.fromPool;
    return this.program.methods
      .liquidate()
      .accountsStrict({
        caller: p.caller,
        config: this.pda.config(),
        loan: p.loan.address,
        escrow: this.pda.escrow(p.loan.address),
        borrower: p.loan.borrower,
        treasury: p.treasury,
        priceUpdate: p.priceUpdate ?? SOL_USD_PRICE_ACCOUNT,
        chainlinkFeed: CHAINLINK_SOL_USD_FEED,
        pool: pool ? this.pda.pool(p.loan.mint) : null,
        poolVault: pool ? this.pda.poolVault(p.loan.mint) : null,
        reserve: pool ? this.pda.reserve(p.loan.mint) : null,
        mint: pool ? p.loan.mint : null,
        treasuryToken: pool ? getAssociatedTokenAddressSync(p.loan.mint, p.treasury, true, tokenProgram) : null,
        tokenProgram: pool ? tokenProgram : null,
      })
      .instruction();
  }

  /** Returns [computeBudgetIx, claimIx] — Groth16 verification needs ~>200k CU. */
  async claimCertificate(holder: PublicKey, proof: CertificateProof): Promise<TransactionInstruction[]> {
    const ix = await this.program.methods
      .claimCertificate({
        proofA: proof.proofA,
        proofB: proof.proofB,
        proofC: proof.proofC,
        root: proof.root,
        nullifierHash: proof.nullifierHash,
        minPrincipal: bn(proof.minPrincipal),
      })
      .accountsStrict({
        holder,
        config: this.pda.config(),
        creditTree: this.pda.creditTree(),
        certificate: this.pda.certificate(Uint8Array.from(proof.nullifierHash)),
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    return [ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }), ix];
  }
}
