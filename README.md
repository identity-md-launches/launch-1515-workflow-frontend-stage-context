# Handlers In Control — HIC

You're the handler. Your AI is the agent.

The live Ethereum contracts remain unchanged. The static React frontend now includes **Autopilot** at `#/autopilot`: a browser agent with editable rules or the holder’s own AI provider key. The production export is in `dist/`, prepared as the next version of **hic.site.identitymd.eth**. Publishing is performed by the assignment’s site publisher from these bytes.

## Website: install, preview and rebuild

Use Node 22.12+ and npm, from the repository root:

```sh
npm ci --prefix web
npm run dev --prefix web
npm run typecheck --prefix web
npm run build --prefix web
npm run verify --prefix web
npm run preview --prefix web
```

`web/package.json` and `web/package-lock.json` are retained unchanged. Vite exports to root `dist/` with relative asset URLs and hash routing; serve it over HTTP(S), including under a subpath. The build verifies the original ABI hashes and generates the static asset inventory. Keep the pinned source commit in Git history for that check. No backend, environment file or private service credential is required.

If the machine’s default npm cache is read-only, use `npm ci --prefix web --cache /tmp/hic-npm-cache`. Generated dependencies and caches are excluded by the existing `web/.gitignore`; the export includes only runtime assets.

## Autopilot

Connect the holder wallet, select an owned card, then create or unlock its agent key, assign it, set limits (2 IMD/day and 0.5 IMD/trade by default), fund its ETH gas and Start. Deposit trading IMD through the existing My cards flow. The agent key cannot withdraw card funds. Stop cancels future work; Freeze calls the existing holder-only contract function. Already submitted transactions can still confirm.

The fresh secp256k1 key is generated locally. Agent and API secrets are stored together using AES-256-GCM and PBKDF2-SHA-256 with **200,000 iterations**, random salt/IV and a holder/card-specific authenticated context. A passphrase of at least 12 characters is required. The key can be exported once as a plaintext local download; keep that backup private. Reloading requires unlocking. The private key and passphrase never enter requests. The API key goes only to the provider endpoint selected when it was saved.

Rules use the last 60 in-memory samples, buying a 5% rise over 10 samples only when no position is held. Default exits are +12%, -8%, or 12 hours; cooldown after a sale is one hour. All rule numbers are editable. Position ages and recent sales are reconstructed from on-chain trade/withdrawal events on start; old positions are recognized even after a reload. Sampling survives Stop/Start in the same page and resets on reload/navigation.

Your AI supports Anthropic (default model `claude-haiku-5-5`) or a holder-supplied HTTPS OpenAI-compatible base URL/full chat-completions endpoint and model. The provider must allow browser CORS requests and accept the supplied model/key. Each call receives only the trading snapshot and instructions, and returns one JSON decision. For AI sells, `imd` means the desired current IMD value to liquidate; the validator converts it to token units and rejects an excess. Invalid JSON becomes hold. Provider errors are logged without echoing response bodies.

Each 60-second check reads the card, daily spending, card IMD balance and watched positions; untradable coins are dropped. Buys respect all four limits, including the page size and a 0.1 IMD minimum. Orders are revalidated, re-quoted on the existing exact launch pool, protected by editable 3% slippage and simulated before local signing. Three consecutive failed trade attempts stop the loop. An unknown confirmation stops immediately and keeps its hash for reconciliation. A browser lock prevents two tabs from running the same card.

Autopilot runs only while this tab is open. Leaving its page, changing wallet/network or losing deployment verification stops it. Browser background throttling or sleep can delay checks. The feed retains 200 local entries; Share opens X with actual closed-trade statistics and the existing public record link. This is not a background server or a scheduled service.

## Frontend validation

```sh
npm test --prefix web
web/node_modules/.bin/tsx --test web/tests/autopilot.test.ts
npm run test:browser --prefix web
node web/tests/autopilot-browser.mjs
HIC_BROWSER=webkit node web/tests/autopilot-browser.mjs
web/node_modules/.bin/tsx web/tests/live.ts
```

Install Playwright Chromium/WebKit and their platform libraries when needed. Test scripts run their own bounded local server under `/preview/`. An optional `HIC_WEBKIT_EXECUTABLE` points to a prepared WebKit launcher. All interaction tests use mocked wallets/RPC/providers and never broadcast real transactions. The live script performs reads and quote simulation only.

Current results: production build/typecheck and asset/ABI verification pass; the existing 11 unit checks and 9 browser scenarios pass. Autopilot’s encryption, validator, engine, history and RPC checks, and Chromium/WebKit interaction results are recorded in [validation](docs/frontend/autopilot/validation.md), with limitations and screenshots. The required home design probe passes all 16 checks. Live verification reads a 0.2 IMD mint price. No funded live trade or paid AI provider call was made.

The implemented visual system is documented in [DESIGN.md](DESIGN.md). Detailed existing frontend setup remains in [web/README.md](web/README.md).

The contract documentation below describes the original deployed implementation.

## Build and test

```sh
forge build
forge test
forge fmt --check
python3 tools/export_abis.py
```

The root Foundry project pins Solidity **0.8.26**, Cancun EVM, optimizer (200 runs), `via_ir`, and `bytecode_hash = "none"`. All Solidity dependencies and their licenses are ordinary files in `lib/`; building and testing require no network, environment variables, wallet, FFI, or filesystem cheatcode permissions. Python's standard library suffices to regenerate ABIs from `out/`.

## Contracts

