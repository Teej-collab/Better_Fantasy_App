# MIGRATION_MAP.md

Maps real components found in `Fantasy_Helper` to what should happen to them
in `Better_Fantasy_App`. Built from actually reading the files, not filenames
alone. Categories: **reuse as-is**, **extract/port** (same logic, new home),
**redesign** (concept is right, implementation needs to change),
**deprecated** (leave in Fantasy_Helper only).

---

### Domain / Stats Engine

```
bot/stats_engine/team_profile.py, luck.py, boom_bust.py, power_rank.py,
bot/awards_engine/season_awards.py, weekly_awards.py, expected_score.py
↓
Real, pure, Discord-free functions (asyncpg conn in → dict out)
↓
EXTRACT / PORT — move into Better_Fantasy_App/backend/domain/, keep the
calculation logic itself unchanged (it's correct and already tested against
real data). Only the "shape" changes: instead of being called directly by a
Discord command, they get called by a FastAPI route handler.
↓
Backend/API: GET /teams/{id}/profile, GET /awards/{season}
↓
Web UI: Team Profile page, Awards page
```

### ESPN Ingestion

```
scripts/sync_teams.py, sync_matchups.py, sync_rosters.py,
bot/ingestion/espn_client.py
↓
Real, working, uses espn_api library against real ESPN league
↓
EXTRACT / PORT — becomes the ESPN provider adapter. Logic stays the same;
wrap it behind a FantasyProvider interface (per your multi-provider
principle) so a future Yahoo/Sleeper adapter can implement the same
interface without touching this code.
↓
Backend: providers/espn/adapter.py implementing sync_teams(), sync_matchups(),
sync_rosters() behind a common interface
```

### Refresh Pipeline

```
bot/ingestion/refresh_pipeline.py
↓
Real orchestration: runs sync steps then compute steps in dependency order,
tolerates partial failure
↓
EXTRACT / PORT, then REDESIGN triggering — the logic (what order things
run in, tolerate-partial-failure behavior) is good and should move as-is.
But how it's triggered needs to change: today it's called from an
in-process discord.ext.tasks loop. In the new backend it should be triggered
by a proper scheduler (e.g. APScheduler running inside the backend service,
or a hosted cron) so it doesn't depend on a Discord bot process being alive.
↓
Backend: scheduled job, independent of any client
```

### Resolver

```
bot/resolver/resolver.py — normalize(), resolve_owner()
↓
Real, working nickname/fuzzy-match lookup
↓
REUSE AS-IS (with light porting) — this becomes a backend utility used
wherever user-facing text needs to resolve to an owner_id (e.g. an admin
tool, a search box). Low priority to touch early.
```

### Narrative Engine

```
bot/narrative_engine/payload_builder.py, llm_client.py, attack_angles.py
↓
Real — builds deterministic facts from stats engine output, then Claude
narrates them. Good separation already (AI doesn't decide outcomes).
↓
EXTRACT / PORT — becomes a backend "narrative service." Facts stay
deterministic and server-computed; only the prose generation calls out to
Claude. This matches your AI Architecture principle exactly as already
built — nice, don't re-derive it differently.
↓
Backend: POST-computed field on Weekly Recap API responses
↓
Web UI: Weekly Recap page
```

### Discord Commands (real ones)

```
bot/discord_bot/commands/team.py (career/season profile + embed)
bot/discord_bot/commands/awards_leaderboard.py
bot/discord_bot/commands/chug_leaderboard.py, chug_status.py
↓
Real, but tightly coupled to discord.Embed formatting
↓
REDESIGN — the embed-building functions (build_career_embed, etc.) are
Discord-presentation code and should NOT move to the web app directly. But
the queries and data shape they're built from are already coming from the
ported domain functions above, so the web UI gets the same underlying data
through the API — it just renders it as a React component instead of a
Discord embed. Nothing here needs to be "figured out" again, just
re-presented.
↓
Web UI: Team Profile, Awards Leaderboard pages (same data, new presentation)
Discord bot: keeps its own embed code, calling the new backend API instead of
querying Postgres directly, once/if you decide to make Discord a thin client
(explicitly a later decision, not Phase 1)
```

