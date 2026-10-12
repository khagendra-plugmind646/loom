#!/usr/bin/env bash
# Checks that the tools needed to run Loom are installed.
ok=0
check() { # name, command, required-for
  if command -v "$2" >/dev/null 2>&1; then printf "  ✔ %-10s %s\n" "$1" "$($2 --version 2>&1 | head -1)";
  else printf "  ✘ %-10s missing — needed for: %s\n" "$1" "$3"; ok=1; fi
}
echo "Loom prerequisites"
check node node "everything (need v22+)"
check pnpm pnpm "everything (need v11: corepack enable)"
check solana solana "local validator, devnet deploy"
check solana-test-validator solana-test-validator "pnpm localnet"
check anchor anchor "only to rebuild the program (anchor build)"
check cargo cargo "only to rebuild the program"
check circom circom "only to rebuild the ZK circuit"
node -e 'process.exit(+process.versions.node.split(".")[0] >= 22 ? 0 : 1)' 2>/dev/null || { echo "  ✘ Node 22+ required"; ok=1; }
[ -f target/deploy/loom.so ] && echo "  ✔ prebuilt program target/deploy/loom.so" || { echo "  ✘ target/deploy/loom.so missing (run pnpm build:program)"; ok=1; }
exit $ok
