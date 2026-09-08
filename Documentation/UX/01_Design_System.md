# THE WEEKEND — Design System (Proposed)

**Status:** Proposal for review. Builds on top of the app's existing token layer (`app/globals.css`) rather than replacing it — the color identity (dark, neon-green accent) stays. What changes is *when* the decorative layer (glow/motion) gets used, and the introduction of a small set of canonical components to stop per-page reinvention.

**Guiding rule, stated once so every section below can point back to it:**

> **Glow and motion are a signal, not a background style.** A card either represents something genuinely live/time-sensitive (an in-progress game, a running draft clock, an active matchup) or it doesn't. If it doesn't, it's flat. This single rule resolves the majority of the audit's visual-noise findings.

---

## 1. Typography

Keep the existing font stack (`--font-body` for UI text, `--font-display` for hero/marketing moments like the landing wordmark, mono reserved for numeric/tabular contexts). Formalize a scale instead of ad hoc Tailwind sizes per component:

| Role | Size | Weight | Usage |
|---|---|---|---|
| Display | 32-40px | 700 | Landing hero only, never in-app |
| Page title | 22-24px | 700 | One per page, in the header, not repeated in-body |
| Section header | 16-18px | 600 | Card/section titles |
| Body | 14-15px | 400-500 | Default UI text |
| Label / meta | 12-13px | 500, `--wl-text-secondary` | Position·team, timestamps, secondary stats |
| Micro | 10-11px | 600, uppercase, tracked | Badges/pills only — never body copy |

**Rule:** no more than one 10-11px "micro" label per row/card. The Roster row audit found up to 11 discrete text elements per player row; capping micro-label count per row is how that gets fixed without removing real information — group, don't add another line.

---

## 2. Color

Keep the existing semantic tokens as the source of truth — do not introduce a second color system:

```
--wl-bg           #0d1016   page background
--wl-surface      #12161c   card fill
--wl-border       #1c2027   hairline border
--wl-text         #eceef1   primary text
--wl-text-secondary #8790a0 secondary text
--wl-accent       #39ff14   the app's one identity color — CTAs, active nav, "this is mine"
--wl-live         #ef4444   live/urgent only — never decorative
```

**New, additive tokens needed** (currently missing — components improvise ad hoc greens/reds/ambers for win/loss/positive/negative instead of a shared token):

```
--wl-success      #22c55e   win, positive delta, "up" movement
--wl-danger       #ef4444   loss, negative delta (shares the live-red hue family deliberately —
                             "something needs attention" reads consistently whether it's a live
                             game or a losing matchup)
--wl-warning      #facc15   pending/needs-action (a trade awaiting review, a lineup with an empty slot)
```

