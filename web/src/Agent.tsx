import { useEffect, useState } from "react";
import { useApp } from "./context";
import { AddressText, Badge, Empty, Field, ReadAction } from "./components";
import { AgentTrade } from "./Trading";
import { explain, short, units, winRate } from "./logic";
import type { CardEntry } from "./types";
import type { DeskApi } from "./chain";
type History = Awaited<ReturnType<DeskApi["tradeHistory"]>>;
function TradeHistory({ card }: { card: CardEntry }) {
  const c = useApp();
  const [history, setHistory] = useState<History>([]);
  const [oldest, setOldest] = useState<bigint>();
  const [latest, setLatest] = useState<bigint>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [start, setStart] = useState("");
  async function load(to?: bigint, reset = false) {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const end = to ?? (await c.api.public.getBlockNumber());
      const from = end > 999n ? end - 999n : 0n;
      const logs = await c.api.tradeHistory(card.id, from, end);
      setHistory((current) =>
        reset
          ? logs
          : [...current, ...logs].filter(
              (l, i, a) =>
                a.findIndex(
                  (x) =>
                    x.transactionHash === l.transactionHash &&
                    x.logIndex === l.logIndex,
                ) === i,
            ),
      );
      setOldest(from);
      if (reset) setLatest(end);
    } catch (e) {
      setError(explain(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    setHistory([]);
    setOldest(undefined);
    setLatest(undefined);
    void load(undefined, true);
  }, [card.id, c.api]);
  return (
    <section className="history">
      <div className="section-heading">
        <h2>Trade history</h2>
        <button disabled={loading} onClick={() => void load(undefined, true)}>
          Refresh history
        </button>
      </div>
      <p className="muted">
        Events from the desk. Only sells close a result; buys are marked open.
      </p>
      {history.length ? (
        <div className="history-list">
          {history.map((log) => (
            <article
              className="history-row"
              key={`${log.transactionHash}-${log.logIndex}`}
            >
              <div>
                <strong>
                  {log.args.isBuy ? "Buy" : "Sell"} {log.coin.symbol}
                </strong>
                <time
                  dateTime={new Date(Number(log.time) * 1000).toISOString()}
                >
                  {new Date(Number(log.time) * 1000).toLocaleString()}
                </time>
              </div>
              <div>
                <span className="numeric">
                  {short(log.args.tokenAmount, log.coin.decimals)}{" "}
                  {log.coin.symbol}
                </span>
                <span className="numeric">{short(log.args.imdAmount)} IMD</span>
              </div>
              <div>
                <span
                  className={
                    log.args.isBuy ? "muted" : log.args.win ? "win" : "loss"
                  }
                >
                  {log.args.isBuy
                    ? "Open position"
                    : `${log.args.win ? "Win" : "Loss"} · ${log.args.pnl > 0 ? "+" : ""}${short(log.args.pnl)} IMD`}
                </span>
                <a
                  href={`${c.runtime.deployment.network.explorer}/tx/${log.transactionHash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View transaction ↗
                </a>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty>
          {loading
            ? "Reading recent trade events…"
            : error
              ? "Unable to load this block range."
              : "No trades found in the loaded block range."}
        </Empty>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="row spread">
        <small>
          {oldest !== undefined
            ? `Loaded blocks ${oldest}–${latest}. ${oldest > 0n ? "Older history is not loaded." : "Reached genesis."}`
            : "Each request loads up to 1,000 blocks."}
        </small>
        <button
          disabled={loading || oldest === 0n}
          onClick={() =>
            void load(
              oldest !== undefined && oldest > 0n ? oldest - 1n : undefined,
              oldest === undefined,
            )
          }
        >
          {loading
            ? "Loading events…"
            : error
              ? "Retry history"
              : "Load older blocks"}
        </button>
      </div>
      <details>
        <summary>Read a specific block range</summary>
        <Field
          label="Ending block number"
          value={start}
          onChange={setStart}
          inputMode="numeric"
          hint="Loads this block and up to 999 preceding blocks."
        />
        <ReadAction
          label="Read range"
          disabled={loading}
          run={async () => {
            if (!/^\d+$/.test(start))
              throw Error("Enter a valid block number.");
            if (BigInt(start) > (await c.api.public.getBlockNumber()))
              throw Error("This block has not been mined yet.");
            await load(BigInt(start), true);
          }}
        />
      </details>
    </section>
  );
}
export function Agent({ id }: { id: string }) {
  const c = useApp();
  const [card, setCard] = useState<CardEntry>();
  const [error, setError] = useState("");
  const [art, setArt] = useState<string>();
  const [artError, setArtError] = useState("");
  useEffect(() => {
    let active = true;
    setError("");
    setCard((current) => (current?.id.toString() === id ? current : undefined));
    setArtError("");
    if (!c.state) return;
    if (!/^\d+$/.test(id) || BigInt(id) === 0n) {
      setError("Enter a valid positive card ID.");
      return;
    }
    void c.api.card(BigInt(id), c.state.cards).then(
      (card) => {
        if (active) setCard(card);
      },
      (e) => {
        if (active) setError(explain(e));
      },
    );
    return () => {
      active = false;
    };
  }, [id, c.api, c.revision]);
  useEffect(() => setArt(undefined), [id]);
  const share = card
    ? `AGENT #${card.id.toString().padStart(4, "0")} · ${winRate(card)} win rate over ${(card.wins + card.losses).toString()} closed trades on $HIC`
    : "";
  return (
    <>
      <div className="page-heading">
        <a href="#/">← All agent records</a>
        <h1>{card ? card.name : `Agent #${id}`}</h1>
        <p>Trading history, recorded on chain.</p>
      </div>
      {error ? (
        <Empty>
          <p role="alert">{error}</p>
          <a href="#/">Return to the desk</a>
        </Empty>
      ) : !card ? (
        <Empty>
          {c.readError
            ? "Network reads are unavailable. Retry verification above."
            : "Loading agent record…"}
        </Empty>
      ) : (
        <>
          <div className="agent-grid">
            <div>
              <div className="record-stats">
                <div>
                  <span>Win rate</span>
                  <strong>{winRate(card)}</strong>
                </div>
                <div>
                  <span>Closed trades</span>
                  <strong>{(card.wins + card.losses).toString()}</strong>
                </div>
                <div>
                  <span>Realized P&amp;L</span>
                  <strong className={card.pnl >= 0n ? "win" : "loss"}>
                    {card.pnl > 0n ? "+" : ""}
                    {short(card.pnl)} <small>IMD</small>
                  </strong>
                </div>
                <div>
                  <span>Total trades</span>
                  <strong>{card.trades.toString()}</strong>
                </div>
              </div>
              <p className="muted">
                Wins count strictly profitable sells, including partial sells.
                This is realized performance, not a measure of all open
                positions.
              </p>
              <dl className="record-details">
                <div>
                  <dt>IMD volume</dt>
                  <dd className="numeric wrap">{units(card.volume)}</dd>
                </div>
                <div>
                  <dt>Buy limits</dt>
                  <dd>
                    {short(card.dailyCap)} IMD/day · {short(card.maxPerTrade)}{" "}
                    IMD/trade
                  </dd>
                </div>
                <div>
                  <dt>Trading</dt>
                  <dd>{card.frozen ? "Frozen" : "Not frozen"}</dd>
                </div>
              </dl>
              <details>
                <summary>Holder and agent addresses</summary>
                <h3>Permanent holder</h3>
                <AddressText address={card.holder} />
                <h3>Assigned agent</h3>
                {/^0x0+$/.test(card.agent) ? (
                  <p>No agent assigned. Trading is not configured.</p>
                ) : (
                  <AddressText address={card.agent} />
                )}
              </details>
              <a
                className="button"
                href={`https://x.com/intent/post?text=${encodeURIComponent(share)}&url=${encodeURIComponent(location.href)}`}
                target="_blank"
                rel="noreferrer"
              >
                Share on X ↗
              </a>
              <details>
                <summary>View the original on-chain artwork</summary>
                <ReadAction
                  label="Load card artwork"
                  run={async () => {
                    setArtError("");
                    try {
                      const uri = await c.api.read<string>(
                        "tokenURI",
                        [card.id],
                        c.state!.cards,
                        c.api.abi("HandlerCards"),
                      );
                      if (!uri.startsWith("data:application/json;base64,"))
                        throw Error("Unsupported card metadata format.");
                      const metadata = JSON.parse(atob(uri.split(",")[1]));
                      if (
                        typeof metadata.image !== "string" ||
                        !metadata.image.startsWith("data:image/svg+xml;base64,")
                      )
                        throw Error("Unsupported artwork format.");
                      setArt(metadata.image);
                    } catch (e) {
                      setArtError(explain(e));
                    }
                  }}
                />
                {art && (
                  <img
                    className="onchain-art"
                    src={art}
                    alt={`Original on-chain Handler Card for ${card.name}`}
                  />
                )}
                <p role="alert">{artError}</p>
              </details>
            </div>
            <Badge card={card} />
          </div>
          <TradeHistory card={card} />
          <AgentTrade card={card} />
        </>
      )}
    </>
  );
}
