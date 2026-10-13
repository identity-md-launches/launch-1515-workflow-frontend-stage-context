import { useState, useEffect, useRef, useId, type ReactNode } from "react";
import { getAddress, type Address } from "viem";
import { useApp } from "./context";
import { explain, short, units, winRate } from "./logic";
import type { Call, TxStage, CardEntry, Quote } from "./types";
export function AddressText({
  address,
  label,
}: {
  address: Address;
  label?: string;
}) {
  const { runtime } = useApp();
  const [copied, setCopied] = useState("");
  return (
    <span className="address-block">
      <a
        href={`${runtime.deployment.network.explorer}/address/${address}`}
        target="_blank"
        rel="noreferrer"
        className="address"
        aria-label={
          label ? `${label}: ${getAddress(address)} on explorer` : undefined
        }
      >
        {getAddress(address)}
      </a>
      <button
        className="text-button"
        type="button"
        onClick={() => {
          if (!navigator.clipboard) {
            setCopied("Copy unavailable");
            return;
          }
          void navigator.clipboard.writeText(getAddress(address)).then(
            () => setCopied("Copied"),
            () => setCopied("Copy unavailable"),
          );
        }}
      >
        {copied || "Copy"}
      </button>
    </span>
  );
}
export function Field({
  label,
  value,
  onChange,
  hint,
  placeholder,
  type = "text",
  inputMode,
  required = false,
  maxLength,
  validate,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  placeholder?: string;
  type?: string;
  inputMode?: "text" | "decimal" | "numeric";
  required?: boolean;
  maxLength?: number;
  validate?: (value: string) => unknown;
}) {
  const id = useId();
  const [touched, setTouched] = useState(false);
  let fieldError = "";
  if (touched && value) {
    try {
      if (validate) validate(value);
      else if (inputMode === "decimal" && !/^\d+(\.\d+)?$/.test(value.trim()))
        throw Error("Use a plain decimal amount, such as 1.25.");
      else if (inputMode === "numeric" && !/^\d+$/.test(value.trim()))
        throw Error("Use a whole number.");
    } catch (e) {
      fieldError = explain(e);
    }
  }
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        value={value}
        onChange={(e) => {
          setTouched(true);
          onChange(e.target.value);
        }}
        type={type}
        inputMode={inputMode}
        placeholder={placeholder}
        onBlur={() => setTouched(true)}
        aria-invalid={fieldError ? true : undefined}
        aria-describedby={
          [hint ? `${id}-hint` : "", fieldError ? `${id}-error` : ""]
            .filter(Boolean)
            .join(" ") || undefined
        }
        required={required}
        maxLength={maxLength}
        autoComplete="off"
        spellCheck={false}
      />
      {hint && <small id={`${id}-hint`}>{hint}</small>}
      {fieldError && (
        <small className="error" id={`${id}-error`}>
          {fieldError}
        </small>
      )}
    </div>
  );
}
export function TxAction({
  label,
  build,
  disabled = false,
  reason,
  primary = false,
  onSuccess,
}: {
  label: string;
  build: () => Promise<Call> | Call;
  disabled?: boolean;
  reason?: string;
  primary?: boolean;
  onSuccess?: (cardId?: bigint) => void;
}) {
  const c = useApp();
  const [stage, setStage] = useState<TxStage>({ status: "idle", message: "" });
  const statusId = useId();
  const busy = ["checking", "signing", "confirming"].includes(stage.status);
  const wrong = !!c.account && c.chainId !== c.runtime.deployment.chainId;
  const unavailable =
    disabled || (!c.verified && !!c.account) || wrong || c.txBusy;
  return (
    <div className="action">
      <button
        type="button"
        className={primary ? "primary" : ""}
        disabled={!!c.account && unavailable}
        aria-describedby={statusId}
        aria-busy={busy}
        onClick={() => {
          if (!c.account) {
            c.setWalletOpen(true);
            return;
          }
          void c.transact(build, (s) => {
            setStage((previous) => ({
              ...s,
              hash: s.status === "error" ? previous.hash : s.hash,
            }));
            if (s.status === "success") onSuccess?.(s.cardId);
          });
        }}
      >
        {busy
          ? stage.status === "confirming"
            ? `${label}: confirming…`
            : stage.status === "signing"
              ? `${label}: check wallet…`
              : `${label}: checking…`
          : !c.account
            ? `Connect wallet to ${label.toLowerCase()}`
            : label}
      </button>
      <div
        id={statusId}
        className={`action-status ${stage.status === "error" ? "error" : ""}`}
        role={stage.status === "error" ? "alert" : "status"}
      >
        {stage.message}
        {stage.hash && (
          <a
            href={`${c.runtime.deployment.network.explorer}/tx/${stage.hash}`}
            target="_blank"
            rel="noreferrer"
          >
            View transaction ↗
          </a>
        )}
      </div>
      {c.account && !stage.message && ((disabled && reason) || wrong || !c.verified) && (
        <small>
          {wrong
            ? "Switch networks using the control above."
            : !c.verified
              ? "Waiting for deployment verification."
              : reason}
        </small>
      )}
    </div>
  );
}
export function ReadAction({
  label,
  run,
  disabled = false,
}: {
  label: string;
  run: () => Promise<void>;
  disabled?: boolean;
}) {
  const { runtime } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const locked = useRef(false);
  return (
    <div className="action">
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => {
          if (locked.current) return;
          locked.current = true;
          setBusy(true);
          setError("");
          void run()
            .catch((e) => setError(explain(e, runtime.abis)))
            .finally(() => {
              locked.current = false;
              setBusy(false);
            });
        }}
        aria-busy={busy}
      >
        {busy ? `${label}…` : label}
      </button>
      <div role="alert" className="error">
        {error}
      </div>
    </div>
  );
}
export function SpendAction({
  token,
  spender,
  value,
  label,
  build,
  disabled = false,
  reason,
  onSuccess,
  exactAllowance = false,
}: {
  token: Address;
  spender: Address;
  value?: bigint;
  label: string;
  build: () => Promise<Call> | Call;
  disabled?: boolean;
  reason?: string;
  onSuccess?: (cardId?: bigint) => void;
  exactAllowance?: boolean;
}) {
  const { api, account, revision, verified } = useApp();
  const [allowance, setAllowance] = useState<bigint>();
  const [error, setError] = useState("");
  const [recheck, setRecheck] = useState(0);
  useEffect(() => {
    let active = true;
    setAllowance(undefined);
    setError("");
    if (account && verified)
      void api.token<bigint>(token, "allowance", [account, spender]).then(
        (a) => {
          if (active) setAllowance(a);
        },
        (e) => {
          if (active) setError(explain(e));
        },
      );
    return () => {
      active = false;
    };
  }, [api, account, token, spender, revision, verified, recheck]);
  const needsApproval =
    !!account &&
    value !== undefined &&
    allowance !== undefined &&
    (exactAllowance ? allowance !== value : allowance < value);
  return (
    <div className="spend-flow">
      {needsApproval ? (
        <>
          <small>
            Step 1 of 2: approve exactly {units(value!)} IMD for this action.
            Then {label.toLowerCase()}.
          </small>
          <TxAction
            label={
              exactAllowance && allowance! > value!
                ? "Set exact mint allowance"
                : "Approve token spending"
            }
            primary
            disabled={disabled}
            reason={reason}
            build={() => {
              if (!value) throw Error("Enter an amount first.");
              return api.call(
                "approve",
                [spender, value],
                token,
                api.abi("ERC20"),
              );
            }}
            onSuccess={() => {
              setAllowance(undefined);
              setRecheck((n) => n + 1);
            }}
          />
        </>
      ) : (
        <TxAction
          label={label}
          primary
          build={async () => {
            if (!value)
              throw Error("Enter an amount and get a quote first if needed.");
            const fresh = await api.token<bigint>(token, "allowance", [
              account!,
              spender,
            ]);
            if (exactAllowance ? fresh !== value : fresh < value) {
              setAllowance(fresh);
              throw Error(
                "The token allowance changed. Approve the amount, then retry.",
              );
            }
            const balance = await api.token<bigint>(token, "balanceOf", [
              account!,
            ]);
            if (balance < value)
              throw Error(
                "Your wallet does not have enough tokens for this action.",
              );
            return build();
          }}
          disabled={
            disabled ||
            (!!account && (allowance === undefined || value === undefined))
          }
          reason={
            reason ||
            (allowance === undefined ? "Checking token allowance…" : undefined)
          }
          onSuccess={onSuccess}
        />
      )}
      {error && (
        <div className="error" role="alert">
          {error}
          <button
            className="text-button"
            onClick={() => setRecheck((n) => n + 1)}
          >
            Retry allowance
          </button>
        </div>
      )}
    </div>
  );
}
export function QuoteView({
  quote,
  symbol,
  decimals,
  inputSymbol,
  inputDecimals,
}: {
  quote?: Quote;
  symbol: string;
  decimals: number;
  inputSymbol?: string;
  inputDecimals?: number;
}) {
  if (!quote) return null;
  return (
    <dl className="quote">
      <div>
        <dt>Estimated receive</dt>
        <dd className="numeric">
          {short(quote.outputAmount, decimals)} {symbol}
        </dd>
      </div>
      <div>
        <dt>Minimum receive</dt>
        <dd className="numeric wrap">
          {units(quote.minOut, decimals)} {symbol}
        </dd>
      </div>
      {inputSymbol && (
        <div>
          <dt>Exchange estimate</dt>
          <dd className="numeric wrap">
            {short(quote.amount, inputDecimals)} {inputSymbol} →{" "}
            {short(quote.outputAmount, decimals)} {symbol}
          </dd>
        </div>
      )}
      <div>
        <dt>Quote time</dt>
        <dd>{new Date(quote.at).toLocaleTimeString()} · valid 60s</dd>
      </div>
    </dl>
  );
}
export function WalletDialog() {
  const c = useApp();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (c.walletOpen && !ref.current?.open) ref.current?.showModal();
    else if (!c.walletOpen && ref.current?.open) ref.current?.close();
  }, [c.walletOpen]);
  return (
    <dialog
      ref={ref}
      onClose={() => c.setWalletOpen(false)}
      aria-labelledby="wallet-title"
    >
      <div className="dialog-head">
        <h2 id="wallet-title">
          {c.account ? "Your wallet" : "Connect a wallet"}
        </h2>
        <button
          type="button"
          aria-label="Close wallet dialog"
          onClick={() => c.setWalletOpen(false)}
        >
          Close
        </button>
      </div>
      {c.account ? (
        <>
          <AddressText address={c.account} />
          <p>
            Connected on chain {c.chainId}. Your wallet holds the signing keys.
          </p>
          <button onClick={c.disconnect}>Disconnect from this site</button>
        </>
      ) : (
        <>
          <p>
            Choose a browser wallet. No account or private key is shared with
            this site.
          </p>
          {c.wallets.length ? (
            c.wallets.map((w) => (
              <button
                className="wallet-option"
                key={w.id}
                disabled={c.connecting}
                onClick={() => void c.connect(w)}
              >
                {c.connecting
                  ? "Waiting for your wallet…"
                  : `Connect ${w.name}`}
              </button>
            ))
          ) : (
            <div className="notice">
              <strong>No browser wallet detected.</strong>
              <p>
                Open this page in your wallet’s browser, or install an Ethereum
                browser wallet and reload.
              </p>
              <button onClick={() => location.reload()}>
                Reload wallet detection
              </button>
            </div>
          )}
        </>
      )}
      {c.walletError && (
        <p role="alert" className="error">
          {c.walletError}
        </p>
      )}
    </dialog>
  );
}
export function Badge({
  card,
  example = false,
  printed = false,
}: {
  card?: CardEntry;
  example?: boolean;
  printed?: boolean;
}) {
  const id = card?.id ?? 42n;
  const c = card ?? {
    name: "Atlas",
    wins: 16n,
    losses: 9n,
    pnl: 12480000000000000000n,
    volume: 182400000000000000000n,
    trades: 41n,
    mintedAt: 0n,
  };
  const cells = Array.from({ length: 25 }, (_, i) => {
    const x = i % 5,
      y = Math.floor(i / 5);
    return (Number(id % 997n) * (x + 3) * (y + 5) + x * y * 17) % 11 < 6;
  });
  return (
    <figure className={`badge-wrap ${printed ? "printed" : ""}`}>
      <div className="lanyard" aria-hidden="true" />
      <div className="badge">
        <div className="badge-slot" />
        <div className="badge-head">
          <span className="badge-wordmark">HIC</span>
          <span className="numeric">
            Agent #{id.toString().padStart(4, "0")}
          </span>
        </div>
        <div className="badge-identity">
          <svg
            viewBox="0 0 70 70"
            role="img"
            aria-label={`Pixel sigil for agent ${id}`}
            className="sigil"
          >
            <rect width="70" height="70" fill="currentColor" />
            {cells.map(
              (on, i) =>
                on && (
                  <rect
                    key={i}
                    x={10 + (i % 5) * 10}
                    y={10 + Math.floor(i / 5) * 10}
                    width="10"
                    height="10"
                    fill="#f2f1ec"
                  />
                ),
            )}
          </svg>
          <div>
            <strong className="badge-name">{c.name}</strong>
            <span>{example ? "Example card" : "Soulbound agent card"}</span>
          </div>
        </div>
        <div className="badge-rate">
          <span>Win rate</span>
          <strong>{winRate(c)}</strong>
          <span className="numeric">
            {c.wins.toString()} W · {c.losses.toString()} L
          </span>
        </div>
        <dl className="badge-stats">
          <div>
            <dt>Realized P&amp;L</dt>
            <dd className={c.pnl >= 0n ? "win" : "loss"}>
              {c.pnl >= 0n ? "+" : ""}
              {short(c.pnl)} IMD
            </dd>
          </div>
          <div>
            <dt>Volume</dt>
            <dd>{short(c.volume)} IMD</dd>
          </div>
          <div>
            <dt>Trades</dt>
            <dd>{c.trades.toString()}</dd>
          </div>
          <div>
            <dt>Issued</dt>
            <dd>
              {example
                ? "Example"
                : new Date(Number(c.mintedAt) * 1000)
                    .toISOString()
                    .slice(0, 10)}
            </dd>
          </div>
        </dl>
        <div className="badge-foot">
          <span>Handler keeps the keys</span>
          <svg
            aria-hidden="true"
            className="barcode"
            viewBox="0 0 240 24"
            preserveAspectRatio="none"
          >
            {Array.from({ length: 30 }, (_, i) => (
              <rect
                key={i}
                x={i * 8}
                y="0"
                width={i % 3 === 0 ? 5 : 2}
                height={i % 4 === 0 ? 24 : 20}
                fill="currentColor"
              />
            ))}
          </svg>
        </div>
      </div>
      {example && (
        <figcaption>Example · illustrative stats, not a live agent</figcaption>
      )}
    </figure>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
