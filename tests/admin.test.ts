import { expect } from "chai";
import { Keypair } from "@solana/web3.js";
import { CreditMerkleTree } from "@loom/sdk";
import { DEFAULT_PARAMS, USD, createWorld, expectError, type World } from "./fixtures";

describe("admin: initialize", () => {
  let w: World;
  beforeEach(async () => {
    w = await createWorld({ initialize: false });
  });

  const init = (overrides: Partial<typeof DEFAULT_PARAMS> = {}, signer?: Keypair) =>
    w.client.initialize((signer ?? w.admin).publicKey, { treasury: w.treasury.publicKey, ...DEFAULT_PARAMS, ...overrides });

  it("stores every parameter, zeroed stats, and an empty credit tree", async () => {
    w.h.send([await init()], [w.admin]);
    const cfg = w.h.config();
    expect(cfg.admin.equals(w.admin.publicKey)).to.be.true;
    expect(cfg.treasury.equals(w.treasury.publicKey)).to.be.true;
    expect(cfg.liquidationThresholdBps).to.equal(DEFAULT_PARAMS.liquidationThresholdBps);
    expect(cfg.liquidationPenaltyBps).to.equal(DEFAULT_PARAMS.liquidationPenaltyBps);
    expect(cfg.maxPriceAgeSecs).to.equal(DEFAULT_PARAMS.maxPriceAgeSecs);
    expect(cfg.maxConfidenceBps).to.equal(DEFAULT_PARAMS.maxConfidenceBps);
    expect(cfg.minPrincipal).to.equal(DEFAULT_PARAMS.minPrincipal);
    expect(cfg.maxPrincipal).to.equal(DEFAULT_PARAMS.maxPrincipal);
    expect(cfg.paused).to.be.false;
    expect(cfg.nextLoanId).to.equal(0n);
    expect(Object.values(cfg.stats).every((v) => v === 0n)).to.be.true;
    expect(w.h.creditTree()).to.deep.equal({ root: new CreditMerkleTree().root, nextIndex: 0n });
  });

  it("anyone can be the initializing admin, but only once", async () => {
    w.h.send([await init({}, w.keeper)], [w.keeper]);
    expect(w.h.config().admin.equals(w.keeper.publicKey)).to.be.true;
    expect(w.h.sendExpectFail([await init()], [w.admin])).to.match(/already in use/);
  });

  // Each row is a parameter set the program must refuse at initialization.
  const invalid: [string, Partial<typeof DEFAULT_PARAMS>][] = [
    ["threshold at 100%", { liquidationThresholdBps: 10_000 }],
    ["threshold below 100%", { liquidationThresholdBps: 9_000 }],
    ["threshold at the 200% origination ratio", { liquidationThresholdBps: 20_000 }],
    ["threshold above 200%", { liquidationThresholdBps: 25_000 }],
    ["penalty above 20%", { liquidationPenaltyBps: 2_001 }],
    ["zero price age", { maxPriceAgeSecs: 0 }],
    ["price age above an hour", { maxPriceAgeSecs: 3_601 }],
    ["zero confidence", { maxConfidenceBps: 0 }],
    ["confidence above 10%", { maxConfidenceBps: 1_001 }],
    ["zero min principal", { minPrincipal: 0n }],
    ["min principal above max", { minPrincipal: USD(100), maxPrincipal: USD(99) }],
  ];
  for (const [name, overrides] of invalid) {
    it(`rejects ${name}`, async () => {
      expectError(w.h.sendExpectFail([await init(overrides)], [w.admin]), "InvalidParameter");
      expect(w.h.svm.getAccount(w.client.pda.config())).to.equal(null);
    });
  }

  it("accepts every boundary value", async () => {
    w.h.send(
      [
        await init({
          liquidationThresholdBps: 10_001,
          liquidationPenaltyBps: 2_000,
          maxPriceAgeSecs: 3_600,
          maxConfidenceBps: 1_000,
          minPrincipal: USD(5),
          maxPrincipal: USD(5),
        }),
      ],
      [w.admin],
    );
    expect(w.h.config().liquidationThresholdBps).to.equal(10_001);
  });

  it("the upper boundary of the threshold is 19,999 bps", async () => {
    w.h.send([await init({ liquidationThresholdBps: 19_999 })], [w.admin]);
    expect(w.h.config().liquidationThresholdBps).to.equal(19_999);
  });
});

