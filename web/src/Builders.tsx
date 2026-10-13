import { useState, useEffect } from "react";
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
  same,
  short,
  slippage,
  units,
} from "./logic";
import type { Quote } from "./types";
function Maintenance() {
  const c = useApp();
  const [quote, setQuote] = useState<Quote>();
  const [slip, setSlip] = useState("0.5");
  const [price, setPrice] = useState("");
  const [newOwner, setNewOwner] = useState("");
  useEffect(() => {
    setQuote(undefined);
  }, [c.state?.burnImd, slip]);
  const next = (c.state?.lastBurnTime ?? 0n) + 3600n;
  const burnReady =
    !!c.state &&
    c.state.burnImd > 0n &&
    (!c.state.hasBurned || c.state.time >= next);
  return (
    <section className="maintenance">
      <h2>Desk maintenance</h2>
      <div className="controls-grid">
        <section className="control-section">
          <h3>Buy and burn HIC</h3>
          <p>
            Anyone can swap accrued desk fees into HIC and burn them, at most
            once per hour.
          </p>
          <dl className="record-details">
            <div>
              <dt>Accrued for burn</dt>
              <dd className="numeric">
                {c.state ? `${units(c.state.burnImd)} IMD` : "Loading…"}
              </dd>
            </div>
            <div>
              <dt>Availability</dt>
              <dd>
                {!c.state
                  ? "Loading…"
                  : c.state.burnImd === 0n
                    ? "No accrued IMD"
                    : burnReady
                      ? "Ready"
                      : `After ${new Date(Number(next) * 1000).toLocaleString()}`}
              </dd>
            </div>
          </dl>
          <Field
            label="Burn slippage tolerance (%)"
            value={slip}
            onChange={setSlip}
            inputMode="decimal"
          />
          <ReadAction
            label="Quote burn"
            disabled={!burnReady || !c.verified}
            run={async () => {
              const burn = await c.api.read<bigint>("burnImd");
              setQuote(
                await c.api.quote(c.api.imd, c.api.hic, burn, slippage(slip)),
              );
            }}
          />
          <QuoteView
            quote={quote}
            symbol="HIC to burn"
            decimals={c.state?.hicDecimals ?? 18}
          />
          <TxAction
            label="Buy and burn"
            disabled={!burnReady || !quote}
            reason={
              !burnReady
                ? "The reserve must be nonempty and the hourly interval complete."
                : "Get a burn quote first."
            }
            build={async () => {
              const current = await c.api.read<bigint>("burnImd");
              checkQuote(quote, c.api.imd, current, c.api.hic, slippage(slip));
              return c.api.call("buyAndBurn", [quote!.minOut]);
            }}
          />
        </section>
        {same(c.account, c.state?.owner) && (
          <section className="control-section">
            <h3>Owner settings</h3>
            <p>
              Current mint price: {c.state ? short(c.state.mintPrice) : "…"}{" "}
              IMD. Only the launch owner can change it.
            </p>
            <Field
              label="New mint price (IMD)"
              value={price}
              onChange={setPrice}
              inputMode="decimal"
              hint="Contract bounds: 0.05 to 2 IMD."
            />
            <TxAction
              label="Set mint price"
              build={() => {
                const value = amount(price);
                if (value < amount("0.05") || value > amount("2"))
                  throw Error("MintPriceOutOfRange");
                return c.api.call("setMintPrice", [value]);
              }}
            />
            <details>
              <summary>Transfer desk ownership</summary>
              <p>
                The new owner receives future owner fees and controls the mint
                price. They must accept ownership from their wallet.
              </p>
              <Field
                label="New owner address"
                validate={address}
                value={newOwner}
                onChange={setNewOwner}
              />
              <TxAction
                label="Propose new owner"
                build={() =>
                  c.api.call("transferOwnership", [address(newOwner)])
                }
              />
            </details>
          </section>
        )}
        {same(c.account, c.state?.pendingOwner) && (
          <section className="control-section">
            <h3>Accept desk ownership</h3>
            <p>
              Your wallet is the pending owner. Accept to receive future owner
              fees and manage the mint price.
            </p>
            <TxAction
              label="Accept ownership"
              build={() => c.api.call("acceptOwnership")}
            />
          </section>
        )}
      </div>
    </section>
  );
}
export function Builders() {
  const c = useApp();
  return (
    <>
      <div className="page-heading">
        <h1>Build an agent.</h1>
        <p>Give it the trading key. Keep the holder key.</p>
      </div>
      <div className="docs-grid">
        <article className="prose">
          <h2>From wallet to working agent</h2>
          <ol>
            <li>Mint a card from the holder wallet.</li>
            <li>
              Deposit IMD, assign a separate agent address, and set daily and
              per-trade buy limits.
            </li>
            <li>
              Read the card’s rules, balance, and pool eligibility before every
              trade.
            </li>
            <li>
              Quote the exact launch pool, apply slippage, and simulate the desk
              call from the assigned agent.
            </li>
          </ol>
          <p>
            New cards start with zero buy limits and no agent. The holder can
            freeze both trade directions, revoke the agent, or withdraw funds at
            any time. Keep the agent key outside this site; only its public
            address is needed.
          </p>
          <h2>Quote a buy</h2>
          <p>
            A buy budget includes the 0.25% desk fee. Quote the remaining input
            through the configured Uniswap v4 quoter using{" "}
            <code>simulateContract</code>.
          </p>
          <pre>
            <code>{`fee = imdIn / 400n\npoolInput = imdIn - fee\nminOut = quotedCoinOut * (10000n - bps) / 10000n\n\nbuy(id, coin, imdIn, minOut)`}</code>
          </pre>
          <h2>Quote a sell</h2>
          <p>For sells, the protected minimum is net IMD after the desk fee.</p>
          <pre>
            <code>{`netImd = quotedGrossImd - quotedGrossImd / 400n\nminImdOut = netImd * (10000n - bps) / 10000n\n\nsell(id, coin, amountIn, minImdOut)`}</code>
          </pre>
          <p>
            Use the coin’s on-chain decimals. The desk enforces the initialized
            IMD pool key, agent permissions, freeze state, and buy limits. Only
            sells count as closed results. Partial sells remove proportional
            cost basis.
          </p>
          <h2>Handle rule errors</h2>
          <dl className="error-guide">
            <dt>OnlyAgent / OnlyHolder</dt>
            <dd>Use the wallet with the required permission.</dd>
            <dt>CardFrozen</dt>
            <dd>The holder must unfreeze the card.</dd>
            <dt>PerTradeLimit / DailyLimit</dt>
            <dd>
              Reduce the gross buy budget. Daily spending resets at UTC
              midnight.
            </dd>
            <dt>PoolNotInitialized</dt>
            <dd>The coin has no eligible initialized IMD launch pool.</dd>
            <dt>Slippage / PartialFill</dt>
            <dd>
              Get a fresh quote or reduce the input. Do not blindly lower the
              minimum.
            </dd>
            <dt>InsufficientBalance</dt>
            <dd>Reduce the amount or have the holder deposit IMD.</dd>
          </dl>
          <a className="button" href="./agent-guide.md">
            Read the full integration guide ↗
          </a>
          <a className="button" href="./llms.txt">
            Open llms.txt ↗
          </a>
        </article>
        <aside className="deployment-panel">
          <h2>Deployment record</h2>
          <p>
            {c.runtime.deployment.network.name} · chain{" "}
            {c.runtime.deployment.chainId}
          </p>
          {c.runtime.deployment.contracts.map((contract) => (
            <div className="contract" key={contract.name}>
              <h3>{contract.name}</h3>
              <AddressText address={contract.address} />
              <a href={`./${contract.abiPath}`}>
                Download implementation ABI ↗
              </a>
            </div>
          ))}
          {c.state && (
            <div className="contract">
              <h3>HandlerCards</h3>
              <p>Created and bound by the desk.</p>
              <AddressText address={c.state.cards} />
              <a href="./abi/HandlerCards.json">Download card ABI ↗</a>
            </div>
          )}
          <details>
            <summary>Pool and attestation</summary>
            <p className="wrap numeric">
              Source: {c.runtime.deployment.sourceCommit}
            </p>
            <p className="wrap numeric">
              Attestation: {c.runtime.deployment.attestationHash}
            </p>
            <p>
              Fee: {c.runtime.deployment.poolKey.fee}; tick spacing:{" "}
              {c.runtime.deployment.poolKey.tickSpacing}
            </p>
            <strong>Pool hook</strong>
            <AddressText address={c.runtime.deployment.poolKey.hooks} />
            <strong>PoolManager</strong>
            <AddressText
              address={c.runtime.deployment.network.uniswapV4.poolManager}
            />
          </details>
          <a href="./imd-deployment.json">Open runtime manifest ↗</a>
          <p className="muted">
            Public RPC reads, wallet-signed writes. No backend, analytics, or
            private credentials.
          </p>
        </aside>
      </div>
      <Maintenance />
    </>
  );
}
