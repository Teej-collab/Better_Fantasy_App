"""
Clinch marks for the standings (2026-11-17): x clinched a playoff spot,
z clinched a bye, * clinched the 1 seed, e eliminated. A mark only goes
up once it's mathematically certain. Nobody gets an x who could still
miss, and nobody gets an e who could still get in.

How it's proven, for a head-to-head league (ranked on wins, ties as
half, then points for, as in app/queries/league.py get_standings):

- Clinched: the team loses every game it has left (the worst it can do),
  and every team that finishes level with it on wins counts as ahead of
  it, since points for could break the tie either way. If no way the
  other remaining games can go puts `spots` or more teams level or
  ahead, the spot is clinched.
- Eliminated: the team wins every game it has left, and teams level with
  it count as behind. If every way the other games can go still leaves
  `playoff_team_count` or more teams strictly ahead, it's out.

Each search starts with a quick bound that ignores who plays whom, then
an exhaustive search over the other remaining games with pruning. When
the search would take too long, the answer is "not proven" and the team
gets no mark: unproven is never shown.

Ties in the remaining games aren't searched, since two teams finishing
level to the decimal is all but impossible with fantasy scoring. A
league that has already had a tie this season only gets marks once the
regular season is over. Total-points leagues rank on points, which
can't be bounded, so they also only get marks once it's over, from the
final order.
"""
import math

from app.domain.league_format import get_league_format, ranks_by_points
from app.domain.playoffs import get_playoff_world

# Each search gives up past this many steps, leaving the team unmarked.
NODE_LIMIT = 200_000

PLAYOFFS = "x"
BYE = "z"
TOP_SEED = "*"
ELIMINATED = "e"


def bye_count(playoff_team_count: int) -> int:
    """Byes the bracket gives (app/domain/playoffs.py bracket_spec): a
    count that isn't a power of 2 fills the next one up, top seeds first."""
    size = 1 << max(1, math.ceil(math.log2(playoff_team_count)))
    return size - playoff_team_count


async def get_clinch_marks(conn, season: int, league_id: int) -> dict:
    """{"marks": {team_id: [mark, ...]}, "byes": n, "playoff_team_count": n}.
    Empty marks when the league has no playoff settings to judge against."""
    world = await get_playoff_world(conn, season, league_id)
    if world is None:
        return {"marks": {}, "byes": 0, "playoff_team_count": None}
    spots = world["playoff_team_count"]
    byes = bye_count(spots)
    team_ids = [t["team_id"] for t in world["teams"]]
    by_points = ranks_by_points(await get_league_format(conn, league_id))
    return {"marks": clinch_marks(team_ids, world["schedule"], spots, byes, by_points), "byes": byes, "playoff_team_count": spots}


def clinch_marks(team_ids: list[int], schedule: list[dict], spots: int, byes: int, by_points: bool) -> dict[int, list[str]]:
    """The marks for every team, from the regular-season schedule (each
    game: home_team_id, away_team_id, home_score, away_score, played)."""
    wins = {t: 0.0 for t in team_ids}
    points = {t: 0.0 for t in team_ids}
    remaining: list[tuple[int, int]] = []
    had_tie = False
    for g in schedule:
        home, away = g["home_team_id"], g["away_team_id"]
        if home not in wins or away not in wins:
            continue
        if not g["played"]:
            remaining.append((home, away))
            continue
        hs, as_ = g["home_score"], g["away_score"]
        points[home] += hs
        points[away] += as_
        if hs > as_:
            wins[home] += 1
        elif as_ > hs:
            wins[away] += 1
        else:
            wins[home] += 0.5
            wins[away] += 0.5
            had_tie = True

    if not remaining:
        return _final_marks(team_ids, wins, points, spots, byes, by_points)
    if by_points or had_tie:
        return {}

    marks: dict[int, list[str]] = {}
    for t in team_ids:
        got: list[str] = []
        worst = _worst_place(t, wins, remaining, spots)
        if worst is not None and worst <= spots:
            got.append(PLAYOFFS)
            bye = _worst_place(t, wins, remaining, byes) if byes else None
            if bye is not None and bye <= byes:
                got.append(BYE)
            if _worst_place(t, wins, remaining, 1) == 1:
                got.append(TOP_SEED)
        elif _eliminated(t, wins, remaining, spots):
            got.append(ELIMINATED)
        if got:
            marks[t] = got
    return marks