describe("admin: update_config", () => {
  let w: World;
  beforeEach(async () => {
    w = await createWorld({ reserves: false });
  });

  it("updates each field independently, leaving the others untouched", async () => {
    const before = w.h.config();
    const updates = [
      { liquidationThresholdBps: 15_000 },
      { liquidationPenaltyBps: 1_000 },
      { maxPriceAgeSecs: 60 },
      { maxConfidenceBps: 100 },
      { minPrincipal: USD(20) },
      { maxPrincipal: USD(1_000) },
      { paused: true },
    ];
    let expected = { ...before } as Record<string, unknown>;
    for (const u of updates) {
      w.h.send([await w.client.updateConfig(w.admin.publicKey, u)], [w.admin]);
      expected = { ...expected, ...u };
      const { stats: _s, ...cfg } = w.h.config();
      const { stats: _e, ...exp } = expected;
      expect(cfg).to.deep.equal(exp);
    }
  });

  it("an empty update changes nothing", async () => {
    const before = w.h.config();
    w.h.send([await w.client.updateConfig(w.admin.publicKey, {})], [w.admin]);
    expect(w.h.config()).to.deep.equal(before);
  });

  it("only the admin can update", async () => {
    w.fails([await w.client.updateConfig(w.keeper.publicKey, { paused: true })], [w.keeper], "ConstraintHasOne");
    w.fails([await w.client.updateConfig(w.treasury.publicKey, { paused: true })], [w.treasury], "ConstraintHasOne");
    expect(w.h.config().paused).to.be.false;
  });

  it("hands over admin rights: the new admin can act, the old one can't", async () => {
    const next = w.h.wallet(1);
    w.h.send([await w.client.updateConfig(w.admin.publicKey, { newAdmin: next.publicKey })], [w.admin]);
    expect(w.h.config().admin.equals(next.publicKey)).to.be.true;
    w.fails([await w.client.updateConfig(w.admin.publicKey, { paused: true })], [w.admin], "ConstraintHasOne");
    w.h.send([await w.client.updateConfig(next.publicKey, { paused: true })], [next]);
    expect(w.h.config().paused).to.be.true;
  });

  it("changes the treasury", async () => {
    const t = Keypair.generate().publicKey;
    w.h.send([await w.client.updateConfig(w.admin.publicKey, { treasury: t })], [w.admin]);
    expect(w.h.config().treasury.equals(t)).to.be.true;
  });

  it("validates the resulting config: an invalid update is rejected atomically", async () => {
    const before = w.h.config();
    w.fails(
      [await w.client.updateConfig(w.admin.publicKey, { paused: true, liquidationThresholdBps: 20_000 })],
      [w.admin],
      "InvalidParameter",
    );
    w.fails([await w.client.updateConfig(w.admin.publicKey, { minPrincipal: USD(600_000) })], [w.admin], "InvalidParameter");
    w.fails([await w.client.updateConfig(w.admin.publicKey, { maxPrincipal: USD(1) })], [w.admin], "InvalidParameter");
    w.fails([await w.client.updateConfig(w.admin.publicKey, { maxPriceAgeSecs: 0 })], [w.admin], "InvalidParameter");
    w.fails([await w.client.updateConfig(w.admin.publicKey, { maxConfidenceBps: 1_001 })], [w.admin], "InvalidParameter");
    w.fails([await w.client.updateConfig(w.admin.publicKey, { liquidationPenaltyBps: 2_001 })], [w.admin], "InvalidParameter");
    expect(w.h.config()).to.deep.equal(before);
  });

  it("pauses and unpauses", async () => {
    w.h.send([await w.client.updateConfig(w.admin.publicKey, { paused: true })], [w.admin]);
    expect(w.h.config().paused).to.be.true;
    w.h.send([await w.client.updateConfig(w.admin.publicKey, { paused: false })], [w.admin]);
    expect(w.h.config().paused).to.be.false;
  });
});
