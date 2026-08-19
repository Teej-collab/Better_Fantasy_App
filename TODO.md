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

The `users` table added here is intentionally minimal (`id`, `email`,
`created_at` — no password/OAuth columns yet) since the actual auth
mechanism is still a Phase 5 decision per ARCHITECTURE.md. `owners.user_id`
links a web login to a league-owner record once someone signs up.

## PHASE 3 — ESPN INTEGRATION (read-only first)
- [ ] Port `sync_teams.py` / `sync_matchups.py` / `sync_rosters.py` behind a
      `FantasyProvider` interface
- [ ] Confirm your `ESPN_S2`/`ESPN_SWID` cookies are current and valid
- [ ] Backend endpoint to trigger a manual sync (admin-only)
- [ ] Scheduled sync job (replaces in-process discord.ext.tasks loop)

## PHASE 4 — CORE APPLICATION (read-only views)
- [ ] Auth: basic login (decision pending — see ARCHITECTURE.md)
- [ ] Dashboard, My Team, Matchup, Standings, League pages — thin, backed by
      ported stats_engine functions

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
