# Handlers In Control frontend

A static Vite + React + TypeScript interface for the deployed HIC launch and HandlerDesk. Source, package manifests and build tools live here. The submitted production site is `../dist/`; deployment and validation documentation live in `../docs/frontend/autopilot/validation.md` and `../DESIGN.md`.

## Install, run and rebuild

Use Node 22.12+ (validated with Node 24.21.0) and npm. Run from the repository root:

```sh
npm ci --prefix web
npm run dev --prefix web
npm run typecheck --prefix web
npm run build --prefix web
npm run verify --prefix web
npm run preview --prefix web
```

The build verifies the original implementation-derived ABI arrays at source commit `73174a3aabac5ee1c52275ef1e651a65f65610f3`, checks the saved handoff against `.imd/reads/` if that temporary directory exists, copies the public assets and ABI files, runs TypeScript and Vite, then regenerates `dist/imd-deployment.json` from the final bytes. The pinned commit must be present in the clone's Git history; a shallow clone may need that commit fetched first. No Solidity rebuild or root configuration change is needed.

Vite uses `base: './'`. Every route is a hash route and every bundled asset and ABI uses a relative URL. Serve `dist/` directly with any static HTTP server, including under a gateway subdirectory. Opening `index.html` as a `file://` URL is not supported because browsers restrict JSON fetches. A secure origin is needed for browser wallets and clipboard support. No service worker or backend is used. The publisher hosts the existing export; it does not need to rebuild.

## One runtime configuration

`dist/imd-deployment.json` is the sole runtime deployment configuration. `src/config.ts` fetches it and loads the referenced ABIs; it verifies the attested implementation ABIs using canonical Keccak and the auxiliary ABI files using their asset SHA-256. `src/chain.ts` constructs RPC clients and takes every protocol address from this runtime configuration. Autopilot watches only the manifest's HIC address by default. Holders can add other coin addresses; each must pass the Desk's `isTradable` check and use its exact launch pool. Flashbots and MEV Blocker follow the original RPCs as fallbacks.

`deployment/handoff.json` and `deployment/network.json` are preserved build inputs copied from the supplied handoff, not a second runtime configuration. Do not replace them casually. The exported contract set is exactly LaunchToken, HandlerArt and HandlerDesk. The NFT is created internally by HandlerDesk; its address is read from `cards()`, its binding is checked, and its pinned implementation ABI is exported as an additional asset.

Before enabling writes, the app checks the RPC chain ID, nonempty deployed code, the desk's HIC/IMD/PoolManager references and exact pool key, the child card's desk/art references, and token decimals. Reads use JSON-RPC batches of at most three, the supplied public RPCs, then Flashbots and MEV Blocker, followed by the connected-wallet fallback only on the correct network. Explicit refresh and a 30-second visible-page refresh keep the state current. Event scans remain user-driven and bounded. There are no private RPC credentials, analytics or remote scripts/fonts.

Browser wallets are discovered with EIP-6963 and an EIP-1193 injected-provider fallback (including MetaMask and Coinbase Wallet). No WalletConnect project ID was supplied; no project ID is invented. Users can open the site in a mobile wallet browser. Wrong-chain switching offers the exact supplied `wallet_addEthereumChain` parameters after an unknown-chain response.

## Flows

- **Autopilot:** `#/autopilot`, holder-owned card setup, encrypted local key, bounded rules or personal AI, local transaction signing, activity, Stop and Freeze. See the root README.

- **The desk:** live mint price, name validation, slippage-protected mint quote, exact IMD allowance to the Desk, mint, then setup checklist. An existing larger Desk allowance must be reduced to the current mint amount before minting, so a later price increase cannot pull more than that approval.
- **My cards:** holder-only UI balance loading, IMD sell estimates, deposit, withdraw, agent assignment/revocation, daily and per-trade limits, freeze/unfreeze, rename, and direct ID lookup. The underlying blockchain balances are public.
- **Agent page:** `#/agent/<id>`, public stats, original on-chain SVG metadata, share intent, event history, and buy/sell controls restricted to the current agent. Buys protect output after removing the desk fee from input; sells protect net IMD after the fee. Card trades call HandlerDesk and do not approve the router.
- **Trade HIC:** wallet swaps use the handoff's Uniswap v4 quoter, Permit2 and Universal Router. Quotes are simulated. Insufficient ERC-20 and Permit2 allowances are separate approval steps with exact amounts; Permit2 router authorization and transaction deadline last 20 minutes. The transaction is simulated before signing. ERC-20 swaps send zero native value.
- **Builders:** full ABI downloads, integration math and errors, verified deployment links, permissionless hourly buy-and-burn, owner-only mint price, two-step ownership proposal/acceptance. Disabled contract operations (renunciation, soulbound NFT transfers/approvals, internal mint/callback) are deliberately not exposed as user actions.

