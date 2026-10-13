import {
  encodeAbiParameters,
  decodeErrorResult,
  parseAbiParameters,
  parseUnits,
  formatUnits,
  getAddress,
  isAddress,
  zeroAddress,
} from "viem";
import type { Address, Abi, Hex } from "viem";
import type { CardEntry, PoolKey, Quote } from "./types";
export const MAX_SWAP = (1n << 127n) - 1n;
export function amount(text: string, decimals = 18, allowZero = false): bigint {
  const t = text.trim();
  if (!/^\d+(\.\d+)?$/.test(t))
    throw Error("Enter a plain positive amount, such as 1.25.");
  if ((t.split(".")[1]?.length ?? 0) > decimals)
    throw Error(`This token supports up to ${decimals} decimal places.`);
  const n = parseUnits(t, decimals);
  if (n < 0n || (!allowZero && n === 0n) || n > MAX_SWAP)
    throw Error("Enter an amount above zero within the supported range.");
  return n;
}
export function slippage(text: string): bigint {
  const n = amount(text, 2);
  if (n > 500n) throw Error("Choose slippage above 0% and at most 5%.");
  return n;
}
export function minimum(output: bigint, bps: bigint): bigint {
  const n = (output * (10000n - bps)) / 10000n;
  if (n <= 0n)
    throw Error("The quoted output is too small. Increase the input.");
  return n;
}
export function validateName(name: string) {
  if (!/^[A-Za-z0-9 -]{1,24}$/.test(name) || !name.trim())
    throw Error("Use 1–24 letters, numbers, spaces or dashes.");
  return name;
}
export function address(text: string, allowZero = false): Address {
  if (!isAddress(text.trim()))
    throw Error(
      "Enter a valid Ethereum address (0x followed by 40 hexadecimal characters).",
    );
  const value = getAddress(text.trim());
  if (!allowZero && value === zeroAddress)
    throw Error("Use a nonzero address.");
  return value;
}
export const same = (a?: string, b?: string) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();
export const units = (n: bigint, decimals = 18) => formatUnits(n, decimals);
export function short(n: bigint, decimals = 18, places = 4) {
  const s = units(n, decimals);
  const [i, f] = s.split(".");
  if (!f) return i;
  const shown = f.slice(0, places).replace(/0+$/, "");
  return n !== 0n && BigInt(i) === 0n && !shown
    ? (n < 0n ? "> -" : "< ") + "0." + "0".repeat(places - 1) + "1"
    : i + (shown ? "." + shown : "");
}
export const winRate = (c: { wins: bigint; losses: bigint }) =>
  c.wins + c.losses
    ? `${(c.wins * 100n) / (c.wins + c.losses)}%`
    : "No results";
export function rank(cards: CardEntry[], sort: "rate" | "pnl") {
  return cards
    .filter((c) => c.wins + c.losses >= 10n)
    .sort((a, b) => {
      const diff =
        sort === "pnl"
          ? b.pnl - a.pnl
          : b.wins * (a.wins + a.losses) - a.wins * (b.wins + b.losses);
      return diff > 0n ? 1 : diff < 0n ? -1 : a.id < b.id ? -1 : 1;
    });
}
export function checkQuote(
  q: Quote | undefined,
  input: Address,
  amountIn: bigint,
  output?: Address,
  bps?: bigint,
) {
  if (!q || !same(q.input, input) || q.amount !== amountIn)
    throw Error("Get a fresh quote for this amount first.");
  if (
    (output && !same(q.output, output)) ||
    (bps !== undefined && q.slippageBps !== bps)
  )
    throw Error("The token or slippage setting changed. Get a fresh quote.");
  if (Date.now() - q.at > 60000)
    throw Error("This quote expired after 60 seconds. Get a fresh quote.");
}
const keyTuple =
  "(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)";
