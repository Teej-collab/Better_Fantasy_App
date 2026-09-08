# THE WEEKEND — Desktop Strategy (Proposed)

**Status:** Proposal for review. Mobile is the primary target per the brief; this document covers what desktop should do differently rather than just stretch the mobile layout wider, which is the failure mode the brief explicitly warns against.

---

## 1. Where desktop genuinely benefits from more space (not just more padding)

- **Matchup page:** at desktop widths, the starter-by-starter lineup comparison (`<StarterComparisonRow>`, `03_Component_System.md`) can run as true side-by-side columns with more breathing room per player row, instead of the same stacked layout mobile needs. This is the one screen in the audit where mobile's real width constraint (the audit found under 150px per side on a 375px screen) most directly argues for a genuinely different desktop layout, not just a wider version of the same one.
- **Draft board:** the full round×team grid is *appropriate* at desktop width — this is the one confirmed `<table>` violation from `04_Mobile_Strategy.md` that should stay a real table at desktop, where there's room for it. Desktop and mobile diverging here (table vs. round-by-round) is the correct outcome, not an inconsistency to resolve.
- **Chat:** desktop has room for a persistent conversation list alongside the open thread (already how `ChatApp.tsx` likely wants to lay out at wider viewports per its single-pane-swap-on-mobile-only pattern) — keep/confirm this two-pane desktop layout explicitly as intentional rather than incidental.
- **Home:** desktop can afford a two-column layout (e.g., the live/matchup content in a wider primary column, standings/power-rankings/activity in a narrower secondary rail) instead of one long single-column stack — this is a real opportunity to reduce the "9-10 cards in a single vertical scroll" problem specifically for desktop, where horizontal space is available to use instead of just scrolling further.

---

## 2. Navigation at desktop width

Keep the existing horizontal top bar for the 5 primary destinations (Home / League / Matchup / Chat / More per `02_Information_Architecture.md`). **"More" becomes a dropdown/flyout at desktop** rather than a mobile-style dedicated page — desktop has room to show My Team's sub-items (Roster, Draft, Keepers, Free Agents, Trades), Gamecast, Settings, and Commissioner tools as a hover/click menu instead of a full navigation.

A persistent left rail is worth evaluating as an alternative to the top bar at wide desktop widths (≥1280px) — it would let League's sub-nav (Standings/Power Rankings/Rivalries/League Info) sit as a permanently visible secondary list instead of a second row of pills, reducing vertical chrome. **This is a genuine open question, not a settled recommendation** — a left rail is a bigger structural change than the rest of this document proposes, and should be validated against a mockup before committing, flagged here explicitly rather than asserted as decided.

---

## 3. Hover states

Desktop gets real `:hover` treatment where mobile can't (no hover on touch): `<PlayerRow>`, `<TeamRow>`, and `<RankedCategoryCard>` entries should all get a subtle hover elevation/highlight at desktop widths, both as an affordance (these rows are tappable/clickable) and as a piece of "feels premium" polish the brief asks for, that mobile structurally can't provide the same way.

---

## 4. Keyboard navigation & focus

The audit did not find a systemic keyboard-nav problem, and the codebase already has a real, deliberate app-wide `:focus-visible` baseline (added specifically because most interactive elements had no visible focus indicator otherwise). Carry this forward unchanged into every new component in `03_Component_System.md` — each new shared component inherits the existing focus-visible outline for free by not overriding it, which is the same discipline the existing codebase already established.

---

## 5. Density

Desktop can run slightly higher information density than mobile per screen (more of a standings table visible without scrolling, more of a chat conversation list visible alongside the thread) — but the `01_Design_System.md` §19 motion budget rule (max 1 Featured + max 2 Live elements visible at once) applies identically at desktop. A wider viewport showing more cards at once is exactly the scenario where an unchecked glow-ring count gets worse, not better, so the rule is enforced per-viewport regardless of breakpoint.

---

## 6. What doesn't need desktop-specific work

Settings, Commissioner, and Admin's existing form-heavy layouts already degrade reasonably at desktop widths (the audit found these areas mobile-safe already, if visually inconsistent with the rest of the app per `00_UX_Audit.md`) — the fixes those areas need (flat cards instead of glow, shared `<PanelList>`/`<SettingsPanel>`) are the same fix at every breakpoint, not a desktop-specific task.
