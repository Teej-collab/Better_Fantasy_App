# THE WEEKEND — Forensic UX Audit

**Prepared:** September 2026 · **Status:** Research only, code-grounded (four parallel passes read every page/component in `frontend/src`). No code was changed to produce this document. See `Documentation/Competitive_Audit/The_Weekend_Competitive_Fantasy_Football_Audit.md` for the separate feature-parity audit vs. Sleeper/ESPN/Yahoo — this document is about layout, hierarchy, and visual language, not feature gaps.

---

## 1. The one-sentence diagnosis

THE WEEKEND has real, deep, well-engineered features — and then wraps almost every single one of them in the same decorative shell (a matte card with a constantly-rotating glow ring), so a live scoring feed, a settings toggle, a standings row, and a static record-book entry all *look* equally important. When everything glows, nothing does. The fix is not more design — it's editing: decide what's actually alive and reserve motion/glow for that, flatten everything else, and stop re-answering the same question ("who's my team, what's the record") in three different hand-built components per area.

---

## 2. How this audit was produced

Four research passes, each reading the real `.tsx`/`.ts` source (not file names, not assumptions):
1. Home dashboard + navigation model (landing, authenticated home, PrimaryNav/BottomNav/sub-navs)
2. Matchups, Roster/My Team, Gamecast
3. Standings, Draft, Awards/Rivalries/History/Power Rankings, Players/Free Agents/Trades
4. Chat, Commissioner (League Management), Settings, Admin

Plus a direct read of `app/globals.css`, the single source of the app's design tokens and decorative system.

---

## 3. The design-token reality (what's actually there today)

- **One theme, permanently dark.** `--wl-bg #0d1016`, `--wl-surface #12161c`, `--wl-border #1c2027`, `--wl-text #eceef1`, `--wl-text-secondary #8790a0`, accent `--wl-accent #39ff14` (neon green), live-red `#ef4444`. An opt-in "Cosmic" alternate palette (purple/starfield, rainbow nav) exists behind a settings toggle — not the default.
- **`.neon-panel` is the single most overused primitive in the app.** It's a matte card (fill + hairline border) *plus* a permanent conic-gradient ring that visibly rotates around the edge every 5 seconds (3.5s on countdown tiles). Per the CSS's own comment, it is applied to "leaderboards, rosters, matchup cards, rivalry cards, profile/settings sections" — in practice, that means nearly every card in the entire product, including static content (a settings toggle, a record-book entry, a commissioner form) that has no reason to look "alive."
- **Reduced-motion support is genuinely well-built** (`prefers-reduced-motion`, a manual `.motion-reduced` override, and per-element opt-outs) — this is a real strength to preserve, not rebuild.
- **Nav color was already simplified once** (commit history shows a "rainbow tab" model was deliberately replaced with one calm accent color) — good instinct, but the glow-ring problem is the same mistake recurring one layer down, on cards instead of nav.

---

## 4. Per-area findings

### Home (authenticated dashboard) — `app/(home)/page.tsx`
- **Goal:** "What does my fantasy life look like right now."
- **What actually happens first:** a "Welcome Back, {name}" ceremony re-plays on every hard load (not just first visit ever), costing real time before any content renders. Then two auto-scrolling tickers stacked on top of each other. Then up to **9-10 full-width `.neon-panel` cards stacked vertically** (draft/chug countdown → draft grades → live gamecast → chug → the reorderable "Your Week" deck → standings → power rankings → matchups → rivalries → awards → a "Discover" tile grid), each independently rotating its own glow ring.
- **Biggest problem:** the user's own live matchup ("Your Week" — score, win probability, "am I winning") lives *inside* a drag-to-reorder deck that can end up below Standings, Rivalries, and Awards, while a one-time post-draft "Draft Grades" card is hard-pinned above it. The single most relevant fact on the screen is not guaranteed to be near the top.
- **Reusable-component miss:** the ranked-list card markup (Standings/Power-Rankings/Matchups/Rivalries) is hand-duplicated four times inline in `page.tsx` with nearly identical Tailwind strings instead of one shared component.

