"""
Gamecast's "Last Play" card: which fantasy-rostered players were on the
most recent play, and how many fantasy points that one play earned them.

The public summary feed Gamecast already polls (providers/espn.py) has
no player ids on a play — only its text. ESPN's core API has the same
play with a `participants` list: each an athlete $ref plus a role
("passer", "rusher", "receiver", "scorer", "kicker", "patScorer",
"fumbler", "sackedBy", "recoverer", ...). Those ids are the same
espn_player_id the `players` table already crosswalks, so this is exact
attribution, not name matching. One extra request per play, and only
for the play someone is actually looking at — cached by play id, since
a play's participants don't change once it's happened.

Points are this league's own rules applied to the play's own stats
(scoring_engine.compute_player_points) — the same formula the weekly
compute uses, just over one play instead of a whole game. Deliberately
covers only the linear, per-play stats. A D/ST's points-allowed and
yards-allowed tiers depend on the whole game, not any one play, so a
D/ST only ever shows its sacks/takeaways/defensive TDs here.
"""
import re

import httpx

from app.domain.scoring_engine import compute_player_points
from app.domain.stat_derivations import derive_stat_line, tackle_category
from app.providers.nfl_stats.espn_public import LONG_TD_YARDS, fg_made_tier

CORE_PLAY_URL = (
    "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/{game_id}"
    "/competitions/{game_id}/plays/{play_id}"
)

# Participants of a finished play don't change, so these are kept for
# the life of the process — bounded so a long season can't grow it
# forever (oldest entries evicted first; dicts keep insertion order).
_PARTICIPANTS_CACHE: dict[str, dict] = {}
_PARTICIPANTS_CACHE_MAX = 2000

_ATHLETE_ID_RE = re.compile(r"/athletes/(\d+)")

_BALL_HANDLER_ROLES = {"passer", "rusher", "receiver", "kicker", "returner", "fumbler"}

_FG_MISS_TIERS: list[tuple[int | None, str]] = [
    (29, "fg_miss_0_29"), (39, "fg_miss_30_39"), (49, "fg_miss_40_49"), (None, "fg_miss_50_plus"),
]

# ESPN's core-API play-type text for a defense's own takeaway, confirmed
# against real plays (NO @ DET week 1) — see espn_public.py's
# _OPPONENT_FUMBLE_RECOVERY_TYPES for the same two fumble tags.
_OPPONENT_FUMBLE_RECOVERY_TYPES = {"Fumble Recovery (Opponent)", "Sack Opp Fumble Recovery"}


async def fetch_core_play(game_id: str, play_id: str) -> dict:
    cached = _PARTICIPANTS_CACHE.get(play_id)
    if cached is not None:
        return cached
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(CORE_PLAY_URL.format(game_id=game_id, play_id=play_id))
        response.raise_for_status()
        data = response.json()
    core = {
        "type": (data.get("type") or {}).get("text", ""),
        "yards": data.get("statYardage") or 0,
        "is_turnover": bool(data.get("isTurnover")),
        "is_scoring": bool(data.get("scoringPlay")),
        "participants": [
            {"role": p.get("type"), "espn_id": int(m.group(1))}
            for p in data.get("participants") or []
            if (m := _ATHLETE_ID_RE.search((p.get("athlete") or {}).get("$ref", "")))
        ],
    }
    # A play seconds old can come back before ESPN has attached its
    # participants — never pin that empty answer; the next ask retries.
    if not core["participants"]:
        return core
    _PARTICIPANTS_CACHE[play_id] = core
    while len(_PARTICIPANTS_CACHE) > _PARTICIPANTS_CACHE_MAX:
        del _PARTICIPANTS_CACHE[next(iter(_PARTICIPANTS_CACHE))]
    return core


def _fg_miss_category(distance: int) -> str:
    for max_yards, category in _FG_MISS_TIERS:
        if max_yards is None or distance <= max_yards:
            return category
    return _FG_MISS_TIERS[-1][1]


