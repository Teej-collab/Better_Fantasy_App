# TODO.md — Roadmap

Status key: `[ ]` not started · `[~]` in progress · `[x]` done

This is a living document — update it as phases complete or plans change.
Phases roughly match the master engineering prompt, adjusted based on what
Phase 0 discovery actually found.

---

## PHASE 0 — DISCOVERY
- [x] Inspect Fantasy_Helper codebase (tech stack, architecture, DB schema,
      real vs. stub components)
- [x] Write PROJECT_STATE.md, ARCHITECTURE.md, MIGRATION_MAP.md, TODO.md
      (PRODUCT_REQUIREMENTS.md, CLAUDE.md, DEVELOPMENT.md were referenced by
      an earlier audit pass but not carried over — proceeding without them
      per your call on Aug 18 2026)
- [x] You review this audit and approve/adjust the proposed architecture and
      tech stack before Phase 1 starts — approved as proposed (FastAPI +
      Next.js + Postgres), Aug 18 2026

## PHASE 1 — ARCHITECTURE / FOUNDATION
- [x] Confirm tech stack decisions from ARCHITECTURE.md (FastAPI + Next.js +
      Postgres) — approved
- [x] Create `Better_Fantasy_App` repo structure (`backend/`, `frontend/`)
- [x] Set up local dev environment on your Mac (installed nvm + Node LTS,
      Python venv) — see DEVELOPMENT.md, which also documents the Windows
      equivalent commands
- [x] `.env.example` + `.gitignore` for the new repo (same discipline as
      Fantasy_Helper's config pattern — fail-loud required env vars, no
      secrets committed)
- [x] Confirmed: real historical league data already exists in Supabase.
      Backend connects to that same project, read-only until schema changes
      are explicitly approved (decision made Aug 18 2026)

## PHASE 2 — BACKEND FOUNDATION
- [x] FastAPI project skeleton, health-check endpoint (`GET /health`,
      dependency-injected DB pool so it's testable)
- [x] Async Postgres connection (asyncpg, matching existing pattern)
- [x] Port `db/schema.sql` into the new repo, add `users`/auth table —
      done as Alembic migrations, not applied to production (see below)
- [x] Decide on migration tool — **Alembic**, chosen Aug 19 2026. Raw SQL
      via `op.execute()`, no ORM/autogenerate, matching the project's
      existing asyncpg-only style. Migration chain verified end-to-end
      (upgrade head + downgrade base) against a disposable local Postgres.
- [x] Basic automated test setup (pytest) — 3 tests passing, including a
      real integration test of `/health` against a local Postgres. Domain
      logic itself isn't ported yet (that's Phase 6), so there's no domain
      test suite yet — this is the infrastructure for one.

**Not done, and deliberately not done:** the two migrations
(`f8b66c486a5e_baseline_schema`, `3d2a7cf84eb9_add_users_table`) have only
been run against a local throwaway Postgres, never against the real
Supabase database. Applying them there — starting with
`alembic stamp f8b66c486a5e` — is a one-time production step that needs
your explicit go-ahead, not something to do automatically. See
DEVELOPMENT.md's Migrations section for the exact command sequence.

**Correction, Aug 19 2026:** the baseline migration originally ported
`db/schema.sql` verbatim, as this phase's checkbox said. A later read-only
check against the real production database (Phase 3) found that file was
stale — production has 6 extra tables and several extra columns
`schema.sql` never documented. The baseline migration has been corrected
to match the live schema; see Phase 3 below and DEVELOPMENT.md for the
full list of what was missing.

The `users` table added here is intentionally minimal (`id`, `email`,
`created_at` — no password/OAuth columns yet) since the actual auth
mechanism is still a Phase 5 decision per ARCHITECTURE.md. `owners.user_id`
links a web login to a league-owner record once someone signs up.

## PHASE 3 — ESPN INTEGRATION (read-only first)
- [x] Port `sync_teams.py` / `sync_matchups.py` / `sync_rosters.py` behind a
      `FantasyProvider` interface — logic unchanged, verified against fake
      ESPN responses + real local Postgres (`tests/test_espn_adapter.py`)
- [x] Confirm your `ESPN_S2`/`ESPN_SWID` cookies are current and valid —
      confirmed Aug 19 2026: connected to the real league (ID 2027626914)
      and pulled all 12 real team names. Read-only ESPN API call, no
      database involved.
- [x] Backend endpoint to trigger a manual sync (admin-only) — `POST
      /admin/sync`, gated by a shared-secret `X-Admin-Token` header
      (`ADMIN_SYNC_TOKEN` env var) as a stopgap until real auth in Phase 5
- [x] Scheduled sync job (replaces in-process discord.ext.tasks loop) —
      APScheduler inside the backend process, **off by default**
      (`ENABLE_ESPN_SYNC_SCHEDULER=true` to turn it on)

