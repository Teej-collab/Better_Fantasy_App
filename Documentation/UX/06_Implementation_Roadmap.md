# THE WEEKEND — Prioritized Implementation Roadmap (Proposed)

**Status:** Proposal for review — sequencing only, no code has been written against this plan. Each phase is scoped so it ships and is checkable on its own before the next starts, per the brief's explicit instruction not to redesign every page at once.

---

## P0 — Fundamentally broken UX (do first)

1. **Card-tier migration** (`01_Design_System.md` §4): introduce `<Card tier="flat|live|featured">`, retire `.neon-panel` as the default. This is one component + a mechanical swap across call sites, and it is the single change that fixes the largest number of audit findings at once (Gamecast's 5 concurrent rings, Draft room's 5-6, Awards/All-Time's 10+, Admin/Commissioner's misapplied glow).
2. **Chat promoted to the primary nav tab bar** (`02_Information_Architecture.md`): the most direct fix for the "clubhouse" identity gap the brief opens with.
3. **Matchup page reorder:** move the starter-by-starter comparison up, collapse the empty Narrative placeholder to nothing when there's no content, so "why am I winning" stops being buried under a permanently-rendered empty state.
4. **Home hero guarantee:** ensure the user's own live matchup card cannot rank below the one-time Draft Grades card or fall arbitrarily low in the reorderable deck — pin it, or exclude it from reordering.

## P1 — Major usability problems

5. **`<PlayerRow>` and `<TeamRow>` consolidation** (`03_Component_System.md`): replaces 8 total duplicate implementations, fixes touch-target sizing and density in the same pass since it's a property of the shared component.
6. **`<RankedCategoryCard>` consolidation:** merges Record Book / Award Leaderboards / Power-Rankings All-Time into one component — a real maintenance and visual-consistency win, not just cosmetic.
7. **Table → row-list conversion on mobile** (`04_Mobile_Strategy.md` §4): Draft board and Power-Rankings trend view, the two confirmed horizontal-scroll violations.
8. **IA restructuring** (`02_Information_Architecture.md`): 5-tab bar becomes Home/League/Matchup/Chat/More, League sub-nav thins from 6 to 4, Home's duplicate Discover grid is removed.

## P2 — Major visual improvement

9. **Standings competitive-stakes pass:** wire the existing `MovementBadge`/`<TrendIndicator>` into Standings rows (it's already built for Power Rankings — this is largely a reuse task, not new build).
10. **Commissioner and Admin visual distinction:** apply `<PanelList>`/`<SettingsPanel>` (already-flat by default per the Card-tier rule) so internal tools stop inheriting fan-facing decoration wholesale.
11. **Players page reconciliation:** decide whether the cover-flow/flip-card treatment stays as a deliberate "wow" moment (reduced in animation cost per the motion budget) or the Owner-page's plain stat display becomes the single source of truth for this data — currently two inconsistent systems for the same stats; needs a decision, not just a fix, so this is flagged for discussion rather than a mechanical task.
12. **Home "Welcome Back" ceremony:** only play on true first-visit-of-session, not every hard load.

## P3 — Polish

13. Settings' Appearance section: collapse the three granular color pickers (Accent/Your-Week/Border) into one primary control + an "Advanced" disclosure for the other two.
14. Chat's first-send AI-training-notice modal → passive Settings toggle instead of an interrupt.
15. Redundant duplicate data removal (projected total shown twice on Matchups, down/distance shown three times on Gamecast).

## P4 — Nice-to-have

16. Desktop-specific layouts (two-column Home, side-by-side Matchup comparison, left-rail nav evaluation) per `05_Desktop_Strategy.md` — real value, but correctly last since mobile is the primary target and none of P0-P2 depend on it.
17. Hover-state polish on desktop-only interactions.

---

## 0. Rollout strategy: opt-in beta, then default (decided)

The redesign ships behind a single opt-in toggle — **Settings → "Try the new look"** — not as a third permanent theme alongside Calm/Cosmic. This was a deliberate choice after weighing three options:

- **Full permanent third theme** — rejected. The structural changes here (nav model, content order, consolidated components) aren't a color palette; making them permanently optional means maintaining two navigation systems and, in places, two versions of the same component (old buried-narrative Matchup layout next to the new one, the old 4 duplicate PlayerRows next to the consolidated one) forever. That directly re-creates the duplication problem `00_UX_Audit.md` identifies as a root cause, permanently, instead of fixing it.
- **Ship to everyone immediately, no toggle** — not chosen; skips a real feedback window before removing the current nav/layout for the whole league.
- **Opt-in beta → default → retire old UI (chosen).** Bounded transition period, real user feedback, then one codebase again.

**How the toggle is scoped, so it doesn't reintroduce the theme-explosion problem it's meant to avoid:**

- It is **orthogonal to Calm/Cosmic**, not a third option in that same picker. A beta user still chooses Calm or Cosmic for palette; the new-layout toggle controls structure (nav, content order, which components render), reading colors from the same `--wl-*` token set either way. This is why the Card Tier system in `01_Design_System.md` was designed against the existing tokens rather than a new palette — it works under either Look.
- It is **one flag, not per-page flags.** A beta user gets the new nav (`02_Information_Architecture.md`'s Home/League/Matchup/Chat/More), the new Home/Matchup/Roster/Standings/Gamecast content order, and the consolidated components together — not a mix of old and new nav pointing at old and new page bodies. Partial adoption is where dual-maintenance cost actually balloons.
- It has an **explicit sunset condition**, not an indefinite life: once Phase 1 (P0–P1 from the roadmap below) has been in beta long enough to gather real usage/feedback from the league, the new layout becomes the only layout, the toggle and the old nav/component code are deleted, and Phase 2 (Draft/Awards/Chat/Commissioner/Admin/Settings) ships directly into the new structure — not into a second beta cycle of its own, since by then there's only one product again.
- **Commissioner call, not a per-team vote:** given this is a 12-person real-money league (not a multi-tenant SaaS product), the simplest honest approach is the commissioner deciding when the beta starts, who's in it (the whole league, or a couple of volunteers first), and when it becomes the default — not a fully general feature-flagging system that outlives its purpose.

## Suggested sequencing rationale

P0 items are deliberately the ones that are cheap relative to their impact (a shared Card component, a nav config change, a reorder of existing sections) rather than the most visually dramatic ones — this matches the brief's instruction to fix the underlying UX problem before touching visual polish. P1's component consolidations are more code-touching but still mechanical once P0's Card-tier system exists, since every consolidated component is built once against that system rather than against today's ad hoc per-page styling. P2 onward is where genuine design judgment calls (like the Players page question in #11) need your sign-off before implementation, which is exactly why this document stops at a proposal rather than a build.
