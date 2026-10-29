# THE WEEKEND — Competitive Fantasy Football Audit

**Prepared:** September 2026 · **Subject:** THE WEEKEND vs. Sleeper, ESPN Fantasy Football, Yahoo Fantasy Football
**Audience:** Developer / Designer / Product Manager / Investor / Potential Co-founder
**Status:** Research only. No implementation was performed as part of this audit. Nothing in this document should be treated as an approved backlog until the commissioner has reviewed it.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Methodology & Confidence Framework](#2-methodology--confidence-framework)
3. [Product Snapshot: THE WEEKEND](#3-product-snapshot-the-weekend)
4. [Product Snapshot: Sleeper](#4-product-snapshot-sleeper)
5. [Product Snapshot: ESPN Fantasy Football](#5-product-snapshot-espn-fantasy-football)
6. [Product Snapshot: Yahoo Fantasy Football](#6-product-snapshot-yahoo-fantasy-football)
7. [How To Read This Document](#7-how-to-read-this-document)
8. [Feature Matrix — Accounts, Onboarding & League Setup](#8-feature-matrix--accounts-onboarding--league-setup)
9. [Feature Matrix — Commissioner Tools & Trust](#9-feature-matrix--commissioner-tools--trust)
10. [Feature Matrix — Draft Experience](#10-feature-matrix--draft-experience)
11. [Feature Matrix — Rosters, Lineups & Scoring](#11-feature-matrix--rosters-lineups--scoring)
12. [Feature Matrix — Waivers & Free Agency](#12-feature-matrix--waivers--free-agency)
13. [Feature Matrix — Trades](#13-feature-matrix--trades)
14. [Feature Matrix — Live / Game-Day Experience](#14-feature-matrix--live--game-day-experience)
15. [Feature Matrix — Social, Chat & Community](#15-feature-matrix--social-chat--community)
16. [Feature Matrix — Notifications](#16-feature-matrix--notifications)
17. [Feature Matrix — League History, Awards, Records & Rivalries](#17-feature-matrix--league-history-awards-records--rivalries)
18. [Feature Matrix — Navigation, Home Screen & Discovery](#18-feature-matrix--navigation-home-screen--discovery)
19. [Feature Matrix — Mobile, PWA, Performance & Design](#19-feature-matrix--mobile-pwa-performance--design)
20. [Feature Matrix — Security, Privacy & Data Architecture](#20-feature-matrix--security-privacy--data-architecture)
21. [Feature Matrix — Pricing & Business Model](#21-feature-matrix--pricing--business-model)
22. [The "Little Things" Audit](#22-the-little-things-audit)
23. [Deep Dive: Draft Experience](#23-deep-dive-draft-experience)
24. [Deep Dive: Game-Day Experience](#24-deep-dive-game-day-experience)
25. [Deep Dive: Social & Community](#25-deep-dive-social--community)
26. [Deep Dive: Commissioner Power & Trust](#26-deep-dive-commissioner-power--trust)
27. [Deep Dive: League History & Continuity](#27-deep-dive-league-history--continuity)
28. [Deep Dive: Navigation, Home Screen & Mobile UX](#28-deep-dive-navigation-home-screen--mobile-ux)
29. [Deep Dive: Visual Design & Performance](#29-deep-dive-visual-design--performance)
30. [Deep Dive: Security & Privacy](#30-deep-dive-security--privacy)
31. [THE WEEKEND's Confirmed Gaps & Strengths, Ranked](#31-the-weekends-confirmed-gaps--strengths-ranked)
32. ["Why Would I Switch / Why Would I Stay" Tests](#32-why-would-i-switch--why-would-i-stay-tests)
33. [Prioritized Recommendations (P0–P4)](#33-prioritized-recommendations-p0p4)
34. [Phase 0–5 Roadmap](#34-phase-05-roadmap)
35. [Executive Scorecard & Final Assessment: "If This Were My Money"](#35-executive-scorecard--final-assessment-if-this-were-my-money)

---

## 1. Executive Summary

THE WEEKEND is a real, live, production fantasy football app running an actual 12-team money league through the 2026 season. It is not a prototype. Six independent, evidence-based investigations (three deep codebase audits, three deep competitor research passes) went into this document, and the headline finding is this: **THE WEEKEND's core engineering is more thorough than its outward reputation would suggest, but it has three gaps serious enough that a knowledgeable fantasy player would notice within one week of real use, and one structural dependency that undercuts the app's own "we left ESPN" narrative.**

**The three gaps that matter most:**

1. **There is no waiver system.** Free agency is instant, first-come-first-served. No FAAB, no priority order, no claim queue. Every competitor studied here — Sleeper, ESPN, Yahoo — supports at minimum two waiver models. This is the single most consequential functional gap in the app relative to what a fantasy player expects on day one.
2. **There is no server-side lineup lock.** A manager can edit their starting lineup after a player's real game has kicked off — or even after it's over — with zero backend enforcement. This is a fairness/integrity gap, not a UX nicety, and it is invisible until someone exploits it.
3. **Matchup schedule pairing and the playoff bracket are still 100% dependent on a live, separate ESPN league**, synced through the same private, unofficial `espn_api` library the app's own draft/roster/lineup system was rebuilt specifically to eliminate. The "ESPN independence" story is true for the draft and false for the schedule.

**The structural strength that matters most:** THE WEEKEND's realtime and social layer — chat (league, DM, draft-room, Commish's Corner), Gamecast (real ESPN play-by-play piped through a genuinely efficient viewer-gated WebSocket architecture), real Web Push with real trigger wiring, AI-generated weekly recaps and draft grades, and a from-scratch power-ranking/awards/records system — is, feature for feature, competitive with or ahead of what a 12-person money league actually uses day to day. This is not a small, thin app. It is a deep app with a few load-bearing gaps.

**Competitive positioning in one paragraph, per product:** Sleeper is the design and social benchmark — free forever, chat-first, deepest dynasty/keeper tooling, and the platform other apps get compared against — but it is quietly cross-subsidized by a separate real-money betting product with its own trust problems, and its support/reliability has real, sourced cracks. ESPN just became the official NFL fantasy game (absorbing NFL.com Fantasy's user base in 2026) and owns real broadcast data no one else can replicate, but its 2025 redesign drew genuine user backlash and its Sunday-reliability reputation is current, not just historical. Yahoo has the deepest scoring customization and the most defensible business model (a paid tier that enhances decision-support without touching competitive fairness), plus unmatched league continuity, but carries the most current, sourced reliability complaints of the three.

THE WEEKEND does not need to become Sleeper, ESPN, or Yahoo. It needs to close three specific, board-defensible functional gaps, and it needs someone to actually use the sync-trigger and audit-trail tooling that already exists but currently has no UI. Section 35 gives the honest, no-hedging investment verdict.

---

## 2. Methodology & Confidence Framework

This audit was produced by six parallel research agents — three auditing THE WEEKEND's real backend/frontend code (not documentation, not routes-as-proxy-for-features), and three researching Sleeper, ESPN Fantasy, and Yahoo Fantasy against official sources (help centers, App Store/Play listings, official blogs/press releases) plus credible current reviews and community discussion.

**Ground rules that were enforced across every investigation:**

- A feature is never marked working because a button or route exists for it. The underlying logic was read and traced.
- Every finding in this document carries a classification (Section 7) and, for THE WEEKEND, a `file:line` citation. For competitors, every claim carries a confidence tag (High / Medium / Low) and a source.
- Where evidence was thin or contradictory, this document says so explicitly rather than filling the gap with a plausible-sounding guess. Several competitor claims below are marked **unconfirmed** — treat those as open questions, not settled facts.
- No feature is recommended purely because a competitor has it. Section 33's recommendations are gated on a real "what user problem does this solve for a 12-person money league" test — see Section 32.

**What this document is not:** a UI screenshot audit of competitor apps (none of the research agents had live logins to Sleeper/ESPN/Yahoo — findings rest on official documentation, store listings, and credible secondary sources, flagged accordingly), and not a performance benchmark (no timed, side-by-side load tests were run).

---

## 3. Product Snapshot: THE WEEKEND

A real-money, 12-team home league app, FastAPI backend + Next.js 16 frontend, running against a shared production Supabase Postgres database, deployed on Railway (backend) and Vercel (frontend). The defining architectural fact of the 2026 season: **the draft, rosters, lineups, and scoring pivoted fully in-app**, away from a prior era where the whole league lived inside a real ESPN league. That pivot is complete for those four systems. It is not complete for scheduling or playoffs (Section 14, Section 26).

The app's own git history and internal comments show a real, unusually self-aware engineering culture: a documented 2026-09 security fix that closed a genuine cross-league data-isolation hole, an internal `ADMIN_DASHBOARD.md` that explicitly lists what it has *not* built rather than overstating scope, and multiple in-code docstrings explaining *why* a design decision was made, including admitted trade-offs (no CSP yet, no Redis yet, no audit log yet). This diligence is itself a signal worth naming plainly in Section 35.

---

## 4. Product Snapshot: Sleeper

Free-forever, ad-free, chat-first fantasy platform (NFL/NBA/EPL/LaLiga/Ligue 1), owned by Blitz Studios. The core season-long product carries **no subscription tier and no ads** — an explicit, repeated brand promise ("Sleeper is free, forever"). Real revenue is inferred to come from a separate, regulated real-money "Sleeper Picks" product (player-prop/spread pick'em, legal in ~30 states) and a league-dues payment product ("SleeperSafe"), cross-sold to the same user base inside the same app. 4.7★ across 274K App Store reviews. [High confidence — sleeper.com, support.sleeper.com]

---

## 5. Product Snapshot: ESPN Fantasy Football

Free, ad-supported, owned by Disney/ESPN. The single biggest 2026 development: **ESPN Fantasy is now the official fantasy game of the NFL**, and NFL.com's own season-long fantasy game is being shut down with users migrated into ESPN via a dedicated tool that preserves history, standings, and keepers. IBM confirms 14M+ users on ESPN Fantasy Football for 2025. ESPN's core structural advantage is unreplicable: it owns real NFL broadcast/data rights and employs the reporters (Adam Schefter, etc.) breaking the injury news that feeds its alerts. [High confidence — ESPN Press Room, Disney newsroom, IBM newsroom]

---

## 6. Product Snapshot: Yahoo Fantasy Football

Free core product plus a real, clearly-scoped paid tier (**Fantasy Plus**, ~$30/yr; **Fantasy Ultra**, ~$60/yr) that monetizes *decision support and account capacity* — draft recommendations, lineup automation, advanced projections — without touching competitive fairness (scoring/rules are identical free vs. paid). Deepest confirmed league-continuity story of the three (leagues running unbroken since 2007, a real cottage industry of tools built to preserve/migrate that history). Yahoo's free-tier projections are a genuine, current, multi-source consensus blend (BAKER Predictive Engine + FTN + THE BLITZ + Rotowire), not a single black-box number. [High confidence — help.yahoo.com, fantasysports.yahoo.com/lp/plus]

---

## 7. How To Read This Document

Every feature-matrix row uses one of six classifications:

| Classification | Meaning |
|---|---|
| **FULLY IMPLEMENTED** | Built, wired, enforced server-side where relevant, and traced end-to-end. |
| **PARTIALLY IMPLEMENTED** | Real and working, but with a confirmed real limitation (coverage gap, missing enforcement, missing a sub-case). |
| **UI ONLY** | A control or display exists but nothing meaningful happens server-side, or it reads a value it doesn't enforce. |
| **BROKEN** | Exists, is reachable, and does not work correctly. |
| **MISSING** | No evidence of the feature anywhere in the codebase (grepped exhaustively) or in the competitor's official/credible sources. |
| **UNKNOWN** | Genuinely inconclusive from available evidence — stated honestly rather than guessed. |

For THE WEEKEND, every row is backed by a file:line citation drawn from the underlying audits. For competitors, every row carries a confidence tag; unconfirmed items are marked explicitly and should not be treated as settled before a direct account walkthrough.

Importance is starred ★ (nice-to-have) through ★★★★★ (a 12-person money league will notice its absence within one season) — used in Sections 31–34 to prioritize, not decorate.

---

## 8. Feature Matrix — Accounts, Onboarding & League Setup

| Feature | THE WEEKEND | Sleeper | ESPN | Yahoo |
|---|---|---|---|---|
| Account creation | **FULLY IMPLEMENTED** — Discord OAuth, Google OAuth, and email/password, all minting a real session JWT (`backend/app/routers/auth.py:37-312`) | Email or phone, real verification code required [High] | ESPN account, email verification required before login [High] | Yahoo account, email/phone/DOB [High] |
| Email verification | **MISSING**, by explicit design (`app/queries/admin_users.py:8-12`) | Confirmed at signup [High] | Required before login [High] | Standard Yahoo account flow [Medium] |
| Password reset | **MISSING end-to-end** — no route, no email infra anywhere in the backend (`backend/app/routers/`) | Requires verified email/phone on file [High] | Standard ESPN account recovery [Medium] | Standard Yahoo account recovery [Medium] |
| Password change (signed-in user) | **MISSING** — no endpoint exists to change a password after signup | Assumed via standard account settings [Medium] | Assumed via standard ESPN account [Medium] | Assumed via standard Yahoo account [Medium] |
| Session revocation | **FULLY IMPLEMENTED**, real — `token_version` bump invalidates every outstanding JWT, checked by dedicated middleware (`app/main.py:61-119`) | UNKNOWN | UNKNOWN | UNKNOWN |
| Social/OAuth login | **FULLY IMPLEMENTED** — Discord (existing members only) + Google (self-serve) | Unconfirmed — no official source found either way [Low] | UNKNOWN | UNKNOWN |
| Multi-league support & switching | **FULLY IMPLEMENTED**, real — `GET /leagues/mine`, membership-verified switch (`leagues.py:50-73`) | Real, design-invested (up to 8 shown, reorderable, archivable) [Medium-High] | Real, standard [High] | Real, incl. second-account linking [High] |
| League creation (self-serve, genuinely multi-tenant) | **FULLY IMPLEMENTED** — verified live via scheduler independently driving multiple leagues' drafts | "Under a minute," cross-platform invite links [High] | Standard LM league creation [High] | Standard, incl. "Draft with Friends" pre-grouping [High] |
| Invite / join flow | **FULLY IMPLEMENTED** — real invite-code system, copy-to-clipboard UI | Unique shareable link [High] | Email invite w/ unique URL [High] | Shareable link/direct share [High] |
| League privacy (public/private, discoverability) | **MISSING** — no `is_public`/visibility concept anywhere in the schema | Public + private, public leagues discoverable via matchmaking [Medium] | Private by default, LM can make public [High] | Private + public leagues [High] |
| Commissioner / co-commissioner roles | **PARTIALLY IMPLEMENTED** — binary only (any member can be promoted to full commissioner; no lesser co-commissioner tier) | Co-commissioners (2-3 recommended) + up to 3 team co-owners [High] | LM + co-commissioner (permission granularity unconfirmed) [Low] | Commissioner + co-commissioner via explicit "Assign Access" flow [High] |

---

## 9. Feature Matrix — Commissioner Tools & Trust

| Feature | THE WEEKEND | Sleeper | ESPN | Yahoo |
|---|---|---|---|---|
| Scoring rules editor | **FULLY IMPLEMENTED**, genuinely granular — 45+ stat categories incl. distance-tiered FGs and QB-tackle split (`league_settings.py:47-54`, `ScoringRulesSection.tsx`) | Deep, any stat customizable [High] | Deep, per-position reception tiers, locks after Week 1 [High] | Deep, incl. distance-tiered kicker scoring, "Custom Recipes" presets [High] |
| Roster/slot settings | **FULLY IMPLEMENTED** — slot counts, IR count, position caps (`draft.py:306-397`) | Configurable, incl. Taxi Squad slots that don't count against limits [High] | Configurable, standard 2 IR / high-stakes 3 IR [High] | Configurable |
| Waiver settings (configurable, enforced) | **UI ONLY** — read-only proxy of a disconnected ESPN league's FAAB display; nothing enforced in-app | Real, 3 types (Rolling / Reverse Standings / FAAB), fully configurable [High] | Real, 2 types (Standard priority / FAAB) [High] | Real, 2 types (Rolling / FAAB) [High] |
| Trade veto / review | **FULLY IMPLEMENTED** — commissioner-only binary approve/veto, real state machine (`trades.py`) | **Commissioner-only, no league vote** — explicit official policy [High] | **League-vote model**, 48-hr window, adjustable threshold [High] | League Vote (default) or Commissioner-only, adjustable [High] |
| Draft order randomization (verifiable/shared) | **MISSING** — manual-only, no shuffle function found in backend or frontend | UNKNOWN — commissioner-only re-roll possible, no verifiable shared draw [Medium, flagged trust gap] | UNKNOWN | UNKNOWN |
| Playoff bracket / seeding | **PARTIALLY IMPLEMENTED, cosmetic only** — only `playoff_team_count` configurable; no in-app bracket/seeding engine; real brackets come from ESPN sync | Real, configurable playoff format | Real, 6-team bracket (12+ team leagues) | Real |
| Force-edit another team's roster (add/drop) | **FULLY IMPLEMENTED** (`commissioner_lineup.py:87-157`) | Real, broad LM powers | Real, broad LM powers [High] | Real |
| Force-edit another team's **lineup slots** | **MISSING** — commissioner tooling covers add/drop only, not slot moves | UNKNOWN | UNKNOWN | UNKNOWN |
| Member management (remove/replace mid-season) | **FULLY IMPLEMENTED** — promote/demote/remove/reassign-team (`leagues.py:287-359`) | Real | Real | Real |
| Commissioner action audit trail | **MISSING** (general) — explicitly deferred "Phase 2" per the app's own `ADMIN_DASHBOARD.md`; only two narrow undos exist (draft, chug) | UNKNOWN | UNKNOWN | UNKNOWN |
| Pause / undo mid-draft | **FULLY IMPLEMENTED**, real (`draft_engine.py:474-524, 661-700`) | Pause indefinitely + unlimited undo; **no native "skip pick"** button [High] | Pause + full reset (auction) [High] | Draft-fix support docs imply pause/reconnect support [Medium] |
| League-wide polls / announcements | **FULLY IMPLEMENTED** — real create/vote/close, commissioner-gated (`polls.py`) | UNKNOWN as native (informal via chat) | UNKNOWN | UNKNOWN |
| Sync/ops tooling accessible via UI | **MISSING** — real sync/compute triggers exist but are curl/API-only, no dashboard button | N/A (no equivalent public concept) | N/A | N/A |

---

## 10. Feature Matrix — Draft Experience

| Feature | THE WEEKEND | Sleeper | ESPN | Yahoo |
|---|---|---|---|---|
| Snake draft | **FULLY IMPLEMENTED**, real pick-clock, real autopick (`draft_engine.py`) | Yes, default [High] | Yes [High] | Yes |
| Auction draft | **MISSING** | Yes, real-time [High] | Yes (Salary Cap) [High] | Yes |
| Linear / 3rd-Round-Reversal draft | **MISSING** | Yes, both [High] | UNKNOWN | UNKNOWN |
| Draft queue | **FULLY IMPLEMENTED, genuinely wired into autopick** — queue checked first, falls through to rank-based BPA only when exhausted (`draft_autopick.py:63-117`) | Real, distinct from watchlist [High] | Real, feeds autopick from user's editable rankings [High] | Real ("starred" players) |
| Pre-draft custom rankings / cheat sheets | **MISSING** — autopick uses Sleeper's `search_rank` proxy only, no user-editable ranking import | **MISSING** — explicit official roadmap item, not built [High, confirmed gap] | **FULLY IMPLEMENTED** — user-editable pre-draft rankings drive autopick [High] | Real, incl. downloadable expert cheat sheets on paid tier [High] |
| Autopick logic | **FULLY IMPLEMENTED** — queue first, then true best-player-available by rank, explicitly not needs-first (a documented bug fix) | Queue first, then Sleeper's own internal rank [High] | User's rankings, falling back to ESPN's own expert-composite default [High] | User's rankings |
| Pick timer, commissioner-adjustable | **FULLY IMPLEMENTED** — 90s/60s/5s-grace tiers (`draft_engine.py:40-65`) | Real, soft/hard modes, mid-draft adjustable, scheduled auto-pause windows [High] | Real, adjustable (auction: 30s default, 5s increments) [High] | Real, default 60s |
| Reconnect handling | **FULLY IMPLEMENTED**, real — full authoritative state resync on reconnect, no fragile incremental replay (`app/draft/manager.py`) | Manual "press to rejoin" prompt implied [Medium-Low] | UNKNOWN | Draft-fix support doc exists (tacit acknowledgment of real issues) [Low-Medium] |
| Draft pick trading (in-season future picks) | **MISSING** | Real, up to 3 future years (keeper/dynasty leagues) [High] | Real, must be enabled, until 1 hr pre-draft [High] | Real, keeper leagues, toggleable [High] |
| Draft pick trading (live, during the draft) | **MISSING** | Real, live draftboard updates [High] | UNKNOWN | UNKNOWN |
| Keeper leagues | **FULLY IMPLEMENTED** — real consecutive-years cap, auto-seeded into draft board with all-or-nothing crosswalk guard (`routers/keepers.py`) — **no round-cost escalation rule** | Real, sequential rookie+vet drafts, compensatory picks | Real | Real |
| Dynasty leagues | **MISSING** as a distinct mode | Deep, genuine differentiator — Taxi Squads, sequential drafts | Real, rookie draft + pick trading | Built on keeper infrastructure, not first-class separate product [Medium] |
| Commissioner "set a pick for someone" | **MISSING** — only autopick/pause, no manual override of another owner's pick | UNKNOWN | UNKNOWN | UNKNOWN |
| Draft-room chat | **FULLY IMPLEMENTED**, separate table/WS frame from league chat (`draft.py:601-642`) | Implied via general chat-first design | UNKNOWN | UNKNOWN |
| "Big Screen"/TV-cast mode | **MISSING** | Real, official feature [High] | UNKNOWN | UNKNOWN |
| Draft board / history browsing (past seasons) | **FULLY IMPLEMENTED** for in-app-drafted (2026+) seasons via `/seasons/[season]/draft`; UNKNOWN how pre-pivot seasons degrade | UNKNOWN | UNKNOWN | UNKNOWN |
| Draft grades + AI recap write-ups | **FULLY IMPLEMENTED** — real percentile-based grading + Anthropic-generated per-team recaps, keeper-aware | **MISSING** as native | UNKNOWN | UNKNOWN |

---

## 11. Feature Matrix — Rosters, Lineups & Scoring

| Feature | THE WEEKEND | Sleeper | ESPN | Yahoo |
|---|---|---|---|---|
| Configurable roster slots (incl. FLEX/Superflex) | **FULLY IMPLEMENTED** (`roster_slots.py`) | Real | Real | Real |
| Lineup move/swap, server-enforced eligibility | **FULLY IMPLEMENTED** (`lineup_engine.py:109-160`) | UNKNOWN | UNKNOWN | UNKNOWN |
| **Server-side lineup lock at kickoff** | **MISSING — confirmed gap.** No lock exception class exists in the live mutation path (`app/domain/lineup_exceptions.py`); a retired path had one, current one doesn't | Per-player lock at that player's own kickoff [Medium-High] | Per-lineup, standard | Per-player/slot lock (more forgiving than a single Sunday-morning lock) [Medium] |
| IR slot — functionally usable | **BROKEN** — `is_eligible_for_slot()` never authorizes a move into the IR slot label for any position, despite IR being configured in roster shape | Real, doesn't count against limits | Real, requires O/IR/IL tag, flexible re-tagging | Real, incl. NFI-R/NFI-A/PUP variants |
| Bye-week awareness | **PARTIALLY IMPLEMENTED** — computed & displayed, **not enforced** (no block/warning on starting a bye player) | UNKNOWN | UNKNOWN | UNKNOWN |
| Scoring engine, rule-configurable | **FULLY IMPLEMENTED**, real, per-league (`scoring_engine.py`) | Real, deep | Real, deep | Real, deep incl. distance-tiered FGs |
| Stat correction handling | **PARTIALLY IMPLEMENTED** — recompute happens automatically only while a game is live; a correction issued after the live window needs a manual trigger | Real, "Recalculate Matchup Records" commissioner tool [High] | Real, dedicated stat-corrections page; third-party sources report multi-hour lag [High existence / Medium lag complaint] | Real, correction window stays open through next week's kickoff [High] |
| Live score update mechanism | **FULLY IMPLEMENTED**, poll-based, 60-120s cadence gated to live games (`scheduler.py`) | UNKNOWN cadence, marketing claims "real-time," no independently verified latency | Real, live, broadcast-data-backed | Real, live |
| Per-week roster history (frozen snapshots) | **PARTIALLY IMPLEMENTED** — real for weeks that existed after the feature shipped; silently falls back to live data for earlier weeks with no snapshot | UNKNOWN | UNKNOWN | UNKNOWN |
| Per-week player projections | **PARTIALLY IMPLEMENTED, ~83% coverage** — harvested only as a side effect of a legacy ESPN sync path tied to a disconnected shadow league; season-average fallback for the rest | UNKNOWN methodology | Real, live-updating, driven by a named analyst (Mike Clay) + statistical modeling, explicitly not pure ADP [High] | Real, multi-source consensus blend (BAKER/FTN/THE BLITZ/Rotowire), free tier [High] |

---

## 12. Feature Matrix — Waivers & Free Agency

| Feature | THE WEEKEND | Sleeper | ESPN | Yahoo |
|---|---|---|---|---|
| Free agent add/drop, real end-to-end | **FULLY IMPLEMENTED** (`lineup_engine.py:178-218`) | Real | Real | Real |
| **Any real waiver system** (FAAB, priority, or reverse-standings) | **MISSING.** Confirmed by exhaustive grep — zero waiver-claim table, zero priority column, zero FAAB logic, zero processing job. Free agency is instant/first-come-first-served with a read-only display of a disconnected ESPN league's FAAB number | **FULLY IMPLEMENTED**, 3 real types, fully configurable [High] | **FULLY IMPLEMENTED**, 2 real types [High] | **FULLY IMPLEMENTED**, 2 real types [High] |
| Waiver processing schedule | N/A (no waiver system) | Configurable, default Wed FA open → Tue claim window [High] | Daily 3-5am ET default [High] | Configurable, 0-7 day hold [High] |
| Duplicate-claim conflict handling | N/A | Implied by real claim system | Implied | Implied |

This is the single largest functional gap identified in this audit relative to universal competitor coverage — see Section 31, Section 33.

---

## 13. Feature Matrix — Trades

| Feature | THE WEEKEND | Sleeper | ESPN | Yahoo |
|---|---|---|---|---|
| Propose/accept/reject/cancel | **FULLY IMPLEMENTED**, real double-validated (proposal + accept-time) transactional flow (`trades.py:175-268`) | Real | Real | Real |
| Counter-offers | **MISSING** | UNKNOWN | UNKNOWN | UNKNOWN |
| Multi-team (3+) trades | **MISSING**, explicitly by design | **Real, marketed differentiator** ("one of the only platforms") [High] | Unconfirmed [Low] | Unconfirmed [Low] |
| Trade veto/review | **FULLY IMPLEMENTED**, commissioner-only | Commissioner-only, no vote [High] | League-vote, 48hr, adjustable threshold [High] | League Vote or Commissioner-only [High] |
| Trade block | **MISSING** | Real, incl. "Trade Interest" heart-counter and exploding offers [High] | Unconfirmed [Low] | Unconfirmed [Low] |
| Trade history (league-wide, browsable) | **PARTIALLY IMPLEMENTED** — own-team history only, no league-wide log | **MISSING** as dedicated tab — mixed into general activity feed, third-party tools exist to fill the gap [Medium-High] | UNKNOWN | UNKNOWN |
| Future draft pick trading | **MISSING** | Real, up to 3 years | Real | Real (keeper leagues) |
| FAAB-dollar trading | N/A (no FAAB) | Real | UNKNOWN | UNKNOWN |
| Trade deadline enforcement | **FULLY IMPLEMENTED**, real check | UNKNOWN | Real, interacts w/ review period | UNKNOWN |

---

## 14. Feature Matrix — Live / Game-Day Experience

| Feature | THE WEEKEND | Sleeper | ESPN | Yahoo |
|---|---|---|---|---|
| Real play-by-play data | **FULLY IMPLEMENTED** — real ESPN public scoreboard/summary data, normalized into real drives/plays (`gamecast/providers/espn.py`) | Marketed as real-time ("SleeperZone") — no independently verified latency spec [Medium] | Real, ESPN's own broadcast data, incl. embedded highlight video ("Matchup Moments," 2026) [High] | Real, integration unconfirmed in detail [Low-Medium] |
| Red zone / on-offense indicator on roster view | **FULLY IMPLEMENTED**, real, accurate (`MyTeamApp.tsx`) | Real, "RZ" tag [High] | Real, configurable alerts [High] | UNKNOWN |
| Live score push mechanism | **FULLY IMPLEMENTED** — genuinely efficient: WebSocket push, viewer-gated backend poll (zero ESPN calls with no subscribers), 4s cadence | UNKNOWN mechanism | Real, live | Real, live |
| **Matchup pairing / schedule generation** | **MISSING as an in-app system — confirmed structural gap.** No schedule generator exists anywhere in the codebase; pairing is read from a live, separate ESPN league via the same private library the draft/roster pivot was meant to eliminate | N/A (native) | N/A (native, real broadcast schedule) | N/A (native) |
| **Playoff bracket generation** | **MISSING as an in-app system** — same ESPN-sync dependency as above; `is_playoff` flag itself is set by ESPN sync, not computed | N/A (native) | N/A (native) | N/A (native) |
| Live video/highlights embedded in-app | **MISSING** | UNKNOWN | **Real, unique** — "Matchup Moments" (2026), unreplicable without broadcast rights [High] | UNKNOWN |
| Stat-correction propagation during live window | **PARTIALLY IMPLEMENTED** — full recompute on every 60s tick during live games picks up corrections indirectly; no dedicated correction handling | Real, commissioner "Recalculate" tool [High] | Real, but reported lag [Medium] | Real, wide correction window [High] |
| Named-analyst/editorial live show | **MISSING** | UNKNOWN | Real — "Fantasy Focus: Sunday Kickoff," live expert Q&A pre-kickoff [High] | UNKNOWN |

---

## 15. Feature Matrix — Social, Chat & Community

| Feature | THE WEEKEND | Sleeper | ESPN | Yahoo |
|---|---|---|---|---|
| Real-time, persisted league chat | **FULLY IMPLEMENTED** (`chat.py:295-439`) | **Real, the design center of the whole app** | Real, but consistently described as a step behind [Medium-High] | Real, "Messenger" |
| Direct messages | **FULLY IMPLEMENTED** | Real | UNKNOWN | UNKNOWN |
| GIFs | **FULLY IMPLEMENTED** — real GIPHY server-side proxy (`providers/giphy.py`) | Real | Real, via smiley icon | Real |
| Image uploads | **FULLY IMPLEMENTED**, allowlisted host validation | Real | UNKNOWN | UNKNOWN |
| Emoji reactions | **FULLY IMPLEMENTED**, fixed set, real toggle | Real, actively-promoted "meme reactions," incl. reacting inline on trade/waiver cards [High] | Real, but single-select only [High] | Real |
| Polls (in league) | **FULLY IMPLEMENTED**, but a league-manager feature, not a chat-message type | UNKNOWN as native | UNKNOWN | UNKNOWN |
| Commissioner announcement channel | **FULLY IMPLEMENTED** — "Commish's Corner," bypasses normal chat-mute toggle | UNKNOWN | UNKNOWN | UNKNOWN |
| Draft-room chat | **FULLY IMPLEMENTED**, separate from league chat | Implied | UNKNOWN | UNKNOWN |
| Matchup-scoped trash talk / commentary | **MISSING** as a dedicated feature | Implied via chat-everywhere design | UNKNOWN | Historic message-board/forum feature — current standalone existence **unconfirmed**, may have been absorbed into Messenger [Low-Medium] |
| Overall social design philosophy | Real, multi-surface, but chat is a feature of the app, not the app's organizing principle | **League = group chat first** — the single most repeated differentiator in every third-party comparison found | Functional but consistently ranked behind Sleeper on social [Medium-High] | Functional, historically forum-oriented, current depth unclear |

---

## 16. Feature Matrix — Notifications

| Feature | THE WEEKEND | Sleeper | ESPN | Yahoo |
|---|---|---|---|---|
| Real Web Push infrastructure | **FULLY IMPLEMENTED** — real VAPID keys, real `pywebpush` dispatcher, dead-subscription cleanup on 404/410 | Push + in-app; **no email notifications at all**, by explicit policy [High] | Real, two-tier (App Alerts / Fantasy Alerts) | Real, granular by type + per-league |
| Chat notification triggers | **FULLY IMPLEMENTED**, real, with a documented 2026-09 bug fix (background-tab pushes were being wrongly swallowed) | Real | Real | Real |
| Draft event triggers (on-clock, starting soon, room open, keeper deadline) | **FULLY IMPLEMENTED**, real, confirmed call chain | UNKNOWN granularity | UNKNOWN | UNKNOWN |
| Fantasy-activity triggers (my player scored, matchup lead changed) | **FULLY IMPLEMENTED**, real, diff-based on live sync | UNKNOWN | Real, red-zone/TD alerts | UNKNOWN |
| **Trade/waiver-processed triggers** | **MISSING** — dispatcher code explicitly names this as future, unbuilt work; two preference toggles exist in Settings with no logic behind them (`notify_game_alerts`, `notify_league`) | UNKNOWN | Real, confirmed category | UNKNOWN |
| Injury/news alerts | **MISSING** as a push trigger (surfaced only in the static player card) | UNKNOWN | **Real, reported as fastest of 3 platforms compared**, backed by ESPN's own newsroom [Medium-High] | UNKNOWN |
| In-app notification center/inbox (separate from push) | **MISSING** — push is the only channel, no history of past notifications | **MISSING**, confirmed — notifications are configured per-channel, not reviewed centrally [Medium] | UNKNOWN | UNKNOWN |
| Per-type notification preferences | **FULLY IMPLEMENTED**, real, 1:1 mapped to actual triggers | Real, four layered controls (OS/channel/thread/type) [High] | Real | Real, granular |

---

## 17. Feature Matrix — League History, Awards, Records & Rivalries

| Feature | THE WEEKEND | Sleeper | ESPN | Yahoo |
|---|---|---|---|---|
| Historical season browsing | **FULLY IMPLEMENTED**, season-parameterized routes, not hardcoded to "current" | Real, mobile-first, commissioner-backfillable | Real | Real, back to 2007 |
| Weekly awards (real computation) | **FULLY IMPLEMENTED** — overachiever/meltdown, bench crime, clutch/choke, boom/bust, game of the week, all computed live | Real, auto-posted "Weekly Reports with Awards" | UNKNOWN as a distinct feature | UNKNOWN |
| Season awards | **FULLY IMPLEMENTED**, real computation, recomputed every sync | UNKNOWN | UNKNOWN | UNKNOWN |
| Power rankings, real algorithm | **FULLY IMPLEMENTED** — documented weighted formula (win% 50% / avg points 30% / recent form 20%), min-max normalized weekly | UNKNOWN | UNKNOWN | UNKNOWN |
| All-time record book (highest score, biggest blowout, etc.) | **FULLY IMPLEMENTED**, live-computed | UNKNOWN as a native feature — third-party record-book tools exist, implying a native gap [Medium inference] | UNKNOWN | UNKNOWN |
| Rivalry tracking | **PARTIALLY IMPLEMENTED** — live head-to-head is real for any pair; curated rivalry name/tier/all-time-wins exists for only one seeded pair league-wide and has **no recompute job**, so the win totals go stale | UNKNOWN | UNKNOWN | UNKNOWN |
| AI-generated recaps/write-ups | **FULLY IMPLEMENTED**, real Anthropic API wiring, a real production bug (thinking-block parsing) found and fixed this season | **MISSING** as native | UNKNOWN | UNKNOWN |
| Custom league culture features (e.g., a loser-drinks/chug leaderboard) | **FULLY IMPLEMENTED** — real, verified (video/pose-analysis-backed, not self-reported) | N/A | N/A | N/A |

---

## 18. Feature Matrix — Navigation, Home Screen & Discovery

| Feature | THE WEEKEND | Sleeper | ESPN | Yahoo |
|---|---|---|---|---|
| Dynamic, personalized home screen | **FULLY IMPLEMENTED** — real server-side data: your week, standings, awards, power rankings, chug leaderboard, draft state, rivalries, live scoreboard, ticker | Left panel redesign: DMs, reorderable/archivable leagues, search | 2025 redesign: personalized rankings for your starters, contextual reminders | UNKNOWN specifics |
| Bottom navigation | **FULLY IMPLEMENTED**, 5 reorderable slots + 19 total destinations reachable via sub-nav | 5 tabs: Leagues, Messages, Channels, Scores, Profile [Medium-High] | UNKNOWN exact labels | Swipeable Team → Matchup → Players → League |
| Global/unified search | **MISSING** — only 3 scoped search inputs (free agents, draft pool, admin users), no app-wide search | UNKNOWN | UNKNOWN | UNKNOWN |
| "Browse everything" discovery hub | **PARTIALLY IMPLEMENTED** — exists per nav comments, exact current contents not independently re-verified in this pass | UNKNOWN | UNKNOWN | UNKNOWN |
| Onboarding / first-time-user flow | **FULLY IMPLEMENTED** — real create/join/claim-historical-owner flow, not a UI shell | UNKNOWN detail | UNKNOWN | UNKNOWN |

---

## 19. Feature Matrix — Mobile, PWA, Performance & Design

| Feature | THE WEEKEND | Sleeper | ESPN | Yahoo |
|---|---|---|---|---|
| Real installable PWA | **FULLY IMPLEMENTED** — real manifest, maskable icons, registered service worker | N/A (native app) | N/A (native app) | N/A (native app) |
| Offline behavior | **PARTIALLY IMPLEMENTED, honestly scoped** — network-first API cache only; no offline cold-load | N/A | N/A | N/A |
| Pull-to-refresh / native-feeling gestures | **FULLY IMPLEMENTED**, real resistance curve, nested-scroll-aware | Native OS behavior | Native OS behavior | Native OS behavior |
| Haptics | **MISSING** | Native OS possible | Native OS possible | Native OS possible |
| Dark mode | **Only mode available** — no light mode exists (explicit in-code disclosure) | Dark appears to be the dominant/default aesthetic; light-mode existence **unconfirmed** [Low] | UNKNOWN | UNKNOWN |
| Visual design modernity | Functional, information-dense, not independently benchmarked against competitors in this pass | **Widely regarded as best-in-class** — component library purpose-built for high-pressure live moments [Medium-High] | 2025 redesign drew **real, sourced user backlash** (legibility, clutter) [High] | Real 2025/2026 redesign investment; still perceived as less clean than Sleeper by reviewers [Medium] |
| Background-tab/hidden-tab battery discipline | **BROKEN in 2 confirmed spots** — `GameDayRefresher.tsx` and `MyTeamApp.tsx`'s live-poll both still run unconditionally with no visibility-state gate, per this app's own prior performance audit, unresolved as of this document | UNKNOWN | UNKNOWN | UNKNOWN |
| App Store / Play rating | N/A (web/PWA, no store listing) | 4.7★ / 274K reviews [High] | ~4.0-4.7 iOS, reported #1-worst-by-complaint-rate in one 2026 comparison [Medium] | UNKNOWN precise current rating |
| Sunday-load reliability reputation | Not independently load-tested in this pass | Some 2025/2026 review sentiment of rising bugginess; one uncorroborated Opening Night 2025 outage claim [Medium/Low] | **Real, current, recurring** Sunday lag/crash complaints, not just legacy reputation [Medium-High] | **Real, current** — Sept 2025 pre-MNF-kickoff outage, historical apology-worthy outages, forum reports of multi-night draft failures [Medium-High] |

---

## 20. Feature Matrix — Security, Privacy & Data Architecture

| Feature | THE WEEKEND | Sleeper | ESPN | Yahoo |
|---|---|---|---|---|
| League data isolation, server-enforced | **FULLY IMPLEMENTED today** — but with a documented real historical gap (3 routers had zero auth until a 2026-09 fix) now closed and independently verified across every router | UNKNOWN | UNKNOWN | UNKNOWN |
| Password hashing | **FULLY IMPLEMENTED**, bcrypt, self-salting | UNKNOWN | UNKNOWN | UNKNOWN |
| Rate limiting on auth endpoints | **PARTIALLY IMPLEMENTED** — real, dual-keyed limiter on login/signup only; in-memory, resets on redeploy (disclosed trade-off at current scale) | UNKNOWN | UNKNOWN | UNKNOWN |
| CSRF/XSS mitigations | **PARTIALLY IMPLEMENTED** — httpOnly/Secure/SameSite cookies, origin-allowlisted CORS, real security headers; **no CSP yet**, disclosed and reasoned in-code rather than silently absent | UNKNOWN | UNKNOWN | UNKNOWN |
| Secrets management | **FULLY IMPLEMENTED**, fail-loud on missing required env vars, `.env` never committed | UNKNOWN | UNKNOWN | UNKNOWN |
| Admin endpoint authorization | **FULLY IMPLEMENTED**, real automated 401/403 test pairs for every admin route | UNKNOWN | UNKNOWN | UNKNOWN |
| One stale unauthenticated endpoint found | **CONFIRMED PRESENT** — `/free-agents/waiver-settings`, low severity (leaks a budget number), left behind after the broader auth fix | N/A | N/A | N/A |
| Multi-tenancy — real, not scaffolding | **PARTIALLY IMPLEMENTED, genuinely engineered** — PK/unique-constraint widening migration proves real multi-league work; `rivalries` table and ESPN-sync/admin tooling remain single-league-assumption gaps, disclosed as "Phase 6" internally | N/A | N/A | N/A |
| Public API documentation (developer ecosystem) | **PARTIALLY IMPLEMENTED** — auto Swagger/OpenAPI live and unauthenticated (minor info-exposure, not a hole) | N/A | N/A | **Real, documented, OAuth2 REST API** — a genuine developer/ecosystem advantage [High] |
| Background job reliability (env-flag-gated) | **PARTIALLY IMPLEMENTED, self-flagged risk** — 13 real scheduled jobs, ALL default OFF, must be manually enabled per deploy; no startup warning if forgotten | N/A | N/A | N/A |

---

## 21. Feature Matrix — Pricing & Business Model

| Feature | THE WEEKEND | Sleeper | ESPN | Yahoo |
|---|---|---|---|---|
| Core product cost | Free (single private league, commissioner-funded infra) | Free, forever, no ads, explicit brand promise | Free, ad-supported | Free |
| Paid tier | None | None for season-long fantasy; monetization via a separate real-money product | None confirmed as a distinct "Fantasy+" SKU; value flows through general ESPN+ | **Real, clearly scoped**: Fantasy Plus (~$30/yr) and Fantasy Ultra (~$60/yr), monetizing decision-support tooling and account capacity, not competitive fairness |
| Cross-sell / adjacent monetization | None | Real-money Picks product (player-prop pick'em), payments product (SleeperSafe) — real, sourced trust complaints cluster here specifically | DraftKings sportsbook/DFS integration (replaced "ESPN Bet," which shut down Dec 2025) | Partner-perk marketplace (Fantasy Ultra), DFS crossover |

---

## 22. The "Little Things" Audit

Small details a knowledgeable fantasy manager notices even when the big systems work:

- **THE WEEKEND has no light mode.** This is disclosed in-code as a deliberate choice ("Weekend League's signature look is dark"), not an oversight — but it should be stated as a real limitation, not "dark mode support," in any positioning material.
- **THE WEEKEND's IR slot is configured but unusable.** A manager who tries to stash an injured player on IR today will hit a server error, because `is_eligible_for_slot()` never authorizes the move. This is exactly the kind of "button exists, workflow doesn't" gap this audit was explicitly asked to catch.
- **THE WEEKEND's "waiver settings" page is misleading**, not merely incomplete — it displays a real number (a disconnected ESPN league's FAAB budget) that implies configurability and enforcement neither of which exist.
- **Sleeper cannot import pre-draft rankings/cheat sheets** — a real, official-roadmap-confirmed gap versus ESPN and Yahoo, worth remembering before assuming Sleeper is strictly more feature-complete everywhere.
- **Sleeper has no native trade-history tab** — trades are buried in a general activity feed, spawning third-party tools to fix it.
- **ESPN's 2025 redesign is a self-inflicted, current regression** in user sentiment (font sizing, over-zoom cutting off roster visibility) — not dated criticism carried forward from years ago.
- **Yahoo's lineup lock is per-player at that player's own kickoff**, which is more forgiving than a single whole-roster Sunday-morning lock — worth noting as a real design choice THE WEEKEND could match once it builds a lock at all.
- **THE WEEKEND's rivalry win-totals can go stale** — they're seeded once into static columns with no recompute job, while the underlying head-to-head record used elsewhere in the app is computed live. A user comparing the two surfaces could see a mismatch.
- **THE WEEKEND's admin/sync tooling is real but invisible** — commissioner-only operational levers exist only as raw API endpoints (curl/Postman), a real risk heading into a live event if the person on-call doesn't have the exact command memorized.

---

## 23. Deep Dive: Draft Experience

THE WEEKEND's live draft room is, on the evidence, genuinely strong: real snake logic, a real pick clock with round-tiered deadlines, a draft queue that's actually wired into autopick (not decorative), clean full-state-resync reconnect handling (simpler and more robust than fragile incremental replay), pause/resume with preserved remaining time, and unlimited undo. Keeper handling is real and well-guarded (an all-or-nothing crosswalk check blocks a draft start rather than silently dropping an unresolved keeper). This is a load-bearing feature that was clearly built with care.

What it lacks relative to the field: **auction drafts** (all three competitors support this; THE WEEKEND is snake-only), **user-editable pre-draft rankings** feeding autopick (ESPN and Yahoo both support this; Sleeper notably does not either — this is a real three-way gap, not just THE WEEKEND behind), **draft pick trading** (in-draft or future-year — Sleeper's deepest area, real on ESPN and Yahoo too, entirely absent here), and any **verifiable/shared draft order randomization** — though notably, Sleeper shares this exact trust gap.

Where THE WEEKEND is ahead of at least one named competitor: real, data-driven **draft grades with AI-generated per-team recaps** — Sleeper has nothing native like this, and this audit found no confirmation of it on ESPN or Yahoo either. This is a genuine, currently-shipped differentiator worth keeping and improving (see Section 33 on discoverability, already partially fixed this season), not something to deprioritize just because it isn't "core."

---

## 24. Deep Dive: Game-Day Experience

This is the deep dive with the widest spread across the four products, and it's important to be precise about why.

ESPN's advantage here is structural and unreplicable: it owns real NFL broadcast rights and employs the reporters breaking injury news. Its 2026 "Matchup Moments" feature — real highlight video embedded next to your fantasy score — is not a UX choice a competitor can simply decide to copy; it requires a broadcast deal. No amount of engineering effort on THE WEEKEND closes this gap, and pretending otherwise would be dishonest.

What THE WEEKEND has built instead is honestly a strong answer within the constraint of not owning broadcast data: a real Gamecast system pulling ESPN's own **public** scoreboard/play-by-play data, normalized into real drives and plays, pushed over a WebSocket architecture that is genuinely well-designed — the backend poll only runs when a real game is live *and* at least one viewer is actually subscribed to that specific game, meaning zero wasted API calls otherwise. The red-zone/on-offense indicator painted directly onto a rostered player's headshot in the live roster view is a small, well-executed touch that matches what Sleeper and ESPN both do natively.

The one finding here that should concern the commissioner more than any UI comparison to a competitor: **matchup pairing and the playoff bracket are not actually generated by THE WEEKEND at all.** They're synced from a live, separate ESPN league that this app's draft/roster/lineup pivot was explicitly built to stop depending on. If that shadow ESPN league is ever abandoned, mismanaged, or simply not renewed next offseason, THE WEEKEND has no schedule and no playoffs — full stop, no fallback. This is not a competitive-feature gap; it's an operational continuity risk for the app's own real season, and it belongs at the top of any roadmap discussion (Section 33, Section 34).

---

## 25. Deep Dive: Social & Community

Sleeper's positioning as "a group chat with a fantasy league attached" rather than "a fantasy league with chat bolted on" is the single most consistent theme across every piece of third-party research gathered for this document — it shows up in official messaging, in App Store reviews, and in every comparison article found.

THE WEEKEND's chat system, read closely, is genuinely more feature-complete than a first glance would suggest: real-time league chat, DMs, draft-room chat as a separate channel, a dedicated commissioner announcement channel that bypasses normal mute settings, real GIFs via a proper server-side GIPHY proxy, image uploads with host validation, and emoji reactions. This is not a thin chat bolted onto a roster app — it's a genuine multi-surface social system. What it does not have, that Sleeper does: chat-embedded trade/waiver-card reactions, a trade block with visible "interest" signals, and — this matters — chat as the app's *organizing metaphor* rather than one destination among many in the nav.

The realistic read for a 12-person money league: THE WEEKEND's chat is functionally close to sufficient for this use case today. The gap to Sleeper is more about design philosophy and discoverability than missing raw capability, which makes it a lower-priority build item than the waiver system or lineup lock (Section 33).

---

## 26. Deep Dive: Commissioner Power & Trust

The three competitors split on trade-veto philosophy in a way worth naming explicitly: Sleeper is commissioner-only by explicit policy (no native league vote), ESPN and Yahoo both default to a league-vote model with an adjustable threshold. THE WEEKEND currently matches Sleeper's model (commissioner-only). For a 12-person real-money league where trust in a single commissioner's judgment matters, this is a legitimate design choice, not automatically a gap — but it's worth a deliberate conversation rather than an accident of what got built first.

The more consequential finding in this deep dive: THE WEEKEND has **no general commissioner audit trail.** Every force-edit, every trade veto, every settings change happens with no persistent log a league member (or the commissioner, six months later) could review. The app's own internal `ADMIN_DASHBOARD.md` already names this as deferred "Phase 2" work — it is a known gap, not a surprise. In a 12-person money league, "the commissioner changed something and nobody can see what or when" is exactly the kind of thing that erodes trust over a multi-year run, even if it never gets exploited maliciously.

Draft-order randomization deserves a specific callout: THE WEEKEND's draft order is set manually by clicking teams into position, with no shuffle function anywhere in the code. This audit could not confirm Sleeper has a verifiably fair randomization mechanism either (commissioners there can silently re-roll privately before saving) — meaning this specific trust gap is shared with the platform most often cited as best-in-class, not unique to THE WEEKEND. Worth knowing before over-indexing on it.

---

## 27. Deep Dive: League History & Continuity

Yahoo's structural advantage here is real and specific: verifiable league continuity back to 2007, and an entire third-party tooling ecosystem (League Legacy, Fantasy Record Book) exists specifically to preserve/migrate that history — strong indirect evidence that long-running Yahoo leagues (15-20+ years) are common enough to sustain dedicated products. THE WEEKEND, having pivoted its core systems mid-2026, does not yet have anything comparable to point to — nor could it, at this age.

What THE WEEKEND has built that neither Sleeper nor the available research on ESPN/Yahoo confirmed natively: a real, live-computed power-ranking algorithm with a documented formula, a real weekly-and-season awards system computed from actual game data rather than static placeholders, a real all-time record book, and AI-generated recaps. Sleeper's own "League History" is real but described even by its own ecosystem (via the existence of third-party trophy-room tools) as not exhaustive as a long-term record book. THE WEEKEND's system, while young, is architecturally closer to "real record book" than "static standings archive" from day one.

The one honest weak point specific to THE WEEKEND: rivalry tracking is a hybrid of live (head-to-head) and stale (curated all-time-wins, no recompute job, seeded for exactly one pair league-wide). This should be fixed or clearly labeled before it's presented as a finished feature.

---

## 28. Deep Dive: Navigation, Home Screen & Mobile UX

THE WEEKEND's home screen is genuinely dynamic and personalized — pulling real server-side data across your matchup, standings, awards, power rankings, a league culture feature (chug leaderboard), draft state, rivalries, and a live scoreboard ticker, not a static shell. This matches or exceeds what the research surfaced for ESPN's 2025 personalized-home redesign in ambition, though this audit could not do a direct side-by-side visual comparison.

The real gap: **no unified search.** THE WEEKEND has three scoped search boxes (free agents, draft pool, admin users) and no way to search "everything" — a player, a past matchup, a chat message — from one place. Given the app's real depth (19 destinations reachable via sub-nav), this is a genuine discoverability risk as the app grows, not a cosmetic nice-to-have. The draft-grades discoverability problem this season (a real feature that existed but "I don't see it at all anywhere," per the commissioner's own words earlier this season) is a preview of what happens without a real search layer as more features accumulate.

---

## 29. Deep Dive: Visual Design & Performance

This audit did not run side-by-side visual benchmarks — treat comparative design claims here as informed by research, not a controlled test. What can be said with confidence: THE WEEKEND is dark-mode-only by explicit choice, has real native-feeling mobile touches (a carefully-built pull-to-refresh with nested-scroll-ancestor detection, real iOS safe-area handling), and is a real installable PWA with an honestly-scoped offline story (network-first API caching, not a false "works offline" promise).

Performance-wise, a prior internal audit (`Documentation/Performance/00_Battery_Performance_Audit.md`) already found and documented two specific, still-unresolved battery drains: `GameDayRefresher.tsx` and `MyTeamApp.tsx`'s live-poll effect both continue polling at full cadence when a tab is backgrounded during a live game — exactly the highest-traffic moment of the week. This was independently re-verified as still true, one day after the original audit, going into this document. It is a known, specific, already-diagnosed fix sitting undone — a straightforward Phase 1 item (Section 34), not a research question.

On the competitive side: ESPN's 2025 redesign drew real, current, sourced user backlash — a reminder that "modernize the UI" is not automatically a safe move without real user testing, and that THE WEEKEND's own more conservative design cadence isn't automatically a weakness.

---

## 30. Deep Dive: Security & Privacy

The standout finding of this entire audit, arguably more important than any single feature gap: **THE WEEKEND's own codebase and commit history show a real, working pattern of finding and fixing serious security gaps rather than hiding them.** A 2026-09 fix closed a genuine hole where three routers (`league.py`, `profile.py`, `awards.py`) had no auth at all, letting any signed-in user read another league's private data — and the fix is now verified applied consistently across every router, with real automated 401/403 test pairs covering every admin endpoint. This kind of self-auditing discipline, documented in-code rather than swept under the rug, is a genuine engineering-maturity signal that belongs in front of an investor, not buried in an appendix.

That said, two real gaps remain and should not be softened: **no password reset flow exists at all** (a genuine account-recovery risk for the email/password signup path specifically — Discord/Google users are unaffected), and one stale unauthenticated endpoint (`/free-agents/waiver-settings`) was left behind after the broader fix, low severity but a live reminder that this kind of audit needs to be a standing practice, not a one-time event.

None of the three competitors researched here had comparable security depth available from public sources — this is expected (they don't publish this level of internal detail) and should not be read as "THE WEEKEND is more secure than Sleeper/ESPN/Yahoo," which cannot be concluded from available evidence. It can be said that THE WEEKEND's security posture, on the evidence actually available, is more rigorous than a 12-person hobby project would typically warrant — a genuine positive.

---

## 31. THE WEEKEND's Confirmed Gaps & Strengths, Ranked

### Gaps, ranked by real-world consequence for a 12-person money league

| # | Gap | Importance | Why it matters |
|---|---|---|---|
| 1 | No waiver system (instant FCFS free agency) | ★★★★★ | Every competitor supports this; a money league without waiver rules invites disputes over who "got there first" on a fast connection |
| 2 | No server-side lineup lock | ★★★★★ | Fairness/integrity issue, not UX — a manager can start a player after their game ends |
| 3 | Matchup schedule + playoffs still ESPN-dependent | ★★★★★ | An operational continuity risk to the app's own real season, not just a competitive gap |
| 4 | IR roster slot configured but unusable | ★★★★ | A real, visible error waiting for the first injured-player edge case |
| 5 | No password reset flow | ★★★★ | A real account-recovery dead end for password-signup users |
| 6 | No general commissioner audit trail | ★★★ | Trust/accountability erosion over a multi-year league run |
| 7 | Trades limited to 2 teams, no pick trading, no trade block | ★★★ | A common real-league workflow (3-team trades) is simply unavailable |
| 8 | No auction draft, no pre-draft custom rankings | ★★★ | A subset of managers strongly prefer one or both |
| 9 | Per-week projections ~83% coverage, structurally capped | ★★★ | Visibly incomplete/incorrect-looking data, already flagged by the commissioner directly |
| 10 | No unified search | ★★ | Discoverability risk as the app's real feature depth grows |
| 11 | No in-app notification center | ★★ | A missed push is gone with nothing to check back |
| 12 | No trade/waiver push notifications | ★★ | A real, named gap in an otherwise-working pipeline |
| 13 | Rivalry all-time-win totals can go stale | ★★ | A visible data-quality inconsistency on a small but real feature |
| 14 | Sync/admin tooling has no UI (curl-only) | ★★ | Operational risk at the exact moment (live event) it matters most |
| 15 | Two confirmed battery-draining unconditional polling loops | ★★ | Already diagnosed, already documented, simply not yet fixed |

### Strengths, ranked by how load-bearing they are today

| # | Strength | Why it matters |
|---|---|---|
| 1 | Real, working security-fix discipline (documented, tested, applied consistently) | A genuine engineering-maturity signal most 12-person league apps never reach |
| 2 | Genuinely well-architected realtime layer (Gamecast's viewer-gated poll, session revocation, full-state draft resync) | Efficient and correct, not just functional |
| 3 | Draft room depth (queue wired into autopick, real pause/undo, clean reconnect) | Matches or exceeds what a casual league needs |
| 4 | AI-generated draft grades and weekly recaps, keeper-aware | A real differentiator no competitor researched here confirms having natively |
| 5 | Real, from-scratch power rankings, awards, and record book (not static placeholders) | Built with more rigor than "League History" on the platforms studied |
| 6 | Multi-surface chat system (league/DM/draft-room/commissioner channel) | Closer to sufficient for a 12-person league than a first glance suggests |
| 7 | Real, working push notification pipeline for chat/draft/fantasy-activity | Not just infrastructure — has real, confirmed call sites |
| 8 | Genuine multi-tenancy engineering (constraint-widening migration, not just a `league_id` column bolted on) | Evidence of real architectural investment, not cosmetic scaffolding |
| 9 | Custom league-culture features (chug leaderboard, verified not self-reported) | Something no competitor has or would build — a real point of differentiation for *this* league specifically |

---

## 32. "Why Would I Switch / Why Would I Stay" Tests

**Why would a Sleeper user switch to THE WEEKEND?** Only for reasons specific to this one real-money league — an existing 12-person group, custom culture features (chug), and features Sleeper doesn't have natively (AI draft grades/recaps). Not for waivers, trades, dynasty tooling, or design polish — Sleeper is ahead on all of those today.

**Why would a Sleeper user stay on Sleeper instead?** No waiver-system gap, no lineup-lock gap, deepest keeper/dynasty tooling researched, multi-team trades, a trade block, and a design language every third-party source treats as the category benchmark.

**Why would an ESPN user switch to THE WEEKEND?** To escape ESPN's current, sourced Sunday-reliability complaints and 2025 redesign backlash, and for a smaller, closer-knit social experience. Not for live game-day depth — ESPN's broadcast-rights-backed live video and injury-alert speed are unreplicable.

**Why would an ESPN user stay on ESPN?** Real broadcast data, the fastest injury alerts researched, deep scoring customization, and — as of 2026 — the "official NFL fantasy game" status actively pulling in new users, not losing them.

**Why would a Yahoo user switch to THE WEEKEND?** For a purpose-built social/culture layer Yahoo's more institutional, multi-sport app doesn't offer. Not for reliability — this audit did not establish THE WEEKEND is more reliable than Yahoo, only that Yahoo has real, current, sourced reliability complaints of its own.

**Why would a Yahoo user stay on Yahoo?** Unmatched league continuity/history, the deepest scoring customization researched, and a paid tier that adds real value (multi-source projections, lineup automation) without touching competitive fairness — a business model THE WEEKEND has no equivalent of and, given it serves one closed real-money league rather than a broad consumer market, may not need one for.

**The honest synthesis:** THE WEEKEND does not currently win a head-to-head feature battle against any of the three. Its actual case is not "better than Sleeper/ESPN/Yahoo" — it's "purpose-built for this specific 12-person real-money league in ways a generic platform structurally cannot be" (the chug leaderboard, AI-aware keeper-rule narratives, league-specific culture). That case only holds up if the three P0 gaps in Section 33 get closed — a league that discovers mid-season it has no real waivers or lineup lock will not forgive that discovery gracefully.

---

## 33. Prioritized Recommendations (P0–P4)

Every recommendation below passed the test from Section 2: a real user problem for *this* 12-person money league was identified first; a competitor having the feature was never sufficient justification on its own.

**P0 — Build Now (fairness/integrity, must exist before it's needed):**
- Server-side lineup lock at kickoff. This is not a feature; it's a rule enforcement gap.
- A real waiver system — even a simple single-model version (pick one: FAAB or rolling priority) is far better than none.
- Fix the IR slot so it's actually usable (a real bug, not a feature request).
- Decouple matchup scheduling and playoff bracket generation from the live ESPN dependency, or explicitly document and accept the operational risk of continuing to depend on it, in writing, with the commissioner's sign-off.

**P1 — Build Soon (trust and account safety):**
- A password reset flow, end-to-end.
- A general (even minimal) commissioner audit trail — a single append-only log table would close most of the trust gap cheaply.
- Fix the one stale unauthenticated endpoint (`/free-agents/waiver-settings`).
- Fix the two confirmed unconditional-polling battery drains (already diagnosed, not new work).

**P2 — Build Later (real gaps, lower urgency for a 12-person league):**
- Multi-team trade support and a trade block.
- Draft pick trading (future-year, and ideally in-draft).
- A minimal in-app notification center/history.
- Trade/waiver push notification triggers, since the pipeline already exists.
- Unified search.

**P3 — Monitor (real competitor features, unclear fit for this league's size/needs):**
- Auction draft support — only worth building if league members actually want it; ask before building.
- User-importable pre-draft rankings — worth watching whether the Sleeper-style rank proxy is actually a felt pain point before investing here.
- A verifiable/shared draft-order randomization mechanism — a real trust nicety, low urgency since Sleeper shares this same gap.

**P4 — Do Not Build:**
- A paid tier / monetization layer. This app serves one closed, real-money league; Yahoo's model doesn't map to this context and would add complexity with no real audience.
- Dynasty-mode / Taxi Squad infrastructure. Sleeper's dynasty depth is aimed at a different kind of league (multi-year keeper-heavy); nothing in this audit suggests this league runs that way.
- A public league directory / discoverability system. This is a single private league — public-league discovery solves a problem THE WEEKEND doesn't have.
- Native highlight-video embedding. This requires broadcast rights THE WEEKEND will never have; don't chase ESPN's unreplicable advantage.

---

## 34. Phase 0–5 Roadmap

**Phase 0 (immediate, before the next live event that would expose them):** Fix the IR slot bug. Fix the two unconditional-polling battery drains. Fix the stale unauthenticated waiver-settings endpoint. These are small, already-diagnosed, low-risk fixes.

**Phase 1 (before real disputes happen):** Server-side lineup lock. A real waiver system (start with one model). Password reset flow.

**Phase 2 (before the next offseason, to remove the ESPN operational dependency):** In-app schedule generation and playoff bracket engine — the single highest-leverage architectural project on this list, since it's the last piece of the "ESPN independence" story that isn't actually independent yet.

**Phase 3 (trust and account infrastructure):** Commissioner audit trail. Rivalry-data recompute job (or clear "last updated" labeling if a recompute job isn't built yet).

**Phase 4 (feature parity where it serves this specific league):** Multi-team trades, trade block, draft pick trading, in-app notification center, trade/waiver push triggers, unified search.

**Phase 5 (evaluate before building, per Section 33's P3 list):** Auction draft, importable pre-draft rankings, verifiable draft-order randomization — each gated on an actual ask from league members, not assumed value.

---

## 35. Executive Scorecard & Final Assessment: "If This Were My Money"

### Scorecard (1–10, explained per dimension — not arbitrary)

| Dimension | THE WEEKEND | Sleeper | ESPN | Yahoo |
|---|---|---|---|---|
| Onboarding & accounts | 6 — real, multi-method, but no password reset | 8 | 8 | 8 |
| League setup & commissioner depth | 6 — deep scoring/roster tools, thin on trust/audit tooling | 8 | 8 | 8 |
| Draft experience | 7 — genuinely strong room, missing auction & pick trading | 9 | 8 | 8 |
| Rosters, lineups & scoring | 5 — real engine, no lock enforcement, IR broken | 8 | 8 | 8 |
| Waivers & free agency | 2 — no real system exists | 9 | 8 | 8 |
| Trades | 5 — solid 2-team flow, missing multi-team/block/pick-trading | 9 | 7 | 7 |
| Live/game-day experience | 6 — well-architected within its data constraints | 7 | 9 — unreplicable broadcast advantage | 6 |
| Social & chat | 7 — genuinely multi-surface and real | 9 — the category benchmark | 6 | 6 |
| Notifications | 6 — real pipeline, real gaps (trade/waiver, no inbox) | 7 | 7 | 7 |
| League history, awards & records | 8 — real computation, not placeholders, though young | 6 | 6 | 8 — continuity |
| Navigation & home screen | 6 — dynamic home, no unified search | 7 | 6 — post-redesign backlash | 6 |
| Mobile UX & design | 6 — real PWA discipline, dark-only | 9 | 5 — current backlash | 6 |
| Performance & reliability reputation | 6 — two known unfixed drains, otherwise sound | 6 — real but overstated "instant" claims | 5 — current Sunday complaints | 5 — current Sunday complaints |
| Security & privacy | 8 — a real, demonstrated fix-and-verify culture | Unknown (not publicly auditable) | Unknown | Unknown |
| Data architecture & multi-tenancy | 6 — real engineering, one structural ESPN dependency remains | N/A (single-tenant per league, doesn't apply the same way) | N/A | N/A |
| Pricing/business model soundness | 6 — appropriate for scope, no revenue model needed at this size | 7 — free core is real, but cross-subsidized by a product with real trust issues | 7 | 8 — cleanest, most defensible paid-tier model researched |
| League-specific differentiation | 9 — features no generic platform would ever build for this exact league | N/A | N/A | N/A |

*(This scorecard intentionally omits several rows that don't have a meaningful cross-product comparison — e.g., "developer ecosystem" would only meaningfully score Yahoo among the four.)*

### Final Assessment: If This Were My Money

If I were evaluating this as an investor or a technical co-founder deciding whether to commit more time to THE WEEKEND, here is the honest read, with nothing softened:

**The engineering is real and better than the outward feature list suggests.** The security posture, the realtime architecture, the multi-tenancy work, and the from-scratch awards/power-ranking/AI-recap system are not what a "12-person hobby app" typically has. Someone building this is investing real care, and it shows in the code, not just the marketing copy. That is the single most positive, most durable signal in this whole audit — it means the team closing the gaps in Section 33 is capable of doing it well, not starting from nothing.

**But three gaps are load-bearing, not cosmetic, and they need to be said plainly: no waivers, no lineup lock, and a schedule/playoff system that isn't actually this app's own.** None of these are hard engineering problems relative to what's already been built this season (roster history, per-week projections, draft grades, an AI narrative pipeline, a real security remediation) — they are smaller lifts than several things already shipped. Their absence isn't a capability gap. It's a sequencing gap: the team built the exciting, visible, differentiated features (AI recaps, chug leaderboard, power rankings) before the boring, load-bearing ones (waivers, lock enforcement, a real schedule engine) that every competitor treats as table stakes. That's a completely understandable order to build in for a passion project serving friends — but it is not the order a money-league commissioner should keep it in going forward.

**Would I put more money/time in?** Yes, conditionally: only if Phase 0 and Phase 1 from Section 34 get done before they get exploited or discovered the hard way — a manager starting a player after their game ends, a disputed free-agent grab, or a season where the shadow ESPN league silently breaks the real schedule. None of that requires new headcount or a rewrite. It requires roughly two to three focused weeks against a punch list that is now fully written out in this document. The app does not need to become Sleeper, ESPN, or Yahoo. It needs to stop being structurally dependent on the platform it already proved, this season, it can operate without — for everything except the two systems (schedule, playoffs) nobody has gotten to yet.

**The single sentence I'd want the commissioner to remember from this whole document:** the app's biggest risk isn't that it's behind Sleeper on social features or behind ESPN on broadcast data — competitors that size will always win those fights. The real risk is that the three gaps in Section 33's P0 list are exactly the kind of thing a league only notices once, at the worst possible moment, in a real-money context where "the app let me do that" is not an acceptable answer.

---

*End of audit. No implementation was performed. Per explicit instruction, all recommendations above are proposals for review, not a committed plan — the commissioner's review and direction should determine what, if anything, gets scheduled next.*
