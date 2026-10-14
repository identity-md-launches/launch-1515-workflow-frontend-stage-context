import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  formatEther,
  formatUnits,
  parseEther,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { useApp } from "./context";
import { appendActivity, readActivity } from "./autopilot/activity";
import { AddressText, Field } from "./components";
import { amount, explain, same, short, slippage, winRate } from "./logic";
import type { CardEntry, TxStage } from "./types";
import {
  encryptSecrets,
  decryptSecrets,
  newAgent,
  loadVault,
  saveVault,
  storageKey,
  redact,
  type Secrets,
  type VaultRecord,
} from "./autopilot/vault";
import {
  DEFAULT_RULES,
  defaultWatchlist,
  watchlist,
  rulesDecision,
  validateRules,
  change,
  pnl,
  type Rules,
  type Brain,
  type Snapshot,
} from "./autopilot/model";
import {
  DEFAULT_AI,
  askAI,
  providerBinding,
  type AIConfig,
} from "./autopilot/ai";
import { AutopilotEngine, type Activity } from "./autopilot/engine";
import { AutopilotChain, checkPending, fundAgent } from "./autopilot/adapter";

function Step({
  number,
  title,
  status,
  children,
}: {
  number: number;
  title: string;
  status: string;
  children: ReactNode;
}) {
  return (
    <li className="autopilot-step">
      <div className="step-heading">
        <h3>
          <span className="step-number">{number}</span>
          {title}
        </h3>
        <span className="step-status">{status}</span>
      </div>
      {children}
    </li>
  );
}
export function Autopilot({
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
  const [id, setId] = useState("");
  const [lookup, setLookup] = useState("");
  const [extra, setExtra] = useState<CardEntry>();
  const [lookupError, setLookupError] = useState("");
  const [looking, setLooking] = useState(false);
  const selected =
    (extra && same(extra.holder, c.account) && extra.id.toString() === id
      ? extra
      : owned.find((card) => card.id.toString() === id)) ?? owned[0];
  const options =
    extra &&
    same(extra.holder, c.account) &&
    !owned.some((card) => card.id === extra.id)
      ? [...owned, extra]
      : owned;
  return (
    <div className="autopilot-page">
      <div className="page-heading autopilot-heading">
        <h1>Autopilot</h1>
        <p>Your card. Your rules. Your agent.</p>
      </div>
      <p className="autopilot-banner">
        Autopilot runs only while this tab is open.
      </p>
      {!c.account ? (
        <section className="autopilot-empty">
          <h2>Put your card to work</h2>
          <p>
            Connect its holder wallet to create a private agent and set trading
            limits.
          </p>
          <button className="primary" onClick={() => c.setWalletOpen(true)}>
            Connect holder wallet
          </button>
        </section>
      ) : (
        <>
          {!!options.length && (
            <div className="field autopilot-picker">
              <label htmlFor="autopilot-card">Choose your card</label>
              <select
                id="autopilot-card"
                value={selected?.id.toString() ?? ""}
                onChange={(e) => setId(e.target.value)}
              >
                {options.map((card) => (
                  <option key={String(card.id)} value={String(card.id)}>
                    #{String(card.id).padStart(4, "0")} · {card.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {!options.length && (
            <p className="notice">
              {loading
                ? "Checking your cards…"
                : "No owned cards in the loaded records. Load more or look up your card below."}{" "}
              <a href="#/cards">Manage or mint a card →</a>
            </p>
          )}
          {selected && (
            <AutopilotCard
              key={`${c.account}:${selected.id}`}
              initial={selected}
              holder={c.account}
            />
          )}
          <details className="autopilot-lookup">
            <summary>Find another card</summary>
            <p>
              {scanned.toString()} of {c.state?.totalCards.toString() ?? "…"}{" "}
              records loaded.
            </p>
            {c.state && scanned < c.state.totalCards && (
              <button disabled={loading} onClick={() => void loadMore()}>
                {loading ? "Loading cards…" : "Load more cards"}
              </button>
            )}
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setLooking(true);
                setLookupError("");
                try {
                  if (
                    !/^\d+$/.test(lookup) ||
                    BigInt(lookup) < 1n ||
                    !c.state ||
                    !c.verified
                  )
                    throw Error(
                      "Enter a card number after network verification.",
                    );
                  const card = await c.api.card(BigInt(lookup), c.state.cards);
                  if (!same(card.holder, c.account))
                    throw Error(
                      "This card belongs to another wallet. Connect its holder to use Autopilot.",
                    );
                  setExtra(card);
                  setId(String(card.id));
                } catch (e) {
                  setLookupError(explain(e));
                } finally {
                  setLooking(false);
                }
              }}
            >
              <Field
                label="Card number"
                value={lookup}
                onChange={setLookup}
                inputMode="numeric"
              />
              <button disabled={looking}>
                {looking ? "Finding card…" : "Find my card"}
              </button>
            </form>
            <p className="error" role="alert">
              {lookupError || error}
            </p>
          </details>
        </>
      )}
    </div>
  );
}
function AutopilotCard({
  initial,
  holder,
}: {
  initial: CardEntry;
  holder: Address;
}) {
  const c = useApp();
  const key = storageKey(
    c.runtime.deployment.chainId,
    c.api.desk,
    holder,
    initial.id,
  );
  const secret = useRef<Secrets | undefined>(undefined);
  const runner = useRef<AutopilotEngine | undefined>(undefined);
  const release = useRef<(() => void) | undefined>(undefined);
  const mounted = useRef(true);
  const actionLock = useRef(false);
  const samples = useRef(new Map<string, number[]>());
  const [card, setCard] = useState(initial);
  const [vault, setVault] = useState<VaultRecord>();
  const [unlocked, setUnlocked] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [brain, setBrain] = useState<Brain>("rules");
  const [ai, setAI] = useState<AIConfig>({ ...DEFAULT_AI });
  const [rules, setRules] = useState<Rules>({ ...DEFAULT_RULES });
  const [daily, setDaily] = useState("2"),
    [perTrade, setPerTrade] = useState("0.5"),
    [gas, setGas] = useState("0.003");
  const [size, setSize] = useState("0.5"),
    [slip, setSlip] = useState("3");
  const [watched, setWatched] = useState(defaultWatchlist(c.api.hic));
  const [eth, setEth] = useState<bigint>();
  const [balance, setBalance] = useState<bigint>();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [dropped, setDropped] = useState<string[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [working, setWorking] = useState("");
  const [running, setRunning] = useState(false),
    [loopBusy, setLoopBusy] = useState(false);
  const [runStatus, setRunStatus] = useState(
    "Stopped. Complete the setup to start.",
  );
  const [error, setError] = useState("");
  const [errorAt, setErrorAt] = useState("");
  const [stageAt, setStageAt] = useState("");
  const [storageError, setStorageError] = useState("");
  const [stage, setStage] = useState<TxStage>({ status: "idle", message: "" });
  const [fundHash, setFundHash] = useState<Hex>();
  const [freezeConfirm, setFreezeConfirm] = useState(false);
  const [loadError, setLoadError] = useState("");
  const ready =
    c.verified &&
    c.chainId === c.runtime.deployment.chainId &&
    !!c.provider &&
    same(c.account, holder);
  const canRun = useRef(ready);
  canRun.current = ready;
  const busy = !!working || c.txBusy || running || loopBusy;
  const safe = (e: unknown) =>
    redact(explain(e, c.runtime.abis), secret.current, passphrase);
  const assigned = !!vault && same(card.agent, vault.address);
  let limitsSet = false;
  try {
    limitsSet =
      card.dailyCap === amount(daily) && card.maxPerTrade === amount(perTrade);
  } catch {
    /* Show validation on submit. */
  }
  useEffect(() => {
    mounted.current = true;
    try {
      setVault(loadVault(key));
      setActivity(readActivity(key));
      const prefs = localStorage.getItem(key + ":preferences");
      if (prefs) {
        const parsed = JSON.parse(prefs);
        if (
          parsed.ai &&
          ["anthropic", "compatible"].includes(parsed.ai.provider)
        )
          setAI({ ...DEFAULT_AI, ...parsed.ai });
      }
    } catch {
      setStorageError(
        "Saved data could not be read. Check browser storage before creating a key.",
      );
    }
    return () => {
      mounted.current = false;
      runner.current?.stop("Stopped when leaving Autopilot.");
      secret.current = undefined;
    };
  }, [key]);
  async function refresh() {
    if (!c.state || !ready) return;
    const [next, b, gasBalance] = await Promise.all([
      c.api.card(card.id, c.state.cards),
      c.api.read<bigint>("balances", [card.id, c.api.imd]),
      vault
        ? c.api.public.getBalance({ address: vault.address })
        : Promise.resolve(undefined),
    ]);
    if (mounted.current) {
      setCard(next);
      setBalance(b);
      setEth(gasBalance);
      setLoadError("");
    }
  }
  useEffect(() => {
    void refresh().catch((e) => setLoadError(safe(e)));
  }, [c.api, c.revision, ready, vault?.address]);
  useEffect(() => {
    if (!ready)
      runner.current?.stop(
        "Stopped: wallet, network or deployment verification changed.",
      );
  }, [ready]);
  useEffect(() => {
    const close = () => {
      runner.current?.stop();
      secret.current = undefined;
      setUnlocked(false);
      setPassphrase("");
      setApiKey("");
    };
    window.addEventListener("pagehide", close);
    return () => window.removeEventListener("pagehide", close);
  }, []);
  async function action(name: string, fn: () => Promise<void>) {
    if (actionLock.current) return;
    actionLock.current = true;
    setWorking(name);
    setErrorAt(name === "export" ? "key" : name);
    setError("");
    try {
      await fn();
    } catch (e) {
      if (mounted.current) {
        setError(safe(e));
        if (name === "key")
          document.getElementById("agent-passphrase")?.focus();
        if (name === "ai") document.getElementById("ai-passphrase")?.focus();
      }
    } finally {
      actionLock.current = false;
      if (mounted.current) setWorking("");
    }
  }
  function log(entry: Activity) {
    const nextEntry = {
      ...entry,
      reason: redact(entry.reason, secret.current, passphrase),
    };
    try {
      const next = appendActivity(key, nextEntry);
      if (mounted.current) setActivity(next);
    } catch {
      if (mounted.current)
        setStorageError(
          "Activity cannot be saved. Browser storage is full or unavailable.",
        );
      runner.current?.stop("Stopped because activity storage is unavailable.");
    }
  }
  async function holderWrite(fn: string, args: readonly unknown[]) {
    if (!ready || !c.state)
      throw Error(
        "Connect the holder wallet on Ethereum and wait for verification.",
      );
    setStageAt(
      fn === "setAgent" ? "agent" : fn === "setRules" ? "limits" : "freeze",
    );
    await c.transact(async () => {
      const fresh = await c.api.card(card.id, c.state!.cards);
      if (!same(fresh.holder, holder))
        throw Error("Only the holder can perform this action.");
      return c.api.call(fn, args);
    }, setStage);
    await refresh();
  }
  async function start() {
    if (!ready || !c.state || !vault || !secret.current)
      throw Error("Unlock the agent key and connect the holder wallet first.");
    if (!navigator.locks)
      throw Error(
        "This browser does not support tab locking. Use a current browser to run Autopilot safely.",
      );
    validateRules(rules);
    const sizeValue = amount(size),
      bps = slippage(slip),
      list = watchlist(watched);
    if (sizeValue < amount("0.1"))
      throw Error("Set a buy size of at least 0.1 IMD.");
    if (
      brain === "ai" &&
      (!secret.current.apiKey ||
        secret.current.providerBinding !== providerBinding(ai))
    )
      throw Error("Save an API key for the selected provider URL first.");
    const keys = secret.current;
    const latest = await c.api.card(card.id, c.state.cards);
    if (latest.frozen)
      throw Error("This card is frozen. Unfreeze it in My cards first.");
    if (!same(latest.agent, vault.address))
      throw Error("Set this key as the card’s agent first.");
    if (
      latest.dailyCap !== amount(daily) ||
      latest.maxPerTrade !== amount(perTrade)
    )
      throw Error("Set the selected card limits before starting.");
    if ((await c.api.public.getBalance({ address: vault.address })) === 0n)
      throw Error("Fund the agent’s ETH gas balance first.");
    const adapter = new AutopilotChain(
      c.api,
      latest,
      c.state.cards,
      holder,
      list,
      rules,
      key,
      (s, omitted) => {
        if (mounted.current) {
          setSnapshot(s);
          setCard(s.card);
          setBalance(s.balance);
          setDropped(omitted);
        }
      },
      samples.current,
    );
    await checkPending(c.api, key);
    // The lock is held through in-flight receipts, including after Stop or route changes.
    void navigator.locks
      .request(key, { ifAvailable: true }, async (lock) => {
        if (!lock) {
          setError(
            "This card is already running in another tab. Stop it there first.",
          );
          return;
        }
        if (!mounted.current || !canRun.current) return;
        const done = new Promise<void>((resolve) => {
          release.current = resolve;
        });
        const engine = new AutopilotEngine({
          agent: vault.address,
          size: sizeValue,
          brain,
          read: (sample, signal) => adapter.read(sample, signal),
          decide: (s, signal) =>
            brain === "rules"
              ? Promise.resolve(rulesDecision(s, rules, sizeValue))
              : askAI(
                  {
                    ...ai,
                    instructions: redact(
                      ai.instructions,
                      keys,
                      undefined,
                      8000,
                    ),
                  },
                  keys.apiKey!,
                  s,
                  sizeValue,
                  signal,
                ),
          send: (d, signal, onHash) =>
            adapter.send(d, keys.privateKey, bps, signal, onHash),
          activity: (entry) =>
            log({ ...entry, reason: redact(entry.reason, keys) }),
          safe: (e) => redact(explain(e, c.runtime.abis), keys),
          state: (active, reason, pending) => {
            if (mounted.current) {
              setRunning(active);
              setLoopBusy(pending);
              if (reason) setRunStatus(reason);
            }
            if (!active && !pending) {
              release.current?.();
              release.current = undefined;
              runner.current = undefined;
            }
          },
        });
        runner.current = engine;
        engine.start();
        await done;
      })
      .catch((e) => setError(safe(e)));
  }
  function feedback(area: string) {
    return (
      <>
        <p
          id={`autopilot-${area}-error`}
          className="error autopilot-error"
          role="alert"
        >
          {errorAt === area ? error : ""}
        </p>
        <div className="autopilot-feedback" role="status">
          {stageAt === area ? stage.message : ""}
          {stageAt === area && stage.hash && (
            <>
              {" "}
              <a
                href={`${c.runtime.deployment.network.explorer}/tx/${stage.hash}`}
                target="_blank"
                rel="noreferrer"
              >
                Transaction ↗
              </a>
            </>
          )}
        </div>
      </>
    );
  }
  const aiSaved = !!secret.current?.apiKey;
  const recordUrl = new URL(location.href);
  recordUrl.hash = `/agent/${card.id}`;
  const results = card.wins + card.losses;
  const shareText = `My AI agent runs on Handlers In Control. Card #${String(card.id).padStart(4, "0")} · ${results ? `${winRate(card)} win rate over ${results} trades` : "No closed trades yet"}`;
  return (
    <>
      <div className="autopilot-grid">
        <section aria-labelledby="setup-title" className="autopilot-setup">
          <div className="section-heading">
            <h2 id="setup-title">Set up your agent</h2>
            <a href={`#/agent/${card.id}`}>Card record ↗</a>
          </div>
          <ol className="autopilot-steps">
            <Step
              number={1}
              title="Create agent key"
              status={
                unlocked
                  ? "Unlocked in this tab"
                  : vault
                    ? "Saved · locked"
                    : "Not created"
              }
            >
              {!unlocked && (
                <>
                  <div className="field">
                    <label htmlFor="agent-passphrase">
                      {vault ? "Unlock passphrase" : "Create a passphrase"}
                    </label>
                    <input
                      id="agent-passphrase"
                      type="password"
                      autoComplete={vault ? "current-password" : "new-password"}
                      value={passphrase}
                      onChange={(e) => setPassphrase(e.target.value)}
                      aria-describedby="key-help autopilot-key-error"
                      aria-invalid={(errorAt === "key" && !!error) || undefined}
                    />
                  </div>
                  <p id="key-help" className="muted">
                    At least 12 characters. Your key is encrypted in this
                    browser.
                  </p>
                </>
              )}
              <div className="autopilot-actions">
                <button
                  className={!unlocked ? "primary" : ""}
                  disabled={
                    !ready || !!working || unlocked || !!storageError || running
                  }
                  onClick={() =>
                    void action("key", async () => {
                      if (vault) {
                        const recovered = await decryptSecrets(
                          vault.encrypted,
                          passphrase,
                          key,
                        );
                        if (
                          !same(
                            privateKeyToAccount(recovered.privateKey).address,
                            vault.address,
                          )
                        )
                          throw Error("Saved key and agent address disagree.");
                        secret.current = recovered;
                      } else {
                        const fresh = newAgent();
                        const values: Secrets = {
                          privateKey: fresh.privateKey,
                        };
                        const record: VaultRecord = {
                          address: fresh.address,
                          exported: false,
                          encrypted: await encryptSecrets(
                            values,
                            passphrase,
                            key,
                          ),
                        };
                        saveVault(key, record);
                        setVault(record);
                        secret.current = values;
                      }
                      setUnlocked(true);
                      setPassphrase("");
                    })
                  }
                >
                  {working === "key"
                    ? "Unlocking key…"
                    : unlocked
                      ? "Agent key ready"
                      : vault
                        ? "Unlock agent key"
                        : "Create agent key"}
                </button>
                {unlocked && vault && !vault.exported && (
                  <button
                    onClick={() =>
                      void action("export", async () => {
                        const next = { ...vault, exported: true };
                        saveVault(key, next);
                        setVault(next);
                        const url = URL.createObjectURL(
                          new Blob([secret.current!.privateKey + "\n"], {
                            type: "text/plain",
                          }),
                        );
                        const link = document.createElement("a");
                        link.href = url;
                        link.download = `hic-card-${card.id}-agent-key.txt`;
                        link.click();
                        setTimeout(() => URL.revokeObjectURL(url), 1000);
                      })
                    }
                  >
                    Export key
                  </button>
                )}
                {unlocked && (
                  <button
                    disabled={busy}
                    onClick={() => {
                      secret.current = undefined;
                      setUnlocked(false);
                      setApiKey("");
                      setPassphrase("");
                    }}
                  >
                    Lock key
                  </button>
                )}
              </div>
              {vault && (
                <>
                  <AddressText address={vault.address} />
                  <small>
                    {vault.exported
                      ? "Key export used. Keep your backup private."
                      : "Export is offered once. The download contains your unencrypted agent key."}
                  </small>
                </>
              )}
              {feedback("key")}
            </Step>
            <Step
              number={2}
              title="Set as agent"
              status={
                assigned ? "Already set · skipped" : "Holder signature needed"
              }
            >
              <p>
                This key can trade the card’s funds. Only you can withdraw them.
              </p>
              <button
                disabled={!ready || !unlocked || !vault || busy || assigned}
                onClick={() =>
                  void action("agent", () =>
                    holderWrite("setAgent", [card.id, vault!.address]),
                  )
                }
              >
                {working === "agent"
                  ? "Setting agent…"
                  : assigned
                    ? "Agent is set"
                    : "Set as agent"}
              </button>
              {feedback("agent")}
            </Step>
            <Step
              number={3}
              title="Set limits"
              status={
                limitsSet ? "Limits match on chain" : "Holder signature needed"
              }
            >
              <div className="field-pair">
                <Field
                  label="Daily cap (IMD)"
                  value={daily}
                  onChange={setDaily}
                  inputMode="decimal"
                />
                <Field
                  label="Maximum per trade (IMD)"
                  value={perTrade}
                  onChange={setPerTrade}
                  inputMode="decimal"
                />
              </div>
              <button
                disabled={!ready || !assigned || busy || limitsSet}
                onClick={() =>
                  void action("limits", async () => {
                    const d = amount(daily),
                      p = amount(perTrade);
                    if (p > d)
                      throw Error(
                        "Per-trade maximum must not exceed the daily cap.",
                      );
                    await holderWrite("setRules", [card.id, d, p]);
                  })
                }
              >
                {working === "limits"
                  ? "Setting limits…"
                  : limitsSet
                    ? "Limits are set"
                    : "Set limits"}
              </button>
              {feedback("limits")}
            </Step>
            <Step
              number={4}
              title="Fund gas"
              status={
                eth === undefined
                  ? "Checking balance"
                  : eth > 0n
                    ? "Gas available"
                    : "Needs ETH"
              }
            >
              <Field
                label="Send to agent (ETH)"
                value={gas}
                onChange={setGas}
                inputMode="decimal"
              />
              <p>
                Agent balance:{" "}
                <strong className="numeric">
                  {eth === undefined ? "Checking…" : `${formatEther(eth)} ETH`}
                </strong>
              </p>
              <button
                disabled={!ready || !assigned || busy}
                onClick={() =>
                  void action("gas", async () => {
                    const value = amount(gas);
                    if (value > parseEther("1"))
                      throw Error(
                        "Gas funding is limited to 1 ETH per transfer.",
                      );
                    await fundAgent(
                      c.api,
                      c.provider!,
                      holder,
                      vault!.address,
                      value,
                      setFundHash,
                    );
                    await refresh();
                  })
                }
              >
                {working === "gas" ? "Funding gas…" : "Fund gas"}
              </button>
              {fundHash && (
                <a
                  href={`${c.runtime.deployment.network.explorer}/tx/${fundHash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Gas transaction ↗
                </a>
              )}
              {feedback("gas")}
            </Step>
            <Step
              number={5}
              title="Start"
              status={
                running ? "Running" : card.frozen ? "Card frozen" : "Stopped"
              }
            >
              <p>
                Card balance:{" "}
                <strong className="numeric">
                  {balance === undefined
                    ? "Checking…"
                    : `${short(balance)} IMD`}
                </strong>
                . <a href={`#/cards?new=${card.id}`}>Deposit IMD →</a>
              </p>
              <div className="autopilot-actions">
                <button
                  className="primary"
                  disabled={
                    !ready ||
                    !unlocked ||
                    !assigned ||
                    !limitsSet ||
                    !eth ||
                    running ||
                    loopBusy ||
                    !!working ||
                    c.txBusy ||
                    card.frozen
                  }
                  onClick={() => void action("start", start)}
                >
                  {working === "start" ? "Checking setup…" : "Start"}
                </button>
                <button
                  disabled={!running}
                  onClick={() => runner.current?.stop()}
                >
                  Stop
                </button>
              </div>
              <p role="status" className="run-status">
                {runStatus}
              </p>
              <small>
                Checks every 60 seconds. Browser sleep can delay checks. Leaving
                this page stops the loop and locks the key.
              </small>
              {feedback("start")}
            </Step>
          </ol>
          <p role="alert" className="error">
            {storageError || loadError}
          </p>
          {feedback("refresh")}
          {loadError && (
            <button onClick={() => void action("refresh", refresh)}>
              Retry card reads
            </button>
          )}
          <div className="autopilot-freeze">
            {feedback("freeze")}
            <h3>Holder controls</h3>
            <p>
              Freeze blocks buys and sells on chain. A submitted transaction may
              still confirm before the freeze.
            </p>
            {freezeConfirm ? (
              <>
                <p>
                  Freeze card #{String(card.id).padStart(4, "0")}? You can
                  unfreeze it in My cards.
                </p>
                <div className="autopilot-actions">
                  <button
                    className="danger"
                    disabled={!ready || c.txBusy || !!working}
                    onClick={() =>
                      void action("freeze", async () => {
                        runner.current?.stop(
                          "Stopped: holder is freezing the card.",
                        );
                        await holderWrite("freeze", [card.id]);
                        setFreezeConfirm(false);
                      })
                    }
                  >
                    Confirm freeze
                  </button>
                  <button onClick={() => setFreezeConfirm(false)}>
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <button
                className="danger"
                disabled={!ready || card.frozen}
                onClick={() => setFreezeConfirm(true)}
              >
                {card.frozen ? "Card is frozen" : "Freeze card"}
              </button>
            )}
          </div>
        </section>
        <section className="autopilot-config" aria-labelledby="brain-title">
          <h2 id="brain-title">Choose a brain</h2>
          <fieldset disabled={busy}>
            <legend className="sr-only">Trading brain</legend>
            <div className="brain-toggle">
              <label>
                <input
                  type="radio"
                  name="brain"
                  checked={brain === "rules"}
                  onChange={() => setBrain("rules")}
                />
                Rules
              </label>
              <label>
                <input
                  type="radio"
                  name="brain"
                  checked={brain === "ai"}
                  onChange={() => setBrain("ai")}
                />
                Your AI
              </label>
            </div>
            {brain === "rules" ? (
              <>
                <p>Buy momentum. Exit on profit, loss or time.</p>
                <div className="rule-fields">
                  {(
                    [
                      ["rise", "Buy after a rise (%)"],
                      ["samples", "Lookback samples"],
                      ["takeProfit", "Take profit (%)"],
                      ["stopLoss", "Stop loss (%)"],
                      ["holdHours", "Maximum hold (hours)"],
                      ["cooldownHours", "Cooldown after sell (hours)"],
                    ] as [keyof Rules, string][]
                  ).map(([name, label]) => (
                    <Field
                      key={name}
                      label={label}
                      value={
                        Number.isNaN(rules[name]) ? "" : String(rules[name])
                      }
                      onChange={(v) =>
                        setRules({
                          ...rules,
                          [name]: v === "" ? NaN : Number(v),
                        })
                      }
                      inputMode="decimal"
                    />
                  ))}
                </div>
                <small>
                  Buy only when no position is held. Exits sell the whole
                  position. The last 60 samples stay in memory; a reload starts
                  a fresh history.
                </small>
              </>
            ) : (
              <>
                <div className="field">
                  <label htmlFor="ai-provider">Provider</label>
                  <select
                    id="ai-provider"
                    value={ai.provider}
                    onChange={(e) =>
                      setAI({
                        ...ai,
                        provider: e.target.value as AIConfig["provider"],
                        model:
                          e.target.value === "anthropic"
                            ? "claude-haiku-5-5"
                            : "",
                      })
                    }
                  >
                    <option value="anthropic">Anthropic</option>
                    <option value="compatible">OpenAI-compatible</option>
                  </select>
                </div>
                {ai.provider === "compatible" && (
                  <Field
                    label="Provider URL"
                    value={ai.url}
                    onChange={(url) => setAI({ ...ai, url })}
                    hint="HTTPS base URL (ending in /v1) or full /chat/completions endpoint. Must allow browser requests."
                  />
                )}
                <Field
                  label="Model"
                  value={ai.model}
                  onChange={(model) => setAI({ ...ai, model })}
                />
                <div className="field">
                  <label htmlFor="ai-key">API key</label>
                  <input
                    id="ai-key"
                    type="password"
                    autoComplete="off"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={
                      aiSaved ? "Saved and unlocked" : "Paste your own key"
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor="ai-passphrase">Encryption passphrase</label>
                  <input
                    id="ai-passphrase"
                    type="password"
                    autoComplete="current-password"
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                  />
                </div>
                <button
                  disabled={!unlocked || !vault}
                  onClick={() =>
                    void action("ai", async () => {
                      if (!vault || !secret.current)
                        throw Error("Unlock your agent key first.");
                      const original = await decryptSecrets(
                        vault.encrypted,
                        passphrase,
                        key,
                      );
                      if (original.privateKey !== secret.current.privateKey)
                        throw Error("Unlock the saved agent key first.");
                      const selectedKey =
                        apiKey.trim() || secret.current.apiKey;
                      if (
                        !selectedKey ||
                        (!apiKey.trim() &&
                          secret.current.providerBinding !==
                            providerBinding(ai))
                      )
                        throw Error("Paste a key for this provider URL.");
                      const values = {
                        ...secret.current,
                        apiKey: selectedKey,
                        providerBinding: providerBinding(ai),
                      };
                      const next = {
                        ...vault,
                        encrypted: await encryptSecrets(
                          values,
                          passphrase,
                          key,
                        ),
                      };
                      saveVault(key, next);
                      secret.current = values;
                      setVault(next);
                      setApiKey("");
                      setPassphrase("");
                      localStorage.setItem(
                        key + ":preferences",
                        JSON.stringify({
                          ai: {
                            ...ai,
                            instructions: redact(
                              ai.instructions,
                              values,
                              passphrase,
                              8000,
                            ),
                          },
                        }),
                      );
                    })
                  }
                >
                  {working === "ai" ? "Saving key…" : "Save encrypted API key"}
                </button>
                {feedback("ai")}
                <p className="muted">
                  {aiSaved ? "API key saved and unlocked. " : ""}Your API key
                  goes only to your chosen provider. Each AI check sends your
                  card’s snapshot and instructions there.
                </p>
                <div className="field">
                  <label htmlFor="ai-instructions">Your instructions</label>
                  <textarea
                    id="ai-instructions"
                    rows={5}
                    maxLength={8000}
                    value={ai.instructions}
                    onChange={(e) =>
                      setAI({ ...ai, instructions: e.target.value })
                    }
                  />
                </div>
                <small>
                  AI replies are validated before trading. For sells, the AI’s
                  IMD amount is converted to a share of the position at its
                  current quoted value.
                </small>
              </>
            )}
            <div className="autopilot-policy">
              <h3>Trade settings</h3>
              <div className="field-pair">
                <Field
                  label="Buy size (IMD)"
                  value={size}
                  onChange={setSize}
                  inputMode="decimal"
                />
                <Field
                  label="Slippage (%)"
                  value={slip}
                  onChange={setSlip}
                  inputMode="decimal"
                />
              </div>
              <small>
                Minimum buy: 0.1 IMD. Slippage: above 0%, up to 5%. On-chain
                limits always apply. Stop to edit the brain and trade settings.
              </small>
            </div>
            <details className="watchlist-editor">
              <summary>
                Edit watchlist · {watched.split(/\s+/).filter(Boolean).length}{" "}
                coins
              </summary>
              <p>
                Defaults: ZTO, INFER, HIC, SCOOP, SNITCH, DROP. Untradable coins
                are dropped from each check.
              </p>
              <div className="field">
                <label htmlFor="watchlist">Coin addresses · one per line</label>
                <textarea
                  id="watchlist"
                  className="address-input"
                  rows={8}
                  value={watched}
                  onChange={(e) => setWatched(e.target.value)}
                />
              </div>
            </details>
          </fieldset>
          {snapshot && (
            <section className="autopilot-snapshot">
              <h3>Latest check</h3>
              <p>
                {formatUnits(snapshot.spent, 18)} of{" "}
                {formatUnits(snapshot.card.dailyCap, 18)} IMD spent today.
              </p>
              <ul className="coin-samples">
                {snapshot.coins.map((coin) => (
                  <li key={coin.address}>
                    <strong>{coin.symbol}</strong>
                    <span>
                      {coin.samples.length}/60 samples ·{" "}
                      {change(coin.samples, 10) === null
                        ? "Building history"
                        : `${change(coin.samples, 10)!.toFixed(2)}% over 10`}
                    </span>
                    {coin.quantity > 0n && (
                      <span>
                        {short(coin.value)} IMD value ·{" "}
                        {pnl(coin) === null
                          ? "No cost basis"
                          : `${pnl(coin)!.toFixed(2)}% P&L`}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {!!dropped.length && (
                <details>
                  <summary>{dropped.length} coins skipped</summary>
                  <ul className="dropped-coins">
                    {dropped.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                </details>
              )}
            </section>
          )}
        </section>
      </div>
      <section className="autopilot-activity" aria-labelledby="activity-title">
        <div className="section-heading">
          <h2 id="activity-title">Activity</h2>
          <a
            className="button"
            href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(recordUrl.href)}`}
            target="_blank"
            rel="noreferrer"
          >
            Share
          </a>
        </div>
        <p className="muted">
          The last 200 entries stay in this browser. Win rate uses the card’s
          closed trades.
        </p>
        {!activity.length ? (
          <p className="empty">
            No checks yet. Start Autopilot to see decisions here.
          </p>
        ) : (
          <ol className="activity-list">
            {[...activity].reverse().map((entry) => (
              <li key={entry.id}>
                <div>
                  <time dateTime={new Date(entry.time).toISOString()}>
                    {new Date(entry.time).toLocaleTimeString()}
                  </time>
                  <span>{entry.brain === "rules" ? "Rules" : "Your AI"}</span>
                </div>
                <div>
                  <strong>{entry.decision}</strong>
                  <p>{entry.reason}</p>
                  {entry.hash && /^0x[\da-f]{64}$/i.test(entry.hash) && (
                    <a
                      href={`${c.runtime.deployment.network.explorer}/tx/${entry.hash}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View transaction ↗
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
