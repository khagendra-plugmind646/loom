import { expect } from "chai";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  CHAINLINK_SOL_USD_FEED,
  CHAINLINK_STORE_PROGRAM_ID,
  LOAN_TERM_SECS,
  PYTH_RECEIVER_PROGRAM_ID,
  SOL_USD_PRICE_ACCOUNT,
  combinePrices,
  encodeChainlinkFeed,
  encodePriceUpdateV2,
  parseChainlinkFeed,
  parsePriceUpdateV2,
  requiredCollateralLamports,
  stableToLamports,
  totalDue,
} from "@loom/sdk";
import { PRICE, SOL, USD, createWorld, type World } from "./fixtures";

// Byte offsets inside a fully verified PriceUpdateV2 account.
const PYTH = { tag: 40, price: 73, conf: 81, expo: 89, publishTime: 93 };
// Byte offsets inside a Chainlink Transmissions account.
const CL = { decimals: 138, latestRound: 143, liveLength: 148, timestamp: 208, answer: 216 };

describe("oracle: Pyth PriceUpdateV2 validation", () => {
  let w: World;
  beforeEach(async () => {
    w = await createWorld();
  });

  const pythBytes = (o: { price?: bigint; conf?: bigint; expo?: number; ageSecs?: number } = {}) =>
    encodePriceUpdateV2({
      price: o.price ?? PRICE(150),
      conf: o.conf ?? PRICE(0.05),
      expo: o.expo ?? -8,
      publishTime: Number(w.h.now()) - (o.ageSecs ?? 0),
    });

  const writePyth = (data: Uint8Array, owner: PublicKey = PYTH_RECEIVER_PROGRAM_ID) =>
    w.h.svm.setAccount(SOL_USD_PRICE_ACCOUNT, { owner, lamports: 1_000_000_000, data, executable: false });

  /** Opens a generously collateralized loan against whatever oracle accounts are currently set. */
  const open = async () => {
    const { ix, address } = w.openLoanIx({ principal: USD(100), collateral: SOL(10), keepPrices: true });
    return { ix: await ix, address };
  };
  const openFails = async (code: string) => w.fails([(await open()).ix], [w.borrower], code);
  const openWorks = async () => {
    const { ix, address } = await open();
    w.h.send([ix], [w.borrower]);
    return w.h.loan(address);
  };

  it("rejects an account not owned by the Pyth receiver", async () => {
    writePyth(pythBytes(), Keypair.generate().publicKey);
    await openFails("InvalidOracle");
  });

  it("rejects a wrong discriminator", async () => {
    const d = pythBytes();
    d[0] ^= 0xff;
    writePyth(d);
    await openFails("InvalidOracle");
  });

  it("rejects truncated data", async () => {
    writePyth(pythBytes().subarray(0, 40));
    await openFails("InvalidOracle");
    writePyth(pythBytes().subarray(0, 100));
    await openFails("InvalidOracle");
  });

  it("rejects partially verified updates and unknown verification tags", async () => {
    w.h.setPrice(150, { fullyVerified: false });
    await openFails("OracleNotFullyVerified");
    const d = pythBytes();
    d[PYTH.tag] = 2;
    writePyth(d);
    await openFails("InvalidOracle");
  });

  it("rejects a feed other than SOL/USD", async () => {
    w.h.setPrice(150, { feedIdHex: "11".repeat(32) });
    await openFails("WrongPriceFeed");
  });

  it("rejects zero and negative prices", async () => {
    writePyth(pythBytes({ price: 0n, conf: 0n }));
    await openFails("InvalidPrice");
    writePyth(pythBytes({ price: -PRICE(150), conf: 0n }));
    await openFails("InvalidPrice");
  });

  it("rejects exponents outside -18..=0", async () => {
    writePyth(pythBytes({ expo: 1 }));
    await openFails("InvalidPrice");
    writePyth(pythBytes({ expo: -19 }));
    await openFails("InvalidPrice");
  });

  it("accepts a price exactly max_price_age old, rejects one second older", async () => {
    const max = w.params.maxPriceAgeSecs;
    writePyth(pythBytes({ ageSecs: max }));
    expect((await openWorks()).status).to.equal("active");
    writePyth(pythBytes({ ageSecs: max + 1 }));
    await openFails("StalePrice");
  });

  it("accepts confidence exactly at max_confidence_bps, rejects one unit wider", async () => {
    // max 200 bps of $150 = $3
    const atMax = (PRICE(150) * BigInt(w.params.maxConfidenceBps)) / 10_000n;
    writePyth(pythBytes({ conf: atMax }));
    const loan = await openWorks();
    expect(loan.status).to.equal("active");
    writePyth(pythBytes({ conf: atMax + 1n }));
    await openFails("PriceTooUncertain");
  });

  it("works with other exponents (e.g. -6), recording them on the loan", async () => {
    writePyth(pythBytes({ price: 150_000_000n, conf: 50_000n, expo: -6 }));
    w.h.setChainlinkPrice(150);
    const loan = await openWorks();
    expect(loan.openPrice).to.equal(150_000_000n);
    expect(loan.openPriceExpo).to.equal(-6);
  });

  it("the admin's oracle limits apply immediately", async () => {
    writePyth(pythBytes({ ageSecs: 60 }));
    w.h.setChainlinkPrice(150);
    w.h.send([await w.client.updateConfig(w.admin.publicKey, { maxPriceAgeSecs: 30 })], [w.admin]);
    await openFails("StalePrice");
    w.h.send([await w.client.updateConfig(w.admin.publicKey, { maxPriceAgeSecs: 90 })], [w.admin]);
    expect((await openWorks()).status).to.equal("active");
  });

  it("the SDK parser reads the bytes the program reads", () => {
    const p = parsePriceUpdateV2(pythBytes({ price: 123_45678901n, conf: 7n, expo: -8, ageSecs: 3 }));
    expect(p).to.deep.include({ price: 123_45678901n, conf: 7n, expo: -8, publishTime: Number(w.h.now()) - 3, fullyVerified: true });
  });
});

