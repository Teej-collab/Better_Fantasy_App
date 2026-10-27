"""
Real, data-driven draft grades — see migration 03100a8a1874 for the
original reasoning and c2e4a6b8d0f3 for the change below. Projections
are still the only input (every drafted player gets a real ESPN season
projection before the draft). There is no real market-consensus ADP
anywhere in this app — players.search_rank is a single-source (Sleeper)
proxy, kept OUT of this formula and used only as narrative color in
app/domain/draft_narratives.py.

What changed (2026-10-27): grades used to rank by the total projected
points of every player drafted. QBs carry the biggest season
projections, so a team that drafted four QBs graded near the top on
points it could never start. Now a team is graded on:

1. Value over replacement: a player is worth his projection minus what
   the best few undrafted players at his position project (what's free
   on waivers), never below zero.
2. The best lineup the roster can start: the league's real starter
   slots (draft_config.roster_slots), single-position slots first, then
   flex slots from what's left.
3. A little for bench depth: BENCH_WEIGHT of a backup's value, at most
   one backup per starter at that position, and none for K or DEF.
4. Pick value, PICK_VALUE_WEIGHT of the grade: each non-keeper pick
   gains or loses rounds against the market — the player's ADP in the
   copy the draft was pinned to (app/domain/adp.py), else his rank on
   the league's own value board (every draftable player ranked by value
   over replacement). Taken later than that is a steal. Capped at
   MAX_ROUNDS_PER_PICK so one late flyer doesn't swing a grade.
   Auctions skip this — pick order there is just nomination order.

Projections are the ones saved when the draft started
(draft_projection_snapshots) when there are any, so a draft is judged
on what was known that day.

The lineup and pick value are each turned into a league percentile
first, then blended, so the two scales mix fairly.

Percentile-rank buckets, not a z-score cutoff: with only ~12 real data
points (one per team), a z-score (mean +/- N*stdev) is unstable and
sensitive to a single outlier team's total. Rank-based percentile
buckets always produce the same distribution shape regardless of how
tightly the real scores happen to cluster in a given year.
"""
import json

from app.config import DEFAULT_LEAGUE_ID
from app.domain.adp import adp_for_draft
from app.domain.roster_slots import (
    DEFAULT_ROSTER_SLOTS,
    FLEX_SLOT_LABEL,
    IDP_FLEX_SLOT_LABEL,
    MULTI_POSITION_SLOTS,
    STARTER_SLOTS,
    SUPERFLEX_SLOT_LABEL,
    fantasy_position,
    is_eligible_for_slot,
)

# (minimum percentile, letter) — checked top-down, first match wins.
# For a 12-team league this lands on clean 2/2/4/2/2 boundaries; for a
# league of a different size the buckets still divide fairly, just not
# on perfectly even team-count lines.
GRADE_CUTOFFS = [(83.3, "A"), (66.6, "B"), (33.3, "C"), (16.6, "D"), (0.0, "F")]

# Replacement level is the average of this many best undrafted players
# at a position, so one overlooked sleeper doesn't set it alone.
REPLACEMENT_DEPTH = 3
BENCH_WEIGHT = 0.2
PICK_VALUE_WEIGHT = 0.25
MAX_ROUNDS_PER_PICK = 3.0
NO_BENCH_VALUE = {"K", "DEF"}
# Most restrictive flex first, so a superflex isn't spent on an RB the
# plain flex could have used.
_FLEX_ORDER = (FLEX_SLOT_LABEL, IDP_FLEX_SLOT_LABEL, SUPERFLEX_SLOT_LABEL)


def _letter_for_percentile(percentile: float) -> str:
    for cutoff, letter in GRADE_CUTOFFS:
        if percentile >= cutoff:
            return letter
    return "F"


def replacement_levels(undrafted: list[tuple[str, float]]) -> dict[str, float]:
    """Per position, the average projection of its REPLACEMENT_DEPTH
    best undrafted players. `undrafted` is (position, projection)."""
    by_pos: dict[str, list[float]] = {}
    for position, projected in undrafted:
        by_pos.setdefault(fantasy_position(position), []).append(projected)
    levels = {}
    for position, values in by_pos.items():
        best = sorted(values, reverse=True)[:REPLACEMENT_DEPTH]
        levels[position] = sum(best) / len(best)
    return levels


def _percentiles(scores: list[float]) -> list[float]:
    return [sum(1 for other in scores if other <= score) / len(scores) * 100 for score in scores]


def value_board(players: list[tuple[str, str, float]], replacement: dict[str, float]) -> dict[str, int]:
    """Overall rank (1 = most valuable) of each (player id, position,
    projection) by value over replacement, ties broken by projection."""
    ranked = sorted(
        players,
        key=lambda p: (max(0.0, p[2] - replacement.get(fantasy_position(p[1]), 0.0)), p[2]),
        reverse=True,
    )
    return {player_id: rank for rank, (player_id, _, _) in enumerate(ranked, start=1)}


