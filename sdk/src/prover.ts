// Node entry point: binds the SDK prover to the snarkjs npm package.
// Browsers should load snarkjs as a static script and call `proveRepaymentCertificate(params, window.snarkjs.groth16)`.
// @ts-expect-error snarkjs ships without type declarations
import * as snarkjs from "snarkjs";
import { proveRepaymentCertificate as prove, type SnarkjsProof } from "./zk";

export const groth16 = snarkjs.groth16;

export const proveRepaymentCertificate = (params: Parameters<typeof prove>[0]) => prove(params, snarkjs.groth16);

export const verifyCertificateProof = (vkey: object, publicSignals: string[], proof: SnarkjsProof): Promise<boolean> =>
  snarkjs.groth16.verify(vkey, publicSignals, proof);
