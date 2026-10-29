# THE ORBIT — Concept 02

**Pitch:** Fantasy football from a few years ahead — restrained, spatial, cinematic. Depth comes from layered panels, thin hairlines, and one disciplined "ion" cyan accent, not blur-by-default or a rainbow of neon.

**Three signature moments:**
1. **Login orbit** — a satellite orbits a glowing core, setting the spatial motif before you've even entered.
2. **Draft "pick sting"** — drafting a player freezes the screen with a full-bleed confirmation card, then folds them into an "orbit roster" of chips ringed around your team.
3. **Gamecast HUD chips** — fantasy-relevant plays surface as small floating data chips that drift upward and fade, instead of a static play-by-play list; the field is a tilted CSS 3D plane, not a flat graphic.

**Interaction:** desktop pointer-tilt on key cards (max 6°, `pointermove`-driven CSS transform) — disabled on touch and under `prefers-reduced-motion: reduce`. Floating bottom dock (5 custom SVG glyphs) instead of a standard tab bar; other destinations (Gamecast, Standings, Activity, Profile) reached contextually from Home/League/Matchup, same as a real product would do it.

**Tech:** vanilla JS hash router (`#/home`, `#/matchup`, `#/player/:id`, etc.) in `app.js`, one `styles.css` token system, zero dependencies, zero build step. Open `index.html` directly or serve the folder statically.