def _final_marks(team_ids, wins, points, spots, byes, by_points) -> dict[int, list[str]]:
    """The regular season is over: the order is known (wins then points
    for, or points then wins). A tie on both is left unmarked."""
    key = (lambda t: (points[t], wins[t])) if by_points else (lambda t: (wins[t], points[t]))
    order = sorted(team_ids, key=key, reverse=True)
    marks: dict[int, list[str]] = {}
    for i, t in enumerate(order):
        place = i + 1
        level = [o for o in order if o != t and key(o) == key(t)]
        if level:
            continue
        got: list[str] = []
        if place <= spots:
            got.append(PLAYOFFS)
            if byes and place <= byes:
                got.append(BYE)
            if place == 1:
                got.append(TOP_SEED)
        else:
            got.append(ELIMINATED)
        marks[t] = got
    return marks


def _worst_place(team: int, wins: dict, remaining: list, cutoff: int) -> int | None:
    """The team's worst possible place, capped at cutoff + 1 (all a
    clinch check needs to know): it loses out, and teams level with it
    count as ahead. None when the search ran out of steps."""
    base = dict(wins)
    others_games = []
    for home, away in remaining:
        if home == team:
            base[away] += 1
        elif away == team:
            base[home] += 1
        else:
            others_games.append((home, away))
    floor = base[team]
    rivals = [o for o in base if o != team]
    need = cutoff  # this many teams level or ahead puts it past the cutoff
    left = {o: 0 for o in rivals}
    for home, away in others_games:
        left[home] += 1
        left[away] += 1
    # Quick bound: teams that could reach the floor at all.
    possible = [o for o in rivals if base[o] + left[o] >= floor]
    if len(possible) < need:
        return 1 + len(possible)
    # Search for results that put `need` teams level or ahead.
    found, ok = _search_max(others_games, base, floor, need, rivals)
    if not ok:
        return None
    return 1 + found if found < need else cutoff + 1


def _eliminated(team: int, wins: dict, remaining: list, spots: int) -> bool:
    """True only when, even winning out and every tiebreak, the team
    finishes outside the spots in every outcome."""
    base = dict(wins)
    others_games = []
    for home, away in remaining:
        if home == team or away == team:
            base[team] += 1
        else:
            others_games.append((home, away))
    ceiling = base[team]
    rivals = [o for o in base if o != team]
    # Teams already past it whatever happens.
    forced = [o for o in rivals if base[o] > ceiling]
    if len(forced) >= spots:
        return True
    # Search for results that leave fewer than `spots` teams strictly ahead.
    found, ok = _search_min(others_games, base, ceiling, spots, rivals)
    return ok and found >= spots


def _search_max(games, base, floor, need, rivals) -> tuple[int, bool]:
    """Most rivals that can finish at or above `floor`, stopping once
    `need` is reached. (count, finished within the step limit)."""
    w = dict(base)
    games_left = {o: 0 for o in rivals}
    for h, a in games:
        games_left[h] += 1
        games_left[a] += 1
    best = 0
    steps = 0

    def reach() -> int:
        return sum(1 for o in rivals if w[o] >= floor)

    def dfs(i: int) -> bool:
        nonlocal best, steps
        steps += 1
        if steps > NODE_LIMIT:
            return False
        if i == len(games):
            best = max(best, reach())
            return True
        # Prune: even the most hopeful finish can't beat the best found.
        upper = sum(1 for o in rivals if w[o] + games_left[o] >= floor)
        if upper <= best:
            return True
        h, a = games[i]
        games_left[h] -= 1
        games_left[a] -= 1
        # Try the side that helps a team still short of the floor first.
        first, second = (h, a) if w[h] < w[a] else (a, h)
        for winner in (first, second):
            w[winner] += 1
            ok = dfs(i + 1)
            w[winner] -= 1
            if not ok:
                games_left[h] += 1
                games_left[a] += 1
                return False
            if best >= need:
                break
        games_left[h] += 1
        games_left[a] += 1
        return True

    finished = dfs(0)
    return best, finished or best >= need


def _search_min(games, base, ceiling, spots, rivals) -> tuple[int, bool]:
    """Fewest rivals that must finish strictly above `ceiling`, stopping
    once it's under `spots`. (count, finished within the step limit)."""
    w = dict(base)
    best = len(rivals) + 1
    steps = 0

    def dfs(i: int) -> bool:
        nonlocal best, steps
        steps += 1
        if steps > NODE_LIMIT:
            return False
        already = sum(1 for o in rivals if w[o] > ceiling)
        if already >= best:
            return True
        if i == len(games):
            best = already
            return True
        h, a = games[i]
        # Hand the win to whoever's lower first, to keep teams under.
        first, second = (h, a) if w[h] <= w[a] else (a, h)
        for winner in (first, second):
            w[winner] += 1
            ok = dfs(i + 1)
            w[winner] -= 1
            if not ok:
                return False
            if best < spots:
                return True
        return True

    finished = dfs(0)
    return best, finished or best < spots
