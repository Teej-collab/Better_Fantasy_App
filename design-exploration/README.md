# THE WEEKEND — Redesign Exploration

**Status: design exploration only. Nothing outside this folder was touched.** No files in `frontend/` or `backend/` were modified, no dependencies were installed, no routes or auth or database logic changed, and nothing has been committed. This folder is safe to delete at any time without affecting the running app.

## Round 4 — splash / onboarding / sign-in (Direction A + C only)

Built out a full front-door flow for the two directions you're carrying forward: `direction-a/onboarding.html` and `direction-c/onboarding.html`. This is a visual refinement of the app's **real, already-shipped** onboarding flow (`OpeningExperience.tsx` → `EntryChoiceStage.tsx` → `AuthScreen.tsx`/`SignInCard.tsx`) — same steps, same real entry points, new visual language:

1. **Splash** — logo mark on a themed backdrop (gold-lit vignette for Broadcast Desk, floodlight glow for Stadium Lights).
2. **Intro carousel** (3 slides, swipeable, dot indicator, skippable) — deliberately leads with the identity you asked for: **"One App. Every League."** (multi-league) → **"Built For Sunday. Built For Your Phone."** (mobile-first) → **"Real Draft. Real Rivalries."** (core product). Sourced from UI/UX Pro Max's funnel/onboarding guidance (skip control, progress dots, one idea per slide).
3. **Get Started** — the real 3-way entry choice (Sign In / Join a League / Create a League), restyled as scorebug-style buttons (A) or glass pills (C) instead of the app's current neon-sign metaphor.
4. **Sign In** — Discord (primary) + Google + email/password, matching the real `SignInCard.tsx` priority order.
5. **Join a League** — invite-code entry.
6. **Create a League** — name + size.
7. **League Picker** — the clearest statement of "multi-league": a returning user picks from real league cards (name, team count, week, their record) before entering. This screen doesn't fully exist in the app today in this form — it's a proposed refinement, called out as such rather than presented as already-built.

Direction B was intentionally skipped here since you're only carrying A and C forward.

## Round 3 — all three back to equal footing

Round 2 had narrowed to B and C, with A kept as reference only. This round brings **A back to full parity with B and C** — same My Team/Free Agents/Trades, same full Standings, same Settings depth, same empty/loading/error state previews, and its own `direction-a/desktop.html`. A ticker was also added to Direction B's Home (mobile and desktop) and Direction C's desktop Home, since A and C's mobile view already had one and it's a defining "sports broadcast" element worth judging consistently across all three. All three directions are now genuinely comparable at the same depth, mobile and desktop.

## Round 2 — what's new

The first deepening pass (originally scoped to B and C only, since retroactively extended to A too in Round 3). This round added:

