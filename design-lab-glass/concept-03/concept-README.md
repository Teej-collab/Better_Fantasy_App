# The Huddle

**Concept name:** The Huddle

## Pitch

The Huddle is a mobile-first fantasy football app built around the feeling of the group chat that never sleeps — warm locker-room light instead of cold stadium floodlights, a genuine "liquid glass" material used exactly where Apple's own system uses it (floating navigation, the top status bar, sheets) rather than smeared across every card. Every screen was designed at a fixed 390px phone canvas first, with big thumb-reachable actions, condensed display type for scores and scoreboard energy, and a warm gold/burnt-orange/rally-red palette pulled from worn leather and oak lockers rather than generic SaaS blue. The whole app leans into what makes a 12-team (well, 10-team) league actually fun to check obsessively on a Sunday: live scores, real trash talk, a named rivalry ("The Sunday Massacre"), and records people brag about.

## Signature interaction moments

1. **The floating glass tab bar** — a true frosted-glass pill anchored above the scrolling content (not a flat bar at the very edge), with a gradient "lensing" edge highlight and a slow diagonal specular sweep that catches the eye without being gimmicky. On fine-pointer devices it also gets a soft pointer-follow highlight; on touch it stays static. Both the sweep and the pointer lens respect `prefers-reduced-motion`, and everything drops to solid opaque panels under `prefers-reduced-transparency`.
2. **Live gamecast that actually feels live** — the Home hero card and the dedicated Gamecast screen show a real win-probability bar, a scrolling live play log, and a starter-vs-starter scoring ladder, all tappable through to individual player detail pages with a 6-week trend chart.
3. **Waiver wire bid flow + reactive league chat** — place a real FAAB bid on a free agent and watch it appear in a "My Claims" strip with a remove control; in League Chat, tap a message to add/remove a 🔥 reaction (counts update live), switch between the League thread and a rival DM thread, and send your own message that lands in the thread instantly.

## Tech notes

- Vanilla JS hash router (`#/home`, `#/matchup`, `#/team`, `#/league`, `#/waivers`, `#/chat`, `#/player/:id`) rendering template-literal HTML into a single `<main id="view">`. Zero framework, zero build step, zero npm dependencies.
- All content is mock data inlined in `app.js`, cross-referenced against the shared league facts (The Weekend League, Turf Kings/Tyler, the Turf Kings vs. Air Yard Sale "Sunday Massacre," real roster names, league records).
- Fixed 390px canvas throughout — no `@media (min-width: …)` rules exist anywhere in `styles.css`; every spacing and touch-target decision (44px minimum) was made for a phone in hand.
- Six named color tokens: `--ground`, `--surface`, `--gold`, `--ember`, `--rally-red`, `--cream`.
- Glass system implemented with layered `backdrop-filter: blur() saturate()`, a gradient border via mask-composite for the lensing edge, and a contained animated specular sweep — used only on the top bar, bottom tab bar, chat composer, and modal sheet, never smeared across ordinary content cards.