| Contract | Purpose | Constructor |
| --- | --- | --- |
| `LaunchToken` | Plain ERC-20, Handlers In Control / HIC, 18 decimals, exactly 1 billion tokens minted once to the deploying factory | None |
| `HandlerArt` | Stateless, live, entirely on-chain JSON and SVG card artwork | None |
| `HandlerDesk` | Per-card balances, rules, positions, statistics, swaps and fee accounting | `(address owner_, address hic_, address art_)` |
| `HandlerCards` | ERC-721 Handler Cards / CARD, ERC-5192 locked badges, mintable only by the Desk | Created by the Desk with `(address(this), art_)` |

Deploy `HandlerArt` before `HandlerDesk`. The Desk creates its own `HandlerCards` during construction to solve the authority dependency without an initialization call or mutable mint authority. Discover that child contract using `HandlerDesk.cards()`; it is **not a second, separately deployed manifest entry**. See [deployment parameters](docs/deployment.md).

HIC has no admin, mint, fee, pause, blocklist, or upgrade path. The factory owns and distributes the initial supply under launch policy: 10% swarm, 80% pool, and 10% paying wallet or policy treasury. None of the application contracts receives a launch allocation. Sending HIC to the specified dead address locks it there; ERC-20 `totalSupply()` stays fixed.

## Behavior and accounting

A mint costs 0.2 IMD initially. Half goes immediately to the current launch owner, and half buys HIC on its exact IMD launch pool and sends the measured HIC output to `0x000000000000000000000000000000000000dEaD`. All of this and the safe NFT mint are atomic. Names are 1–24 ASCII bytes from letters, digits, space and dash; names need not be unique.

The holder alone can deposit IMD, withdraw credited assets to themselves, change or revoke the agent, set limits, freeze/unfreeze, or rename. Cards cannot be transferred, burned, or approved. A new card has no agent and zero trading limits. Freeze blocks both buys and sells; it does not prevent holder withdrawals or configuration.

An authorized agent can only buy or sell through the specified v4 PoolManager. Buys debit an inclusive IMD budget, charge a fixed 0.25% Desk fee, and swap the remainder. The whole inclusive budget counts toward the per-trade and UTC-day buy limits and the position's cost. Sells remove proportional cost basis, charge 0.25% of gross IMD output and credit the net return. A strictly profitable sell is a win; a break-even or losing sell is a loss. Every partial sell counts separately. Withdrawn coins lose their proportional basis without recording a trade or realizing P&L. Limits apply to buys, not sales; changing rules does not reset the current day's spending.

Fees round down in minor units: `fee = IMD / 400`, `ownerShare = fee / 2`, and the remainder accrues to `burnImd`. Anyone can execute `buyAndBurn` once per hour after a successful burn, swapping the entire accrued reserve to HIC and sending it to the dead address. The first funded burn is immediately available. Failed swaps revert all accounting and timers. Card balances never fund a burn.

The owner uses Ownable2Step and can change only the mint price (0.05–2 IMD inclusive) and transfer ownership. Renunciation is disabled. There is no global pause, upgrade, rescue, balance seizure, fee setter, pool setter, arbitrary approval, or arbitrary-call facility.

## After launch

No outside subscription, signer or owner-settable service configuration is needed. The HIC token and Art reference are constructor arguments; IMD, PoolManager and the initialization-only hook are pinned constants from the approved workflow.

Services must deploy and initialize the policy pool with the exact key described in [deployment.md](docs/deployment.md), publish the source and signed handoff, and record the Desk's child Cards address. Swaps and minting require initialized, funded pools; constructors work on an empty chain. The frontend must use actual deployed addresses and the exact deployment handoff, without guessing token ordering or opening price.

The launch owner controls the mint price and receives fees. Holders fund their own cards after mint, approve only the desired IMD amounts, appoint their agents, set suitable limits, and can freeze or withdraw at any time. Agents supply quotes and positive minimum outputs. A permissionless keeper may execute funded burns; nobody is obligated or paid by this contract to do so.

## Assumptions and operational limits

The specified PoolManager and factory-restricted initialization hook must behave as described in the workflow. The hook's initialized pool is the eligibility test; the Desk does not independently attest tokens or the factory. IMD is assumed to be a plain, non-rebasing ERC-20. Output credits are measured; partial input fills and short settlements revert. Nonstandard, rebasing, confiscating, malicious or upgraded tokens can still make trading or withdrawal unavailable. Direct token donations are uncredited and have no recovery path.

On-chain balances and records are public. A UI can show only a connected holder's cards, but cannot promise blockchain privacy. Win rate is a per-sell statistic and can be biased by partial sales, tiny trades, selected withdrawals or unrealized losses. Realized P&L is not an audited return or a portfolio valuation. Artwork shows IMD rounded down to four fractional digits in magnitude; metadata preserves exact integer minor units.

Minimum outputs reduce slippage exposure; they do not establish fair prices. Anyone can choose a very small positive minimum for the public burn, so the reserve is exposed to pool manipulation/MEV. An agent can still make bad trades within a holder's limits. Losing a holder key strands its permanent cards; there is no recovery administrator. The trusted owner can move fee receipts to a new owner through the two-step process.

An independent adversarial review of custody, pool identity, constructor arguments and production dependencies is required by the later review stage. Local success is not that review. No deployment, broadcast, explorer verification, live-chain fork or funded-wallet operation was performed here.

## Integration and evidence

- [Contract ABI and events](docs/contracts.md), with complete machine-readable ABIs in [docs/abi](docs/abi).
- [Agent builder guide](docs/agent-guide.md) and [llms.txt](llms.txt).
- [Deployment parameters and service responsibilities](docs/deployment.md).
- [Security assumptions and local validation](docs/security.md).
- [Vendored dependency versions and licenses](docs/dependencies.md).
