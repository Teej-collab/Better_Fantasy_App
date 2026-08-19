# TODO.md — Roadmap

Status key: `[ ]` not started · `[~]` in progress · `[x]` done

This is a living document — update it as phases complete or plans change.
Phases roughly match the master engineering prompt, adjusted based on what
Phase 0 discovery actually found.

---

## PHASE 0 — DISCOVERY
- [x] Inspect Fantasy_Helper codebase (tech stack, architecture, DB schema,
      real vs. stub components)
- [x] Write PROJECT_STATE.md, ARCHITECTURE.md, MIGRATION_MAP.md,
      PRODUCT_REQUIREMENTS.md, TODO.md, CLAUDE.md, DEVELOPMENT.md
- [ ] **You review this audit and approve/adjust the proposed architecture
      and tech stack before Phase 1 starts** ← we are here

## PHASE 1 — ARCHITECTURE / FOUNDATION (not started, awaiting approval above)
- [ ] Confirm tech stack decisions from ARCHITECTURE.md (FastAPI + Next.js +
      Postgres) — or adjust based on your feedback
- [ ] Create `Better_Fantasy_App` repo structure (backend/, frontend/, docs)
- [ ] Set up local dev environment on your Mac (and document Windows
      equivalent commands)
- [ ] `.env.example` + `.gitignore` for the new repo (same discipline as
      Fantasy_Helper's config pattern)
- [ ] Confirm whether you have a real Postgres instance with real historical
      data already, or whether Phase 2 starts from an empty DB

## PHASE 2 — BACKEND FOUNDATION
- [ ] FastAPI project skeleton, health-check endpoint
- [ ] Async Postgres connection (asyncpg, matching existing pattern)
- [ ] Port `db/schema.sql` into the new repo, add `users`/auth tables
- [ ] Decide on migration tool (Alembic vs. hand-written SQL migrations) —
      flagged as a decision, not pre-made
- [ ] Basic automated test setup (pytest) — first real test suite for this
      project's domain logic

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

## Open questions for you (not blocking, but worth answering before Phase 1)

1. Does `Fantasy_Helper` currently run anywhere against real Discord/ESPN/
   Postgres, or has it only been developed, not deployed? (PROJECT_STATE.md
   flags this as UNKNOWN from the code alone.)
2. Do you have real historical league data already sitting in a Postgres
   instance, or does this start from zero data?
3. Are you happy with the FastAPI + Next.js + Postgres recommendation in
   ARCHITECTURE.md, or do you want to discuss alternatives before we commit?
4. What do you want to do about `bot-codebase-audit.md` — it's referenced by
   Fantasy_Helper's README but wasn't in the file you gave me. If it has
   useful context about what was deleted/why, it'd help me avoid re-treading
   ground.
5. Chug Analyzer — Discord-only forever, or eventually web? No rush on this
   one, just flagging it early since it changes Phase 8 scope a lot either way.
