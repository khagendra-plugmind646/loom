import { CHAINLINK_TRANSMISSIONS_DISCRIMINATOR, PRICE_UPDATE_V2_DISCRIMINATOR, SOL_USD_FEED_ID_HEX } from "./constants";

export interface PythPrice {
  feedIdHex: string;
  price: bigint;
  conf: bigint;
  expo: number;
  publishTime: number;
  fullyVerified: boolean;
}

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** Parses a Pyth `PriceUpdateV2` account (same layout the program reads). */
export function parsePriceUpdateV2(data: Uint8Array): PythPrice {
  if (data.length < 41 || !PRICE_UPDATE_V2_DISCRIMINATOR.every((b, i) => data[i] === b)) {
    throw new Error("not a Pyth PriceUpdateV2 account");
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let o = 40;
  const tag = data[o];
  o += tag === 0 ? 2 : 1;
  const feedIdHex = toHex(data.subarray(o, o + 32));
  o += 32;
  const price = view.getBigInt64(o, true);
  o += 8;
  const conf = view.getBigUint64(o, true);
  o += 8;
  const expo = view.getInt32(o, true);
  o += 4;
  const publishTime = Number(view.getBigInt64(o, true));
  return { feedIdHex, price, conf, expo, publishTime, fullyVerified: tag === 1 };
}

export const priceToNumber = (p: Pick<PythPrice, "price" | "expo">) => Number(p.price) * 10 ** p.expo;

export interface ChainlinkPrice {
  description: string;
  roundId: number;
  price: bigint;
  expo: number;
  timestamp: number;
}

// Byte offsets of the Chainlink store v1 `Transmissions` account (same as the program reads).
const CL = { description: 106, decimals: 138, latestRound: 143, liveLength: 148, timestamp: 208, answer: 216, size: 248 };

/** Parses a Chainlink Data Feeds (store v1) feed account. */
export function parseChainlinkFeed(data: Uint8Array): ChainlinkPrice {
  if (data.length < CL.size || !CHAINLINK_TRANSMISSIONS_DISCRIMINATOR.every((b, i) => data[i] === b)) {
    throw new Error("not a Chainlink feed account");
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const lo = view.getBigUint64(CL.answer, true);
  const hi = view.getBigInt64(CL.answer + 8, true);
  return {
    description: new TextDecoder().decode(data.subarray(CL.description, CL.description + 32)).replace(/\0+$/, ""),
    roundId: view.getUint32(CL.latestRound, true),
    price: (hi << 64n) | lo,
    expo: -data[CL.decimals],
    timestamp: view.getUint32(CL.timestamp, true),
  };
}

/** Builds Chainlink feed account bytes — used by tests / local simulations. */
export function encodeChainlinkFeed(p: { price: bigint; decimals?: number; timestamp: number; roundId?: number; description?: string }): Uint8Array {
  const out = new Uint8Array(CL.size);
  const view = new DataView(out.buffer);
  out.set(CHAINLINK_TRANSMISSIONS_DISCRIMINATOR, 0);
  out[8] = 1; // version
  out.set(new TextEncoder().encode(p.description ?? "SOL / USD"), CL.description);
  out[CL.decimals] = p.decimals ?? 8;
  view.setUint32(CL.latestRound, p.roundId ?? 1, true);
  out[CL.latestRound + 4] = 1; // granularity
  view.setUint32(CL.liveLength, 1, true);
  view.setUint32(CL.timestamp, p.timestamp, true);
  view.setBigUint64(CL.answer, p.price & 0xffff_ffff_ffff_ffffn, true);
  view.setBigInt64(CL.answer + 8, p.price >> 64n, true);
  return out;
}

/** `price * 10^from` expressed at exponent `to`, rounded down (matches the program). */
function rescale(price: bigint, from: number, to: number): bigint {
  return from >= to ? price * 10n ** BigInt(from - to) : price / 10n ** BigInt(to - from);
}

/**
 * Pyth and Chainlink SOL/USD combined with the program's rules, all at Pyth's exponent:
 * - `lowest`: values collateral when a loan opens (lower of Pyth's price − conf and Chainlink)
 * - `openPrice`: recorded as the loan's opening price; the 60% rule is measured from it (lower of the two)
 * - `highest`: used when settling, so SOL is only seized when both oracles show the drop (higher of the two)
 * `price`/`conf`/`expo` stay Pyth's, so this can be used wherever a Pyth price was.
 */
export interface SolPrices extends PythPrice {
  chainlink: ChainlinkPrice;
  /** Chainlink rescaled to `expo`. */
  chainlinkPrice: bigint;
  lowest: bigint;
  openPrice: bigint;
  highest: bigint;
}

export function combinePrices(pyth: PythPrice, chainlink: ChainlinkPrice): SolPrices {
  const chainlinkPrice = rescale(chainlink.price, chainlink.expo, pyth.expo);
  const min = (a: bigint, b: bigint) => (a < b ? a : b);
  const max = (a: bigint, b: bigint) => (a > b ? a : b);
  return {
    ...pyth,
    chainlink,
    chainlinkPrice,
    lowest: min(pyth.price - pyth.conf, chainlinkPrice),
    openPrice: min(pyth.price, chainlinkPrice),
    highest: max(pyth.price, chainlinkPrice),
  };
}

/** Builds PriceUpdateV2 account bytes — used by tests / local simulations. */
export function encodePriceUpdateV2(p: {
  price: bigint;
  conf: bigint;
  expo: number;
  publishTime: number;
  feedIdHex?: string;
  fullyVerified?: boolean;
}): Uint8Array {
  const out = new Uint8Array(134);
  const view = new DataView(out.buffer);
  out.set(PRICE_UPDATE_V2_DISCRIMINATOR, 0);
  // write_authority left zeroed
  let o = 40;
  if (p.fullyVerified === false) {
    out[o++] = 0;
    out[o++] = 5;
  } else {
    out[o++] = 1;
  }
  const feed = p.feedIdHex ?? SOL_USD_FEED_ID_HEX;
  out.set(Uint8Array.from(feed.match(/../g)!.map((h) => parseInt(h, 16))), o);
  o += 32;
  view.setBigInt64(o, p.price, true);
  o += 8;
  view.setBigUint64(o, p.conf, true);
  o += 8;
  view.setInt32(o, p.expo, true);
  o += 4;
  view.setBigInt64(o, BigInt(p.publishTime), true); // publish_time
  o += 8;
  view.setBigInt64(o, BigInt(p.publishTime - 1), true); // prev_publish_time
  o += 8;
  view.setBigInt64(o, p.price, true); // ema_price
  o += 8;
  view.setBigUint64(o, p.conf, true); // ema_conf
  return out;
}