**Production DB work in progress, Aug 19 2026** — `DATABASE_URL` is now
set to the real Supabase pooler connection string (the direct
`db.<ref>.supabase.co` host is IPv6-only and didn't resolve on this
network; switched to the pooler string, and `app/db.py` now passes
`statement_cache_size=0` since transaction-mode pgbouncer doesn't support
asyncpg's prepared statements — see DEVELOPMENT.md). Step 1 of the plan
(read-only schema comparison) is done and found real drift — see the
Phase 2 correction note above and DEVELOPMENT.md's Migrations section for
the full list. The baseline migration has been corrected and re-verified
locally (upgrade + downgrade clean against a fresh local Postgres,
19 tables match production's 17 + `users` + `alembic_version`). A live
read-only `/health` check against production Supabase itself succeeded.

**Done, with explicit go-ahead:** (1) `alembic stamp f8b66c486a5e` run
against production Aug 19 2026 — confirmed via a fresh read-only table
count (18 tables: the original 17 + Alembic's own tracking table, `users`
correctly absent) that this only recorded history and changed nothing.

**Done, with explicit go-ahead:** (2) `alembic upgrade head` run against
production Aug 19 2026 — added the real `users` table and
`owners.user_id` column. Verified immediately after: 19 tables (18 +
`users`), `users` columns correct (`id`/`email`/`created_at`),
`owners.user_id` present, and all 16 existing `owners` rows untouched.

**Done, with explicit go-ahead:** (3) real ESPN sync run against
production Aug 19 2026 — all 4 seasons (2023-2026), all 3 steps each,
zero failures. Final state: 48 teams, 354 matchups, 10,078 roster rows,
16 owners (unchanged — all matched existing records via upsert, none
duplicated). Season 2026 correctly has 0 roster rows (season hasn't
started) but 78 matchups (the published schedule).

**Phase 3 is fully complete.** All three "not done" items above are now
done, each with its own explicit go-ahead as planned.

**Correction, Aug 19 2026:** real `ESPN_S2`/`SWID`/league ID were briefly
added to `backend/.env.example` (the committed template) instead of
`backend/.env` (gitignored). Caught before anything was committed or
pushed — moved to `.env`, `.env.example` restored to placeholders. Worth
double-checking which file's meant for secrets before pasting real
values into either one going forward.

## PHASE 4 — CORE APPLICATION (read-only views)

**Scoping correction, Aug 19 2026:** this phase's original wording said
pages would be "backed by ported stats_engine functions" — but
stats_engine porting (luck score, power rank, awards) is explicitly Phase
6 work, not done yet. Built these pages against the raw synced data
instead (teams/matchups/rosters, standings via plain win/loss
aggregation in `app/queries/league.py`) — real, working, just not the
fancier computed stats. Those get layered on in Phase 6 without needing
to redo these pages.

- [ ] Auth: basic login — still not done, still a Phase 5 decision per
      ARCHITECTURE.md. Not attempted here to avoid pre-deciding it.
- [x] Dashboard, Standings, League, Team, Matchup pages — built and
      verified against real production data (curl-based verification;
      no browser tooling was available this session — see note below).
      **"My Team" became "Team" (browsable by ID)** since there's no
      login yet to know whose team is "mine" — trivial to personalize
      once Phase 5 lands.
- [x] Backend: `GET /seasons`, `/seasons/{s}/teams`, `/seasons/{s}/standings`,
      `/seasons/{s}/weeks/{w}/matchups`, `/matchups/{id}`, `/teams/{id}`,
      `/teams/{id}/roster` — all public, no auth, appropriate for a single
      private league's own data. Covered by 6 new integration tests
      (`tests/test_league.py`) against real local Postgres.
- [x] CORS enabled (`CORS_ALLOWED_ORIGINS`, defaults to the local Next.js
      dev origin).

**Verification note:** Claude in Chrome wasn't connected this session, so
pages were verified via `curl` against both local dev servers (backend on
real production data, frontend calling it) — confirmed 200s, correct real
data (team names, owner names, scores) present in the rendered HTML, and
clean server logs on both sides. That's request/response-level
verification, not a visual check — worth an actual look in a browser
before treating the UI itself (layout, responsiveness, dark mode) as
confirmed. No custom design pass was done; pages are plain functional
Tailwind.

**Known minor issue, not fixed:** the Dashboard defaults to the
numerically latest season (2026), which hasn't started yet, so its "Top
3" widget shows an (now correctly) 0-0-0 tie among all teams, with
arbitrary ordering. Not broken, just not the most useful default — worth
revisiting (e.g. default to the most recent season with actual games)
when picking this back up.

**Bugs found and fixed from real user feedback, Aug 19 2026:**
- **Standings miscounted ties.** ESPN returns `0/0` (not `NULL`) for
  matchups that haven't been played yet, so the `IS NOT NULL` filter in
  `get_standings()` didn't exclude them — 2026 standings showed `0-0-13`
  instead of `0-0-0`. Fixed by also excluding `home_score = 0 AND
  away_score = 0`; a genuine 0-0 tie isn't realistic in fantasy football.
  Added a regression test (`test_standings_excludes_unplayed_zero_zero_games`).
- **Roster order didn't match ESPN's standard lineup layout.** Was
  sorting alphabetically by `lineup_slot`. Fixed with an explicit slot
  order (QB, RB, WR, TE, flex, D/ST, K, then bench/IR) in
  `get_roster()`. This league's flex slot is stored as `"RB/WR/TE"` (its
  actual position eligibility), not literally `"FLEX"` — confirmed
  against real data before assuming. Added a regression test
  (`test_roster_ordered_like_espn_lineup`).

**Mobile-first pass, Aug 19 2026:** per explicit instruction that most
initial users will be on phones, replaced the wide `<table>` layouts on
Standings and Team/Matchup rosters with stacking row layouts (flex-col
on mobile, flex-row from `sm:` up) that need no horizontal scrolling.
Extracted a shared `RosterList` component (`frontend/src/components/`)
used by both the Team and Matchup pages. Also fixed nav bar wrapping and
long team/owner name truncation across League, Standings, and Dashboard.
Still not visually confirmed in an actual browser this session (no
browser tooling connected) — worth a real look on an actual phone before
treating this as done, not just curl/build-verified.

**Second round of real user feedback, Aug 19 2026:**
- **Champion badge on Standings** (initial version) — pinned the
  `season_champions`-derived champion to #1. Superseded the same day,
  see below.
- **Playoffs vs. regular season distinction.** New shared `PlayoffBadge`
  component, shown on the week-schedule page header (when any matchup
  that week is a playoff game) and the matchup detail page header.
  Standings already only counted regular-season games for W-L-T (that
  was already correct) — this just makes the distinction visible in the
  UI, which it wasn't before.
- **Restored Proj/Final column labels** on `RosterList` — lost when the
  table→row-list mobile conversion happened; added back as a small
  header row above each list, right-aligned to match the number columns.

**Third round of real user feedback, Aug 19 2026 — real final standings
from ESPN.** The champion-badge caveat above ("can't reconstruct true
final standings beyond the champion") turned out to be solvable:
`espn_api`'s `League.standings()` sorts by `Team.final_standing`
(`rankCalculatedFinal` — ESPN's own computed final rank, accounting for
the full playoff bracket, not just who won it). Confirmed against real
league data before building on it: 2024's champion (Amishtown
Rumspringers) was seeded 4th going into playoffs but correctly shows
`final_standing=1`; `final_standing` is `0` for a season still in
progress, so we know exactly when there's nothing real to sync yet.

- New `final_standings` table (season, team_id, final_rank) — migration
  `a80e40f20fa5`, applied to production with your go-ahead.
- New `FantasyProvider.sync_final_standings()` step, added to
  `run_full_sync`'s per-season loop. Backfilled production for
  2023-2025 (12 rows each, matching ESPN exactly); 2026 correctly got 0
  rows since it hasn't finished.
- `get_standings()` now LEFT JOINs `final_standings` and orders by
  `final_rank` when present, falling back to regular-season record when
  not (an in-progress season). **This replaced the `season_champions`-based
  champion field entirely** — a team with `final_rank == 1` is the
  champion by definition, so there's no separate "champion" concept to
  keep in sync anymore. `season_champions` isn't written by anything in
  this new pipeline, so `final_rank` is the sustainable source of truth
  going forward; `get_champion()` and the `champion` API field were
  removed rather than left as unused/drifting parallel logic.
- Frontend Standings page simplified accordingly: renders `standings` in
  the order the API already gives it, badges whichever row has
  `final_rank === 1`. No more "pull champion out, reorder" logic needed.

4 new backend tests (2 adapter: saves-when-complete /
skips-when-in-progress; 2 query: final_rank ordering / fallback to
record), replacing the 2 champion-field tests. 21 total passing.

## PHASE 5 — AUTHENTICATION (full)
- [x] Finalize auth approach with you — **Sign in with Discord**, verified
      against `owners.discord_user_id` (real league membership, already
      synced from ESPN). You initially asked about "sign in with ESPN"
      for the same verification reason; explained that ESPN has no
      public OAuth for third-party apps, and using the ESPN session
      cookies (already used for data sync) as a "login" would mean
      asking ~12 people to extract and hand over their own private
      session cookies — a real security risk and bad UX, not a login
      mechanism. Discord OAuth + the owner-ID check gets the same
      "verify they're actually in the league" property safely.
- [x] League membership / roles (commissioner vs. member) — foundational
      version: `is_commissioner` on the session, set by comparing the
      logged-in Discord ID against `COMMISSIONER_DISCORD_ID` (same env
      var Fantasy_Helper's bot already used). No commissioner-only
      features exist yet to gate with it — that's real work for whenever
      a feature actually needs it, not built ahead of need.

**What was built:**
- `users` table extended (migration `0528c1f9a3cb`, applied to
  production): `email` now nullable (Discord OAuth doesn't reliably
  return one without extra consent scope), added `discord_user_id`
  (unique) and `discord_username` — discord_user_id is the real identity
  key for a user account now.
- `POST/GET /auth/discord/login`, `/auth/discord/callback`, `GET
  /auth/me`, `POST /auth/logout` (`app/routers/auth.py`). Callback
  verifies the Discord account against `owners.discord_user_id` before
  issuing a session — someone can complete Discord's consent screen and
  still get denied (redirected to `/login?error=not_a_league_member`)
  if they're not a real league member.
- Session = signed JWT in an httpOnly cookie (`app/auth/session.py`,
  `pyjwt`), not a server-side session table — reasonable for a ~12-person
  league; revisit if real revocation is ever needed.
- Config split into `SessionConfig` (just `SESSION_SECRET` —used by
  `/auth/me` and `/auth/logout`) and `DiscordAuthConfig` (adds the
  Discord app credentials — used only by the login/callback routes) so
  checking "am I logged in" doesn't require Discord credentials at all.
  Both lazy, same pattern as `ESPNConfig`.
- Frontend: `AuthStatus` client component in the nav (the one part of
  this app that fetches from the browser, not server-side — a Next.js
  server component has no access to the session cookie, which is set on
  the *backend's* origin from a browser-driven OAuth redirect). `/login`
  page for the "not a league member" error.
- 9 new backend tests, all mocked (`tests/test_auth.py` mocks Discord's
  token/user endpoints; `tests/test_session.py` is pure JWT round-trip
  logic) — **nothing has hit Discord's real API yet**, since that needs
  a real registered Discord application, which only you can create. See
  DEVELOPMENT.md's "Discord login" section for the exact setup steps.
  30 tests total passing.

**Known gap, not fixed:** checked production — 11 of 16 owners already
have a real `discord_user_id` (so login works for them once credentials
are set), but 5 don't: Aaron Roberts, Bailey Hawn, Brian Thomas, Ligmuh
Bauhs, Tyler Dailey. They won't be able to log in until their Discord ID
is added to their `owners` row — ESPN sync can't provide this (ESPN
doesn't know Discord identities), so it needs either their Discord ID
from you or an admin tool to set it. Not built — flagging rather than
guessing at scope for a 5-person, one-time fix.

**Live testing, Aug 19 2026:** registered a real Discord application and
started testing. Found and fixed two real bugs along the way:
1. The running backend process had `.env` loaded before the Discord
   credentials were added to it — env vars only load at process
   startup, so it needed a restart to pick up the new values.
2. **The `0528c1f9a3cb` migration (users table extended for Discord
   auth) was tested locally but never actually applied to production**
   — a real gap, not a decision; applied with your go-ahead once found
   (`ALTER TABLE users ADD COLUMN discord_user_id...` etc., verified via
   `information_schema.columns` afterward). The Discord login → consent
   screen → callback flow got as far as this bug before failing, which
   is a good sign for the rest of the flow.

Also: your Discord client secret was accidentally printed in a terminal
command's output while debugging — recommended resetting it in the
Discord Developer Portal as a precaution.

**Confirmed working end-to-end, Aug 19 2026.** Real login completed:
Discord consent → callback → session issued → signed in. Verified
directly in production (not just trusting the UI): a real `users` row
was created (`discord_username='teej_8'`) and correctly linked via
`owners.user_id` to owner `tj overlin`. **Phase 5's core deliverable —
Discord OAuth login verified against real league membership — is done
and proven working, not just built.**

## PHASE 6 — EXISTING BOT FEATURES → WEB

**Scoping discovery, Aug 19 2026:** before building, checked whether the
underlying computed data (weekly_team_stats, season_awards,
season_champions, bench_crimes) actually exists in production — it does,
fully populated (612/33/3/1988 real rows respectively), and
`rivalries` already has the `rivalry_map.py` data migrated in too (12
real rows). So this phase turned out to be the same shape as Phase 4:
port the real read-layer logic, build endpoints and pages against data
that's already there — no new computation needed for what's below.

- [x] Team profile page (ported `team_profile.py` verbatim into
      `app/domain/team_profile.py`) — season + career views, badges
      (championships + awards). `/owners/{id}`.
- [x] Awards leaderboard page (ported `season_awards.py`'s *read* side —
      the table it populates, already computed — and `weekly_awards.py`
      verbatim into `app/domain/weekly_awards.py`). Season awards at
      `/seasons/{s}/awards`; weekly awards folded into the existing
      week-schedule page rather than a separate route, since they're
      naturally about the same week.
- [ ] Weekly recap/preview page (port narrative_engine) — **deliberately
      not started.** This calls the real Anthropic API and costs real
      money per generation; asking before building it, not assuming.
- [x] Rivalries page — the "move into DB first" step was already done
      (by something/someone before this session); just needed the query
      + page. `/rivalries`.
- [~] Fill in the 8 currently-stub Discord commands' underlying logic —
      the underlying domain functions now exist and are shared-ready
      (that was the point), but the actual Discord bot commands
      themselves live in the separate `Fantasy_Helper` repo, out of
      scope here. Not marked done since nothing in Discord itself changed.

**Boom/bust gap — fixed, Aug 19 2026.** Ported `bot/stats_engine/boom_bust.py`'s
classification rule (`classify_boom_bust`/`get_baseline`, unchanged) and
`scripts/compute_boom_bust.py`'s write logic into
`app/domain/boom_bust.py` (`compute_boom_bust_for_week`/`_for_season`,
scoped per-season so it doesn't redo untouched history). Wired into
`run_full_sync` as a new step after `rosters`, so every sync — full or
future live — keeps `is_boom`/`is_bust` current automatically, not just
a one-time backfill. 6 new tests.

**Backfilled against production, Aug 19 2026** — with explicit go-ahead,
ran a full sync (all 4 seasons, now including the boom_bust step). Zero
failures across every step/season. Final state: 65 real boom rows, 406
real bust rows, out of 10,078 total roster rows. Spot-checked: real
players (Jahmyr Gibbs, Ja'Marr Chase) correctly flagged for weeks where
actual points scored (52-55) blew past projections (~21) — the Boom/Bust
leaderboard on the weekly awards page now actually shows something.

**Weekly awards performance — fixed, Aug 19 2026.** Rewrote
`weekly_awards.py` (and `team_profile.find_game_of_the_week`'s power-rank
lookups) to batch-fetch each week's inputs (matchup scores, projections,
team names, power ranks) in a handful of queries instead of querying
per-team/per-matchup in loops — same calculation logic, same thresholds,
verified byte-for-byte identical output against real production data
(2025 week 5) before and after. ~125 sequential round-trips → ~12.
Measured: backend computation 7s → 0.95s; full page load 7s → ~1s.

**Partial answer to "who computes this going forward," Aug 19 2026:**
`matchups`/`rosters`/`boom_bust` now have a real answer —
Better_Fantasy_App's own sync pipeline, including live in-game updates
(see below). `weekly_team_stats` (luck/chaos/power_rank/team_projected),
`bench_crimes`, `season_awards`, and `chug_debts` are still an open
question — nothing in this app's pipeline computes those yet, so they'll
go stale once the 2026 season starts unless something else (the old bot,
or a future port) keeps running for them specifically.

**Fully answered, Aug 20 2026 — the remaining gap closed.** `chug_debts`
was ported and wired in earlier the same day (see the Chug subsystem
entry below). The rest — `weekly_team_stats` (power_rank/luck_score/
chaos_score/team_points_projected), `bench_crimes`, and `season_awards`
(plus `season_champions`, a small related concern) — ported this pass:

- `app/domain/weekly_team_stats.py` — power_rank, luck_score,
  chaos_score, team_points_projected, ported unchanged from
  `bot/stats_engine/power_rank.py`/`luck.py`/`chaos.py`/
  `team_projections.py`. Deliberately doesn't compute `clutch_score`/
  `choke_score` — those columns exist in the schema but have no reader
  anywhere in this app (their only consumer in Fantasy_Helper is
  `narrative_engine`/`recap_embed.py`, both explicitly out of scope —
  confirmed by grepping this app's own code before assuming, not
  guessed).
- `app/domain/bench_crimes.py` — ported unchanged from
  `bot/stats_engine/bench_crime.py`. No unique constraint on
  `(season, week, team_id)`, so a recompute deletes and re-inserts that
  team's rows rather than upserting, matching the original script.
- `app/domain/season_awards.py` — all 7 season-award computations
  (clutch/choke, over/underachiever, boom/bust week, snakebit/luckiest
  win, streaks, bullseye, highway robbery) plus
  `determine_and_save_season_awards`, ported unchanged from
  `bot/awards_engine/season_awards.py`/`determine_season_awards.py`.
  Every underlying query already scopes to real, played, regular-season
  games (`home_score > 0 AND is_playoff = FALSE`), so — confirmed by
  reading the actual queries, not assumed — it's safe to recompute every
  full sync, not just once at season end; awards just reflect "the
  season so far" and update as more weeks are played, the same way
  power_rank already behaves. Also ported `season_champions`
  (derived from `final_standings.final_rank = 1`, a no-op until a
  season's playoffs actually finish).
- Wired into `app/providers/sync.py`: `weekly_team_stats` and
  `bench_crimes` are per-week steps in both `run_full_sync` and
  `run_live_sync` (ordered after `boom_bust`, since chaos_score reads
  `is_boom`/`is_bust`); `season_awards` is a full-sync-only step (like
  `final_standings`, not per-current-week), ordered last since it reads
  both `weekly_team_stats.team_points_projected` and `final_standings`.
- Removed `scripts/backfill_season_derived_stats.py` — the stopgap this
  TODO note originally pointed at, which depended on a sibling
  `Fantasy_Helper` checkout via `sys.path` injection. Superseded by the
  real port; no longer needed and no longer correct to keep around as a
  second, drifting implementation of the same logic.
- 25 new backend tests (9 weekly_team_stats, 7 bench_crimes, 9
  season_awards), all passing against real Postgres (fake
  `TEST_SEASON = 1900` data, same discipline as every other domain
  test). Not yet backfilled/verified against real 2026 data, since the
  season hasn't started — nothing real to compute yet. Full existing
  suite (192 tests total) still green after this change.

13 new backend tests (profile: 4, awards/rivalries: 3, plus the
domain/query modules they exercise), 37 total passing. Verified
extensively against real production data (team profiles, career stats,
season awards, weekly awards, rivalries) beyond just the test suite —
all internally consistent and plausible for a real league.

**Live in-game sync, Aug 19 2026 — real user requirement:** the project
owner explicitly asked for scores and roster moves to update quickly
during live games, not just once a day. Full sync (Phase 3) always
re-scans the *entire* history, which is fine daily but far too slow and
wasteful to poll every few minutes. Built a separate, narrow path
instead:

- `ESPNProvider.sync_matchups_for_week`/`sync_rosters_for_week` — one
  targeted ESPN call for a specific week, not a 1-17 week scan.
  `sync_rosters_for_week` deliberately does NOT skip pre-kickoff lineups
  with 0 points scored (the full scan does, to know when to stop
  scanning further weeks) — a live sync target already knows the week
  is current, so an empty scoreline is real data (e.g. a waiver add
  before games lock), not a "not started yet" signal. Caught this
  distinction before shipping it, not after.
- `ESPNProvider.get_current_week` — ported from Fantasy_Helper's
  `bot/ingestion/espn_client.py`, confirmed working against real ESPN
  (correctly returns 0 — the season hasn't started).
- `run_live_sync` (`app/providers/sync.py`) — matchups + rosters +
  boom/bust for just the current week.
- `POST /admin/sync/live` — manual trigger.
- Scheduled live-sync job (`app/scheduler.py`). **Decided with the
  project owner:** gated to actual NFL game windows
  (`app/game_windows.py` — Thu/Sun/Mon evenings, generous bounds;
  doesn't cover the rare Saturday-only late-season slate, a known gap)
  polling every 5 minutes during those windows, rather than a fixed
  interval around the clock — ESPN's API is unofficial (flagged since
  Phase 0), no reason to hit it at 3am Tuesday. **Turned on in
  production** (`ENABLE_LIVE_SYNC_SCHEDULER=true`) — confirmed the job
  actually registers with APScheduler on startup. Safe to leave on: it's
  a no-op outside game windows.

11 new backend tests (adapter per-week methods, game-window boundaries,
admin endpoint gating). **Not yet verified against a real live game** —
the 2026 season hasn't started, so there's nothing in progress to test
the actual "does this track a live-scoring game" behavior against yet;
that check has to wait for an actual Sunday. The mechanism itself, and
every piece that doesn't require a live game, is tested and confirmed
working.

**Team Profile home page rebuild, Aug 19 2026 — real user requirement.**
The project owner asked for the home page to lead with rich, interactive
team profile cards for every owner who's ever been in the league,
explicitly pointing at Fantasy_Helper's `/team_profile` Discord embed
(`bot/discord_bot/commands/team.py`) as the reference: career view by
default, a dropdown to drill into any season, championship banner,
grouped career awards. Read that file before building anything — it's a
genuinely well-designed embed, not a stub, and matching it closely (not
reinventing the layout) was the right call.

- New `list_all_owners()` query / `GET /owners` — every owner with any
  team history, **not scoped to one season**. Confirmed against
  production: 16 real owners, including 5 who've left the league
  entirely (Aaron Roberts, Bailey Hawn, Brian Thomas, Ligmuh Bauhs,
  Tyler Dailey) — they show up too, per the explicit "every owner who's
  ever been in the league" requirement.
- Season profile endpoint now also returns `season_awards` — the
  Discord embed's "Awards This Season" list, which nothing had exposed
  yet. Real parity gap, found by reading the reference file, not
  guessed at.
- `TeamProfileCard` (client component): career data is fetched
  server-side for every owner up front (needed immediately, same
  page-load); season data is fetched client-side, lazily, only when a
  specific season is actually selected from the dropdown — deliberately
  avoiding the same N+1-shaped mistake already made and fixed once this
  session (weekly awards).
- Home page (`/`) rebuilt: was a thin "top 3 standings" teaser, now a
  responsive grid of full profile cards for all 16 owners. Verified
  against real production data — full page load ~1s (16 owners × 2
  server-side calls each, well within the range that's fine without
  batching, unlike the weekly-awards case).

4 new backend tests (owner listing spans multiple seasons and shows the
most recent team name; season-awards inclusion, including that a
different season's award correctly does NOT leak in), 57 total passing.

**Not yet verified:** the actual click-to-switch-season interaction —
no browser tooling was available this session, so this is
build-clean/backend-tested/curl-verified, not eyes-on-the-actual-toggle
verified. Worth a real click-through before calling the "interactive"
part fully confirmed.

## PHASE 7 — LINEUP MANAGEMENT
- [x] Read lineups from ESPN — was already substantially done (rosters
      sync + Team page). Phase 7's real gap: the Team page always
      defaulted to Week 1 instead of the actual current week, which
      undercut the "your lineup right now" feel.
- [x] Investigate ESPN write-capability feasibility — **closed, not
      feasible.** Checked `espn_api` (the library this whole project
      depends on) thoroughly: no `set_lineup`/`submit_lineup`/`trade`/
      `waiver_claim` method anywhere on `League` or `Team`. The only
      POST-related code in the library at all is a disabled username/
      password login flow, unrelated to roster moves and broken since
      ESPN added reCAPTCHA. ESPN has no public write API for fantasy
      football; building lineup submission would mean reverse-engineering
      ESPN's private undocumented endpoints from scratch — real risk of
      account restriction, no stability guarantee. **Decision: don't
      build interactive lineup submission.** Not a "not yet," a "not
      safely possible with the tools available."

**Current-week default, Aug 19 2026 — the actual Phase 7 deliverable.**
"Current week" only has one real source: ESPN's own `current_week`
(`ESPNProvider.get_current_week`, already ported). Calling that live on
every Team page view would mean hitting ESPN's unofficial API on every
visit — wasteful and risky. Instead:

- New `league_state` table (migration `9abaa1b7d38f`) caches
  `current_week` per season.
- Cached as a **side effect of syncs already happening** — `run_live_sync`
  reuses the `current_week` its caller already fetched (zero extra ESPN
  calls); `run_full_sync` fetches it once for `end_season` (the active
  season) after the main sync completes, best-effort.
- Team page now defaults to the cached current week instead of hardcoded
  week 1, with one edge case caught before shipping: ESPN reports
  `current_week = 0` during preseason, and "week 0" isn't real in our
  data — falls back to week 1 in that case. Historical (non-active)
  seasons still default to week 1 unchanged (`league_state` only ever
  gets a row for the active season) — a reasonable, unsurprising
  baseline, not silently expanded beyond what was asked.
- Applied to production with explicit go-ahead: migration (empty new
  table) + a live-sync trigger to populate it. Confirmed real:
  `league_state` now has `season=2026, current_week=0`; verified via the
  actual rendered page that `/teams/12` (no `?week=` param) correctly
  selects the Week 1 pill, not Week 0.
- Incidental finding while populating it: `espn_api`'s `box_scores()`
  call throws an internal error for week 0 specifically (no real box
  scores exist in preseason) — handled gracefully by the existing
  try/except, not a new problem, just worth knowing.

3 new backend tests (current-week endpoint null-when-uncached; both
`run_full_sync` and `run_live_sync` correctly cache it), 60 total passing.

## PHASE 7.5 — ESPN LINEUP WRITE INVESTIGATION (Aug 19 2026)
- [x] Build a safe lineup-mutation layer (reads/planning only)
- [x] Verify the actual ESPN write request — two real captures (a
      single-player move, then a two-player swap) confirmed both the
      1-item and 2-item request/response shapes end to end. See
      `ESPN_LINEUP_WRITE.md`.

Update (later same day): both captures landed. `set_lineup()` and
`swap_players()` now actually send real requests to ESPN's write
endpoint when `ESPN_DRY_RUN=false` — dry-run stays the default. The
2-item mirrored-swap shape our own code had inferred (before any capture
existed) turned out to be exactly right once verified. `_send_mutation`
still refuses anything with more than 2 items, since nothing in this
client's planning logic produces that and there's no capture to check it
against. 10 more tests (verified swap/displacement request bodies sent
for real against mocks, 3+-item guard), 101 total passing. Still open,
low priority: what a *rejected* write looks like (only successes
captured so far), and nobody has actually flipped `ESPN_DRY_RUN=false`
against a real roster yet — that first real end-to-end run is still
ahead, deliberately manual and outside the test suite (see
`ESPN_LINEUP_WRITE.md`'s "After a capture lands").

Update (Aug 19): before building anything for multi-owner access, you
chose to test whether one commissioner-level account can write a
DIFFERENT team's lineup, rather than assuming every owner needs their
own stored ESPN credentials. Added `as_league_manager` (default False)
to `set_lineup()`/`swap_players()` so that test is actually possible —
ESPN's write body carries an `isLeagueManager` flag we'd been hardcoding
to `false`. Not yet run. See `ESPN_LINEUP_WRITE.md`'s "Open question:
does one member's credentials cover other teams?" for what each outcome
means. Also clarified for testing: the write path already always reads
live from ESPN (never our DB), so pre-draft roster staleness doesn't
block testing it — only the web app's own display pages need a fresh
`POST /admin/sync` to look right, which is a live pull with no special
refresh/expiry logic, safe to re-run anytime (including right after the
real draft, since the scheduler's auto-refresh is gated to NFL game
windows, not draft timing). 1 more test (the flag reaching the request
body), 102 total passing.

Update (Aug 19, same day): you couldn't actually find anything to test
against — turned out there was no real gap, just no way to see it. Two
separate things were true at once: (1) our own `rosters` table really is
empty for 2026 (confirmed: 0 rows) — the full sync's "did this week
really happen yet" gate stops before saving a scoreless preseason week,
and the live-sync path hits a known espn_api error for week 0 — so the
web app's own Team page has nothing to show; and (2) more fundamentally,
nothing had ever exposed `ESPNLineupClient` outside of Python code —
Discord commands were explicitly out of scope, so there was literally no
UI or endpoint to try it from. Added `app/routers/admin_lineup.py`:
`GET /admin/lineup/teams/{id}/roster` (live from ESPN, bypasses our DB
entirely — same reason the sync-pipeline gaps above don't affect the
write feature itself), `POST .../set`, `POST .../swap`, same
`X-Admin-Token` stopgap auth as `/admin/sync`. Verified live against
production: team 4 (yours) has a real, full 17-player roster on ESPN
right now (keepers + auto-fill) — confirms there's real data to test
against today, pre-draft, you just couldn't see it before. Specific
lineup-error types now map to sensible HTTP status codes (404/400/409/
501/502/504) instead of raw 500s. 6 new tests, 108 total passing.

Revisits the "not feasible" write-capability call from Phase 7 at your
explicit request, this time with a proper investigation instead of
stopping at "the library we use doesn't support it": re-confirmed
`espn_api` is read-only at the source level (zero live `.post()`/
`.put()` calls anywhere in it), checked `mkreiser/ESPN-Fantasy-Football-API`
(sometimes cited as having transaction support — it doesn't, verified by
reading its actual source tree), and searched current
(2025–2026-dated where possible) community sources for a verified
lineup-write request body. None exists publicly. Full breakdown, labeled
VERIFIED / COMMUNITY-REPORTED / ASSUMED / NEEDS CAPTURE line by line, is
in `ESPN_LINEUP_WRITE.md` at the repo root — including exact Chrome
DevTools capture steps and exactly what must be redacted (`Cookie` /
`Authorization` headers, any `SWID` echoed in a payload) before a
captured request is ever pasted here.

Built anyway, since none of it depends on the unverified write body:
- `backend/app/providers/espn/lineup_client.py` — `ESPNLineupClient`,
  isolated from both `adapter.py` (our DB-sync pipeline) and raw
  `espn_api`. Always reads live from ESPN, never our DB (which is only
  synced during game windows, per Phase 6, and can be stale). Implements
  the full Phase 6 read-before-write sequence — fetch roster, find
  player, validate slot, validate eligibility, check lock (best-effort,
  via the player's scheduled kickoff time — `espn_api` exposes no
  explicit "locked" flag), detect whether the destination slot needs a
  displacement — and returns a `LineupChangePlan`/`SwapPlan` only once
  every check passes.
- `backend/app/providers/espn/slots.py` — `LineupSlot` enum + label
  helpers. The slot IDs (QB=0, RB=2, WR=4, TE=6, D/ST=16, K=17,
  BENCH=20, IR=21, FLEX=23) are VERIFIED — they're exactly what
  `espn_api`'s `POSITION_MAP` already uses in production today to parse
  every real roster correctly. Caught a real bug before it shipped:
  `POSITION_MAP`'s string keys are NOT the reverse of its int keys (it
  has `20: 'BE'` but no `'BE': 20`, and `23: 'RB/WR/TE'` but only
  `'FLEX': 23`, not `'RB/WR/TE': 23`) — a naive reverse lookup through
  the same dict would have silently misidentified every bench, IR, and
  (in this league) flex player. Fixed by deriving the reverse map from
  the verified int→label direction instead, plus a small alias table
  ("FLEX" → 23) since that's what a human/Discord command will actually
  type, not this league's literal ESPN label.
- `backend/app/providers/espn/lineup_models.py` /
  `lineup_exceptions.py` — `RosterEntry`, `LineupChangePlan`,
  `SwapPlan`, `MutationResult`, and a specific exception per Phase 7
  failure mode (`PlayerNotFoundError`, `SlotIneligibleError`,
  `LineupLockedError`, `AmbiguousDisplacementError` — when a destination
  slot has more than one occupant and there's no ESPN-given way to know
  which one to bump, so `swap_players()` with an explicit second player
  is required instead of guessing — `WriteNotVerifiedError`,
  `MutationVerificationFailedError`).
- `ESPNLineupClient.set_lineup()`/`swap_players()` build a plan, then
  either log the exact mutation that would be sent and stop (dry-run,
  the default — `ESPN_DRY_RUN` in `.env.example`, defaults to `true`) or
  raise `WriteNotVerifiedError` (real-write mode). No code path anywhere
  sends an actual request to ESPN yet — Phase 7's "never silently fail,
  never guess" rule applied to the whole layer, not just individual
  requests.
- `verify_lineup()` — re-reads the live roster and checks it matches
  what was expected; this is the only thing that will ever be allowed to
  call a future mutation "successful," never an HTTP status code alone.
- `backend/app/providers/espn/capture.py` — redaction/comparison helper
  for once a real captured request is available, so a human redaction
  attempt isn't the only line of defense.
- Explicitly not built: Discord slash commands. This repo is the
  FastAPI/Next.js web app, not the Discord bot process — the mutation
  layer is UI-agnostic and callable from either once the write endpoint
  is verified.

31 new backend tests (slot ID/label resolution including the BE/IR/FLEX
bug above, roster parsing, player lookup, eligibility validation, lock
detection, displacement/ambiguous-displacement, swap validation, dry-run
behavior, credential-redaction-in-logs, capture-utility redaction), 91
total passing. Nothing here touches production — every test runs against
fakes, no real ESPN credentials or network calls.

## PHASE 7.6 — HOMEPAGE REDESIGN: "Your Week" + live ticker (Aug 20 2026)
- [x] Session-aware personalized hero (real matchup, score, projection,
      win probability)
- [x] NFL-wide live ticker for logged-out visitors
- [ ] Deferred to a later pass (explicit "phase it" scope decision):
      logged-out ticker beyond NFL scores, game-day motion polish, full
      design-system tokens, deeper mobile-specific pass

Replaced the homepage per a full design brief (premium sportsbook +
speakeasy atmosphere, but "useful first, atmospheric second" — no
elaborate room to navigate just to see standings). The room+neon-sign
takeover from Phase 7.5-era work moved to `/weekend` (kept, still
linked from nav) instead of being deleted or being the primary
interface.

New `/` is a real dashboard: auto-scrolling live ticker, a "Your Week"
hero, standings/awards previews, and a discovery nav using the
`/weekend` signs' same color semantics as small accent badges instead
of full neon signage.

**Win probability — real finding, not an assumption**: checked ESPN's
raw fantasy API directly (mLiveScoring/mScoreboard/mMatchupScore/
mBoxscore views, against a completed season and the current preseason)
and confirmed no win-probability field exists anywhere in their data.
`backend/app/domain/win_probability.py` is our own estimate instead —
built only from real inputs (current score, real season-long
projections, the league's own actual historical score standard
deviation), gated to only show once a matchup has real scores.

**NFL scoreboard — new integration, verified against live data**:
`backend/app/providers/nfl_scoreboard.py` hits ESPN's public,
unauthenticated scoreboard API (`site.api.espn.com`, not the private
fantasy league API) — confirmed working against real 2026 preseason
scores before building the parser around it.

**"Your Week" is server-rendered with zero loading flash** — a new
pattern for this app: the Next.js Server Component reads the session
cookie via `next/headers` and forwards it to the backend's new
`GET /me/week`, which decodes it the same way `/auth/me` does.

Incidentally found and fixed while writing tests for this: a
Decimal-vs-float crash in the win-probability estimate (Postgres's
`stddev_pop()` returns `Decimal`) left a stale `league_state` test row
behind (crashed before the test's own cleanup ran), which broke an
unrelated test on the next run. `league_state` is now in
`conftest.py`'s autouse cleanup fixture so this can't recur regardless
of which test fails first.

17 new backend tests, 133 total passing.

**Continued, Aug 19 2026 — remaining hierarchy phases + polish, all shipped
and pushed:**
- [x] League Context expansion (Other Matchups, Rivalries sections)
- [x] Game Day state (`GET /game-day`, live-indicator row, faster ticker,
      auto-refresh) — reuses `app/game_windows.py`, the same source of
      truth already gating the live-sync scheduler
- [x] Richer Awards/Entertainment tile grid (all 8 real award fields).
      Found and fixed the same Decimal-vs-string type bug as an earlier
      `RosterPlayer` fix — `WeeklyAwards.points_diff`/`points_scored` were
      typed `string` in `lib/api.ts` but are actually numbers at runtime
      (Postgres `NUMERIC` → Decimal → JSON number via `jsonable_encoder`)
- [x] Discovery/Nav section — replaced the flat pill row with a card grid
      plus a flagship `/weekend` card; fixed two real dead-ends (`/league`
      and `/weekend` weren't reachable from the homepage body before)
- [x] Motion/atmosphere pass — the functional-dashboard rebuild had
      regressed to a flat black screen with white text with no depth.
      Added: fixed ambient background wash, staggered section entrance,
      surface fill + hover/press feedback on every card, a live pulsing
      glow on the Your Week hero during an actual live game, an ambient
      glow on the ticker (brighter on Game Day), colored glow on section
      dots, `prefers-reduced-motion` support throughout.
- [x] Mobile polish (partial) — `viewport-fit=cover` + `themeColor`,
      new `.safe-px` utility (`max(1rem, env(safe-area-inset-*))`) on the
      header and main content column, header nav converted to a
      single-row horizontal scroller below `sm:` (was wrapping to 2-3
      lines) using the same overscroll-containment technique as
      CardDeck.tsx.

**Not yet done — next session:**
- [ ] Full link-destination audit — some in-app links go to the wrong
      place; not yet enumerated.
- [ ] Homepage still not fully satisfying to the project owner as of
      Aug 19 2026 despite the motion pass above — needs another look,
      scope TBD.
- [x] **Game Day detection uses a fixed weekly schedule, not real game
      times.** `app/game_windows.py` only checks day-of-week + hour range
      (Thu 19-24, Sun 12-24, Mon 19-24 ET) — it never looks at ESPN's
      actual schedule. Two real consequences: a game outside those hours
      (e.g. an early-kickoff preseason game) won't trigger Game Day at
      all, and any Thursday/Sunday/Monday evening with no real game
      still flips Game Day on. The project owner flagged this Aug 19
      2026 after noting a preseason game on 8/20 (a Thursday) would
      "work" only by coincidence of day-of-week, not real detection —
      explicit ask: **other upcoming work will also need real game times
      and the actual schedule**, not just this fixed-window heuristic, so
      this should be solved as a real "pull ESPN's schedule" capability
      rather than patched narrowly for Game Day alone.

**Resolved, Aug 20 2026.** Real detection, not a heuristic:
`is_nfl_game_live(games)` (`app/providers/nfl_scoreboard.py`) checks
whether any game on ESPN's own public scoreboard has `state == "in"` —
the same real, already-integrated scoreboard feed the ticker itself
uses, not a separate "pull the schedule" system. Both prior consumers
now share this one real source of truth instead of drifting:
`app/scheduler.py`'s live-sync gate (fetches the scoreboard every tick
instead of a zero-I/O day/hour check — an acceptable trade since this
hits ESPN's public, unauthenticated endpoint, not the private fantasy
API this gate protects from being over-polled) and `GET /game-day`
(`app/routers/game_day.py`). `app/game_windows.py` and its test file
were deleted outright, not left around unused.

Frontend got an efficiency fix alongside the accuracy fix: every real
call site (`(home)/page.tsx` x2, `AppTickerBar.tsx`) already fetched
`getNflScoreboard()` and `getIsGameDay()` together — two separate ESPN
round trips per page load for data that only ever needed one. Replaced
`getIsGameDay()` with a pure `isNflGameLive(nflGames)` (`lib/api.ts`)
computed from the scoreboard data already being fetched — no second
network call, and `GET /game-day` itself still exists as a real,
correct, independently-usable endpoint for anything that only needs
the flag.

6 new/updated backend tests (`is_nfl_game_live` unit tests plus
`/game-day` against a faked live/not-live scoreboard), full suite
still green.

## PHASE 8 — LEAGUE FEATURES
- [x] League history / records — this checkbox was stale; the League
      Record Book (`app/domain/records.py`, `app/queries/records.py`,
      top-3-per-category, computed live) and the All-Time Awards
      leaderboard (`app/domain/awards_all_time.py`) both already
      existed and are live on `/seasons/[season]/awards/all-time`.
      Corrected Aug 26 2026 — see that day's entry below for
      everything else shipped the same week this was noticed.
- [x] Notifications (design pending) — also stale. `app/routers/push.py`
      (subscribe/unsubscribe/VAPID), `app/notifications/dispatcher.py`
      + `formatter.py`, and the full Settings > Notifications section
      (toggles, Sunday Mode presets, push subscribe) are all built and
      wired. One real, narrower gap still open, not this whole item:
      the `game_day`/`leave_me_alone` Sunday Mode presets are currently
      identical, since no real "Fantasy Activity" event notifications
      (score alerts, close-game alerts) exist yet to tell them apart —
      tracked as its own small item, Aug 26 2026 entry below.
- [x] Chug Analyzer, Chug Leaderboard, auto chug debt calculation, and
      in-app league chat — all shipped Aug 20 2026, see below.

**Chug subsystem + in-app chat, Aug 20 2026.** Full session dedicated to
these per explicit direction ("let's hold off on launch pages and UI for
now, focus on chat and all the chug features").

- [x] **Chug Leaderboard + auto chug debt calculation.** Ported the real
      rule from Fantasy_Helper's bot/stats_engine/chug_debt.py: any
      active (non-bench, non-IR) roster slot scoring ≤0 points owes its
      owner one chug. `app/domain/chug_debt.py`, wired into
      run_full_sync/run_live_sync same as boom_bust. Deliberately scoped
      to the base rule only — the original bot's carryover_owed was
      never actually implemented (read in a formula, never written) and
      deadline_missed/consecutive_missed_weeks were vestigial columns
      with no logic at all; not porting unfinished logic forward.
      `app/domain/chug_leaderboard.py` combines chug_debts (owed) with
      chug_scores (real completions/grades) — past seasons assume 100%
      completion, active season uses real graded-video counts.
      `GET /chug/seasons`, `GET /chug/leaderboard`, new `/chug` page.
      Verified against real production data: chug_debts already had 612
      real rows (2023-2025); the ported compute_chugs_owed matched all
      12 real teams for a real week (2025 week 5) with zero mismatches,
      read-only, no backfill needed. 10 new backend tests.
- [x] **In-app league chat.** Brand new — no precedent anywhere in
      either repo. Single league-wide room (no channels/DMs), WebSocket
      for live delivery + REST for SSR history, both authenticated by
      the existing session cookie. New `messages` table (migration
      4b492f773650, applied to production with explicit go-ahead — a
      disposable local Postgres verified the upgrade/downgrade cycle
      first). `app/chat/manager.py`: a single in-process connection
      manager, no Redis — genuinely enough at this league's scale and
      one-process deployment. New `/chat` page + `ChatRoom.tsx`. Real
      end-to-end verification with a genuine session for a real owner:
      sent a real WebSocket message, got the correct broadcast back,
      confirmed it landed in history, then deleted that one test
      message. 6 new backend tests (including a real cross-event-loop
      fix: starlette's TestClient runs WebSocket tests on a different
      event loop than pytest-asyncio, which broke asyncpg's pooled
      connections until the pool was reset around those tests).
- [x] **Chug Analyzer.** The real finding here: the dedicated Python
      3.11 environment this needs (mediapipe has no working build for
      the main backend's Python 3.13) didn't exist on this machine yet
      — not even Fantasy_Helper's own venv311 was set up. Worse, the
      latest installable mediapipe (1.0.x) has dropped the legacy
      `mp.solutions` API this pipeline is built on entirely, in favor of
      a new Tasks API — hit that exact `AttributeError` directly.
      Resolved by pinning `mediapipe==0.10.21` (the newest version that
      still has the old API and installs cleanly on Python 3.11/Apple
      Silicon) in `backend/requirements-chug-analyzer.txt` — see
      DEVELOPMENT.md's new "Chug Analyzer's second Python environment"
      section for the exact setup steps, needed on any machine that
      wants `/chug/upload` to work.
      `app/chug_analyzer/` (pose_detection.py, scoring.py,
      audio_analysis.py, analyzer.py) ported verbatim, logic unchanged;
      `app/providers/chug_analyzer_bridge.py` subprocess-bridges to
      venv311 exactly like Fantasy_Helper's analyzer_bridge.py.
      `POST /chug/upload`: session-authenticated, discards the video
      after scoring (never persisted anywhere, matching the original
      bot's behavior — chug_scores.video_url stays null). A detected
      chug is saved into chug_scores; "no contact detected" isn't. No
      separate "mark complete" step needed, since completion is already
      derived live from chug_scores by the leaderboard above.
      5 new backend tests (mocking the analyzer bridge — the real CV
      pipeline never runs in tests, same discipline as the ESPN write
      tests), plus a genuinely real end-to-end check: uploaded a
      synthetic video through the live HTTP endpoint using the actual
      venv311 subprocess (not mocked), got the correct "no clear chug
      detected" result, confirmed no stray database row was written.

Incidental fix along the way: the Mac's LAN IP had changed since the
prior session (192.168.1.81 -> 192.168.153.156), silently breaking all
server-side rendering — `frontend/.env.local` and `backend/.env` still
pointed at the old IP. Updated both. Discord sign-in from a phone will
need the new IP re-registered in the Discord Developer Portal's redirect
URI the same way as before — not yet done, only needed for phone-based
Discord login testing.

**Jeffrey's Rule finished for real, Aug 20 2026 — real user requirement.**
The chug rule's deadline-doubling clause had never actually been built,
in either the old bot or this app: `chug_weekly_status` existed in the
production schema, but nothing ever wrote its `carryover_owed`/
`deadline_missed`/`consecutive_missed_weeks` columns (confirmed by
reading the old bot's `/chug_complete` command — it hardcoded
`week=1` with a comment admitting "real week comes with automation,"
never finished). Real project-owner requirements this time, confirmed
via two clarifying questions before building (fine-conversion handling,
and running-balance vs. per-week doubling):

- Weekly base debt (`chug_debts`, unchanged) now folds automatically
  into a real running per-owner balance (new `chug_standing` table) via
  `accrue_weekly_debt` — idempotent (`chug_debt_accruals` tracks what's
  already applied), so a stat correction later in the week is picked up
  as a delta and re-running every 5-minute live-sync tick never
  double-counts.
- If that balance isn't paid down by Monday Night Football's real
  kickoff, it doubles — `app/domain/chug_deadline.py`, same real-ESPN-
  schedule principle as the Game Day fix above, not a fixed calendar
  guess. Falls back to a fixed 8:15 PM ET slot only when no real Monday
  game exists in the current scoreboard snapshot — confirmed this
  really happens (2026 preseason weeks don't all have one). Up to 3
  consecutive misses; the miss that hits the cap converts the whole
  balance into a $10/chug fine instead of doubling again, per the
  project owner's explicit answer: fines stay counted as "owed" and can
  only be cleared by a commissioner marking the real payment received
  (`POST /chug/standing/{id}/clear-fine`) — a real chug never reduces a
  fine, only cash does.
- A real, video-verified chug (`POST /chug/upload`) now actually pays
  down `outstanding_owed` by one when anything's owed, and always counts
  toward a new `lifetime_completed` total regardless — an owner with
  nothing owed who posts one anyway gets it counted as a real "for
  funsies" chug (explicit product decision), never banked against a
  future week and never pushing the balance negative. Previously the
  leaderboard's "completed" column silently capped at what was owed,
  so an extra chug just vanished from view entirely.
- `chug_deadline_settlements` is both the idempotency marker (never
  double/fine the same week twice) and a full audit trail of what
  happened each week per owner.
- New migration `7d0d160856d7` (three new tables, nothing existing
  touched) — verified upgrade+downgrade against a disposable local
  Postgres first, applied to production with explicit go-ahead.
  `/chug` page now shows "owed right now," a fine badge with a
  commissioner-only clear button, and a lifetime count per owner.

54 new/updated backend tests, 212 total passing (verified against both
local Postgres and, after the migration landed, real production). A
real bug was caught by the test suite itself, not eyeballed: the
Monday-anchoring math initially used the ISO calendar week (Mon-Sun),
which gets Thu/Fri/Sat/Sun backwards for an NFL week (Thu-Mon) — a
Saturday check would have anchored to the PAST Monday instead of the
upcoming one. Fixed before it ever ran for real.

156 backend tests passing (135 baseline + 10 chug debt/leaderboard + 6
chat + 5 chug upload).

**My Team + Free Agents, Aug 20 2026 — real user requirement, scoped
explicitly before building.** The project owner asked for roster
management and a waiver-wire browsing page. Real ESPN writes are a real
account-safety concern (unofficial API) already flagged once for lineup
moves (Phase 7.5 built and dry-run-tested `ESPNLineupClient` months ago
but has never actually flipped `ESPN_DRY_RUN` off for a real
submission), and waiver/free-agent writes had never even been
investigated at all. Rather than guess how far to go, asked directly —
confirmed: read + preview only for My Team, browse-only for Free
Agents, actual submission stays a separate future decision for both.

- `/team` — live roster straight from ESPN (never `rosters`, which can
  be empty pre-draft or stale outside live windows), now showing real
  points_scored/points_projected per player — `RosterEntry` didn't
  carry points before. `team.roster` returns plain `Player` objects
  (points nested in `player.stats[week]`), not the `BoxPlayer` objects
  `free_agents()` returns (flat `.points`/`.projected_points`) —
  confirmed the difference against real live ESPN data before writing
  the extraction code. Falls back to week 1 during preseason
  (`current_week == 0`), same convention as the Team page's own
  current-week fallback.
- Lineup moves/swaps preview via `plan_lineup_change()`/`plan_swap()`
  directly — pure validation, zero network-write code path involved at
  all (not just dry-run-flagged) — frontend shows exactly what would
  happen with an explicit "preview only" banner.
- `/free-agents` — real ESPN data for this league specifically
  (`League.free_agents()` already excludes anyone actually rostered
  here), verified live: real players, real projections, real
  ownership%. Deliberately doesn't label a player "waivers" vs. "free
  agent" — checked a live pull first and found `acquisitionType` comes
  back empty for unrostered players, so that distinction isn't
  reliably available; shows this league's real, verified waiver rule
  instead (standard priority, not FAAB — `league.settings.faab ==
  False`).
- Extracted `app/routers/lineup_shared.py` out of `admin_lineup.py` so
  the admin-token surface and the new session-gated `/me/team` routes
  share one error-mapping/serialization implementation.

30 new/updated backend tests, 240 total passing (local Postgres and
production). No schema changes.

**Production stabilization, Aug 20-21 2026 — real bugs hit live, all fixed
and verified.** After the first real production deploy, you hit a chain of
issues in quick succession:

- [x] **Vercel deploys silently blocked by commit-author-email
      verification.** The auto-detected local git identity
      (`tjoverlin@Tjs-MacBook-Air.local`) isn't a real, deliverable
      address, so Vercel refused to build any commit authored by it —
      git-triggered or CLI. Fixed with your go-ahead: `git config
      user.email` set locally to this repo only (not `--global`, so no
      other repo on the machine is affected).
- [x] **Production sign-in stuck on "Signing you in…" forever.** Two
      stacked causes. First, the session cookie needed `SameSite=None;
      Secure` to survive the cross-site hop from Discord's OAuth
      callback (`railway.app`) to the frontend (`vercel.app`) — fixed.
      Second, a `railway.app` cookie is never visible to Next.js's
      server-side rendering on `vercel.app` regardless of cookie flags
      (that's not a flag problem, it's how cookies work) — every
      SSR-gated page (homepage, chat, chug, settings, My Team) needs its
      *own* first-party copy. Added a one-time cross-domain handoff:
      the backend redirects to `/auth/complete#token=...` (URL fragment
      — never sent to any server, never logged), and a small client page
      there hands the token to a same-origin route that sets the actual
      first-party cookie.
- [x] **Root Directory misconfigured on the (newly created) Vercel
      project — builds failing with "No Next.js version detected."**
      The project's Root Directory defaulted to the repo root instead of
      `frontend/`, so every build ran `npm install`/`next build` in a
      directory with no `package.json`. Corrected via the Vercel API
      (dashboard has no CLI equivalent for this one setting), verified
      with a real deploy that then succeeded and served the fix above.
- [x] **Mobile: nav bar always said "Sign in with Discord" even when
      genuinely signed in.** `AuthStatus` and `ChatNavBadge` (the two
      client-side pieces of an otherwise all-server-rendered app)
      checked sign-in status by fetching the backend directly from the
      browser with `credentials: "include"`. Safari's Intelligent
      Tracking Prevention (mobile Safari and iOS Chrome) blocks
      third-party cookies on `fetch`/`XHR` by default, `SameSite=None`
      or not — so that request silently came back unauthenticated on
      mobile even though every server-rendered page (which reads the
      first-party cookie directly, no browser round-trip involved) knew
      the visitor was signed in. Fixed by adding same-origin proxy
      routes (`/auth/me`, `/chat/conversations`) that read the
      first-party cookie server-side and forward it to the backend —
      same pattern `page.tsx`/`ChatApp.tsx` already used for SSR — and
      pointing both client components at those instead of the backend
      directly.
- [x] **Abysmal load times on every page.** The Railway backend was
      running in Amsterdam (`ams`, Railway's default region) while the
      Vercel frontend renders from Virginia (`iad1`) and the Postgres
      database (Supabase) lives in Oregon (`us-west-2`) — every page
      load paid a transatlantic round trip per backend call, and most
      pages make 4-5 sequential backend calls, each itself running
      multiple DB queries. Moved the Railway service to `us-west2`
      (Oregon), co-located with the database, since DB round trips
      multiply *within* a single request while the Vercel-to-backend
      hop only happens once per call. Verified via a real redeploy
      (`SUCCESS`) and a measured homepage TTFB drop of roughly 780ms →
      420ms warm on the signed-out (2-backend-call) path alone — a
      signed-in page's 4-5-call, DB-heavy path should improve by
      considerably more.

All five verified live in production, including a real phone sign-in
after the fix. No schema changes, no new backend tests (infra/config +
one new frontend proxy pattern, not new application logic).

**Nav/mobile/feature session, Aug 22-26 2026.** Not logged day-by-day —
a long, mostly owner-driven iterative session covering a lot of ground,
summarized here so it isn't lost. Roughly in the order it happened:

- [x] **Mobile PWA fixes**: chat composer unreachable behind the
      keyboard (viewport + `interactive-widget: resizes-content`);
      header rendering under the iPhone notch/status bar
      (`viewport-fit=cover` needs its own `safe-area-inset-top` padding,
      it isn't automatic); the boot/intro animation permanently getting
      stuck (an unguarded `localStorage` read that can throw in
      storage-restricted contexts, e.g. private browsing, left the real
      app — header and all — hidden behind the splash forever); a
      6s absolute failsafe added on top of that fix regardless, so this
      class of bug can't fully lock a visitor out again; pull-to-refresh
      no longer replays the whole boot animation, just refetches data.
- [x] **Full nav/IA audit and restructure**: consolidated four
      independently-drifting color maps into one `lib/navDestinations.ts`
      source of truth; fixed several broken/`-Infinity` links; removed
      the mobile "More" sheet entirely (Free Agents/Keepers moved under
      My Team's own new sub-nav instead, alongside Roster — both are
      "manage my own team" actions, not league-wide browsing); relabeled
      LeagueSubNav's redundant "League > League" first tab to "Overview";
      Home's Discover tiles and `/weekend`'s vacancy signs now read
      league-family links from the same shared list LeagueSubNav does,
      instead of three independently hand-copied, drifting subsets.
- [x] **Player Cards redesign**: Cover Flow-style 3D swipe deck (scroll-
      driven, not a fixed timer); tap-to-flip — front is just photo/team/
      owner name + a champion crown, back has every stat, revealed only
      once the card is centered; real reference photos added for every
      owner but two.
- [x] **Keeper League** (new): `league_keeper_rules` + `keeper_selections`
      tables, owner-facing keeper picker (`/keepers`, from prior
      season's own roster, `espn_player_id`-tracked so a repeat keeper
      correctly increments its consecutive-years count), commissioner
      rule config + lock. ESPN write-back deliberately not attempted —
      needs its own reverse-engineering capture spike first (see
      `backend/app/routers/keepers.py`'s module docstring).
- [x] **Power Rankings / Luck Index / Strength of Schedule** (new):
      `power_rank`/`luck_score` already existed per-week, per-season,
      already backfilled — just never surfaced as a real feature before
      (buried as one stat on a career profile). Added `weekly_team_stats.sos`
      (average win% of every regular-season opponent faced), wired into
      the same compute step power_rank/luck_score already use, backfilled
      for every historical season via a real full re-sync. New
      `/power-rankings` page: this week's ranked list with movement
      arrows, a season trend table, and an all-time leaderboard computed
      live (same no-separate-table convention as the record book).
- [x] **Live-update timing tightened**: `GAMECAST_POLL_INTERVAL_SECONDS`
      15 → 4; the fantasy-points live sync converted from
      `LIVE_SYNC_INTERVAL_MINUTES` (default 5 min) to
      `LIVE_SYNC_INTERVAL_SECONDS` (default 60) so a live touchdown
      reflects as fantasy points much closer to real time. Confirmed via
      code audit (not yet a real live game) that Gamecast's own poll and
      the fantasy-points sync are two genuinely separate mechanisms —
      Gamecast's "Fantasy Impact" panel is only ever as fresh as the
      separate sync job's last run, not its own poll interval. Also
      confirmed `ENABLE_GAMECAST_SCHEDULER` shows no evidence of being
      turned on in production, unlike live sync — needs a direct check/
      fix in Railway's env vars, not something visible from the repo.
- [x] **Boot intro sound effects** (new): a light-switch cue per word as
      WELCOME/TO/THE ignite, then a can-opening-then-pour once the
      WEEKEND League wordmark appears — but only on the actual sign-in
      screen and the "Welcome Back" reveal into Home, never on a
      reload/deep-link landing on any other signed-in page. Browsers
      block audio-with-sound autoplay without a prior gesture on that
      page load — an app-wide one-time tap/keypress listener
      (`lib/introAudioUnlock.ts`, mounted in `RootLayout`) claims the
      first gesture anywhere in the app for an audio unlock, so a later
      reload's boot sequence has a real chance of playing with sound
      even with nothing tapped during that specific sequence.
- [x] **Admin auth cleanup**: `/admin/sync`, `/admin/sync/live`, and
      `/admin/lineup/*` migrated off the old shared-secret
      `X-Admin-Token`/`ADMIN_SYNC_TOKEN` stopgap onto the real
      `is_commissioner` session flag (Phase 5's actual auth, which had
      landed everywhere else already but never got backported to these
      two files). `ADMIN_SYNC_TOKEN` removed from `.env`/`.env.example`;
      worth removing from Railway's production env vars too, now unused.

**Known gaps flagged, not yet fixed:**
- 5 of 16 owners still have no `discord_user_id` and can't log in
  (Aaron Roberts, Bailey Hawn, Brian Thomas, Ligmuh Bauhs, Tyler
  Dailey) — same gap Phase 5 originally flagged, still open, needs
  their real Discord IDs before it's fixable.
- Sunday Mode's `game_day`/`leave_me_alone` presets are still
  identical (see the Phase 8 Notifications note above) — no real
  Fantasy Activity events exist yet to tell them apart.
- `GamecastShell.tsx` has a comment claiming a REST-polling fallback
  exists for signed-out visitors whose WebSocket ticket can't be
  minted — no such fallback actually exists in the code, it just stops
  updating. Found during this session's audit, not yet fixed.

**Confirmed as real, still-open decisions from this session** (see
Phases 9/10 below — status unchanged, explicitly reaffirmed rather than
silently dropped): multi-league support and additional data providers
(Yahoo/Sleeper) remain real future goals, not scheduled now.

- [x] **ESPN lineup writes, live for real (Part 1)**: `/me/team/lineup/
      move` and `/swap` — every signed-in owner can now submit a real
      lineup change for their own team (session-resolved `team_id`,
      never accepted from the request body), not just preview one.
      `MyTeamApp.tsx`'s swap flow is a real two-step preview-then-
      confirm now. `ESPN_DRY_RUN` flipped to `false` in Railway
      production (Aug 26, 2026) — this is the first time this app has
      ever sent a real write to ESPN.
      **Caveat, shipped deliberately rather than blocking on it:** every
      write authenticates with a single ESPN session (the commissioner's
      own `ESPN_S2`/`SWID`), and whether that can write a DIFFERENT
      owner's roster was never verified before shipping (see
      `ESPN_LINEUP_WRITE.md`'s "Open question" section). A write ESPN
      rejects for that reason surfaces as a friendly "use the ESPN app
      for now" message (not a broken error) and logs distinctly
      (`ESPN lineup write rejected (auth)...` / `...not verified after
      send...`) — watch Railway logs after rollout to learn the real
      scope of the limitation; if it turns out only team 4 (TJ, the
      credential holder) can actually submit, per-owner ESPN credentials
      becomes real near-term scope, not just a noted caveat.

**In progress as of this entry** (see this session's own plan for full
detail): building real weekly AI recap generation (Claude, fully
automatic per matchup); fixing the Chug Analyzer's production video-
scoring gap (needs a custom Docker image on Railway, since its
mediapipe dependency needs a second Python runtime Railway's single-
runtime-per-service default doesn't support).

---

## ESPN independence pivot — draft, rosters, lineups (Aug 26, 2026)

**Why**: the Part 1 lineup-write feature above went live and immediately
failed for real: it authenticates every owner's write with a single
shared ESPN session (the commissioner's own cookies), and ESPN silently
rejects writes to a different owner's roster. Rather than build
per-owner ESPN credential collection (real, ugly scope), the project
owner made the call to stop depending on ESPN's private/cookie-
authenticated fantasy API for draft, rosters, and lineup management
entirely — keeping ESPN only for the free public NFL scoreboard
(Gamecast, "did a rostered player just score"). Full plan in this
session's own plan file; summarized here for anyone reading this doc
cold.

**Also time-critical**: this league's actual snake draft for the season
starting September 2026 is Saturday, September 5 — the draft had never
happened yet when this pivot started, which is what made an in-app
draft tool for the real thing (not just a future-season nice-to-have)
suddenly urgent.

- [x] **Phase A — Player database**: new `players` table, the first
      canonical NFL-player dimension table this app has had, sourced
      from Sleeper's free/keyless player API
      (`backend/app/providers/sleeper/`) instead of ESPN — includes a
      native `espn_id` crosswalk field for cross-referencing this app's
      existing ESPN-era historical data. Scheduled daily
      (`ENABLE_SLEEPER_PLAYER_SYNC_SCHEDULER`, on in production) plus a
      manual `POST /admin/players/sync` trigger. Real run: 11,985
      players, 1,007 currently draftable (preseason roster churn means
      this tightens up as teams cut to 53 before the draft).
- [x] **Phase B — Real-time draft**: `draft_config`/`draft_picks`
      tables, snake order, transaction-safe turn engine
      (`backend/app/domain/draft_engine.py` — `FOR UPDATE`-serialized
      picks, keeper-round auto-skip, commissioner undo-last-pick), pure
      autopick sorted by Sleeper's `search_rank` (no rankings system of
      our own exists yet), full WebSocket draft room at `/draft`
      mirroring Gamecast's connection-manager pattern. Commissioner can
      reset the whole draft (config/picks/seeded rosters) and redo the
      order at any status — added specifically so a real mock draft can
      be run to test the room, then wiped clean before the real one
      ("I dont want to create the draft order yet, unless i am able to
      change it... run a mock draft to test if possible").
      Also fixed along the way: `gamecastApi.ts`'s WS ticket mint was
      requesting an invalid purpose string, so Gamecast's WebSocket had
      been silently failing and falling back to no live updates at all
      for everyone — not related to this pivot, just found while
      building the draft's own WS auth from the same pattern.
- [x] **Phase C — In-app rosters/lineups**: new `current_rosters` table
      (seeded incrementally as draft picks are made). `/me/team` and
      `/team/lineup/move`/`swap` now read/write `current_rosters`
      directly (`backend/app/domain/lineup_engine.py`) instead of
      calling `ESPNLineupClient` — a lineup move is a plain DB UPDATE
      now, no external write, no shared-credential problem, no dry-run
      flag. This is what actually fixes the bug that started this pivot.
      `/team/free-agents/add` is a new real write against the same
      table.
      `admin_lineup.py`'s commissioner override tool still targets
      ESPN — flagged as a slim, lower-priority thing to repoint later,
      not deleted.

## Free Agents: real add flow, retired the ESPN preview path (Aug 27, 2026)
- [x] The public `/free-agents` browse page's Add button had been
      preview-only since it was built — the frontend never called the
      real `/team/free-agents/add` write from the ESPN-independence
      pivot above, so owners had no actual way to add a free agent
      through the app at all (the old panel's own copy told them to
      "make the real move in the ESPN app"). Found while starting the
      season-ready punch list (Track A) and confirmed via the routers'
      own module docstrings, which had already flagged this exact
      reconciliation as the known next step.
      Fixed by rebuilding the page on the session-aware, Sleeper-sourced
      pool instead of ESPN's: `FreeAgentsList.tsx` now calls
      `GET/POST /me/team/free-agents*` (a real `current_rosters` write,
      with the same roster-full → pick-a-drop flow the old preview UI
      had), and the page requires sign-in (matching Team/Keepers/Draft/
      Chat/Settings' existing signed-out-state convention) since
      "add to my team" is inherently a personal action. No more
      ownership%/projected-points columns — the Sleeper-sourced pool
      doesn't carry those; sorted by `search_rank` instead, same as the
      draft pool already is.
      Retired the old ESPN preview path entirely rather than leaving it
      unused: `preview_add_free_agent` (`app/routers/me.py`),
      `ESPNLineupClient.plan_add_player`/`_roster_capacity`
      (`lineup_client.py`), `AddPlayerPlan` (`lineup_models.py`), the
      public `GET /free-agents` player-list endpoint and
      `get_free_agents` (`free_agents.py` router + ESPN provider) — kept
      `GET /free-agents/waiver-settings`, which was never player-specific
      and has no crosswalk problem. 5 old tests removed, all still-live
      tests passing (433 backend tests green outside a pre-existing,
      unrelated local-Postgres connection-limit flake in
      `test_chat.py`'s websocket tests).
- [x] **Follow-up, same day** — real user testing surfaced two more bugs
      in this same flow:
      1. `getMyFreeAgents` used the plain `get()` helper, which doesn't
         forward the session cookie — a server component has no ambient
         browser cookie jar for a bare `fetch()` to the backend's
         separate origin to ride along on (every other server-side
         authenticated call in this app — `getMe`/`getMyWeek`/
         `getMySettings` — already does this correctly by taking an
         explicit `sessionCookie` param). Every signed-in visit hit a
         401, thrown as an `Error`, crashing the page into the root
         `error.tsx` boundary — which is genuinely correctly wired
         (`retry()`/`Go home` both work), it just kept retrying into the
         same crash.
      2. Trying to add a real free agent returned a bare "Add failed
         (409)" — traced to production: `draft_config` has zero rows for
         season 2026 (confirmed via a direct read-only query), so
         `add_free_agent`'s roster-capacity check correctly can't
         determine the roster shape yet and raises
         `RosterConfigNotFoundError` → 409. This is real, correct
         behavior — the real fix is the commissioner running draft setup
         (creates `draft_config`/`roster_slots`) before free-agent adds
         (or any current_rosters op) can work, not a code change. But a
         real bug did make it more confusing than it should've been:
         `addFreeAgent` (`api.ts`) called `res.json()` twice on the same
         Response for a non-roster-full 409 — a Response body can only
         be read once, so the second read silently failed and the real
         `detail` message never reached the user. Fixed to read the body
         once.
      3. Player photos were missing from the Free Agents list — it
         passed `playerId={null}` to `PlayerHeadshot` (ESPN-keyed,
         pointless for a Sleeper-sourced list with no ESPN id at all).
         Added a `sleeperPlayerId` prop to `PlayerHeadshot.tsx` (a new
         `sleeperHeadshotUrl()` in `nfl-teams.ts`, same free/keyless CDN
         the player-card feature already uses, same
         onError-falls-back-to-initials handling) and wired it in.
         `MyTeamApp.tsx`'s roster rows have the identical gap — not
         changed here since the real roster is empty pre-draft and
         wasn't what was reported, but it's the same one-line fix
         whenever that's wanted.
- [x] **Phase D — Scoring engine (individual players + team D/ST)**:
      verification spike confirmed ESPN's public boxscore exposes full
      per-player stat lines, team offensive totals, and final scores
      (`SCORING_ENGINE_SOURCE.md`) — no third-party fallback provider
      needed. `league_scoring_rules` (this league's real scoring,
      transcribed from the owner's ESPN settings screenshots — 4 values
      weren't fully captured/confirmed and were seeded as documented
      interpolated guesses, see the migration's own docstring) and
      `player_week_stats` tables, `app/domain/scoring_engine.py` (pure
      formula), `app/providers/nfl_stats/espn_public.py` (raw stat
      fetch + mapping — individual bulk categories AND team D/ST:
      points/yards-allowed tiered from the opponent's own score/total
      yards, sacks/INTs/fumble-recoveries/return-TDs summed from the
      team's own players; a return TD deliberately double-credits both
      the individual returner and the team D/ST — confirmed intentional
      from the owner's own scoring screenshots, not a bug),
      `app/domain/weekly_stats.py` (orchestration: one fetch per event →
      crosswalk to sleeper_player_id → compute both kinds → store,
      idempotent). A D/ST "player" is keyed by team abbreviation,
      matching how `app/providers/sleeper/ingest.py` already special-
      cases DEF rows in the `players` table. 18 tests passing.
      **Not done, deliberately scoped out**: rare events not present in
      ESPN's stat tables at all — 2pt conversions, blocked kicks/blocks,
      safeties, FG-by-distance (would need `scoringPlays`/play-by-play
      parsing, see `SCORING_ENGINE_SOURCE.md`); the "which ESPN event
      ids belong to fantasy week N" mapping (callers currently supply
      event_ids directly); wiring computed points into
      `current_rosters`/`RosterEntry` so My Team actually shows live
      points, and into matchup scoring (Phase F).
      `current_rosters`/`RosterEntry` still has no live points field at
      all right now — deliberately honest rather than fabricated (see
      `FantasyImpact.tsx`'s own note) until that wiring happens.
- [x] **Phase E — Gamecast fantasy-impact rewire**: `_diff_fantasy_impact`
      (`app/gamecast/service.py`) now diffs `player_week_stats.
      fantasy_points` via a new `queries/league.py::
      get_current_rostered_players_by_pro_team` (current_rosters +
      players + player_week_stats), keyed by `sleeper_player_id`
      instead of the old player_name workaround — a real, always-
      present id now, unlike the legacy table's partial espn_player_id
      backfill that forced that workaround in the first place.
      **Found and fixed a real live bug while verifying team-
      abbreviation alignment** (the plan's own explicit ask): Sleeper's
      raw data uses `WAS` for Washington, but ESPN's convention — used
      everywhere else in this app (`frontend/src/lib/nfl-teams.ts`,
      Gamecast's own `team_abbr` fields) — uses `WSH`. Left alone, the
      fantasy-impact panel would have silently shown nothing for every
      Washington game. Normalized at ingestion
      (`app/providers/sleeper/ingest.py`'s `_TEAM_ABBR_NORMALIZE`) and
      re-run against production (Jacksonville already matched on both —
      `JAX` — no other mismatches found across all 32 teams).
- [x] **Phase F — Matchup scoring**: new `app/domain/matchup_scoring.py`
      sums each team's *starting* `current_rosters` slots'
      `player_week_stats.fantasy_points` and writes
      `matchups.home_score`/`away_score` directly. Matchup *pairing*
      (who plays whom) deliberately still comes from
      `provider.sync_matchups` — a read, never had the credential
      problem this pivot exists to fix — this only overwrites the score
      fields afterward. `test_gamecast_service.py` rewritten off the
      legacy `rosters` table (3 tests), new `test_matchup_scoring.py`
      (4 tests), plus 4 new tests locking in the WSH normalization —
      15 passing across all three files.
      **Wired up Aug 26, 2026** — see below.

## Automatic weekly computation (Aug 26, 2026)
- [x] `app/providers/nfl_scoreboard.py::get_week_scoreboard(week, year,
      season_type)` — the "which ESPN event ids belong to fantasy week
      N" mapping Phase F was waiting on. Verified live against real
      2026 preseason data (a temporary debug route, removed once
      confirmed) that ESPN's public scoreboard takes
      `week`/`seasontype`/`dates` query params and returns exactly that
      week's real slate.
- [x] `app/domain/weekly_stats.py::compute_and_store_week(pool, season,
      week)` — the real entry point: sources this week's event ids from
      the above, runs `compute_week_stats` (Phase D), then
      `compute_matchup_scores_for_week` (Phase F), all in one call.
- [x] New `ENABLE_WEEKLY_COMPUTE_SCHEDULER` job in `app/scheduler.py`
      (default 120s interval), gated by `is_nfl_game_live` the same way
      as live sync — off by default like every other scheduler flag
      here. **Must be turned on in Railway before Week 1 games start.**
      Also a manual `POST /admin/weekly-compute` trigger (commissioner
      session, optional `?week=`) for testing without a live game.
- [x] 16 new/updated tests across `test_nfl_scoreboard.py`,
      `test_weekly_stats.py`, `test_admin.py` — all passing.

## Player card: Sleeper bio + real ESPN projections (Aug 26, 2026)
- [x] Click a player's name (draft pool/picks, My Team roster) to open
      a card: Sleeper headshot (free CDN, keyed by `sleeper_player_id`)
      + bio (age/height/weight/jersey/years exp — newly persisted from
      Sleeper's raw payload via migration `b4f1a9c8e6d2`), plus real
      ESPN season/weekly point projections, ownership %, and bye
      week/next opponent (`app/providers/espn/player_info.py`, reading
      via the same already-configured ESPN credentials the sync
      pipeline uses — a read, no new auth, no write risk).
      **Found and fixed a real bug during live verification**: ESPN's
      `Player.schedule` dict is keyed by week number as a STRING, not
      an int — the first version silently derived every bye week as
      "week 1" for every player until this was caught against real
      data and fixed.
- [x] `app/domain/player_card.py` + `GET /players/{sleeper_player_id}/
      card` — composes both halves; ESPN's half degrades to `null` on
      any failure (bad crosswalk id, timeout, ESPN down) rather than
      breaking the card, since it's enrichment on a real DB record, not
      the record itself.
- [x] `frontend/src/components/players/PlayerCardModal.tsx`.
- [x] 20 new/updated backend tests (`test_espn_player_info.py`,
      `test_player_card.py`, `test_players_router.py`,
      `test_sleeper_ingest.py`), `tsc`/`eslint`/`next build` all clean.
      Real Sleeper sync re-run against production to backfill the new
      bio columns (confirmed against a real player: Jahmyr Gibbs — age
      24, height 69in, weight 202lbs, exp 3 — matches ESPN's own player
      page).
- [x] **Update (Aug 26, 2026, later same day)**: ADP and news turned
      out to be available after all — see the "Player card: crosswalk
      fix + news/ADP + everywhere-clickable" entry below. The paid-
      provider path was never needed.

## Player card: crosswalk fix + news/ADP + everywhere-clickable (Aug 26, 2026)
- [x] **Found and fixed the real reason most cards showed no ESPN
      data**: Sleeper's own `espn_id` crosswalk field is only populated
      for ~22% of this league's draftable players (224/1010, confirmed
      against real production data) — Josh Allen worked by chance,
      almost everyone else didn't. Fixed via a name-based fallback:
      `espn_api`'s `League` already builds a full NFL name->id map
      (`player_map`) on every fetch, for free, as a side effect of
      building the League object this feature needs anyway — used as a
      fallback when our stored `espn_player_id` is null, and the
      resolved id gets persisted back onto `players.espn_player_id` so
      future lookups (and Phase D's weekly-stats crosswalk) skip
      name-matching entirely. A one-time bulk backfill run against
      production immediately took real-data coverage from 239/978 to
      729/978 draftable non-DEF players (~75%, up from ~24%) — the
      remainder are real name-format mismatches (suffixes, etc.), an
      accepted small-percentage gap, not a bug.
      **Found and fixed a second, related real bug in the same pass**:
      the Sleeper player sync's upsert wrote `espn_player_id =
      EXCLUDED.espn_player_id` unconditionally — since Sleeper's own
      field is null for most players, the *next scheduled sync* would
      have silently wiped out every one of these resolved crosswalk
      values. Fixed to `COALESCE(EXCLUDED.espn_player_id,
      players.espn_player_id)` — Sleeper's sync can only ever add a
      crosswalk value now, never clear one this app already resolved.
- [x] **Real ADP and news, after all**: turns out ESPN's public
      athlete-overview endpoint (`site.web.api.espn.com/apis/common/
      v3/sports/football/nfl/athletes/{id}/overview` — a *different*
      subdomain than the scoreboard host blocked in this sandbox
      earlier this session, reachable directly, no workaround needed)
      exposes real recent news, a RotoWire beat-writer note (the exact
      same content Sleeper's own cards show), a real draft-rank/
      position-rank pair (the ADP-equivalent number earlier flagged as
      unavailable), and a prose season outlook — all unauthenticated,
      no new credentials. New `app/providers/espn/player_overview.py`;
      wired into the card as a third independently-degrading piece
      (`card.overview`).
- [x] Player cards now clickable everywhere the app shows a player
      name, not just the draft room: new `PlayerCardProvider`/
      `usePlayerCard()` React context, mounted once at the app root
      (`app/layout.tsx`) so the same modal follows a player regardless
      of which page opened it, replacing three separate per-page local-
      state implementations (DraftRoom.tsx, MyTeamApp.tsx). Free Agents
      wired in too — that list is still ESPN-numeric-id-sourced (see
      the ESPN-independence pivot's own scoping notes), so
      `GET /free-agents` now attaches a `sleeper_player_id` per entry
      (matched via the same `players.espn_player_id` crosswalk this
      whole fix improved), nullable when no match exists yet.
- [x] This week's real computed score (`player_week_stats.
      fantasy_points`, most recent week) now shows on the card too —
      plumbing only; nothing to display until real games happen
      post-draft.
- [x] Removed the rotating glow border added earlier the same day
      (project owner reported it wasn't working) — kept the Neon
      Intensity fix and Neon Red, see that section above.
- [x] 25 new/updated backend tests across `test_espn_player_info.py`,
      `test_espn_player_overview.py` (new), `test_player_card.py`,
      `test_free_agents.py`, `test_sleeper_ingest.py`;
      `tsc`/`eslint`/`next build` all clean.

## Neon Intensity fix + rotating glow border + Neon Red (Aug 26, 2026)
- [x] **Found and fixed a real bug**: Settings > Appearance > Neon
      Intensity (Subtle/Standard/High) only ever multiplied the
      homepage's ambient background wash (`--wl-glow-scale` on
      `.home-ambient`) — every `.neon-panel`'s actual border/glow (the
      app's dominant visual element, used at 68 call sites) completely
      ignored the setting, so changing it visibly did nothing anywhere
      that mattered. Now `.neon-panel`'s border and box-shadow glow
      both scale with `--wl-glow-scale` via `calc()` inside
      `color-mix()`'s percentage argument; also widened the scale
      values themselves (0.3 / 1 / 2.2, was 0.5 / 1 / 1.6) for a more
      definite subtle-vs-high difference, per the project owner's ask.
- [x] ~~Rotating glow border on every `.neon-panel`~~ — shipped (a soft
      conic-gradient light chasing each panel's border via `@property
      --neon-rotate` + a blurred `::before` ring), then **removed the
      same day**: the project owner reported it wasn't working. The
      Neon Intensity fix and Neon Red above stayed.
- [x] Added Neon Red (`#ff1744`) to the Accent Color picker
      (`lib/neonPalette.ts`) — deliberately not `--wl-live`'s red
      (`#ef4444`, the LIVE-game indicator color) so picking it as an
      accent never reads as "something is live" by coincidence.
- Not verified in a live browser this session (no backend reachable
  from this sandbox to render authenticated pages, and no browser tool
  connected) — `tsc`/`eslint`/`next build` all pass and the CSS was
  reasoned through carefully (stacking-context/`position: relative`
  safety checked against every real `.neon-panel` + `absolute` co-
  occurrence in the codebase), but the project owner should give it a
  look in the real app before considering this fully verified.

## Keepers wired into the real draft (Aug 26, 2026)
- [x] The keepers feature (owner-facing picker sourced from each
      owner's live ESPN roster, commissioner rules/lock UI,
      `league_keeper_rules`/`keeper_selections` schema) was already
      fully built earlier this session — this closes the last gap:
      turning a *locked* keeper selection into a real pre-filled slot
      in the draft. New `app/domain/draft_engine.py::
      seed_keepers_from_locked_selections(conn, season)`: requires
      keepers locked first, resolves every selection's
      `espn_player_id → sleeper_player_id` via the `players` crosswalk,
      seeds each into the **last round** of the draft (first year in
      the app — no prior in-app draft cost to base a real formula on,
      per the project owner), atomically (all-or-nothing — if ANY
      selection can't be resolved, nothing is seeded, and the full list
      of failures is reported, not just the first), and idempotently
      (already-seeded owners are skipped, safe to re-run for
      stragglers). New `POST /draft/seed-keepers` (commissioner-only),
      new **Seed keepers** button in `DraftSetupPanel.tsx` shown once a
      draft exists but hasn't started — shows exactly who got seeded,
      or exactly which owner/player couldn't be matched so it can be
      fixed and retried before the real draft.
- [x] 12 new backend tests (`test_draft_engine.py`,
      `test_draft_router.py`, `test_keepers.py`) covering the happy
      path, idempotent re-run, unlocked-rules block, all-or-nothing
      unresolved reporting, already-started block, and no-draft block.
      Full suite (469 tests) passing; `tsc`/`eslint`/`next build` clean.
- **Operational, not code** (for the commissioner, on the already-built
  `/keepers` page): set 2026 rules (`max_keepers`, deadline), have each
  owner pick their keeper, lock once everyone's in. On draft day: set
  the draft order → click **Seed keepers** → fix/retry if anything's
  unresolved → **Start draft**.

## Scoring engine review (Aug 26, 2026, later)
- [x] The project owner asked to verify the scoring engine against a
      detailed spec describing D/ST as "starting at 10 points and
      moving up/down" — this wasn't in any of the real `league_scoring_
      rules` captured from the owner's own ESPN screenshots earlier
      this session (a flat additive/tiered model, no baseline), so it
      was flagged back rather than implemented on a description alone.
      The owner's first reply then said there was no such rule; their
      very next message reversed that and insisted it's real. Given the
      direct contradiction, asked once more for confirmation (not a
      screenshot, since the owner said to stop pushing) — confirmed a
      third time, unambiguously. Implemented as asked: `app/domain/
      scoring_engine.py`'s `compute_player_points()` gained a `baseline`
      parameter (default 0.0, so every individual player is
      unaffected); `DST_BASELINE_POINTS = 10.0` is passed only from
      `weekly_stats.py`'s team-D/ST branch. No existing
      `player_week_stats` rows existed yet to retroactively fix (season
      hasn't started — confirmed via a live query, count 0). 4 new
      tests (`test_scoring_engine.py`, `test_weekly_stats.py`); full
      suite (470 tests) passing.
- [x] Confirmed (already true, not a new build) that most of the
      spec's real asks are already how this engine works: every live
      poll (every 120s during a game, `ENABLE_WEEKLY_COMPUTE_SCHEDULER`)
      does a **full recompute from ESPN's current box score**, not
      incremental `+=` — handling stat corrections/duplicate
      events/reconnects for free; points/yards-allowed are already tier
      lookups, not cumulative; D/ST is already the exact same fantasy
      entity type as any player, flowing through the same
      `current_rosters`/`player_week_stats`/Gamecast fantasy-impact
      pipeline (`app/gamecast/service.py::_diff_fantasy_impact`) with
      no separate D/ST-only pathway.
- [x] Fixed one real, confirmed value: `yds_allow_300_349` was `1` in
      production, corrected to `0` per the owner's direct confirmation.
- [ ] FG miss stacking ("distance-specific only, don't stack" —
      confirmed by the owner) noted but currently has zero effect:
      field-goal makes/misses by distance aren't wired into scoring at
      all yet (`app/providers/nfl_stats/espn_public.py`'s own docstring
      — ESPN's box-score endpoint doesn't expose FG-by-distance data,
      only play-by-play does, which isn't parsed). Revisit if/when that
      gap gets built.
- [x] Live cadence question — confirmed by the owner: 120 seconds is
      fine, no need for true per-play scoring.

## D/ST scoring correction — the flat +10 baseline double-counted (Aug 27, 2026)
- [x] The owner sent the promised fuller write-up on D/ST scoring's
      correct mental model: the "starts at 10" behavior isn't a flat
      bonus at all — it's the natural result of the opponent starting
      at 0 points/0 yards allowed, which (per this league's own real,
      captured `league_scoring_rules`) lands in the `pts_allow_0` (5)
      and `yds_allow_lt100` (5) tiers — 5 + 5 = 10 on their own.
      Checked directly against production: these two values are real,
      captured from the owner's ESPN screenshots, not among the 4
      values flagged `ASSUMED`/interpolated in the seeding migration —
      not a coincidence.
      This means the `DST_BASELINE_POINTS = 10.0` flat add-on shipped
      three days ago (previous section) was double-counting: the real
      formula was computing `10 (baseline) + 5 (pts_allow_0) + 5
      (yds_allow_lt100) = 20` at kickoff, not 10 — confirmed directly
      against the existing test suite, which had explicitly asserted
      `10 + 5 + 2 = 17` and `10 + 3 + 0 = 13` as "correct." Checked
      production `player_week_stats` before fixing: 0 rows total, so
      no bad data to backfill — the scheduler (turned on earlier this
      session) hadn't yet computed anything for real.
      Fixed by removing the baseline mechanism entirely rather than
      patching it: `compute_player_points()` drops the `baseline`
      parameter altogether, and D/ST now uses the exact same call as
      any individual player — the tier categories already encode the
      correct starting state, live-recomputed from the current box
      score every poll (unchanged from before), so nothing else needed
      to change to get the "dynamic, recalculated from current stats"
      behavior the write-up asked for. 8 scoring_engine.py tests
      rewritten around the real tier values (kickoff, tier changes in
      both directions, each positive event type, multiple simultaneous
      events, a genuinely bad game going negative); one new
      weekly_stats.py integration test proves a corrected/updated stat
      line fully overwrites the stored score rather than accumulating
      on top of the old one. 443 backend tests passing.

## Mobile + App Store release audit (Aug 27, 2026)
Full-scope audit requested (25 phases: architecture, responsive CSS,
accessibility, security, performance, App Store/Play Store readiness,
try-to-break-it QA). Real limitation hit early: this session runs as a
background job, and the Claude in Chrome extension's service worker
doesn't register with background-job sessions (confirmed via research,
not guessed) — visual/viewport screenshots, live navigation click-
through, and keyboard-overlap testing were never possible this
session. Everything below is a genuine code-level audit + real
build/lint/test/curl verification, not visual inspection.
- [x] **Fixed, deployed, verified live** (6 commits):
  1. Touch-target sizing on 4 icon-only close/remove buttons (were bare
     glyphs with zero explicit hit area).
  2. Missing `aria-label`s on 3 form inputs relying on placeholder text
     alone (not reliably announced by screen readers).
  3. **Zero `error.tsx`/`not-found.tsx`/`global-error.tsx` anywhere** —
     any real bug or bad URL fell through to Next's bare unbranded
     default screens. Built on-brand versions; `retry` (not `reset`)
     confirmed as the correct Next.js 16.3 prop against this repo's own
     vendored docs, not assumed from training data.
  4. **Every one of the app's 24 pages showed the same generic
     "Weekend League" browser-tab title** — added real per-page titles,
     including `generateMetadata()` on the shareable dynamic pages
     (team/owner/matchup/gamecast/season/week), confirmed deduped
     against the page's own identical fetch (no extra request).
  5. **Empty-roster state on My Team** — a real, currently-live bug:
     since the actual draft hasn't happened yet, `current_rosters` is
     genuinely empty for every owner right now, and the page silently
     rendered two empty boxes. Added a real explanation + link to Draft.
- [x] Verified clean (no changes needed): secrets/debug-route scan,
      `.env*` gitignore coverage, session cookie `Secure`/`SameSite`
      config in production, CORS scoped correctly, safe-area/notch
      handling, bottom-nav content clearance, external link
      `rel="noopener noreferrer"` coverage, mobile keyboard types on
      numeric/date inputs, zoom not disabled (a real a11y requirement
      many apps get wrong), image `alt` text, WebSocket reconnection
      logic across draft/gamecast/chat (with correct auth-failure
      handling), PWA manifest + service worker (verified actually
      serving correctly in production, not just present in code), no
      runaway client-side polling, every mutating backend endpoint (37
      routes) requires real authentication, frontend/backend input
      validation parity (display name / team name: exactly 40 chars
      both sides, backend also defends against control characters).
- [ ] **Flagged, not fixed — a real design-system decision, not a bug**:
      the app-wide `text-black/40 dark:text-white/40` "muted text"
      convention computes to 3.72:1 contrast against the Cosmic
      background (WCAG AA requires 4.5:1 for normal text) — 100
      occurrences across 28 files. A passing alternative (`/50`, 5.02:1)
      already exists and is used inconsistently for the same semantic
      role. Not changed unilaterally since it's a real visual-identity
      tradeoff across the whole app, not an isolated fix.
- [ ] **Confirmed blockers for real App Store / Google Play submission**
      (unchanged from the owner's own product/legal decisions, not
      something to build unilaterally): no in-app account deletion (already
      disabled/"Soon" in the UI, both stores require it for apps with
      account creation), no Privacy Policy anywhere in the app or repo
      (hard requirement for both stores' submission forms), and no
      native wrapper exists yet at all (Capacitor/Expo/React Native —
      this is a Next.js PWA today).
- [ ] Visual/interactive phases (real viewport screenshots, live
      navigation click-through, keyboard-overlap testing, actual
      color-contrast measurement beyond the one convention checked
      above) still genuinely unverified — needs either a normal
      interactive Claude Code session with Chrome connected, or the
      owner's own eyes on the rendered app.

## My Team roster redesign + bye week/ownership%/live indicators (Aug 27, 2026)
- [x] Redesigned My Team's roster rows against two Sleeper app
      screenshots the owner shared as a reference: a slot-label pill,
      headshot/name/team/injury (already real, just needed the pill
      layout), this week's real stored score
      (`player_week_stats.fantasy_points`, newly LEFT JOINed into
      `lineup_engine.get_roster()` via an optional `week` param — every
      other caller unaffected), and next opponent + game time (derived
      from the real NFL scoreboard, cross-referenced by `pro_team`, no
      new external dependency). Explicitly not built: season
      projections/bye week the same way (too slow, per-player, ESPN-
      crosswalk-limited — see below for how bye week actually got
      solved instead) and ownership%/weather/live indicators, until
      asked for directly.
- [x] **Follow-up, same day** — the owner then asked for exactly those
      three deferred things. Investigated each properly before
      building:
      - **Bye week**: real, but per-player was the wrong approach —
        it's actually a TEAM-level fact (every player on a team shares
        one bye), derivable from 18 real scoreboard fetches (one per
        regular-season week, `app/providers/nfl_scoreboard.py`) finding
        each team's one missing week. New `team_bye_weeks` table +
        `app/domain/bye_weeks.py::compute_bye_weeks`/`sync_bye_weeks` +
        commissioner-triggered `POST /admin/sync/bye-weeks` (not a
        continuous scheduler — real NFL byes are set once at schedule
        release and don't change mid-season).
      - **Ownership %**: real via `espn_api`'s `League.player_info()`,
        which already supports batching a whole list of ESPN ids into
        ONE call (`app/providers/espn/player_info.py`'s
        `get_player_info` only ever passed a single id before — new
        `get_bulk_ownership` uses the list form). Same ~22%-of-players
        `espn_player_id` crosswalk gap as everything else this session
        limits coverage, not the API — shipped anyway with partial
        coverage per the owner's own call. Kept as a separate
        `GET /me/team/ownership` endpoint, fetched by the frontend
        after the roster already renders, since it's a real multi-
        second live ESPN call that should never block the main page.
      - **Live offense/red-zone**: turned out to be almost entirely
        already built — Gamecast's live-game poller
        (`app/gamecast/service.py`) already derives
        `possession_team_abbr`/`is_redzone` per live game and keeps it
        in a free, already-fresh in-memory cache
        (`all_cached_states()`). `GET /me/team` now just joins a
        roster entry's `pro_team` against any cached in-progress game.
        My Team also gained live polling (~15s, only while a real NFL
        game is live — same "only during a live window" discipline
        `GameDayRefresher.tsx` already established for the homepage)
        so the indicator actually updates without a manual reload.
      - 13 new backend tests across bye-week computation, the admin
        sync endpoint, ownership partial-coverage, and the live-status
        join. 458 backend tests passing; tsc/eslint/next build clean.

## Gamecast cadence + scrollable ticker (Aug 27, 2026)
- [x] Owner asked how often Gamecast updates, and whether the ticker
      could stay auto-scrolling but also be manually scrollable to find
      a specific game. Answered the first directly: Gamecast's live
      poller (`app/scheduler.py`, `GAMECAST_POLL_INTERVAL_SECONDS`,
      default 4s) was **never actually turned on in production** —
      confirmed via `railway variables`. Without it, Gamecast still
      worked per page load (on-demand cache-miss fetch), just never
      pushed live updates to an already-open WebSocket. Owner said
      "Yes turn it on" — set `ENABLE_GAMECAST_SCHEDULER=true` on
      Railway, verified a healthy redeploy.
- [x] `LiveTicker.tsx` became a client component: pointerdown/
      touchstart/scroll pauses the CSS auto-scroll animation via
      `animation-play-state` (native browser behavior preserves
      position/speed across pause/resume, no manual tracking needed),
      `.ticker-shell` switched from `overflow-hidden` to
      `overflow-x-auto` with a hidden-scrollbar utility (same pattern
      `MyTeamSubNav.tsx` already used). Deployed and verified.

## Draft countdown card on the homepage (Aug 28, 2026)
- [x] Owner shared a Sleeper app screenshot (team name, "Snake Draft |
      Sat, Sep 5, 3:00 PM", ticking Days/Hours/Minutes/Seconds boxes)
      and asked for the same on the logged-in homepage. `draft_config`
      had no scheduled-start concept at all — only `started_at` (set
      once the draft actually begins). Confirmed with the owner: the
      real date is Sat Sept 5, 3:00 PM, and setting/editing it should
      be a **separate, lighter control**, not folded into the existing
      Setup/Reset flow — deliberately did not hardcode the 3pm value
      myself (real risk of guessing the wrong timezone), instead built
      the control so the commissioner sets the real value themselves.
      Built: new nullable `draft_config.scheduled_start TIMESTAMPTZ`
      column, new commissioner-only `PUT /draft/schedule`,
      `build_your_week()` gained a `draft` field, new
      `DraftCountdownCard.tsx` (client component, all clock/timezone-
      dependent state deferred to a client-only effect to avoid an SSR
      hydration mismatch) replacing the homepage's "No matchup yet"
      empty state once a date is set and the draft hasn't started, and
      a small "Draft date/time" input + Save button on
      `DraftSetupPanel.tsx`. 5 new backend tests; tsc/eslint/next build
      clean.

## PHASE 9 — MULTI-LEAGUE ARCHITECTURE (kicked off Aug 31, 2026)
- [x] **Audit + migration plan, Aug 31 2026.** Owner sent a large "migrate
      off ESPN auth to first-party accounts" prompt. Read the real
      auth code first rather than assuming the premise — found the app
      was never ESPN-authenticated: login has always been Discord
      OAuth2 with its own `users`/session/JWT model, and ESPN has only
      ever been a data source (crosswalk, ownership%, historical
      stats). What's actually missing, confirmed with the owner: the
      account model is closed to one hand-registered 12-person league,
      with zero `league_id` concept anywhere in application data (37
      tables, all implicitly single-league via a bare `season` column
      and `ACTIVE_SEASON`/`ESPN_LEAGUE_ID` env vars). Wrote up the real
      audit + a phased, additive migration plan (new tables first,
      backfill League #1, thread `league_id` through the domain layer,
      only then open signup) — published as an artifact ("Open
      Roster") rather than rewriting anything blind.
- [x] **Phase 1 — schema, Aug 31 2026.** New `leagues` (id, name,
      created_by_user_id, invite_code, created_at) and `league_members`
      (league_id, user_id, role: commissioner/member, unique per
      league+user) tables — migration `d7deccb620bb`. Deliberately
      schema-only: no existing table changed, nothing reads or writes
      these tables yet, League #1 isn't backfilled yet either. Fully
      additive and reversible.
- [x] **Phase 2 — backfill League #1, Aug 31 2026.** Checked the real
      data first: of 16 historical `owners` rows, only 2 have ever
      actually logged into the web app (`owners.user_id` set) — TJ
      (the commissioner) and Niko. The other 14 have a pre-registered
      Discord id but no `users` row yet, so they can't get a
      `league_members` row until they actually sign in once — creating
      one ahead of time would mean fabricating an account for someone
      who's never authenticated. Backfilled what's real: a `leagues`
      row ("Weekend League", created by TJ) and `league_members` rows
      for TJ (commissioner) and Niko (member). For everyone else, added
      a small hook to `get_or_create_user_for_owner`
      (`app/queries/auth.py`) so a first-time login also enrolls them
      as a `member` of the one real league automatically — no need to
      re-run a script by hand as the other 14 log in over time. New
      `app/queries/leagues.py` (`create_league`, `add_member`,
      `get_default_league_id`); 1 new backend test
      (`test_login_auto_enrolls_into_the_default_league_if_one_exists`);
      `cleanup_test_season` in `conftest.py` updated to clean up test
      `league_members` rows too.
- [x] **Phase 3 — league_id columns, Aug 31 2026.** Added `league_id`
      (NOT NULL, `DEFAULT 1`, `REFERENCES leagues(id)`) to the 22
      tables that are real fantasy-league concepts — teams, drafts,
      rosters, matchups, scoring/keeper rules, standings/awards, and
      the chug side-game — all backfilled to League #1 in the same
      migration (`454d8edda612`). Deliberately excluded two
      season-scoped tables that turned out to be global, not
      league-specific, on inspection: `team_bye_weeks` (a real NFL
      schedule fact, same for every league) and `league_state` (caches
      the real NFL calendar's current week, not anything per-league
      despite the name). Also deliberately did NOT touch `owners`
      (becomes a per-league record eventually, but that's a shape
      change, not an added column — later phase) or any existing
      UNIQUE constraint that assumes one league (e.g.
      `teams_by_season`'s `(season, espn_team_id)`) — widening those is
      a correctness change that belongs to Phase 4, not this
      column-only one. `DEFAULT 1` is a deliberate, temporary bridge:
      today's domain code has no idea `league_id` exists yet, so it
      keeps every new row landing on League #1 automatically until
      Phase 4 threads it through for real and that default comes out.
      Column-only, non-breaking — no application code changed in this
      phase. Applied to production; every non-empty table backfilled
      to exactly one distinct `league_id` (verified by direct
      introspection), full 464-test backend suite green afterward.
- [x] **Phase 4 — thread league_id through the domain layer, Aug 31
      2026.** The real long pole flagged in the audit — every query
      that filtered by `season` alone now also filters by `league_id`
      (via a new `DEFAULT_LEAGUE_ID = 1` constant in `app/config.py`,
      threaded as a trailing default parameter through every touched
      function — never a required argument, so no existing call site
      needed to change, matching the plan's "no visible change until
      step 6" design). Covered ~30 files by full app-wide sweep, not
      just the original grep: every `app/domain/*.py` and
      `app/queries/*.py` module touching a Phase-3 table, plus
      `app/providers/espn/adapter.py` (writes teams/matchups/rosters/
      final_standings), `app/routers/me.py` and `app/routers/chug.py`
      (the only routers with their own inline SQL), and
      `app/scheduler.py`'s draft-clock job — including
      `draft_engine.py` and `lineup_engine.py` in full, deliberately
      not deferred past the Sept 5 draft per the owner's explicit call.
      `queries/chat.py` was deliberately left untouched — its tables
      have no `league_id` column at all (never season-scoped, so Phase
      3's sweep correctly skipped them; a chat-v2 migration comment
      already flagged this gap before this session started) — adding
      one needs its own migration, not a column-only follow-through.
      `rivalries`/`list_rivalries` similarly has no `league_id` yet,
      noted in `queries/league.py`'s module docstring as a known
      follow-up rather than faked. Every edited file compiled clean;
      full 464-test backend suite green with zero regressions.
- [x] **Phase 5 — self-serve signup + create/join-league + create-a-
      team, Aug 31 2026.** Owner asked to push through the remaining
      phases autonomously while stepping away. Scoped down first (see
      the owner's own call, same day): email/password signup only,
      deferring "create a functional league" until it was clear what
      that actually required.
      - **Email/password accounts** — a second, independent way to get
        a real Weekend account alongside Discord, not a replacement.
        New `users.password_hash`/`users.display_name` columns
        (migration `1149bed021a5` — nullable, Discord-only accounts
        untouched). `POST /auth/signup`/`POST /auth/login`
        (bcrypt-hashed, generic "invalid email or password" on every
        failure mode so a login attempt never reveals whether an
        account exists or just has no password set). `create_session_
        token`'s owner_id/discord_user_id/is_commissioner all became
        optional — a self-serve account has no League #1 link at all
        until it creates or joins one. `GET /auth/me` falls back to
        `users.display_name` when there's no linked owner. Known,
        accepted limitation: no account linking/merging yet — an
        existing Discord user who signs up again with their real email
        gets a genuinely separate account. AuthScreen.tsx gained an
        email/password form (Sign in/Create account toggle) alongside
        the existing Discord button, reusing the same `/auth/complete/
        set-cookie` route the Discord flow already used to finish
        signing in.
      - **Create/join a league** — `POST /leagues` (creator becomes
        commissioner, gets a real invite code), `POST /leagues/join`
        (via invite code), `GET /leagues/mine`. Built on the
        `create_league`/`add_member` query functions Phase 2 already
        wrote for the League #1 backfill.
      - **Create a team, the piece that actually unlocks a new
        league** — `POST /leagues/{id}/teams`. Real finding along the
        way: `owners` never needed a shape change after all (the
        "later phase" flagged in Phase 3/4's own comments) — it's
        already just a global real-person registry
        (display_name/user_id/discord_user_id), and `teams_by_season.
        owner_id` referencing it works fine for a person who has teams
        in more than one league, same owner_id, different league_id.
        The real gap was narrower: there was no way to create a
        `teams_by_season` row *without* an ESPN sync. New
        `get_or_create_owner_for_user` (an owner row for a self-serve
        user who's never had one) + `create_team`, which needs a
        placeholder `espn_team_id` (that column is `NOT NULL`,
        ESPN-shaped) — solved with a new Postgres sequence
        (`synthetic_espn_team_id_seq`, migration `1595f790df89`,
        starting at 1,000,000, far above any real ESPN id) rather than
        touching that column's meaning.
      - New `/leagues` page (list your leagues + invite codes, create/
        join forms, create-your-team). Deliberately NOT wired into the
        rest of the app yet — standings/matchups/draft/etc. still all
        implicitly show League #1; making every page league-aware is
        its own, much larger frontend project, tracked below rather
        than rushed.
      - 6 new signup/login tests, 6 new league/team tests. Full backend
        suite green.
- [x] **Critical follow-on, same day — widened ~11 UNIQUE/PRIMARY KEY
      constraints that were still season-only.** Discovered while
      wiring up default scoring-rules seeding for a new league:
      `league_scoring_rules` is `UNIQUE (season, stat_category)` — no
      `league_id` — so a second league's own rule for `pass_td` in
      2026 collided outright with League #1's. Checked every Phase 3
      table for the same gap and found it was much bigger than that
      one case: `draft_config`'s PRIMARY KEY was `(season)` **alone**
      — literally only one draft could ever exist per season, across
      every league, full stop. Same shape of bug on
      `league_keeper_rules` (PK), `season_champions` (PK),
      `draft_picks`, `season_awards`, `keeper_selections`,
      `current_rosters` (two separate constraints), `player_week_
      stats`, and four `chug_*` tables — all still keyed by columns
      that are either just `season`, or a value like `owner_id`/
      `sleeper_player_id`/`stat_category` that's shared across leagues
      by nature (a real person, a real NFL player, a fixed vocabulary
      word), not scoped by league at all.

      This is what migration `454d8edda612`'s own docstring had
      already flagged and deliberately deferred ("a correctness change
      belonging to Phase 4, not this column-only one") — Phase 4
      threaded `league_id` through every query but never came back to
      actually widen the constraints underneath them. Fixed in
      migration `130f4acc3a50`: each constraint dropped and re-added
      with `league_id` included (safe and non-breaking — every
      existing row is already `league_id = 1`, so widening only
      permits combinations that couldn't exist before). Every
      `ON CONFLICT` clause targeting one of these tables updated to
      match its widened constraint (`app/providers/espn/adapter.py`,
      `app/queries/keepers.py`, `app/domain/season_awards.py` ×2,
      `app/domain/weekly_stats.py`, `app/domain/chug_debt.py`,
      `app/domain/chug_standing.py` ×2) — an unmatched `ON CONFLICT`
      column list throws immediately at runtime, so this had to be
      exhaustive, not partial.

      Deliberately did NOT widen `matchups`, `weekly_team_stats`, or
      `final_standings` — those are already unique on `home_team_id`/
      `away_team_id`/`team_id`, which are `teams_by_season.id` values,
      already implicitly one-league-only (a team can only ever belong
      to one league) — no real collision risk, widening them would
      just be unnecessary migration surface.

      **This supersedes the earlier "split player_week_stats into two
      tables" Phase 7 plan below** — widening its constraint to
      include `league_id` gets the identical correctness outcome (two
      leagues, two independent `fantasy_points` rows for the same
      real player/week) without a new table, a dual-write period, or
      migrating three reader call sites. The accepted trade-off, not
      solved: a league's weekly compute still does its own real ESPN/
      NFL network fetch even if another league already fetched the
      same games this week — a real but small inefficiency at this
      app's actual scale, not a correctness problem.

      New `tests/test_multi_league_isolation.py` — proves the exact
      collision scenarios directly: two leagues each rostering the
      same real player, each with a `pick_number = 1`, each with their
      own `pass_td` value for the same season. Full backend suite
      green.
- [ ] Phase 6 — per-league ESPN connection (Settings → Connected
      Accounts), replacing the global `ESPN_LEAGUE_ID` env var — lower
      priority than it looked: a brand-new self-serve league no longer
      needs ESPN at all (Phase 5's create-a-team flow above), so this
      only matters for someone wanting to import a *different* real
      ESPN league specifically.
- [ ] **Commissioner scoring-rules UI** — a `PUT /league/scoring-rules`
      endpoint (commissioner-only, same shape as the existing
      `/keepers/rules` pattern) to edit `points_per_unit` per stat
      category. Default rules are already seeded automatically at
      league-creation time (`seed_default_scoring_rules`, copied from
      League #1's real values) — this is just the editing surface on
      top. Roster shape needs no new work — `draft_config.roster_slots`
      is already commissioner-set per league via the existing
      `DraftSetupPanel.tsx` / `POST /draft/setup`.
- [ ] **Make the rest of the frontend league-aware.** Everything
      outside the new `/leagues` page (standings, matchups, draft, My
      Team, chat, chug, awards, power rankings — effectively the whole
      app) still implicitly shows League #1 only; every API call
      defaults `league_id` server-side rather than the frontend ever
      choosing one. A real second league needs a selected-league
      concept threaded through the frontend (a switcher, most likely
      persisted per-visitor) and every existing page/API call updated
      to pass it — a genuinely large, separate frontend initiative,
      deliberately not attempted in the same pass as the backend work
      above.

## PHASE 10 — ADDITIONAL PROVIDERS
- [ ] Yahoo / Sleeper adapters, only after ESPN adapter is stable

## PHASE 11 — PRODUCTIZATION
- [ ] Only if the platform proves useful for your league first

---

## Open questions — answered Aug 18 2026

1. ~~Does `Fantasy_Helper` currently run anywhere against real Discord/ESPN/
   Postgres, or has it only been developed, not deployed?~~ **Running
   somewhere** — it's a live deployment against real Discord/ESPN/Postgres.
2. ~~Do you have real historical league data already sitting in a Postgres
   instance?~~ **Yes** — real historical data already exists in Supabase.
3. ~~Are you happy with the FastAPI + Next.js + Postgres recommendation?~~
   **Approved as proposed.**
4. `bot-codebase-audit.md` — not resolved, low priority. Revisit only if a
   question comes up that it might answer.
5. ~~Chug Analyzer — Discord-only forever, or eventually web?~~ **Eventually
   web** — stays in the Phase 8 roadmap as a real feature, not deferred
   indefinitely.

## New decision — Aug 18 2026

- New backend connects to the **same** Supabase project the live bot writes
  to (not a separate dev copy), but is **read-only** until schema changes
  are explicitly approved. Chosen for simplicity over safety-via-isolation;
  revisit if this ever feels risky in practice.
