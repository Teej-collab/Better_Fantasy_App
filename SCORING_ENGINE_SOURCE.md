# Scoring Engine Data Source — Verification

Phase D of the ESPN-independence pivot (see `TODO.md`) needs a source of
raw per-player NFL stats to compute this league's own fantasy points
from, now that ESPN's private fantasy API is no longer this app's
source of truth for rosters/lineups. This document records what's
actually verified about ESPN's **public** boxscore endpoint as that
source, using the same VERIFIED/ASSUMED/NEEDS CAPTURE labeling
`ESPN_LINEUP_WRITE.md` established.

## Verified (2026-08-26, real capture against a completed game)

**Endpoint:** `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event={id}`
— the same public, unauthenticated, keyless host already used for
`app/providers/nfl_scoreboard.py` and Gamecast's ESPN provider. No new
dependency, no new credentials.

**Verified against a real event** (`401873286`, Raiders @ Texans,
final score) via a temporary debug route hit through the deployed
Railway backend (this sandbox's own network egress to ESPN is blocked
by Akamai bot protection — Railway's isn't, and the app already relies
on this exact host successfully every day):

- `boxscore.players[]` — one entry per team, each with a `statistics[]`
  array of stat categories: `passing`, `rushing`, `receiving`,
  `fumbles`, `defensive`, `interceptions`, `kickReturns`, `puntReturns`,
  `kicking`, `punting`. Each category has:
  - `keys` — stable, programmatic field names (e.g.
    `["completions/passingAttempts", "passingYards", "yardsPerPassAttempt",
    "passingTouchdowns", "interceptions", "sacks-sackYardsLost", "adjQBR",
    "QBRating"]` for passing) — **use these, not `labels`** (the
    human-readable column headers, e.g. `"YDS"`), for engine code.
  - `athletes[]` — one entry per player who recorded that category's
    stats, each with `athlete.id` (ESPN's numeric player id — the same
    `espn_player_id` `players.espn_player_id` already crosswalks to)
    and `stats[]` (string values, positionally matching `keys`).
- `boxscore.teams[]` — team-level totals per game (`totalYards`,
  `turnovers`, `fumblesLost`, `interceptions`, etc.) via the same
  `statistics[]` shape. No explicit "points allowed" field, but that's
  trivially the opposing team's final score, already available from
  `app/providers/nfl_scoreboard.py`'s own scoreboard read. "Yards
  allowed" for a team's D/ST = the opponent's own `totalYards` value
  from this same array.

**Verdict: sufficient for the bulk of this league's real scoring
volume** — passing/rushing/receiving yards+TDs+INTs, receptions,
fumbles lost, kicking (FG made/attempted, XP made/attempted — though
FG-by-distance-bucket needs pairing with play-by-play or the `kicking`
category's `longFieldGoalMade`/individual attempt data, not yet
captured at attempt-level granularity), and defensive
sacks/tackles/INTs/fumble recoveries are all directly present with
real per-player identity.

## Known gap — NOT captured, needs a follow-up spike before relying on it

The stat category tables above have **no explicit fields** for:
- 2-point conversions (passing/rushing/receiving) — this league's
  scoring has all three at 2 pts each.
- Blocked punts/PATs/FGs, and blocked-kick return TDs.
- Safeties (2-pt team safety, 1-pt individual safety per this league's
  misc scoring section).
- Individual field-goal makes/misses by exact distance bucket (this
  league's kicking scoring is bucketed 0-39/40-49/50-59/60+, and the
  `kicking` category only gives game totals + longest make, not a
  per-attempt list).

These are all real but rare events — likely present in `scoringPlays`
(a top-level key on the same summary response, not yet captured/
parsed) or `drives`/play-by-play text rather than the boxscore
`statistics` tables. **Decision: ship the initial scoring engine
covering the verified bulk-stat categories above, explicitly excluding
these from v1** (i.e., undercounting these specific rare events rather
than guessing at a shape), and validate the gap's real size by
comparing engine output against this league's own historical
ESPN-computed `rosters.points_scored` for 2023-2025 (see `TODO.md`'s
Phase D entry) — if the discrepancy is negligible in practice, this
gap may not be worth chasing further; if it's not, that's the trigger
to capture `scoringPlays`'s real shape and close it.

## Not investigated

Individual FG make/miss by distance (see gap above) may actually be
derivable from `drives`/play-by-play descriptions (ESPN's play text
typically reads like `"J. Smith 42 Yd Field Goal"`) rather than a
clean structured field — worth checking during the historical-
validation pass above before assuming a parsing project is needed.

## Team D/ST — verified and built (2026-08-26)

Also verified, same real-event capture:

- `header.competitions[0].competitors[]` — each has `team.abbreviation`
  and `score` (string) — this is where a team's final score actually
  lives (not in `boxscore.teams[]`, which has no score field at all).
- `boxscore.teams[].statistics[]` entries have `displayValue` (a string,
  e.g. `"400"`) for the actual number — `value` was seen as `"-"` in
  the real capture for `totalYards`, so `displayValue` is the field to
  parse, not `value`.

`app/providers/nfl_stats/espn_public.py`'s `parse_team_dst_stats`
builds one stat line per team (keyed by ESPN's team abbreviation,
matching Sleeper's own DEF `sleeper_player_id` convention): points/
yards allowed are tiered from the **opponent's** score/`totalYards`,
and sacks/INTs/fumble recoveries/return-TDs are summed from that
team's own players across the `defensive`/`interceptions`/`fumbles`/
`kickReturns`/`puntReturns` categories already documented above.

Two known simplifications, documented in code rather than guessed
around:
- `fumblesRecovered` doesn't distinguish recovering the opponent's
  fumble (a real defensive play) from recovering your own team's
  fumble (e.g. a QB falling on his own bad snap) — summed as-is, a
  small possible overcount.
- A kick/punt return TD is credited to **both** the individual returner
  and the team D/ST — confirmed intentional, not a bug: this league's
  own scoring screenshots list it under both the Team Defense/Special
  Teams and Miscellaneous sections at the same point value.

Still not built: the rare-event gaps above (2pt conversions, blocked
kicks/blocks, safeties) apply to team D/ST scoring too (blocks and
safeties are specifically D/ST categories in this league's rules) —
same "ship v1 without them, validate the real gap size against
historical data" decision.
