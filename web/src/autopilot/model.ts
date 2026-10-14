import {
  formatUnits,
  getAddress,
  isAddress,
  parseUnits,
  type Address,
} from "viem";
import type { CardEntry } from "../types";
import { amount, same } from "../logic";
export type Brain = "rules" | "ai";
export type Rules = {
  rise: number;
  samples: number;
  takeProfit: number;
  stopLoss: number;
  holdHours: number;
  cooldownHours: number;
};
export const DEFAULT_RULES: Rules = {
  rise: 5,
  samples: 10,
  takeProfit: 12,
  stopLoss: 8,
  holdHours: 12,
  cooldownHours: 1,
};
export type CoinState = {
  address: Address;
  symbol: string;
  decimals: number;
  tradable: boolean;
  quantity: bigint;
  cost: bigint;
  value: bigint;
  price: number;
  samples: number[];
  heldSince?: number;
  lastSold?: number;
};
export type Snapshot = {
  card: CardEntry;
  balance: bigint;
  spent: bigint;
  coins: CoinState[];
  now: number;
};
export type Decision = {
  action: "buy" | "sell" | "hold";
  coin?: string;
  imd?: string;
  reason: string;
  quantity?: bigint;
};
export type ValidAction = {
  action: "buy" | "sell";
  coin: CoinState;
  amount: bigint;
  reason: string;
};
export const MIN_BUY = parseUnits("0.1", 18);
export const min = (...values: bigint[]) =>
  values.reduce((a, b) => (a < b ? a : b));
export const buyLimit = (s: Snapshot, size: bigint) =>
  min(
    s.balance,
    s.card.maxPerTrade,
    s.card.dailyCap > s.spent ? s.card.dailyCap - s.spent : 0n,
    size,
  );
export function change(samples: number[], length: number): number | null {
  if (samples.length < length || length < 2) return null;
  const first = samples[samples.length - length];
  const result = (samples[samples.length - 1] / first - 1) * 100;
  return first > 0 && Number.isFinite(result) ? result : null;
}
export const pnl = (coin: Pick<CoinState, "value" | "cost">) =>
  coin.cost > 0n
    ? Number(((coin.value - coin.cost) * 1_000_000n) / coin.cost) / 10_000
    : null;
