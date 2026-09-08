# THE WEEKEND — Component System (Proposed)

**Status:** Proposal for review. Each entry names what it replaces (the duplicate implementations the audit found) so the consolidation work is traceable back to real files, not invented from scratch.

---

## Card primitives

### `<Card tier="flat" | "live" | "featured">`
The base shell for every card in the app. Replaces the single overloaded `.neon-panel` class. See `01_Design_System.md` §4 for the full tier rule. Every other component below renders inside one of these three tiers — never a bespoke border/glow treatment of its own.

### `<EmptyState icon label action? />`
Replaces ad hoc "nothing here yet" text found scattered across Matchups' Narrative section, various commissioner panels, and history/records views. Renders as a single muted line by default, not a full card — an empty state should take up less visual weight than real content, not the same amount.

---

## People & teams

### `<PlayerRow player slot? density="compact" | "detailed" />`
Replaces 4 independent implementations: `MyTeamApp.tsx`'s `RosterRow`, `RosterList.tsx`'s row, `StarterComparisonTable.tsx`'s `PlayerCell`, and Gamecast's `FantasyImpact.tsx` list item.

- **Always visible:** headshot, name, position (color-coded per `positionColors.ts`), NFL team, opponent.
- **Compact density** (used in Matchup lineup comparison, Gamecast fantasy impact): + points only.
- **Detailed density** (used in Roster): + projection, at most 2 status pills (injury/locked/live), slot indicator if editable.
- **Everything else** (bye week, %owned, deeper stats) lives behind a tap → opens the existing `PlayerCardModal` (already good, unchanged).
- Tapping the row (not a specific control) opens the player card everywhere this component is used — one consistent interaction instead of per-page variations.

### `<TeamRow team rank? record? trend? />`
Replaces 4 independent implementations: Standings' `StandingsListRow`, Power Rankings' week-view row, `DraftBoard`'s column header, Trades' team-select button.
- Always: team name/logo, owner name.
- Optional slots (shown per context): rank number, record (W-L-T), a stat value (PF, points-this-week — caller-supplied), and a `<TrendIndicator>` (see below) when movement data exists.
- This is what makes `MovementBadge` (already built, currently only wired into Power Rankings) available on Standings for free — see the audit's P2 finding about Standings not conveying momentum.

### `<TrendIndicator direction="up" | "down" | "flat" amount? />`
Formalizes the existing `MovementBadge` component as the shared primitive, using the new `--wl-success`/`--wl-danger` tokens. Used inside `<TeamRow>` and anywhere else a rank/points delta is shown.

---

## Matchup & score

### `<MatchupHero matchup />`
Formalizes the existing `MatchupScoreHeader` + `WinProbabilityBar` combination (already working well per the audit) into one named component, with one addition: a "My lineup" quick-link, since My Team is being pulled off the primary tab bar in `02_Information_Architecture.md` and needs a natural entry point from the screen users are already on when they want to check it.

### `<MatchupCard matchup variant="list" | "hero" />`
Formalizes the existing `MatchupCard.tsx`, which the audit confirmed is already correctly shared between the matchups-list accordion and pulled into the full matchup page's `TeamSummary`/`HeadToHeadSection`/`NarrativeSection` — no structural change, just documenting it as the canonical pattern other areas (see Ranked Category Card below) should follow.

### `<StarterComparisonRow home away />`
The mobile-safe version of `StarterComparisonTable`'s row — same data, stacked layout below a defined width breakpoint instead of a cramped 3-column grid, addressing the audit's mobile-truncation finding.

---

## Live / broadcast

### `<LiveIndicator state="live" | "soon" | "idle" />`
Formalizes the existing `.live-dot` pulse, adds the new `soon` (amber, static) state described in `01_Design_System.md` §11.

### `<GamecastPlay play />`
A single play-by-play row — currently exists inline inside `PlayByPlay.tsx`; extracting it as a named component makes it reusable if a condensed play feed is ever wanted elsewhere (e.g., a "big plays" ticker on Home during game day), without duplicating the formatting logic that's currently also copy-pasted (`ordinal()` exists identically in three files per the audit — this component is also where that consolidates to one place).

### `<FantasyImpactRow play fantasyDelta />`
Formalizes `FantasyImpact.tsx`'s bespoke row into a thin wrapper around `<PlayerRow density="compact">` (§ above) instead of its own independent layout — this is the fourth "player row" duplicate the audit found, and the most direct one to fold in.

