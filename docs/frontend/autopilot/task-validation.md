# Autopilot task validation

Worker validation on 2026-10-14. Complete for the stated web-app scope. The existing Autopilot implementation was retained, corrected to use **HIC as its only default watched coin**, rebuilt and checked. The export in root `dist/` is ready for the assignment publisher under **hic.site.identitymd.eth**; this task did not invoke publication or transact on mainnet. These are local results, not independent certification.

## Implementation and acceptance coverage

| Requirement | Final implementation and evidence |
| --- | --- |
| `#/autopilot`, navigation, owned cards | Existing hash route and Autopilot nav item; holder filtering plus direct card lookup. Disconnected connect action and connected setup inspected at 390px. |
| Five setup steps | Browser tests create the agent, export once, sign `setAgent`, skip an existing assignment, sign the default 2 / 0.5 IMD limits, send 0.003 ETH to the generated address, and Start/Stop. Freeze uses the holder and disables Start. |
| Private agent and API secrets | Browser-generated secp256k1 key; AES-256-GCM, PBKDF2-SHA-256 with 200,000 iterations, fresh salt/IV and card-specific authenticated context. Wrong passphrases, tampering, changed context, stale writes and concurrent exports are tested. Reload locks the key. |
| Tab-local loop | 60-second interval, no overlapping checks, cancellation at asynchronous boundaries, at most one action, re-read limits before sending, and stop after three failed sends. Tests use an accelerated interval for timing behavior. Unknown transaction confirmation stops immediately and preserves the pending hash. |
| Watchlist and pricing | HIC comes from the deployment manifest; extra addresses are holder-entered. Untradable coins are excluded. Adapter tests verify the 0.05 IMD quote size and 60-sample limit; source review confirms the existing Trade quoter and exact launch-pool checks are reused. |
| Rules | All six numbers editable; defaults are 5% over 10 samples, +12% profit, -8% loss, 12-hour hold and one-hour cooldown. Tests cover budget exhaustion, momentum, every exit and cooldown. Position ages are reconstructed from on-chain events. |
| Your AI | Anthropic direct-browser header and default `claude-haiku-5-5`; HTTPS OpenAI-compatible URL/model. Unit request capture checks both provider formats. JSON snapshot includes limits, balance, spending, position cost/value/P&L and 10/60-sample changes. Invalid JSON becomes hold. |
| Order safeguards | Tests reject oversized/minimum buys, foreign or untradable coins, sells above position, frozen cards and revoked agents. Browser tests inspect locally signed buy/sell calldata, fees and 3% slippage; simulation precedes broadcast. |
| Activity and Share | Last 200 local entries, upsert of submitted/confirmed transaction, empty-reason fallback, explorer link and persisted reload history. Browser tests verify Share uses actual closed-trade statistics and `#/agent/<id>`. |
| Plumbing and existing flows | Tests assert RPC batches never exceed 3 and both requested fallback URLs follow the original RPCs. Mint shows “Checking price…” before a read and 0.2 IMD after the successful live read. Nine existing site-flow scenarios pass. |
| Static export | Relative assets and hash routes work under `/preview/`. Title, description, favicon, `og:title`, `og:image` and local fonts are present. Original manifests, lockfile, build configuration, contracts, addresses, ABIs and existing routes are preserved. |

## Findings and repairs

| Severity / source | Observed problem, fix and recheck |
| --- | --- |
| High — `web/src/autopilot/model.ts:232` | The inherited default contained five unrelated hard-coded addresses in addition to HIC. It now returns only the manifest's HIC address. Unit assertion and both browser suites confirm this default; adding a second, untradable address produces one skipped coin and leaves HIC eligible. |
| Low — `web/src/Autopilot.tsx:710` | Creating a fresh key incorrectly said “Unlocking key…”. The pending text now distinguishes creation from unlocking. Both setup suites pass. |
| Low — `web/src/Autopilot.tsx:616`, `:1230`, `:1280` | Watchlist copy named the removed defaults, whitespace-only counting miscounted comma input, and a single entry said “coins”. Copy now describes HIC and holder additions; the summary counts distinct comma/newline-separated entries and uses singular/plural labels. Browser screenshot and dropped-coin assertion confirm the final state. |

The first rebuild caught TypeScript inferring the watchlist state as a single address type. Giving `defaultWatchlist` its explicit editable-text return type resolved it. The final build and standalone typecheck pass.

## Commands and actual results

Dependencies were installed from the **unchanged lockfile** in `/tmp/hic-autopilot-work/web`, using `npm ci --cache /tmp/hic-autopilot-npm-cache --no-audit --no-fund`. Source/tests were copied byte for byte. Build scripts accessed the repository's Git object store read-only with `GIT_DIR` to verify the pinned ABI commit. No repository `node_modules`, dependency, lockfile, ignore file or build configuration was changed.

Commands below use repository-relative paths for repeatability; build and test invocations used the matching temporary paths on this machine. The final export was copied back in full and compared byte for byte. The design probe ran from the repository against its `dist/`.

