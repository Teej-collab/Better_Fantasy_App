"""
A Sleeper league, brought in the same way an ESPN one is (2026-10-24):
implements FantasyProvider (app/providers/base.py) against Sleeper's
free, keyless league API (docs.sleeper.com), so a connected Sleeper
league fills the same tables an ESPN connection does — teams_by_season,
matchups (pairings and scores), rosters (each week's lineup with points)
and final_standings — and everything built on them (standings, recaps,
write-ups, live scores, awards) works unchanged.

How Sleeper's shapes map onto this app's:
- a Sleeper roster (roster_id 1..N) is a team; roster_id goes in
  teams_by_season.espn_team_id, unique within the league like ESPN's.
- a Sleeper user is an owner, keyed in owners.espn_member_id as
  "sleeper:<user_id>" so it can never collide with an ESPN member id.
  A roster with no owner (an orphan team) gets "sleeper-roster:<league>:<roster_id>".
- Sleeper player ids ARE this app's sleeper_player_id, so lineups map
  straight onto players. A team defense is keyed by its abbreviation;
  Sleeper's "WAS" is this app's "WSH" (see app/providers/sleeper/teams.py).
- a matchup is the two rosters sharing a matchup_id that week.

Sleeper asks for under 1000 calls a minute; a live tick here is two.
"""
import logging
from decimal import Decimal

import httpx

from app.providers.base import FantasyProvider

logger = logging.getLogger(__name__)

API = "https://api.sleeper.app/v1"
_TIMEOUT = 20
MAX_WEEK = 17
# Sleeper roster_positions -> the slot labels this app's rosters use (ESPN's).
_SLOT = {
    "FLEX": "RB/WR/TE",
    "WRRB_FLEX": "RB/WR",
    "REC_FLEX": "WR/TE",
    "SUPER_FLEX": "OP",
    "DEF": "D/ST",
    "BN": "BE",
    "IDP_FLEX": "IDP",
}
_ABBR = {"WAS": "WSH"}


class SleeperLeagueNotFound(Exception):
    pass


async def _get(path: str):
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        response = await client.get(f"{API}{path}")
    response.raise_for_status()
    return response.json()


def parse_league_id(text: str) -> str | None:
    """A Sleeper league link (sleeper.com/leagues/<id>/…) or the bare id."""
    import re

    text = (text or "").strip()
    match = re.search(r"leagues/(\d{6,25})", text) or re.fullmatch(r"(\d{6,25})", text)
    return match.group(1) if match else None


async def fetch_league(sleeper_league_id: str) -> dict:
    """The league's own record, or SleeperLeagueNotFound (Sleeper answers
    an unknown id with a literal null)."""
    try:
        league = await _get(f"/league/{sleeper_league_id}")
    except httpx.HTTPError as e:
        raise SleeperLeagueNotFound(str(e)) from e
    if not league or league.get("sport") not in (None, "nfl"):
        raise SleeperLeagueNotFound(sleeper_league_id)
    return league


def _player_id(pid: str) -> str:
    return _ABBR.get(pid, pid)


