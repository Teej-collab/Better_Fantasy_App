"""
The league-level context for the weekly recap (2026-10, the
commissioner's notes): before the shit-talk, the recap should say how
the week went for the league as a whole — the way one of the guys would
tell it. Was it a big scoring week or a dud? Did the top power-ranked
teams collide? Is anyone still unbeaten or winless? Did running backs go
off, did a QB feed his own receiver, were there a pile of interceptions
or missed field goals? And for each game, why it went the way it did:
the injury that sank someone, the new pickup or returning star who
swung it, the guy who tried to carry a loser.

Everything here is a plain-English fact line built from real data (the
same discipline as narrative_engine._build_weekly_facts): matchups and
rosters back to 2023, this week's per-player raw stats and in-game
injuries, weekly_team_stats' power ranks, and the rivalries table. A
line is only emitted when the data says it's worth mentioning, so the
model isn't tempted to dress up a normal week as historic.
"""
import json
from collections import defaultdict
from statistics import mean
from typing import Callable

from app.queries import league as league_queries

STARTER_EXCLUDED_SLOTS = {"BE", "IR"}
# How far a position's average has to move from its season norm before
# the week is "RBs went off" / "a quiet week for QBs".
POSITION_SWING = 0.2
# A stat (interceptions, missed field goals, lost fumbles) is "a lot"
# at this multiple of the season's per-week average.
UNUSUAL_MULTIPLE = 1.5
INJURY_STATES = {"left", "ruled_out", "doubtful_return", "questionable_return"}

Who = Callable[[str], str]


def _starters(side: dict) -> list[dict]:
    return [p for p in side.get("roster") or [] if p["lineup_slot"] not in STARTER_EXCLUDED_SLOTS]


def _pts(p: dict) -> float:
    return float(p.get("points_scored") or 0)


def _stat(p: dict, *keys: str) -> float:
    raw = p.get("raw_stats") or {}
    return sum(float(raw.get(k) or 0) for k in keys)


_FG_MISS_KEYS = ("fg_miss_0_29", "fg_miss_30_39", "fg_miss_40_49", "fg_miss_50_plus")


def _results(matchups: list[dict]) -> list[tuple[dict, dict, dict, float]]:
    """(matchup, winner, loser, margin) for each decided game."""
    out = []
    for m in matchups:
        home, away = m["home"], m["away"]
        if home["score"] is None or away["score"] is None or home["score"] == away["score"]:
            continue
        winner, loser = (home, away) if home["score"] > away["score"] else (away, home)
        out.append((m, winner, loser, round(winner["score"] - loser["score"], 2)))
    return out


async def _earlier_weeks(conn, season: int, week: int, team_ids: list[int]) -> dict[int, dict[int, list[dict]]]:
    """{week: {team_id: [player rows]}} for every earlier week this
    season — the app's own lineups and stats (league_queries.
    get_rosters_for_week: roster_history snapshots), not the legacy
    `rosters` table, which is a stale ESPN copy."""
    out: dict[int, dict[int, list[dict]]] = {}
    for w in range(1, week):
        by_team = await league_queries.get_rosters_for_week(conn, season, team_ids, w)
        out[w] = {
            tid: [{**dict(r), "raw_stats": _decode(r["raw_stats"])} for r in rows]
            for tid, rows in by_team.items()
        }
    return out


def _decode(raw) -> dict:
    if isinstance(raw, str):
        return json.loads(raw)
    return raw or {}


async def _power_ranks_going_in(conn, season: int, week: int, league_id: int) -> dict[int, int]:
    if week <= 1:
        return {}
    rows = await conn.fetch(
        """
        SELECT team_id, power_rank FROM weekly_team_stats
        WHERE season = $1 AND week = $2 AND league_id = $3 AND power_rank IS NOT NULL
        """,
        season, week - 1, league_id,
    )
    return {r["team_id"]: r["power_rank"] for r in rows}


