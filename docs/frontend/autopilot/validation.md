# Autopilot implementation and validation

Initial implementation validation on 2026-10-14, retained as historical evidence. The reopened findings, fixes and current results are in [revision validation](revision.md). These are local worker observations, not independent certification of behavior or financial/security guarantees.

## Delivered scope

The existing Handlers In Control app now includes `#/autopilot` and its navigation entry. Root `dist/` is the static export for the next version of **hic.site.identitymd.eth**; the assignment publisher performs publication. No publishing command or on-chain deployment was run. All existing protocol addresses, ABIs, contract sources, build configuration, dependencies, package manifests/lockfiles and existing routes remain unchanged.

| Requirement | Implemented behavior / evidence |
| --- | --- |
| Holder-owned card setup | Owned-card selector plus direct ID lookup; five numbered steps and textual statuses; holder wallet used for setAgent, setRules, ETH funding and freeze. Mocked signatures and receipt state checked. |
| Private agent key | Fresh secp256k1 key in browser; AES-256-GCM, random 16-byte salt / 12-byte IV, PBKDF2-SHA-256 at exactly 200,000 iterations; holder/card-bound authenticated context. Unlock and one-time local export tested. |
| Defaults | 2 IMD daily, 0.5 IMD per trade, editable 0.003 ETH funding; current agent ETH balance displayed. Assigned agent step skips an existing match. |
| Start / Stop / Freeze | Immediate first check, then 60-second interval; nonoverlap guard; Stop cancels pending work before broadcast. Freeze uses the holder's existing contract flow. Submitted transactions remain confirmable. |
| Watchlist / quotes | All six requested defaults, HIC derived from verified deployment; editable addresses; `isTradable` filtering; 0.05 IMD exact-pool sample quotes; last 60 samples in memory. |
| Validation / sends | Fresh card, spentToday, IMD and positions; four-way buy maximum and 0.1 IMD minimum; watchlist/eligibility, freeze/agent and sell-position checks; fresh fee-aware quote, editable 3% slippage, simulation, locally signed transaction. Three failed attempts stop. Unknown confirmation stops immediately and retains the hash. |
| Rules | Editable 5% / 10 samples, +12%, -8%, 12-hour age and one-hour post-sale cooldown. Position age reconstructed from trade and withdrawal logs; samples survive Stop/Start but reset on reload/navigation. |
| Personal AI | Anthropic header and required default model; arbitrary HTTPS OpenAI-compatible base/full endpoint and model; encrypted key bound to saved provider; snapshot includes limits, balance, spending, costs, values, P&L and 10/60-sample changes. One JSON action; malformed replies hold. |
| Activity / Share | 200-entry local cap, timestamp/brain/decision/reason, update-in-place receipt link; X compose link uses actual closed-trade stats and `#/agent/<id>`. No invented live statistics. |
| Plumbing | HTTP JSON-RPC batches limited to three; Flashbots then MEV Blocker after existing RPCs. Pending mint label is “Checking price…”; successful live read shows “0.2 IMD”. |
| Static delivery | Relative Vite asset URLs, hash routes, local fonts, title, favicon, description, og:title and og:image. Existing source and lockfile retained beside `dist/`. |

## Commands and actual results