### Navigation model — `PrimaryNav`, `BottomNav`, `LeagueSubNav`, `MyTeamSubNav`, `SeasonTabs`, `navDestinations.ts`
- **Top-level tabs (desktop + mobile, identical 5 slots):** My Team, League, Home, Matchups, Gamecast.
- **Chat is not a tab.** It's a persistent header icon at every breakpoint, with an unread badge — pulled entirely out of the primary nav despite the brief's explicit ask that THE WEEKEND feel like "the league's clubhouse."
- **No "More" tab exists**, but one is needed in practice: League's sub-nav alone holds 6 more destinations (Overview, Standings, Power Rankings, Rivalries, Rules, History), My Team's sub-nav holds 5 more (Roster, Draft, Keepers, Free Agents, Trades), and Home additionally renders a "Discover" tile grid that **duplicates several of those same destinations a second time**, at the very bottom of an already-long scroll.
- **Net result:** 19 total destinations in the app, only 5 as real top-level tabs, ~11 more one sub-nav tap away, several of *those* repeated again on Home. This is a three-deep, partially redundant IA, not the clean flat 5-tab pattern the brief is asking for.

### Matchups — `matchups/[matchupId]/page.tsx` + `components/matchups/*`
- **The score header and win-probability bar do answer "who am I playing / am I winning / by how much" in under two seconds** — this part genuinely works and should be preserved as-is.
- **But "why" is buried at the bottom of the page**, after four more stacked `.neon-panel` sections (a narrative block that renders a permanent "recap writeups aren't turned on yet" placeholder even when it has nothing to say, a touchdowns section, a head-to-head history table, and only then the starter-by-starter lineup comparison that actually explains the score).
- **Redundant data:** `projected_total` renders in two different components on the same page; clutch/choke and bench-crime badges can render for the same team in up to three places.
- **On mobile,** the starter-comparison grid gives each side of the matchup well under 150px of width on a 375px screen to fit a logo, a player name, an injury tag, and points — real truncation risk.

### Roster / My Team — `MyTeamApp.tsx`, `RosterList.tsx`
- **This is the strongest screen visually in the app.** Real row lists (not tables), real headshots, only two `.neon-panel` sections (Starters/Bench) instead of the five-plus seen elsewhere. It already reads as a lineup, not a spreadsheet.
- **Remaining issue:** each player row can stack up to 11 discrete elements (slot pill, headshot + red-zone dot, name, position·team, opponent+time, bye week, %owned, injury badge, Locked badge, points, projected points, Drop button) — dense even in list form. `%owned` and bye-week each reserve their own line even when low-value, adding real scroll length across a 16-player roster.
- **A defined position-color system (`positionColors.ts`) exists but is wired only into the Draft board** — Roster and Matchups, the two screens where at-a-glance position scanning matters most, don't use it at all.

### Gamecast — `GamecastShell.tsx` + `components/gamecast/*`
- **Genuinely feels like live football**, not a stat table — the animated field marker, down & distance, and possession indicator are well executed and worth keeping.
- **This is the single densest animation surface in the app for a "read live data" screen:** up to five `.neon-panel` blocks (Field, Drive, Scoring, Fantasy Impact, Play-by-Play) can be on screen at once, each with its own *independently colored* glow ring, on top of the live-dot pulse and the field marker's own motion. Down & distance is shown redundantly in three different components on one screen.
- **Play-by-play — arguably the core "live football" content — is collapsed by default**, deprioritized below Scoring Summary and Fantasy Impact.

### Standings — `standings/page.tsx`
- **One of the leanest, best-behaved pages in the app** — a single panel, no stacked cards, clean mobile column collapse.
- **But it doesn't feel like a competition.** The brief asks for the user to "feel the competition" — today the only stakes signals are a champion row tint and a last-place row tint; there's no streak/momentum indicator on the row itself (a `MovementBadge` component already exists and is used on Power Rankings, but not here), and the power-rank badge is deliberately muted. The page reads as a static ledger.

### Draft — `DraftRoom.tsx`, `DraftBoard.tsx`, `DraftGradesView.tsx`
- **The best example of intentional component reuse in the app** — `DraftGradesLeaderboard`, `PositionBadge`, and `DraftBoard` itself are each built once and correctly shared between the live room and the historical archive view. Keep this pattern as the model for the rest of the app.
- **The live draft room stacks five to six `.neon-panel` blocks** (setup panel, grades leaderboard, the full round×team board, then a three-way split of player pool / queue / my-team / recent-picks / chat) — a lot to scroll through while a pick clock is actively running.
- **`DraftBoard` is a literal `<table>` in `overflow-x-auto`** — genuine horizontal-scroll on mobile for a 12+ round grid with narrow team columns.
- **Commissioner-only controls (edit order, schedule, seed-keepers, pause/undo/reset) render inline in the same flow every commissioner scrolls through**, with no grouping — a wall of controls with no hierarchy.