| Command | Result |
| --- | --- |
| `npm run build --prefix web` | Passed TypeScript, Vite, ABI/deployment verification and asset hashes. 21 inventoried assets, **949,837 bytes**, excluding the deployment manifest. Existing Vite advisory: main chunk 631.07 kB / 196.16 kB gzip; no build error. |
| `npm run typecheck --prefix web` | Passed without diagnostics. |
| `web/node_modules/.bin/tsx --test web/tests/core.test.ts web/tests/autopilot.test.ts` | **25/25 passed** (11 core, 14 Autopilot). Includes encryption, required invalid decisions, loop cancellation/nonoverlap, failed-send stop, provider isolation, activity retention, sample limit, position ages and RPC fallbacks. |
| `node web/tests/browser.mjs` | **9/9 Chromium scenarios passed**. Mint, holder management, manual agent trades, wallet swap, owner controls, wallet/network errors and verification failure/retry. No captured script/console errors. |
| `node web/tests/autopilot-browser.mjs` | **18/18 passed in Chromium and 18/18 in WebKit**. Setup, locally signed mocked trades, AI errors/holds, key persistence, Stop, Freeze, Share, responsive views and axe scans. Largest RPC batch: 3; no captured script/console/local-resource errors. |
| `node web/tests/autopilot-vault-browser.mjs` | **4/4 passed in each browser**. Cross-tab synchronization, delayed storage events, concurrent creation/export, stale API saves and missing Web Locks. |
| Request capture | Both end-to-end suites assert the private key/passphrase never appear in URL, headers or body; the API key appears only in its provider's header. No private test exports are delivered. |
| `web/node_modules/.bin/tsx web/tests/live.ts` | Read-only verification passed against the supplied mainnet configuration. Both original RPCs returned chain ID 1. Mint price was **200000000000000000 base units = 0.2 IMD**; exact launch-pool quote simulation passed. No signing or broadcast. |
| `PLAYWRIGHT_BROWSERS_PATH=/tmp/hic-autopilot-browsers IMD_PLAYWRIGHT=/tmp/hic-autopilot-work/web/node_modules/playwright/index.mjs node .imd/reads/skills/design-critic/scripts/taste.mjs --out /tmp/hic-autopilot-taste` | **16/16 passed**: home render, layout, targets, contrast, casing, tracking, hierarchy labels, type sizes/faces, glyphs, copy, repetition, surfaces, motion and share metadata. Home measured at 320, 390 and 1440px. |

Chromium used Playwright build 1248 / browser 156.0.8078.4; WebKit used build 2370 / version 27.2. WebKit initially lacked system libraries and its network process failed without a usable proxy resolver. Downloaded/extracted libraries, a software-rendering launcher and `GIO_USE_PROXY_RESOLVER=dummy`, all under `/tmp`, resolved the environment issue. Both final WebKit suites completed. No browser binaries, library packages or caches are submitted.

## Better Interface consolidated review

The product is a holder-controlled trading desk, presented through the existing warm-paper, dark-ink layout and ruled five-step form. Read and applied the pinned workflow and core principles in all six domains. No unrelated redesign was made.

| Domain | Coverage and outcome |
| --- | --- |
| Accessibility — checked | Native labels/buttons/radios, keyboard Tab/Enter creation, wrong-passphrase feedback and focus, disabled/pending states. Axe found zero violations in tested Autopilot Rules/AI views at 390, 500 and 1440px in both engines. Browser-tool check confirmed the wallet dialog focuses Close, Escape closes it and focus returns to Connect holder wallet. Screen-reader and forced-colors sessions were not performed. |
| Layout — checked | Inspected final connected/disconnected 390px screens, AI settings, and 500/1440px screenshots in both engines. Product and Create agent key fit on the first 390×844 screen; no horizontal overflow. Setup precedes settings on mobile and sits beside them on desktop. Home's 320px probe passes. Native 200% zoom, RTL/localization and physical devices were not tested. |
| Writing — checked | Corrected HIC-only instructions, creation status and coin counts at the source locations above. Existing errors explain recovery; live values, unavailable reads and local-only activity remain distinct. |
| Typography — checked | Verified the six source tokens, 400/600/700 weights, local Archivo/JetBrains Mono assets and 16px inputs. Inspected full-address wrapping, section hierarchy and mobile labels. The home probe confirms two families and three weights. |
| Colors — checked | Source tokens unchanged. Final probe reports all resolved text pairs meet 4.5:1, or 3:1 for large text; Autopilot axe checks also pass. No claims about third-party wallet screens or untested color modes. Status is conveyed in words as well as color. |
| UI — checked | Pending, success, locked, exported, skipped, error/retry, frozen and stopped states exercised. Existing flat surfaces, dividers, focus rings and normal-flow feedback preserved. Reduced-motion contexts and home motion probe pass. No new animation/theme/overlay; animation-panel testing is not applicable to these changes. |

Final source tokens, typography, components and responsive behavior are documented in root [DESIGN.md](../../../DESIGN.md). No unresolved applicable design finding was observed in the changed surface.

## Evidence and limitations

Current results: [Chromium Autopilot](task-evidence/chromium-autopilot.json), [WebKit Autopilot](task-evidence/webkit-autopilot.json), [Chromium vault](task-evidence/chromium-vault.json), [WebKit vault](task-evidence/webkit-vault.json), [existing site flows](task-evidence/chromium-existing-flows.json), [home probe](task-evidence/home-design-probe.json), [live reads](task-evidence/live-read.json), [submission budget](task-evidence/submission-budget.json).

Inspected representative screenshots: [390px setup](task-evidence/chromium-setup-first-screen-390.png), [500px](task-evidence/chromium-viewport-500.png), [1440px](task-evidence/chromium-viewport-1440.png), [WebKit 390px setup](task-evidence/webkit-setup-first-screen-390.png). Additional inspected screenshots remain temporary; all shipped screenshots use mocked wallet data.

Tests do not establish funded-mainnet trade execution, paid provider availability/model access/CORS, real wallet signatures, physical-phone behavior or full accessibility compliance. The holder supplies their own AI key; no paid-provider call was attempted. The agent remains tab-local, subject to browser sleep/throttling, and stops on leaving Autopilot or changing the wallet/network. A previously broadcast transaction can still confirm after Stop. Web Locks coordinate updated tabs on the same origin; publishing cannot rewrite an already-open older app. The existing on-chain interfaces and wallet connections remain unchanged.
