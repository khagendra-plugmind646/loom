"use client";

import type { Groth16Prover } from "@loom/sdk";

declare global {
  interface Window {
    snarkjs?: { groth16: Groth16Prover & { verify: (vk: object, signals: string[], proof: object) => Promise<boolean> } };
  }
}

export const ZK_WASM = "/zk/repayment_certificate.wasm";
export const ZK_ZKEY = "/zk/repayment_certificate.zkey";
export const ZK_VKEY = "/zk/verification_key.json";

let loading: Promise<NonNullable<Window["snarkjs"]>> | null = null;

/** Loads the snarkjs browser bundle from /zk (kept out of the JS bundle, ~1MB). */
export function loadSnarkjs(): Promise<NonNullable<Window["snarkjs"]>> {
  if (window.snarkjs) return Promise.resolve(window.snarkjs);
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "/zk/snarkjs.min.js";
    s.async = true;
    s.onload = () => (window.snarkjs ? resolve(window.snarkjs) : reject(new Error("snarkjs failed to load")));
    s.onerror = () => reject(new Error("snarkjs failed to load"));
    document.head.appendChild(s);
  });
  return loading;
}