| Check | Actual result |
| --- | --- |
| `npm ci --cache /tmp/hic-npm-cache --no-audit --no-fund` in `web/` | Passed; 90 packages installed. Default npm cache was read-only; using `/tmp` resolved installation. No dependency or lockfile edits. |
| `npm run build --prefix web` | Passed after final source changes. TypeScript + Vite + manifest verifier; 21 runtime assets, 948,257 bytes excluding the manifest. Vite reports a nonfatal >500 kB main-chunk advisory (approximately 629.5 kB before gzip). |
| `npm run typecheck --prefix web` | Passed, no TypeScript diagnostics. |
| `npm run verify --prefix web` | Passed: exact deployment/network/pool identity, asset SHA-256 inventory and implementation ABI Keccak hashes. |
| `npm test --prefix web` | 11/11 existing unit tests passed. |
| `web/node_modules/.bin/tsx --test web/tests/autopilot.test.ts` | 12/12 passed. Includes encryption/tampering/context separation; validator boundaries; malformed AI; rules; provider request isolation; fresh-state revalidation; nonoverlap and accelerated 5ms scheduling; stopping after three failures; 200-line cap; sample cap; history reconstruction; RPC batch sizes and fallback order. |
| `npm run test:browser --prefix web` | 9/9 existing Chromium scenarios passed: home/connect, rejection/network switch, mint/allowance, holder controls, wallet swap, manual agent trade, owner controls, verification recovery and changed-price protection. |
| `node web/tests/autopilot-browser.mjs` | 17/17 Chromium scenarios passed against production `dist/` served under `/preview/`; no captured console/script/resource errors. Largest JSON-RPC batch: 3. |
| `HIC_BROWSER=webkit HIC_WEBKIT_EXECUTABLE=/tmp/neethome-webkit-run.sh node web/tests/autopilot-browser.mjs` | 17/17 WebKit scenarios passed. WebKit's default launcher lacked host libraries; the existing isolated `/tmp` library/launcher setup enabled the run. Those temporary libraries are not shipped. |
| `IMD_PLAYWRIGHT="$PWD/web/node_modules/playwright/index.mjs" node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste` | 16/16 passed on the final export's home route, including 320/390/1440 reflow, measured text contrast and metadata. |
| `web/node_modules/.bin/tsx web/tests/live.ts` | Read-only deployment verification passed at block 26189508; mintPrice was 200000000000000000 base units (0.2 IMD). Exact HIC launch-pool mint quote simulation passed. No transaction signed or broadcast. |
| Scope / formatting | `git diff --check` passed. Protected contract/dependency/build paths have no diff. No ignore-file changes, vendored registry, cache archive or submodule added. |

The browser scenarios cover the complete five-step setup; keyboard activation and focus of key creation; encrypted API save; agent-signed buy and full sell with exact fee/slippage assertions; malformed/oversized/foreign AI decisions; key lock/unlock and export-used persistence; cross-tab exclusion; Freeze; Share; reload behavior; and capture of request URLs, headers and bodies. No generated private key or passphrase appeared in a request. The test API key appeared only in its own provider header. Mock signed transactions were decoded and the signer recovered to verify the generated agent, chain and target. This evidence does not claim resistance to a compromised browser or same-origin script.

The existing retry test needed to wait for the failed verification to settle before resetting its mock; its previous timing race was repaired. The RPC fixture now recognizes both new fallback hosts; an initial request-capture run correctly exposed their absence from the mock's host list. Final Chromium capture has zero failures. These were test-fixture repairs, not suppressed production errors.

## Better Interface review: six domains

The pinned workflow and all six core domains were read before implementation. The app retains the existing paper/ink badge design rather than introducing a second visual system. Review includes the new route, its connected/disconnected states, rules and AI forms, the shared navigation change, and the home mint-price state.

| Domain | Coverage and findings |
| --- | --- |
| Accessibility — Checked | Native buttons, radio group, selects, details and labels; named inputs and 16px controls; keyboard Tab/Enter key creation with a visible solid focus outline; passphrase errors focus the input and use aria-describedby/aria-invalid; inline Freeze confirmation. Axe reports zero violations on rules layouts at 390/500/1440 and the AI form in both engines. Screen-reader, physical touch and forced-colors sessions were not performed. |
| Layout — Checked | Source grids/DOM order and actual production screenshots reviewed. At 390px the create-key action is above the fold; disconnected connect action also fits. 390/500/1440 Autopilot has no horizontal overflow in either engine. Home probe also checks 320. Navigation wraps, steps stack before brain controls, long addresses wrap. Native 200% zoom, translation and RTL variants were not tested in this change. |
| Writing — Checked | Action labels name their operation; setup statuses distinguish saved/locked, assigned, configured, funded and running. Provider disclosure says where the snapshot/key goes. Empty activity is labeled; skipped trades state a cause. Mint loading wording corrected. No fabricated performance data is added to runtime. |
| Typography — Checked | Existing six-size scale, two local font families and 400/600/700 weights retained. Prose remains Archivo, data Mono/tabular; input size 16px. Full addresses and error text wrap in inspected screenshots. No new tracked uppercase labels or decorative type scale. |
| Colors — Checked | Existing semantic tokens reused. Home probe's resolved text/background contrast checks pass; axe finds no contrast violations in tested Autopilot states. Selected/disabled/running/error states also have text or native control cues. No claim of measured contrast for every possible external wallet UI. |
| UI — Checked | Flat, ruled steps; native selection/disclosure; visible pending/disabled controls; local errors and transaction links. No new animation or sticky control. Reduced-motion browser contexts and the home motion probe pass. Provider HTTP error handling is unit tested; real paid provider error screens and wallet-native confirmations were not inspected. |

