# THE WEEKEND — Design Lab

A fully isolated visual exploration. Nothing here touches the production app (`frontend/`, `backend/`) — this is a set of static, dependency-free HTML/CSS/JS prototypes you can open directly in a browser.

## Launch

```
open design-lab/index.html
```

Or serve it locally (needed if your browser blocks `fetch`/module scripts from `file://`):

```
cd design-lab && python3 -m http.server 8080
```

Then visit `http://localhost:8080`. The landing page links to all three concepts; each is also independently openable at `concept-0X-*/index.html`.

## The three concepts

Same underlying fantasy football functionality (matchups, roster, draft, gamecast, chat, standings) — three different product identities, each built as if by a different design studio.

| | Concept | Direction |
|---|---|---|
| 01 | **The Booth** | A premium sports-broadcast identity. Live scoreboard ticker, sharp broadcast-graphic edges, scoreboard digit-flip animation, a real "on the clock" broadcast moment in the draft room. Dark, amber "live" accent, condensed athletic type (Barlow Condensed/Barlow). |
| 02 | **The Orbit** | Fantasy football a few years ahead — spatial depth, layered glass panels, restrained cyan accent, subtle pointer-tilt cards, an asymmetric "orbital" home layout. Premium and quiet, not cyberpunk. Space Grotesk/Manrope. |
| 03 | **The Clubhouse** | A premium sports magazine crossed with your league's private clubhouse. Warm parchment, **not dark mode** — the boldest differentiator of the three. Editorial masthead, huge serif score numerals, hairline rules instead of cards, a trading-card player flip. Libre Bodoni/Public Sans. |

Each concept includes all required screens (Login, Home, League, Matchup, My Team, Player Detail, Draft Room, Gamecast, Chat, Standings, League Activity, Profile/Settings) as one real, navigable single-page app — hash-based routing (`#/matchup`, `#/draft`, etc.), no framework, no build step. Mobile-first (390px), with a genuinely reorganized desktop layout above 1024px, not a stretched mobile view. All motion respects `prefers-reduced-motion`.

Each concept folder has its own short `concept-README.md` with that concept's specific signature moments.

## Technology

Plain HTML/CSS/JS per concept — no React, no bundler, no npm install. This was a deliberate choice: it keeps every prototype trivially openable by anyone (you, a co-founder, a designer) with zero setup, and keeps the design lab fully isolated from the production Next.js app's build pipeline. Depth/motion effects (scoreboard flips, pointer-tilt cards, the trading-card flip) use CSS 3D transforms and `perspective`, not a 3D/WebGL library — deliberately lightweight, no heavy dependency, respects reduced-motion and battery.

## What's real vs. mock

All content (team names, players, scores, chat, draft picks) is realistic mock data — see `shared/mock-data.md`, used consistently across all three concepts so they're easy to compare side by side. No live data, no backend calls, no account system.

## Next step

Pick a direction (or mix elements from more than one) and say the word — nothing here gets implemented into the production app until you explicitly choose.
