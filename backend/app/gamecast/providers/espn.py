"""
Real NFL data via ESPN's public, unauthenticated scoreboard/summary API
(site.api.espn.com) — the same source app/providers/nfl_scoreboard.py's
ticker already uses, extended here with ESPN's per-game "summary"
endpoint for real drives/plays/scoring-plays. This is the default
Gamecast provider (see providers/__init__.py's factory) whenever
SPORTRADAR_API_KEY isn't configured: every real game — live or already
final, preseason included — gets a real Gamecast with real stats, not
a simulation. MockNFLDataProvider is still available (set
GAMECAST_PROVIDER=mock) for local development against a fast,
deterministic, always-in-progress game with no network dependency.

Requests both endpoints fresh every call rather than caching — a real
game's state only changes a handful of times a minute even when live,
and app/scheduler.py's gamecast poll job (ENABLE_GAMECAST_SCHEDULER)
already rate-limits how often this runs in practice; the cost of an
unauthenticated public GET is negligible either way.
"""
import re
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

SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"
SUMMARY_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary"

_DRIVE_RESULT_MAP = {
    "TD": "TD",
    "INT TD": "TD",
    "FUMBLE TD": "TD",
    "FG": "FG",
    "PUNT": "PUNT",
    "INT": "TURNOVER",
    "FUMBLE": "TURNOVER",
    "TURNOVER ON DOWNS": "TURNOVER",
    "END OF HALF": "END_OF_HALF",
    "END OF GAME": "END_OF_HALF",
}


def _drive_result(result: str | None) -> str | None:
    if not result:
        return None
    return _DRIVE_RESULT_MAP.get(result.upper())


# ESPN's public summary endpoint has no structured per-play participant
# field (confirmed against a real live payload, 2026-09-18: `teamParticipants`
# is team-level offense/defense only, no player names or IDs) — the only
# place a play's real players are named at all is its own free-text
# `text` description, always in ESPN's own "F.Lastname" shorthand
# ("J.Bates kicks 66 yards...", "P.Mahomes pass complete to T.Kelce...").
# This is the real root cause behind Fantasy Impact showing nothing for
# any real game: players_involved was hardcoded to [] here, so the
# frontend (FantasyImpact.tsx) had nothing to ever cross-reference
# against a roster. `\b[A-Z]\.[A-Z][a-zA-Z'-]+\b` matches that exact
# shorthand (initial, period, surname — apostrophes/hyphens allowed for
# names like O'Neill) wherever it appears in the description, deduped
# per play. Deliberately kept in this shorthand rather than resolved
# to a guessed real full name (a bare-surname guess risks matching the
# wrong real player who happens to share it) — the frontend
# (FantasyImpact.tsx) already has to compare three different providers'
# three different name shapes (this shorthand, Sportradar's real full
# name, the mock provider's bare surname) against a roster's own real
# full name, and does it by comparing just the surname, the one thing
# all four shapes agree on.
_PLAYER_MENTION_RE = re.compile(r"\b([A-Z])\.([A-Z][a-zA-Z'-]+)\b")


def _players_mentioned(text: str, team_abbr: str) -> list[PlayerRef]:
    seen: set[str] = set()
    refs: list[PlayerRef] = []
    for initial, surname in _PLAYER_MENTION_RE.findall(text or ""):
        name = f"{initial}. {surname}"
        if name in seen:
            continue
        seen.add(name)
        refs.append(PlayerRef(name=name, team_abbr=team_abbr, role="mentioned"))
    return refs


def _play_type(type_text: str) -> str:
    t = (type_text or "").lower()
    if "sack" in t:
        return "pass"
    if "pass" in t:
        return "pass"
    if "rush" in t:
        return "rush"
    if "punt" in t:
        return "punt"
    if "field goal" in t:
        return "field_goal"
    if "kickoff" in t:
        return "kickoff"
    if "penalty" in t:
        return "penalty"
    if "timeout" in t:
        return "timeout"
    if "point after" in t or "extra point" in t or "two-point" in t:
        return "extra_point"
    return "other"


def _event_type(play_type: str, is_scoring: bool, is_turnover: bool, is_first_down: bool) -> GameEventType | None:
    if is_scoring:
        return GameEventType.FIELD_GOAL if play_type == "field_goal" else GameEventType.TOUCHDOWN
    if is_turnover:
        return GameEventType.TURNOVER
    if play_type == "punt":
        return GameEventType.PUNT
    if is_first_down:
        return GameEventType.FIRST_DOWN
    return GameEventType.PLAY_COMPLETED