**Position colors** (`positionColors.ts` already defines these) — mandate their use on every player-facing surface (Roster, Matchups, Gamecast's Fantasy Impact), not just Draft. This is a real, already-built scannability win sitting unused on the two screens that need it most.

**Cosmic theme:** keep as an opt-in Settings choice exactly as it exists today. Nothing here removes it; the redesign work targets the default "Calm" theme.

---

## 3. Spacing

Adopt a single 4px-based scale app-wide (4/8/12/16/24/32/48) — the codebase already leans Tailwind-default here, so this mostly formalizes existing practice rather than changing it. The one enforceable rule worth writing down: **card internal padding is 16px on mobile, 20px on desktop, no exceptions** — several commissioner/admin sections currently vary this ad hoc (`p-4` vs `p-5` vs custom values) with no visual reason.

---

## 4. Cards — the central fix

Replace the single overloaded `.neon-panel` with **three explicit card tiers**, all sharing the same base shape (radius, padding, border) so they still feel like one system:

| Tier | Visual | When to use |
|---|---|---|
| **Flat** | `--wl-surface` fill, `--wl-border` hairline, no ring, no motion | The default. Standings rows, settings sections, commissioner forms, record book, awards, admin panels, chat message thread, matchup narrative/history sections — anything that isn't actively changing right now. |
| **Live** | Flat card + a *static* (non-rotating) accent-colored left border or top edge + a small `LiveIndicator` (see §11) | A currently-in-progress game's Gamecast card, an active matchup during game day, a running draft pick clock, an open trade awaiting your response. Communicates "this needs attention" without continuous motion. |
| **Featured** | Flat card + the existing rotating conic-gradient ring, unchanged | Reserved for exactly the handful of moments that are genuinely a big deal and rare: the season champion's row, a just-completed draft grade reveal, a countdown to draft day/a live event starting. If a page has more than one Featured card at a time, that's a signal something should downgrade to Live or Flat. |

This directly fixes the audit's worst offenders: Gamecast's five simultaneously-glowing panels become one Live card (the field/drive/score cluster, while the game is live) plus flat supporting panels; the Draft room's five-to-six panels become one Live card (the board + pick clock while a pick is on the clock) plus flat everything else; Awards/All-Time's 10+ glowing cards become flat, since none of them are live.

**Migration note:** this is a CSS/class-level change (swap which class a component reaches for), not a rebuild of every card's internal layout — low implementation risk once agreed.

---

## 5. Buttons

Three tiers, consistent everywhere (today's app is close to this already in Settings/Roster, inconsistent elsewhere):

- **Primary** — filled `--wl-accent`, dark text, for the one main action on a screen (Draft a player, Send message, Save).
- **Secondary** — outline/`--wl-border`, for supporting actions (Cancel, View details).
- **Destructive** — outline or filled `--wl-danger`, always paired with a confirm step for anything that removes a player/roster move (the audit flagged Roster's Drop button as a small tap target for a destructive action — fix both size *and* color-coding together).

Minimum touch target 44×44px on any interactive control at mobile widths — this is the fix for Roster's Drop pill and the draft slot-edit pill both being flagged as undersized.

---

## 6. Badges / Pills / Status Chips

One shared `<StatPill>` primitive (see `03_Component_System.md`) replacing the many hand-rolled pills across Roster (injury, Locked, %owned), Matchups (rivalry, GOTW, playoff, streak emoji, clutch/choke, bench-crime), Draft (AUTO, KEEP, grade), and Standings (🏆/💩). Rules:
- Max **2 pills visible per row** at rest; anything else (bye week, %owned, secondary badges) moves into an expandable detail (tap the row / player card) rather than always rendering.
- Color always paired with an icon or label, never color alone (accessibility — color-only status was flagged as a real risk across win/loss and injury indicators).

---

## 7. Tabs & Sub-navigation

Keep the existing `.neon-navlink` interaction model (neutral at rest, accent on hover/active) — it already reads calmly. The fix here is structural, covered fully in `02_Information_Architecture.md`: fewer, flatter tab groups, and a real "More" destination so sub-navs stop needing 5-6 slots each.

---

## 8. Navigation (chrome)

- **Mobile bottom nav:** 5 tabs, icon + label, current active tab gets the one accent treatment already defined. (Exact tab set proposed in `02_Information_Architecture.md`.)
- **Desktop:** the existing horizontal top bar is fine functionally; consider (in `05_Desktop_Strategy.md`) whether wider viewports should get a persistent secondary rail instead of a second row of sub-nav pills, to reduce vertical chrome stacking.
- **Chat** gets pulled into the primary tab set (see IA doc) — a persistent header icon undersells its role in the product's own stated identity.

---

## 9. Icons

No icon-system change needed — `components/nav/icons.tsx` already centralizes nav icons. Extend the same approach to the pill/status icons introduced by `<StatPill>` (§6) so injury/live/locked/streak icons live in one file instead of being redrawn per component.

---

## 10. Player Row (canonical)

One component, `<PlayerRow>`, replacing the four independent implementations found in the audit (MyTeamApp's `RosterRow`, `RosterList`'s row, Matchup's `PlayerCell`, Gamecast's Fantasy Impact list item). Defined fully in `03_Component_System.md`. Design rule: name + position/team + headshot always visible; opponent, points, and at most 2 status pills visible by default; bye week, %owned, and deeper stats live behind a tap (opens the existing `PlayerCardModal`, already built and good). Position color (§2) applied via a left accent bar or position-letter chip, consistently, everywhere a player appears.

---

## 11. Live Indicators

One `<LiveIndicator>` component wrapping the existing `.live-dot` pulse — currently implemented ad hoc per screen. States: `live` (red pulse, unchanged), `idle` (dim static dot, unchanged), and a new `soon` state (amber, static, for "starting within the hour") to give Home's countdown cards and Draft's pre-draft state something better than either full pulse or fully dim.

---

## 12. Status Indicators

Formalize the win/loss/pending semantics using the new `--wl-success`/`--wl-danger`/`--wl-warning` tokens (§2) everywhere a delta or state is shown: matchup projection deltas, standings movement, trade status, poll status. Today these are each improvised per component with slightly different hues.

---

## 13. Tables

**New rule: no `<table>` in any mobile viewport.** Two confirmed violations — the Draft board and the Power-Rankings week-by-week trend view — both genuinely horizontal-scroll on a 375-390px phone. Both convert to a row-based or card-based layout at mobile widths (Draft board: one round per screen with swipe/tap between rounds, already partially how DraftBoard's mobile view degrades — make it the primary mobile pattern, not a fallback; Power Rankings trend: a per-team sparkline row instead of a per-week column grid). Desktop can keep true tables where they're the right tool (Draft board at desktop width is fine as a full grid).

---

## 14. Modals, Drawers, Bottom Sheets

Existing patterns are mostly right and should be kept, just applied consistently:
- **Bottom sheet** — already used correctly for Roster's slot-edit picker; extend the same pattern to any other "pick one from a list" mobile interaction (Free Agents' drop-candidate picker, Trades' player picker) instead of each hand-rolling its own inline-expansion panel.
- **Modal** — reserve for things that must interrupt (player card detail, group info). The Chat AI-training-notice modal on first send is flagged as friction with no present value — demote to a passive Settings toggle instead of an interrupt.
- **Drawer** — not currently used; a candidate for Chat's group-info panel on desktop widths where a full modal feels heavy.

---

## 15. Notifications & Toasts

Settings already established the right pattern with `<SavedIndicator>` (inline, non-blocking confirmation instead of a toast) — extend this as the default save-confirmation pattern app-wide, including Commissioner sections, which currently each hand-roll their own idle/saving/saved/error state instead of sharing one.

---

## 16. Empty States

One `<EmptyState>` component (icon/illustration + one line of context + optional action) replacing ad hoc "nothing here yet" text scattered across the app — most visibly, Matchups' Narrative section, which today renders a permanent placeholder card taking prime real estate under the score header even when it has nothing to say. An empty narrative should not render a full flat/glowing card at all; it should collapse to nothing or a single muted line.

---

## 17. Loading States

No systemic problem found in the audit here — keep existing patterns (skeleton/spinner usage was not flagged as inconsistent). Apply the same "flat, no glow" rule to loading skeletons as to their eventual content.

---

## 18. Error States

Formalize using `--wl-danger` + a consistent icon, paired with a retry action where the underlying request is retryable (matches existing `OfflineBanner` pattern, which is already good — extend its visual language to inline error states rather than introducing a new one).

---

## 19. Motion budget (explicit, enforceable)

To make the "glow is a signal" rule concrete and testable per screen:

> **No more than one Featured (rotating-glow) card and no more than two Live (pulsing-indicator) elements may be visible in the viewport at the same time.** If a screen wants more, the excess downgrades to Flat.

This single number is what turns the audit's qualitative "too much glow" findings (5 rings on Gamecast, 5-6 on Draft, 10+ on Awards) into something a reviewer can actually check against a build. Reduced-motion behavior (OS-level and the in-app Settings override) is unchanged — both already work correctly and this redesign does not touch that mechanism.
