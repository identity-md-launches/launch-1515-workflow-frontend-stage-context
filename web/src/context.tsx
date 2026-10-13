import {
  createContext,
  useContext,
  useState,
  useMemo,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import type { Address } from "viem";
import { DeskApi, switchNetwork, getAddress } from "./chain";
import { explain } from "./logic";
import type {
  Runtime,
  Provider,
  WalletOption,
  DeskState,
  Call,
  TxStage,
} from "./types";
type AppContext = {
  runtime: Runtime;
  api: DeskApi;
  state?: DeskState;
  verified: boolean;
  readError: string;
  reading: boolean;
  refresh: () => Promise<void>;
  revision: number;
  account?: Address;
  provider?: Provider;
  chainId?: number;
  wallets: WalletOption[];
  walletError: string;
  connecting: boolean;
  walletOpen: boolean;
  setWalletOpen: (value: boolean) => void;
  connect: (option: WalletOption) => Promise<void>;
  disconnect: () => void;
  switchChain: () => Promise<void>;
  txBusy: boolean;
  transact: (
    build: () => Promise<Call> | Call,
    stage: (s: TxStage) => void,
  ) => Promise<void>;
};
const Context = createContext<AppContext | null>(null);
export const useApp = () => {
  const c = useContext(Context);
  if (!c) throw Error("Missing app context");
  return c;
};
export function AppProvider({
  runtime,
  children,
}: {
  runtime: Runtime;
  children: ReactNode;
}) {
  const [provider, setProvider] = useState<Provider>();
  const [account, setAccount] = useState<Address>();
  const [chainId, setChainId] = useState<number>();
  const [wallets, setWallets] = useState<WalletOption[]>([]);
  const [walletOpen, setWalletOpen] = useState(false);
  const [walletError, setWalletError] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [state, setState] = useState<DeskState>();
  const [verified, setVerified] = useState(false);
  const [reading, setReading] = useState(true);
  const [readError, setReadError] = useState("");
  const [revision, setRevision] = useState(0);
  const [txBusy, setTxBusy] = useState(false);
  const txLock = useRef(false);
  const verifyEpoch = useRef(0);
  const api = useMemo(
    () =>
      new DeskApi(
        runtime,
        chainId === runtime.deployment.chainId ? provider : undefined,
      ),
    [runtime, provider, chainId],
  );
  useEffect(() => {
    const announce = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (!detail?.provider || !detail?.info) return;
      setWallets((current) =>
        current.some((w) => w.provider === detail.provider)
          ? current
          : [
              ...current,
              {
                id: detail.info.uuid,
                name: detail.info.name,
                provider: detail.provider,
              },
            ],
      );
    };
    window.addEventListener("eip6963:announceProvider", announce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    const injected = (window as unknown as { ethereum?: Provider }).ethereum;
    if (injected)
      for (const [index, p] of (injected.providers ?? [injected]).entries())
        setWallets((current) =>
          current.some((w) => w.provider === p)
            ? current
            : [
                ...current,
                {
                  id: `injected-${index}`,
                  name: p.isMetaMask
                    ? "MetaMask"
                    : p.isCoinbaseWallet
                      ? "Coinbase Wallet"
                      : "Browser wallet",
                  provider: p,
                },
              ],
        );
    return () =>
      window.removeEventListener("eip6963:announceProvider", announce);
  }, []);
  useEffect(() => {
    if (!provider) return;
    const accounts = (values: string[]) => {
      setAccount(values[0] ? getAddress(values[0]) : undefined);
    };
    const chain = (id: string) => {
      setChainId(Number(id));
      setVerified(false);
    };
    const disconnect = () => {
      setAccount(undefined);
      setChainId(undefined);
      setProvider(undefined);
    };
    provider.on?.("accountsChanged", accounts);
    provider.on?.("chainChanged", chain);
    provider.on?.("disconnect", disconnect);
    return () => {
      provider.removeListener?.("accountsChanged", accounts);
      provider.removeListener?.("chainChanged", chain);
      provider.removeListener?.("disconnect", disconnect);
    };
  }, [provider]);
  const refresh = useCallback(async () => {
    const epoch = ++verifyEpoch.current;
    setReading(true);
    try {
      const next = await api.verify();
      if (epoch !== verifyEpoch.current) return;
      setState(next);
      setVerified(true);
      setReadError("");
      setRevision((n) => n + 1);
    } catch (e) {
      if (epoch === verifyEpoch.current) {
        setReadError(explain(e, runtime.abis));
        setVerified(false);
      }
    } finally {
      if (epoch === verifyEpoch.current) setReading(false);
    }
  }, [api]);
  useEffect(() => {
    setVerified(false);
    setState(undefined);
    void refresh();
    return () => {
      verifyEpoch.current++;
    };
  }, [refresh]);
  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible" && !txLock.current)
        void refresh();
    }, 30000);
    return () => clearInterval(interval);
  }, [refresh]);
  async function connect(option: WalletOption) {
    if (connecting) return;
    setConnecting(true);
    setWalletError("");
    try {
      const accounts = await option.provider.request({
        method: "eth_requestAccounts",
      });
      const chain = await option.provider.request({ method: "eth_chainId" });
      if (!accounts[0]) throw Error("No account was shared by the wallet.");
      setProvider(option.provider);
      setAccount(getAddress(accounts[0]));
      setChainId(Number(chain));
      setWalletOpen(false);
    } catch (e) {
      setWalletError(explain(e, runtime.abis));
    } finally {
      setConnecting(false);
    }
  }
  async function switchChain() {
    if (!provider || connecting) return;
    setConnecting(true);
    setWalletError("");
    try {
      await switchNetwork(provider, runtime);
      setChainId(Number(await provider.request({ method: "eth_chainId" })));
    } catch (e) {
      setWalletError(explain(e, runtime.abis));
    } finally {
      setConnecting(false);
    }
  }
  async function transact(
    build: () => Promise<Call> | Call,
    onStage: (s: TxStage) => void,
  ) {
    if (txLock.current) return;
    if (!account || !provider) {
      setWalletOpen(true);
      return;
    }
    if (chainId !== runtime.deployment.chainId || !verified) {
      onStage({
        status: "error",
        message:
          "Connect to the configured network and retry deployment verification first.",
      });
      return;
    }
    txLock.current = true;
    setTxBusy(true);
    try {
      onStage({
        status: "checking",
        message: "Checking the latest contract state…",
      });
      const call = await build();
      await api.send(provider, account, call, onStage);
      await refresh();
    } catch (e) {
      onStage({ status: "error", message: explain(e, runtime.abis) });
    } finally {
      txLock.current = false;
      setTxBusy(false);
    }
  }
  return (
    <Context.Provider
      value={{
        runtime,
        api,
        state,
        verified,
        reading,
        readError,
        refresh,
        revision,
        account,
        provider,
        chainId,
        wallets,
        walletError,
        connecting,
        walletOpen,
        setWalletOpen,
        connect,
        disconnect: () => {
          setAccount(undefined);
          setProvider(undefined);
          setChainId(undefined);
          setWalletOpen(false);
        },
        switchChain,
        txBusy,
        transact,
      }}
    >
      {children}
    </Context.Provider>
  );
}