export function validateRules(r: Rules) {
  if (
    !Object.values(r).every(Number.isFinite) ||
    !Number.isInteger(r.samples) ||
    r.samples < 2 ||
    r.samples > 60 ||
    r.rise <= 0 ||
    r.takeProfit <= 0 ||
    r.stopLoss <= 0 ||
    r.stopLoss > 100 ||
    r.holdHours <= 0 ||
    r.holdHours > 720 ||
    r.cooldownHours < 0 ||
    r.cooldownHours > 720
  )
    throw Error(
      "Use positive rule values, 2–60 samples, a stop loss up to 100%, and durations up to 720 hours. Cooldown can be zero.",
    );
}
export function rulesDecision(s: Snapshot, r: Rules, size: bigint): Decision {
  validateRules(r);
  for (const coin of s.coins) {
    if (!coin.tradable || coin.quantity === 0n) continue;
    const gain = pnl(coin);
    const reason =
      gain !== null && gain >= r.takeProfit
        ? `Profit reached ${r.takeProfit}%.`
        : gain !== null && gain <= -r.stopLoss
          ? `Loss reached ${r.stopLoss}%.`
          : coin.heldSince !== undefined &&
              s.now - coin.heldSince >= r.holdHours * 3_600_000
            ? `Held for ${r.holdHours} hours.`
            : "";
    if (reason)
      return {
        action: "sell",
        coin: coin.address,
        quantity: coin.quantity,
        reason,
      };
  }
  const limit = buyLimit(s, size);
  if (limit < MIN_BUY)
    return {
      action: "hold",
      reason: "Available buy budget is below 0.1 IMD. Sells remain eligible.",
    };
  for (const coin of s.coins) {
    if (
      !coin.tradable ||
      coin.quantity !== 0n ||
      (coin.lastSold !== undefined &&
        s.now - coin.lastSold < r.cooldownHours * 3_600_000)
    )
      continue;
    const rise = change(coin.samples, r.samples);
    if (rise !== null && rise >= r.rise)
      return {
        action: "buy",
        coin: coin.address,
        imd: formatUnits(limit, 18),
        reason: `Price rose ${rise.toFixed(2)}% over ${r.samples} samples.`,
      };
  }
  return {
    action: "hold",
    reason: `No rule triggered. Buys need ${r.samples} samples and a ${r.rise}% rise.`,
  };
}
export function parseDecision(text: string): Decision {
  try {
    const d = JSON.parse(text);
    if (
      !d ||
      Array.isArray(d) ||
      !["buy", "sell", "hold"].includes(d.action) ||
      typeof d.reason !== "string" ||
      d.reason.length > 2000
    )
      throw Error();
    if (
      d.action !== "hold" &&
      (typeof d.coin !== "string" ||
        !isAddress(d.coin, { strict: false }) ||
        typeof d.imd !== "string")
    )
      throw Error();
    // Never accept model-supplied token quantities or arbitrary transaction fields.
    return {
      action: d.action,
      coin: d.coin,
      imd: d.imd,
      reason:
        d.reason.trim().slice(0, 600) ||
        `AI chose ${d.action} without a reason.`,
    };
  } catch {
    return {
      action: "hold",
      reason: "AI reply was not valid decision JSON; treated as hold.",
    };
  }
}
export function validateDecision(
  d: Decision,
  s: Snapshot,
  agent: Address,
  size: bigint,
): ValidAction | undefined {
  if (s.card.frozen) throw Error("Card is frozen. No trades are allowed.");
  if (!same(s.card.agent, agent))
    throw Error("This key is no longer the card’s assigned agent.");
  if (d.action === "hold") return;
  if (d.action !== "buy" && d.action !== "sell") throw Error("Unknown action.");
  const coin = s.coins.find((c) => same(c.address, d.coin));
  if (!coin || !coin.tradable)
    throw Error("Coin is outside the tradable watchlist.");
  let value: bigint;
  if (d.action === "buy") {
    value = amount(d.imd ?? "", 18);
    if (value < MIN_BUY) throw Error("Buy is below the 0.1 IMD minimum.");
    if (value > buyLimit(s, size))
      throw Error(
        "Buy exceeds the card balance, daily limit, per-trade limit or size setting.",
      );
  } else if (d.quantity !== undefined) value = d.quantity;
  else {
    const imd = amount(d.imd ?? "", 18);
    if (coin.value <= 0n || imd > coin.value)
      throw Error("Sell exceeds the position’s current IMD value.");
    value = (coin.quantity * imd) / coin.value;
  }
  if (value <= 0n || (d.action === "sell" && value > coin.quantity))
    throw Error(
      "Sell amount must be positive and no larger than the card’s position.",
    );
  return { action: d.action, coin, amount: value, reason: d.reason };
}
export function watchlist(text: string): Address[] {
  const values = text.split(/[\s,]+/).filter(Boolean);
  if (!values.length || values.length > 30)
    throw Error("Enter 1–30 coin addresses, separated by lines or commas.");
  return [
    ...new Set(
      values.map((v) => {
        if (!isAddress(v, { strict: false }) || /^0x0{40}$/i.test(v))
          throw Error(`Invalid watchlist address: ${v.slice(0, 50)}`);
        return getAddress(v.toLowerCase());
      }),
    ),
  ];
}
export function defaultWatchlist(hic: Address): string {
  return hic;
}
export function aiSnapshot(s: Snapshot, size: bigint) {
  return {
    card: {
      id: String(s.card.id),
      frozen: s.card.frozen,
      dailyCap: formatUnits(s.card.dailyCap, 18),
      maxPerTrade: formatUnits(s.card.maxPerTrade, 18),
      balance: formatUnits(s.balance, 18),
      spentToday: formatUnits(s.spent, 18),
      buyBudget: formatUnits(buyLimit(s, size), 18),
    },
    coins: s.coins.map((c) => ({
      address: c.address,
      symbol: c.symbol,
      priceImd: c.price,
      samples: c.samples.length,
      change10Percent: change(c.samples, 10),
      change60Percent: change(c.samples, 60),
      position: {
        quantity: formatUnits(c.quantity, c.decimals),
        costImd: formatUnits(c.cost, 18),
        valueImd: formatUnits(c.value, 18),
        pnlPercent: pnl(c),
        heldSince: c.heldSince ?? null,
      },
      lastSold: c.lastSold ?? null,
    })),
    timestamp: new Date(s.now).toISOString(),
  };
}
