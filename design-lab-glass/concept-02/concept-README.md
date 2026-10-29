# Command Deck

**Concept:** Command Deck — a fantasy football control surface with the calm precision of a coach's tablet, not a scoreboard trying to look exciting.

## Pitch

Command Deck treats your fantasy team like a live operation, not a toy. A near-black, cool-toned ground holds a single restrained material — true liquid glass — reserved entirely for navigation and floating chrome: the top status bar, the bottom tab bar, and the modal bid sheet all refract the HUD-schematic content stacked beneath them. Content itself sits flat and legible on its own layer. Exactly one signal color, a live-wire cyan, is spent only on what actually needs your attention right now — a live win-probability swing, a pending FAAB claim, an active game clock. Everything else stays desaturated so that when the accent fires, it reads as a genuine alert rather than decoration. Space Grotesk gives scores and headlines their geometric, technical edge; DM Sans keeps dense stat columns — set in tabular figures — legible at a glance. The result should feel less like a social app that happens to have football in it, and more like a mission-control display built by someone who already ran the numbers.

## Signature interaction moments

1. **Live gamecast win-probability graph** (`#/matchup`) — a hand-drawn SVG area chart tracks Turf Kings' win probability across the live quarter, with a segmented control that swaps the same card between the graph and a scannable key-play feed (highlighted plays glow in the signal accent). A background timer ticks "updated Xs ago" in the topbar to keep the screen feeling alive without re-triggering layout.
2. **FAAB bid sheet** (`#/waivers`) — tapping "Bid" on a free agent slides a true glass bottom sheet up from the thumb zone with a tactile stepper for the FAAB amount; submitting writes the claim back into state and the waiver row updates in place to show the locked-in bid.
3. **Specular lensing highlight** — every glass surface carries a diagonal light-catching sweep. On a fine-pointer device it tracks `pointermove` across the viewport (a subtle parallax "lensing" cue); on touch it stays fixed, and `prefers-reduced-motion` disables any movement outright.

## Tech notes

- Vanilla JS hash router (`#/home`, `#/matchup`, `#/team`, `#/league`, `#/waivers`, `#/chat`, `#/player/:id`) rendering template-literal HTML into a single `<main id="view">`. Zero framework, zero build step, zero dependencies beyond two Google Fonts.
- Fixed 390px canvas throughout — no `@media (min-width:…)` desktop rules exist anywhere in `styles.css`.
- `prefers-reduced-motion` disables the specular pointer-tracking and softens the bid-sheet transition; `prefers-reduced-transparency` swaps every `backdrop-filter` glass surface for a solid opaque one via a dedicated token override block at the top of `styles.css`.
- All interactive surfaces (tab bar, segmented controls, bid stepper, chat send, standings/player taps) are real event-driven state changes — nothing is a static screenshot.
- Mock content (league, roster, live scores, chat) is sourced from the shared `design-lab/shared/mock-data.md` reference and extended with additional believable detail (waiver-wire free agents, play-by-play, player box scores) to keep the app feeling lived-in. The league was extended from the reference's 10 teams to 12 to match the brief's standings-screen spec, in the same tone as the existing franchises.

## Files

- `index.html` — shell linking `styles.css` + `app.js`
- `styles.css` — full design system (tokens, glass primitives, layout, views)
- `app.js` — router, view renderers, mock data, interactions
- `artifact.html` — single self-contained merge of the above three, for Claude Artifact publishing
