"""
The normalized live-game model — the one shape every part of the app
above the provider layer (the live-game service, the WS broadcaster,
the Gamecast UI) actually works with. A provider adapter's only job is
mapping its own response shape into these models; nothing else in the
app ever sees a provider's native JSON.

Pydantic rather than plain dicts (the dominant style in app/domain/)
on purpose: this is a genuine external-facing contract shared with the
frontend team building against it in parallel, and FastAPI serializes
these directly (datetimes included) with no jsonable_encoder ceremony.
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


class GameStatus(str, Enum):
    SCHEDULED = "scheduled"
    IN_PROGRESS = "in_progress"
    HALFTIME = "halftime"
    FINAL = "final"
    POSTPONED = "postponed"
    CANCELED = "canceled"


class GameEventType(str, Enum):
    GAME_STARTED = "GAME_STARTED"
    QUARTER_STARTED = "QUARTER_STARTED"
    PLAY_COMPLETED = "PLAY_COMPLETED"
    FIRST_DOWN = "FIRST_DOWN"
    TOUCHDOWN = "TOUCHDOWN"
    FIELD_GOAL = "FIELD_GOAL"
    TURNOVER = "TURNOVER"
    INTERCEPTION = "INTERCEPTION"
    FUMBLE = "FUMBLE"
    PUNT = "PUNT"
    CHALLENGE = "CHALLENGE"
    TIMEOUT = "TIMEOUT"
    QUARTER_ENDED = "QUARTER_ENDED"
    HALFTIME = "HALFTIME"
    GAME_ENDED = "GAME_ENDED"


class TeamRef(BaseModel):
    abbr: str
    name: str
    score: int = 0


class PlayerRef(BaseModel):
    name: str
    provider_id: str | None = None
    team_abbr: str
    role: str  # "passer" | "rusher" | "receiver" | "kicker" | "defender" | ...


class Play(BaseModel):
    play_id: str
    drive_id: str | None = None
    period: int
    clock: str
    team_abbr: str | None = None  # offense on this play
    down: int | None = None
    distance: int | None = None
    yard_line: int | None = None  # yards to goal at the START of this play
    description: str
    play_type: str  # "pass" | "rush" | "punt" | "field_goal" | "kickoff" | "penalty" | "timeout" | "extra_point"
    yards_gained: int | None = None
    is_scoring_play: bool = False
    is_turnover: bool = False
    is_first_down: bool = False
    event_type: GameEventType | None = None
    players_involved: list[PlayerRef] = Field(default_factory=list)
    timestamp: datetime


class Drive(BaseModel):
    drive_id: str
    team_abbr: str
    play_count: int = 0
    yards: int = 0
    duration: str = "0:00"
    start_yard_line: int | None = None
    result: str | None = None  # "TD" | "FG" | "PUNT" | "TURNOVER" | "END_OF_HALF" | None (still in progress)
    plays: list[Play] = Field(default_factory=list)


class ScoringPlay(BaseModel):
    play_id: str
    period: int
    clock: str
    team_abbr: str
    score_type: str  # "TD" | "FG" | "SAFETY" | "2PT"
    description: str
    home_score_after: int
    away_score_after: int


class LiveGameSummary(BaseModel):
    """Lightweight — the ticker and game-discovery list use this, never
    the full play-by-play payload."""

    game_id: str
    provider: str
    status: GameStatus
    season: int
    week: int
    scheduled_start: datetime
    home_team: TeamRef
    away_team: TeamRef
    period: int | None = None
    period_label: str | None = None
    clock: str | None = None


class LiveGame(BaseModel):
    """Everything the Gamecast UI renders for one game."""

    game_id: str
    provider: str
    status: GameStatus
    season: int
    week: int
    scheduled_start: datetime
    home_team: TeamRef
    away_team: TeamRef
    period: int | None = None
    period_label: str | None = None
    clock: str | None = None
    possession_team_abbr: str | None = None
    down: int | None = None
    distance: int | None = None
    yards_to_goal: int | None = None  # 0-100, distance the possessing team must travel to score
    field_position_label: str | None = None  # human-readable, e.g. "BUF 38"
    is_redzone: bool = False
    current_drive: Drive | None = None
    drives: list[Drive] = Field(default_factory=list)
    plays: list[Play] = Field(default_factory=list)  # most-recent-first, capped
    scoring_plays: list[ScoringPlay] = Field(default_factory=list)
    last_updated: datetime

    def to_summary(self) -> LiveGameSummary:
        return LiveGameSummary(
            game_id=self.game_id,
            provider=self.provider,
            status=self.status,
            season=self.season,
            week=self.week,
            scheduled_start=self.scheduled_start,
            home_team=self.home_team,
            away_team=self.away_team,
            period=self.period,
            period_label=self.period_label,
            clock=self.clock,
        )