def _score_type(type_dict: dict) -> str:
    abbr = (type_dict.get("abbreviation") or "").upper()
    if abbr in ("TD", "FG"):
        return abbr
    text = (type_dict.get("text") or "").upper()
    if "SAFETY" in text:
        return "SAFETY"
    if "TWO" in text:
        return "2PT"
    if "FIELD GOAL" in text:
        return "FG"
    return "TD"


def _game_status(status_type: dict) -> GameStatus:
    name = (status_type.get("name") or "").upper()
    if "HALFTIME" in name:
        return GameStatus.HALFTIME
    state = status_type.get("state")
    if state == "post":
        return GameStatus.FINAL
    if state == "in":
        return GameStatus.IN_PROGRESS
    return GameStatus.SCHEDULED


def _competitors(competition: dict) -> tuple[dict, dict] | None:
    competitors = competition.get("competitors", [])
    home = next((c for c in competitors if c.get("homeAway") == "home"), None)
    away = next((c for c in competitors if c.get("homeAway") == "away"), None)
    if not home or not away:
        return None
    return home, away


def _team_ref(competitor: dict) -> TeamRef:
    team = competitor.get("team", {})
    return TeamRef(
        abbr=team.get("abbreviation", ""),
        name=team.get("displayName", ""),
        score=int(competitor.get("score") or 0),
    )


