"""
Sportradar NFL adapter — UNVERIFIED against a real API key.

No SPORTRADAR_API_KEY exists in this environment (there's no Sportradar
account provisioned yet), so this was written against Sportradar's
publicly documented NFL v7 API conventions from general knowledge of
their API family, not against a real response. The overall shape
(base URL pattern, api_key query param auth, per-game play-by-play
endpoint, a `situation` block carrying down/distance/possession/field
position on in-progress games) is very likely right; individual field
names inside `_parse_game_state`/`_parse_play` may not match exactly.

Before this goes live: get a real trial key, hit one real in-progress
game's pbp.json, and diff the actual response against what
`_parse_game_state` expects — fix field names there, nowhere else
needs to change (this is the entire point of the NFLDataProvider seam;
see provider_base.py). Every parse helper below is small and isolated
specifically so that fix is a localized diff, not a rewrite.

Fails loudly at construction (not silently no-op) if SPORTRADAR_API_KEY
isn't set — same "fail loudly" discipline as app/config.py's
_require(). Nothing in the app should ever be able to construct this
provider and get partial/silently-broken behavior instead of a clear
error.
"""
import os
from datetime import datetime, timezone

import httpx

from app.gamecast.models import (
    Drive,
    GameEventType,
    GameStatus,
    LiveGame,
    LiveGameSummary,
    Play,
    PlayerRef,
    ScoringPlay,
    TeamRef,
)
from app.gamecast.provider_base import NFLDataProvider

_BASE_URL = "https://api.sportradar.com/nfl/official/trial/v7/en"

# Sportradar's own status strings -> our normalized GameStatus. Exact
# values (particularly "halftime" vs a status+quarter combination, and
# whether "complete"/"closed" are actually distinct states worth
# separating) need confirming against real data.
_STATUS_MAP = {
    "scheduled": GameStatus.SCHEDULED,
    "created": GameStatus.SCHEDULED,
    "inprogress": GameStatus.IN_PROGRESS,
    "halftime": GameStatus.HALFTIME,
    "complete": GameStatus.FINAL,
    "closed": GameStatus.FINAL,
    "postponed": GameStatus.POSTPONED,
    "cancelled": GameStatus.CANCELED,
    "canceled": GameStatus.CANCELED,
}

_EVENT_TYPE_MAP = {
    "touchdown": GameEventType.TOUCHDOWN,
    "fieldgoal": GameEventType.FIELD_GOAL,
    "field_goal": GameEventType.FIELD_GOAL,
    "interception": GameEventType.INTERCEPTION,
    "fumble": GameEventType.FUMBLE,
    "punt": GameEventType.PUNT,
    "timeout": GameEventType.TIMEOUT,
    "challenge": GameEventType.CHALLENGE,
    "firstdown": GameEventType.FIRST_DOWN,
    "first_down": GameEventType.FIRST_DOWN,
}


def _field_position_label(yards_to_goal: int, offense_abbr: str, defense_abbr: str) -> str:
    if yards_to_goal == 50:
        return "50"
    if yards_to_goal < 50:
        return f"{defense_abbr} {yards_to_goal}"
    return f"{offense_abbr} {100 - yards_to_goal}"


def _parse_play(raw: dict, drive_id: str | None) -> Play:
    # ASSUMPTION: a Sportradar play event has {id, wall_clock or clock,
    # quarter, description, play_type, start_situation:{down,yfd,
    # location:{yardline}}, statistics:[{player:{full_name,id},
    # category}]}. Unverified — see module docstring.
    play_type = str(raw.get("play_type") or raw.get("type") or "").lower()
    event_type = None
    for key, value in _EVENT_TYPE_MAP.items():
        if key in play_type or key in str(raw.get("description", "")).lower():
            event_type = value
            break

    players = []
    for stat in raw.get("statistics") or []:
        player = stat.get("player") or {}
        if player.get("full_name"):
            players.append(
                PlayerRef(
                    name=player["full_name"],
                    provider_id=str(player.get("id")) if player.get("id") else None,
                    team_abbr=(raw.get("start_situation") or {}).get("possession", {}).get("alias", ""),
                    role=str(stat.get("category", "player")),
                )
            )

    situation = raw.get("start_situation") or {}
    return Play(
        play_id=str(raw.get("id", "")),
        drive_id=drive_id,
        period=int(raw.get("quarter") or 1),
        clock=str(raw.get("clock") or "00:00"),
        team_abbr=(situation.get("possession") or {}).get("alias"),
        down=situation.get("down"),
        distance=situation.get("yfd"),
        yard_line=(situation.get("location") or {}).get("yardline"),
        description=str(raw.get("description", "")),
        play_type=play_type or "unknown",
        yards_gained=raw.get("gain"),
        is_scoring_play=bool(raw.get("scoring_play")),
        is_turnover=event_type in (GameEventType.INTERCEPTION, GameEventType.FUMBLE),
        is_first_down=event_type == GameEventType.FIRST_DOWN,
        event_type=event_type,
        players_involved=players,
        timestamp=datetime.now(timezone.utc),
    )


