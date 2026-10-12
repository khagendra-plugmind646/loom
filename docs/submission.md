# Colosseum submission: copy-paste text

Fields marked **[fill in]** need your own facts. Update the traction numbers right before submitting (see "Numbers" at the end).

## Product name

Loom

## One-line description

Borrow USDC or USDT against your SOL at a fixed 12% a year, with every escrow and reserve verifiable on-chain, and a zero-knowledge credit history that gets you 8% on your next loan.

## Description

Long-term SOL holders who need dollars have two bad options: sell (and lose their position, often with a tax bill) or borrow on DeFi money markets with variable rates and liquidation at the first sharp dip. Centralised lenders offer fixed terms, but borrowers have to trust a company with their collateral.

Loom offers a fixed-term loan that is fully on-chain:

- **Lock SOL worth 2× the loan** in an escrow that belongs to that loan alone. Nobody, the operator included, can move it except by repayment or the published liquidation rule.
- **Receive USDC or USDT in the same transaction.**
- **Pay 12% a year, only for the time you borrow** (30-day minimum), any time within 12 months, in parts or in one go. The final payment releases the SOL automatically.
- **Earn a private credit history.** An on-time repayment lets the borrower mint a Groth16 zero-knowledge certificate, verified on-chain, proving they repaid a loan of at least $X on time without revealing which loan or wallet. The certificate gives 8% a year on the next loan, from any wallet.
- **Proof of reserves anyone can check.** The Transparency page recomputes every vault, escrow and loan live from the chain and runs integrity checks.

SOL is priced with two oracles (Pyth and Chainlink): loans open at the lower price and are only liquidated when both oracles show the drop. Liquidation is permissionless and rule-based.

## Blockchains and tools

- **Chain:** Solana (devnet deployment, program `wrCPKEKsMDgLdpNFJwGK8LSvWVRUnuEsbQVAZAXkoBQ`)
- **On-chain program:** Rust, Anchor 0.32
- **Oracles:** Pyth (pull oracle, Hermes) and Chainlink SOL/USD
- **Zero knowledge:** Circom circuit, Groth16 (snarkjs) proving in the browser, verified on-chain with Solana's `alt_bn128` syscalls (~118k CU), Poseidon Merkle tree of repaid loans
- **Tokens:** SPL Token (USDC, USDT)
- **App:** Next.js 16, React 19, Solana Wallet Adapter (Phantom, Solflare, Backpack), TanStack Query
- **Data:** Postgres on Supabase, fed by an indexer of program events (the chain stays the source of truth)
- **Hosting:** Vercel
- **Testing:** LiteSVM and Mocha, 281 tests against the real program binary, including real Groth16 proofs

## Links

- Live demo: https://loom-lending.vercel.app (guided tour: https://loom-lending.vercel.app/test)
- Code: https://github.com/khagendra-plugmind646/loom
- Program on Solana Explorer: https://explorer.solana.com/address/wrCPKEKsMDgLdpNFJwGK8LSvWVRUnuEsbQVAZAXkoBQ?cluster=devnet

## Team

**[fill in]** Name, role, background (what you've built before, relevant experience), X / GitHub handle, for each member.

## Location

**[fill in]**

## Go-to-market strategy

**Who we serve first:** long-term SOL holders who want dollars for a few months without selling, and who want fixed, predictable terms over variable DeFi rates. They are easy to reach through Solana communities and already hold the collateral.

**Phases:**
1. **Devnet testers to mainnet beta.** Recruit testers through Superteam chapters, Solana Telegram/Discord groups and university blockchain clubs, using the `/test` guided tour and in-app feedback. Launch on mainnet with low per-loan caps after an independent audit of the program and circuit, with admin and upgrade keys under a Squads multisig.
2. **Liquidity.** Open the Earn pool to depositors, who receive 90% of the fixed interest on the loans the pool funds. The proof-of-reserves page is the trust argument for depositors.
3. **Credit certificates as a distribution channel.** Other protocols can verify a Loom certificate on-chain to give "verified repayers" better terms (higher LTV, lower rates, allowlists). Every integration brings borrowers back to Loom to earn a certificate.

**Revenue:** a 10% protocol fee on interest from pool-funded loans, all interest on treasury-funded loans, and SOL settled to the treasury under the published liquidation rules.

## Demand validation

**[fill in with real numbers and quotes; keep only what is true]**

- Devnet: **[N]** loans opened by **[N]** wallets, **[N]** repaid in full, **[N]** ZK certificates minted
- **[N]** testers completed the `/test` tour; average feedback rating **[x]/5**
- **[N]** conversations with SOL holders. Top reasons they don't borrow today: **[e.g. liquidation fear, variable rates]**
- Quotes: "**[exact quote]**", "**[exact quote]**"
- Protocols interested in the credit certificate: **[names, or remove]**
- What we changed because of feedback: **[1–3 items]**

## Distribution plan

- **Communities:** Superteam chapters, Solana Telegram/Discord groups, university clubs; short demo clips on X showing "borrow against SOL in one transaction" and the live proof-of-reserves page.
- **Integrations:** the credit-certificate verifier for other Solana lending and DeFi protocols, plus wallet listings.
- **Content:** a public, always-on proof-of-reserves page and the open-source program as trust signals; explainers on fixed-rate vs variable-rate borrowing for SOL holders.

## Numbers (update before submitting)

On 2026-10-12 the indexer showed: 5 loans from 2 wallets (4 closed), 0 tester feedback entries, 0 faucet claims. These are team test loans. Replace them with outside tester numbers as they come in: `pnpm indexer --cluster devnet --once`, then check `/admin` → Open database.
