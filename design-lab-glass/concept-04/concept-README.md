# Neon Orbit

**Concept 04** in the design-lab-glass series — mobile-first liquid glass, THE WEEKEND's real brand.

## Pitch

Where the first three concepts each invented a palette to explore liquid glass on its own terms, Neon Orbit puts the real THE WEEKEND identity through that same process: the deep violet-black cosmic ground (`#0a0716` / `#171129` / `#35285f`) as the stage, the signature `#39ff14` neon green as the one accent that gets to be loud, and the app's own rotating conic-gradient ring as a recurring, occasional signature — never the whole surface, always the edge. The result should feel like the production app's DNA, just seen through its most premium possible finish.

## Signature interaction moments

1. **The ring wakes up before you're even in.** Splash screen opens on a small circular badge with the rotating neon ring already spinning around it, against a sparse starfield and a restrained green/violet nebula glow — establishing the motif before any content exists.
2. **Live gamecast as the ring's main stage.** The Turf Kings vs. Air Yard Sale score card on `#/matchup` is the one full-bleed ring-bordered hero in the app — live score, win-probability bar, and a specular light sweep, reserved for the moment that's actually live.
3. **Real, working micro-interactions.** Bench players collapse/expand on the roster screen, standings re-sort on tap, the waiver wire opens a real glass bottom sheet with a FAAB stepper and a toast confirmation, and league chat actually appends messages you type — nothing here is a static mock.

## Tech notes

- Vanilla JS hash router (`#/home`, `#/matchup`, `#/player/:id`, …) rendering template literals into a single `<main id="view">`. Zero framework, zero build step.
- Rotating ring uses the real production recipe: `@property --panel-border-angle`, a root-level `panel-border-rotate` animation, and a conic-gradient `::before` masked to the border only — reproduced faithfully, applied to one hero per screen (splash badge, gamecast hero, player-detail hero).
- Liquid glass reserved for chrome: the floating tab bar, top status bars, modal sheet, and chat input bar get `backdrop-filter: blur(28px) saturate(170%)`, translucent cosmic-dark fills, and a diagonal light-catching edge overlay. Content cards use a lighter, flat glass touch for hierarchy only.
- `prefers-reduced-motion` freezes the ring rotation, live-dot pulse, and specular sweep transition; `prefers-reduced-transparency` swaps every `.glass` surface to a solid opaque fill.
- Fixed 390px canvas throughout — no `@media (min-width: …)` desktop rules anywhere in `styles.css`.

## Brand note

This concept intentionally reuses THE WEEKEND's real production brand colors (cosmic violet-black + `#39ff14` neon green) rather than inventing a new palette, per the design brief — concepts 01–03 explored invented palettes; this one tests the real thing.
