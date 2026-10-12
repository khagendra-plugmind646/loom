# Loom — transparent SOL-backed stablecoin loans on Solana

**Borrow USDC or USDT against your SOL at a fixed 12% a year, with every escrow and reserve verifiable on-chain, and a zero-knowledge credit history that earns you 8% next time.**

| | |
|---|---|
| **Live demo (devnet)** | **[loom-lending.vercel.app](https://loom-lending.vercel.app)**: start at [`/test`](https://loom-lending.vercel.app/test) for a 10-minute guided tour with free test tokens |
| **Program (devnet)** | [`wrCPKEKsMDgLdpNFJwGK8LSvWVRUnuEsbQVAZAXkoBQ`](https://explorer.solana.com/address/wrCPKEKsMDgLdpNFJwGK8LSvWVRUnuEsbQVAZAXkoBQ?cluster=devnet) |
| **Proof of reserves** | [`/transparency`](https://loom-lending.vercel.app/transparency): every vault, escrow and loan, recomputed live from the chain |
| **Pitch video** | _coming soon_ |
| **Demo video** | _coming soon_ |
| **Tests** | `pnpm test`: 281 passing, against the real program binary in LiteSVM, including real Groth16 proofs |

> **New here? Start with [SETUP.md](SETUP.md)**: install, run the tests, and run the app locally step by step.

Loom is a Ledn-style lending platform built entirely on Solana:

* A borrower locks **SOL worth at least 2× the loan** in an on-chain **escrow**.
* In the same transaction they receive **USDC or USDT** straight to their wallet.
* They repay the principal plus **12% a year, charged only for the time they borrow** (minimum 30 days), any time **within 12 months**, in USDC or USDT, in one go or in parts. Every payment goes **directly to the admin treasury**.
* Each on-time repayment can mint a **ZK credit certificate**; the wallet holding it borrows at **8% a year** on loans up to 2× the repaid amount it proves, without revealing the earlier loan.
* The final payment **automatically releases the SOL**. Unpaid loans after 12 months, and loans whose collateral falls too far, are settled by a public, rule-based liquidation.
* Repaid borrowers can mint a **zero-knowledge repayment certificate**: a Groth16 proof, verified on-chain, that they repaid a loan of at least $X in full and on time, without revealing which loan or wallet.
* A **Proof of Reserves** page lets anyone (investors, borrowers, auditors) check every vault, escrow and loan live on-chain.

```
programs/loom/     Anchor (Rust) program: escrow, reserves, loans, liquidation, ZK verifier
zk/                Circom circuit + Groth16 build pipeline (snarkjs, PSE powers of tau)
sdk/               TypeScript SDK shared by the app, tests and scripts (PDAs, math, Pyth + Chainlink, ZK prover)
app/               Next.js 16 web app with Solana wallet adapter (Phantom, Solflare, Backpack…)
tests/             End-to-end tests: real program binary in LiteSVM, incl. real Groth16 proofs
scripts/           localnet, bootstrap, faucet, and an end-to-end demo against a real validator
```

---

## How each requirement is met

| Requirement | Implementation |
|---|---|
| SOL collateral worth 2× the loan | `COLLATERAL_RATIO_BPS = 20_000` is a compile-time constant. The SOL is valued with **two oracles, Pyth and Chainlink SOL/USD**, at the *lower* of Pyth's `price − conf` and Chainlink. Settlement uses the *higher* of the two, so SOL is only seized when both show the drop. Stale, unverified, foreign or wrong-feed oracle accounts are rejected. |
| Loan paid in USDC **or** USDT, directly to the borrower | Each stablecoin has a program-owned **reserve vault** (PDA). `open_loan` locks the SOL and transfers the stablecoin vault → borrower in one atomic transaction. |
| Escrow | Every loan gets its **own escrow PDA** (`["escrow", loan]`). Only two code paths can move its SOL: full repayment (→ borrower) and the published liquidation rule. Nobody, the admin included, can withdraw it. |
| Repay within 12 months, any time, interest only for the time borrowed | Interest accrues per second at 12% a year (8% with a credit certificate) on the principal still owed, with a 30-day minimum, and stops at maturity. Payments cover interest first. `maturity = start + 365 days`. `repay` accepts partial payments until maturity and rejects them afterwards. Overpayments are capped at what is owed. |
| Repay only in stablecoin, to the admin | `repay` transfers USDC or USDT from the payer to the **treasury's token account** (pinned by `has_one = treasury`). |
| Zero-knowledge proof | Fully repaid loans enter an on-chain **Poseidon Merkle tree**. A Groth16 circuit proves *"I own a leaf, repaid ≥ 112% of principal, closed ≤ 365 days after opening, principal ≥ $X"*. The program verifies it with Solana's `alt_bn128` syscalls (~118k CU). |
| "Whole money on the blockchain", investor trust | Reserves, escrows, loans, risk settings and running totals are all public accounts. The Transparency page re-computes them live and runs integrity checks: escrow balances ≥ collateral, accounting matches, ZK tree root matches, oracle fully verified. |
| Wallet send / receive | `/wallet`: balances, send SOL/USDC/USDT (creates the recipient's token account if needed), receive with address + QR code. |

### A note on "100% transparent" and zero-knowledge

On Solana, transparency comes from the chain itself: every lamport in escrow and every stablecoin in a vault is publicly visible and only moves under the program's rules. Zero-knowledge doesn't add transparency. It adds **verifiable privacy**: a borrower can prove a true statement about their repayment history to anyone, such as a new lender, an investor or another protocol, without exposing their wallet, the loan or the exact amounts. Loom uses each for what it does best: public state for solvency and auditability, ZK for privacy-preserving credit proofs.

---

## Trust model: what the operator can and cannot do

| The admin **can** | The admin **cannot** |
|---|---|
| Deposit / withdraw *idle* liquidity from the reserve vaults | Touch any borrower's escrowed SOL |
| Pause **new** loans (repayments and releases keep working) | Change the 2× / 12% / 12-month terms (compiled in) |
| Tune liquidation threshold/penalty **for new loans** (each loan snapshots its own) | Change the risk parameters of an existing loan |
| Change the treasury address and oracle max-age | Liquidate a healthy loan before maturity |
| | Mint a ZK certificate without a valid proof |

Liquidation and default settlement are **permissionless**: any keeper, investor or the borrower can trigger it. The program decides where the SOL goes: on **default** (past the deadline) it sends SOL worth the *outstanding debt* to the treasury and returns the rest to the borrower; when SOL falls to 60% of its opening price (or below the debt backstop) before the deadline, all of the SOL goes to the treasury.

For mainnet, the program upgrade authority and admin key should be a multisig (e.g. Squads), or the upgrade authority should be revoked. See the checklist below.

---

## Protocol rules

```
oracles       Pyth SOL/USD (pull, Wormhole-verified) + Chainlink SOL/USD Data Feed (read from the feed account)
open price    min(pyth, chainlink)                — the 60% rule is measured from this
origination   collateral_value(min(pyth − conf, chainlink)) ≥ 2.00 × principal
settlement    every rule below is evaluated at max(pyth, chainlink)
interest      principal_owed × rate × seconds / year, rounded up; rate = 12% (8% with a credit certificate)
              at least 30 days of interest (or the whole term if shorter); accrual stops at maturity
owed          principal_owed + interest accrued − interest paid; payments cover interest first
total_due     principal + interest for the whole term: the most a loan can cost, fixed at open
credit rate   open_loan with a certificate held by the borrower: 8% on principal ≤ 2 × certificate.min_principal
pool          shares = deposit × total_shares / (cash + principal_out); withdrawals limited to cash
              loans are funded from the pool when cash ≥ principal, otherwise from the treasury
              pool-loan interest: 90% to depositors, 10% (PROTOCOL_FEE_BPS) to the treasury
              settlement of a pool loan: the treasury pays the pool everything owed, then takes the SOL as usual
term          maturity = open + 365 days; repayments after maturity are rejected
price rule    settleable when price ≤ 60% of the opening price → all collateral to treasury
health        settleable when collateral_value(price) < outstanding × liquidation_threshold → all collateral to treasury
default       after maturity, anyone can settle:
              seize = min(collateral, lamports worth outstanding at price, rounded up) → treasury
              remainder + escrow rent → borrower
```

### Accounts (all PDAs of the Loom program)

```
Config        ["config"]                 admin, treasury, risk params, live protocol stats
CreditTree    ["credit_tree"]            Poseidon Merkle tree (depth 20) + 32-root history
Reserve       ["reserve", mint]          per-stablecoin accounting
  vault       ["vault", mint]            SPL token account owned by the Reserve PDA
Loan          ["loan", borrower, nonce]  full loan record (terms, payments, oracle price at open, ZK leaf)
  escrow      ["escrow", loan]           holds the loan's SOL collateral
Certificate   ["certificate", nullifier] one ZK repayment certificate per repaid loan
```

### Instructions

| Instruction | Who | What |
|---|---|---|
| `initialize` | admin (once) | Config + empty credit tree |
| `init_reserve`, `fund_reserve`, `withdraw_reserve` | admin | Stablecoin vault management |
| `init_pool` | admin | Create the lending pool for a stablecoin |
| `deposit`, `withdraw` | anyone | Supply stablecoin to a pool for shares / redeem shares for available cash |
| `update_config` | admin | Pause, risk params for future loans, treasury |
| `open_loan` | borrower | Lock SOL in escrow, receive stablecoin (from the lending pool if it has the cash, else the treasury); a credit certificate unlocks 8% |
| `repay` | anyone | Pay the treasury, or the pool for pool-funded loans (minus a 10% protocol fee on interest); the final payment releases collateral and inserts the ZK leaf |
| `liquidate` | anyone | Settle a seized or matured loan; pool-funded loans are first bought out by the treasury at what is owed |
| `claim_certificate` | anyone | Verify a Groth16 proof on-chain and record the certificate |

---

## Zero-knowledge repayment certificates

1. **Borrow**: the browser generates a private note `(secret, nullifier)` and sends only `identity = Poseidon(secret, nullifier)`. The user downloads the note; it never leaves their machine otherwise.
2. **Repay in full**: the program computes `leaf = Poseidon(identity, principal, totalRepaid, startTs, closedTs)` with the native `sol_poseidon` syscall and appends it to the credit tree.
3. **Prove**: from any wallet, the user generates a proof in the browser (~1.3 s) for the circuit [`zk/circuits/repayment_certificate.circom`](zk/circuits/repayment_certificate.circom).

| Public inputs | Private inputs |
|---|---|
| Merkle root (must be in the program's root history) | secret, nullifier |
| `nullifierHash = Poseidon(nullifier)` (one certificate per loan) | principal, totalRepaid, timestamps |
| `minPrincipal` (the public claim) | Merkle path |
| recipient wallet (front-running protection) | |

Constraints proven: leaf membership, `totalRepaid × 10000 ≥ principal × 11200`, `0 ≤ closedTs − startTs ≤ 365 days`, `principal ≥ minPrincipal`, 64-bit range checks.

The verifying key is generated into [`programs/loom/src/zk/verifying_key.rs`](programs/loom/src/zk/verifying_key.rs) and also published at `app/public/zk/verification_key.json`, so anyone can verify proofs off-chain too.

> ⚠️ **Trusted setup.** Phase 1 uses the public **PSE Perpetual Powers of Tau** (80 contributions). Phase 2 (circuit-specific) currently has **one local contribution**, which is fine for devnet. Before mainnet, run a multi-party phase-2 ceremony, regenerate the key, rebuild the program and publish the transcript. Re-running `pnpm zk:build` creates a new key, so the program **must** be rebuilt afterwards; the zkey and the on-chain key must always match.

---

## Getting started

### Prerequisites (versions used to build this repo)

* Rust 1.99 (`rustup`), Solana/Agave CLI 4.3, Anchor 0.32.1 (`avm install 0.32.1`)
* Node 22, pnpm 11
* circom 2.2.2 (only needed to rebuild the circuit)

### Build & test

```bash
pnpm install
pnpm build:program        # anchor build (SBPF v3) + sync IDL into the SDK
pnpm test                 # 281 tests: the real .so in LiteSVM, real Groth16 proofs
cargo test -p loom --lib  # Rust unit tests (math)
pnpm typecheck && pnpm lint
```

Tests are split by feature, and every test builds its own fresh LiteSVM world (`createWorld()` in
`tests/fixtures.ts`, ~15 ms), so no test depends on another's side effects:

| File | Covers |
|---|---|
| `admin.test.ts` | `initialize`, `update_config`: every parameter bound, admin handover, pause |
| `reserve.test.ts` | `init_reserve`, `fund_reserve`, `withdraw_reserve` |
| `open-loan.test.ts` | origination: every field, event, stat, rejection and boundary |
| `repay.test.ts` | interest-first payments, caps, deadline, collateral release, credit leaves |
| `add-collateral.test.ts` | top-ups |
| `liquidate.test.ts` | debt threshold, 60% rule, defaults, SOL split, SDK `settleReason` parity |
| `oracle.test.ts` | every Pyth / Chainlink validation branch and how the two are combined |
| `pool.test.ts` | deposits, withdrawals, pool-funded loans, protocol fee, treasury buy-out |
| `credit.test.ts` | credit levels and limits (certificates injected, no prover needed) |
| `credit-tree.test.ts` | Poseidon tree, root history, full-tree behaviour |
| `zk.test.ts` | real Groth16 claims: nullifiers, front-running, tampering |
| `invariants.test.ts` | seeded random mix of all actions; stats reconcile after every step |
| `sdk.test.ts` | SDK math helpers and decoding of older loan layouts |
| `loom.test.ts` | the original end-to-end story |

Run one file with `npx mocha --import=tsx tests/pool.test.ts`. `LOOM_SO=path/to/loom.so pnpm test` runs the suite
against another build.

### Run the whole stack locally (real validator, real Pyth price)

```bash
pnpm localnet                                   # terminal 1: validator + program + Pyth SOL/USD cloned from devnet
pnpm bootstrap                                  # terminal 2: test USDC/USDT, init protocol, fund reserves, write app/.env.local
pnpm faucet --to <your wallet address>          # 20 SOL + 5,000 test USDC/USDT
pnpm dev                                        # http://localhost:3000
pnpm demo                                       # optional: scripted borrow → repay → ZK certificate
```

In Phantom: Settings → Developer settings → enable Testnet mode and select **Solana Localnet**.
The cloned oracle price is a snapshot, so localnet allows a 1-hour price age. Restart `pnpm localnet` to refresh it.

### Deploy to devnet

```bash
solana-keygen new                                  # if you don't have ~/.config/solana/id.json yet
solana config set --url devnet
solana airdrop 2 && solana airdrop 2              # or https://faucet.solana.com; deployment needs ~3.5 SOL
anchor deploy --provider.cluster devnet
pnpm bootstrap --cluster devnet --admin ~/.config/solana/id.json
pnpm dev
```

Use a dedicated RPC for the app (`NEXT_PUBLIC_RPC_URL`), because public endpoints rate-limit `getProgramAccounts`. See [`app/.env.local.example`](app/.env.local.example).

### Deploy the web app

The app is a standard Next.js 16 project in `app/`. On Vercel, set the root directory to `app` and add the `NEXT_PUBLIC_*` variables from `app/.env.local.example`.

### Hosted demo and testers

* `/test` walks testers through every feature on devnet and ticks steps off from their on-chain activity; the **Feedback** button on every page stores ratings and comments for the admin.
* `/api/faucet` sends 100 test USDC + USDT per wallet (12-hour cooldown with a database) from a devnet-only faucet wallet. Create and fund it once:
  ```bash
  solana-keygen new --no-bip39-passphrase -o .keys/faucet.json
  solana transfer $(solana-keygen pubkey .keys/faucet.json) 0.2 --allow-unfunded-recipient -u devnet
  pnpm faucet --cluster devnet --admin ~/.config/solana/id.json --to $(solana-keygen pubkey .keys/faucet.json) --usd 100000 --sol 0
  ```
  then set `FAUCET_SECRET_KEY` (the JSON array in `.keys/faucet.json`) as a server-only env var. It holds only test tokens; never use the deploy key.
* On Vercel set `DATABASE_URL` too: help messages and feedback need a database there (serverless file systems are read-only).
* `docs/user-research.md` has outreach messages, an interview script and the numbers to report.

### Admin database (Postgres)

Everything Loom stores on-chain (config, reserves, loans with their settlement split, certificates and every program event) can be copied into a private Postgres database for the admin. The chain stays the source of truth: the database can be dropped and rebuilt with one indexer run.

1. Create a Postgres database (Neon or Supabase) and put its connection string in `app/.env` as `DATABASE_URL=...` (server-only, never `NEXT_PUBLIC_`).
2. `pnpm indexer --cluster devnet` creates the tables (`db/schema.sql`), backfills all history, then syncs every 15 s (`--once` for a single pass).
3. On `/admin`, **Open database** asks the admin wallet to sign; `/api/admin/db` only answers a fresh signature from `LOOM_ADMIN_WALLET`. You can also connect with psql or TablePlus; `loans_readable` shows amounts in USDC/SOL.

---

## Mainnet checklist

- [ ] **Independent security audit** of the Anchor program *and* the circom circuit
- [ ] Multi-party **phase-2 trusted setup**; rebuild verifying key + program; publish transcript
- [ ] Upgrade authority → **multisig** (Squads) or revoked; publish a **verifiable build** (`solana-verify`)
- [ ] Admin and treasury → multisig
- [ ] Run a **liquidation keeper** (the `liquidate` instruction is permissionless) and monitoring/alerts
- [ ] Set the **mainnet Chainlink SOL/USD feed** address in `CHAINLINK_SOL_USD_FEED` (program `constants.rs` and `sdk/src/constants.ts`; the current one is devnet)
- [ ] Set mainnet mints (USDC `EPjF…Dt1v`, USDT `Es9v…nwNYB`, used by default when `NEXT_PUBLIC_SOLANA_CLUSTER=mainnet-beta`) and fund the reserves
- [ ] Dedicated RPC + an indexer for loan history
- [ ] **Legal & compliance**: consumer lending is regulated in most jurisdictions (Ledn is licensed and runs KYC/AML). Get legal advice before offering loans to the public.

## Known limitations and next steps

* The 60% seizure rule is based on SOL's price. Adding SOL (`add_collateral`, open to anyone) or repaying principal lowers the price at which a loan can be seized, in proportion.
* Liquidations pay the treasury in **SOL**; the operator converts it (or a Jupiter swap could be added).
* A borrower can submit any valid Pyth update within the max-age window (default 120 s). This is standard for pull oracles, and the window is bounded.
* The ZK note lives in the browser (localStorage + downloaded file). Losing it only means losing the ability to mint a certificate, never funds.

## Verified in this repo

* `pnpm test`: **281 passing** (for any loan term): origination and the 2× rule, oracle validation (stale / unverified / foreign / wrong feed / wide confidence), Pyth + Chainlink rules (lower price at open, both must show a drop, default priced at the higher, stale / forged Chainlink feed), USDC + USDT disbursement, partial repayments in mixed stablecoins, overpayment cap, collateral release, maturity enforcement, liquidation and default math, forged-account rejection, admin-only guards, pause, accounting reconciliation, and ZK (valid certificate, double-claim, front-running, inflated claims, unknown roots).
* `pnpm demo` on a real `solana-test-validator` with live Pyth data: borrow → partial USDC + final USDT repayment → SOL released → browser-grade proof (1.2 s) → certificate minted (119k CU).
* The full UI flow was driven in headless Chrome against localnet: connect wallet → borrow → pay in full → prove in browser → mint → verify → send SOL. It ran with no browser errors and all integrity checks passing.

## License

[MIT](LICENSE)
