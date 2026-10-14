import {
  createWalletClient,
  custom,
  formatUnits,
  parseAbiItem,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { DeskApi } from "../chain";
import type { CardEntry, Provider } from "../types";
import { same } from "../logic";
import {
  type CoinState,
  type Rules,
  type Snapshot,
  type ValidAction,
} from "./model";
import { PendingTransactionError } from "./engine";
const check = (signal: AbortSignal) => {
  if (signal.aborted) throw Error("Autopilot stopped.");
};
export class AutopilotChain {
  samples: Map<string, number[]>;
  times = new Map<string, { heldSince?: number; lastSold?: number }>();
  dropped: string[] = [];
  constructor(
    private api: DeskApi,
    private card: CardEntry,
    private cards: Address,
    private holder: Address,
    private watched: Address[],
    private rules: Rules,
    private key: string,
    private onSnapshot: (s: Snapshot, dropped: string[]) => void,
    samples = new Map<string, number[]>(),
  ) {
    this.samples = samples;
  }
  async read(sample: boolean, signal: AbortSignal): Promise<Snapshot> {
    check(signal);
    const api = this.api;
    const [card, spent, balance, block] = await Promise.all([
      api.card(this.card.id, this.cards),
      api.read<bigint>("spentToday", [this.card.id]),
      api.read<bigint>("balances", [this.card.id, api.imd]),
      api.public.getBlock(),
    ]);
    if (!same(card.holder, this.holder))
      throw Error("The connected wallet is not this card’s holder.");
    const now = Number(block.timestamp) * 1000;
    const coins: CoinState[] = [];
    const dropped: string[] = [];
    for (const address of this.watched) {
      check(signal);
      if (!(await api.read<boolean>("isTradable", [address]))) {
        dropped.push(`${address}: not tradable`);
        continue;
      }
      const [position, balance, symbol, decimals] = await Promise.all([
        api.read<readonly [bigint, bigint]>("positions", [card.id, address]),
        api.read<bigint>("balances", [card.id, address]),
        api.token<string>(address, "symbol"),
        api.token<number>(address, "decimals"),
      ]);
      if (position[0] !== balance)
        throw Error(
          "Position and balance reads disagree. Waiting for the next check.",
        );
      try {
        const quote = await api.quote(
          api.imd,
          address,
          parseUnits("0.05", 18),
          300n,
        );
        const price = 0.05 / Number(formatUnits(quote.outputAmount, decimals));
        if (!Number.isFinite(price) || price <= 0) throw Error("Invalid price");
        const id = address.toLowerCase();
        const samples = this.samples.get(id) ?? [];
        if (sample) {
          samples.push(price);
          this.samples.set(id, samples.slice(-60));
        }
        const value =
          position[0] === 0n
            ? 0n
            : (await api.quote(address, api.imd, position[0], 300n, true))
                .outputAmount;
        coins.push({
          address,
          symbol: symbol.slice(0, 32),
          decimals,
          tradable: true,
          quantity: position[0],
          cost: position[1],
          value,
          price,
          samples: [...(this.samples.get(id) ?? [])],
          ...this.times.get(id),
        });
      } catch {
        dropped.push(`${address}: quote unavailable`);
      }
    }
    check(signal);
    const missingTimes = coins.filter(
      (coin) =>
        !this.times.has(coin.address.toLowerCase()) ||
        (coin.quantity > 0n &&
          this.times.get(coin.address.toLowerCase())?.heldSince === undefined),
    );
    if (missingTimes.length)
      await this.loadTimes(missingTimes, block.number!, now, signal);
    for (const coin of coins)
      Object.assign(coin, this.times.get(coin.address.toLowerCase()));
    const snapshot = { card, balance, spent, coins, now };
    this.dropped = dropped;
    if (sample) this.onSnapshot(snapshot, dropped);
    return snapshot;
  }
  private async loadTimes(
    coins: CoinState[],
    latest: bigint,
    now: number,
    signal: AbortSignal,
  ) {
    const horizon =
      Math.max(this.rules.holdHours, this.rules.cooldownHours) * 3_600_000;
    const cutoff = Math.max(0, now - horizon);
    let low = 0n,
      high = latest;
    const since = Math.max(cutoff, Number(this.card.mintedAt) * 1000);
    // Locate the actual timestamp boundary; never infer block counts from a nominal block time.
    while (low < high) {
      check(signal);
      const mid = (low + high) / 2n;
      const block = await this.api.public.getBlock({ blockNumber: mid });
      if (Number(block.timestamp) * 1000 < since) low = mid + 1n;
      else high = mid;
    }
    type ChangeLog = {
      token: Address;
      quantity: bigint;
      buy: boolean;
      sale: boolean;
      blockNumber: bigint;
      logIndex: number;
    };
    const logs: ChangeLog[] = [];
    for (let from = low; from <= latest; from += 1000n) {
      check(signal);
      const range = {
        address: this.api.desk,
        fromBlock: from,
        toBlock: from + 999n < latest ? from + 999n : latest,
        strict: true as const,
      };
      const [trades, withdrawals] = await Promise.all([
        this.api.public.getLogs({
          ...range,
          event: parseAbiItem(
            "event Traded(uint256 indexed id,address indexed token,bool isBuy,uint256 imdAmount,uint256 tokenAmount,int256 pnl,bool win)",
          ),
          args: { id: this.card.id },
        }),
        this.api.public.getLogs({
          ...range,
          event: parseAbiItem(
            "event Withdrawn(uint256 indexed id,address indexed token,uint256 amount)",
          ),
          args: { id: this.card.id },
        }),
      ]);
      logs.push(
        ...trades.map((log) => ({
          token: log.args.token,
          quantity: log.args.tokenAmount,
          buy: log.args.isBuy,
          sale: !log.args.isBuy,
          blockNumber: log.blockNumber,
          logIndex: log.logIndex,
        })),
        ...withdrawals.map((log) => ({
          token: log.args.token,
          quantity: log.args.amount,
          buy: false,
          sale: false,
          blockNumber: log.blockNumber,
          logIndex: log.logIndex,
        })),
      );
    }
    logs.sort((a, b) =>
      a.blockNumber === b.blockNumber
        ? a.logIndex - b.logIndex
        : a.blockNumber < b.blockNumber
          ? -1
          : 1,
    );
    const blockTimes = new Map<bigint, number>();
    const timestamp = async (blockNumber: bigint) => {
      if (!blockTimes.has(blockNumber))
        blockTimes.set(
          blockNumber,
          Number((await this.api.public.getBlock({ blockNumber })).timestamp) *
            1000,
        );
      return blockTimes.get(blockNumber)!;
    };
    for (const coin of coins) {
      let remaining = coin.quantity;
      let heldSince = coin.quantity > 0n ? since : undefined;
      let lastSold: number | undefined;
      for (const log of [...logs].reverse()) {
        if (!same(log.token, coin.address)) continue;
        if (log.sale && lastSold === undefined)
          lastSold = await timestamp(log.blockNumber);
        if (remaining > 0n) {
          if (log.buy) {
            heldSince = await timestamp(log.blockNumber);
            remaining =
              remaining > log.quantity ? remaining - log.quantity : 0n;
          } else remaining += log.quantity;
        }
      }
      if (remaining > 0n) heldSince = since;
      this.times.set(coin.address.toLowerCase(), { heldSince, lastSold });
    }
  }
  async send(
    action: ValidAction,
    privateKey: Hex,
    bps: bigint,
    signal: AbortSignal,
    onHash: (hash: Hex) => void,
  ): Promise<Hex> {
    check(signal);
    const buy = action.action === "buy",
      api = this.api;
    const q = await api.quote(
      buy ? api.imd : action.coin.address,
      buy ? action.coin.address : api.imd,
      buy ? action.amount - action.amount / 400n : action.amount,
      bps,
      !buy,
    );
    check(signal);
    const account = privateKeyToAccount(privateKey);
    const call = api.call(action.action, [
      this.card.id,
      action.coin.address,
      action.amount,
      q.minOut,
    ]);
    const { request } = await api.public.simulateContract({
      ...call,
      account: account.address,
    });
    check(signal);
    const wallet = createWalletClient({
      account,
      chain: api.chain,
      transport: custom({ request: (args) => api.public.request(args) }),
    });
    // Prepare before signing, then check cancellation once more. No key is sent to the transport.
    const data = (await import("viem")).encodeFunctionData(call);
    const prepared = await wallet.prepareTransactionRequest({
      to: request.address,
      data,
      account,
      chain: api.chain,
    });
    check(signal);
    if (Date.now() - q.at > 60_000)
      throw Error(
        "Quote expired while preparing the trade. Waiting for the next check.",
      );
    const serialized = await wallet.signTransaction({
      ...prepared,
      chain: api.chain,
    });
    check(signal);
    const hash = await api.public.sendRawTransaction({
      serializedTransaction: serialized,
    });
    // Persist the hash before waiting; a reload must not submit a duplicate while it is pending.
    onHash(hash);
    try {
      localStorage.setItem(this.key + ":pending", hash);
    } catch {
      throw new PendingTransactionError(
        "Trade submitted, but its pending hash could not be saved. Check the transaction before restarting.",
      );
    }
    let receipt;
    try {
      receipt = await api.public.waitForTransactionReceipt({
        hash,
        confirmations: 1,
        timeout: 180_000,
      });
    } catch {
      throw new PendingTransactionError(
        "Confirmation is unknown. Autopilot stopped; check the transaction before restarting.",
      );
    }
    localStorage.removeItem(this.key + ":pending");
    if (receipt.status !== "success")
      throw Error("The trade reverted on chain. Check its transaction link.");
    const now =
      Number(
        (await api.public.getBlock({ blockNumber: receipt.blockNumber }))
          .timestamp,
      ) * 1000;
    const id = action.coin.address.toLowerCase(),
      current = this.times.get(id) ?? {};
    this.times.set(
      id,
      buy
        ? {
            ...current,
            heldSince: action.coin.quantity === 0n ? now : current.heldSince,
          }
        : {
            heldSince:
              action.amount === action.coin.quantity
                ? undefined
                : current.heldSince,
            lastSold: now,
          },
    );
    return hash;
  }
}
export async function checkPending(api: DeskApi, key: string) {
  const hash = localStorage.getItem(key + ":pending") as Hex | null;
  if (!hash) return;
  try {
    await api.public.getTransactionReceipt({ hash });
    localStorage.removeItem(key + ":pending");
  } catch {
    throw Error(
      `A previous transaction is still pending or unavailable. Check ${hash} in the explorer before starting.`,
    );
  }
}
export async function fundAgent(
  api: DeskApi,
  provider: Provider,
  holder: Address,
  agent: Address,
  value: bigint,
  onHash: (hash: Hex) => void,
) {
  const ensure = async () => {
    const [chain, accounts] = await Promise.all([
      provider.request({ method: "eth_chainId" }),
      provider.request({ method: "eth_accounts" }),
    ]);
    if (Number(chain) !== api.chain.id || !same(accounts[0], holder))
      throw Error(
        "Wallet account or network changed. Review the gas transfer again.",
      );
  };
  await ensure();
  const gas = await api.public.estimateGas({
    account: holder,
    to: agent,
    value,
  });
  await ensure();
  const wallet = createWalletClient({
    chain: api.chain,
    transport: custom(provider),
    account: holder,
  });
  const hash = await wallet.sendTransaction({
    to: agent,
    value,
    gas,
    chain: api.chain,
  });
  onHash(hash);
  const receipt = await api.public.waitForTransactionReceipt({
    hash,
    confirmations: 1,
    timeout: 180_000,
  });
  if (receipt.status !== "success")
    throw Error("The gas transfer reverted. Check the transaction link.");
}