def _power_rank_facts(matchups: list[dict], ranks: dict[int, int], who: Who) -> list[str]:
    if not ranks:
        return []
    facts = []
    top4 = {tid for tid, rank in ranks.items() if rank <= 4}
    top4_games = []
    for m in matchups:
        home, away = m["home"], m["away"]
        if home["team_id"] in top4 and away["team_id"] in top4:
            top4_games.append(m)
    for m in top4_games:
        home, away = m["home"], m["away"]
        result = ""
        if home["score"] is not None and away["score"] is not None and home["score"] != away["score"]:
            winner, loser = (home, away) if home["score"] > away["score"] else (away, home)
            result = f" — {who(winner['team_name'])} won {winner['score']}-{loser['score']}"
        facts.append(
            f"Top-4 power-ranked showdown: #{ranks[home['team_id']]} {who(home['team_name'])} vs "
            f"#{ranks[away['team_id']]} {who(away['team_name'])}{result}"
        )
    if len(top4_games) == 2:
        facts.append("All four of the top-4 power-ranked teams played each other this week (notable)")
    for m, winner, loser, _margin in _results(matchups):
        wr, lr = ranks.get(winner["team_id"]), ranks.get(loser["team_id"])
        if wr and lr and wr - lr >= 5:
            facts.append(f"Upset: #{wr} power-ranked {who(winner['team_name'])} beat #{lr} {who(loser['team_name'])}")
    return facts


def _standings_shape_facts(standings: list, week: int, results, who: Who) -> list[str]:
    if not standings:
        return []
    unbeaten = [r for r in standings if r["losses"] == 0 and not r["ties"] and r["wins"] > 0]
    winless = [r for r in standings if r["wins"] == 0 and not r["ties"] and r["losses"] > 0]
    facts = []
    if not unbeaten and not winless:
        facts.append("Nobody in the league is undefeated and nobody is winless anymore")
    else:
        if unbeaten:
            facts.append("Still undefeated: " + ", ".join(f"{who(r['team_name'])} ({r['wins']}-0)" for r in unbeaten))
        else:
            facts.append("Nobody in the league is undefeated anymore")
        if winless:
            facts.append("Still winless: " + ", ".join(f"{who(r['team_name'])} (0-{r['losses']})" for r in winless))
        else:
            facts.append("Nobody in the league is winless anymore")
    # Who changed status this week.
    by_team = {r["team_id"]: r for r in standings}
    for _m, winner, loser, _margin in results:
        lrow, wrow = by_team.get(loser["team_id"]), by_team.get(winner["team_id"])
        if lrow and lrow["losses"] == 1 and lrow["wins"] == week - 1 and week > 1:
            facts.append(f"{who(loser['team_name'])} took their first loss this week and is no longer undefeated (notable)")
        if wrow and wrow["wins"] == 1 and wrow["losses"] == week - 1 and week > 1:
            facts.append(f"{who(winner['team_name'])} finally got their first win of the season (notable)")
    return facts


async def _scoring_environment_facts(conn, season: int, week: int, league_id: int, matchups, who: Who) -> list[str]:
    rows = await conn.fetch(
        """
        SELECT season, week, home_score, away_score FROM matchups
        WHERE league_id = $1 AND home_score IS NOT NULL AND away_score IS NOT NULL
          AND (season < $2 OR (season = $2 AND week <= $3))
        """,
        league_id, season, week,
    )
    by_week: dict[tuple[int, int], list[float]] = defaultdict(list)
    for r in rows:
        by_week[(r["season"], r["week"])] += [float(r["home_score"]), float(r["away_score"])]
    this = by_week.get((season, week))
    if not this:
        return []
    avg = mean(this)
    week_avgs = {k: mean(v) for k, v in by_week.items()}
    season_weeks = {k: v for k, v in week_avgs.items() if k[0] == season}
    facts = []
    line = f"League-wide scoring: {avg:.1f} points per team this week"
    others = [v for k, v in season_weeks.items() if k != (season, week)]
    if others:
        line += f" (season average before this week: {mean(others):.1f})"
    facts.append(line)

    ranked = sorted(week_avgs.items(), key=lambda kv: kv[1], reverse=True)
    pos = [k for k, _ in ranked].index((season, week)) + 1
    total = len(ranked)
    first_season = min(k[0] for k in week_avgs)
    if len(season_weeks) > 1:
        season_rank = sorted(season_weeks.values(), reverse=True).index(avg) + 1
        if season_rank == 1:
            facts.append("That's the highest-scoring week of the season so far (notable)")
        elif season_rank == len(season_weeks):
            facts.append("That's the lowest-scoring week of the season so far (notable)")
    if pos <= 3:
        facts.append(f"It's the #{pos} highest-scoring week in league history (of {total} weeks since {first_season}) (notable)")
    elif pos > total - 3:
        facts.append(f"It's the #{total - pos + 1} lowest-scoring week in league history (of {total} weeks since {first_season}) (notable)")

    all_scores = sorted((s for v in by_week.values() for s in v), reverse=True)
    sides = [s for m in matchups for s in (m["home"], m["away"]) if s["score"] is not None]
    if sides:
        top = max(sides, key=lambda s: s["score"])
        low = min(sides, key=lambda s: s["score"])
        top_rank = all_scores.index(float(top["score"])) + 1
        low_rank = len(all_scores) - max(i for i, s in enumerate(all_scores) if s == float(low["score"]))
        facts.append(f"High score of the week: {who(top['team_name'])} with {top['score']}")
        if top_rank <= 5:
            facts.append(f"That's the #{top_rank} single-week score in league history since {first_season} (notable)")
        facts.append(f"Low score of the week: {who(low['team_name'])} with {low['score']}")
        if low_rank <= 5:
            facts.append(f"That's the #{low_rank} lowest single-week score in league history since {first_season} (notable)")
    return facts


