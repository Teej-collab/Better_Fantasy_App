"""
Two season awards about managing, not just scoring (2026-10-27):

The Great White Buffalo — the one that got away. A player who leaves a
team (dropped or traded) and then has a big game in someone else's
starting lineup counts against the manager who most recently had him.
Only big games count (BIG_GAME points or more, started): the award is
about the pickup or trade that really paid off for someone else, not
steady bench filler. Re-acquiring him moves the blame to whoever let him
go last. The season total decides the award; the weekly recap calls out
each week's big ones (buffalo_moments).

Manager of the Year — whoever best managed the hand they were dealt,
scored out of 100 across the league's managers, each part ranked as a
percentile so no one part can run away with it:
- the comeback (35): games climbed back from below .500, capped at
  twice the depth of the hole, plus half of the climb in the power
  rankings from their worst (Week 3 on) to their last. A team that
  started 10-0 has nothing to come back from, so winning a lot never
  wins this by itself.
- moves that worked (30): points scored in the starting lineup by
  players picked up or traded for during the season.
- adversity (20): projected points lost from the Week 1 lineup to
  games those starters missed (injury, suspension, anything but a bye).
- lineup calls (15): fewest bench-crime points (bench_crimes).
Handed out only once the season is over (the title game decided), so
it never reads as a midseason race.

Both read roster_history (every team's weekly lineup), so they work the
same for synced and app-run leagues.
"""
from collections import defaultdict

BIG_GAME = 15.0
_BENCH = ("BE", "IR", "TAXI")

GREAT_WHITE_BUFFALO = "Great White Buffalo"
MANAGER_OF_THE_YEAR = "Manager of the Year"

WEIGHTS = {"comeback": 35, "moves": 30, "adversity": 20, "lineup": 15}
POWER_RANK_FROM_WEEK = 3


def buffalo_moments(rows: list[dict], big_game: float = BIG_GAME) -> list[dict]:
    """rows: one per (week, team, player) — week, team_id, player_id,
    started, points. Returns each big started game by a player the
    team got from another team: week, player_id, from_team (who let him
    go most recently), to_team, points."""
    by_player: dict[str, dict[int, list[dict]]] = defaultdict(lambda: defaultdict(list))
    for r in rows:
        by_player[r["player_id"]][r["week"]].append(r)

    moments = []
    for player_id, weeks in by_player.items():
        holder = blame = None
        for week in sorted(weeks):
            week_rows = weeks[week]
            teams = {r["team_id"] for r in week_rows}
            # A player dropped mid-week after he played shows on both
            # teams that week; the one that isn't the old holder is new.
            newcomer = next((t for t in sorted(teams) if t != holder), None)
            if holder is None:
                holder = newcomer
            elif newcomer is not None:
                blame, holder = holder, newcomer
            for r in week_rows:
                if (
                    r["team_id"] == holder and blame is not None and r["started"]
                    and float(r["points"] or 0) >= big_game
                ):
                    moments.append({
                        "week": week, "player_id": player_id, "from_team": blame,
                        "to_team": holder, "points": float(r["points"]),
                    })
    return moments


async def _lineup_rows(conn, season: int, league_id: int, through_week: int | None = None) -> list[dict]:
    rows = await conn.fetch(
        f"""
        SELECT rh.week, rh.team_id, rh.sleeper_player_id AS player_id,
               rh.lineup_slot NOT IN {_BENCH} AS started, COALESCE(pws.fantasy_points, 0) AS points
        FROM roster_history rh
        JOIN teams_by_season t ON t.id = rh.team_id
        LEFT JOIN player_week_stats pws
            ON pws.season = rh.season AND pws.week = rh.week
            AND pws.sleeper_player_id = rh.sleeper_player_id AND pws.league_id = t.league_id
        WHERE rh.season = $1 AND t.league_id = $2 AND ($3::int IS NULL OR rh.week <= $3)
        """,
        season, league_id, through_week,
    )
    return [dict(r) for r in rows]


async def _names(conn, season: int, league_id: int, player_ids: set[str]) -> tuple[dict, dict]:
    players = await conn.fetch(
        "SELECT sleeper_player_id, full_name FROM players WHERE sleeper_player_id = ANY($1::text[])",
        list(player_ids),
    )
    teams = await conn.fetch(
        "SELECT t.id, t.owner_id, t.team_name, COALESCE(o.goes_by, o.display_name) AS owner_name "
        "FROM teams_by_season t JOIN owners o ON o.owner_id = t.owner_id WHERE t.season = $1 AND t.league_id = $2",
        season, league_id,
    )
    return {r["sleeper_player_id"]: r["full_name"] for r in players}, {r["id"]: dict(r) for r in teams}