## Findings corrected

| Finding | Source in final implementation | Evidence, correction and recheck |
| --- | --- | --- |
| Medium: setup error/progress was too far from its action | `web/src/Autopilot.tsx:508` (`feedback`) | Source review found the shared message below all five steps. Each step/provider form now renders its own feedback. Wrong-passphrase recovery and keyboard focus passed in both browser suites; inspected first-screen layout remains intact. |
| Medium: Stop/Start discarded price history | `web/src/Autopilot.tsx:232`; `web/src/autopilot/adapter.ts:84` | Samples now live in a per-card page ref passed into each runner. Unit tests take 65 samples, confirm a 60-sample cap and reuse them after restart. Browser snapshots show accumulated history across runs. |
| High functional: recent top-ups could conceal the age of older holdings | `web/src/autopilot/adapter.ts:123`, `:228` | Backward reconstruction includes withdrawal quantities and retains the horizon age if earlier holdings remain. Unit tests cover withdrawals, older holdings plus top-ups, and full sell/rebuy cycles. No trade is guessed if history reads fail. |
| Medium: pending sends needed restart protection | `web/src/autopilot/adapter.ts` (`send`, `checkPending`); `web/src/autopilot/engine.ts` | Submitted hashes persist before receipt waiting. Unknown confirmation stops immediately; restart requires a receipt. Engine tests exercise the unknown-confirmation stop, and browser tests confirm signed sends and receipt links. Real RPC response-loss/reorg scenarios were not induced. |

## Evidence and limitations

- [Chromium interaction report](chromium-autopilot-results.json), [WebKit interaction report](webkit-autopilot-results.json), [home design probe](design-probe.json).
- [390px first setup screen](evidence/chromium-setup-first-screen-390.png), [500px](evidence/chromium-viewport-500.png), [1440px](evidence/chromium-viewport-1440.png), [AI settings](evidence/chromium-ai-settings-390.png), [WebKit 390px](evidence/webkit-setup-first-screen-390.png), [home first screen](evidence/home-first-screen-390.png).
- Screenshots and interaction reports use explicitly mocked holder/card data. Production has no test data or test keys. Scratch downloads containing generated test keys are not submitted.
- No real funded wallet transaction or paid AI call was made. Provider CORS, account quota and availability of the requested `claude-haiku-5-5` model depend on the holder's provider; this run does not certify them. The OpenAI-compatible provider request shape is unit tested.
- This is a tab-local runner. Background throttling, sleeping/closed tabs, origin changes and lost passphrases affect availability; there is no service worker or backend. Reload/navigation locks secrets and resets samples. The next-run history scan recovers chain-based age/cooldown, not a continuous price series.
- Web Locks and Web Crypto require a supported secure browser origin. Existing wallet connector behavior was intentionally preserved; no new relay or Smart Wallet integration was added.
- Browser APIs cannot undo a submitted trade. The on-chain freeze can race a pending transaction. No live reorg, adversarial RPC or third-party browser extension audit was performed.
- No main-repository Git metadata was changed. Submission size is checked as a complete file-tree snapshot, excluding generated dependencies and scratch inputs; the [size record](submission-budget.json) accompanies this report.

The root [DESIGN.md](../../../DESIGN.md) documents implemented tokens, typography, components and responsive behavior. The root [README.md](../../../README.md) documents installation, preview, rebuild, Autopilot semantics and test commands.