def rounds_gained(pick_number: int, expected_pick: float, team_count: int) -> float:
    """Rounds of value one pick got: positive when the player went later
    than expected (his ADP or board rank)."""
    rounds = (pick_number - expected_pick) / team_count
    return max(-MAX_ROUNDS_PER_PICK, min(MAX_ROUNDS_PER_PICK, rounds))


def _pick_gain(pick, market: dict[str, float], board: dict[str, int], team_count: int) -> float | None:
    expected = market.get(pick["sleeper_player_id"]) or board.get(pick["sleeper_player_id"])
    return rounds_gained(pick["pick_number"], expected, team_count) if expected else None


async def pick_gains(conn, season: int, league_id: int) -> dict[str, float]:
    """sleeper_player_id -> rounds gained (steal +, reach -) for every
    non-keeper pick in a snake or linear draft; empty for an auction."""
    picks = await conn.fetch(
        "SELECT owner_id, pick_number, is_keeper, price, sleeper_player_id FROM draft_picks "
        "WHERE season = $1 AND league_id = $2 AND sleeper_player_id IS NOT NULL",
        season, league_id,
    )
    if not picks or any(p["price"] is not None for p in picks):
        return {}
    _, board, _ = await _load_board(conn, season, league_id)
    market = await adp_for_draft(conn, season, league_id)
    team_count = len({p["owner_id"] for p in picks})
    gains = {}
    for p in picks:
        if not p["is_keeper"]:
            gain = _pick_gain(p, market, board, team_count)
            if gain is not None:
                gains[p["sleeper_player_id"]] = gain
    return gains


async def _load_board(conn, season: int, league_id: int):
    """(replacement levels, value board, pool rows) — the pool is every
    draftable player with a projection plus everyone drafted."""
    pool = await conn.fetch(
        """
        SELECT p.sleeper_player_id, p.position, COALESCE(dps.projected_points, p.projected_points) AS projected,
               EXISTS (
                   SELECT 1 FROM draft_picks dp
                   WHERE dp.season = $1 AND dp.league_id = $2 AND dp.sleeper_player_id = p.sleeper_player_id
               ) AS drafted
        FROM players p
        LEFT JOIN draft_projection_snapshots dps
            ON dps.season = $1 AND dps.league_id = $2 AND dps.sleeper_player_id = p.sleeper_player_id
        WHERE COALESCE(dps.projected_points, p.projected_points) IS NOT NULL AND p.position IS NOT NULL
          AND (p.is_draftable OR EXISTS (
              SELECT 1 FROM draft_picks dp
              WHERE dp.season = $1 AND dp.league_id = $2 AND dp.sleeper_player_id = p.sleeper_player_id
          ))
        """,
        season, league_id,
    )
    replacement = replacement_levels([(r["position"], float(r["projected"])) for r in pool if not r["drafted"]])
    board = value_board([(r["sleeper_player_id"], r["position"], float(r["projected"])) for r in pool], replacement)
    return replacement, board, pool


def score_roster(
    roster: list[tuple[str, float]], roster_slots: dict[str, int], replacement: dict[str, float]
) -> tuple[float, float]:
    """(starter projected points, value score) for one team's drafted
    players, given as (position, projection)."""
    players = sorted(
        (
            {
                "position": position,
                "group": fantasy_position(position),
                "projected": projected,
                "value": max(0.0, projected - replacement.get(fantasy_position(position), 0.0)),
            }
            for position, projected in roster
        ),
        key=lambda p: (p["value"], p["projected"]),
        reverse=True,
    )
    single_slots = [s for s in STARTER_SLOTS if s not in MULTI_POSITION_SLOTS]
    starters = []
    for slot in [*single_slots, *_FLEX_ORDER]:
        for _ in range(roster_slots.get(slot, 0)):
            pick = next((p for p in players if is_eligible_for_slot(p["position"], slot)), None)
            if pick is None:
                break  # an unfilled starter slot is worth nothing
            players.remove(pick)
            starters.append(pick)

    backups_left: dict[str, int] = {}
    for p in starters:
        if p["group"] not in NO_BENCH_VALUE:
            backups_left[p["group"]] = backups_left.get(p["group"], 0) + 1
    bench_value = 0.0
    for p in players:
        if backups_left.get(p["group"], 0) > 0:
            backups_left[p["group"]] -= 1
            bench_value += p["value"]

    starter_projected = sum(p["projected"] for p in starters)
    value = sum(p["value"] for p in starters) + BENCH_WEIGHT * bench_value
    return round(starter_projected, 2), round(value, 2)


