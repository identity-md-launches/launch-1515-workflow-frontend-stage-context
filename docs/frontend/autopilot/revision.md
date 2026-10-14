# Autopilot revision validation

Worker checks performed on 2026-10-14. All three reported findings reproduced on the accepted export before source edits and are fixed. Findings are answered individually in root `.imd-responses.json`. This is local evidence, not independent certification.

## Reproduction and repair

| Finding | Before edits | Repair and final checks |
| --- | --- | --- |
| `86f5e67b…` — stale tab overwrites funded key | Two Chromium tabs, same origin/holder/card, 390×844. A created and assigned a key, funded it with mocked 0.003 ETH, and did not export. B created a different key; storage contained B's address while A's agent retained the ETH. A could no longer unlock with its passphrase after reload. Both unlocked tabs also downloaded an identical key. | `web/src/autopilot/vault.ts:142` serializes vault operations using a separate per-card Web Lock and reads storage inside it. `:156` rejects a changed expected record immediately before writing. `web/src/Autopilot.tsx:431` applies the lock/check to creation, unlock, export and API saves; `:329` synchronizes storage changes. Changes to encrypted secrets lock/stop other tabs; an export-only change preserves unlocked secrets but removes the offer. Four cross-tab scenarios pass in each browser. |
| `d3ca9fd0…` — empty AI explanation loses a check | One mocked provider request returned `{"action":"hold","reason":""}`. The completed check left Activity at 0 rows. | `web/src/autopilot/model.ts:172` trims reasons and supplies `AI chose hold without a reason.` for an empty hold. Empty/whitespace/explicit explanations are unit tested. Each browser verifies one request appends one explained row, without a trade. |
| `08377299…` — slogan on setup tool | The paragraph occupied 350×24px at y=250.390625. Removing it in the browser moved the banner from y=290.390625 to y=258.390625. | Removed that paragraph in `web/src/Autopilot.tsx:106`; no CSS/token changes. The final banner starts at y=258.390625 in both connected and disconnected views. Create agent key ends at y=722.578125 inside the 390×844 viewport. |

[Before measurements](revision-evidence/before.json) and [final layout measurements](revision-evidence/layout-after.json) contain no secret keys. All funds, wallets and AI replies in the interaction tests are mocks; no live transaction or paid provider request was sent.

The storage format remains version 1, so existing encrypted keys unlock without migration. The new lock is named with the existing chain/desk/holder/card storage key plus `:vault`; it is distinct from the long-lived engine lock. API saves and export updates cannot replace a newer envelope or reset a consumed export flag. Storage events reread the latest record, rather than trusting a possibly older queued event payload. Missing Web Locks fail visibly without creating a vault.

## Commands and results

Dependencies were installed from the unchanged lockfile into a temporary mirror at `/tmp/hic-autopilot-revision/web` using `npm ci --cache /tmp/hic-autopilot-npm-cache --no-audit --no-fund`. No repository `node_modules`, package manifest, lockfile, build configuration or ignore file was changed. The mirror contains byte-identical source and tests; its build used the repository's existing Git object store read-only through `GIT_DIR` for the pinned ABI check. Its complete production export was copied to repository `dist/` and compared byte for byte.

The commands below use normal repository paths; on this machine the build/test commands used the matching paths under that temporary mirror. The design probe ran from the repository against its final `dist/`.

| Command/check | Actual result |
| --- | --- |
| `npm run build --prefix web` | Passed: TypeScript, Vite, asset inventory, pinned ABI and deployment/network checks. Final runtime inventory: 21 assets, 950,002 bytes excluding the manifest. Existing nonfatal main-chunk size advisory remains (~631.24 kB, ~196.38 kB gzip). |
| `npm run typecheck --prefix web` | Passed, no diagnostics; also included in the final build. |
| `web/node_modules/.bin/tsx --test web/tests/core.test.ts web/tests/autopilot.test.ts` | 25/25 passed: 11 existing core tests plus 14 Autopilot tests, including new stale-write and empty-explanation regressions. Encryption still uses PBKDF2 200,000 iterations and AES-GCM. |
| `node web/tests/browser.mjs` | 9/9 existing Chromium scenarios passed: mint, holder controls, manual agent trade, swap, wallet/network/error recovery and owner controls. No captured console/script errors. |
| `node web/tests/autopilot-browser.mjs` | 18/18 passed in Chromium and 18/18 in WebKit on the final export under `/preview/`. Five-step setup, provider saves, locally signed mocked buy/sell, limits, malformed and empty AI replies, Start/Stop, Freeze, Share, export/reload, keyboard and accessibility checks. Largest RPC batch: 3; zero captured console/script/local-resource errors. |
| `node web/tests/autopilot-vault-browser.mjs` | 4/4 passed in Chromium and 4/4 in WebKit on the final export. Pre-opened tabs preserve the funded key across reload; simultaneous creates and exports are queued under an actual Web Lock with storage notifications deliberately suppressed; stale export/API conflicts preserve newer records; unavailable locks write nothing. |
| Request capture | The existing end-to-end suite captures URL, headers and body: private key/passphrase absent from all requests; API key only in its own provider's header. Cross-tab tests additionally check passphrase/API-key absence while saving and exporting. |
| Responsive/accessibility checks | 390, 500 and 1440px in both engines: no horizontal overflow; zero axe violations for the tested Rules and AI states. Inspected screenshots show the main action on the first 390px screen. |
| `IMD_PLAYWRIGHT=/tmp/hic-autopilot-revision/web/node_modules/playwright/index.mjs node .imd/reads/skills/design-critic/scripts/taste.mjs --out test/scratch/taste` | 16/16 passed against final root `dist/`, including 320/390/1440 home reflow, resolved text contrast and share metadata. The earlier offline run also passed 16/16. `PLAYWRIGHT_BROWSERS_PATH=/tmp/hic-autopilot-browsers` selected temporary browser binaries. |
| Scope and static export | `git diff --check` passed. Contracts, addresses, ABIs, routes, RPC setup, dependencies, lockfiles, build configuration and ignore files have no source diff. Generated old JS chunks were replaced, with relative asset URLs and the matching manifest. |

