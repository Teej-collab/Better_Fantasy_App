"""
The projection engine (2026-11-05). Every league gets projections in
its own scoring, whatever it is and wherever it came from (in-app,
mirrored ESPN, mirrored Sleeper).

Points are never projected directly. Each source produces a projected
STAT LINE in this app's own scoring categories (stat_lines.py):
  - 'model'   — this app's own model (model.py): team volume from Vegas,
                each player's share of it, efficiency pulled toward the
                position average, the opponent's defense;
  - 'sleeper' — Sleeper's public projections;
  - 'espn'    — ESPN's public projections (its default league, so no
                credentials).

distribution.py simulates each stat line's game a couple thousand times
for what averages can't give: the chance of a 100-yard game (bonuses),
of each D/ST points-allowed tier, and the floor/ceiling spread.
scoring.py turns a stat line plus those odds into a league's expected
points — exact for any mix of per-unit and threshold rules.

engine.py runs the week: history, Vegas lines, the three sources, then
every league's projections (league_player_projections, a weighted blend
of the sources; weights from accuracy.py's grading of past weeks).
Readers fall back to the old global player_weekly_projections where a
league has no engine projection yet.
"""
