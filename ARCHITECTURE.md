# ARCHITECTURE.md

## PART 1 — CURRENT ARCHITECTURE (Fantasy_Helper, as found)

### Stack (from `requirements.txt`, confirmed by imports in code)

| Layer | Technology |
|---|---|
| Language / runtime | Python 3 (asyncio-based throughout) |
| Discord | `discord.py` >= 2.4.0, slash commands (`app_commands`) |
| Database | PostgreSQL, accessed via `asyncpg` (no ORM) |
| ESPN integration | `espn_api` library (community-maintained, unofficial) |
| Fuzzy matching | `rapidfuzz` |
| HTTP | `aiohttp` |
| LLM (narrative engine) | `anthropic` SDK, model `claude-sonnet-4-6` |
| Computer vision (chug analyzer) | `opencv-python`, `mediapipe`, `moviepy`, `imageio` |
| OCR | `pytesseract` + `pillow` — marked in requirements as "legacy, only if still needed — confirm before keeping" |
| Config | `python-dotenv`, all secrets via env vars |
| Scheduling | `discord.ext.tasks` (in-process loops, not a separate job queue) |

No frontend, no HTTP API, no web server of any kind exists in this repo. It
is a single Python process: connects to Discord, connects to Postgres,
periodically pulls from ESPN.

### How it actually flows (traced through the code, not assumed)

```
main.py
├─ loads Discord cogs (commands + tasks)
├─ bot.tree.sync() → registers slash commands with Discord
└─ on_ready → scheduler.jobs.setup_scheduler(bot)
        │
        ▼
discord.ext.tasks loops (in-process, tied to bot's asyncio loop)
        │
   ┌────────────┴─────────────┐
   ▼                           ▼
weekly recap post      weekly preview post
   │                           │
   ▼                           ▼
refresh_pipeline.run_full_refresh()
        │
        ├─ scripts.sync_teams / sync_matchups / sync_rosters
        │       │
        │       ▼
        │   espn_api.League(...) → ESPN's (unofficial) API
        │       │
        │       ▼
        │   Postgres: owners, teams_by_season, matchups, rosters
        │
        └─ scripts.compute_bench_points / luck / boom_bust / clutch_choke /
           chaos / power_ranks / chug_debts
                │
                ▼
           Postgres: weekly_team_stats
                │
                ▼
        discord_bot/embeds/{recap,preview}_embed.py build a Discord Embed
                │
                ▼
           posted to a Discord channel (via config's *_CHANNEL_ID)
```

Slash commands follow a similar, shorter version of the same pattern:

```
Discord slash command (e.g. /team_profile)
        │
        ▼
bot/discord_bot/commands/team.py
        │ resolves owner name → resolve_owner() (bot/resolver)
        ▼
bot/stats_engine/team_profile.py (pure function, asyncpg conn in / dict out)
        │
        ▼
Postgres query (matchups, weekly_team_stats, rosters)
        │
        ▼
build_career_embed() → discord.Embed
        │
        ▼
Discord response
```

The narrative engine is a variant of this with an LLM step inserted between
domain logic and presentation:

```
Stats Engine (deterministic facts)
        │
        ▼
narrative_engine/payload_builder.py → structured "facts" string
        │
        ▼
narrative_engine/llm_client.py → Claude generates the roast text
        │
        ▼
Discord embed
```

### Key architectural observations (facts, not opinions)

1. **Domain logic is already decoupled from Discord.** Every file in
   `stats_engine/` and `awards_engine/` takes an `asyncpg` connection and
   returns a plain dict — none of them import `discord`. This is the single
   biggest reason this migration is *feasible* rather than a full rewrite:
   this logic can be lifted into a backend API layer close to as-is.
2. **There is no API layer today.** Discord command handlers call domain
   functions directly, in-process. There is nothing to reuse for "expose this
   over HTTP" — that has to be built new (Phase 2).
3. **ESPN integration is unofficial/cookie-based.** `ESPN_S2` and `ESPN_SWID`
   are private-league session cookies you extract from your own logged-in
   browser session, not an OAuth token from a documented API. This is the
   standard (only) way the fantasy-bot community currently reads private ESPN
   leagues, via community libraries like `espn_api`. It is **not**
   officially supported, is fragile (`bot/ingestion/health_check.py`, still a
   stub, exists specifically to detect when these cookies expire), and could
   break if ESPN changes anything. Flagging clearly per your instruction not
   to present unofficial capabilities as guaranteed — more in
   PRODUCT_REQUIREMENTS.md's ESPN section.
