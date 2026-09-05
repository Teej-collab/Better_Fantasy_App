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

## Field-goal-by-yardage and tackles — CLOSED (2026-09)

Both of these used to be in the "known gap" list below; they're real,
scored stat categories now (`app/providers/nfl_stats/espn_public.py`):

- **`fg_yds`** (0.1 pt/yard by default, commissioner-adjustable in
  Settings > Scoring Rules): the boxscore's `kicking` category only
  ever gave game totals, as suspected below — but the top-level
  `scoringPlays` array (sibling to `boxscore`, not nested under it)
  turned out to have real per-kick text like `"Brandon Aubrey 41 Yd
  Field Goal"`, exactly the shape guessed at in the old "Not
  investigated" note. No athlete id on that play itself, though — real
  player attribution comes from cross-referencing which single athlete
  the SAME team's `kicking` boxscore category credits that game (see
  `_parse_fg_yards_by_player`'s own docstring for the full reasoning,
  including why a team with more than one credited kicker is skipped
  rather than guessed at). Verified live against event `401772510`
  (DAL @ PHI): Brandon Aubrey's real 41+53 make and Jake Elliott's real
  58 both reproduced exactly.
- **`def_tackle`**: the `defensive` category's `totalTackles`/
  `soloTackles` fields were already being fetched for sacks; they were
  just never mapped before. Not position-scoped in ESPN's own data —
  whoever recorded a real tackle shows up here, including a QB after
  his own pick gets returned (verified live, same event: Dak Prescott
  really did record 1 tackle in that game, and it's captured exactly).

**Still NOT captured** (unchanged, no new spike done on these): missed
field goals (a miss doesn't appear in `scoringPlays` at all, and isn't
distance-tagged in the boxscore's makes/attempts ratio either — a real,
separate gap), 2-point conversions, blocked kicks, safeties. All are
real but rare events, likely also derivable from `scoringPlays` given
that FG-by-yardage turned out to be — a real follow-up, not attempted
here.

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
