"""
Playoff chances (2026-10): play the rest of the season — and the
playoffs — thousands of times and count.

Each simulated game draws real scores, not just a winner, because the
standings' tiebreaker is points for: wins (ties half), then points for,
exactly app/queries/league.py's get_standings. A team's expected score
blends what the commissioner asked for:
  - its season scoring average            55%
  - its recent form (last 3, newest heaviest) 25%
  - its power-rankings strength            20% (weekly_team_stats.
    compute_power_scores: record, all-play, scoring, form, margin)
pulled toward the league average early in the season (few games = less
certainty), with week-to-week spread from its own boom/bust history,
also shrunk toward the league's. Then the bracket plays out by
playoffs.bracket_spec, so the odds cover the title, the Toilet Bowl and
last place too.

It takes the same what-if scenario the clients build (flipped results,
picked games, picked playoff games), so the What-If Lab shows live odds
for the world being built. For one team it also finds the paths:
chances by how many of the remaining games they win, what the next game
is worth, which other games to root for, and how often points for ends
up deciding their spot.
"""
import asyncio
import random
import time
import zlib
from collections import OrderedDict
from statistics import mean, pstdev

from app.domain.playoffs import get_playoff_world
from app.domain.weekly_team_stats import compute_power_scores, recent_form

DEFAULT_SIMS = 10000
# Points of expected score per unit of power score (a z-score blend).
POWER_POINTS = 8.0
# Prior games' weight when shrinking a team's numbers toward the league.
MEAN_PRIOR_GAMES = 3
SPREAD_PRIOR_GAMES = 4
FALLBACK_SD = 22.0

_cache: "OrderedDict[tuple, tuple[float, dict]]" = OrderedDict()
_CACHE_SIZE = 64
_CACHE_SECONDS = 600


def decode_scenario(raw: str | None) -> dict:
    """The clients' share format (lib/bracketEngine.ts encodeScenario):
    f.<id>,<id>~p.<id>:<team>,…~x.<code>:<team>,…~me.<team>."""
    scenario = {"flips": set(), "picks": {}, "playoff": {}}
    for part in (raw or "").split("~"):
        key, _, body = part.partition(".")
        if key == "f":
            scenario["flips"] = {int(x) for x in body.split(",") if x.lstrip("-").isdigit()}
        elif key in ("p", "x"):
            for pair in body.split(","):
                k, _, v = pair.partition(":")
                if not v.lstrip("-").isdigit():
                    continue
                if key == "p" and k.isdigit():
                    scenario["picks"][int(k)] = int(v)
                elif key == "x" and k.replace("-", "").isalnum():
                    scenario["playoff"][k] = int(v)
    return scenario


def _team_models(world: dict, scenario: dict) -> dict[int, dict]:
    """Expected score (mu) and spread (sd) per team, from real scores."""
    team_ids = [t["team_id"] for t in world["teams"]]
    scores: dict[int, list[float]] = {t: [] for t in team_ids}
    played = [g for g in world["schedule"] if g["played"]]
    for g in played:
        scores[g["home_team_id"]].append(g["home_score"])
        scores[g["away_team_id"]].append(g["away_score"])
    every = [s for v in scores.values() for s in v]
    league_avg = mean(every) if every else 110.0
    league_sd = pstdev(every) if len(every) > 4 else FALLBACK_SD

    # Power score from the same blend the power rankings use, on this
    # world's records (a flipped result changes a record, not points).
    stats = []
    for t in team_ids:
        mine = [g for g in played if t in (g["home_team_id"], g["away_team_id"])]
        if not mine:
            continue
        wins = ties = 0.0
        margins, all_play = [], []
        for g in mine:
            home = g["home_team_id"] == t
            me_s, opp_s = (g["home_score"], g["away_score"]) if home else (g["away_score"], g["home_score"])
            if me_s == opp_s:
                ties += 1
            else:
                won = me_s > opp_s
                if g["id"] in scenario["flips"]:
                    won = not won
                wins += 1 if won else 0
            margins.append(me_s - opp_s)
            week_scores = [s for x in played if x["week"] == g["week"] for s in (x["home_score"], x["away_score"])]
            others = len(week_scores) - 1
            beat = sum(1 for s in week_scores if me_s > s) + 0.5 * (sum(1 for s in week_scores if s == me_s) - 1)
            all_play.append(beat / others if others else 0.5)
        stats.append({
            "team_id": t,
            "win_pct": (wins + 0.5 * ties) / len(mine),
            "all_play_pct": mean(all_play),
            "avg_points": mean(scores[t]),
            "recent_form": recent_form(scores[t]),
            "avg_margin": mean(margins),
        })
    power = compute_power_scores(stats) if len(stats) > 1 else {}

    models = {}
    for t in team_ids:
        n = len(scores[t])
        if n:
            raw = (
                0.55 * mean(scores[t])
                + 0.25 * recent_form(scores[t])
                + 0.20 * (league_avg + POWER_POINTS * power.get(t, 0.0))
            )
            mu = (n * raw + MEAN_PRIOR_GAMES * league_avg) / (n + MEAN_PRIOR_GAMES)
            sd_t = pstdev(scores[t]) if n > 1 else league_sd
            sd = ((n * sd_t**2 + SPREAD_PRIOR_GAMES * league_sd**2) / (n + SPREAD_PRIOR_GAMES)) ** 0.5
        else:
            mu, sd = league_avg, league_sd
        models[t] = {"mu": mu, "sd": sd, "ppg": mean(scores[t]) if n else None, "games": n}
    return models


