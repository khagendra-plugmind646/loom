import "server-only";
import { createPublicKey, verify } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { adminAuthMessage } from "./admin";

const AUTH_WINDOW_MS = 5 * 60 * 1000;
// DER prefix that turns a raw 32-byte ed25519 public key into an SPKI key Node can verify with.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/**
 * True when the request carries a fresh signature of `adminAuthMessage(signedAt)` by the admin
 * wallet set in LOOM_ADMIN_WALLET (server-only env; never sent to browsers).
 */
export function isAdminRequest(req: Request): boolean {
  const admin = process.env.LOOM_ADMIN_WALLET;
  const wallet = req.headers.get("x-loom-wallet");
  const signedAt = Number(req.headers.get("x-loom-signed-at"));
  const signature = req.headers.get("x-loom-signature");
  if (!admin || !wallet || !signature || wallet !== admin) return false;
  if (!Number.isFinite(signedAt) || Math.abs(Date.now() - signedAt) > AUTH_WINDOW_MS) return false;
  try {
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, new PublicKey(wallet).toBuffer()]), format: "der", type: "spki" });
    return verify(null, Buffer.from(adminAuthMessage(signedAt)), key, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}