def _season_position_averages(earlier: dict[int, dict[int, list[dict]]]) -> dict[str, float]:
    by_pos: dict[str, list[float]] = defaultdict(list)
    for teams in earlier.values():
        for rows in teams.values():
            for p in rows:
                if p["lineup_slot"] not in STARTER_EXCLUDED_SLOTS and p.get("points_scored") is not None:
                    by_pos[p["position"]].append(_pts(p))
    return {pos: mean(v) for pos, v in by_pos.items() if v}


_POSITION_PLURAL = {
    "QB": "QBs", "RB": "running backs", "WR": "wide receivers", "TE": "tight ends", "K": "kickers",
    "DEF": "defenses", "D/ST": "defenses",
}


def _position_facts(matchups, season_avgs: dict[str, float]) -> list[str]:
    by_pos: dict[str, list[float]] = defaultdict(list)
    for m in matchups:
        for side in (m["home"], m["away"]):
            for p in _starters(side):
                if p.get("points_scored") is not None:
                    by_pos[p["position"]].append(_pts(p))
    facts = []
    for pos, scores in by_pos.items():
        norm = season_avgs.get(pos)
        if not scores or not norm:
            continue
        avg = mean(scores)
        name = _POSITION_PLURAL.get(pos, pos)
        if avg >= norm * (1 + POSITION_SWING):
            facts.append(f"Starting {name} went off: {avg:.1f} points each on average vs {norm:.1f} normally this season (notable)")
        elif avg <= norm * (1 - POSITION_SWING):
            facts.append(f"A quiet week for {name}: starters averaged {avg:.1f} vs {norm:.1f} normally this season (notable)")
    return facts


def _stack_facts(matchups, who: Who) -> list[str]:
    """A QB and his own receiver/tight end both started for the same
    fantasy team and both scored — 'QB fed his WR'."""
    stacks = []
    for m in matchups:
        for side in (m["home"], m["away"]):
            starters = _starters(side)
            for qb in (p for p in starters if p["position"] == "QB" and p.get("pro_team")):
                for rec in (p for p in starters if p["position"] in ("WR", "TE") and p.get("pro_team") == qb["pro_team"]):
                    if _pts(qb) >= 15 and _pts(rec) >= 15:
                        stacks.append((_pts(qb) + _pts(rec), side, qb, rec))
    stacks.sort(key=lambda s: s[0], reverse=True)
    return [
        f"{who(side['team_name'])}'s QB {qb['player_name']} fed his own {rec['position']} {rec['player_name']} "
        f"({_pts(qb):.1f} + {_pts(rec):.1f} points from the same {qb['pro_team']} offense)"
        for _total, side, qb, rec in stacks[:3]
    ]


def _season_mistake_averages(earlier: dict[int, dict[int, list[dict]]]) -> dict[str, float]:
    """Per-week averages of interceptions thrown, missed field goals and
    lost fumbles by this league's starters, earlier this season."""
    per_week = []
    for teams in earlier.values():
        totals = {"int": 0.0, "fg_miss": 0.0, "fum": 0.0}
        for rows in teams.values():
            for p in rows:
                if p["lineup_slot"] in STARTER_EXCLUDED_SLOTS:
                    continue
                totals["int"] += _stat(p, "pass_int")
                totals["fg_miss"] += _stat(p, *_FG_MISS_KEYS)
                totals["fum"] += _stat(p, "fum_lost")
        per_week.append(totals)
    if not per_week:
        return {}
    return {k: mean(w[k] for w in per_week) for k in ("int", "fg_miss", "fum")}


