#!/usr/bin/env bash
# Local Solana validator with the Loom program preloaded and the live SOL/USD
# oracle accounts cloned from devnet: Pyth (real, Wormhole-verified price data) and Chainlink.
#
# The cloned price is a snapshot taken at startup, so bootstrap sets
# max_price_age = 1h on localnet. Restart the validator to refresh the price.
# Extra flags are passed through, e.g. `pnpm localnet --rpc-port 8999`.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# The program id comes from the IDL (= declare_id! in lib.rs), so no keypair is needed to run locally.
PROGRAM_ID="$(node -e "console.log(require('$ROOT/target/idl/loom.json').address)")"
SO="$ROOT/target/deploy/loom.so"
[ -f "$SO" ] || { echo "missing $SO — run: pnpm build:program"; exit 1; }

mkdir -p "$ROOT/.anchor"
echo "Loom program $PROGRAM_ID"
exec solana-test-validator \
  --reset \
  --ledger "$ROOT/.anchor/test-ledger" \
  --bpf-program "$PROGRAM_ID" "$SO" \
  --url devnet \
  --clone 7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE \
  --clone 99B2bTijsU6f1GCT73HmdR7HCFFjGMBcPZY6jZ96ynrR \
  "$@"