- **Full My Team**: complete starter lineup (QB/RB/RB/WR/WR/FLEX/K/DEF) + bench, plus real **Free Agents** and **Trades** tabs (segmented control, matching the League screen's existing pattern).
- **Full Standings**: 10-team list, win/loss trend indicators (`<TrendIndicator>` per `03_Component_System.md`), and a playoff-line divider.
- **Full Settings**: account section, appearance (Direction B gets the real 7-color neon accent picker; Direction C gets floodlight-intensity + transparency controls appropriate to its own identity), notifications, and — for Direction B, which ships the app's real reorderable bottom nav — a navigation-order list.
- **Empty / loading / error states**: an `<EmptyState>` on Trades ("no open trades"), plus "preview" buttons in Settings that reveal a loading-skeleton example and an offline-banner example on demand, so both states are inspectable without wiring up real network conditions in a static prototype.
- **Desktop layouts** (`direction-b/desktop.html`, `direction-c/desktop.html`): genuinely different layouts at wide viewports, not the mobile stack stretched wider — built directly from `Documentation/UX/05_Desktop_Strategy.md`. Two-column Home, side-by-side Matchup starter comparison, a two-pane Chat (persistent conversation list + open thread), and a real round&times;team Draft table (the one place the strategy doc says mobile/desktop *should* diverge, since the mobile card-based draft view exists specifically to fix a real horizontal-scroll bug a table causes under 400px).
- **A left-rail navigation experiment**, isolated to Direction C's desktop page only. The strategy doc flags a persistent left rail as "a genuine open question, not a settled recommendation" — rather than guess, it's built out once so there's an actual mockup to react to. It isn't exclusive to Stadium Lights; if you like it, it can pair with either direction's visual system.
- Real `:hover` elevation on rows/cards at desktop widths only (`@media (hover: hover) and (pointer: fine)`), since mobile structurally can't provide the same affordance.

Open `index.html` in a browser to get to everything, or jump straight into one:

- `direction-a/index.html` — **Broadcast Desk** (mobile) &middot; `direction-a/desktop.html` — desktop layout
- `direction-b/index.html` — **Sunday Show** (mobile) &middot; `direction-b/desktop.html` — desktop layout
- `direction-c/index.html` — **Stadium Lights** (mobile) &middot; `direction-c/desktop.html` — desktop layout

Each is a real, tappable, self-contained HTML/CSS/JS phone-frame (or desktop-frame) prototype — no build step, no server, no framework. Open the file directly. Bottom nav / dock / drawer all work; tapping a player row opens a Player Detail sheet. You can also deep-link straight to a screen for review, e.g. `direction-b/index.html?screen=gamecast`.

---

## What this is based on

Before designing anything, the existing app was inspected directly (tech stack, nav, routes, components, colors, typography, assets) — and it turned out **your team had already written an extremely thorough redesign proposal** in `Documentation/UX/` (a 6-document, code-grounded audit + proposed design system + proposed IA + component consolidation plan, dated this month, status "proposal for review, not yet implemented"), plus real brand positioning work in `Documentation/Marketing/`. Rather than ignore that and start from zero, these three directions were built **with that existing thinking as an input**:

- All three carry forward the single most validated lesson from your own production history: **glow and motion are a signal, not a background style.** The app's original always-rotating card glow was disabled app-wide after real crash/battery reports — every direction here, including the boldest one (C), treats continuous motion as something that has to be earned, not a default.
- Direction B is, deliberately, what your own `01_Design_System.md` looks like actually built — same colors, same fonts, same 3-tier card rule, same proposed nav. It's included as an honest baseline: "here's what disciplined execution of what you already decided looks like," so you can judge the two bigger creative swings (A and C) against it rather than against nothing.
- All three use your real position colors (`positionColors.ts`) and your real logo emblem, and reuse actual context from your league (team/owner names are illustrative, not your real league's data).
- The brand-positioning doc's recommendation to standardize on **"THE WEEKEND"** as the product name (the code currently says "Weekend League") is applied consistently across all three — that's a naming decision worth making deliberately before any of this goes further, called out in `Documentation/Marketing/01_Brand_Positioning.md`.

---

## Cross-direction principles (apply regardless of which one you pick)

1. **Motion budget:** at most one "Featured" (dramatic/rare) element and two "Live" (pulsing/active) elements visible on screen at once. Everything else is flat. This is a real, enforceable rule already proposed in your own docs — it's the fix for Gamecast's five simultaneously-glowing panels and Draft's five-to-six.
2. **Real position colors everywhere a player appears** (Roster, Matchup, Gamecast's Fantasy Impact) — not just Draft, which is the only place they're used today.
3. **44×44px minimum touch targets** on every interactive control — your own audit flagged Roster's Drop button and the slot-edit pill as undersized.
4. **No `<table>` at mobile widths** — Draft board and Power Rankings both need a card/row-based mobile layout (desktop can keep a real table).
5. Brand voice per your Marketing docs applies to all copy in a real build: *"a smart friend who's also in the league, not a SaaS company."* No "leverage," "seamless," "elevate your fantasy experience."

---

## Direction A — Broadcast Desk

**Overall visual language:** the most literal of the three — it wants to feel like turning on a Sunday NFL broadcast. Scorebugs, lower-thirds, a "LIVE" strap across Home, gold foil reserved for genuinely big moments (a draft-grade reveal, a champion's row).

**Color system:** near-black charcoal (`#0b0d10` bg / `#15181d` cards) with **team red** (`#dc2626`) as the primary accent and **championship gold** (`#eab308`) as a rare second accent for Featured moments only. Live/urgent stays a distinct red (`#ef4444`) so "this game is live" and "this is the brand color" don't collide.

**Typography:** Bebas Neue (all-caps, condensed, shouted — literally sourced from the UI/UX Pro Max "Bold Statement" pairing, tagged for sports) for headlines and scores, Source Sans 3 for calm body copy, JetBrains Mono for tabular numbers.

**Navigation concept:** conventional 5-tab bottom bar (Home / League / Matchup / Live / Chat) — the most familiar of the three, styled with a broadcast-network top strap instead of a plain header.

**Card design:** flat charcoal by default; Live cards get a static red edge + pulse dot; Featured cards (rare) get a gold gradient wash — never a rotating ring, on purpose.

**Scoreboard design:** a literal broadcast scorebug — team blocks, bold tabular score, win-probability bar, a "Fantasy Impact" ticker under live NFL games tying real plays to your fantasy points.

**Animation philosophy:** broadcast-style — count-up score reveals, a scrolling ticker marquee, a pulse dot for live status. Nothing spins or glows continuously.

**What makes it feel different:** it's the one that would make a non-fantasy-player go "oh, this looks like ESPN" in the first two seconds. Highest risk: the most generic-sports-app of the three if not executed with real restraint on the red/gold.

---

## Direction B — Sunday Show

**Overall visual language:** confident, calm, modern — the fantasy-app equivalent of a well-produced studio show rather than the on-field broadcast itself. This is the direction that treats your *existing* brand equity (the neon green, the Oswald wordmark) as an asset worth refining rather than replacing.

**Color system:** unchanged from production — `#0d1016` bg, `#12161c` cards, `#39ff14` accent, plus the additive semantic tokens your own design doc already proposed (`--wl-success #22c55e`, `--wl-warning #facc15`), applied consistently instead of improvised per component.

**Typography:** unchanged from production — Oswald (display) + IBM Plex Sans (body), the pairing your team adopted specifically for its "broadcast graphics" identity, now formalized into an actual type scale instead of ad hoc per-component sizing.

**Navigation concept:** the **exact nav your own `02_Information_Architecture.md` proposes** — Home / League / Matchup / Chat / More, promoting Chat into the tab bar (your brief calls this product "part clubhouse, part group chat," but today Chat is a header icon) and moving My Team, Draft, and Gamecast into a real "More" sheet.

**Card design:** the literal 3-tier system from `01_Design_System.md` — Flat / Live (static accent edge) / Featured (the one place the rotating conic-gradient ring survives, capped at one per screen) — built with the actual `@property --panel-border-angle` mechanism your codebase already uses.

**Scoreboard design:** your existing score header + win-probability bar (already praised in the audit as "genuinely works"), left alone, just applied with the position-color and card-tier discipline it's currently missing.

**Animation philosophy:** the most restrained of the three, by design — this direction exists specifically to prove the "glow is a signal, not decoration" rule out at the component level, including inline callouts on the mockup itself showing the motion budget in use.

**What makes it feel different from what exists today:** almost nothing changes at the level of "what color is this app," and *that's the point* — this direction is a bet that your actual problem was never the color, it was 100 call-sites of an overloaded card component and three duplicate navigation paths to the same page. Lowest implementation risk of the three; the least visually dramatic in a side-by-side screenshot.

---

## Direction C — Stadium Lights

**Overall visual language:** the boldest creative swing — true OLED black, frosted glass, cyan/violet floodlight glow, like walking into a stadium at night with the lights just kicked on. Closest to "premium sports entertainment product" in the most literal, cinematic sense.

**Color system:** true black (`#050507`) with **cyan** (`#22d3ee`) and **violet** (`#a855f7`) as a disciplined two-color floodlight system — a deliberate, curated descendant of your app's retired "Cosmic" theme and 7-color neon accent picker, **not** a return to the old always-lit rainbow-per-section nav your team already tried and rolled back on 2026-08-31 for being too noisy. Legacy neon green (`#39ff14`) survives in one place only: positive score deltas, as a quiet nod to the current brand.

**Typography:** Space Grotesk, single family, tracked uppercase for display — sourced from the UI/UX Pro Max "Kinetic Brutalism" pairing, explicitly tagged for sports platforms and flagship mobile.

**Navigation concept:** the most experimental of the three — no persistent tab bar. A minimal floating 3-icon dock (Home / Matchup / Live) plus a full hamburger side drawer for everything else. This is the direction that actually answers your brief's ask to explore hamburger/side-nav and minimal/contextual navigation rather than defaulting to a tab bar.

**Card design:** frosted glass panels (`backdrop-filter: blur`) with soft borders; a static floodlight wash (not animated) behind hero sections only; Featured moments (draft pick reveal) get real glow — bounded to one at a time, same rule as the other two directions.

**Scoreboard design:** glowing tabular scores with a soft text-shadow treatment, glass scorebug panels, gradient win-probability bar (cyan vs. violet) — the most "cinematic" scoreboard of the three.

**Animation philosophy:** the direction most tempted to overdo motion, so it's the one most explicit about not doing that — floodlight glow is a static background wash, not a loop; the only continuous motion is the live pulse dot and the ticker, identical budget to the other two directions.

**What makes it feel different:** the one most likely to generate a genuine "whoa" reaction on first open, and the one with the most execution risk — glassmorphism and heavy blur are real GPU cost on lower-end phones, which is exactly the class of problem that already caused a production incident in this app once. If you pick C, the perf conversation has to happen early, not after it ships.

---

## Suggested next step

Compare B and C at both mobile and desktop widths, including the left-rail question raised in C's desktop page. Once you pick one — or ask for a specific hybrid (e.g., B's nav + C's color system) — implementation against the real component tree is a separate, bigger conversation than this exploration. Per your instructions, no implementation work starts until you approve a direction.
