# Under the Lights

## Pitch
A mobile-first fantasy football concept built from a phone screen outward, not shrunk down to one. The material language is true liquid glass — a floating, blurred, light-catching tab bar and score bug that sit above a genuine stadium-night backdrop (floodlight glow, turf grain, warm near-black ground) so the blur has something rich to refract — while every content surface underneath (scores, rosters, chat) stays on its own fully legible layer. The personality is broadcast night: amber floodlight gold as the primary accent, scoreboard red reserved for "live" urgency, condensed impact type (Bebas Neue) for scores and team names against a clean Barlow body face, so it reads like graphics off a live broadcast rather than a generic sports app.

## Signature interaction moments
1. **The gamecast score bug** (`#/matchup`) — a floating glass card with a live win-probability bar that animates in, a segmented control that swaps between "Turf Kings" and "Air Yard Sale" rosters without leaving the screen, and an expandable live play-by-play feed.
2. **The waiver bid sheet** (`#/waivers`) — tapping "Bid" on any trending add raises a true bottom glass sheet (blur + light-catching edge) with a live FAAB countdown and a submittable bid that actually updates the "My Claims" list in state.
3. **The splash kickoff clock** (`#/splash`) — a real ticking countdown (updated every second independent of the render cycle) behind a glass sign-in card, introducing the glass material and color language before the user is "in."

## Tech notes
- Vanilla JS hash router (`#/home`, `#/matchup`, `#/player/:id`, `#/waivers`, `#/chat`, etc.) rendering template-literal HTML into a single `#view` mount — zero framework, zero build step, zero dependencies beyond two Google Fonts.
- All interaction is real: a single delegated `click` listener on `document` reads `data-*` attributes (`data-nav`, `data-set-matchup-tab`, `data-standings-row`, `data-open-bid`, `data-submit-bid`, `data-send-chat`) and mutates a small in-memory `state` object, then calls `render()`. Chat input and the FAAB bid field are left uncontrolled (read on submit) specifically so typing never triggers a jarring full re-render.
- Fixed 390px canvas throughout; zero `@media (min-width: …)` rules. Every tab-bar target is 44px+ tall, and the tab bar and chat composer both sit in the bottom third of the screen.
- Liquid glass system lives in two CSS classes: `.glass` (nav, score bug, bottom sheet — `blur(28px) saturate(170%)`, a light-catching gradient edge via a masked `::before`, and one deliberate specular sweep via `::after`) and the lighter-touch `.card-glass` for secondary chrome. Plain `.card` is used for dense data (rosters, standings, stat tiles) so text contrast is never fighting a blur.
- `prefers-reduced-motion` strips the sweep animation, the live-pulse glow, and all transitions. `prefers-reduced-transparency` swaps every `.glass`/`.card-glass` surface to a solid opaque fill and removes `backdrop-filter` entirely.
- Mock content (teams, live matchup, rosters, waiver wire, chat) is inlined in `app.js`, anchored to the shared league reference (The Weekend League, 10 teams, Week 7, Turf Kings vs Air Yard Sale) with additional realistic detail invented to fill out play-by-play, waiver candidates, and chat.
