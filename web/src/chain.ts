import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  fallback,
  http,
  zeroAddress,
  getAddress,
  parseAbiItem,
  parseEventLogs,
} from "viem";
import type { Address, Abi, PublicClient } from "viem";
import type {
  Runtime,
  Provider,
  DeskState,
  Card,
  CardEntry,
  Coin,
  PoolKey,
  Quote,
  Call,
  TxStage,
} from "./types";
import { same, minimum, MAX_SWAP } from "./logic";
export class DeskApi {
  runtime: Runtime;
  public: PublicClient;
  chain: ReturnType<typeof defineChain>;
  desk: Address;
  hic: Address;
  imd: Address;
  constructor(runtime: Runtime, provider?: Provider) {
    this.runtime = runtime;
    const { deployment: d } = runtime;
    this.chain = defineChain({
      id: d.chainId,
      name: d.network.name,
      nativeCurrency: d.network.nativeCurrency,
      rpcUrls: { default: { http: d.network.rpcUrls } },
      blockExplorers: {
        default: { name: "Explorer", url: d.network.explorer },
      },
    });
    this.public = createPublicClient({
      chain: this.chain,
      transport: fallback(
        [
          ...[
            ...new Set([
              ...d.network.rpcUrls,
              "https://rpc.flashbots.net",
              "https://rpc.mevblocker.io",
            ]),
          ].map((url) =>
            http(url, {
              timeout: 7000,
              retryCount: 0,
              batch: { batchSize: 3, wait: 10 },
            }),
          ),
          ...(provider ? [custom(provider, { retryCount: 0 })] : []),
        ],
        { retryCount: 0 },
      ),
      batch: { multicall: false },
    }) as unknown as PublicClient;
    this.desk = this.contract("HandlerDesk");
    this.hic = this.contract("LaunchToken");
    this.imd = d.network.pairToken.address;
  }
  contract(name: string) {
    const found = this.runtime.deployment.contracts.find(
      (c) => c.name === name,
    );
    if (!found) throw Error(`Missing ${name} deployment.`);
    return found.address;
  }
  abi(name = "HandlerDesk") {
    return this.runtime.abis[name];
  }
  async read<T>(
    functionName: string,
    args: readonly unknown[] = [],
    address = this.desk,
    abi = this.abi(),
  ): Promise<T> {
    return (await this.public.readContract({
      address,
      abi,
      functionName,
      args,
    })) as T;
  }
  call(
    functionName: string,
    args: readonly unknown[] = [],
    address = this.desk,
    abi = this.abi(),
  ): Call {
    return { functionName, args, address, abi };
  }
  token<T>(
    address: Address,
    functionName: string,
    args: readonly unknown[] = [],
  ) {
    return this.read<T>(functionName, args, address, this.abi("ERC20"));
  }
  async verify(): Promise<DeskState> {
    const d = this.runtime.deployment;
    if ((await this.public.getChainId()) !== d.chainId)
      throw Error(
        "The RPC returned the wrong network. Transactions are disabled.",
      );
    const addresses = [
      ...d.contracts.map((c) => c.address),
      this.imd,
      d.poolKey.hooks,
      ...Object.values(d.network.uniswapV4).filter(
        (v): v is Address => typeof v === "string",
      ),
    ];
    const codes = await Promise.all(
      [...new Set(addresses)].map(async (a) => ({
        a,
        code: await this.public.getCode({ address: a }),
      })),
    );
    if (codes.some((c) => !c.code || c.code === "0x"))
      throw Error(
        "Deployment verification found a contract with no code on the configured chain. Transactions are disabled.",
      );
    const [hic, imd, manager, key, cards] = await Promise.all([
      this.read<Address>("hic"),
      this.read<Address>("IMD"),
      this.read<Address>("POOL_MANAGER"),
      this.read<PoolKey>("poolKey", [this.hic]),
      this.read<Address>("cards"),
    ]);
    if (
      !same(hic, this.hic) ||
      !same(imd, this.imd) ||
      !same(manager, d.network.uniswapV4.poolManager) ||
      !same(key.currency0, d.poolKey.currency0) ||
      !same(key.currency1, d.poolKey.currency1) ||
      !same(key.hooks, d.poolKey.hooks) ||
      key.fee !== d.poolKey.fee ||
      key.tickSpacing !== d.poolKey.tickSpacing
    )
      throw Error(
        "Contract wiring differs from the deployment pool. Transactions are disabled.",
      );
    if (!(await this.public.getCode({ address: cards })))
      throw Error("The card contract is missing. Transactions are disabled.");
    const [boundDesk, art] = await Promise.all([
      this.read<Address>("desk", [], cards, this.abi("HandlerCards")),
      this.read<Address>("art", [], cards, this.abi("HandlerCards")),
    ]);
    if (!same(boundDesk, this.desk) || !same(art, this.contract("HandlerArt")))
      throw Error("The card contract binding is invalid.");
    return this.state();
  }
  async state(): Promise<DeskState> {
    const [
      mintPrice,
      totalCards,
      burnImd,
      lastBurnTime,
      hasBurned,
      owner,
      pendingOwner,
      cards,
      block,
      hicDecimals,
      hicSymbol,
      imdDecimals,
      imdSymbol,
      tradable,
    ] = await Promise.all([
      this.read<bigint>("mintPrice"),
      this.read<bigint>("totalCards"),
      this.read<bigint>("burnImd"),
      this.read<bigint>("lastBurnTime"),
      this.read<boolean>("hasBurned"),
      this.read<Address>("owner"),
      this.read<Address>("pendingOwner"),
      this.read<Address>("cards"),
      this.public.getBlock(),
      this.token<number>(this.hic, "decimals"),
      this.token<string>(this.hic, "symbol"),
      this.token<number>(this.imd, "decimals"),
      this.token<string>(this.imd, "symbol"),
      this.read<boolean>("isTradable", [this.hic]),
    ]);
    if (imdDecimals !== this.runtime.deployment.network.pairToken.decimals)
      throw Error("The paired token decimals differ from the network handoff.");
    return {
      mintPrice,
      totalCards,
      burnImd,
      lastBurnTime,
      hasBurned,
      owner,
      pendingOwner,
      cards,
      time: block.timestamp,
      block: block.number!,
      hicDecimals,
      hicSymbol,
      imdDecimals,
      imdSymbol,
      tradable,
    };
  }
  async card(id: bigint, cards: Address): Promise<CardEntry> {
    const [c, holder] = await Promise.all([
      this.read<Card>("getCard", [id]),
      this.read<Address>("ownerOf", [id], cards, this.abi("HandlerCards")),
    ]);
    return { ...c, id, holder };
  }
  async cardsPage(start: bigint, end: bigint, cards: Address) {
    const result: CardEntry[] = [];
    for (let i = start; i <= end; i += 5n) {
      const ids = [];
      for (let j = i; j <= end && j < i + 5n; j++) ids.push(j);
      result.push(
        ...(await Promise.all(ids.map((id) => this.card(id, cards)))),
      );
    }
    return result;
  }
  async quote(
    input: Address,
    output: Address,
    amountIn: bigint,
    bps: bigint,
    net = false,
  ): Promise<Quote> {
    if (amountIn <= 0n || amountIn > MAX_SWAP)
      throw Error("Input is outside the supported swap range.");
    const token = same(input, this.imd) ? output : input;
    if (!same(input, this.imd) && !same(output, this.imd))
      throw Error("Choose an IMD launch pool.");
    if (!(await this.read<boolean>("isTradable", [token])))
      throw Error("PoolNotInitialized");
    const key = same(token, this.hic)
      ? this.runtime.deployment.poolKey
      : await this.read<PoolKey>("poolKey", [token]);
    const d = this.runtime.deployment;
    const sorted = [this.imd.toLowerCase(), token.toLowerCase()].sort();
    if (
      !same(key.currency0, sorted[0]) ||
      !same(key.currency1, sorted[1]) ||
      !same(key.hooks, d.poolKey.hooks) ||
      key.fee !== d.poolKey.fee ||
      key.tickSpacing !== d.poolKey.tickSpacing
    )
      throw Error("The quoted pool does not match the attested launch rules.");
    const { result } = await this.public.simulateContract({
      address: d.network.uniswapV4.quoter,
      abi: this.abi("Quoter"),
      functionName: "quoteExactInputSingle",
      args: [
        {
          poolKey: key,
          zeroForOne: same(input, key.currency0),
          exactAmount: amountIn,
          hookData: "0x",
        },
      ],
    });
    const [gross] = result as [bigint, bigint];
    const outputAmount = net ? gross - gross / 400n : gross;
    return {
      input,
      output,
      amount: amountIn,
      outputAmount,
      minOut: minimum(outputAmount, bps),
      at: Date.now(),
      key,
      slippageBps: bps,
      net,
    };
  }
  async balances(card: CardEntry, account: Address): Promise<Coin[]> {
    if (!same(card.holder, account))
      throw Error(
        "Connect this card’s holder wallet to view its balances here.",
      );
    const coins = await this.read<Address[]>("cardCoins", [card.id]);
    return Promise.all(
      coins.map(async (address) => {
        const [balance, symbol, decimals, position] = await Promise.all([
          this.read<bigint>("balances", [card.id, address]),
          this.token<string>(address, "symbol"),
          this.token<number>(address, "decimals"),
          this.read<readonly [bigint, bigint]>("positions", [card.id, address]),
        ]);
        let value: bigint | undefined;
        let valueError: string | undefined;
        if (same(address, this.imd)) value = balance;
        else if (balance === 0n) value = 0n;
        else
          try {
            value = (await this.quote(address, this.imd, balance, 50n, true))
              .outputAmount;
          } catch {
            valueError = "Quote unavailable";
          }
        return {
          address,
          symbol,
          decimals,
          balance,
          quantity: position[0],
          cost: position[1],
          value,
          valueError,
        };
      }),
    );
  }
  async tradeHistory(id: bigint, fromBlock: bigint, toBlock: bigint) {
    const logs = await this.public.getLogs({
      address: this.desk,
      event: parseAbiItem(
        "event Traded(uint256 indexed id,address indexed token,bool isBuy,uint256 imdAmount,uint256 tokenAmount,int256 pnl,bool win)",
      ),
      args: { id },
      fromBlock,
      toBlock,
      strict: true,
    });
    const blockTimes = new Map<bigint, bigint>();
    const tokenInfo = new Map<string, { symbol: string; decimals: number }>();
    for (const log of logs) {
      if (!blockTimes.has(log.blockNumber))
        blockTimes.set(
          log.blockNumber,
          (await this.public.getBlock({ blockNumber: log.blockNumber }))
            .timestamp,
        );
      if (!tokenInfo.has(log.args.token))
        tokenInfo.set(log.args.token, {
          symbol: await this.token<string>(log.args.token, "symbol"),
          decimals: await this.token<number>(log.args.token, "decimals"),
        });
    }
    return logs
      .map((log) => ({
        ...log,
        time: blockTimes.get(log.blockNumber)!,
        coin: tokenInfo.get(log.args.token)!,
      }))
      .reverse();
  }
  async send(
    provider: Provider,
    account: Address,
    call: Call,
    onStage: (stage: TxStage) => void,
  ) {
    const ensure = async () => {
      const [chain, accounts] = await Promise.all([
        provider.request({ method: "eth_chainId" }),
        provider.request({ method: "eth_accounts" }),
      ]);
      if (Number(chain) !== this.runtime.deployment.chainId)
        throw Error("Switch your wallet to the configured network first.");
      if (!same(accounts[0], account))
        throw Error("Your wallet account changed. Review the action again.");
    };
    onStage({ status: "checking", message: "Simulating the transaction…" });
    await ensure();
    const { request } = await this.public.simulateContract({
      ...call,
      account,
    });
    await ensure();
    onStage({
      status: "signing",
      message: "Review the transaction in your wallet.",
    });
    const wallet = createWalletClient({
      chain: this.chain,
      transport: custom(provider),
      account,
    });
    const hash = await wallet.writeContract({ ...request, chain: this.chain });
    onStage({
      status: "confirming",
      message: "Submitted. Waiting for confirmation…",
      hash,
    });
    let actionReplaced = false;
    const receipt = await this.public.waitForTransactionReceipt({
      hash,
      confirmations: 1,
      timeout: 180000,
      onReplaced: (replacement) => {
        if (replacement.reason !== "repriced") actionReplaced = true;
        onStage({
          status: "confirming",
          message: "Transaction replaced. Waiting for confirmation…",
          hash: replacement.transaction.hash,
        });
      },
    });
    if (actionReplaced)
      throw Error(
        "This transaction was cancelled or replaced with another action in your wallet. Check the explorer before trying again.",
      );
    if (receipt.status !== "success")
      throw Error(
        "The transaction reverted. No application changes were made. Check the explorer for details.",
      );
    let cardId: bigint | undefined;
    if (call.functionName === "mint" && same(call.address, this.desk)) {
      const minted = parseEventLogs({
        abi: this.abi(),
        logs: receipt.logs,
        eventName: "Minted",
        strict: true,
      }).find((log) => same(log.address, this.desk));
      const args = minted?.args as
        { id?: bigint; holder?: Address } | undefined;
      if (args?.id && same(args.holder, account)) cardId = args.id;
    }
    onStage({
      status: "success",
      message: "Confirmed on chain.",
      hash: receipt.transactionHash,
      cardId,
    });
    return receipt;
  }
}
export async function switchNetwork(provider: Provider, runtime: Runtime) {
  const chainId =
    `0x${runtime.deployment.chainId.toString(16)}` as `0x${string}`;
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId }],
    });
  } catch (e) {
    const error = e as any;
    if (
      error.code === 4902 ||
      error.data?.originalError?.code === 4902 ||
      /unknown chain|unrecognized chain|not added/i.test(error.message || "")
    ) {
      if (!runtime.deployment.walletAddChain)
        throw Error(
          "This chain is missing from your wallet and no add-chain configuration was supplied.",
        );
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [runtime.deployment.walletAddChain],
      });
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId }],
      });
    } else throw e;
  }
}
export { zeroAddress, getAddress };
