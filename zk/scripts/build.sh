#!/usr/bin/env bash
# Builds the Loom repayment-certificate circuit end to end:
#   circom -> r1cs/wasm -> Groth16 setup (phase-2 on top of PSE perpetual powers of tau)
#   -> verification key -> Rust verifying key for the on-chain program
#   -> wasm + zkey copied into the Next.js app for in-browser proving.
#
# NOTE: the phase-2 contribution here uses local entropy and is fine for devnet.
# For mainnet run a multi-party phase-2 ceremony (snarkjs zkey contribute by several
# independent parties + a random beacon) and publish the transcript.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ZK="$ROOT/zk"
OUT="$ZK/build"
NAME="repayment_certificate"
PTAU="$ZK/ptau/pot15.ptau"
SNARKJS="$ROOT/node_modules/.bin/snarkjs"

if [ ! -f "$PTAU" ]; then
  echo "Downloading PSE perpetual powers of tau (2^15)…"
  mkdir -p "$ZK/ptau"
  curl -sSfL -o "$PTAU" https://pse-trusted-setup-ppot.s3.eu-central-1.amazonaws.com/pot28_0080/ppot_0080_15.ptau
fi

mkdir -p "$OUT"
echo "▶ compiling circuit"
circom "$ZK/circuits/$NAME.circom" --r1cs --wasm --sym -o "$OUT"
"$SNARKJS" r1cs info "$OUT/$NAME.r1cs"

echo "▶ groth16 setup"
"$SNARKJS" groth16 setup "$OUT/$NAME.r1cs" "$PTAU" "$OUT/${NAME}_0000.zkey"
ENTROPY="$(head -c 64 /dev/urandom | od -An -tx1 | tr -d ' \n')"
"$SNARKJS" zkey contribute "$OUT/${NAME}_0000.zkey" "$OUT/$NAME.zkey" --name="loom-dev-1" -e="$ENTROPY"
rm -f "$OUT/${NAME}_0000.zkey"
"$SNARKJS" zkey export verificationkey "$OUT/$NAME.zkey" "$OUT/verification_key.json"

echo "▶ generating Rust verifying key"
node "$ZK/scripts/vk-to-rust.mjs" "$OUT/verification_key.json" "$ROOT/programs/loom/src/zk/verifying_key.rs"

echo "▶ publishing proving artifacts to the app"
mkdir -p "$ROOT/app/public/zk"
cp "$OUT/${NAME}_js/$NAME.wasm" "$ROOT/app/public/zk/$NAME.wasm"
cp "$OUT/$NAME.zkey" "$ROOT/app/public/zk/$NAME.zkey"
cp "$OUT/verification_key.json" "$ROOT/app/public/zk/verification_key.json"
echo "✔ done"
