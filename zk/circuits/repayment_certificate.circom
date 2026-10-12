pragma circom 2.1.9;

// Loom — ZK Repayment Certificate
// ---------------------------------
// When a loan is repaid in full (principal + interest for the time it was open) before
// its deadline, the on-chain program appends a "credit leaf" to a Poseidon Merkle tree.
// Only full, on-time repayments ever create a leaf, so owning one proves both:
//
//     identity = Poseidon(secret, nullifier)                 (chosen by borrower at loan open)
//     leaf     = Poseidon(identity, principal, totalRepaid, startTs, closedTs)
//
// This circuit lets the borrower prove — from any fresh wallet, without revealing
// which loan or which borrower wallet — that:
//
//   1. they own a leaf in the on-chain credit tree (root is public, checked on-chain),
//   2. totalRepaid >= principal              (sanity check; interest depends on time borrowed),
//   3. closedTs - startTs <= 365 days        (repaid inside the 12-month term),
//   4. principal >= minPrincipal             (public claim, e.g. "borrowed >= $1,000"),
//   5. the certificate is bound to `recipient` (prevents proof front-running),
//   6. nullifierHash = Poseidon(nullifier)    (one certificate per loan).

include "../../node_modules/circomlib/circuits/poseidon.circom";
include "../../node_modules/circomlib/circuits/comparators.circom";
include "../../node_modules/circomlib/circuits/bitify.circom";

template MerkleInclusion(levels) {
    signal input leaf;
    signal input pathElements[levels];
    signal input pathIndices[levels];
    signal output root;

    component hashers[levels];
    signal cur[levels + 1];
    signal left[levels];
    signal right[levels];
    cur[0] <== leaf;

    for (var i = 0; i < levels; i++) {
        // pathIndices[i] must be a bit: 0 => current node is the left child.
        pathIndices[i] * (1 - pathIndices[i]) === 0;

        left[i]  <== cur[i] + pathIndices[i] * (pathElements[i] - cur[i]);
        right[i] <== pathElements[i] + pathIndices[i] * (cur[i] - pathElements[i]);

        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== left[i];
        hashers[i].inputs[1] <== right[i];
        cur[i + 1] <== hashers[i].out;
    }

    root <== cur[levels];
}

template RepaymentCertificate(levels) {
    // ---- public inputs (order matters: it is the on-chain public-input order) ----
    signal input root;
    signal input nullifierHash;
    signal input minPrincipal;
    signal input recipientHi;
    signal input recipientLo;

    // ---- private inputs ----
    signal input secret;
    signal input nullifier;
    signal input principal;
    signal input totalRepaid;
    signal input startTs;
    signal input closedTs;
    signal input pathElements[levels];
    signal input pathIndices[levels];

    // Range checks: every amount / timestamp is an on-chain u64.
    component rPrincipal = Num2Bits(64);   rPrincipal.in <== principal;
    component rRepaid    = Num2Bits(64);   rRepaid.in <== totalRepaid;
    component rStart     = Num2Bits(64);   rStart.in <== startTs;
    component rClosed    = Num2Bits(64);   rClosed.in <== closedTs;
    component rMin       = Num2Bits(64);   rMin.in <== minPrincipal;
    component rHi        = Num2Bits(128);  rHi.in <== recipientHi;
    component rLo        = Num2Bits(128);  rLo.in <== recipientLo;

    // identity commitment
    component idHash = Poseidon(2);
    idHash.inputs[0] <== secret;
    idHash.inputs[1] <== nullifier;

    // nullifier hash
    component nHash = Poseidon(1);
    nHash.inputs[0] <== nullifier;
    nHash.out === nullifierHash;

    // credit leaf (must match programs/loom/src/merkle.rs::credit_leaf)
    component leafHash = Poseidon(5);
    leafHash.inputs[0] <== idHash.out;
    leafHash.inputs[1] <== principal;
    leafHash.inputs[2] <== totalRepaid;
    leafHash.inputs[3] <== startTs;
    leafHash.inputs[4] <== closedTs;

    component tree = MerkleInclusion(levels);
    tree.leaf <== leafHash.out;
    for (var i = 0; i < levels; i++) {
        tree.pathElements[i] <== pathElements[i];
        tree.pathIndices[i] <== pathIndices[i];
    }
    tree.root === root;

    // Statement 1: totalRepaid >= principal. Interest is charged for the time the loan was
    // open, so the exact amount varies; the program only inserts leaves for full repayments.
    component fullRepay = GreaterEqThan(64);
    fullRepay.in[0] <== totalRepaid;
    fullRepay.in[1] <== principal;
    fullRepay.out === 1;

    // Statement 2: closedTs >= startTs and closedTs - startTs <= 365 days
    component ordered = GreaterEqThan(64);
    ordered.in[0] <== closedTs;
    ordered.in[1] <== startTs;
    ordered.out === 1;

    component onTime = LessEqThan(64);
    onTime.in[0] <== closedTs - startTs;
    onTime.in[1] <== 31536000;
    onTime.out === 1;

    // Statement 3: principal >= minPrincipal
    component bigEnough = GreaterEqThan(64);
    bigEnough.in[0] <== principal;
    bigEnough.in[1] <== minPrincipal;
    bigEnough.out === 1;

    // Bind the proof to the recipient wallet (non-linear constraint so it is not optimised away).
    signal recipientHiSq;
    signal recipientLoSq;
    recipientHiSq <== recipientHi * recipientHi;
    recipientLoSq <== recipientLo * recipientLo;
}

component main { public [root, nullifierHash, minPrincipal, recipientHi, recipientLo] } = RepaymentCertificate(20);
