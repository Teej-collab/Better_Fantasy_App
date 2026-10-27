"""
NFL-style regular-season schedule (2026-10-27) — replaces the plain
round-robin in app/domain/schedule.py for a league run here. Still a
round-robin underneath, so it's fair by construction: everyone plays
everyone once per cycle, home and away alternate, nobody gets an extra
game. What this adds is which teams pair up in which round, and the
order the rounds are played:

- Season Opener: week 1 is the round where last year's champion plays
  this year's favorite (the best draft grade).
- Rivalry Week: the team order is arranged so one whole round is made of
  approved rivalries (app/domain/rivalry_detection.py), and that round
  lands RIVALRY_WEEK_SHARE of the way through the season — the way the
  NFL saves its Thanksgiving games.
- Championship Rematch: last year's title game, somewhere in the middle
  third of the season.
- Contenders (the top third of draft grades) meet each other late.
- A rivalry that meets twice doesn't meet twice in a few weeks, and no
  pair ever plays back-to-back weeks.

ATTEMPTS candidate schedules are built from a seeded random generator
(the same league and season always get the same schedule) and the one
scoring best on the above wins. Marquee games are written to
matchups.headline so the app can show them.

Runs on its own right after a league's draft is graded (app/scheduler.py)
and from the commissioner's "make the schedule" button. Never for a
league mirroring ESPN or Sleeper — its schedule comes from there.
"""
import random

from app.domain.league_mode import mirror_platform
from app.domain.schedule_exceptions import NotEnoughTeamsError, ScheduleAlreadyExistsError

ATTEMPTS = 400
RIVALRY_WEEK_SHARE = 0.7
DEFAULT_REGULAR_WEEKS = 14

OPENER = "Season Opener"
RIVALRY_WEEK = "Rivalry Week"
TITLE_REMATCH = "Championship Rematch"


def rivalry_week_for(weeks: int) -> int | None:
    if weeks < 4:
        return None
    return min(weeks - 1, max(2, round(weeks * RIVALRY_WEEK_SHARE)))


def _pair(a, b) -> frozenset:
    return frozenset((a, b))


