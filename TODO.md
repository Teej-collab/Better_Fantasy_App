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

## PHASE 6 — EXISTING BOT FEATURES → WEB
- [ ] Team profile page (port `team_profile.py`)
- [ ] Awards leaderboard page (port `season_awards.py`, `weekly_awards.py`)
- [ ] Weekly recap/preview page (port narrative_engine)
- [ ] Rivalries page (port `rivalry_map.py` data → move into DB first, per
      MIGRATION_MAP.md)
- [ ] Fill in the 8 currently-stub Discord commands' underlying logic once —
      shared by web + (eventually) Discord

## PHASE 7 — LINEUP MANAGEMENT
- [ ] Read lineups from ESPN
- [ ] Investigate ESPN write-capability feasibility (research task, not a
      build task, until findings are in)

## PHASE 8 — LEAGUE FEATURES
- [ ] League history / records
- [ ] Notifications (design pending)
- [ ] Chug Analyzer — decide whether/when to bring into the web app
      (currently Discord-only, real CV pipeline, see MIGRATION_MAP.md)

## PHASE 9 — MULTI-LEAGUE ARCHITECTURE
- [ ] `leagues` table, league-scoped everything
- [ ] Configurable scoring/roster/award rules (flexible league engine)

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