describe("oracle: Chainlink feed validation", () => {
  let w: World;
  beforeEach(async () => {
    w = await createWorld();
    w.h.setPrice(150);
  });

  const clBytes = (o: { usd?: number; decimals?: number; ageSecs?: number } = {}) => {
    const decimals = o.decimals ?? 8;
    return encodeChainlinkFeed({
      price: BigInt(Math.round((o.usd ?? 150) * 10 ** decimals)),
      decimals,
      timestamp: Number(w.h.now()) - (o.ageSecs ?? 0),
    });
  };
  const writeCl = (data: Uint8Array, owner: PublicKey = CHAINLINK_STORE_PROGRAM_ID) =>
    w.h.svm.setAccount(CHAINLINK_SOL_USD_FEED, { owner, lamports: 1_000_000_000, data, executable: false });
  const open = async () => {
    const { ix, address } = w.openLoanIx({ principal: USD(100), collateral: SOL(10), keepPrices: true });
    return { ix: await ix, address };
  };
  const openFails = async (code: string) => w.fails([(await open()).ix], [w.borrower], code);
  const openWorks = async () => {
    const { ix, address } = await open();
    w.h.send([ix], [w.borrower]);
    return w.h.loan(address);
  };

  it("rejects an account not owned by the Chainlink store", async () => {
    writeCl(clBytes(), Keypair.generate().publicKey);
    await openFails("InvalidChainlinkFeed");
  });

  it("rejects a wrong discriminator and truncated data", async () => {
    const d = clBytes();
    d[0] ^= 0xff;
    writeCl(d);
    await openFails("InvalidChainlinkFeed");
    writeCl(clBytes().subarray(0, 247));
    await openFails("InvalidChainlinkFeed");
  });

  it("rejects a feed whose live length isn't 1", async () => {
    const d = clBytes();
    new DataView(d.buffer).setUint32(CL.liveLength, 2, true);
    writeCl(d);
    await openFails("InvalidChainlinkFeed");
  });

  it("rejects a feed with no rounds yet", async () => {
    const d = clBytes();
    new DataView(d.buffer).setUint32(CL.latestRound, 0, true);
    writeCl(d);
    await openFails("InvalidPrice");
  });

  it("rejects more than 18 decimals", async () => {
    const d = clBytes();
    d[CL.decimals] = 19;
    writeCl(d);
    await openFails("InvalidPrice");
  });

  it("rejects zero and negative answers", async () => {
    writeCl(encodeChainlinkFeed({ price: 0n, timestamp: Number(w.h.now()) }));
    await openFails("InvalidPrice");
    writeCl(encodeChainlinkFeed({ price: -1n, timestamp: Number(w.h.now()) }));
    await openFails("InvalidPrice");
  });

  it("rejects an answer too large for u64", async () => {
    writeCl(encodeChainlinkFeed({ price: 1n << 70n, timestamp: Number(w.h.now()) }));
    await openFails("InvalidPrice");
  });

  it("accepts a price exactly max_price_age old, rejects one second older", async () => {
    writeCl(clBytes({ ageSecs: w.params.maxPriceAgeSecs }));
    expect((await openWorks()).status).to.equal("active");
    writeCl(clBytes({ ageSecs: w.params.maxPriceAgeSecs + 1 }));
    await openFails("StaleChainlinkPrice");
  });

  it("rescales other decimal counts to Pyth's exponent", async () => {
    for (const decimals of [6, 10, 12]) {
      w.h.setPrice(200); // Pyth above, so Chainlink sets the opening price
      writeCl(clBytes({ usd: 150, decimals }));
      expect((await openWorks()).openPrice, `${decimals} decimals`).to.equal(PRICE(150));
    }
  });

  it("at 18 decimals, answers above u64::MAX (~$18.4) are refused", async () => {
    w.h.setPrice(10);
    writeCl(clBytes({ usd: 10, decimals: 18 }));
    const { ix, address } = w.openLoanIx({ principal: USD(100), collateral: SOL(100), keepPrices: true });
    w.h.send([await ix], [w.borrower]);
    expect(w.h.loan(address).openPrice).to.equal(PRICE(10));
    w.h.setPrice(150);
    writeCl(encodeChainlinkFeed({ price: 150n * 10n ** 18n, decimals: 18, timestamp: Number(w.h.now()) }));
    await openFails("InvalidPrice");
  });

  it("the SDK parser reads the bytes the program reads", () => {
    const bytes = clBytes({ usd: 109.5963609, decimals: 8, ageSecs: 7 });
    expect(parseChainlinkFeed(bytes)).to.deep.equal({
      description: "SOL / USD",
      roundId: 1,
      price: 10_959_636_090n,
      expo: -8,
      timestamp: Number(w.h.now()) - 7,
    });
    expect(new DataView(bytes.buffer).getUint32(CL.timestamp, true)).to.equal(Number(w.h.now()) - 7);
    expect(new DataView(bytes.buffer).getBigUint64(CL.answer, true)).to.equal(10_959_636_090n);
  });
});