def _mistake_facts(matchups, results, averages: dict[str, float], who: Who) -> list[str]:
    facts = []
    totals = {"int": 0.0, "fg_miss": 0.0, "fum": 0.0}
    margin_by_team = {}
    for _m, winner, loser, margin in results:
        margin_by_team[loser["team_id"]] = (margin, "lost")
        margin_by_team[winner["team_id"]] = (margin, "won")
    for m in matchups:
        for side in (m["home"], m["away"]):
            for p in _starters(side):
                ints, misses, fums = _stat(p, "pass_int"), _stat(p, *_FG_MISS_KEYS), _stat(p, "fum_lost")
                totals["int"] += ints
                totals["fg_miss"] += misses
                totals["fum"] += fums
                result = margin_by_team.get(side["team_id"])
                tail = f"; {who(side['team_name'])} {result[1]} by {result[0]}" if result else ""
                if ints >= 3:
                    facts.append(f"{p['player_name']} threw {int(ints)} interceptions for {who(side['team_name'])}{tail} (notable)")
                if misses >= 2 or (misses >= 1 and result and result[1] == "lost" and result[0] < 4):
                    facts.append(f"{who(side['team_name'])}'s kicker {p['player_name']} missed {int(misses)} field goal(s){tail} (notable)")
    labels = {"int": "interceptions thrown", "fg_miss": "missed field goals", "fum": "lost fumbles"}
    for key, label in labels.items():
        norm = averages.get(key)
        if norm and totals[key] >= max(2, norm * UNUSUAL_MULTIPLE):
            facts.append(
                f"An unusual amount of {label} by the league's starters this week: {int(totals[key])} (about {norm:.1f} in a normal week) (notable)"
            )
    return facts


def _injury_facts(matchups, results, who: Who) -> list[str]:
    outcome = {}
    for _m, winner, loser, margin in results:
        outcome[winner["team_id"]] = ("won", margin)
        outcome[loser["team_id"]] = ("lost", margin)
    facts = []
    for m in matchups:
        for side in (m["home"], m["away"]):
            for p in _starters(side):
                injury = p.get("in_game_injury")
                if not injury or injury.get("state") not in INJURY_STATES:
                    continue
                proj = float(p.get("points_projected") or 0)
                line = (
                    f"{p['player_name']} got hurt during the game for {who(side['team_name'])} "
                    f"and finished with {_pts(p):.1f} points (projected {proj:.1f})"
                )
                res = outcome.get(side["team_id"])
                if res:
                    line += f"; {who(side['team_name'])} {res[0]} by {res[1]}"
                    if res[0] == "lost" and proj - _pts(p) > res[1]:
                        line += " — the injury likely cost them the game (notable)"
                facts.append(line)
    return facts


def _bright_spot_facts(results, who: Who) -> list[str]:
    facts = []
    for _m, _winner, loser, _margin in results:
        starters = [p for p in _starters(loser) if p.get("points_scored") is not None]
        if not starters:
            continue
        best = max(starters, key=_pts)
        if _pts(best) < 15:
            continue
        share = _pts(best) / loser["score"] if loser["score"] else 0
        carry = " — tried to put the team on his back" if share >= 0.25 else ""
        facts.append(f"Bright spot in {who(loser['team_name'])}'s loss: {best['player_name']} scored {_pts(best):.1f}{carry}")
    return facts


async def _arrival_and_return_facts(conn, season: int, week: int, earlier, matchups, results, who: Who) -> list[str]:
    """Starters who are new to their fantasy team this week (a pickup or
    trade) or back from injury (on IR, or a zero with no bye, the week
    before) and scored."""
    last_week = earlier.get(week - 1)
    if not last_week:
        return []
    byes = {
        r["pro_team"]: r["bye_week"]
        for r in await conn.fetch("SELECT pro_team, bye_week FROM team_bye_weeks WHERE season = $1", season)
    }
    won = {winner["team_id"]: margin for _m, winner, _l, margin in results}

    facts = []
    for m in matchups:
        for side in (m["home"], m["away"]):
            before_by_id = {p["player_id"]: p for p in last_week.get(side["team_id"]) or []}
            if not before_by_id:
                continue
            for p in _starters(side):
                if _pts(p) < 10:
                    continue
                before = before_by_id.get(p["player_id"])
                swing = ""
                if side["team_id"] in won and _pts(p) > won[side["team_id"]]:
                    swing = f" — more than {who(side['team_name'])}'s {won[side['team_id']]}-point margin of victory (notable)"
                if before is None:
                    facts.append(
                        f"{who(side['team_name'])}'s new pickup {p['player_name']} ({p['position']}) scored {_pts(p):.1f} "
                        f"in his first week on the team{swing}"
                    )
                elif before["lineup_slot"] == "IR" or (
                    before.get("points_scored") in (None, 0) and byes.get(before["pro_team"]) != week - 1
                ):
                    facts.append(
                        f"{p['player_name']} returned from injury for {who(side['team_name'])} and scored {_pts(p):.1f}{swing}"
                    )
    return facts