### Awards / Rivalries / History / Power Rankings / Record Book
- **Three separate components — `RecordBook`, `AwardLeaderboards`, `PowerRankingsAllTime` — independently reimplement the identical "medal + ranked list" card grid**, confirmed by direct code comparison. A user cannot visually distinguish "this is a numeric record" from "this is a yearly trophy" from "this is an all-time power-rank leaderboard" — they're the same shape three times with different data.
- **The All-Time Records page alone can render 10+ independently glowing cards** in one scroll for what is fundamentally a "look up a stat" task.
- **Power Rankings' week-by-week trend view is a raw `<table>`** with one column per week of a season — real horizontal scroll on mobile for anything past ~week 6-7.
- **History was already fixed once** (per its own commit history, simplified from 10 sub-tabs down to 6, then to a 3-tile hub) — proof the team already knows how to do this kind of consolidation; it just hasn't been applied to Awards/Records/Power-Rankings yet.

### Players / Free Agents / Trades / Owner profile
- **The Players page is the single highest-animation-density component in the app** — a 3D "cover flow" of flip-cards over a starfield/nebula background, continuously recalculating rotation/depth/scale on every scroll frame, for a screen whose only real job is "browse a team's season stats."
- **That same stat data (record, PF/PA, best/worst week, awards) is presented a second time, completely differently, on the plain Owner detail page** — two inconsistent visual systems for one dataset.
- **Free Agents and Trades, by contrast, are correctly plain and utilitarian** — flat lists, no unnecessary decoration, appropriate for a "get something done" task. This is the right instinct; it just isn't applied consistently everywhere.

### Chat
- **The bubble UX itself is genuinely well-built** — real grouped bubbles, avatar clustering, reactions, reply, receipts. This does read as true conversation, matching the "clubhouse" goal, and should not be rebuilt.
- **The single biggest tonal mismatch in the whole app:** the entire message thread is wrapped in `.neon-panel`, meaning a rotating glow ring animates continuously around a surface that is *already* the most dynamic, constantly-updating content in the product. Commissioner announcement cards each carry their own glow ring too, multiplying with feed length.
- **A first-send AI-training-notice modal interrupts the user about a feature that doesn't exist yet** — pure friction for zero present value.
- **Four separate inline "avatar circle" implementations** exist across Chat components instead of one shared `Avatar`.

### Commissioner / League Management
- **The IA is already correct** — a hub page with tile links to focused sub-pages, not one mega-form (confirmed fixed in a prior pass). Keep this structure.
- **But nothing visually signals "you are in an admin/config tool."** Every list (members, teams, pending trades) gets the identical glow-ring treatment as fan-facing content — a commissioner's settings panel looks exactly like a Standings card.
- **The same "list of rows in a panel" className string is copy-pasted across five-plus files**, and three different sections each hand-roll their own idle/saving/saved/error state type instead of sharing one.

### Settings
- **The best-organized area of the app** — consistent section-card shell, a shared `ToggleRow` and `SavedIndicator` (a deliberate non-toast save pattern) genuinely reused everywhere. This is the model the rest of the app should be pulled toward.
- **One real excess:** Appearance alone stacks 6-7 `.neon-panel` sections, including **three separate near-identical color-picker UIs** (Accent Color, Your Week Card Color, Border Animation Color) — more granularity than most users will ever touch, each still running its own glow ring.

### Admin
- **Got its own accent color** (a control-room blue) as a deliberate distinction from the consumer app — a good instinct.
- **But the chrome didn't follow the color.** Every KPI tile, chart panel, and list still uses the identical rotating-glow `.neon-panel` shell as the fan-facing product, so a monitoring dashboard — where stability of attention matters more than motion — animates exactly like a Standings card. Roughly 15 independent copy-pasted instances of the same card-shell string exist across the Admin components.
- **A 6-KPI grid collapses to 3 rows on mobile** before any chart is visible — a lot of scroll before the actually useful content appears.

