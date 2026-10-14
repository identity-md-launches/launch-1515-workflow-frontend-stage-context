# Handlers In Control design system

## Overview

The implemented site serves card holders and their trading agents. Its visual system is a printed desk and ID badge: warm paper, dark ink, condensed headings and a flat, ruled layout. Autopilot extends that system with a five-step setup beside a brain configuration panel. It does not change the existing mint, card management, public record or wallet swap designs.

Source of truth: `web/src/style.css`, shared components in `web/src/components.tsx`, the frame in `web/src/App.tsx`, and the new assembly in `web/src/Autopilot.tsx`. The root `dist/` is the production export. The older `docs/DESIGN.md` describes the original implementation; this document adds the final Autopilot behavior.

## Colors

The existing semantic tokens remain unchanged, in hexadecimal notation:

| Token | Value | Implemented role |
| --- | --- | --- |
| `--paper` | `#f2f1ec` | Page, dialog, inverse button text |
| `--ink` | `#101010` | Text, primary action fill, structural rules |
| `--muted` | `#575750` | Supporting copy, step statuses, disabled text |
| `--surface` | `#e7e6df` | Notices, selected brain, hover and disabled fills |
| `--white` | `#faf9f5` | Input and textarea backgrounds, badge stock |
| `--line` | `#b7b7ab` | Field boundaries and section separators |
| `--win` | `#10a957` | Network verification dot |
| `--loss` | `#e0362c` | Existing loss palette primitive |
| `--win-text` | `#08743c` | Positive results |
| `--loss-text` | `#b02720` | Errors, negative results, Freeze control |
| `--focus` | `#101010` | 2px keyboard outline, offset 4px |

Statuses also use words: locked, unlocked, skipped, frozen, running and stopped. Color is not the only signal. No new theme or accent ramp was added. Rendered automated contrast checks are recorded in `docs/frontend/autopilot/validation.md`.

## Typography

Archivo is the locally bundled variable font, with Arial/sans-serif fallbacks. Its normal face supports weights 100–900 and widths 62–125%; the interface uses 400, 600 and 700. Headings use 75% stretch, while the badge wordmark uses 62%. JetBrains Mono Latin 400 is bundled for addresses, amounts and code, with monospace fallback. Fonts and their OFL notices remain in the source and static export.

The six root sizes at 16px are `--small` 14px, `--body` 16px, `--subhead` 20px, `--heading` 28px, `--display` 44px and `--hero` 64px. Main headings reduce to 44px on phones. Body line height is 1.5; headings use 1.1 and balanced wrapping. Main heading tracking is -0.025em; h2 tracking is -0.015em; body and small text have natural spacing. Inputs and textareas remain 16px. Numeric values and activity times use tabular figures. Addresses wrap in full; the header's abbreviated wallet address opens its full details.

## Layout

The shared frame is `min(1200px, 100% - 80px)`. Above 1500px it becomes `min(1280px, 100% - 120px)`. Gutters are 24px at 1000px, 20px at 700px and 16px at 360px. Existing pages retain their responsive grids.

Autopilot uses `minmax(0, 1.2fr) minmax(0, 1fr)` columns with a 72px gap, reduced to 32px at 1000px. It becomes one column at 760px: setup first, brain/settings second, activity below. The card picker is at most 520px. Rule fields have two columns, collapsing at 390px; shared paired inputs collapse at 360px. Mobile navigation wraps to a second row rather than scrolling sideways. Controls remain in normal flow; no sticky toolbar obscures content.

Spacing uses the existing 8, 12, 16, 20, 24 and 32px steps, with larger gaps between sections. Steps are separated by rules and 20–24px vertical padding. Activity is a two-column time/decision list, stacked at 390px. Prose is capped at 65ch. Full IDs and errors wrap with `overflow-wrap:anywhere`.

Production screenshots and interaction checks cover Autopilot at 390, 500 and 1440px in Chromium and WebKit. The 390px initial screen contains the product, card picker, passphrase and Create agent key button. The home probe also covers 320px reflow. These are emulated viewports, not physical-device or native-zoom tests.

## Elevation & depth

The interface is flat. Background tone groups the tab-only banner and selected brain; rules separate steps and activity rows. Surfaces do not combine borders with shadows. The existing native wallet dialog uses a translucent backdrop. Autopilot adds no overlay, glow or gradient. The inline freeze confirmation keeps its consequence beside the action.

## Shapes

Fields, buttons and structural panels use square corners and 1px borders. The banner has a 3px leading rule. The existing badge retains its slot and lanyard motif and -4deg desktop / -2deg mobile angle. Controls have at least 44px minimum height; brain radio labels are 48px. The native radio dot carries its selected state as well as the surrounding border/fill.

## Components

| Component or pattern | Source | Behavior |
| --- | --- | --- |
| Shared frame / nav | `web/src/App.tsx` | Existing hash routes plus `#/autopilot`, `aria-current`, skip link, focus moved to main after navigation |
| `Field` | `web/src/components.tsx` | Visible label, hint/error association, 16px input, numeric/decimal keyboards, validation state |
| `AddressText` | Same | Full checksummed address, explorer link, local copy feedback |
| `TxAction` / `SpendAction` / `ReadAction` | Same | Existing wallet, allowance, simulation, pending, receipt and error flows |
| `WalletDialog` | Same | Existing native dialog and wallet discovery; preserved by this task |
| `Step` | `web/src/Autopilot.tsx` | Local ordered setup pattern with number, heading, textual status and one principal action |
| Brain toggle | Same, `.brain-toggle` | Native radio group, keyboard support, visible selected state; settings disabled during a run |
| Setup feedback | Same, `feedback()` | Errors and transaction progress adjacent to the affected step; passphrase error associates with its input and returns focus |
| Start / Stop | Same | Explicit running state, status text, no automatic restart after reload; no queued overlapping checks |
| Freeze | Same, `.autopilot-freeze` | Holder-only action with inline Confirm freeze / Cancel; unavailable when already frozen |
| Watchlist | Same | Native details disclosure, labeled multiline address field, dropped-coin disclosure after a check |
| Activity | Same, `.activity-list` | Time, brain, decision, reason and transaction link; latest 200 local entries; actual closed-trade statistics in Share |

Buttons retain distinct default, hover, disabled and focus states. Errors use alerts; loop status uses a polite status region. The original new-card print animation is gated by `prefers-reduced-motion: no-preference`; Autopilot adds no animation.

## Do's and don'ts

- Add pages inside the shared hash router and frame. Reuse the type scale, fields, address display and action patterns.
- Put the actionable form before supporting explanations on mobile. Keep full amounts and addresses available.
- Use ink for a primary action and `--loss-text` for errors/destructive controls. Add textual state alongside color.
- Keep wallet writes in the verified chain/context flow and agent writes in the isolated Autopilot adapter. Never put secrets in UI text, activity, URLs or the deployment manifest.
- Keep loading, unavailable and zero states distinct. Show live values only after reads succeed.
- Preserve the flat paper treatment; do not add nested shadowed panels or another font system.

Design guidance is adapted from Jakub Krehel's Better Interface (MIT, `267330e1adfc66a718fb65fa6918c1f06d0a689e`). Documentation guidance is adapted from Paul Bakaus's Impeccable (Apache-2.0, `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8`). The combined license texts are retained in `docs/frontend/licenses/Better-Interface-LICENSE.txt`.