async def _opponents(conn, season: int, league_id: int) -> dict[tuple[int, int], int]:
    rows = await conn.fetch(
        "SELECT week, home_team_id, away_team_id FROM matchups WHERE season = $1 AND league_id = $2",
        season, league_id,
    )
    out = {}
    for r in rows:
        out[(r["week"], r["home_team_id"])] = r["away_team_id"]
        out[(r["week"], r["away_team_id"])] = r["home_team_id"]
    return out


async def great_white_buffalo(conn, season: int, league_id: int) -> dict | None:
    """The season's winner: owner_id, total, detail. None before any
    big game got away."""
    moments = buffalo_moments(await _lineup_rows(conn, season, league_id))
    if not moments:
        return None
    totals: dict[int, float] = defaultdict(float)
    by_player: dict[tuple[int, str], float] = defaultdict(float)
    for m in moments:
        totals[m["from_team"]] += m["points"]
        by_player[(m["from_team"], m["player_id"])] += m["points"]
    team_id = max(totals, key=lambda t: (totals[t], -t))
    (_, worst_player), worst_points = max(
        ((k, v) for k, v in by_player.items() if k[0] == team_id), key=lambda kv: kv[1]
    )
    players, teams = await _names(conn, season, league_id, {worst_player})
    if team_id not in teams:
        return None
    total = round(totals[team_id], 1)
    name = players.get(worst_player, "one player")
    detail = f"gave away {total:g} pts in big games"
    if round(worst_points, 1) < total:
        detail += f" ({name} alone: {round(worst_points, 1):g})"
    else:
        detail += f", all {name}"
    return {"owner_id": teams[team_id]["owner_id"], "total": total, "detail": detail}


async def buffalo_facts(conn, season: int, week: int, league_id: int, who) -> list[str]:
    """This week's big games by players someone let go, for the recap."""
    moments = [
        m for m in buffalo_moments(await _lineup_rows(conn, season, league_id, through_week=week))
        if m["week"] == week
    ]
    if not moments:
        return []
    players, teams = await _names(conn, season, league_id, {m["player_id"] for m in moments})
    opponents = await _opponents(conn, season, league_id)
    facts = []
    for m in sorted(moments, key=lambda m: -m["points"]):
        old, new = teams.get(m["from_team"]), teams.get(m["to_team"])
        if not old or not new:
            continue
        line = (
            f"Great White Buffalo watch (the one that got away): {who(old['team_name'])} let "
            f"{players.get(m['player_id'], 'a player')} go, and he scored {m['points']:.1f} for {who(new['team_name'])}"
        )
        if opponents.get((week, m["to_team"])) == m["from_team"]:
            line += f", against {who(old['team_name'])}"
        facts.append(line)
    return facts


def _percentiles(values: dict[int, float]) -> dict[int, float]:
    n = len(values)
    return {k: sum(1 for o in values.values() if o <= v) / n for k, v in values.items()}


def comeback_score(margins: list[int], power_ranks: list[int]) -> float:
    """margins: wins minus losses after each regular-season week.
    power_ranks: the weekly power rank from POWER_RANK_FROM_WEEK on."""
    games = 0.0
    if margins:
        low, final = min(margins), margins[-1]
        if low < 0:
            games = max(0.0, min(final - low, 2 * -low))
    rank_climb = max(0, max(power_ranks) - power_ranks[-1]) if power_ranks else 0
    return games + rank_climb / 2


def manager_scores(parts: dict[int, dict[str, float]]) -> dict[int, float]:
    """parts: team_id → comeback, moves, adversity, bench_crimes (lower
    is better). Returns team_id → score out of 100."""
    if not parts:
        return {}
    ranked = {
        "comeback": _percentiles({t: p["comeback"] for t, p in parts.items()}),
        "moves": _percentiles({t: p["moves"] for t, p in parts.items()}),
        "adversity": _percentiles({t: p["adversity"] for t, p in parts.items()}),
        "lineup": _percentiles({t: -p["bench_crimes"] for t, p in parts.items()}),
    }
    return {t: round(sum(WEIGHTS[k] * ranked[k][t] for k in WEIGHTS), 1) for t in parts}


async def season_is_over(conn, season: int, league_id: int) -> bool:
    if await conn.fetchval(
        "SELECT 1 FROM final_standings WHERE season = $1 AND league_id = $2 AND final_rank = 1", season, league_id
    ):
        return True
    return bool(await conn.fetchval(
        "SELECT 1 FROM playoff_bracket_matchups WHERE season = $1 AND league_id = $2 AND code = 'F' "
        "AND winner_team_id IS NOT NULL",
        season, league_id,
    ))


