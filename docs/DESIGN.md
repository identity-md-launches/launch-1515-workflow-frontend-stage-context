# Handlers In Control design system

This records the original frontend design. The current system, including Autopilot, is documented in [root DESIGN.md](../DESIGN.md).

## Overview

A trading permission system presented as a clean, printed ID badge. The interface uses off-white paper, dark ink, condensed Archivo headings and JetBrains Mono for numerical data. A tilted card on a short black lanyard is the single visual motif. The primary task is minting a permanent agent card; management, public records and wallet swaps are hash-routed secondary pages.

The first phone screen contains product identity, wallet connection, a short mint headline, the live price and name field, and the mint/connect control. The example badge follows the task on mobile. On desktop, the task and badge occupy two columns. Sample stats are explicitly labeled Example and never feed the live leaderboard.

## Colors

All semantic tokens are defined in `web/src/style.css`:

| Token         | Value     | Role                                           |
| ------------- | --------- | ---------------------------------------------- |
| `--paper`     | `#F2F1EC` | Page, modal and inverse button text            |
| `--ink`       | `#101010` | Primary text, primary action, structural lines |
| `--muted`     | `#575750` | Secondary copy and disabled text               |
| `--surface`   | `#E7E6DF` | Quotes, notices, hover and disabled fills      |
| `--white`     | `#FAF9F5` | Inputs and badge stock                         |
| `--line`      | `#B7B7AB` | Separators and input boundaries                |
| `--win`       | `#10A957` | Brand win accent; network verification dot     |
| `--loss`      | `#E0362C` | Retained requested loss palette primitive      |
| `--win-text`  | `#08743C` | Readable positive P&L and win text             |
| `--loss-text` | `#B02720` | Readable negative P&L and errors               |
| `--focus`     | `#101010` | 2px focus perimeter, 4px offset                |

The requested vivid green and red are preserved as palette primitives. Text uses darker variants for readable small numerals. The interface also says Win, Loss, Frozen, or Error and uses explicit signs; color alone never carries an outcome. Only the current primary flow receives a filled ink button. The deliberate paper theme has no unimplemented dark-mode switch. Rendered contrast evidence is in the validation report rather than inferred here.

## Typography

Two locally bundled WOFF2 faces:

- Archivo variable, Latin normal, actual weight range 100–900 and width range 62–125%. The source loads `archivo-latin-standard-normal.woff2` from the pinned fontsource package. Body uses weight 400; labels/actions and section headings use 600; main headlines and badge rate use 700. Headings use 75% font stretch, with 62% reserved for the badge wordmark. Fallback is Arial/sans-serif.
- JetBrains Mono Latin 400 for balances, addresses, quantities, code and selected identifiers. It is not used for prose. Fallback is monospace. Numbers use tabular figures. No synthetic bold is requested for mono data.

The scale is 14, 16, 20, 28, 44 and 64px at the default 16px root (`--small`, `--body`, `--subhead`, `--heading`, `--display`, `--hero`). Mobile uses a 44px main headline; the 64px step is desktop-only. Body line height is 1.5; headings use 1.1 with balanced wrapping. Main display tracking is −0.025em, section headings −0.015em, body and small data natural. Inputs stay 16px to avoid iOS focus zoom. Critical full values wrap instead of clipping. The header's abbreviated wallet address opens a dialog with the full checksummed address and copy/explorer controls.

## Layout and responsive behavior

The shared frame is at most 1200px wide, with 40px gutters on typical desktop. Above 1500px, the cap is 1280px with wider outer spacing. The implemented breakpoints are 1000, 700 and 360px; there is also the 1500px wide-screen adjustment.

At 1000px, gutters reduce to 24px and management controls stack inside their column. At 700px, the page becomes a single column with 20px gutters, the network text moves out of the compact header, the badge follows the form, and footer content stacks. At 360px, gutters reduce to 16px, the mint price stacks under the section title, and paired inputs become single-column. Navigation links wrap naturally rather than requiring horizontal scrolling. Wrong-network and read-error notices remain in normal flow and keep their retry/switch button visible.

Spacing predominantly uses 8, 12, 16, 20, 24, 32, 40, 48, 56 and 80px. The layout groups related information through space, rules and shared alignment. Long-form prose is capped at 65 characters. Numeric columns use `minmax(0, 1fr)` and `overflow-wrap:anywhere` where necessary. No content is hidden to suppress overflow.