Chromium was 156.0.8078.4 (Playwright build 1248); WebKit was 27.2 (build 2370). The default WebKit launcher initially failed because this host lacks libraries, and a first temporary launcher then failed to create an EGL display. A launcher confined to `/tmp`, using existing isolated libraries, `LIBGL_ALWAYS_SOFTWARE=1` and `__EGL_VENDOR_LIBRARY_FILENAMES` pointing to the isolated Mesa configuration, resolved these environment failures. Both final WebKit suites completed. No platform libraries or browser archives are shipped.

## Better Interface review

Read the pinned workflow and core principles of all six domains and preserved the site's paper/ink design. Review scope is the changed Autopilot key states, activity explanation and heading, plus the existing flows exercised by the regression suite.

| Domain | Coverage, findings and limitations |
| --- | --- |
| Accessibility | Native labeled inputs/buttons, inline alerts and status messages remain. Keyboard Tab/Enter creation and wrong-passphrase focus checks pass in both engines; axe finds zero violations in tested states. The added cross-tab notice at `web/src/Autopilot.tsx:767` uses the existing feedback style and a polite status region. Screen-reader and forced-colors sessions were not performed. |
| Layout | Inspected connected and disconnected 390px states and production 500/1440px screenshots in both engines. The slogan removal moves existing content up 32px without adding a gap. Setup stays before configuration on mobile; no overflow. Native 200% zoom, physical devices and RTL/localization variants were not tested. |
| Writing | Fixed the reported slogan at `web/src/Autopilot.tsx:106`. Conflict feedback at `web/src/autopilot/vault.ts:134` tells the holder to unlock the saved key and retry. Empty AI explanations at `web/src/autopilot/model.ts:172` now say what happened. No new performance claims or marketing text. |
| Typography | The existing six-size scale, local Archivo/JetBrains Mono fonts and 400/600/700 weights are unchanged. Reviewed heading hierarchy and full-address wrapping in both engines; form inputs remain 16px. No new size or tracking rules. |
| Colors | No token changes. Final home probe passes its measured resolved text/background contrast checks; Autopilot axe checks pass at all three requested widths and for the AI form. No assertion about every third-party wallet surface or untested color mode. |
| UI | Flat step dividers, existing primary/disabled/focus styles and normal-flow feedback are retained. Observed saved/locked/unlocked/export-used/conflict states and successful retry. No animation or overlay added; reduced-motion contexts and the home motion check pass. No manual animation-panel session was needed for this static revision. |

No additional applicable design defect was found in the changed surface. [DESIGN.md](../../../DESIGN.md) records the final heading and synchronized key-state behavior alongside unchanged tokens/components.

## Evidence and limits

- [Chromium Autopilot](revision-evidence/chromium-autopilot.json), [WebKit Autopilot](revision-evidence/webkit-autopilot.json), [Chromium cross-tab](revision-evidence/chromium-vault.json), [WebKit cross-tab](revision-evidence/webkit-vault.json), [home design probe](revision-evidence/home-design-probe.json).
- Inspected screenshots: [390px first action](revision-evidence/chromium-setup-first-screen-390.png), [500px](revision-evidence/chromium-viewport-500.png), [1440px](revision-evidence/chromium-viewport-1440.png), [WebKit 390px first action](revision-evidence/webkit-setup-first-screen-390.png). Full-page and further WebKit screenshots were inspected in scratch; only these compact representative images are included.
- Tests do not certify funded mainnet behavior, paid provider availability/CORS, background execution, physical phones, a compromised origin, or browser extensions. The existing runner remains tab-local. No new live chain verification was needed for this revision; deployed interfaces and network configuration are unchanged.
- Cross-tab serialization requires tabs using the updated app and the same browser origin. A pre-upgrade tab still executing old JavaScript is not rewritten by publishing new assets. This change cannot recover a key already overwritten before the fix; a separately retained export is still required for such recovery.
- The static export is ready for the assignment publisher under **hic.site.identitymd.eth**. No publishing command or repository Git metadata mutation was performed. [Submission budget](revision-evidence/submission-budget.json) measures the complete deliverable snapshot; dependency/cache directories and test downloads are outside it.
