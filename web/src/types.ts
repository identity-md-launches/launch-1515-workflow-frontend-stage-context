import type { Abi, Address, Hex, EIP1193Provider } from "viem";
export type Provider = EIP1193Provider & {
  on?: (event: string, fn: (...args: any[]) => void) => void;
  removeListener?: (event: string, fn: (...args: any[]) => void) => void;
  providers?: Provider[];
  isMetaMask?: boolean;
  isCoinbaseWallet?: boolean;
};
export type WalletOption = { id: string; name: string; provider: Provider };
export type PoolKey = {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
};
export type Deployment = {
  version: 1;
  launchId: string;
  chainId: number;
  sourceCommit: string;
  attestationHash: string;
  contracts: {
    name: string;
    address: Address;
    abiHash: string;
    abiPath: string;
  }[];
  poolKey: PoolKey;
  assets: { path: string; sha256: string }[];
  network: {
    chainId: number;
    name: string;
    testnet: boolean;
    rpcUrls: string[];
    explorer: string;
    nativeCurrency: { name: string; symbol: string; decimals: number };
    faucets: unknown[];
    pairToken: {
      address: Address;
      name: string;
      symbol: string;
      decimals: number;
    };
    otherPairTokens?: unknown[];
    uniswapV4: {
      poolManager: Address;
      universalRouter: Address;
      quoter: Address;
      stateView: Address;
      positionManager: Address;
      permit2: Address;
      extendedSwapParams?: boolean;
    };
  };
  walletAddChain?: {
    chainId: Hex;
    chainName: string;
    nativeCurrency: { name: string; symbol: string; decimals: number };
    rpcUrls: string[];
    blockExplorerUrls: string[];
  };
};
export type Runtime = { deployment: Deployment; abis: Record<string, Abi> };
export type Card = {
  name: string;
  agent: Address;
  frozen: boolean;
  dailyCap: bigint;
  maxPerTrade: bigint;
  day: bigint;
  spentToday: bigint;
  mintedAt: bigint;
  trades: bigint;
  wins: bigint;
  losses: bigint;
  pnl: bigint;
  volume: bigint;
};
export type CardEntry = Card & { id: bigint; holder: Address };
export type DeskState = {
  mintPrice: bigint;
  totalCards: bigint;
  burnImd: bigint;
  lastBurnTime: bigint;
  hasBurned: boolean;
  owner: Address;
  pendingOwner: Address;
  cards: Address;
  time: bigint;
  block: bigint;
  hicDecimals: number;
  hicSymbol: string;
  imdDecimals: number;
  imdSymbol: string;
  tradable: boolean;
};
export type Coin = {
  address: Address;
  symbol: string;
  decimals: number;
  balance: bigint;
  value?: bigint;
  valueError?: string;
  quantity: bigint;
  cost: bigint;
};
export type Quote = {
  input: Address;
  output: Address;
  amount: bigint;
  outputAmount: bigint;
  minOut: bigint;
  at: number;
  key: PoolKey;
  slippageBps: bigint;
  net: boolean;
};
export type TxStage = {
  status: "idle" | "checking" | "signing" | "confirming" | "success" | "error";
  message: string;
  hash?: Hex;
  cardId?: bigint;
};
export type Call = {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
};