def simulate(world: dict, scenario: dict, focus_team: int | None, sims: int, seed: int) -> dict:
    rng = random.Random(seed)
    models = _team_models(world, scenario)
    team_ids = [t["team_id"] for t in world["teams"]]
    count = world["playoff_team_count"]
    bowl_line = count + 4

    # Fixed part of the season: played games (with any flips).
    base_w = {t: 0.0 for t in team_ids}
    base_pf = {t: 0.0 for t in team_ids}
    remaining = []
    for g in world["schedule"]:
        h, a = g["home_team_id"], g["away_team_id"]
        if g["played"]:
            base_pf[h] += g["home_score"]
            base_pf[a] += g["away_score"]
            if g["home_score"] == g["away_score"]:
                base_w[h] += 0.5
                base_w[a] += 0.5
            else:
                winner = h if g["home_score"] > g["away_score"] else a
                if g["id"] in scenario["flips"]:
                    winner = a if winner == h else h
                base_w[winner] += 1
        else:
            remaining.append(g)

    next_week = min((g["week"] for g in remaining), default=None)
    focus_games = [g for g in remaining if focus_team in (g["home_team_id"], g["away_team_id"])]
    focus_next = next((g for g in focus_games if g["week"] == next_week), None)
    # Every other game still to play (not just next week's) — what each
    # result does to the focus team's chances, with the rest of the
    # league varying around it in every simulated season. Games the
    # scenario already decided can't swing anything, so they're skipped.
    watch = [
        g for g in remaining
        if focus_team not in (g["home_team_id"], g["away_team_id"]) and g["id"] not in scenario["picks"]
    ]
    my_game_wins = {g["id"]: 0 for g in focus_games}
    live = world["status"] == "live" and not scenario["flips"] and not scenario["picks"]
    real_nodes = {g["code"]: g for g in world["games"]}

    tally = {t: {"playoffs": 0, "title": 0, "seed1": 0, "bowl": 0, "last": 0, "seed_sum": 0, "wins_sum": 0.0} for t in team_ids}
    by_wins: dict[int, list[int]] = {}
    next_split = {True: [0, 0], False: [0, 0]}  # won next game -> [made, total]
    watch_split = {g["id"]: {g["home_team_id"]: [0, 0], g["away_team_id"]: [0, 0]} for g in watch}
    tie_at_cut = tie_won = 0

    def draw(t: int) -> float:
        m = models[t]
        return max(0.0, rng.gauss(m["mu"], m["sd"]))

    for _ in range(sims):
        wins = dict(base_w)
        pf = dict(base_pf)
        outcome: dict[int, int] = {}
        focus_wins = 0
        for g in remaining:
            h, a = g["home_team_id"], g["away_team_id"]
            sh, sa = draw(h), draw(a)
            pick = scenario["picks"].get(g["id"])
            if pick in (h, a) and (sh > sa) != (pick == h):
                sh, sa = sa, sh
            pf[h] += sh
            pf[a] += sa
            winner = h if sh >= sa else a
            wins[winner] += 1
            outcome[g["id"]] = winner
            if winner == focus_team:
                focus_wins += 1
                if g["id"] in my_game_wins:
                    my_game_wins[g["id"]] += 1
        order = sorted(team_ids, key=lambda t: (wins[t], pf[t]), reverse=True)
        seed_of = {t: i + 1 for i, t in enumerate(order)}

        # The bracket, by the spec.
        done: dict[str, tuple[int, int]] = {}
        places: dict[int, int] = {}
        bowl_teams: tuple[int, int] | None = None
        for spec in world["games"]:
            sides = []
            for src in spec["sources"]:
                if src["kind"] == "seed":
                    sides.append(order[src["seed"] - 1] if src["seed"] <= len(order) else None)
                else:
                    prior = done.get(src["code"])
                    sides.append(None if prior is None else prior[0] if src["kind"] == "winner" else prior[1])
            a_t, b_t = sides
            if a_t is None or b_t is None:
                continue
            node = real_nodes.get(spec["code"])
            forced = scenario["playoff"].get(spec["code"])
            if forced in (a_t, b_t):
                w_t = forced
            elif live and node and node.get("winner_team_id") in (a_t, b_t):
                w_t = node["winner_team_id"]
            else:
                weeks = len(spec["weeks"]) or 1
                total_a = sum(draw(a_t) for _ in range(weeks))
                total_b = sum(draw(b_t) for _ in range(weeks))
                w_t = a_t if total_a >= total_b else b_t
            l_t = b_t if w_t == a_t else a_t
            done[spec["code"]] = (w_t, l_t)
            if spec["places"]:
                places[w_t], places[l_t] = spec["places"]
            if spec.get("toilet_bowl"):
                bowl_teams = (a_t, b_t)

        for t in team_ids:
            s = tally[t]
            s["seed_sum"] += seed_of[t]
            s["wins_sum"] += wins[t]
            if seed_of[t] <= count:
                s["playoffs"] += 1
            if seed_of[t] == 1:
                s["seed1"] += 1
            if places.get(t) == 1:
                s["title"] += 1
            if bowl_teams and t in bowl_teams:
                s["bowl"] += 1
            if places.get(t) == len(team_ids):
                s["last"] += 1

        if focus_team is not None:
            made = seed_of[focus_team] <= count
            row = by_wins.setdefault(focus_wins, [0, 0])
            row[0] += made
            row[1] += 1
            if focus_next is not None:
                split = next_split[outcome[focus_next["id"]] == focus_team]
                split[0] += made
                split[1] += 1
            for g in watch:
                cell = watch_split[g["id"]][outcome[g["id"]]]
                cell[0] += made
                cell[1] += 1
            # Points-for tiebreak at the cut line.
            if len(order) > count:
                at_cut, below = order[count - 1], order[count]
                if focus_team in (at_cut, below) and wins[at_cut] == wins[below]:
                    tie_at_cut += 1
                    tie_won += focus_team == at_cut

    pct = lambda n: round(100 * n / sims, 1)  # noqa: E731
    teams = [
        {
            "team_id": t,
            "playoff_pct": pct(s["playoffs"]),
            "title_pct": pct(s["title"]),
            "first_seed_pct": pct(s["seed1"]),
            "toilet_bowl_pct": pct(s["bowl"]),
            "last_place_pct": pct(s["last"]),
            "avg_seed": round(s["seed_sum"] / sims, 2),
            "projected_wins": round(s["wins_sum"] / sims, 1),
            "expected_score": round(models[t]["mu"], 1),
            "ppg": round(models[t]["ppg"], 2) if models[t]["ppg"] is not None else None,
        }
        for t, s in tally.items()
    ]

    focus = None
    if focus_team is not None and focus_team in tally:
        left = len(focus_games)
        rows = [
            {"wins": w, "games_left": left, "pct": round(100 * made / total, 1), "share": round(100 * total / sims, 1)}
            for w, (made, total) in sorted(by_wins.items(), reverse=True)
        ]
        win_out = next((r["pct"] for r in rows if r["wins"] == left), None)
        next_game = None
        if focus_next is not None:
            opp = focus_next["away_team_id"] if focus_next["home_team_id"] == focus_team else focus_next["home_team_id"]
            w_made, w_n = next_split[True]
            l_made, l_n = next_split[False]
            next_game = {
                "matchup_id": focus_next["id"],
                "week": focus_next["week"],
                "opponent_team_id": opp,
                "if_win_pct": round(100 * w_made / w_n, 1) if w_n else None,
                "if_loss_pct": round(100 * l_made / l_n, 1) if l_n else None,
            }
        root_for = []
        for g in watch:
            (t1, (m1, n1)), (t2, (m2, n2)) = watch_split[g["id"]].items()
            p1 = 100 * m1 / n1 if n1 else None
            p2 = 100 * m2 / n2 if n2 else None
            if p1 is None or p2 is None:
                continue
            good, bad, p_good, p_bad = (t1, t2, p1, p2) if p1 >= p2 else (t2, t1, p2, p1)
            root_for.append({
                "matchup_id": g["id"], "week": g["week"], "root_for_team_id": good, "against_team_id": bad,
                "pct_if_root": round(p_good, 1), "pct_if_other": round(p_bad, 1), "swing": round(p_good - p_bad, 1),
            })
        root_for.sort(key=lambda r: r["swing"], reverse=True)
        root_for = [r for r in root_for if r["swing"] >= 1.0]
        focus = {
            "team_id": focus_team,
            "games_left": left,
            "win_out_pct": win_out,
            "by_wins": rows,
            "next_game": next_game,
            "root_for": root_for[:8],
            "best_path": _best_path(world, scenario, focus_team, focus_games, my_game_wins, rows, root_for, sims, seed),
            "tiebreak": {
                "tied_at_cut_pct": pct(tie_at_cut),
                "won_on_points_pct": round(100 * tie_won / tie_at_cut, 1) if tie_at_cut else None,
            },
        }
    return {"sims": sims, "teams": teams, "focus": focus}