def _parse_game_state(raw: dict, provider_name: str = "sportradar") -> LiveGame:
    # ASSUMPTION: top-level {id, status, scheduled, season:{year},
    # week:{sequence}, summary:{home:{alias,name,points},
    # away:{...}}, situation:{down,yfd,possession:{alias},
    # location:{yardline}}, quarter, clock, periods:[{...,pbp:[...]}]}.
    # Unverified — see module docstring.
    status = _STATUS_MAP.get(str(raw.get("status", "")).lower(), GameStatus.SCHEDULED)
    summary = raw.get("summary") or raw
    home = summary.get("home") or {}
    away = summary.get("away") or {}

    situation = raw.get("situation") or {}
    down = situation.get("down")
    distance = situation.get("yfd")
    yard_line = (situation.get("location") or {}).get("yardline")
    possession_abbr = (situation.get("possession") or {}).get("alias")

    drives: list[Drive] = []
    all_plays: list[Play] = []
    scoring_plays: list[ScoringPlay] = []
    home_score = int(home.get("points") or 0)
    away_score = int(away.get("points") or 0)

    for period_idx, period in enumerate(raw.get("periods") or []):
        for drive_idx, raw_drive in enumerate(period.get("pbp") or []):
            drive_id = f"{raw.get('id')}-d{period_idx}-{drive_idx}"
            drive_plays = [_parse_play(p, drive_id) for p in raw_drive.get("events") or [] if p.get("type") != "timeout"]
            all_plays.extend(drive_plays)
            for p in drive_plays:
                if p.is_scoring_play:
                    scoring_plays.append(
                        ScoringPlay(
                            play_id=p.play_id,
                            period=p.period,
                            clock=p.clock,
                            team_abbr=p.team_abbr or "",
                            score_type="FG" if p.play_type == "field_goal" else "TD",
                            description=p.description,
                            home_score_after=home_score,
                            away_score_after=away_score,
                        )
                    )
            if drive_plays:
                drives.append(
                    Drive(
                        drive_id=drive_id,
                        team_abbr=raw_drive.get("team", {}).get("alias", drive_plays[0].team_abbr or ""),
                        play_count=len(drive_plays),
                        yards=sum(p.yards_gained or 0 for p in drive_plays),
                        duration=str(raw_drive.get("duration", "0:00")),
                        start_yard_line=drive_plays[0].yard_line,
                        result=raw_drive.get("result"),
                        plays=drive_plays,
                    )
                )

    yards_to_goal = None
    field_label = None
    if yard_line is not None and possession_abbr:
        defense_abbr = away.get("alias") if possession_abbr == home.get("alias") else home.get("alias")
        yards_to_goal = 100 - yard_line if yard_line <= 50 else yard_line
        field_label = _field_position_label(yards_to_goal, possession_abbr, defense_abbr or "")

    return LiveGame(
        game_id=str(raw.get("id")),
        provider=provider_name,
        status=status,
        season=int((raw.get("season") or {}).get("year") or 0),
        week=int((raw.get("week") or {}).get("sequence") or 0),
        scheduled_start=raw.get("scheduled") or datetime.now(timezone.utc),
        home_team=TeamRef(abbr=home.get("alias", ""), name=home.get("name", ""), score=home_score),
        away_team=TeamRef(abbr=away.get("alias", ""), name=away.get("name", ""), score=away_score),
        period=raw.get("quarter"),
        period_label=({1: "1st", 2: "2nd", 3: "3rd", 4: "4th"}).get(raw.get("quarter"))
        if status == GameStatus.IN_PROGRESS
        else ("Final" if status == GameStatus.FINAL else "Halftime" if status == GameStatus.HALFTIME else None),
        clock=raw.get("clock") if status == GameStatus.IN_PROGRESS else None,
        possession_team_abbr=possession_abbr if status == GameStatus.IN_PROGRESS else None,
        down=down,
        distance=distance,
        yards_to_goal=yards_to_goal,
        field_position_label=field_label,
        is_redzone=bool(yards_to_goal is not None and yards_to_goal <= 20),
        current_drive=drives[-1] if drives and status == GameStatus.IN_PROGRESS else None,
        drives=list(reversed(drives)),
        plays=list(reversed(all_plays))[:50],
        scoring_plays=list(reversed(scoring_plays)),
        last_updated=datetime.now(timezone.utc),
    )


class SportradarProvider(NFLDataProvider):
    def __init__(self):
        self._api_key = os.getenv("SPORTRADAR_API_KEY")
        if not self._api_key:
            raise RuntimeError(
                "SportradarProvider requires SPORTRADAR_API_KEY — construct it only when that's set "
                "(see providers/__init__.py's factory), never unconditionally."
            )

    async def list_live_games(self) -> list[LiveGameSummary]:
        today = datetime.now(timezone.utc).strftime("%Y/%m/%d")
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(f"{_BASE_URL}/games/{today}/schedule.json", params={"api_key": self._api_key})
            response.raise_for_status()
            data = response.json()

        summaries = []
        for raw in data.get("games") or []:
            status = _STATUS_MAP.get(str(raw.get("status", "")).lower(), GameStatus.SCHEDULED)
            if status not in (GameStatus.IN_PROGRESS, GameStatus.HALFTIME):
                continue
            home = raw.get("home") or {}
            away = raw.get("away") or {}
            summaries.append(
                LiveGameSummary(
                    game_id=str(raw.get("id")),
                    provider="sportradar",
                    status=status,
                    season=int((raw.get("season") or {}).get("year") or 0),
                    week=int((raw.get("week") or {}).get("sequence") or 0),
                    scheduled_start=raw.get("scheduled") or datetime.now(timezone.utc),
                    home_team=TeamRef(abbr=home.get("alias", ""), name=home.get("name", ""), score=int(home.get("points") or 0)),
                    away_team=TeamRef(abbr=away.get("alias", ""), name=away.get("name", ""), score=int(away.get("points") or 0)),
                    period=raw.get("quarter"),
                    clock=raw.get("clock"),
                )
            )
        return summaries

    async def get_game_state(self, game_id: str) -> LiveGame:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(f"{_BASE_URL}/games/{game_id}/pbp.json", params={"api_key": self._api_key})
            response.raise_for_status()
            raw = response.json()
        return _parse_game_state(raw)