async def _power_ranking_facts(conn, season: int, week: int, league_id: int, who: Who) -> list[str]:
    """This week's power rankings (set the moment the week went final,
    before this recap is written), the big movers, and what stands out:
    lucky records, teams better or worse than their record, schedules."""
    from app.domain import power_rankings

    rows = await power_rankings.get_week_power_rankings(conn, season, week, league_id)
    if not rows:
        return []
    facts = [
        "Power rankings after this week: "
        + ", ".join(f"#{r['power_rank']} {who(r['team_name'])} ({r.get('record', '?')})" for r in rows)
    ]
    for r in rows:
        move = r.get("movement")
        if move is not None and move >= 3:
            facts.append(f"{who(r['team_name'])} climbed {move} spots in the power rankings to #{r['power_rank']} (notable)")
        elif move is not None and move <= -3:
            facts.append(f"{who(r['team_name'])} fell {-move} spots in the power rankings to #{r['power_rank']} (notable)")
        if r.get("note"):
            facts.append(f"Power rankings note on {who(r['team_name'])} (#{r['power_rank']}, {r.get('record')}): {r['note']}")
    return facts


async def _playoff_race_facts(conn, season: int, week: int, league_id: int, standings: list, who: Who) -> list[str]:
    """Who's in, who's chasing, and — once the end is close — who has
    clinched, who's out, and what the bubble teams need. Always from the
    actual standings (the commissioner's rule: playoff spots go by
    record, then points for); power rankings only ever describe how
    hard a bubble team's remaining schedule is."""
    from app.domain import power_rankings

    count = await league_queries.get_playoff_team_count(conn, season, league_id)
    last_week = await conn.fetchval(
        "SELECT MAX(week) FROM matchups WHERE season = $1 AND league_id = $2 AND is_playoff = FALSE", season, league_id
    )
    if not count or not last_week or not standings or week > last_week or len(standings) <= count:
        return []
    weeks_left = last_week - week

    def wins(r) -> float:
        return r["wins"] + 0.5 * r["ties"]

    def rec(r) -> str:
        return f"{r['wins']}-{r['losses']}" + (f"-{r['ties']}" if r["ties"] else "")

    inside, outside = standings[:count], standings[count:]
    cut = wins(inside[-1])
    facts = [
        f"Playoff picture, from the league standings (record, then points for — not the power rankings): "
        f"the top {count} make the playoffs, {weeks_left} regular-season week(s) left. In right now: "
        + ", ".join(f"{who(r['team_name'])} ({rec(r)})" for r in inside)
        + ". Chasing: "
        + ", ".join(f"{who(r['team_name'])} ({rec(r)}, {cut - wins(r):g} back)" for r in outside[:3])
    ]
    if weeks_left == 0:
        return facts

    context = await power_rankings.get_season_context(conn, season, week, league_id)
    bubble = standings[max(0, count - 2): count + 2]
    for r in bubble:
        c = context.get(r["team_id"]) or {}
        rank, total = c.get("sos_remaining_rank"), len(context)
        if rank == 1:
            facts.append(f"{who(r['team_name'])} (on the playoff bubble) has the toughest remaining schedule in the league")
        elif rank and rank == total:
            facts.append(f"{who(r['team_name'])} (on the playoff bubble) has the easiest remaining schedule in the league")

    if weeks_left > 4:
        return facts

    # Late season: clinched / eliminated, by what's still possible.
    current = {r["team_id"]: wins(r) for r in standings}
    for r in standings:
        tid, w = r["team_id"], current[r["team_id"]]
        can_catch = sum(1 for o, ow in current.items() if o != tid and ow + weeks_left >= w)
        already_ahead = sum(1 for o, ow in current.items() if o != tid and ow > w + weeks_left)
        if can_catch < count:
            facts.append(f"{who(r['team_name'])} has clinched a playoff spot (notable)")
        elif already_ahead >= count:
            facts.append(f"{who(r['team_name'])} has been eliminated from playoff contention (notable)")

    if weeks_left <= 2:
        facts += await _scenario_facts(conn, season, week, league_id, count, current, standings, who)
    return facts