---

## Leaderboards & records

### `<RankedCategoryCard title icon entries unit />`
**The single highest-leverage consolidation in this document.** Replaces three components confirmed near-identical by direct code comparison: `RecordBook.tsx`, `AwardLeaderboards.tsx`, and `PowerRankingsAllTime.tsx`. One component, parameterized by a category's title, icon, ranked entries, and unit — Awards, Records, and All-Time Power Rankings become three different *data sets* rendered through one component instead of three separately-maintained near-copies. Rendered at `Card tier="flat"` always (none of this content is live).

### `<LeaderboardGrid categories />`
The grid wrapper around multiple `<RankedCategoryCard>`s — replaces the page-level grid layout currently duplicated in `RecordBook.tsx` and `AwardLeaderboards.tsx`.

---

## Chat

### `<ChatBubble message grouped />`
Formalizes the existing `MessageBubble.tsx` — already well-built per the audit, no structural change needed. Documented here so it's recognized as the canonical pattern rather than something Commish's Corner's card-based announcements should also try to imitate (announcements are intentionally a different, card-shaped mode within the same screen — keep that distinction, just make both explicitly documented choices rather than one being an unplanned inconsistency).

### `<Avatar person size />`
Replaces 4 independent inline avatar-circle implementations found across `ConversationList.tsx`, `GroupInfoModal.tsx`, `NewMessageModal.tsx`, and `MessageBubble.tsx` (one local implementation already exists in `ConversationList.tsx` — promote it to a shared, exported component instead of leaving it local).

---

## Forms & settings

### `<SettingsPanel title status="idle" | "saving" | "saved" | "error" children />`
Formalizes Settings' already-good section-card + `SavedIndicator` pattern (per the audit, the best-organized area of the app) into a component that Commissioner sections can adopt too — replacing the ~5 independently hand-rolled `Panel`/save-state types found duplicated across `KeeperRulesSection.tsx`, `TradeSettingsAndReview.tsx`, `RosterSlotsSection.tsx`, and others.

### `<PanelList children />`
Replaces the literal copy-pasted `neon-panel flex flex-col divide-y divide-black/5...` className string found across `MembersSection.tsx`, `TeamsSection.tsx`, `TradeSettingsAndReview.tsx`, and ~15 similar instances in Admin's components. Always renders `Card tier="flat"`.

---

## Status & feedback

### `<StatPill icon label tone="neutral" | "success" | "danger" | "warning" />`
Replaces the many hand-rolled pills across Roster (injury, Locked, %owned), Matchups (rivalry/GOTW/playoff/streak/clutch/bench-crime), Draft (AUTO/KEEP/grade), Standings (🏆/💩). Enforces the "max 2 pills visible per row" rule from `01_Design_System.md` §6 and the "color always paired with icon/label" accessibility rule.

### `<SaveStatus state />`
The underlying primitive `<SettingsPanel>` and any standalone save action use — formalizes `SavedIndicator.tsx`.

---

## Summary: duplication resolved by this document

| Duplicate concept | Independent implementations found | Consolidates to |
|---|---|---|
| Player row | 4 (RosterRow, RosterList row, matchup PlayerCell, Fantasy Impact row) | `<PlayerRow>` |
| Team/owner row | 4 (Standings row, Power Rankings week row, Draft board header, Trades team picker) | `<TeamRow>` |
| Ranked category card | 3 (RecordBook, AwardLeaderboards, PowerRankingsAllTime) | `<RankedCategoryCard>` |
| Stat cluster | 2 (Owner page's PeriodCard/Stat, TeamProfileCard's RecordBox/MiniStat) | `<TeamRow>` stat slots, or a shared `<StatCluster>` if the two remaining use cases need more than TeamRow's slots offer (open question — flagged for discussion, not force-fit) |
| Avatar | 4 (ConversationList, GroupInfoModal, NewMessageModal, MessageBubble) | `<Avatar>` |
| Panel/list boilerplate | 5+ (Commissioner sections) + ~15 (Admin components) | `<PanelList>` |
| Save-state type | ~5 (Commissioner sections, each hand-rolled) | `<SettingsPanel status>` |
| `ordinal()` formatter | 3 (GameHeader, CurrentDrive, PlayByPlay — not a UX issue but paired here since `<GamecastPlay>` is the natural home for the fix) | inside `<GamecastPlay>` / a shared formatter util |
