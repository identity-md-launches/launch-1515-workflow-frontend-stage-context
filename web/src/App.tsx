import { useState, useEffect, useRef } from "react";
import { useApp } from "./context";
import { Home } from "./Home";
import { MyCards } from "./Cards";
import { Agent } from "./Agent";
import { Trading } from "./Trading";
import { Builders } from "./Builders";
import { WalletDialog } from "./components";
import { explain } from "./logic";
import type { CardEntry } from "./types";
export function App() {
  const c = useApp();
  const [route, setRoute] = useState(location.hash || "#/");
  const [cards, setCards] = useState<CardEntry[]>([]);
  const [scanned, setScanned] = useState(0n);
  const [cardsLoading, setCardsLoading] = useState(false);
  const [cardsError, setCardsError] = useState("");
  const lock = useRef(false);
  const generation = useRef(0);
  const main = useRef<HTMLElement>(null);
  useEffect(() => {
    const changed = () => {
      setRoute(location.hash || "#/");
      window.scrollTo(0, 0);
      requestAnimationFrame(() => main.current?.focus({ preventScroll: true }));
    };
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  useEffect(() => {
    const epoch = ++generation.current;
    setCards([]);
    setScanned(0n);
    setCardsError("");
    lock.current = false;
    setCardsLoading(false);
    if (c.state && c.verified)
      void fetchPage(
        1n,
        c.state.totalCards < 25n ? c.state.totalCards : 25n,
        true,
        epoch,
      );
  }, [c.api, c.state?.totalCards, c.verified]);
  // Refresh existing records after writes without treating an incomplete scan as a complete leaderboard.
  useEffect(() => {
    if (!c.state || !c.verified || !scanned || lock.current) return;
    void fetchPage(1n, scanned, true, generation.current);
  }, [c.revision]);
  async function fetchPage(
    start: bigint,
    end: bigint,
    reset = false,
    epoch = generation.current,
  ) {
    if (lock.current || !c.state) return;
    lock.current = true;
    setCardsLoading(true);
    setCardsError("");
    try {
      const next =
        start <= end ? await c.api.cardsPage(start, end, c.state.cards) : [];
      if (epoch !== generation.current) return;
      setCards((current) =>
        reset ? next : [...current.filter((c) => c.id < start), ...next],
      );
      setScanned(end);
    } catch (e) {
      if (epoch === generation.current) setCardsError(explain(e));
    } finally {
      if (epoch === generation.current) {
        lock.current = false;
        setCardsLoading(false);
      }
    }
  }
  const loadMore = async () => {
    if (!c.state) throw Error("Wait for network verification first.");
    await fetchPage(
      scanned + 1n,
      scanned + 25n < c.state.totalCards ? scanned + 25n : c.state.totalCards,
    );
  };
  const path = route.split("?")[0];
  const agent = path.match(/^#\/agent\/(\d+)$/);
  const recordProps = {
    cards,
    scanned,
    loadMore,
    loading: cardsLoading,
    error: cardsError,
  };
  const wrong = !!c.account && c.chainId !== c.runtime.deployment.chainId;
  return (
    <>
      <a
        className="skip-link"
        href="#main-content"
        onClick={(e) => {
          e.preventDefault();
          main.current?.focus();
        }}
      >
        Skip to content
      </a>
      <header className="site-header">
        <a className="brand" href="#/" aria-label="Handlers In Control home">
          <svg viewBox="0 0 40 40" aria-hidden="true">
            <rect width="40" height="40" fill="currentColor" />
            <path
              d="M10 9v22m20-22v22M10 20h20M20 9v22"
              stroke="#f2f1ec"
              strokeWidth="4"
            />
          </svg>
          <span>
            Handlers
            <br />
            In Control
          </span>
        </a>
        <button
          className="wallet-button"
          title={c.account}
          onClick={() => c.setWalletOpen(true)}
        >
          {c.account
            ? `Wallet ${c.account.slice(0, 6)}…${c.account.slice(-4)} ↗`
            : "Connect wallet ↗"}
        </button>
      </header>
      <div
        className="nav-bar"
        role="region"
        aria-label="Network and navigation"
      >
        <nav aria-label="Main navigation">
          {[
            ["#/", "The desk"],
            ["#/cards", "My cards"],
            ["#/trade", "Trade HIC"],
            ["#/builders", "Builders"],
          ].map(([href, label]) => (
            <a
              href={href}
              aria-current={path === href ? "page" : undefined}
              key={href}
            >
              {label}
            </a>
          ))}
        </nav>
        <span className="network-label">
          <span
            className={`dot ${c.verified ? "ok" : ""}`}
            aria-hidden="true"
          />
          {c.runtime.deployment.network.name}
        </span>
      </div>
      {wrong && (
        <div
          className="network-banner"
          role="region"
          aria-label="Connection status"
        >
          <div>
            <strong>Wrong network</strong>
            <span>
              Switch to {c.runtime.deployment.network.name} to use this desk.
            </span>
          </div>
          <button disabled={c.connecting} onClick={() => void c.switchChain()}>
            {c.connecting
              ? "Switching…"
              : `Switch to ${c.runtime.deployment.network.name}`}
          </button>
          {c.walletError && (
            <p role="alert" className="error">
              {c.walletError}
            </p>
          )}
        </div>
      )}
      {c.readError && (
        <div
          className="network-banner"
          role="region"
          aria-label="Connection status"
        >
          <div>
            <strong>Live reads unavailable</strong>
            <span>{c.readError}</span>
          </div>
          <button disabled={c.reading} onClick={() => void c.refresh()}>
            {c.reading ? "Checking…" : "Retry verification"}
          </button>
        </div>
      )}
      <main ref={main} id="main-content" tabIndex={-1}>
        {path === "#/" ? (
          <Home {...recordProps} />
        ) : path === "#/cards" ? (
          <MyCards {...recordProps} />
        ) : path === "#/trade" ? (
          <Trading />
        ) : path === "#/builders" ? (
          <Builders />
        ) : agent ? (
          <Agent id={agent[1]} />
        ) : (
          <section className="page-heading">
            <h1>Page not found.</h1>
            <a href="#/">Return to the desk →</a>
          </section>
        )}
      </main>
      <footer className="site-footer">
        <div>
          <a className="footer-brand" href="#/">
            Handlers In Control
          </a>
          <p>Agent cards. Permanent records.</p>
        </div>
        <div className="footer-state">
          <span role="status">
            {c.reading
              ? "Checking the chain…"
              : c.verified
                ? `Contract reads verified · block ${c.state?.block}`
                : "Contract reads not verified"}
          </span>
          <button
            className="text-button"
            disabled={c.reading}
            onClick={() => void c.refresh()}
          >
            Refresh live state
          </button>
          <a href="./imd-deployment.json">Deployment manifest ↗</a>
          <a href="./notices.txt">Software &amp; font licenses ↗</a>
        </div>
        <p className="footer-note">
          No backend. No trackers. Public on-chain records.
          <br />
          Values shown in token units; USD prices are unavailable.
        </p>
      </footer>
      <WalletDialog />
    </>
  );
}
