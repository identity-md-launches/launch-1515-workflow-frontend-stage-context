import { useEffect, useState } from "react";
import { useApp } from "./context";
import {
  Badge,
  Field,
  QuoteView,
  ReadAction,
  SpendAction,
  Empty,
} from "./components";
import {
  checkQuote,
  rank,
  same,
  short,
  slippage,
  units,
  validateName,
  winRate,
} from "./logic";
import type { CardEntry, Quote } from "./types";
export function MintPanel() {
  const c = useApp();
  const [name, setName] = useState("");
  const [slip, setSlip] = useState("0.5");
  const [quote, setQuote] = useState<Quote>();
  const [minted, setMinted] = useState(false);
  const [mintedId, setMintedId] = useState<bigint>();
  const [walletBalance, setWalletBalance] = useState<bigint>();
  useEffect(() => {
    setQuote(undefined);
  }, [slip, c.state?.mintPrice]);
  useEffect(() => {
    let active = true;
    setWalletBalance(undefined);
    if (c.account && c.verified)
      void c.api
        .token<bigint>(c.api.imd, "balanceOf", [c.account])
        .then((b) => {
          if (active) setWalletBalance(b);
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [c.api, c.account, c.revision, c.verified]);
  if (minted)
    return (
      <section className="mint-panel">
        <h2>Your card is issued.</h2>
        <p>
          The next steps are yours: fund it, assign an agent, and set its
          limits.
        </p>
        <ol className="checklist">
          <li>Deposit IMD into the card.</li>
          <li>Set your agent’s public address.</li>
          <li>Set a daily cap and maximum per trade.</li>
        </ol>
        <a
          className="button primary"
          href={mintedId ? `#/cards?new=${mintedId}` : "#/cards"}
        >
          Set up my card →
        </a>
        <button
          className="text-button"
          onClick={() => {
            setMinted(false);
            setName("");
            setQuote(undefined);
          }}
        >
          Mint another card
        </button>
      </section>
    );
  return (
    <section className="mint-panel" aria-label="Mint a card">
      <div className="section-heading">
        <h2>Issue an agent card</h2>
        <span className="numeric price">
          {c.state
            ? `${short(c.state.mintPrice, c.state.imdDecimals)} IMD`
            : "Price loading"}
        </span>
      </div>
      <Field
        label="Agent name"
        validate={validateName}
        value={name}
        onChange={setName}
        placeholder="Give your agent a name"
        maxLength={24}
        hint="1–24 letters, numbers, spaces or dashes."
      />
      {c.account && (
        <small>
          Wallet balance:{" "}
          {walletBalance === undefined
            ? "Loading…"
            : `${units(walletBalance, c.state?.imdDecimals)} IMD`}
        </small>
      )}
      <details className="settings">
        <summary>Slippage &amp; mint details</summary>
        <Field
          label="Slippage tolerance (%)"
          value={slip}
          onChange={setSlip}
          inputMode="decimal"
        />
        <p>
          The card stays with this wallet. Half the mint payment goes to the
          launch owner; half buys and burns HIC. Network fees are paid in ETH.
        </p>
        <p>No trading is allowed until you set an agent and buy limits.</p>
      </details>
      {c.account && (
        <>
          <ReadAction
            label="Get mint quote"
            disabled={!c.verified || !c.state?.tradable}
            run={async () => {
              validateName(name);
              if (!c.state) throw Error("Wait for the current mint price.");
              const price = await c.api.read<bigint>("mintPrice");
              if (price !== c.state.mintPrice) {
                await c.refresh();
                throw Error(
                  "The mint price changed. Review the new price and quote again.",
                );
              }
              setQuote(
                await c.api.quote(
                  c.api.imd,
                  c.api.hic,
                  price - price / 2n,
                  slippage(slip),
                ),
              );
            }}
          />
          <QuoteView
            quote={quote}
            symbol="HIC to burn"
            decimals={c.state?.hicDecimals ?? 18}
          />
        </>
      )}
      <SpendAction
        exactAllowance
        token={c.api.imd}
        spender={c.api.desk}
        value={c.state?.mintPrice}
        label="Mint agent card"
        disabled={!c.state?.tradable || !quote}
        reason={
          !c.state?.tradable
            ? "Minting needs an initialized HIC pool."
            : "Get a mint quote to continue."
        }
        onSuccess={(id) => {
          setMintedId(id);
          setMinted(true);
        }}
        build={async () => {
          validateName(name);
          const price = await c.api.read<bigint>("mintPrice");
          if (price !== c.state?.mintPrice)
            throw Error("The mint price changed. Refresh and get a new quote.");
          checkQuote(
            quote,
            c.api.imd,
            price - price / 2n,
            c.api.hic,
            slippage(slip),
          );
          return c.api.call("mint", [name, quote!.minOut]);
        }}
      />
    </section>
  );
}
export function Leaderboard({
  cards,
  scanned,
  total,
  loadMore,
  loading,
  error,
}: {
  cards: CardEntry[];
  scanned: bigint;
  total?: bigint;
  loadMore: () => Promise<void>;
  loading: boolean;
  error: string;
}) {
  const [sort, setSort] = useState<"rate" | "pnl">("rate");
  const list = rank(cards, sort);
  return (
    <section className="leaderboard">
      <div className="section-heading">
        <h2>The record speaks.</h2>
        <div className="select-label">
          <label htmlFor="rank-sort">Rank by</label>
          <select
            id="rank-sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as "rate" | "pnl")}
          >
            <option value="rate">Win rate</option>
            <option value="pnl">Realized P&amp;L</option>
          </select>
        </div>
      </div>
      <p className="muted">
        At least 10 closed trades. Every result read from the desk.
      </p>
      {list.length ? (
        <div className="ranking-list">
          <div className="rank-labels" aria-hidden="true">
            <span>Agent</span>
            <span>Win rate</span>
            <span>Realized P&amp;L</span>
          </div>
          {list.map((card, i) => (
            <a
              className="rank-row"
              href={`#/agent/${card.id}`}
              key={card.id.toString()}
            >
              <span>
                <span className="rank-number numeric">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <strong>{card.name}</strong>
                <small>
                  #{card.id.toString().padStart(4, "0")} ·{" "}
                  {(card.wins + card.losses).toString()} closed
                </small>
              </span>
              <span className="numeric">{winRate(card)}</span>
              <span className={`numeric ${card.pnl >= 0n ? "win" : "loss"}`}>
                {card.pnl >= 0n ? "+" : ""}
                {short(card.pnl)} IMD
              </span>
            </a>
          ))}
        </div>
      ) : (
        <Empty>
          {loading
            ? "Reading agent records…"
            : error
              ? "Records could not be loaded. Retry below."
              : total === undefined
                ? "Connect to the public network to load agent records."
                : "No qualifying cards in the records loaded so far. An agent needs 10 closed trades to enter."}
        </Empty>
      )}
      <div className="row spread">
        <small>
          {total !== undefined
            ? `${scanned} of ${total} cards scanned${scanned < total ? "; ranking covers only these cards." : "."}`
            : "Live ranking unavailable until reads succeed."}
        </small>
        {((total !== undefined && scanned < total) || error) && (
          <ReadAction
            label={error ? "Retry records" : "Load more records"}
            run={loadMore}
            disabled={loading}
          />
        )}
      </div>
    </section>
  );
}
export function Home({
  cards,
  scanned,
  loadMore,
  loading,
  error,
}: {
  cards: CardEntry[];
  scanned: bigint;
  loadMore: () => Promise<void>;
  loading: boolean;
  error: string;
}) {
  const c = useApp();
  return (
    <>
      <div className="home-grid">
        <div className="intro">
          <h1>
            Mint your
            <br />
            agent’s card.
          </h1>
          <p className="tagline">You’re the handler. Your AI is the agent.</p>
          <MintPanel />
        </div>
        <div className="example-display">
          <Badge example />
        </div>
      </div>
      <section className="explain-strip">
        <h2>
          A trading key.
          <br />
          Not a withdrawal key.
        </h2>
        <div>
          <p>
            A leaked agent key can empty a wallet.
            <br />A Handler Card gives the agent a balance and rules you
            control.
          </p>
          <p className="muted">
            You fund it. It trades within your limits. Only you can withdraw.
          </p>
        </div>
      </section>
      <Leaderboard
        cards={cards}
        scanned={scanned}
        total={c.state?.totalCards}
        loadMore={loadMore}
        loading={loading}
        error={error}
      />
    </>
  );
}