All writes recheck wallet chain/account, simulate, request one signature, wait for a successful receipt, then refresh. Pending actions lock duplicate submission through confirmation. Errors and explorer links stay near the triggering action. Changed token, amount or slippage settings invalidate quotes; quotes expire after 60 seconds. Transaction replacement/cancellation is distinguished from completing the requested action. The existing manual agent flow is preserved. The new Autopilot page generates and encrypts its own agent key and signs its trades locally; see the root README for setup and security behavior.

Leaderboard scans load 25 cards per batch and display coverage; only cards with at least ten closed results qualify. Sorting uses bigint rational comparisons. History loads 1,000-block windows with an older-page control and explicit range input. Neither surface pretends partial results are complete. No off-chain shared state or fabricated live records are used. The home badge is clearly marked **Example**.

## Validation

```sh
npm test --prefix web
PLAYWRIGHT_BROWSERS_PATH=/tmp/hic-playwright web/node_modules/.bin/playwright install chromium webkit
PLAYWRIGHT_BROWSERS_PATH=/tmp/hic-playwright npm run test:browser --prefix web
PLAYWRIGHT_BROWSERS_PATH=/tmp/hic-playwright node web/tests/observability.mjs
PLAYWRIGHT_BROWSERS_PATH=/tmp/hic-playwright node web/tests/keyboard.mjs
HIC_BROWSER=webkit PLAYWRIGHT_BROWSERS_PATH=/tmp/hic-playwright npm run test:browser --prefix web
web/node_modules/.bin/tsx web/tests/live.ts
```

Browser tests start and close their own static server at `/preview/`, mock both wallet and RPC, and write screenshots under `test/scratch/browser/`. They write concise results under `docs/frontend/`. They never submit real transactions. `live.ts` performs read-only verification and a simulated quote against the configured RPCs. It writes `docs/frontend/live-read.json`. WebKit needs its platform libraries; an optional `HIC_WEBKIT_EXECUTABLE` environment variable allows an externally prepared Playwright-compatible launcher. The worker's setup and outcomes are documented in `docs/frontend/VALIDATION.md`.

While the pinned input exists, run the required probe from the repository root:

```sh
PLAYWRIGHT_BROWSERS_PATH=/tmp/hic-playwright \
IMD_PLAYWRIGHT="$PWD/web/node_modules/playwright/index.mjs" \
node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste
```

After any change to exported files, run the build or `node web/scripts/manifest.mjs` again, then verify. Never edit a hashed asset without rebuilding the manifest. The production inventory includes every file except the manifest itself. Screenshots retained as delivery evidence live under `docs/frontend/evidence/`, outside the static export.

## Design and limitations

The current implemented design system is documented in root `DESIGN.md`; `docs/DESIGN.md` records the earlier version. Current Autopilot validation and six-domain review are in `docs/frontend/autopilot/validation.md`. The existing `web/.gitignore` remains unchanged and excludes generated dependencies and caches at every nesting level inside `web/`.

No USD source is provided, so the UI uses IMD/HIC/coin units and states that USD prices are unavailable. There is no ENS resolver address in the supplied network configuration, so address inputs accept and validate hexadecimal addresses; full checksummed addresses, copy controls and explorer links are provided. Open Graph image paths are relative until the publisher supplies the final gateway/name. The worker does not publish, pin IPFS, redeploy contracts, certify production economic behavior, or broadcast a funded test transaction.

Fonts and production package notices are included in `public/licenses/` and generated `public/notices.txt`, and copied into the export. Better Interface and eth-frontend-ux guidance attribution/licenses are retained under `docs/frontend/licenses/`.