# The best path's target: the fewest wins that make the playoffs this
# likely (in the simulated seasons where the team won exactly that many).
PATH_TARGET_PCT = 75.0
PATH_ROOT_GAMES = 4


def _best_path(world, scenario, team, my_games, my_game_wins, by_wins, root_for, sims, seed) -> dict | None:
    """The realistic way in — not "win out" (everyone's best path).

    1. A win target: the fewest of the remaining games that gets the team
       in PATH_TARGET_PCT of the time (from the simulated seasons).
    2. Which games: the ones it's most likely to win (its simulated win
       rate in each), so the path asks for the winnable ones.
    3. Help: the other games across the rest of the season that move its
       chances most, each with the result to root for.
    Then the path is simulated again with all of that locked in, so its
    chance is a real number, not a guess."""
    open_games = [g for g in my_games if g["id"] not in scenario["picks"]]
    already_won = sum(1 for g in my_games if scenario["picks"].get(g["id"]) == team)
    left = len(my_games)
    if left == 0:
        return None
    target = next(
        (r["wins"] for r in sorted(by_wins, key=lambda r: r["wins"]) if r["pct"] >= PATH_TARGET_PCT and r["share"] > 0),
        left,
    )
    needed = max(0, target - already_won)
    ranked = sorted(open_games, key=lambda g: my_game_wins.get(g["id"], 0), reverse=True)
    to_win = ranked[:needed]
    help_games = root_for[:PATH_ROOT_GAMES]

    path = {
        "flips": set(scenario["flips"]),
        "picks": {**scenario["picks"], **{g["id"]: team for g in to_win}, **{r["matchup_id"]: r["root_for_team_id"] for r in help_games}},
        "playoff": dict(scenario["playoff"]),
    }
    rerun = simulate(world, path, None, max(2000, sims // 4), seed ^ 0x5A5A)
    path_pct = next(t["playoff_pct"] for t in rerun["teams"] if t["team_id"] == team)
    return {
        "target_wins": target,
        "games_left": left,
        "win_games": [
            {
                "matchup_id": g["id"],
                "week": g["week"],
                "opponent_team_id": g["away_team_id"] if g["home_team_id"] == team else g["home_team_id"],
                "win_pct": round(100 * my_game_wins.get(g["id"], 0) / sims, 1),
            }
            for g in sorted(to_win, key=lambda g: g["week"])
        ],
        "root_for": help_games,
        "path_pct": path_pct,
    }


async def get_playoff_odds(
    conn, season: int, league_id: int, scenario_raw: str | None = None, focus_team: int | None = None, sims: int = DEFAULT_SIMS
) -> dict | None:
    world = await get_playoff_world(conn, season, league_id)
    if world is None:
        return None
    scenario = decode_scenario(scenario_raw)
    signature = tuple((g["id"], g["home_score"], g["away_score"], g["played"]) for g in world["schedule"])
    key = (season, league_id, zlib.crc32(repr(signature).encode()), scenario_raw or "", focus_team, sims)
    hit = _cache.get(key)
    if hit and time.monotonic() - hit[0] < _CACHE_SECONDS:
        _cache.move_to_end(key)
        return hit[1]
    # A fixed seed per world: the same world always shows the same odds.
    # CPU-bound (~1s for 10,000 seasons): off the event loop.
    result = await asyncio.to_thread(simulate, world, scenario, focus_team, sims, zlib.crc32(repr(key).encode()))
    result["status"] = world["status"]
    _cache[key] = (time.monotonic(), result)
    while len(_cache) > _CACHE_SIZE:
        _cache.popitem(last=False)
    return result