describe("oracle: combining Pyth and Chainlink", () => {
  let w: World;
  beforeEach(async () => {
    w = await createWorld();
  });

  it("opening values collateral at the lower of Pyth (minus confidence) and Chainlink", async () => {
    // Chainlink lower
    const atPyth = requiredCollateralLamports(USD(1_000), PRICE(150), PRICE(0.05), -8);
    const { ix } = w.openLoanIx({ principal: USD(1_000), priceUsd: 150, chainlinkUsd: 140, collateral: atPyth });
    w.fails([await ix], [w.borrower], "InsufficientCollateral");
    const atChainlink = requiredCollateralLamports(USD(1_000), PRICE(140), 0n, -8);
    expect((await w.openLoan({ principal: USD(1_000), priceUsd: 150, chainlinkUsd: 140, collateral: atChainlink })).status).to.equal("active");

    // Pyth's conservative price lower: Chainlink at $150, Pyth $150 +/- $1
    const atPythConservative = requiredCollateralLamports(USD(1_000), PRICE(150), PRICE(1), -8);
    const tight = w.openLoanIx({ principal: USD(1_000), priceUsd: 150, confUsd: 1, chainlinkUsd: 150, collateral: atPythConservative - 1n });
    w.fails([await tight.ix], [w.borrower], "InsufficientCollateral");
    expect((await w.openLoan({ principal: USD(1_000), priceUsd: 150, confUsd: 1, chainlinkUsd: 150, collateral: atPythConservative })).status).to.equal("active");
  });

  it("the opening price (for the 60% rule) is the lower of the two mid prices", async () => {
    expect((await w.openLoan({ principal: USD(100), priceUsd: 150, chainlinkUsd: 140, collateral: SOL(10) })).openPrice).to.equal(PRICE(140));
    expect((await w.openLoan({ principal: USD(100), priceUsd: 130, chainlinkUsd: 140, collateral: SOL(10) })).openPrice).to.equal(PRICE(130));
  });

  it("settlement on a price drop needs both oracles to show it", async () => {
    const loan = await w.withThreshold(10_100, () => w.openLoan({ principal: USD(1_000) }));
    for (const [pyth, cl] of [
      [90, 100],
      [100, 90],
    ]) {
      w.h.setPrice(pyth);
      w.h.setChainlinkPrice(cl);
      w.fails([await w.liquidateIx(loan)], [w.keeper], "NotLiquidatable");
    }
    w.h.setPrice(90);
    expect((await w.liquidate(loan)).status).to.equal("liquidated");
    expect(w.event("loanLiquidated").price.toString()).to.equal(PRICE(90).toString());
  });

  it("a default takes SOL priced at the higher of the two", async () => {
    const loan = await w.openLoan({ principal: USD(500) });
    w.h.warp(LOAN_TERM_SECS + 1);
    w.h.setPrice(120);
    w.h.setChainlinkPrice(100);
    const before = w.h.lamports(w.treasury.publicKey);
    await w.liquidate(loan);
    expect(w.h.lamports(w.treasury.publicKey) - before).to.equal(stableToLamports(totalDue(USD(500)), PRICE(120), -8, true));
    expect(w.event("loanLiquidated").price.toString()).to.equal(PRICE(120).toString());
  });

  it("both oracles are validated on settlement too", async () => {
    const loan = await w.openLoan({ principal: USD(100) });
    w.h.warp(LOAN_TERM_SECS + 1);
    w.h.setPrice(150, { ageSecs: 500 });
    w.fails([await w.liquidateIx(loan)], [w.keeper], "StalePrice");
    w.h.setPrice(150);
    w.h.setChainlinkPrice(150, { ageSecs: 500 });
    w.fails([await w.liquidateIx(loan)], [w.keeper], "StaleChainlinkPrice");
    w.h.setPrice(150, { owner: Keypair.generate().publicKey });
    w.fails([await w.liquidateIx(loan)], [w.keeper], "InvalidOracle");
  });

  it("the SDK's combinePrices mirrors the program's lowest / open / highest prices", () => {
    const t = Number(w.h.now());
    const pyth = parsePriceUpdateV2(encodePriceUpdateV2({ price: PRICE(150), conf: PRICE(1), expo: -8, publishTime: t }));
    const cl = parseChainlinkFeed(encodeChainlinkFeed({ price: 145_000_000n, decimals: 6, timestamp: t }));
    const c = combinePrices(pyth, cl);
    expect(c.chainlinkPrice).to.equal(PRICE(145));
    expect(c.lowest).to.equal(PRICE(145));
    expect(c.openPrice).to.equal(PRICE(145));
    expect(c.highest).to.equal(PRICE(150));
  });
});
