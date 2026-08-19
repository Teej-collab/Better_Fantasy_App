# PROJECT_STATE.md

Status of `Fantasy_Helper` as of the Phase 0 audit (Aug 2026), based on direct
inspection of the repository (`origin: github.com/Teej-collab/Fantasy_Helper`,
single commit: "Initial fantasy football bot implementation").

**Important correction to the working assumption going in:** the master prompt
describes Fantasy_Helper as "an existing working Discord fantasy football bot."
Based on the code, that's not quite accurate yet. The repo's own README says it
plainly: *"This is a scaffold, not a working bot yet."* About 40% of files are
real, tested-against-real-ESPN-data implementations; the rest are stub files
with `TODO(phase N)` markers describing what still needs to be built. This
matters for planning — see IMPLEMENTED vs PLANNED below. I'm flagging this per
the instruction not to turn assumptions into facts.

---

## IMPLEMENTED (real logic, not stubs)

**Ingestion (`scripts/sync_*.py`, `scripts/compute_*.py`)**
- `sync_teams.py`, `sync_matchups.py`, `sync_rosters.py`, `sync_rivalries.py`,
  `sync_champions.py` — pull real data from ESPN via the `espn_api` library and
  upsert into Postgres. Idempotent (`ON CONFLICT DO UPDATE`).
- `compute_bench_points.py`, `compute_luck_scores.py`, `compute_boom_bust.py`,
  `compute_clutch_choke.py`, `compute_chaos_scores.py`, `compute_power_ranks.py`,
  `compute_chug_debts.py`, `compute_bench_crimes.py`, `compute_season_awards.py`,
  `compute_team_projections.py` — real statistical calculations against the DB.
