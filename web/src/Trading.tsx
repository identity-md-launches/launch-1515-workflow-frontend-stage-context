import { useState, useEffect } from "react";
import { type Address } from "viem";
import { useApp } from "./context";
import {
  AddressText,
  Field,
  QuoteView,
  ReadAction,
  TxAction,
} from "./components";
import {
  address,
  amount,
  checkQuote,
  explain,
  same,
  short,
  slippage,
  units,
  routerInput,
} from "./logic";
import type { CardEntry, Quote } from "./types";
export function WalletSwap() {
  const c = useApp();
  const [buy, setBuy] = useState(true);
  const [input, setInput] = useState("");
  const [slip, setSlip] = useState("0.5");
  const [quote, setQuote] = useState<Quote>();
  const [ercAllowance, setErcAllowance] = useState<bigint>();
  const [permit, setPermit] = useState<readonly [bigint, number, number]>();
  const [balance, setBalance] = useState<bigint>();
  const [error, setError] = useState("");
  const [nonce, setNonce] = useState(0);
  const tokenIn = buy ? c.api.imd : c.api.hic,
    tokenOut = buy ? c.api.hic : c.api.imd;
  const symbolIn = buy ? "IMD" : "HIC",
    symbolOut = buy ? "HIC" : "IMD";
  const decimalsIn = (buy ? c.state?.imdDecimals : c.state?.hicDecimals) ?? 18,
    decimalsOut = (buy ? c.state?.hicDecimals : c.state?.imdDecimals) ?? 18;
  const n = c.runtime.deployment.network.uniswapV4;
  let value: bigint | undefined;
  try {
    value = amount(input, decimalsIn);
  } catch {
    /* shown when quoted */
  }
  useEffect(() => {
    setQuote(undefined);
  }, [input, slip, buy]);
  useEffect(() => {
    let active = true;
    setErcAllowance(undefined);
    setPermit(undefined);
    setBalance(undefined);
    setError("");
    if (c.account && c.verified)
      void Promise.all([
        c.api.token<bigint>(tokenIn, "allowance", [c.account, n.permit2]),
        c.api.read<readonly [bigint, number, number]>(
          "allowance",
          [c.account, tokenIn, n.universalRouter],
          n.permit2,
          c.api.abi("Permit2"),
        ),
        c.api.token<bigint>(tokenIn, "balanceOf", [c.account]),
      ]).then(
        ([erc, p, b]) => {
          if (active) {
            setErcAllowance(erc);
            setPermit(p);
            setBalance(b);
          }
        },
        (e) => {
          if (active) setError(explain(e));
        },
      );
    return () => {
      active = false;
    };
  }, [c.api, c.account, tokenIn, c.revision, c.verified, nonce]);
  const ready = !!value && !!quote && !!c.state?.tradable;
  const approveToken =
    !!value && ercAllowance !== undefined && ercAllowance < value;
  const approveRouter =
    !!value &&
    permit !== undefined &&
    (permit[0] < value || BigInt(permit[1]) < (c.state?.time ?? 0n) + 60n);
  const reset = () => {
    setErcAllowance(undefined);
    setPermit(undefined);
    setNonce((n) => n + 1);
  };
  return (
    <section className="swap-panel">
      <h2>Swap HIC &amp; IMD</h2>
      <p>Swap from your wallet on the attested launch pool.</p>
      <div className="field">
        <label htmlFor="wallet-direction">Direction</label>
        <select
          id="wallet-direction"
          value={buy ? "buy" : "sell"}
          onChange={(e) => {
            setBuy(e.target.value === "buy");
            setInput("");
          }}
        >
          <option value="buy">Buy HIC with IMD</option>
          <option value="sell">Sell HIC for IMD</option>
        </select>
      </div>
      <Field
        label={`You pay (${symbolIn})`}
        value={input}
        onChange={setInput}
        inputMode="decimal"
      />
      {c.account && (
        <small>
          Wallet balance:{" "}
          {balance === undefined
            ? "Loading…"
            : `${units(balance, decimalsIn)} ${symbolIn}`}
        </small>
      )}
      <Field
        label="Slippage tolerance (%)"
        value={slip}
        onChange={setSlip}
        inputMode="decimal"
        hint="The minimum output protects this swap. Quotes expire after 60 seconds."
      />
      <ReadAction
        label="Get swap quote"
        disabled={!c.verified || !c.state?.tradable}
        run={async () => {
          const v = amount(input, decimalsIn);
          if (balance !== undefined && v > balance)
            throw Error(`Your wallet does not have enough ${symbolIn}.`);
          setQuote(await c.api.quote(tokenIn, tokenOut, v, slippage(slip)));
        }}
      />
      <QuoteView
        quote={quote}
        symbol={symbolOut}
        decimals={decimalsOut}
        inputSymbol={symbolIn}
        inputDecimals={decimalsIn}
      />
      {approveToken ? (
        <>
          <p>
            Step 1 of 3: allow Permit2 to spend exactly{" "}
            {value ? units(value, decimalsIn) : ""} {symbolIn}.
          </p>
          <TxAction
            label={`Approve ${symbolIn} to Permit2`}
            primary
            disabled={!ready}
            reason="Get a quote before approving."
            onSuccess={reset}
            build={() => {
              checkQuote(
                quote,
                tokenIn,
                amount(input, decimalsIn),
                tokenOut,
                slippage(slip),
              );
              return c.api.call(
                "approve",
                [n.permit2, value!],
                tokenIn,
                c.api.abi("ERC20"),
              );
            }}
          />
        </>
      ) : approveRouter ? (
        <>
          <p>
            Step 2 of 3: allow the router to spend this amount through Permit2
            for 20 minutes.
          </p>
          <TxAction
            label="Authorize router amount"
            primary
            disabled={!ready}
            onSuccess={reset}
            build={async () => {
              checkQuote(
                quote,
                tokenIn,
                amount(input, decimalsIn),
                tokenOut,
                slippage(slip),
              );
              const block = await c.api.public.getBlock();
              return c.api.call(
                "approve",
                [
                  tokenIn,
                  n.universalRouter,
                  value!,
                  Number(block.timestamp + 1200n),
                ],
                n.permit2,
                c.api.abi("Permit2"),
              );
            }}
          />
        </>
      ) : (
        <TxAction
          label={buy ? "Swap IMD for HIC" : "Swap HIC for IMD"}
          primary
          disabled={
            !ready || ercAllowance === undefined || permit === undefined
          }
          reason={!quote ? "Get a swap quote first." : "Checking allowances."}
          onSuccess={() => setQuote(undefined)}
          build={async () => {
            const v = amount(input, decimalsIn);
            checkQuote(quote, tokenIn, v, tokenOut, slippage(slip));
            const [erc, p, b, block] = await Promise.all([
              c.api.token<bigint>(tokenIn, "allowance", [
                c.account!,
                n.permit2,
              ]),
              c.api.read<readonly [bigint, number, number]>(
                "allowance",
                [c.account!, tokenIn, n.universalRouter],
                n.permit2,
                c.api.abi("Permit2"),
              ),
              c.api.token<bigint>(tokenIn, "balanceOf", [c.account!]),
              c.api.public.getBlock(),
            ]);
            if (erc < v || p[0] < v || BigInt(p[1]) <= block.timestamp) {
              reset();
              throw Error(
                "An allowance changed or expired. Review the approval step.",
              );
            }
            if (b < v)
              throw Error(`Your wallet does not have enough ${symbolIn}.`);
            const data = routerInput(
              c.runtime.deployment.poolKey,
              tokenIn,
              v,
              quote!.minOut,
              n.extendedSwapParams,
            );
            return {
              ...c.api.call(
                "execute",
                ["0x10", [data], block.timestamp + 1200n],
                n.universalRouter,
                c.api.abi("UniversalRouter"),
              ),
              value: 0n,
            };
          }}
        />
      )}
      <div role="alert" className="error">
        {error}
        {error && <button onClick={reset}>Retry allowances</button>}
      </div>
      <p className="muted">
        Pool fee: {c.runtime.deployment.poolKey.fee / 10000}%. No desk fee on
        wallet swaps. Estimates include pool fees. ETH pays network fees; IMD or
        HIC pays the swap. USD context is unavailable.
      </p>
      <details>
        <summary>Approval recipients</summary>
        <strong>Permit2</strong>
        <AddressText address={n.permit2} />
        <strong>Universal Router</strong>
        <AddressText address={n.universalRouter} />
      </details>
    </section>
  );
}
export function AgentTrade({ card }: { card: CardEntry }) {
  const c = useApp();
  const [buy, setBuy] = useState(true);
  const [tokenText, setTokenText] = useState(c.api.hic);
  const [text, setText] = useState("");
  const [slip, setSlip] = useState("0.5");
  const [quote, setQuote] = useState<Quote>();
  const [tokenInfo, setTokenInfo] = useState<{
    address: Address;
    symbol: string;
    decimals: number;
  }>();
  const isAgent = same(c.account, card.agent);
  const unavailable = !isAgent || card.frozen;
  useEffect(() => {
    setQuote(undefined);
    setTokenInfo(undefined);
  }, [tokenText, text, slip, buy, card.id]);
  return (
    <section className="agent-trade">
      <h2>Agent trading desk</h2>
      <p>
        Trades spend this card’s balance. Only its assigned agent can submit
        them.
      </p>
      {!isAgent && (
        <p className="notice">
          Connect the assigned agent wallet to trade. The holder configures the
          agent in My cards.
        </p>
      )}
      {card.frozen && (
        <p className="notice loss">
          This card is frozen. The holder must unfreeze it before trading.
        </p>
      )}
      <div className="field">
        <label htmlFor="agent-direction">Trade direction</label>
        <select
          id="agent-direction"
          value={buy ? "buy" : "sell"}
          onChange={(e) => setBuy(e.target.value === "buy")}
        >
          <option value="buy">Buy a launch coin with card IMD</option>
          <option value="sell">Sell a card coin for IMD</option>
        </select>
      </div>
      <Field
        label="Launch coin address"
        validate={address}
        value={tokenText}
        onChange={(v) => setTokenText(v as Address)}
        hint="Only initialized IMD launch pools are eligible."
      />
      <Field
        label={
          buy
            ? "Buy budget (IMD, including desk fee)"
            : "Sell amount (coin units)"
        }
        value={text}
        onChange={setText}
        inputMode="decimal"
      />
      <Field
        label="Slippage tolerance (%)"
        value={slip}
        onChange={setSlip}
        inputMode="decimal"
      />
      <ReadAction
        label="Quote card trade"
        disabled={!c.verified || unavailable}
        run={async () => {
          const token = address(tokenText);
          const [symbol, decimals] = await Promise.all([
            c.api.token<string>(token, "symbol"),
            c.api.token<number>(token, "decimals"),
          ]);
          const value = amount(text, buy ? 18 : decimals);
          const latest = await c.api.read<CardEntry>("getCard", [card.id]);
          if (!same(latest.agent, c.account)) throw Error("OnlyAgent");
          if (latest.frozen) throw Error("CardFrozen");
          const balance = await c.api.read<bigint>("balances", [
            card.id,
            buy ? c.api.imd : token,
          ]);
          if (balance < value) throw Error("InsufficientBalance");
          if (buy) {
            const spent = await c.api.read<bigint>("spentToday", [card.id]);
            if (value > latest.maxPerTrade) throw Error("PerTradeLimit");
            if (spent + value > latest.dailyCap) throw Error("DailyLimit");
          }
          const q = await c.api.quote(
            buy ? c.api.imd : token,
            buy ? token : c.api.imd,
            buy ? value - value / 400n : value,
            slippage(slip),
            !buy,
          );
          setTokenInfo({ address: token, symbol, decimals });
          setQuote(q);
        }}
      />
      <QuoteView
        quote={quote}
        symbol={buy ? (tokenInfo?.symbol ?? "coin") : "IMD net"}
        decimals={buy ? (tokenInfo?.decimals ?? 18) : 18}
      />
      <TxAction
        label={buy ? "Buy for this card" : "Sell from this card"}
        primary
        disabled={unavailable || !quote}
        reason={
          card.frozen
            ? "Card is frozen."
            : !isAgent
              ? "Only the assigned agent can trade."
              : "Get a quote first."
        }
        onSuccess={() => setQuote(undefined)}
        build={() => {
          if (!tokenInfo || !same(tokenInfo.address, address(tokenText)))
            throw Error("The coin changed. Get a fresh quote.");
          const value = amount(text, buy ? 18 : tokenInfo.decimals);
          checkQuote(
            quote,
            buy ? c.api.imd : tokenInfo.address,
            buy ? value - value / 400n : value,
            buy ? tokenInfo.address : c.api.imd,
            slippage(slip),
          );
          return c.api.call(buy ? "buy" : "sell", [
            card.id,
            tokenInfo.address,
            value,
            quote!.minOut,
          ]);
        }}
      />
      <small>
        Desk fee: 0.25% of IMD, plus {c.runtime.deployment.poolKey.fee / 10000}%
        pool fee. Buys quote after the desk fee; sells protect net IMD after the
        desk fee. No wallet token approval is needed for card trades.
      </small>
    </section>
  );
}
export function TokenTransfer() {
  const c = useApp();
  const [to, setTo] = useState("");
  const [text, setText] = useState("");
  return (
    <details className="transfer-panel">
      <summary>Send HIC to another wallet</summary>
      <p>
        This transfers HIC from your connected wallet. Confirm the full
        recipient address; token transfers cannot be undone.
      </p>
      <Field
        label="Recipient address"
        validate={address}
        value={to}
        onChange={setTo}
      />
      <Field
        label="Amount (HIC)"
        value={text}
        onChange={setText}
        inputMode="decimal"
      />
      <TxAction
        label="Send HIC"
        build={() =>
          c.api.call(
            "transfer",
            [address(to), amount(text, c.state?.hicDecimals)],
            c.api.hic,
            c.api.abi("LaunchToken"),
          )
        }
      />
    </details>
  );
}
export function Trading() {
  return (
    <>
      <div className="page-heading">
        <h1>Trade HIC</h1>
        <p>Your wallet’s swap. Your card’s record stays separate.</p>
      </div>
      <div className="trading-grid">
        <WalletSwap />
        <aside className="trade-explainer">
          <h2>One pool. Clear permissions.</h2>
          <p>
            HIC is paired with IMD on Uniswap v4. Wallet swaps settle back to
            your connected wallet.
          </p>
          <p>
            To trade an agent card’s funds, open its public record and connect
            the assigned agent wallet.
          </p>
          <a className="button" href="#/cards">
            Open my cards →
          </a>
          <TokenTransfer />
        </aside>
      </div>
    </>
  );
}
