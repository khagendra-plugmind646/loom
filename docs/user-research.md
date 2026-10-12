# User research kit

Colosseum judges look for evidence that real people have the problem. This kit turns testers and conversations into that evidence.

## 1. Where to find people (this week)

| Channel | Ask |
|---|---|
| Superteam (your country chapter) Discord/Telegram | "Building SOL-backed fixed-rate loans with a private credit history. 10-minute devnet test → /test. Feedback goes straight to me." |
| X / Twitter (Solana builders, SOL holders) | Short demo clip + link to /test + "What would you need to borrow against your SOL instead of selling?" |
| Solana dev Telegram groups, university blockchain clubs | Ask for 10-minute testers; offer to credit them in the README |
| People who hold SOL long-term | 15-minute call using the script below |

Goal: **20–50 testers** through `/test`, **10–20 conversations**, **2–3 protocol conversations** about using the ZK credit proof.

## 2. Ready-to-post messages

**Tester call**
> I'm building Loom: borrow USDC/USDT against SOL at a fixed 12% a year, only for the time you borrow, with every escrow and reserve verifiable on-chain. Repay on time and you get a zero-knowledge credit certificate: 8% on your next loan, from any wallet, without revealing the old one.
> It's on devnet (no real money). The /test page walks you through everything in ~10 minutes and has a Feedback button. Brutal feedback welcome: https://loom-lending.vercel.app/test

**Protocol / integration ask**
> We issue on-chain ZK proofs that a wallet repaid a loan of at least $X on time, without linking it to the borrowing wallet. Would a "verified repayer" signal be useful for <your protocol> (better LTV, lower rate, allowlists)? Happy to share the verifier — it's ~118k CU on-chain.

## 3. 15-minute interview script

1. Do you hold SOL long-term? Roughly how much, and for how long?
2. Last time you needed dollars, what did you do? (Sell, CEX loan, Kamino/Jupiter, nothing?) Why?
3. What stopped you from borrowing against your SOL? (Liquidation fear, variable rates, complexity, trust, taxes?)
4. *Show the borrow page.* What's the first thing you'd want to know before signing?
5. Fixed 12% a year with no margin calls vs. ~90% LTV with variable rates and liquidations: which would you pick, and why?
6. Would a private on-chain credit history (better terms next time) change how you borrow?
7. What would make you trust this with real money? (Audit, team, track record, insurance?)
8. If this existed on mainnet today, would you use it this month? For how much?

Write down **exact quotes**: they go straight into the pitch video.

## 4. Feedback log (copy into a sheet)

| Date | Who (role) | Channel | Tried | Rating | Quote | Problem / request | Follow-up |
|---|---|---|---|---|---|---|---|

In-app feedback lands in the admin page (**Tester feedback**) and in the `feedback` table of the admin database.

## 5. Numbers to show judges

- Testers who completed `/test` (wallets with a repaid loan), and how many minted a certificate
- Loans opened / repaid, total borrowed and repaid, pool deposits (Transparency page and the admin database)
- Average feedback rating, and the top 3 requests and what you changed because of them
- Named protocols interested in the ZK credit proof