### Discord Commands (stub-only, not yet built)

```
bot/discord_bot/commands/luck.py, chaos.py, power.py, rivalry.py,
matchup.py, player.py, benchcrime.py, history.py (all 7-line stubs)
↓
Not implemented anywhere yet
↓
NEW WORK, not a migration — since these were never built, there's nothing to
extract. Build the underlying domain queries once, in the backend, and let
both the web UI and (eventually) these Discord commands consume the same
API. No point finishing them in Discord first only to redo them for web.
```

### Chug Analyzer

```
bot/chug_analyzer/ (pose_detection.py, audio_analysis.py, scoring.py,
analyzer.py)
↓
Real computer-vision pipeline, genuinely implemented and tuned
↓
DECISION NEEDED (not decided by me) — this is real, working functionality,
but it's a fun/social league feature rather than core fantasy-football
domain logic, and it requires video upload + processing, which is a
meaningfully bigger web-app feature (file upload, storage, processing queue)
than anything else in Phase 1-4. I'd recommend deferring this to later in
the roadmap (it fits naturally under "Social Features" in
PRODUCT_REQUIREMENTS.md) rather than migrating it early, but it's your call
whether it stays Discord-only indefinitely or eventually gets a web version.
```

### Database Schema

```
db/schema.sql
↓
Real, well-normalized, already separates provider IDs from internal IDs
↓
REUSE AS FOUNDATION, then EXTEND — don't replace it. Phase 2/3 will add:
  - users / auth tables (app login, separate from owners)
  - a leagues table (today the schema implicitly assumes one league;
    multi-league support later needs this to become first-class)
  - league-level settings/config tables (scoring rules, roster rules) —
    currently nonexistent, and per your "flexible league engine" principle,
    should NOT be hardcoded
Everything currently in the schema (owners, teams_by_season, matchups,
rosters, weekly_team_stats, rivalries, burn_history, chug_scores,
system_health_log) stays, unmodified, as the core of the new schema.
```

### Config / Secrets Handling

```
bot/config.py — fail-loudly env var loading pattern
↓
REUSE THE PATTERN, not the file — the new backend will have its own
config module, but should copy this exact discipline: required secrets fail
fast at startup, nothing hardcoded, .env.example checked in with placeholders
only.
```

### Hardcoded League Data

```
bot/discord_owner_map.json, bot/rivalry_map.py
↓
Real data (owner names/Discord IDs, rivalry descriptions), hardcoded in
source rather than the database
↓
REDESIGN — move into the database (owners table already has
discord_user_id + display_name columns for exactly this; rivalries table
already exists for rivalry data, just needs a name/description/emoji/tier
columns added). This both fixes the "personal data committed to git" issue
flagged in PROJECT_STATE.md and is a prerequisite for the "no hardcoded
league culture" principle — you can't support other leagues later if a
single JSON file hardcodes this one's members.
```

### Testing

```
scripts/test_*.py — manual "eyeball the output" scripts
↓
Not an automated suite (no pytest, no assertions, tests/ dir is empty)
↓
NEW WORK in Better_Fantasy_App — once domain logic is ported, write real
pytest tests with assertions for it (award thresholds, luck score math,
etc.). The manual scripts are still useful as a reference for "what did we
manually verify already," but shouldn't be mistaken for regression coverage.
```

---

## Summary table

| Component | Verdict | Effort to port |
|---|---|---|
| stats_engine / awards_engine | Extract/port as-is | Low |
| ESPN sync scripts | Extract/port behind adapter interface | Low–Medium |
| refresh_pipeline | Port logic, redesign trigger mechanism | Medium |
| resolver | Reuse as-is | Low |
| narrative_engine | Extract/port as-is | Low |
| Discord embed code | Redesign as web components | New UI work, old data |
| Discord stub commands | New work (nothing to migrate) | New |
| chug_analyzer | Defer — decide later | High if pursued |
| db/schema.sql | Reuse as foundation, extend | Low (extend only) |
| config pattern | Reuse the pattern | Low |
| discord_owner_map.json / rivalry_map.py | Redesign into DB | Low–Medium |
| testing | New work | Medium |