---

## 5. Cross-cutting patterns (the real root causes)

These four issues explain the majority of individual findings above — fixing them at the system level fixes dozens of symptoms at once:

1. **Glow-as-default instead of glow-as-signal.** `.neon-panel`'s rotating ring is applied almost everywhere, so it has stopped meaning anything. Gamecast and the live Draft room can each put 5+ independently-colored rings on screen at once; Awards/All-Time can hit 10+. The fix is a hard rule (see `01_Design_System.md`): glow/motion is reserved for genuinely live or time-sensitive content (an active game, a running pick clock, a live matchup), and every other card goes flat.
2. **The same UI concept gets reinvented per-page instead of shared.** Confirmed duplicates: a "player row" (4 independent implementations — Roster, RosterList, matchup `PlayerCell`, Gamecast's Fantasy Impact list), a "team/owner row" (4 independent implementations — Standings, Power Rankings week view, Draft board header, Trades' team picker), a "ranked category card" (3 independent implementations — Record Book, Award Leaderboards, Power-Rankings All-Time), a "stat cluster" (2 implementations — Owner page, Team Profile Card), and a "list-of-rows panel" boilerplate string (5+ copy-pasted instances across Commissioner alone). None of these are visual problems on any single page — they're a consistency and maintenance problem that shows up as subtly different information density and visual language for the "same" thing depending which screen you're on.
3. **Navigation sprawls three levels deep with real duplication.** 19 destinations, 5 true top-level tabs, Chat orphaned from the tab bar entirely, and a homepage "Discover" grid that re-offers several sub-nav destinations a second way at the bottom of an already-long scroll.
4. **Internal tools (Commissioner, Admin) inherited the fan-facing decorative language wholesale** instead of earning their own, calmer visual register — the one place in the app where "looks alive" is actively the wrong goal.

---

## 6. What already works and must not be broken in a redesign

- Roster/My Team's row-list treatment (not a spreadsheet) and Chat's real bubble UX.
- Settings' shared `ToggleRow`/`SavedIndicator` pattern and section-card consistency.
- Draft's `DraftGradesLeaderboard`/`PositionBadge`/`DraftBoard` reuse across live room and archive.
- The already-completed History consolidation (10 tabs → 3-tile hub) — proof this team can and has done this kind of simplification before.
- Real reduced-motion support, real safe-area handling, real pull-to-refresh, and the underlying live-data plumbing (WebSocket-pushed Gamecast, viewer-gated polling) — none of this needs to change; it's the presentation layer sitting on top of it that needs work.
- Matchups' score header + win-probability bar answering "am I winning" instantly.
- Standings' clean mobile column collapse.

---

## 7. Severity ranking of the findings above

| Priority | Finding |
|---|---|
| **P0** | Chat excluded from primary nav despite "clubhouse" positioning; Matchups buries the "why" (starter comparison) below a permanent empty-state narrative block; Home's most-relevant content (my matchup) can rank below a one-time Draft Grades card |
| **P0** | `.neon-panel` glow-as-default — no signal left for genuinely live content; worst on Gamecast (5+ concurrent colored rings) and Draft room (5-6 concurrent) |
| **P1** | Three duplicate "ranked category card" components (Record Book / Award Leaderboards / Power-Rankings All-Time) should be one; two duplicate "player row" and "team row" patterns should each be one |
| **P1** | Draft board and Power-Rankings trend view are literal `<table>`s that horizontal-scroll on mobile |
| **P1** | Commissioner and Admin visually indistinguishable from the consumer app despite being internal tools |
| **P2** | Standings doesn't convey competitive stakes/momentum despite an existing `MovementBadge` component going unused there |
| **P2** | Players page's cover-flow/flip-card treatment duplicates Owner page's plain stat display for the same data, at high animation cost |
| **P2** | Home's "Welcome Back" ceremony replays on every load, not just first visit |
| **P3** | Settings' Appearance section over-offers granular color pickers most users won't touch |
| **P3** | Chat's first-send AI-training-notice modal interrupts for a not-yet-real feature |
| **P4** | Minor redundant text duplication (projected totals shown twice on Matchups, down/distance shown three times on Gamecast) |

See the roadmap in the accompanying documents for how these map to actual implementation phases.
