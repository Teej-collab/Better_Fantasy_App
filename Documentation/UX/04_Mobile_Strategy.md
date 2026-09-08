# THE WEEKEND — Mobile Strategy (Proposed)

**Status:** Proposal for review. THE WEEKEND is already a real installable PWA with genuinely good native-feeling infrastructure (safe-area handling, pull-to-refresh with proper nested-scroll detection, reduced-motion support) — this document is about layout/hierarchy on top of that foundation, not rebuilding the mobile shell.

---

## 1. Target widths

Design and test against **375px** (iPhone SE/mini baseline — the tightest real target), **390px** (the current iPhone default), and **430px** (Pro Max / larger Android). Anything that works at 375px works at the other two; 375px is the enforcement width for the "no `<table>` on mobile" and "44px touch target" rules below.

---

## 2. Navigation

Bottom nav per `02_Information_Architecture.md`: **Home / League / Matchup / Chat / More**, 5 tabs, icon + label, current tab gets the app's one accent treatment. This is a smaller structural change than a redesign — the `BottomNav.tsx` component and its underlying `navDestinations.ts` ordering system already support exactly this shape; it's a data/config change (which 5 keys populate it, and adding a real "more" destination) more than a rebuild.

Chat's promotion from header icon to a real tab is the one navigation change that meaningfully affects the mobile chrome — everything else in the IA doc is sub-nav/routing, not the persistent bottom bar itself.

---

## 3. Touch targets

**Minimum 44×44px for any interactive control**, enforced app-wide. Confirmed violations from the audit to fix as part of this pass: Roster's Drop button (`px-2 py-1 text-[11px]`), the slot-edit pill (`text-[10px]`), `HomeCardDeck`'s drag handle (28×28px). This is a small, mechanical fix once the `<PlayerRow>`/`<Card>` components exist (§`03_Component_System.md`) — it becomes a property of the shared component instead of something to individually audit per instance forever.

---

## 4. Tables → row/card layouts

**Hard rule: no `<table>` element renders at mobile widths, anywhere.** Two confirmed current violations:
- **Draft board** (`DraftBoard.tsx`) — currently a literal `<table>` in `overflow-x-auto`. Mobile treatment: one round per screen, swipe or tap to move between rounds (the component already has a narrower mobile-oriented rendering path per the audit — promote it to the *only* mobile path rather than a secondary fallback next to the table).
- **Power Rankings trend view** — currently one column per week of the season. Mobile treatment: a per-team row with a compact sparkline (small inline trend line) instead of a wide week-by-week grid, consistent with how the week-view (non-table) already renders safely.

Any future table-shaped data defaults to a row-list or card layout below a defined breakpoint — this becomes a review checklist item, not a one-time fix.

---

## 5. Bottom sheets vs. full pages vs. inline expansion

- **Bottom sheet:** the correct pattern for "pick one thing from a list" on mobile (already used well for Roster's slot-edit picker). Extend to Free Agents' drop-candidate picker and Trades' player picker, both of which currently hand-roll their own inline-expansion panel that pushes surrounding rows down the page instead of overlaying.
- **Full page:** any destination reachable from the nav (League, Matchup, Chat, More's sub-pages).
- **Inline expansion:** reserved for genuinely small, single-row detail toggles (e.g., expanding one matchup's score-event log within an already-open list) — not for multi-step flows like add/drop confirmation, which belongs in a bottom sheet instead.

---

## 6. Motion budget on mobile specifically

The `01_Design_System.md` §19 rule (max 1 Featured card + max 2 Live elements visible at once) matters most on mobile, where the whole viewport is smaller and a busy screen is proportionally more of what's visible at any moment. Home's current stack of up to 9-10 glowing cards is the single highest-impact place this rule applies — after the Card-tier migration, a realistic Home scroll should have at most one Featured card (e.g., a live game currently in progress) and the rest flat, which also meaningfully reduces battery/GPU cost during exactly the moment (game day, phone unplugged at a bar or stadium) when that matters most.

---

## 7. Density on player-heavy screens

Roster's per-row element count (up to 11 discrete items today) gets fixed by `<PlayerRow>`'s density modes (`03_Component_System.md`) — "compact" for list/comparison contexts, "detailed" (still capped at 2 status pills, per `01_Design_System.md` §6) for the primary Roster view. This directly shortens the scroll length of a 16-player roster on a phone screen without removing any information — the removed lines move behind a tap into the existing `PlayerCardModal`.

---

## 8. What's already right and shouldn't be touched

- Safe-area padding (`.safe-px`, `.safe-pt`, `.safe-pb`) — correct, keep as-is.
- Pull-to-refresh with nested-scroll-ancestor detection — a genuinely well-built native-feeling touch, keep as-is.
- The single-pane list↔thread swap pattern in Chat (`ChatApp.tsx`) — correct mobile pattern, keep.
- Roster and Free Agents' avoidance of fixed pixel widths / reliance on `min-w-0`/`truncate` — already resilient to narrow viewports, keep as the pattern for any new component.
- Reduced-motion support (OS-level query + in-app Settings override) — keep exactly as implemented; nothing in this redesign changes that mechanism, only what triggers motion in the first place (fewer Featured/glow cards to animate).

---

## 9. Desktop is not "mobile but wider"

Per the brief's own instruction, mobile is the primary design target, but desktop gets real, separate treatment rather than a stretched mobile layout — see `05_Desktop_Strategy.md`.