4. **Scheduling is in-process**, not a separate job queue/worker. It runs
   inside the same asyncio loop as the Discord bot. That's fine for a single
   bot process; it will not directly carry over to a backend/web architecture
   where you likely want scheduled jobs to run independently of any one
   client.
5. **No API means no reuse path for a website without building one.** A
   website cannot "talk to" a Discord bot. The web app will need its own
   backend regardless of what we decide to reuse from `Fantasy_Helper`.

---

## PART 2 — PROPOSED ARCHITECTURE FOR Better_Fantasy_App

**Label: PROPOSED / NOT YET IMPLEMENTED.** Nothing below exists yet. This is
what I recommend building, for your review and approval before Phase 1 starts.

### Guiding idea

Keep the pieces the audit found to already be well-separated (domain logic),
and build one new thing this project has never had: an API. Everything else
(web frontend, and later Discord-as-a-client) becomes a consumer of that API
instead of talking to the database directly.

```
                 ┌────────────────────┐
                 │   PostgreSQL DB     │
                 └─────────▲──────────┘
                           │
                 ┌─────────┴──────────┐
                 │   Backend / API     │  (new — FastAPI, Python)
                 │  - auth             │
                 │  - domain services  │  ← ported from stats_engine/
                 │  - provider adapter │     awards_engine/, largely as-is
                 │  - sync jobs        │
                 └──┬───────────────┬──┘
                     │               │
          ┌──────────▼───┐   ┌───────▼─────────┐
          │  ESPN Adapter │   │  future: Yahoo /│
          │ (espn_api,    │   │  Sleeper adapter │  (not built yet)
          │  same lib)    │   └──────────────────┘
          └───────────────┘

                 ┌────────────────────┐
                 │   Web frontend      │  (new — Next.js/React,
                 │  mobile-first,      │   talks to backend over HTTP)
                 │  responsive         │
                 └────────────────────┘

                 (later, unchanged)
                 Fantasy_Helper Discord bot
                 keeps running independently,
                 OR eventually becomes a thin
                 client of the same backend API
                 — that decision comes much later,
                 not in Phase 1.
```

### Recommended technology choices, with reasoning

I'm giving you a recommendation per system as the master prompt asks, not
just picking for you silently. **These are the "major architectural
decisions" — please approve or push back before Phase 1 starts.**

**Backend language/framework: Python + FastAPI**

- *Why not switch languages:* Your existing `stats_engine/` and
  `awards_engine/` modules are real, working, tested-against-real-data Python
  code with zero Discord coupling. Rewriting them in Node/TypeScript to match
  a JS frontend would mean re-deriving award/stat logic you've already gotten
  right (e.g. the `pct_diff >= 0.15` clutch threshold, the regular-season-only
  award rule) with real risk of introducing subtle bugs. Keeping Python lets
  us port these modules into the new backend nearly unchanged.
- *Why FastAPI specifically:* it's async (matches your existing `asyncpg`
  code, no rewrite to sync), has automatic request validation and
  auto-generated API docs (useful for you as a beginner — you get a
  browsable `/docs` page for free), and is currently one of the most
  widely-used Python API frameworks, so you won't be stuck on niche tooling.
- *Alternative considered:* Django REST Framework — more batteries-included
  (built-in admin, ORM, auth) but heavier, sync-first (would fight your
  existing async code), and more opinionated than you need starting out.
  I don't recommend it here.

**Database: keep PostgreSQL, evolve the schema rather than replace it**

- Your existing schema (see below) is well-normalized and already separates
  provider IDs (`espn_member_id`, `espn_team_id`) from internal IDs
  (`owner_id`, `teams_by_season.id`). That's exactly the "provider data vs.
  internal normalized data" separation the master prompt calls for. I
  recommend extending it (adding `users`/auth tables, league-config tables)
  rather than redesigning it from scratch.
