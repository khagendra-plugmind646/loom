/** 32-byte big-endian encoding of field elements and hashes (kept apart from zk.ts so it doesn't pull in Poseidon). */
export function toBytes32(v: bigint): Uint8Array {
  const hex = v.toString(16).padStart(64, "0");
  if (hex.length > 64) throw new Error("value exceeds 32 bytes");
  return Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16)));
}

export function fromBytes32(b: Uint8Array | number[]): bigint {
  return BigInt("0x" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("") || "0");
}