async def compute_draft_grades(conn, season: int, league_id: int = DEFAULT_LEAGUE_ID) -> int:
    """One row per owner who made at least one real pick this season:
    total drafted projected_points (kept for reference), the best
    starting lineup's projected points and the league average of it,
    the value score the grade ranks on, this team's percentile among
    the season's real drafters, and the letter grade. Idempotent — safe
    to call again (e.g. after a late pick correction) via UPSERT."""
    picks = await conn.fetch(
        """
        SELECT dp.owner_id, dp.pick_number, dp.is_keeper, dp.price, dp.sleeper_player_id,
               p.position, COALESCE(dps.projected_points, p.projected_points, 0) AS projected
        FROM draft_picks dp
        JOIN players p ON p.sleeper_player_id = dp.sleeper_player_id
        LEFT JOIN draft_projection_snapshots dps
            ON dps.season = dp.season AND dps.league_id = dp.league_id AND dps.sleeper_player_id = dp.sleeper_player_id
        WHERE dp.season = $1 AND dp.league_id = $2 AND dp.sleeper_player_id IS NOT NULL
        """,
        season, league_id,
    )
    if not picks:
        return 0

    replacement, board, _ = await _load_board(conn, season, league_id)
    market = await adp_for_draft(conn, season, league_id)

    raw_slots = await conn.fetchval(
        "SELECT roster_slots FROM draft_config WHERE season = $1 AND league_id = $2", season, league_id
    )
    roster_slots = (json.loads(raw_slots) if isinstance(raw_slots, str) else raw_slots) or DEFAULT_ROSTER_SLOTS

    rosters: dict[int, list] = {}
    for r in picks:
        rosters.setdefault(r["owner_id"], []).append(r)
    team_count = len(rosters)
    is_auction = any(r["price"] is not None for r in picks)

    teams = []
    for owner_id, roster in rosters.items():
        starter_projected, value = score_roster(
            [(r["position"], float(r["projected"])) for r in roster], roster_slots, replacement
        )
        gains = [
            g for g in (_pick_gain(r, market, board, team_count) for r in roster if not r["is_keeper"]) if g is not None
        ]
        pick_value = None if is_auction else round(sum(gains) / len(gains), 2) if gains else 0.0
        teams.append((owner_id, sum(float(r["projected"]) for r in roster), starter_projected, value, pick_value))

    league_avg = sum(t[1] for t in teams) / team_count
    league_avg_starter = sum(t[2] for t in teams) / team_count
    lineup_pct = _percentiles([t[3] for t in teams])
    if is_auction:
        blended = lineup_pct
    else:
        pick_pct = _percentiles([t[4] for t in teams])
        blended = [(1 - PICK_VALUE_WEIGHT) * lp + PICK_VALUE_WEIGHT * pp for lp, pp in zip(lineup_pct, pick_pct)]
    final_pct = _percentiles(blended)

    for (owner_id, total, starter_projected, value, pick_value), percentile in zip(teams, final_pct):
        letter = _letter_for_percentile(percentile)
        await conn.execute(
            """
            INSERT INTO draft_grades
                (season, league_id, owner_id, total_projected_points, league_avg_projected_points,
                 starter_projected_points, league_avg_starter_projected_points, value_score,
                 pick_value_rounds, percentile, letter_grade)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ON CONFLICT (season, league_id, owner_id) DO UPDATE SET
                total_projected_points = EXCLUDED.total_projected_points,
                league_avg_projected_points = EXCLUDED.league_avg_projected_points,
                starter_projected_points = EXCLUDED.starter_projected_points,
                league_avg_starter_projected_points = EXCLUDED.league_avg_starter_projected_points,
                value_score = EXCLUDED.value_score,
                pick_value_rounds = EXCLUDED.pick_value_rounds,
                percentile = EXCLUDED.percentile,
                letter_grade = EXCLUDED.letter_grade,
                computed_at = now()
            """,
            season, league_id, owner_id, total, league_avg, starter_projected, league_avg_starter, value,
            pick_value, percentile, letter,
        )
    return team_count


async def get_draft_grade(conn, season: int, owner_id: int, league_id: int = DEFAULT_LEAGUE_ID):
    return await conn.fetchrow(
        "SELECT * FROM draft_grades WHERE season = $1 AND league_id = $2 AND owner_id = $3",
        season, league_id, owner_id,
    )


async def get_draft_grades_for_season(conn, season: int, league_id: int = DEFAULT_LEAGUE_ID):
    return await conn.fetch(
        """
        SELECT dg.*, o.display_name AS owner_name
        FROM draft_grades dg JOIN owners o ON o.owner_id = dg.owner_id
        WHERE dg.season = $1 AND dg.league_id = $2
        ORDER BY dg.percentile DESC
        """,
        season, league_id,
    )