- `refresh_pipeline.py` orchestrates all of the above in dependency order, and
  is resilient to partial failure (one failed step doesn't block the rest).

**Domain / stats logic (`bot/stats_engine/`, `bot/awards_engine/`)**
- `team_profile.py`, `season_awards.py`, `weekly_awards.py`,
  `determine_season_awards.py`, `expected_score.py`, `bench_crime.py`,
  `power_rank.py`, `luck.py`, `boom_bust.py`, `streaks.py` — all real. These are
  pure functions that take an `asyncpg` connection and return dicts; they do
  **not** import Discord. This is a good sign — the domain logic is already
  loosely coupled from the presentation layer, which will make extraction into
  a backend service much easier than if it were tangled into Discord command
  handlers.
- `chug_debt.py`, `team_projections.py`, `chaos.py`, `matchup.py` are stubs
  (13–17 lines, `TODO(phase N)`).

**ESPN ingestion core (`bot/ingestion/`)**
- `espn_client.py` — minimal real helper (`get_current_week`).
- `normalize.py`, `health_check.py` are stubs.

**Resolver (`bot/resolver/resolver.py`)**
- `normalize()` (name normalization) is real. `resolve_owner()` is a real,
  working nickname/fuzzy-match lookup against the DB. A larger fuzzy-match port
  from an older version of the bot is still marked `TODO(phase 2)`.

**Narrative engine (`bot/narrative_engine/`)**
- `llm_client.py`, `payload_builder.py`, `attack_angles.py` are real. This is
  the most architecturally interesting part of the existing system: it builds
  a **deterministic facts payload** from stats-engine output, then hands that
  to Claude (`claude-sonnet-4-6`) to write the roast/hype text. The LLM never
  decides who won, who choked, or what the numbers are — it only narrates
  facts computed elsewhere. That's exactly the separation the master prompt
  requires ("AI must NOT control core fantasy football calculations"). Good
  precedent to carry forward.
- `owner_profiles.py` (in `bot/memory/`) is a stub.

**Chug Analyzer (`bot/chug_analyzer/`)**
- This is a real computer-vision pipeline, not a stub: `pose_detection.py` uses
  MediaPipe hand/face landmarks to detect can-to-mouth contact from video,
  `audio_analysis.py` extracts "hype" energy from the audio track, `scoring.py`
  combines timing/smoothness/hype into a final score, `analyzer.py` wires it
  together. Genuinely implemented, tuned against a real test video per its own
  comments. This is unusual functionality for a fantasy bot (it's a league
  drinking-game feature) — worth deciding explicitly whether it belongs in the
  web platform's first version or stays Discord-only long-term.

**Discord layer (`bot/discord_bot/`)**
- Real, non-trivial: `commands/team.py` (182 lines — career/season profile
  embeds with dropdown), `commands/awards_leaderboard.py` (141),
  `commands/chug_leaderboard.py` (134), `commands/chug_status.py` (72),
  `embeds/recap_embed.py`, `embeds/preview_embed.py`, `scheduler/jobs.py` (184
  — weekly automated recap/preview posts with health logging).
- Most other slash commands (`luck.py`, `chaos.py`, `power.py`, `rivalry.py`,
  `matchup.py`, `player.py`, `benchcrime.py`, `history.py`) are **7-line
  stubs** — registered as commands but not wired to the real stats engine yet.

**Database (`db/schema.sql`)**
- Real, well-designed Postgres schema. Not a stub. See ARCHITECTURE.md for
  the full breakdown.

**Config / secrets (`bot/config.py`, `.env.example`, `.gitignore`)**
- Real and done correctly: every secret loads from environment variables, the
  app fails loudly (`RuntimeError`) if a required one is missing, `.env` is
  gitignored. No hardcoded credentials found anywhere in the scanned code.

---

## PARTIALLY IMPLEMENTED

- **Scheduler** (`bot/scheduler/jobs.py`) — the recap/preview auto-posting
  jobs are real and reasonably careful (idempotency check via
  `system_health_log`, graceful partial-failure handling). But
  `weekly_auto_post.py` in `discord_bot/tasks/` is a separate stub, so there
  may be duplicate/overlapping intent here — worth clarifying with you before
  we build on top of it.
- **Storage layer** (`bot/storage/db.py` is real — a connection pool getter;
  `bot/storage/models.py` is a stub — no CRUD abstraction yet, so every script
  currently writes raw SQL directly against `db/schema.sql` tables).
- **Testing** — `scripts/test_*.py` exist for most subsystems (luck score,
  boom/bust, chaos, clutch/choke, bench crime, power rank, narrative, recap,
  ESPN connection, DB connection) but these are **manual one-off scripts**
  ("Quick sanity check... eyeball whether results make sense"), not an
  automated test suite. The `tests/` directory exists and is empty — there is
  no `pytest` (or other) suite currently.

## PLANNED (stub only, `TODO(phase N)` marker present, not started)

`bot/ingestion/normalize.py`, `bot/ingestion/health_check.py`,
`bot/storage/models.py`, `bot/resolver/resolver.py` (partial — see above),
`bot/discord_bot/tasks/weekly_auto_post.py`, `bot/memory/owner_profiles.py`,
`scripts/monitor.py`, and 8 of the 12 Discord slash commands listed above.

## UNKNOWN

- Whether this bot has ever actually been deployed/run against production
  Discord + ESPN + Postgres. Nothing in the repo confirms a live deployment
  (no CI config, no Dockerfile, no hosting config found). Treat "does this
  currently run anywhere" as unconfirmed until you tell me.
- Whether `ESPN_S2`/`ESPN_SWID` cookies currently in your possession are still
  valid — these expire periodically per the bot's own `health_check.py` intent.
- Real historical data volume (how many seasons/weeks of real data exist in
  your actual Postgres instance — I only have the *schema*, not the *data*,
  since I audited a code export, not a database dump).

## DEPRECATED

Per the README, the following were already removed from an older version of
this project and should **not** be resurrected: 3 duplicate luck engines, 2
duplicate boom/bust engines, 2 duplicate clutch/choke engines, 4 narrative-ish
files, empty command stubs (`get_owner_profile.py`, `get_matchup.py`,
`add_matchup.py`), and an old empty `services/` layer. (I don't have
`bot-codebase-audit.md` itself — it wasn't in the zip you uploaded — so this
summary is from the README's own description of what happened, not from
reading that file directly.)

---

## Notable data-sensitivity finding (flagging per your security-first instruction)

`bot/discord_owner_map.json` and `bot/rivalry_map.py` contain **real first and
last names paired with real Discord user IDs** for your league members,
committed directly to source control. This isn't a "secret" in the
credential sense, but it is personal data about other people, committed in
plaintext to a repo. Two things worth deciding once we're in Phase 1:
1. Should this move out of source code and into the database (as
   `owners.discord_user_id` / `owners.display_name` already model it)?
2. If `Fantasy_Helper` or `Better_Fantasy_App` is ever made public, this data
   would be exposed. Worth an explicit decision, not an assumption.

I'm not treating this as a "secret" per the no-secrets-in-chat rule (it's
already visible to me because it's in the file you gave me, and it's not a
credential), but I want it on your radar as a privacy/design issue.
