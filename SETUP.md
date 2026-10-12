# Running Loomzk on a new machine

This guide gets the project running from the zip: tests first, then the full app on a local Solana network.
For what the project is and how it works, see [README.md](README.md).

Works on **macOS** and **Linux**. On **Windows**, use **WSL2 (Ubuntu)** and run every command inside WSL.

---

## 1. Install the tools (one time)

| Tool | Needed for | Install |
|---|---|---|
| Node.js 22+ | everything | https://nodejs.org (or `nvm install 22`) |
| pnpm 11 | everything | `corepack enable` (comes with Node) |
| Solana CLI | local validator, devnet | `sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"` |
| Rust + Anchor 0.32.1 | *only* to rebuild the smart contract | see step 5 |
| circom 2.2 | *only* to rebuild the ZK circuit | see step 5 |

After installing the Solana CLI, add it to your PATH (the installer prints the exact line). For zsh, for example:

```bash
echo 'export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

The zip already contains the compiled program (`target/deploy/loom.so`) and the ZK proving files, so **you do not need Rust, Anchor or circom just to run it.**

---

## 2. Install and check

```bash
unzip loom-full-code.zip
cd LOOM
corepack enable          # makes the right pnpm version available
pnpm install
pnpm prereqs             # checks that everything needed is installed
```

## 3. Run the tests (about 1 minute, no network needed)

```bash
pnpm test                # expect: 281 passing
```

These tests run the real compiled program, including real zero-knowledge proofs.

## 4. Run the full app on a local Solana network

You need **two terminals**, both in the `LOOM` folder.

**Terminal 1: start the local blockchain (leave it running)**
```bash
pnpm localnet
```
Wait until it prints slot numbers. This loads the Loomzk program and copies the live SOL/USD price from Pyth (devnet).

**Terminal 2: set up the protocol, fund your wallet, start the website**
```bash
pnpm bootstrap                                  # creates test USDC/USDT, initializes Loomzk, fills the lending vaults
pnpm faucet --to <YOUR_PHANTOM_ADDRESS>         # gives you 20 SOL + 5,000 test USDC + 5,000 test USDT
pnpm dev                                        # opens the website
```
Open the URL it prints (usually **http://localhost:3000**; if that port is busy it uses 3001).

**Connect Phantom to the local network:** Phantom → Settings → Developer Settings → turn on **Testnet Mode** → choose **Solana Localnet**.

Then try it:
1. **Borrow**: enter an amount, download the private note, then click *Lock SOL & receive USDC*.
2. **My loans**: click *Pay in full* to repay (principal + 12%); your SOL comes back.
3. **ZK certificate**: paste the note, then *Generate ZK proof* → *Mint certificate*.
4. **Transparency**: see every vault, escrow and loan read live from the chain.
5. **Wallet**: send and receive SOL / USDC / USDT.

Optional: `pnpm demo` runs that whole journey automatically from the terminal.

> The local price is a snapshot and stays valid for about 1 hour. When borrowing starts failing with a "stale price" error, stop terminal 1 (Ctrl+C), run `pnpm localnet` again, then run `pnpm bootstrap` again (restarting resets the local chain).

---

## 5. (Optional) Rebuild the smart contract or ZK circuit

Only needed if you change the Rust or circom code.

```bash
# Rust + Solana build tools
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
cargo install --git https://github.com/solana-foundation/anchor --tag v0.32.1 avm --locked
avm install 0.32.1 && avm use 0.32.1

pnpm build:program       # anchor build + copy the IDL into the SDK
pnpm test

# ZK circuit (only if you edit zk/circuits/*.circom)
cargo install --git https://github.com/iden3/circom.git --tag v2.2.2 circom --locked
pnpm zk:build            # new proving + verifying keys
pnpm build:program       # REQUIRED afterwards: the program embeds the verifying key
```

## 6. (Optional) Deploy your own copy to devnet

The program's deploy key is not in the zip, so give the program **your own address** first:

```bash
solana-keygen new                          # your wallet (skip if you already have ~/.config/solana/id.json)
solana config set --url devnet
# Get ~5 devnet SOL at https://faucet.solana.com for the address from: solana address

anchor build                               # first build creates target/deploy/loom-keypair.json (your program address)
anchor keys sync                           # writes that program id into lib.rs and Anchor.toml
pnpm build:program                         # rebuild with the new id + refresh the SDK
anchor deploy --provider.cluster devnet
pnpm bootstrap --cluster devnet --admin ~/.config/solana/id.json
pnpm dev
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `solana: command not found` | Add the Solana CLI to your PATH (step 1) and open a new terminal |
| `pnpm` asks to approve build scripts | Already configured in `pnpm-workspace.yaml`; run `pnpm install` again |
| `pnpm localnet` says the port is in use | Another validator is running: stop it, or `pkill solana-test-validator` |
| Borrow fails with *Oracle price is stale* | Restart `pnpm localnet`, then run `pnpm bootstrap` again |
| Phantom shows 0 balance | Phantom must be on **Solana Localnet**, and you must have run `pnpm faucet --to <address>` |
| `airdrop request failed` on devnet | The public faucet is rate-limited; use https://faucet.solana.com |
| Website on 3001 instead of 3000 | Normal when port 3000 is busy; use the URL `pnpm dev` prints |
