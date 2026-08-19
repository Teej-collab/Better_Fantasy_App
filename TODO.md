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
3" widget currently shows a 0-0-0 tie among all teams. Not broken, just
not the most useful default — worth revisiting (e.g. default to the most
recent season with actual games) when picking this back up.

## PHASE 5 — AUTHENTICATION (full)
- [ ] Finalize auth approach with you (major decision, not pre-made)
- [ ] League membership / roles (commissioner vs. member)

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