async def _scenario_facts(conn, season, week, league_id, count, current, standings, who) -> list[str]:
    """With two weeks or fewer left, play out every remaining result: who
    gets in with wins, who's out with a loss, who needs help. A tie in
    wins at the cut line is decided on points, which can't be known
    ahead — those scenarios count as undecided."""
    from itertools import product

    games = await conn.fetch(
        "SELECT home_team_id, away_team_id FROM matchups WHERE season = $1 AND league_id = $2 "
        "AND week > $3 AND is_playoff = FALSE",
        season, league_id, week,
    )
    if not games or len(games) > 14:
        return []
    facts = []
    for r in standings:
        tid = r["team_id"]
        mine = [g for g in games if tid in (g["home_team_id"], g["away_team_id"])]
        if not mine:
            continue
        outcomes = {"win_all": set(), "lose_all": set()}
        for results in product((0, 1), repeat=len(games)):
            final = dict(current)
            for g, home_won in zip(games, results):
                final[g["home_team_id"] if home_won else g["away_team_id"]] += 1
            ahead = sum(1 for o, w in final.items() if o != tid and w > final[tid])
            tied = sum(1 for o, w in final.items() if o != tid and w == final[tid])
            status = "in" if ahead + tied < count else "out" if ahead >= count else "points"
            won_all = all(
                (g["home_team_id"] == tid) == bool(res) for g, res in zip(games, results) if g in mine
            )
            lost_all = all(
                (g["home_team_id"] == tid) != bool(res) for g, res in zip(games, results) if g in mine
            )
            if won_all:
                outcomes["win_all"].add(status)
            if lost_all:
                outcomes["lose_all"].add(status)
        name = who(r["team_name"])
        wins_needed = "a win" if len(mine) == 1 else f"{len(mine)} wins"
        if outcomes["win_all"] == {"in"} and outcomes["lose_all"] != {"in"}:
            facts.append(f"Scenario: {name} is in with {wins_needed} (notable)")
        elif "in" in outcomes["win_all"] and outcomes["win_all"] != {"in"}:
            facts.append(f"Scenario: {name} needs {wins_needed} and help from other results to get in (notable)")
        if outcomes["lose_all"] == {"out"} and outcomes["win_all"] != {"out"}:
            facts.append(f"Scenario: {name} is eliminated with a loss (notable)")
    return facts


def _rivalry_facts(matchups, who: Who) -> list[str]:
    facts = []
    for m in matchups:
        r = m.get("rivalry")
        if not r:
            continue
        home, away = who(m["home"]["team_name"]), who(m["away"]["team_name"])
        facts.append(
            f"Rivalry game: {home} vs {away} is \"{r['name']}\" — {r['tagline']} {r['description']} "
            f"All-time between them before this week: {home} {r['all_time_wins_home']}, {away} {r['all_time_wins_away']}"
        )
    return facts


async def build_recap_context_facts(conn, week_context: dict, league_id: int, standings: list, who: Who) -> dict[str, list[str]]:
    """{"league": [...], "storylines": [...], "race": [...]} — the week as
    a whole, the why behind individual games, and the power rankings and
    playoff race."""
    season, week = week_context["season"], week_context["week"]
    matchups = week_context["matchups"]
    results = _results(matchups)

    team_ids = [side["team_id"] for m in matchups for side in (m["home"], m["away"])]
    earlier = await _earlier_weeks(conn, season, week, team_ids)

    league: list[str] = []
    league += await _scoring_environment_facts(conn, season, week, league_id, matchups, who)
    league += _power_rank_facts(matchups, await _power_ranks_going_in(conn, season, week, league_id), who)
    league += _standings_shape_facts(standings, week, results, who)
    league += _position_facts(matchups, _season_position_averages(earlier))
    league += _stack_facts(matchups, who)
    league += _mistake_facts(matchups, results, _season_mistake_averages(earlier), who)

    race: list[str] = []
    race += await _power_ranking_facts(conn, season, week, league_id, who)
    race += await _playoff_race_facts(conn, season, week, league_id, standings, who)

    storylines: list[str] = []
    storylines += _injury_facts(matchups, results, who)
    storylines += await _arrival_and_return_facts(conn, season, week, earlier, matchups, results, who)
    storylines += _bright_spot_facts(results, who)
    storylines += _rivalry_facts(matchups, who)
    return {"league": league, "storylines": storylines, "race": race}
