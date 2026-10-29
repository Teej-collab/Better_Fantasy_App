# THE BOOTH — Concept 01

**Pitch:** THE WEEKEND as if a premium sports network built its own fantasy platform — you're not managing a spreadsheet, you're in the production booth while football happens live.

**Signature moments:**
1. **Live score ticker** at the very top, real network-style scroll, pauses on hover/touch and on `prefers-reduced-motion`.
2. **3D digit-flip scoreboard** — the Home hero score updates a few seconds after load with a real `perspective`+`rotateX` flip per digit, like a stadium scoreboard changing.
3. **Draft "ON THE CLOCK" pick reveal** — drafting a player (or letting the 90s clock expire) triggers a full-bleed amber flash graphic naming the pick, like a broadcast draft-day package. The board, order, and recent-picks list are all live state.

**System:** sharp corners (0–4px), diagonal clip-path section cuts, one restrained "live" amber (`--live`) reserved for genuinely live states, Barlow Condensed (display/scoreboard) + Barlow (body) — deliberately not ESPN red, not Inter, not rounded-card-everywhere.

**Tech:** zero dependencies — plain HTML/CSS/JS, hash-router SPA (`#/home`, `#/matchup`, `#/player/:id`, …), Google Fonts via `<link>`. Open `index.html` directly in a browser. Mobile-first (390px), real desktop reflow ≥1024px (3-column Draft Room, top nav). All animation gated behind `prefers-reduced-motion`.
