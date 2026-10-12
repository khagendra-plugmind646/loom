/**
 * End-to-end borrower journey against a real validator (localnet or devnet):
 *   borrow USDC against SOL -> partial repay in USDC -> final repay in USDT
 *   -> SOL released -> ZK proof generated -> certificate minted by a fresh wallet.
 *
 *   pnpm localnet            # terminal 1
 *   pnpm bootstrap           # terminal 2 (once)
 *   pnpm demo
 */
import { readFileSync } from "node:fs";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createMintToInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  LoomClient,
  SOL_USD_PRICE_ACCOUNT,
  createNote,
  formatSol,
  formatStable,
  identityCommitment,
  loanDebt,
  parsePriceUpdateV2,
  priceToNumber,
  requiredCollateralLamports,
} from "@loom/sdk";
import { proveRepaymentCertificate } from "@loom/sdk/prover";
import { ROOT, airdropIfNeeded, arg, cluster, connection, loadKeypair, sendIxs } from "./common";

const c = cluster();
const conn = connection(c);
const client = new LoomClient(conn);
const admin = loadKeypair(arg("admin", `${ROOT}/.keys/admin.json`)!);
const mints = JSON.parse(readFileSync(`${ROOT}/.keys/mints.${c}.json`, "utf8")) as { usdc: string; usdt: string };
const usdc = new PublicKey(mints.usdc);
const usdt = new PublicKey(mints.usdt);
const USD = (n: number) => BigInt(Math.round(n * 1e6));
const step = (s: string) => console.log(`\n▶ ${s}`);

async function main() {
  const config = (await client.fetchConfig())!;
  await airdropIfNeeded(conn, admin, 40, c);
  const borrower = Keypair.generate();
  step(`borrower ${borrower.publicKey.toBase58()}`);
  const ata = (m: PublicKey, o: PublicKey) => getAssociatedTokenAddressSync(m, o, true);
  await sendIxs(
    conn,
    [
      SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: borrower.publicKey, lamports: 30 * LAMPORTS_PER_SOL }),
      createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, ata(usdt, borrower.publicKey), borrower.publicKey, usdt),
      createMintToInstruction(usdt, ata(usdt, borrower.publicKey), admin.publicKey, USD(600)),
    ],
    [admin],
  );

  const info = await conn.getAccountInfo(SOL_USD_PRICE_ACCOUNT);
  const price = parsePriceUpdateV2(info!.data);
  step(`Pyth SOL/USD = $${priceToNumber(price).toFixed(4)} (published ${new Date(price.publishTime * 1000).toISOString()})`);

  const principal = USD(1_000);
  const collateral = requiredCollateralLamports(principal, price.price, price.conf, price.expo, 100n);
  const note = createNote();
  const nonce = BigInt(Date.now());
  const loanAddr = client.pda.loan(borrower.publicKey, nonce);
  step(`open loan: borrow ${formatStable(principal)} USDC, lock ${formatSol(collateral)} SOL`);
  let sig = await sendIxs(
    conn,
    [
      await client.openLoan({
        borrower: borrower.publicKey,
        treasury: config.treasury,
        mint: usdc,
        nonce,
        principal,
        collateralLamports: collateral,
        identityCommitment: identityCommitment(note),
      }),
    ],
    [borrower],
  );
  const escrow = client.pda.escrow(loanAddr);
  console.log(`  tx ${sig}\n  loan ${loanAddr.toBase58()}\n  escrow ${escrow.toBase58()} holds ${formatSol(BigInt(await conn.getBalance(escrow)))} SOL`);
  console.log(`  borrower USDC: ${(await conn.getTokenAccountBalance(ata(usdc, borrower.publicKey))).value.uiAmountString}`);

  let loan = (await client.fetchLoans(borrower.publicKey))[0];
  step(`repay 600 USDC (owed ${formatStable(loanDebt(loan, Math.floor(Date.now() / 1000)).owed)})`);
  await sendIxs(conn, [await client.repay({ payer: borrower.publicKey, loan, mint: usdc, amount: USD(600), treasury: config.treasury })], [borrower]);

  loan = (await client.fetchLoans(borrower.publicKey))[0];
  // a minute of extra interest covers the time until the transaction lands; the program takes only what is owed
  const rest = loanDebt(loan, Math.floor(Date.now() / 1000) + 60).owed;
  step(`repay remaining ${formatStable(rest)} in USDT`);
  const solBefore = await conn.getBalance(borrower.publicKey);
  sig = await sendIxs(conn, [await client.repay({ payer: borrower.publicKey, loan, mint: usdt, amount: rest, treasury: config.treasury })], [borrower]);
  loan = (await client.fetchLoans(borrower.publicKey))[0];
  console.log(`  tx ${sig}\n  status: ${loan.status} · SOL returned: ${formatSol(BigInt((await conn.getBalance(borrower.publicKey)) - solBefore))} · credit leaf #${loan.creditLeafIndex}`);

  step("generate Groth16 proof: 'repaid a loan >= $500 in full within 12 months'");
  const anon = Keypair.generate();
  await sendIxs(conn, [SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: anon.publicKey, lamports: 0.05 * LAMPORTS_PER_SOL })], [admin]);
  const all = await client.fetchLoans();
  const t0 = Date.now();
  const proof = await proveRepaymentCertificate({
    note,
    loan: { principal: loan.principal, totalRepaid: loan.repaid, startTs: loan.startTs, closedTs: loan.closedTs, leafIndex: Number(loan.creditLeafIndex) },
    leaves: LoomClient.creditLeaves(all),
    minPrincipal: USD(500),
    recipient: anon.publicKey,
    wasm: `${ROOT}/zk/build/repayment_certificate_js/repayment_certificate.wasm`,
    zkey: `${ROOT}/zk/build/repayment_certificate.zkey`,
  });
  console.log(`  proved in ${Date.now() - t0} ms`);

  step(`fresh wallet ${anon.publicKey.toBase58()} claims the certificate`);
  sig = await sendIxs(conn, await client.claimCertificate(anon.publicKey, proof), [anon]);
  const tx = await conn.getTransaction(sig, { maxSupportedTransactionVersion: 0 });
  const certs = (await client.fetchCertificates()).filter((x) => x.holder.equals(anon.publicKey));
  console.log(`  tx ${sig} · ${tx?.meta?.computeUnitsConsumed} CU`);
  console.log(`  certificate ${certs[0].address.toBase58()}: holder repaid >= $${formatStable(certs[0].minPrincipal, 0)} on time ✔`);

  const cfg = (await client.fetchConfig())!;
  step(`protocol stats: ${cfg.stats.loansOpened} opened, ${cfg.stats.loansRepaid} repaid, ${cfg.stats.certificatesIssued} certificates`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
