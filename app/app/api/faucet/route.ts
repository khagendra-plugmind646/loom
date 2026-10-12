import { PublicKey } from "@solana/web3.js";
import { FAUCET_AMOUNT, claim, faucetEnabled } from "@/lib/faucet-server";

/** Whether the devnet test-token faucet is available, and how much it sends. */
export async function GET() {
  return Response.json({ enabled: faucetEnabled(), amount: FAUCET_AMOUNT.toString() });
}

/** Sends test USDC and USDT to a devnet wallet. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { wallet?: string } | null;
  let wallet: PublicKey;
  try {
    wallet = new PublicKey(body?.wallet ?? "");
  } catch {
    return Response.json({ error: "Invalid wallet address" }, { status: 400 });
  }
  const result = await claim(wallet);
  return result.ok ? Response.json(result) : Response.json({ error: result.error }, { status: result.status });
}