def _rounds_from_order(order: list) -> list[list[tuple[int, int]]]:
    """Circle method from a given seat order (None = bye): round 0 pairs
    seat i with seat n-1-i, which is how a chosen set of pairs ends up
    playing in the same round."""
    arr = list(order)
    n = len(arr)
    rounds = []
    for r in range(n - 1):
        pairings = []
        for i in range(n // 2):
            a, b = arr[i], arr[n - 1 - i]
            if a is None or b is None:
                continue
            pairings.append((a, b) if (r + i) % 2 == 0 else (b, a))
        rounds.append(pairings)
        arr = [arr[0]] + [arr[-1]] + arr[1:-1]
    return rounds


def _seat_order(teams: list[int], rivalries: list[tuple[int, int]], rng: random.Random) -> list:
    """Seats for the circle method with as many rivalries as fit in one
    round sitting across from each other (a random maximal set, since a
    team can be in more than one rivalry)."""
    seats = list(teams) + ([None] if len(teams) % 2 else [])
    n = len(seats)
    shuffled = list(rivalries)
    rng.shuffle(shuffled)
    used, matched = set(), []
    for a, b in shuffled:
        if a not in used and b not in used:
            matched.append((a, b))
            used.update((a, b))
    rest = [t for t in seats if t not in used]
    rng.shuffle(rest)
    order: list = [None] * n
    for i, (a, b) in enumerate(matched):
        order[i], order[n - 1 - i] = a, b
    empty = [i for i in range(n) if i >= len(matched) and i < n - len(matched)]
    for i, team in zip(empty, rest):
        order[i] = team
    return order


def _expand(rounds: list[list[tuple[int, int]]], round_order: list[int], weeks: int) -> list[list[tuple[int, int]]]:
    """Week-by-week games: the rounds in round_order, repeated with home
    and away flipped once the league has played everyone."""
    schedule = []
    for w in range(weeks):
        cycle, idx = divmod(w, len(round_order))
        games = rounds[round_order[idx]]
        schedule.append([(away, home) if cycle % 2 else (home, away) for home, away in games])
    return schedule


def _round_order(rounds, rivalry_week: int | None, opener_pair: frozenset | None, rng: random.Random) -> list[int]:
    """The order rounds are played in: round 0 (the rivalry round) on
    Rivalry Week, the round with champion vs favorite first, the rest
    shuffled. If both want the same slot, Rivalry Week wins."""
    cycle = len(rounds)
    fixed: dict[int, int] = {}  # slot -> round
    if rivalry_week is not None:
        fixed[(rivalry_week - 1) % cycle] = 0
    if opener_pair is not None and 0 not in fixed:
        opener_round = next(i for i, games in enumerate(rounds) if opener_pair in {_pair(*g) for g in games})
        if opener_round not in fixed.values():
            fixed[0] = opener_round
    rest = [r for r in range(cycle) if r not in fixed.values()]
    rng.shuffle(rest)
    return [fixed[slot] if slot in fixed else rest.pop() for slot in range(cycle)]


def _balance_home_away(schedule: list[list[tuple[int, int]]]) -> list[list[tuple[int, int]]]:
    """Who hosts, decided after the pairings: a rematch flips the first
    meeting's host; otherwise the team with fewer home games so far
    hosts (the one that was on the road last, on a tie). Keeps every
    team within a game of an even split."""
    homes: dict[int, int] = {}
    last_away: dict[int, int] = {}
    hosted: dict[frozenset, int] = {}
    balanced = []
    for w, games in enumerate(schedule, start=1):
        week = []
        for a, b in games:
            pair = _pair(a, b)
            if pair in hosted:
                home = b if hosted[pair] == a else a
            else:
                home = min((a, b), key=lambda t: (homes.get(t, 0), -last_away.get(t, 0), t))
            away = b if home == a else a
            hosted[pair] = home
            homes[home] = homes.get(home, 0) + 1
            last_away[away] = w
            week.append((home, away))
        balanced.append(week)
    return balanced


def score_schedule(
    schedule: list[list[tuple[int, int]]],
    champion: int | None,
    favorite: int | None,
    rivalries: set[frozenset],
    title_pair: frozenset | None,
    contenders: set[int],
    rivalry_week: int | None,
) -> float:
    weeks = len(schedule)
    score = 0.0
    last_seen: dict[frozenset, int] = {}
    for w, games in enumerate(schedule, start=1):
        for home, away in games:
            pair = _pair(home, away)
            if pair in last_seen:
                gap = w - last_seen[pair]
                if gap == 1:
                    score -= 1000  # never back-to-back
                elif pair in rivalries and gap < 4:
                    score -= 5
            last_seen[pair] = w
            if w == 1 and champion is not None and pair == _pair(champion, favorite):
                score += 30
            if w == rivalry_week and pair in rivalries:
                score += 10
            if title_pair is not None and pair == title_pair and weeks / 3 <= w <= 2 * weeks / 3:
                score += 10
            if home in contenders and away in contenders:
                score += 4 * w / weeks
    return score


def build_schedule(
    teams: list[int],
    weeks: int,
    champion: int | None = None,
    favorite: int | None = None,
    rivalries: list[tuple[int, int]] | None = None,
    title_pair: tuple[int, int] | None = None,
    contenders: list[int] | None = None,
    seed: int = 0,
) -> tuple[list[tuple[int, int, int]], dict[tuple[int, int, int], str]]:
    """(games as (week, home, away), headlines by game). Pure — no DB."""
    if len(teams) < 2:
        raise NotEnoughTeamsError(f"Need at least 2 teams to generate a schedule, got {len(teams)}")
    team_set = set(teams)
    if favorite == champion:
        favorite = None
    rivalries = [(a, b) for a, b in (rivalries or []) if a in team_set and b in team_set and a != b]
    rivalry_pairs = {_pair(a, b) for a, b in rivalries}
    title = _pair(*title_pair) if title_pair and set(title_pair) <= team_set and title_pair[0] != title_pair[1] else None
    contender_set = set(contenders or []) & team_set
    rivalry_week = rivalry_week_for(weeks) if rivalry_pairs else None
    opener_pair = _pair(champion, favorite) if champion in team_set and favorite in team_set else None

    rng = random.Random(seed)
    best, best_score = None, None
    for _ in range(ATTEMPTS):
        rounds = _rounds_from_order(_seat_order(teams, rivalries, rng))
        order = _round_order(rounds, rivalry_week, opener_pair, rng)
        schedule = _expand(rounds, order, weeks)
        score = score_schedule(schedule, champion, favorite, rivalry_pairs, title, contender_set, rivalry_week)
        if best_score is None or score > best_score:
            best, best_score = schedule, score

    best = _balance_home_away(best)
    games: list[tuple[int, int, int]] = []
    headlines: dict[tuple[int, int, int], str] = {}
    title_marked = False
    for w, week_games in enumerate(best, start=1):
        for home, away in week_games:
            game = (w, home, away)
            games.append(game)
            pair = _pair(home, away)
            if w == 1 and pair == opener_pair:
                headlines[game] = OPENER
            elif w == rivalry_week and pair in rivalry_pairs:
                headlines[game] = RIVALRY_WEEK
            elif pair == title and not title_marked:
                headlines[game] = TITLE_REMATCH
                title_marked = True
    return games, headlines


async def _team_by_owner(conn, season: int, league_id: int) -> dict[int, int]:
    return {
        r["owner_id"]: r["id"]
        for r in await conn.fetch(
            "SELECT id, owner_id FROM teams_by_season WHERE season = $1 AND league_id = $2 AND owner_id IS NOT NULL",
            season, league_id,
        )
    }


async def regular_season_weeks(conn, season: int, league_id: int) -> int:
    start = await conn.fetchval(
        "SELECT start_week FROM league_playoff_settings WHERE season = $1 AND league_id = $2", season, league_id
    )
    return (start - 1) if start and start > 1 else DEFAULT_REGULAR_WEEKS


async def _inputs(conn, season: int, league_id: int) -> dict:
    """Everything the builder weighs, as this season's team ids."""
    team_of = await _team_by_owner(conn, season, league_id)
    champion_owner = await conn.fetchval(
        "SELECT owner_id FROM season_champions WHERE season = $1 AND league_id = $2", season - 1, league_id
    )
    graded = await conn.fetch(
        """
        SELECT owner_id FROM draft_grades WHERE season = $1 AND league_id = $2
        ORDER BY value_score DESC NULLS LAST, percentile DESC
        """,
        season, league_id,
    )
    ranked = [team_of[r["owner_id"]] for r in graded if r["owner_id"] in team_of]
    champion = team_of.get(champion_owner)
    favorite = next((t for t in ranked if t != champion), None)

    rivalries = [
        (team_of[r["owner_a_id"]], team_of[r["owner_b_id"]])
        for r in await conn.fetch("SELECT owner_a_id, owner_b_id FROM rivalries WHERE league_id = $1", league_id)
        if r["owner_a_id"] in team_of and r["owner_b_id"] in team_of
    ]

    # Last season's title game: its last playoff week, with the champion in it.
    title = await conn.fetchrow(
        """
        SELECT th.owner_id AS a, ta.owner_id AS b
        FROM matchups m
        JOIN teams_by_season th ON th.id = m.home_team_id
        JOIN teams_by_season ta ON ta.id = m.away_team_id
        WHERE m.season = $1 AND m.league_id = $2 AND m.is_playoff
          AND m.week = (SELECT MAX(week) FROM matchups WHERE season = $1 AND league_id = $2 AND is_playoff)
          AND $3::int IN (th.owner_id, ta.owner_id)
        LIMIT 1
        """,
        season - 1, league_id, champion_owner,
    ) if champion_owner else None
    title_pair = (team_of.get(title["a"]), team_of.get(title["b"])) if title else None
    if title_pair and None in title_pair:
        title_pair = None

    return {
        "teams": sorted(team_of.values()),
        "champion": champion,
        "favorite": favorite,
        "rivalries": rivalries,
        "title_pair": title_pair,
        "contenders": ranked[: max(2, len(ranked) // 3)] if ranked else [],
    }


async def build_and_save(conn, season: int, league_id: int, weeks: int | None = None) -> list[dict]:
    """Builds this season's schedule and writes it as matchups rows.
    Refuses when regular-season matchups already exist."""
    if await conn.fetchval(
        "SELECT 1 FROM matchups WHERE season = $1 AND league_id = $2 AND is_playoff = FALSE LIMIT 1", season, league_id
    ):
        raise ScheduleAlreadyExistsError(f"A regular-season schedule already exists for season {season}")
    weeks = weeks or await regular_season_weeks(conn, season, league_id)
    inputs = await _inputs(conn, season, league_id)
    games, headlines = build_schedule(weeks=weeks, seed=season * 100003 + league_id, **inputs)

    created = []
    async with conn.transaction():
        for game in games:
            week, home, away = game
            row_id = await conn.fetchval(
                """
                INSERT INTO matchups (season, week, home_team_id, away_team_id, is_playoff, league_id, headline)
                VALUES ($1, $2, $3, $4, FALSE, $5, $6)
                RETURNING id
                """,
                season, week, home, away, league_id, headlines.get(game),
            )
            created.append(
                {"id": row_id, "week": week, "home_team_id": home, "away_team_id": away, "headline": headlines.get(game)}
            )
    return created


async def release_after_draft(conn, season: int, league_id: int) -> bool:
    """The automatic release once a draft is graded. True when a schedule
    was made; False for a mirrored league, one already scheduled, or one
    without enough teams."""
    if await mirror_platform(conn, league_id):
        return False
    try:
        await build_and_save(conn, season, league_id)
    except (ScheduleAlreadyExistsError, NotEnoughTeamsError):
        return False
    return True