async def _manager_parts(conn, season: int, league_id: int) -> dict[int, dict]:
    games = await conn.fetch(
        "SELECT week, home_team_id, away_team_id, home_score, away_score FROM matchups "
        "WHERE season = $1 AND league_id = $2 AND is_playoff = FALSE AND home_score > 0 ORDER BY week",
        season, league_id,
    )
    margins: dict[int, list[int]] = defaultdict(list)
    for g in games:
        for team, mine, theirs in (
            (g["home_team_id"], g["home_score"], g["away_score"]),
            (g["away_team_id"], g["away_score"], g["home_score"]),
        ):
            last = margins[team][-1] if margins[team] else 0
            margins[team].append(last + (1 if mine > theirs else -1 if mine < theirs else 0))
    last_week = max((g["week"] for g in games), default=0)

    ranks = await conn.fetch(
        "SELECT s.team_id, s.week, s.power_rank FROM weekly_team_stats s JOIN teams_by_season t ON t.id = s.team_id "
        "WHERE s.season = $1 AND t.league_id = $2 AND s.week >= $3 AND s.week <= $4 AND s.power_rank IS NOT NULL "
        "ORDER BY s.week",
        season, league_id, POWER_RANK_FROM_WEEK, last_week,
    )
    power: dict[int, list[int]] = defaultdict(list)
    for r in ranks:
        power[r["team_id"]].append(r["power_rank"])

    rows = await _lineup_rows(conn, season, league_id, through_week=last_week)
    first_week: dict[int, int] = {}
    for r in rows:
        first_week[r["team_id"]] = min(first_week.get(r["team_id"], r["week"]), r["week"])
    original = {(r["team_id"], r["player_id"]) for r in rows if r["week"] == first_week[r["team_id"]]}
    moves: dict[int, float] = defaultdict(float)
    for r in rows:
        if r["started"] and (r["team_id"], r["player_id"]) not in original:
            moves[r["team_id"]] += float(r["points"] or 0)

    adversity = await conn.fetch(
        f"""
        WITH core AS (
            SELECT rh.team_id, rh.sleeper_player_id, COALESCE(rh.points_projected, 0) AS proj
            FROM roster_history rh JOIN teams_by_season t ON t.id = rh.team_id
            WHERE rh.season = $1 AND t.league_id = $2 AND rh.lineup_slot NOT IN {_BENCH}
              AND rh.week = (SELECT min(week) FROM roster_history r2 WHERE r2.season = $1 AND r2.team_id = rh.team_id)
        ),
        weeks AS (SELECT generate_series(2, $3::int) AS week)
        SELECT core.team_id, sum(core.proj) AS lost
        FROM core CROSS JOIN weeks
        JOIN players p ON p.sleeper_player_id = core.sleeper_player_id
        LEFT JOIN team_bye_weeks b ON b.season = $1 AND b.pro_team = p.pro_team
        LEFT JOIN player_week_stats pws
            ON pws.season = $1 AND pws.week = weeks.week AND pws.sleeper_player_id = core.sleeper_player_id
            AND pws.league_id = $2
        WHERE (b.bye_week IS NULL OR b.bye_week <> weeks.week)
          AND (pws.sleeper_player_id IS NULL OR pws.raw_stats = '{{}}'::jsonb)
        GROUP BY core.team_id
        """,
        season, league_id, max(last_week, 1),
    )
    lost = {r["team_id"]: float(r["lost"] or 0) for r in adversity}

    crimes = await conn.fetch(
        "SELECT c.team_id, sum(c.points_diff) AS pts FROM bench_crimes c JOIN teams_by_season t ON t.id = c.team_id "
        "WHERE c.season = $1 AND t.league_id = $2 AND c.week <= $3 GROUP BY c.team_id",
        season, league_id, last_week,
    )
    bench = {r["team_id"]: float(r["pts"] or 0) for r in crimes}

    return {
        team: {
            "comeback": comeback_score(margins[team], power.get(team, [])),
            "low": min(margins[team]),
            "final": margins[team][-1],
            "moves": round(moves.get(team, 0.0), 1),
            "adversity": round(lost.get(team, 0.0), 1),
            "bench_crimes": bench.get(team, 0.0),
        }
        for team in margins
    }


async def manager_of_the_year(conn, season: int, league_id: int) -> dict | None:
    """The winner once the season is over: owner_id, score, detail."""
    if not await season_is_over(conn, season, league_id):
        return None
    parts = await _manager_parts(conn, season, league_id)
    scores = manager_scores(parts)
    if not scores:
        return None
    team_id = max(scores, key=lambda t: (scores[t], -t))
    _, teams = await _names(conn, season, league_id, set())
    if team_id not in teams:
        return None
    p = parts[team_id]
    bits = []
    if p["low"] < 0:
        bits.append(f"climbed from {abs(p['low'])} games under .500")
    if p["adversity"] >= 1:
        bits.append(f"lost {p['adversity']:g} projected pts to missed games")
    if p["moves"] >= 1:
        bits.append(f"pickups and trades started for {p['moves']:g} pts")
    detail = f"{scores[team_id]:g}/100" + (f": {', '.join(bits)}" if bits else "")
    return {"owner_id": teams[team_id]["owner_id"], "score": scores[team_id], "detail": detail}