class SleeperProvider(FantasyProvider):
    def __init__(self, sleeper_league_id: str):
        self.sleeper_league_id = sleeper_league_id
        self._week_cache: dict[int, list] = {}

    async def _league(self) -> dict:
        return await fetch_league(self.sleeper_league_id)

    async def _matchups(self, week: int) -> list:
        # One live tick asks for matchups and rosters of the same week;
        # both come from this one call, so it's fetched once per provider.
        if week not in self._week_cache:
            self._week_cache[week] = await _get(f"/league/{self.sleeper_league_id}/matchups/{week}") or []
        return self._week_cache[week]

    async def get_current_week(self, season: int) -> int:
        state = await _get("/state/nfl")
        return int(state.get("week") or state.get("display_week") or 1)

    async def sync_teams(self, pool, season: int, league_id: int = 1) -> int:
        users = await _get(f"/league/{self.sleeper_league_id}/users") or []
        rosters = await _get(f"/league/{self.sleeper_league_id}/rosters") or []
        by_user = {u["user_id"]: u for u in users}
        async with pool.acquire() as conn:
            for roster in rosters:
                user = by_user.get(roster.get("owner_id"))
                if user:
                    member_key = f"sleeper:{user['user_id']}"
                    display_name = user.get("display_name") or "Sleeper owner"
                    team_name = (user.get("metadata") or {}).get("team_name") or f"Team {display_name}"
                else:
                    member_key = f"sleeper-roster:{self.sleeper_league_id}:{roster['roster_id']}"
                    display_name = "Open team"
                    team_name = f"Team {roster['roster_id']}"
                # A Sleeper user already claimed here maps to their owner
                # (app/domain/owner_merge.py records the alias).
                owner_id = await conn.fetchval(
                    "SELECT owner_id FROM owner_espn_aliases WHERE espn_member_id = $1", member_key
                ) or await conn.fetchval(
                    """
                    INSERT INTO owners (espn_member_id, display_name)
                    VALUES ($1, $2)
                    ON CONFLICT (espn_member_id)
                    DO UPDATE SET display_name = CASE
                        WHEN owners.display_name_is_custom THEN owners.display_name
                        ELSE EXCLUDED.display_name
                    END
                    RETURNING owner_id
                    """,
                    member_key, display_name,
                )
                await conn.execute(
                    """
                    INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name, league_id)
                    VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT (season, espn_team_id, league_id)
                    DO UPDATE SET owner_id = EXCLUDED.owner_id, team_name = CASE
                        WHEN teams_by_season.team_name_is_custom THEN teams_by_season.team_name
                        ELSE EXCLUDED.team_name
                    END
                    """,
                    season, roster["roster_id"], owner_id, team_name, league_id,
                )
        return len(rosters)

    async def _team_ids(self, conn, season: int, league_id: int) -> dict[int, int]:
        rows = await conn.fetch(
            "SELECT id, espn_team_id FROM teams_by_season WHERE season = $1 AND league_id = $2", season, league_id
        )
        return {r["espn_team_id"]: r["id"] for r in rows}

    async def _save_matchups(self, conn, season: int, week: int, league_id: int, playoff_start: int) -> int:
        entries = await self._matchups(week)
        teams = await self._team_ids(conn, season, league_id)
        # Mirror mode copies Sleeper's rosters into current_rosters, but
        # Sleeper still keeps the score until the league switches over.
        from app.domain.league_mode import mirror_platform

        has_in_app_scoring = await conn.fetchval(
            "SELECT 1 FROM current_rosters WHERE season = $1 AND league_id = $2 LIMIT 1", season, league_id
        ) and not await mirror_platform(conn, league_id)
        pairs: dict[int, list] = {}
        for e in entries:
            if e.get("matchup_id") is not None:
                pairs.setdefault(e["matchup_id"], []).append(e)
        saved = 0
        for pair in pairs.values():
            if len(pair) != 2:
                continue
            home, away = sorted(pair, key=lambda e: e["roster_id"])
            home_id, away_id = teams.get(home["roster_id"]), teams.get(away["roster_id"])
            if home_id is None or away_id is None:
                continue
            is_playoff = bool(playoff_start) and week >= playoff_start
            if has_in_app_scoring:
                await conn.execute(
                    """
                    INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff, league_id)
                    VALUES ($1, $2, $3, $4, 0, 0, $5, $6)
                    ON CONFLICT (season, week, home_team_id, away_team_id) DO UPDATE SET is_playoff = EXCLUDED.is_playoff
                    """,
                    season, week, home_id, away_id, is_playoff, league_id,
                )
            else:
                await conn.execute(
                    """
                    INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff, league_id)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    ON CONFLICT (season, week, home_team_id, away_team_id)
                    DO UPDATE SET home_score = EXCLUDED.home_score, away_score = EXCLUDED.away_score,
                                  is_playoff = EXCLUDED.is_playoff
                    """,
                    season, week, home_id, away_id,
                    Decimal(str(round(float(home.get("points") or 0), 2))),
                    Decimal(str(round(float(away.get("points") or 0), 2))),
                    is_playoff, league_id,
                )
            saved += 1
        return saved

    async def sync_matchups(self, pool, season: int, league_id: int = 1) -> int:
        league = await self._league()
        playoff_start = int((league.get("settings") or {}).get("playoff_week_start") or 0)
        last = min(await self.get_current_week(season), MAX_WEEK)
        saved = 0
        async with pool.acquire() as conn:
            for week in range(1, last + 1):
                saved += await self._save_matchups(conn, season, week, league_id, playoff_start)
        return saved

    async def sync_matchups_for_week(self, pool, season: int, week: int, league_id: int = 1) -> int:
        league = await self._league()
        playoff_start = int((league.get("settings") or {}).get("playoff_week_start") or 0)
        async with pool.acquire() as conn:
            return await self._save_matchups(conn, season, week, league_id, playoff_start)

    async def _save_rosters(self, conn, season: int, week: int, league_id: int, slots: list[str]) -> bool:
        entries = await self._matchups(week)
        if not entries:
            return False
        teams = await self._team_ids(conn, season, league_id)
        ids = {_player_id(p) for e in entries for p in (e.get("players") or [])}
        players = {
            r["sleeper_player_id"]: r
            for r in await conn.fetch(
                "SELECT sleeper_player_id, full_name, position, pro_team, espn_player_id FROM players "
                "WHERE sleeper_player_id = ANY($1::text[])",
                list(ids),
            )
        }
        starter_slots = [s for s in slots if s not in ("BN", "IR", "TAXI")]
        for e in entries:
            team_id = teams.get(e["roster_id"])
            if team_id is None:
                continue
            points = e.get("players_points") or {}
            starters = [p for p in (e.get("starters") or [])]
            slot_of = {
                _player_id(p): _SLOT.get(starter_slots[i], starter_slots[i]) if i < len(starter_slots) else "BE"
                for i, p in enumerate(starters) if p and p != "0"
            }
            await conn.execute(
                "DELETE FROM rosters WHERE season = $1 AND week = $2 AND team_id = $3", season, week, team_id
            )
            for raw in e.get("players") or []:
                pid = _player_id(raw)
                p = players.get(pid)
                position = (p["position"] if p else None) or None
                await conn.execute(
                    """
                    INSERT INTO rosters
                        (season, week, team_id, player_name, position, lineup_slot, points_scored,
                         points_projected, espn_player_id, pro_team, league_id)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9, $10)
                    """,
                    season, week, team_id, p["full_name"] if p else pid,
                    "D/ST" if position == "DEF" else position,
                    slot_of.get(pid, "BE"),
                    Decimal(str(round(float(points.get(raw) or 0), 2))),
                    p["espn_player_id"] if p else None, p["pro_team"] if p else None, league_id,
                )
        return True

    async def sync_rosters(self, pool, season: int, league_id: int = 1) -> int:
        league = await self._league()
        slots = league.get("roster_positions") or []
        last = min(await self.get_current_week(season), MAX_WEEK)
        saved = 0
        async with pool.acquire() as conn:
            for week in range(1, last + 1):
                if await self._save_rosters(conn, season, week, league_id, slots):
                    saved += 1
        return saved

    async def sync_rosters_for_week(self, pool, season: int, week: int, league_id: int = 1) -> int:
        league = await self._league()
        async with pool.acquire() as conn:
            return 1 if await self._save_rosters(conn, season, week, league_id, league.get("roster_positions") or []) else 0

    async def sync_final_standings(self, pool, season: int, league_id: int = 1) -> int:
        """Only once Sleeper marks the season complete: the winners
        bracket's placement games (p=1 is the final, p=3 third place…)
        give each finisher's rank."""
        league = await self._league()
        if league.get("status") != "complete":
            return 0
        bracket = await _get(f"/league/{self.sleeper_league_id}/winners_bracket") or []
        ranks: dict[int, int] = {}
        for game in bracket:
            place = game.get("p")
            if place and game.get("w") and game.get("l"):
                ranks[game["w"]] = place
                ranks[game["l"]] = place + 1
        saved = 0
        async with pool.acquire() as conn:
            teams = await self._team_ids(conn, season, league_id)
            for roster_id, rank in ranks.items():
                team_id = teams.get(roster_id)
                if team_id is None:
                    continue
                await conn.execute(
                    """
                    INSERT INTO final_standings (season, team_id, final_rank, league_id)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (season, team_id) DO UPDATE SET final_rank = EXCLUDED.final_rank
                    """,
                    season, team_id, rank, league_id,
                )
                saved += 1
        return saved


async def leagues_for_username(username: str, season: int) -> list[dict]:
    """A Sleeper user's NFL leagues this season, by username (2026-10-24):
    the connect flow's "What's your Sleeper username?" instead of copying a
    link. Raises SleeperLeagueNotFound when there's no such user."""
    import re

    name = (username or "").strip().lstrip("@")
    if not re.fullmatch(r"[A-Za-z0-9_.-]{2,40}", name):
        raise SleeperLeagueNotFound(username)
    try:
        user = await _get(f"/user/{name}")
    except httpx.HTTPError as e:
        raise SleeperLeagueNotFound(username) from e
    if not user or not user.get("user_id"):
        raise SleeperLeagueNotFound(username)
    leagues = await _get(f"/user/{user['user_id']}/leagues/nfl/{season}") or []
    return [
        {
            "league_id": lg["league_id"],
            "name": lg.get("name") or "Sleeper league",
            "teams": lg.get("total_rosters"),
            "status": lg.get("status"),
        }
        for lg in leagues
    ]
