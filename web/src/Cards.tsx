import { useEffect, useState } from "react";
import { type Address, zeroAddress } from "viem";
import { useApp } from "./context";
import {
  AddressText,
  Badge,
  Empty,
  Field,
  ReadAction,
  SpendAction,
  TxAction,
} from "./components";
import {
  address,
  amount,
  same,
  short,
  units,
  validateName,
  explain,
} from "./logic";
import type { CardEntry, Coin } from "./types";
function Deposit({ card }: { card: CardEntry }) {
  const c = useApp();
  const [text, setText] = useState("");
  let value: bigint | undefined;
  try {
    value = amount(text, c.state?.imdDecimals);
  } catch {
    /* validate on action */
  }
  return (
    <section className="control-section">
      <h3>1. Fund this card</h3>
      <Field
        label="Deposit amount (IMD)"
        value={text}
        onChange={setText}
        inputMode="decimal"
        hint="Only this card can trade its deposited funds."
      />
      <SpendAction
        label="Deposit IMD"
        token={c.api.imd}
        spender={c.api.desk}
        value={value}
        build={() =>
          c.api.call("deposit", [card.id, amount(text, c.state?.imdDecimals)])
        }
      />
    </section>
  );
}
function AgentSettings({ card }: { card: CardEntry }) {
  const c = useApp();
  const [agent, setAgent] = useState(
    card.agent === zeroAddress ? "" : card.agent,
  );
  useEffect(
    () => setAgent(card.agent === zeroAddress ? "" : card.agent),
    [card.id, card.agent],
  );
  return (
    <section className="control-section">
      <h3>2. Assign the agent</h3>
      <p>
        Use a separate wallet for the agent. Its key can trade this card, but
        cannot withdraw.
      </p>
      <Field
        label="Agent wallet address"
        validate={address}
        value={agent}
        onChange={setAgent}
        placeholder="0x…"
      />
      <TxAction
        label="Set agent"
        build={() => c.api.call("setAgent", [card.id, address(agent)])}
      />
      {card.agent !== zeroAddress && (
        <>
          <small>Current agent</small>
          <AddressText address={card.agent} />
          <TxAction
            label="Revoke agent"
            build={() => c.api.call("setAgent", [card.id, zeroAddress])}
          />
        </>
      )}
    </section>
  );
}
function Rules({ card }: { card: CardEntry }) {
  const c = useApp();
  const [daily, setDaily] = useState(units(card.dailyCap));
  const [per, setPer] = useState(units(card.maxPerTrade));
  const [spent, setSpent] = useState<bigint>();
  useEffect(() => {
    setDaily(units(card.dailyCap));
    setPer(units(card.maxPerTrade));
  }, [card.id, card.dailyCap, card.maxPerTrade]);
  useEffect(() => {
    let active = true;
    void c.api
      .read<bigint>("spentToday", [card.id])
      .then((s) => {
        if (active) setSpent(s);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [c.api, card.id, c.revision]);
  return (
    <section className="control-section">
      <h3>3. Set buy limits</h3>
      <div className="field-pair">
        <Field
          label="Daily cap (IMD)"
          value={daily}
          onChange={setDaily}
          inputMode="decimal"
        />
        <Field
          label="Maximum per trade (IMD)"
          value={per}
          onChange={setPer}
          inputMode="decimal"
        />
      </div>
      <small>
        UTC day. Spent today:{" "}
        {spent !== undefined ? `${units(spent)} IMD` : "Loading…"}. Zero limits
        disable buys. Sells are unaffected.
      </small>
      <TxAction
        label="Save rules"
        build={() =>
          c.api.call("setRules", [
            card.id,
            amount(daily, 18, true),
            amount(per, 18, true),
          ])
        }
      />
    </section>
  );
}
function Withdraw({ card, coins }: { card: CardEntry; coins: Coin[] }) {
  const c = useApp();
  const [token, setToken] = useState<Address>(c.api.imd);
  const [text, setText] = useState("");
  const coin = coins.find((x) => same(x.address, token));
  return (
    <section className="control-section">
      <h3>Withdraw to your wallet</h3>
      <div className="field">
        <label htmlFor="withdraw-coin">Coin</label>
        <select
          id="withdraw-coin"
          value={token}
          onChange={(e) => {
            setToken(e.target.value as Address);
            setText("");
          }}
        >
          {coins.map((coin) => (
            <option key={coin.address} value={coin.address}>
              {coin.symbol} · {short(coin.balance, coin.decimals)}
            </option>
          ))}
        </select>
      </div>
      <Field
        label={`Withdrawal amount (${coin?.symbol ?? "token"})`}
        value={text}
        onChange={setText}
        inputMode="decimal"
      />
      {coin && (
        <button
          className="text-button"
          onClick={() => setText(units(coin.balance, coin.decimals))}
        >
          Use full balance
        </button>
      )}
      <small>
        Funds return only to the permanent holder. Withdrawing a traded coin
        removes proportional cost basis without recording a win or loss.
      </small>
      <TxAction
        label="Withdraw funds"
        disabled={!coin || coin.balance === 0n}
        reason="The selected coin needs a positive balance."
        build={async () => {
          if (!coin) throw Error("Select a coin.");
          const value = amount(text, coin.decimals);
          const latest = await c.api.read<bigint>("balances", [card.id, token]);
          if (value > latest) throw Error("InsufficientBalance");
          return c.api.call("withdraw", [card.id, token, value]);
        }}
      />
    </section>
  );
}
export function ManageCard({
  card,
  printed = false,
}: {
  card: CardEntry;
  printed?: boolean;
}) {
  const c = useApp();
  const [coins, setCoins] = useState<Coin[]>([]);
  const [error, setError] = useState("");
  const [coinsLoading, setCoinsLoading] = useState(true);
  const [name, setName] = useState(card.name);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let active = true;
    setCoinsLoading(true);
    setCoins([]);
    setError("");
    if (c.account && same(c.account, card.holder))
      void c.api
        .balances(card, c.account)
        .then(
          (coins) => {
            if (active) setCoins(coins);
          },
          (e) => {
            if (active) setError(explain(e));
          },
        )
        .finally(() => {
          if (active) setCoinsLoading(false);
        });
    return () => {
      active = false;
    };
  }, [c.api, c.account, card.id, c.revision, nonce]);
  if (!same(card.holder, c.account))
    return (
      <Empty>Connect the permanent holder wallet to manage this card.</Empty>
    );
  const setup =
    coins.some((x) => same(x.address, c.api.imd) && x.balance > 0n) &&
    card.agent !== zeroAddress &&
    card.dailyCap > 0n &&
    card.maxPerTrade > 0n;
  return (
    <div className="manage-grid">
      <div>
        <div className="section-heading">
          <h2>{card.name}</h2>
          <a href={`#/agent/${card.id}`}>Public record ↗</a>
        </div>
        <p className={card.frozen ? "loss" : "muted"}>
          {card.frozen
            ? "Frozen: all agent trading is stopped."
            : setup
              ? "Set up: the agent can trade within your rules."
              : "Setup needed: fund the card, assign an agent, and set buy limits."}
        </p>
        <section className="balance-section">
          <h3>Your card’s balances</h3>
          {coinsLoading ? (
            <p role="status">Reading balances and IMD estimates…</p>
          ) : error ? (
            <p role="alert" className="error">
              {error}
              <button onClick={() => setNonce((n) => n + 1)}>
                Retry balances
              </button>
            </p>
          ) : (
            <>
              <div className="balance-head">
                <span>Coin / balance</span>
                <span>Estimated value</span>
              </div>
              {coins.map((coin) => (
                <div className="balance-row" key={coin.address}>
                  <div>
                    <strong>{coin.symbol}</strong>
                    <div className="numeric wrap">
                      {units(coin.balance, coin.decimals)}
                    </div>
                    <details>
                      <summary>Token details</summary>
                      <AddressText address={coin.address} />
                      {!same(coin.address, c.api.imd) && (
                        <small>
                          Position cost: {units(coin.cost)} IMD · Quantity:{" "}
                          {units(coin.quantity, coin.decimals)}
                        </small>
                      )}
                    </details>
                  </div>
                  <div className="numeric wrap">
                    {coin.value === undefined
                      ? "Quote unavailable"
                      : `${short(coin.value)} IMD`}
                  </div>
                </div>
              ))}
              <small>
                Coin values are current full-position sell quotes after the
                0.25% desk fee. Estimates can change. USD prices are
                unavailable.
              </small>
            </>
          )}
        </section>
        <div className="controls-grid">
          <Deposit card={card} />
          <AgentSettings card={card} />
          <Rules card={card} />
          <section className="control-section">
            <h3>{card.frozen ? "Resume trading" : "Stop agent trading"}</h3>
            <p>
              {card.frozen
                ? "Unfreezing restores the agent’s existing permissions and limits."
                : "Freeze stops buys and sells immediately after confirmation. You can still withdraw."}
            </p>
            <TxAction
              label={card.frozen ? "Unfreeze card" : "Freeze card"}
              build={() =>
                c.api.call(card.frozen ? "unfreeze" : "freeze", [card.id])
              }
            />
          </section>
          <Withdraw card={card} coins={coins} />
          <section className="control-section">
            <h3>Rename this card</h3>
            <Field
              label="Card name"
              validate={validateName}
              value={name}
              onChange={setName}
              maxLength={24}
            />
            <TxAction
              label="Rename card"
              build={() => c.api.call("rename", [card.id, validateName(name)])}
            />
          </section>
        </div>
      </div>
      <div className="managed-badge">
        <Badge card={card} printed={printed} />
        <div className="holder-note">
          <strong>Permanent holder</strong>
          <AddressText address={card.holder} />
          <p>Only this wallet can withdraw. This card cannot be transferred.</p>
        </div>
      </div>
    </div>
  );
}
export function MyCards({
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
  const owned = cards.filter((card) => same(card.holder, c.account));
  const newId =
    new URLSearchParams(location.hash.split("?")[1] || "").get("new") || "";
  const [selected, setSelected] = useState<string>(newId);
  const [lookup, setLookup] = useState("");
  const [found, setFound] = useState<CardEntry>();
  const selectedCard =
    [...owned, ...(found ? [found] : [])].find(
      (card) => card.id.toString() === selected,
    ) ??
    owned[0] ??
    found;
  useEffect(() => {
    let active = true;
    setFound(undefined);
    setSelected(newId);
    if (
      c.account &&
      c.state?.cards &&
      /^\d+$/.test(newId) &&
      BigInt(newId) > 0n
    ) {
      void c.api
        .card(BigInt(newId), c.state.cards)
        .then((card) => {
          if (active && same(card.holder, c.account)) setFound(card);
        })
        .catch(() => {});
    }
    return () => {
      active = false;
    };
  }, [c.account, c.api, c.state?.cards, newId]);
  useEffect(() => {
    if (found && c.state)
      void c.api
        .card(found.id, c.state.cards)
        .then(setFound)
        .catch(() => {});
  }, [c.revision]);
  return (
    <>
      <div className="page-heading">
        <h1>My cards</h1>
        <p>Fund the agent. Set the limits. Keep the keys.</p>
      </div>
      {!c.account ? (
        <Empty>
          <p>Connect the holder wallet to find and manage your cards.</p>
          <button className="primary" onClick={() => c.setWalletOpen(true)}>
            Connect wallet
          </button>
        </Empty>
      ) : (
        <>
          <div className="card-picker">
            {owned.map((card) => (
              <button
                key={card.id.toString()}
                aria-pressed={selectedCard?.id === card.id}
                onClick={() => setSelected(card.id.toString())}
              >
                #{card.id.toString().padStart(4, "0")} · {card.name}
              </button>
            ))}
          </div>
          {selectedCard ? (
            <ManageCard
              key={selectedCard.id.toString()}
              card={selectedCard}
              printed={selectedCard.id.toString() === newId}
            />
          ) : (
            <Empty>
              {loading
                ? "Looking for your cards…"
                : "No cards belonging to this wallet in the records loaded. Mint a card or load more records."}
              <a href="#/">Mint a card →</a>
            </Empty>
          )}
          <div className="lookup-row">
            <div>
              <small>
                {c.state
                  ? `Scanned ${scanned} of ${c.state.totalCards} cards.`
                  : "Waiting for contract reads."}
              </small>
              {((c.state && scanned < c.state.totalCards) || error) && (
                <ReadAction
                  label="Find more cards"
                  run={loadMore}
                  disabled={loading}
                />
              )}
            </div>
            <div className="lookup-form">
              <Field
                label="Open your card by ID"
                value={lookup}
                onChange={setLookup}
                inputMode="numeric"
              />
              <ReadAction
                label="Open card"
                disabled={!c.verified}
                run={async () => {
                  if (!/^\d+$/.test(lookup) || BigInt(lookup) === 0n)
                    throw Error("Enter a positive card ID.");
                  const card = await c.api.card(BigInt(lookup), c.state!.cards);
                  if (!same(card.holder, c.account))
                    throw Error(
                      "This card belongs to another wallet. Use its public agent page to view the record.",
                    );
                  setFound(card);
                  setSelected(lookup);
                }}
              />
            </div>
          </div>
          <p className="muted">
            This page filters balances to your own cards. Blockchain balances
            are public, not private.
          </p>
        </>
      )}
    </>
  );
}