- *ORM decision, deferred:* raw `asyncpg` SQL works fine at this size and is
  what the existing code already uses. Once the schema grows (multi-league,
  auth, configurable scoring), an ORM like SQLAlchemy (async mode) or a
  migration tool like Alembic will pay off for managing schema changes safely
  across your Mac and Windows machines. I'd bring this up again at the start
  of Phase 2 rather than decide it now.

**Frontend: Next.js (React), mobile-first responsive web, not a native app yet**

- *Why not native (Swift/Kotlin) apps first:* two native codebases (iOS +
  Android) plus a backend is a lot for a beginner-led solo project to
  maintain, and every feature would need to be built twice. A responsive,
  mobile-first web app reachable from any phone browser gets your league
  members something usable in far less time, and can later be wrapped as a
  PWA (installable, works offline-ish, home-screen icon) without a rewrite.
- *Why Next.js over plain React:* built-in routing, easy deployment (Vercel's
  free tier is a natural fit and has excellent Next.js support), and
  server-rendering options that help mobile load speed — directly relevant
  to your "fast loading on phones" requirement.
- *Alternative considered:* React Native (one codebase, real native apps) —
  genuinely reasonable, and worth revisiting once the backend/API is stable
  and you know the product has legs. I don't recommend starting there: it's
  more setup complexity for a beginner and doesn't let you validate the
  product with your league faster than a website would.

**Hosting (recommendation, not yet acted on):**
- Backend: Railway or Render (both have simple Python + Postgres support,
  free/cheap tiers, straightforward env var management — matches your
  `_require()` fail-loudly config pattern well).
- Frontend: Vercel (built for Next.js specifically).
- Database: managed Postgres from the same host as the backend, or
  Supabase/Neon (your own `.env.example` and schema comment already suggest
  you've considered these — good instinct, I'd keep it).

**Auth (flagged as a major decision — not implemented, discuss before Phase 5):**
- Do **not** ask users for their ESPN password. ESPN has no public OAuth flow
  for third-party apps; the only realistic way to read a private league is
  the same cookie-based approach `Fantasy_Helper` already uses
  (`ESPN_S2`/`ESPN_SWID`), which the *user* would need to extract from their
  own browser and paste in — same trust model as today, just moved from you
  running it once to each user doing it themselves (or you continuing to run
  ingestion centrally and just adding accounts on top). For *app* login
  (distinct from ESPN data access), I'd recommend a standard approach —
  email/password or OAuth via Google/Discord — once we reach Phase 5. Full
  options/tradeoffs discussion belongs in that phase, not decided now.

### What Phase 1 will NOT include yet
Multi-league support, Yahoo/Sleeper adapters, mobile native apps, two-way
ESPN sync (write operations), and a generic "configurable award engine" are
all real future goals from your product vision, but building them now would
violate "do not over-engineer before it's needed." Phase 1 targets a working
skeleton for *your* league only, provider = ESPN only, read-only.

---

## Existing database schema (as found, unmodified)

```
owners
  owner_id PK, espn_member_id, discord_user_id, display_name

teams_by_season
  id PK, season, espn_team_id, owner_id FK→owners, team_name
  UNIQUE(season, espn_team_id)

matchups
  id PK, season, week, home_team_id FK, away_team_id FK,
  home_score, away_score, home_projected, away_projected, is_playoff

rosters
  id PK, season, week, team_id FK, player_name, position,
  lineup_slot, points_scored, points_projected

weekly_team_stats
  id PK, season, week, team_id FK, bench_points, luck_score,
  chaos_score, clutch_score, choke_score, power_rank
  UNIQUE(season, week, team_id)

owner_memory_profiles
  owner_id PK/FK, tags JSONB, notes JSONB, updated_at

rivalries
  id PK, owner_a_id FK, owner_b_id FK, all_time_wins_a/b,
  last_matchup_season/week, biggest_blowout_pts

burn_history
  id PK, owner_id FK, season, week, attack_angle, generated_text

excluded_topics
  id PK, owner_id FK, topic

chug_scores
  id PK, discord_user_id, video_url, chug_time_seconds,
  smoothness_score, hype_score, final_score

system_health_log
  id PK, job_name, status, detail, ran_at
```

This is a solid foundation to build the new schema on top of — see
MIGRATION_MAP.md for what I'd add vs. reuse as-is.