def play_stat_lines(core: dict, positions: dict[int, str]) -> tuple[dict[int, dict], dict[str, float]]:
    """({espn_id: stat_line} for individual players, {category: count}
    for the DEFENDING team's D/ST) for one play. `positions` maps
    espn_id -> position, only needed to score a tackle by who made it
    (qb_tackle, k_tackle — app/domain/stat_derivations.py)."""
    play_type = core["type"]
    yards = core["yards"]
    is_td = core["is_scoring"] and "Touchdown" in play_type
    roles: dict[str, list[int]] = {}
    for p in core["participants"]:
        roles.setdefault(p["role"], [])
        if p["espn_id"] not in roles[p["role"]]:
            roles[p["role"]].append(p["espn_id"])

    lines: dict[int, dict] = {}

    def add(espn_id: int, category: str, amount: float = 1) -> None:
        line = lines.setdefault(espn_id, {})
        line[category] = line.get(category, 0) + amount

    is_completion = play_type in ("Pass Reception", "Passing Touchdown")
    is_interception = "Interception" in play_type

    long_td = is_td and yards >= LONG_TD_YARDS
    for espn_id in roles.get("passer", []):
        if is_completion:
            add(espn_id, "pass_yd", yards)
            if is_td:
                add(espn_id, "pass_td")
            if long_td:
                add(espn_id, "pass_td_40")
        if is_interception:
            add(espn_id, "pass_int")
    if is_completion:
        for espn_id in roles.get("receiver", []):
            add(espn_id, "rec")
            add(espn_id, "rec_yd", yards)
            if is_td:
                add(espn_id, "rec_td")
            if long_td:
                add(espn_id, "rec_td_40")
    for espn_id in roles.get("rusher", []):
        add(espn_id, "rush_yd", yards)
        if is_td and play_type == "Rushing Touchdown":
            add(espn_id, "rush_td")
            if long_td:
                add(espn_id, "rush_td_40")
    if play_type == "Field Goal Good":
        for espn_id in roles.get("kicker", []):
            add(espn_id, "fg_yds", yards)
            add(espn_id, fg_made_tier(yards))
    elif play_type in ("Field Goal Missed", "Blocked Field Goal"):
        for espn_id in roles.get("kicker", []):
            add(espn_id, _fg_miss_category(yards))
    for espn_id in roles.get("patScorer", []):
        add(espn_id, "xp_made")
    if is_td and ("Kickoff Return" in play_type or "Punt Return" in play_type):
        for espn_id in roles.get("scorer", []):
            add(espn_id, "ret_td")

    fumble_lost = play_type in _OPPONENT_FUMBLE_RECOVERY_TYPES
    if fumble_lost:
        for espn_id in roles.get("fumbler", []):
            add(espn_id, "fum_lost")
    for espn_id in roles.get("tackler", []):
        category = tackle_category(positions.get(espn_id))
        if category:
            add(espn_id, category)

    dst: dict[str, float] = {}
    if roles.get("sackedBy"):
        dst["def_sack"] = 1
    if is_interception:
        dst["def_int"] = 1
    if fumble_lost:
        dst["def_fum_rec"] = 1
    if is_td and ("Interception Return" in play_type or "Fumble Return" in play_type):
        dst["def_return_td"] = 1

    return lines, dst


async def build_last_play_fantasy(conn, game, play_id: str, league_id: int | None, my_team_id: int | None,
                                  opponent_team_id: int | None, rules: dict[str, float]) -> list[dict]:
    """Every fantasy-rostered player (in this league) on `play_id`, with
    the fantasy points that play earned them. Empty without a league."""
    if league_id is None:
        return []
    # game.plays is capped to the latest 50; the drives carry the rest.
    all_plays = [*game.plays, *(game.current_drive.plays if game.current_drive else []),
                 *(p for d in game.drives for p in d.plays)]
    play = next((p for p in all_plays if p.play_id == play_id), None)
    if play is None:
        return []

    core = await fetch_core_play(game.game_id, play_id)
    espn_ids = sorted({p["espn_id"] for p in core["participants"]})
    offense = play.team_abbr
    defense = next(
        (abbr for abbr in (game.home_team.abbr, game.away_team.abbr) if abbr and abbr != offense),
        None,
    )

    player_rows = await conn.fetch(
        "SELECT espn_player_id, sleeper_player_id, position FROM players WHERE espn_player_id = ANY($1::int[])",
        espn_ids,
    )
    positions = {r["espn_player_id"]: r["position"] for r in player_rows}
    sleeper_by_espn = {r["espn_player_id"]: r["sleeper_player_id"] for r in player_rows}

    lines, dst_line = play_stat_lines(core, positions)
    points_by_sleeper: dict[str, float] = {}
    for espn_id, line in lines.items():
        sleeper_id = sleeper_by_espn.get(espn_id)
        if sleeper_id is not None:
            # TE premium on a catch; game bonuses wait for the full game.
            line = derive_stat_line(line, positions.get(espn_id), bonuses=False)
            points_by_sleeper[sleeper_id] = compute_player_points(line, rules)
    # A ball-handler still "was on the play" at 0 points (the target on
    # an incompletion, a sacked QB). ESPN's catch-all roles ("other",
    # "snapper", "holder", plain tacklers) aren't — e.g. a teammate
    # tagged "other" on a strip-sack isn't something to surface.
    for p in core["participants"]:
        sleeper_id = sleeper_by_espn.get(p["espn_id"])
        if sleeper_id is not None and p["role"] in _BALL_HANDLER_ROLES:
            points_by_sleeper.setdefault(sleeper_id, 0.0)
    if defense and dst_line:
        points_by_sleeper[defense] = compute_player_points(dst_line, rules)

    if not points_by_sleeper:
        return []

    rostered = await conn.fetch(
        """
        SELECT p.sleeper_player_id AS player_id, p.full_name AS player_name, p.position,
               cr.lineup_slot, t.id AS team_id, t.team_name, o.display_name AS owner_name
        FROM current_rosters cr
        JOIN players p ON p.sleeper_player_id = cr.sleeper_player_id
        JOIN teams_by_season t ON t.id = cr.team_id
        JOIN owners o ON o.owner_id = t.owner_id
        WHERE cr.season = $1 AND cr.league_id = $2 AND cr.sleeper_player_id = ANY($3::text[])
        """,
        game.season, league_id, list(points_by_sleeper),
    )
    players = [
        {
            "player_id": r["player_id"],
            "player_name": r["player_name"],
            "position": r["position"],
            "lineup_slot": r["lineup_slot"],
            "team_name": r["team_name"],
            "owner_name": r["owner_name"],
            "is_mine": my_team_id is not None and r["team_id"] == my_team_id,
            "is_opponent": opponent_team_id is not None and r["team_id"] == opponent_team_id,
            "points": points_by_sleeper[r["player_id"]],
        }
        for r in rostered
    ]
    # Yours first, then your opponent's, then everyone else; biggest swing first within each.
    players.sort(key=lambda p: (not p["is_mine"], not p["is_opponent"], -abs(p["points"])))
    return players