class ESPNNFLDataProvider(NFLDataProvider):
    async def list_live_games(self) -> list[LiveGameSummary]:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(SCOREBOARD_URL)
            response.raise_for_status()
            data = response.json()

        season = data.get("season", {}).get("year") or 0
        week = data.get("week", {}).get("number") or 0

        summaries: list[LiveGameSummary] = []
        for event in data.get("events", []):
            competitions = event.get("competitions") or []
            if not competitions:
                continue
            competition = competitions[0]
            pair = _competitors(competition)
            if pair is None:
                continue
            home, away = pair
            status = competition.get("status", {})
            status_type = status.get("type", {})
            summaries.append(
                LiveGameSummary(
                    game_id=str(event.get("id")),
                    provider="espn",
                    status=_game_status(status_type),
                    season=season,
                    week=week,
                    scheduled_start=event.get("date"),
                    home_team=_team_ref(home),
                    away_team=_team_ref(away),
                    period=status.get("period"),
                    period_label=status_type.get("shortDetail"),
                    clock=status.get("displayClock"),
                )
            )
        return summaries

    async def get_game_state(self, game_id: str) -> LiveGame:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(SUMMARY_URL, params={"event": game_id})
            if response.status_code == 404:
                raise KeyError(f"Unknown ESPN game_id: {game_id!r}")
            response.raise_for_status()
            data = response.json()

        header = data.get("header", {})
        competitions = header.get("competitions") or []
        if not competitions:
            raise KeyError(f"Unknown ESPN game_id: {game_id!r}")
        competition = competitions[0]
        pair = _competitors(competition)
        if pair is None:
            raise KeyError(f"Unknown ESPN game_id: {game_id!r}")
        home, away = pair
        home_abbr = home.get("team", {}).get("abbreviation", "")
        away_abbr = away.get("team", {}).get("abbreviation", "")

        status = competition.get("status", {})
        status_type = status.get("type", {})
        game_status = _game_status(status_type)
        season = header.get("season", {}).get("year") or 0
        week = header.get("week") or 0
        now = datetime.now(timezone.utc)

        drives_payload = data.get("drives") or {}
        drive_dicts = list(drives_payload.get("previous") or [])
        current_drive_dict = drives_payload.get("current")
        has_separate_current = bool(current_drive_dict) and game_status == GameStatus.IN_PROGRESS
        if current_drive_dict:
            drive_dicts.append(current_drive_dict)

        drives: list[Drive] = []
        plays_out: list[Play] = []
        last_play_end: dict | None = None
        last_offense_abbr: str | None = None

        for d_index, d in enumerate(drive_dicts):
            drive_team_abbr = d.get("team", {}).get("abbreviation", "")
            time_elapsed = d.get("timeElapsed") or {}
            drive = Drive(
                drive_id=str(d.get("id") or f"{game_id}-d{d_index}"),
                team_abbr=drive_team_abbr,
                play_count=int(d.get("offensivePlays") or 0),
                yards=int(d.get("yards") or 0),
                duration=time_elapsed.get("displayValue", "0:00"),
                start_yard_line=(d.get("start") or {}).get("yardLine"),
                result=_drive_result(d.get("result")),
            )
            for p in d.get("plays") or []:
                play_type = _play_type((p.get("type") or {}).get("text", ""))
                is_scoring = bool(p.get("scoringPlay"))
                is_turnover = bool(p.get("isTurnover"))
                start = p.get("start") or {}
                end = p.get("end") or {}
                is_first_down = bool(start) and bool(end) and start.get("down") != 1 and end.get("down") == 1
                play = Play(
                    play_id=str(p.get("id") or f"{game_id}-p{len(plays_out)}"),
                    drive_id=drive.drive_id,
                    period=((p.get("period") or {}).get("number")) or 1,
                    clock=(p.get("clock") or {}).get("displayValue") or "",
                    team_abbr=drive_team_abbr or None,
                    down=start.get("down"),
                    distance=start.get("distance"),
                    yard_line=start.get("yardsToEndzone"),
                    description=p.get("text") or "",
                    play_type=play_type,
                    yards_gained=p.get("statYardage"),
                    is_scoring_play=is_scoring,
                    is_turnover=is_turnover,
                    is_first_down=is_first_down,
                    event_type=_event_type(play_type, is_scoring, is_turnover, is_first_down),
                    players_involved=_players_mentioned(p.get("text") or "", drive_team_abbr or ""),
                    timestamp=now,
                )
                drive.plays.append(play)
                plays_out.append(play)
                last_play_end = end or last_play_end
                last_offense_abbr = drive_team_abbr or last_offense_abbr
            drives.append(drive)

        current_drive = drives[-1] if (has_separate_current and drives) else None
        historical_drives = drives[:-1] if current_drive else drives

        scoring_plays: list[ScoringPlay] = []
        for sp in data.get("scoringPlays") or []:
            scoring_plays.append(
                ScoringPlay(
                    play_id=str(sp.get("id") or f"{game_id}-sp{len(scoring_plays)}"),
                    period=((sp.get("period") or {}).get("number")) or 1,
                    clock=(sp.get("clock") or {}).get("displayValue") or "",
                    team_abbr=(sp.get("team") or {}).get("abbreviation", ""),
                    score_type=_score_type(sp.get("type") or {}),
                    description=sp.get("text") or "",
                    home_score_after=int(sp.get("homeScore") or 0),
                    away_score_after=int(sp.get("awayScore") or 0),
                )
            )

        down = distance = yards_to_goal = None
        possession_abbr = None
        field_label = None
        if game_status == GameStatus.IN_PROGRESS and last_play_end:
            down = last_play_end.get("down")
            distance = last_play_end.get("distance")
            yards_to_goal = last_play_end.get("yardsToEndzone")
            possession_abbr = last_offense_abbr
            field_label = last_play_end.get("possessionText")

        clock = status.get("displayClock")
        period = status.get("period")
        period_label = status_type.get("shortDetail")
        if game_status == GameStatus.FINAL:
            clock = "Final"
            period_label = "Final"
        elif game_status == GameStatus.HALFTIME:
            clock = "Halftime"
            period_label = "Halftime"

        return LiveGame(
            game_id=str(game_id),
            provider="espn",
            status=game_status,
            season=season,
            week=week,
            scheduled_start=competition.get("date"),
            home_team=TeamRef(abbr=home_abbr, name=home.get("team", {}).get("displayName", ""), score=int(home.get("score") or 0)),
            away_team=TeamRef(abbr=away_abbr, name=away.get("team", {}).get("displayName", ""), score=int(away.get("score") or 0)),
            period=period,
            period_label=period_label,
            clock=clock,
            possession_team_abbr=possession_abbr,
            down=down,
            distance=distance,
            yards_to_goal=yards_to_goal,
            field_position_label=field_label,
            is_redzone=bool(yards_to_goal is not None and yards_to_goal <= 20),
            current_drive=current_drive,
            drives=list(reversed(historical_drives)),
            plays=list(reversed(plays_out))[:50],
            scoring_plays=list(reversed(scoring_plays)),
            last_updated=now,
        )