Chromium and WebKit checks, tested viewports and screenshot evidence are recorded in `docs/frontend/VALIDATION.md`. The enlarged-text check is a 200% CSS root text-size test, not a claim of native browser zoom or physical-device coverage.

## Surfaces, shapes and motion

The design is flat. Buttons and fields are square; badges use one structural border without a drop shadow. The small physical slot in the badge has a 4px radius. No gradients, glows, pills, photo textures, shadowed card stacks, or marquee effects are used. The original on-chain SVG is separately loadable and is not modified.

The badge angle token is −4deg on desktop and −2deg at mobile widths. The smaller mobile angle was verified with unusually long values and enlarged text; it retains the lanyard idea without turning tall badges into horizontal overflow. Its decorative barcode is a bounded SVG instead of overflowing text glyphs.

The only animation is `.printed .badge`: a 700ms one-time movement from −40px into place with opacity, using `cubic-bezier(.2,0,0,1)`. It runs only on the new-card setup route and only under `prefers-reduced-motion: no-preference`. Reduced-motion users receive the same static card and setup text. There are no load animations, indefinite animations or `transition: all` rules.

## Reusable components

| Component      | Source                   | Behavior                                                                                                                                                     |
| -------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Field`        | `web/src/components.tsx` | Explicit label, 16px input, associated hint/error, decimal/numeric keyboard, optional validator, `aria-invalid`                                              |
| `TxAction`     | `web/src/components.tsx` | Connect gating, disabled prerequisites, its own pending/status label, persistent error, receipt link; shared transaction lock prevents duplicate submissions |
| `SpendAction`  | `web/src/components.tsx` | Reads allowance; shows approval or execution as consecutive stages; mint can require an exact allowance                                                      |
| `ReadAction`   | `web/src/components.tsx` | Quote/read busy state, duplicate request lock, recoverable inline error                                                                                      |
| `QuoteView`    | `web/src/components.tsx` | Estimated and minimum receive, units, timestamp, 60-second validity                                                                                          |
| `AddressText`  | `web/src/components.tsx` | Full wrapping checksum address, explorer link and clipboard feedback                                                                                         |
| `WalletDialog` | `web/src/components.tsx` | Native dialog with wallet choices/missing-wallet instructions; Escape, focus containment and return handled by the browser                                   |
| `Badge`        | `web/src/components.tsx` | Name, deterministic pixel sigil, rate, W/L, realized P&L, volume, trades and mint date; example and newly printed variants                                   |
| `Empty`        | `web/src/components.tsx` | Lightweight loading/empty/unavailable content in normal flow                                                                                                 |

Page assemblies are in `Home.tsx`, `Cards.tsx`, `Agent.tsx`, `Trading.tsx`, and `Builders.tsx`. The shared frame and hash navigation are in `App.tsx`. SPA route changes move focus to the main landmark. A skip link is available before the header. The wallet uses a native `<dialog>`, not a custom focus trap. Public announcements use status regions and action errors use alerts.

## Extension rules

Use the existing frame, page heading, field, quote and action components when adding an authorized page. Keep signing and verification in `context.tsx`/`chain.ts`; do not embed another deployment map in a new component. Use full token units near actions and label estimates. Keep state and evidence honest: empty reads are not zero balances, sample data is not live data, and a partially scanned leaderboard is not a complete ranking.

Keep headings at the existing scale and weights, use Archivo for prose and Mono for data, and preserve visible focus. Add a token only for a real semantic role. Keep the single filled action per flow and explicit approval steps. New content must survive 320/390px and longer addresses/amounts without clipping or shrinking the text.

## Attribution

Design guidance: Jakub Krehel's Better Interface, pinned commit `267330e1adfc66a718fb65fa6918c1f06d0a689e` (MIT). Documentation method: Paul Bakaus's Impeccable, pinned commit `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8` (Apache-2.0). Ethereum interaction guidance: Austin Griffith's ethskills frontend-ux, pinned commit `06ea4efa0807` (MIT). The assignment's supplied adaptations and licensing notices are retained under `docs/frontend/licenses/`. Archivo and JetBrains Mono retain SIL OFL notices in the source and export.