export function routerInput(
  key: PoolKey,
  input: Address,
  amountIn: bigint,
  minOut: bigint,
  extended = false,
) {
  if (
    amountIn <= 0n ||
    amountIn > MAX_SWAP ||
    minOut <= 0n ||
    minOut > (1n << 128n) - 1n
  )
    throw Error("Swap amount is outside the router range.");
  const zeroForOne = same(input, key.currency0);
  if (!zeroForOne && !same(input, key.currency1))
    throw Error("Input currency is outside the deployment pool.");
  const output = zeroForOne ? key.currency1 : key.currency0;
  const tuple = parseAbiParameters(
    `(${keyTuple} poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,${extended ? "uint256 minHopPriceX36," : ""}bytes hookData)`,
  );
  const param = {
    poolKey: key,
    zeroForOne,
    amountIn,
    amountOutMinimum: minOut,
    ...(extended ? { minHopPriceX36: 0n } : {}),
    hookData: "0x",
  };
  const params = [
    encodeAbiParameters(tuple, [param]),
    encodeAbiParameters(parseAbiParameters("address,uint256"), [
      input,
      amountIn,
    ]),
    encodeAbiParameters(parseAbiParameters("address,uint256"), [
      output,
      minOut,
    ]),
  ];
  return encodeAbiParameters(parseAbiParameters("bytes,bytes[]"), [
    "0x060c0f",
    params,
  ]);
}
const messages: Record<string, string> = {
  InvalidName: "Use 1–24 letters, numbers, spaces or dashes.",
  OnlyHolder: "Connect the permanent holder wallet to manage this card.",
  OnlyAgent: "Connect the agent address assigned to this card.",
  CardFrozen: "The holder has frozen this card. Unfreeze it before trading.",
  PerTradeLimit: "This buy exceeds the maximum per trade. Reduce the amount.",
  DailyLimit: "This buy exceeds the remaining UTC daily cap.",
  InsufficientBalance: "The card does not have enough of this token.",
  PoolNotInitialized:
    "This token has no initialized pool with the required IMD launch key.",
  Slippage: "The output fell below your minimum. Get a fresh quote.",
  PartialFill:
    "The pool could not fill the entire input. Try a smaller amount.",
  BurnTooSoon: "The hourly burn is not available yet.",
  NothingToBurn: "There is no accrued IMD to burn.",
  InvalidAmount: "The amount is zero, too large or produces no output.",
  UnknownCard: "This card does not exist.",
  InvalidToken: "Choose a supported launch token, not IMD.",
  UnsupportedToken: "Token settlement does not match the expected amount.",
  MintPriceOutOfRange: "Set a mint price from 0.05 to 2 IMD.",
  OwnableUnauthorizedAccount:
    "Connect the current owner or pending owner for this action.",
  ERC20InsufficientAllowance: "Approve the required token amount, then retry.",
  ERC20InsufficientBalance: "Your wallet does not have enough tokens.",
  FreezeUnchanged: "The card already has this freeze state.",
  Soulbound: "Handler cards cannot be transferred or approved.",
};
export function explain(
  error: unknown,
  abis: Record<string, Abi> = {},
): string {
  let e = error as any;
  for (let depth = 0; e && depth < 12; depth++, e = e.cause) {
    if (e.code === 4001 || e.code === "ACTION_REJECTED")
      return "You declined the wallet request. Nothing was submitted. You can try again.";
    if (e.data?.errorName && messages[e.data.errorName])
      return messages[e.data.errorName];
    if (typeof e.data === "string" && e.data.startsWith("0x")) {
      for (const abi of Object.values(abis)) {
        try {
          const decoded = decodeErrorResult({ abi, data: e.data as Hex });
          if (messages[decoded.errorName]) return messages[decoded.errorName];
          if (decoded.errorName === "ExecutionFailed" && decoded.args?.[1])
            return explain({ data: decoded.args[1] }, abis);
        } catch {
          /* try the next verified ABI */
        }
      }
    }
    if (
      e.name === "TransactionReceiptNotFoundError" ||
      e.name === "WaitForTransactionReceiptTimeoutError"
    )
      return "Confirmation is taking longer than expected. Check the transaction in the explorer before trying again.";
  }
  const message =
    (error as any)?.shortMessage ||
    (error as any)?.message ||
    "The request failed. Check your connection and try again.";
  for (const [key, value] of Object.entries(messages))
    if (message.includes(key)) return value;
  if (/User rejected|User denied/i.test(message))
    return "You declined the wallet request. Nothing was submitted. You can try again.";
  if (/reverted|revert|signature.*0x/i.test(message))
    return "The contract rejected this action. Refresh state, check the amount and allowances, and get a fresh quote before retrying.";
  if (/insufficient funds/i.test(message))
    return "Your wallet needs more ETH for the network fee.";
  if (/fetch|HTTP|timeout|network|RPC|Failed to get/i.test(message))
    return "The public RPC is unavailable or rate limited. Retry, or connect your wallet on the configured network for a fallback.";
  return message.length > 360 ? message.slice(0, 357) + "…" : message;
}
