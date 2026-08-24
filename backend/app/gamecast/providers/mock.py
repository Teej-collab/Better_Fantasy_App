"""
Simulated live games — what actually powers Gamecast in this
environment, since no SPORTRADAR_API_KEY is configured anywhere yet
(see providers/__init__.py's factory). Implements the exact same
NFLDataProvider ABC a real provider would, so the rest of the app
(service.py, the router, the frontend) can't tell the difference.

Design: for each mock game, a full play-by-play "script" is generated
once at process start (deterministic, seeded RNG — same script every
restart, so behavior is reproducible for testing) as a flat, ordered
list of _ScriptedPlay entries, each tagged with reveal_at_seconds — a
real wall-clock offset (seconds since this provider was constructed)
at which that play becomes visible. get_game_state() replays every
play whose reveal_at_seconds has passed through a small state reducer
to build the current score/drive/down-distance/possession — the same
"replay a log up to now" shape a real provider's own incremental feed
would produce, just generated locally instead of fetched.

A full mock game compresses a real ~60 simulated game-clock minutes
into GAME_DURATION_SECONDS of real wall-clock time (default 4 minutes)
— fast enough to watch a complete kickoff-to-final arc in one sitting
without an actual 3-hour wait, while still ticking believably slowly
enough (one play every several real seconds) for a poller running
every 10-15 seconds to show visible incremental progress rather than
the whole game appearing at once.
"""
import random
from datetime import datetime, timedelta, timezone

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

GAME_DURATION_SECONDS = 240.0  # real wall-clock seconds, kickoff -> final
SIM_SECONDS_PER_QUARTER = 15 * 60  # a real NFL quarter, in simulated seconds
SIM_SECONDS_TOTAL = SIM_SECONDS_PER_QUARTER * 4
_TIME_SCALE = SIM_SECONDS_TOTAL / GAME_DURATION_SECONDS  # sim seconds per real second
HALFTIME_REAL_SECONDS = 12.0  # real pause between Q2 and Q3

# Per-team, not one shared pool for every offense — otherwise a KC-BUF
# game would randomly credit plays to SF/Dallas players, which is what
# an early smoke test of this module actually produced.
_ROSTERS: dict[str, dict[str, list[str]]] = {
    "KC": {"passer": ["Mahomes"], "rusher": ["Pacheco", "Hunt"], "receiver": ["Kelce", "Rice", "Worthy"], "kicker": ["Butker"]},
    "BUF": {"passer": ["Allen"], "rusher": ["Cook", "Davis"], "receiver": ["Diggs", "Shakir", "Kincaid"], "kicker": ["Bass"]},
    "SF": {"passer": ["Purdy"], "rusher": ["McCaffrey", "Mason"], "receiver": ["Aiyuk", "Samuel", "Kittle"], "kicker": ["Moody"]},
    "DAL": {"passer": ["Prescott"], "rusher": ["Elliott", "Pollard"], "receiver": ["Lamb", "Cooks", "Ferguson"], "kicker": ["Aubrey"]},
}


class _ScriptedPlay:
    __slots__ = ("reveal_at", "sim_seconds_elapsed", "period", "team_abbr", "play", "score_after")

    def __init__(self, reveal_at, sim_seconds_elapsed, period, team_abbr, play, score_after):
        self.reveal_at = reveal_at
        self.sim_seconds_elapsed = sim_seconds_elapsed
        self.period = period
        self.team_abbr = team_abbr
        self.play = play  # a Play (minus play_id/timestamp, filled in at generation)
        self.score_after = score_after  # (home_score, away_score) after this play


def _clock_label(sim_seconds_into_quarter: float) -> str:
    remaining = max(0, SIM_SECONDS_PER_QUARTER - int(sim_seconds_into_quarter))
    return f"{remaining // 60:02d}:{remaining % 60:02d}"


def _field_position_label(yards_to_goal: int, offense_abbr: str, defense_abbr: str) -> str:
    if yards_to_goal == 50:
        return "50"
    if yards_to_goal < 50:
        return f"{defense_abbr} {yards_to_goal}"
    return f"{offense_abbr} {100 - yards_to_goal}"


def _generate_play_log(rng: random.Random, home_abbr: str, away_abbr: str) -> list[_ScriptedPlay]:
    """One full game's worth of plays, alternating possession drive by
    drive. Not a statistically rigorous football simulator — just
    plausible enough (realistic yardage distributions, occasional
    turnovers/penalties, drives that actually end in TD/FG/PUNT) to
    exercise every part of the Gamecast UI honestly."""
    log: list[_ScriptedPlay] = []
    home_score = away_score = 0
    sim_elapsed = 0.0
    period = 1
    offense, defense = away_abbr, home_abbr  # away team receives to start, common convention
    drive_index = 0

    def add(team_abbr, description, play_type, yards_gained, down, distance, yard_line, **flags):
        nonlocal sim_elapsed, period
        # Each play burns 18-40 sim seconds (snap-to-snap, including the
        # play clock) — advance the quarter, rolling into the next one
        # (and inserting the halftime gap after Q2) when it runs out.
        sim_elapsed += rng.uniform(18, 40)
        if sim_elapsed >= SIM_SECONDS_PER_QUARTER:
            sim_elapsed = 0.0
            period += 1
        reveal_at = (period - 1) * SIM_SECONDS_PER_QUARTER / _TIME_SCALE + sim_elapsed / _TIME_SCALE
        if period > 2:
            reveal_at += HALFTIME_REAL_SECONDS
        play = Play(
            play_id="",
            period=min(period, 4),
            clock=_clock_label(sim_elapsed),
            team_abbr=team_abbr,
            down=down,
            distance=distance,
            yard_line=yard_line,
            description=description,
            play_type=play_type,
            yards_gained=yards_gained,
            timestamp=datetime.now(timezone.utc),
            **flags,
        )
        log.append(_ScriptedPlay(reveal_at, sim_elapsed, min(period, 4), team_abbr, play, (home_score, away_score)))

    while period <= 4 and len(log) < 130:
        drive_index += 1
        yards_to_goal = rng.choice([75, 80, 65, 70, 90])  # typical drive-start field position
        down, distance = 1, 10
        drive_plays = 0
        while period <= 4:
            drive_plays += 1
            roster = _ROSTERS[offense]
            is_pass = rng.random() < 0.58
            if is_pass:
                completed = rng.random() < 0.65
                gain = 0 if not completed else rng.choice([-3, 2, 4, 6, 8, 9, 11, 14, 18, 22, 35])
                passer = rng.choice(roster["passer"])
                receiver = rng.choice(roster["receiver"])
                desc = (
                    f"{passer} pass complete to {receiver} for {gain} yards"
                    if completed
                    else f"{passer} pass incomplete, intended for {receiver}"
                )
                players = [
                    PlayerRef(name=passer, team_abbr=offense, role="passer"),
                    PlayerRef(name=receiver, team_abbr=offense, role="receiver"),
                ]
                play_type = "pass"
            else:
                gain = rng.choice([-2, 0, 1, 2, 3, 4, 5, 6, 8, 12, 20])
                rusher = rng.choice(roster["rusher"])
                desc = f"{rusher} rushes for {gain} yards" if gain >= 0 else f"{rusher} rushes for a loss of {-gain} yards"
                players = [PlayerRef(name=rusher, team_abbr=offense, role="rusher")]
                play_type = "rush"

            turnover = rng.random() < 0.03
            new_yards_to_goal = max(0, yards_to_goal - gain)
            is_td = not turnover and new_yards_to_goal <= 0
            new_down = down + 1
            new_distance = distance - gain
            is_first_down = not turnover and not is_td and new_distance <= 0

            if turnover:
                pick = rng.random() < 0.5
                desc = f"{desc} — INTERCEPTED" if (pick and is_pass) else f"{desc} — FUMBLE, recovered by {defense}"
                add(
                    offense,
                    desc,
                    play_type,
                    gain,
                    down,
                    distance,
                    yards_to_goal,
                    is_turnover=True,
                    event_type=GameEventType.INTERCEPTION if pick and is_pass else GameEventType.FUMBLE,
                    players_involved=players,
                )
                offense, defense = defense, offense
                break

            if is_td:
                desc = f"{desc.split(' for ')[0]} for {yards_to_goal} yards, TOUCHDOWN"
                if offense == home_abbr:
                    home_score += 7
                else:
                    away_score += 7
                add(
                    offense,
                    desc,
                    play_type,
                    gain,
                    down,
                    distance,
                    yards_to_goal,
                    is_scoring_play=True,
                    is_first_down=True,
                    event_type=GameEventType.TOUCHDOWN,
                    players_involved=players,
                )
                offense, defense = defense, offense
                break

            add(
                offense,
                desc,
                play_type,
                gain,
                down,
                distance,
                yards_to_goal,
                is_first_down=is_first_down,
                event_type=GameEventType.FIRST_DOWN if is_first_down else GameEventType.PLAY_COMPLETED,
                players_involved=players,
            )
            yards_to_goal = new_yards_to_goal

            if is_first_down:
                down, distance = 1, 10
                continue

            if new_down > 4:
                # 4th down failed to convert — field goal if in range, else punt.
                if yards_to_goal <= 35:
                    kicker = rng.choice(roster["kicker"])
                    made = rng.random() < 0.85
                    if made:
                        if offense == home_abbr:
                            home_score += 3
                        else:
                            away_score += 3
                        add(
                            offense,
                            f"{kicker} {yards_to_goal + 17} yard field goal is GOOD",
                            "field_goal",
                            None,
                            4,
                            distance,
                            yards_to_goal,
                            is_scoring_play=True,
                            event_type=GameEventType.FIELD_GOAL,
                            players_involved=[PlayerRef(name=kicker, team_abbr=offense, role="kicker")],
                        )
                    else:
                        add(
                            offense,
                            f"{kicker} {yards_to_goal + 17} yard field goal attempt is NO GOOD",
                            "field_goal",
                            None,
                            4,
                            distance,
                            yards_to_goal,
                            event_type=GameEventType.FIELD_GOAL,
                            players_involved=[PlayerRef(name=kicker, team_abbr=offense, role="kicker")],
                        )
                else:
                    add(
                        offense,
                        f"Punt, fair caught by {defense}",
                        "punt",
                        None,
                        4,
                        distance,
                        yards_to_goal,
                        event_type=GameEventType.PUNT,
                        players_involved=[],
                    )
                offense, defense = defense, offense
                break

            down, distance = new_down, max(1, new_distance)

            if drive_plays > 14:  # safety valve against a pathological drive
                offense, defense = defense, offense
                break

    return log


def _reduce_state(
    game_id: str,
    provider_name: str,
    season: int,
    week: int,
    scheduled_start: datetime,
    home_abbr: str,
    away_abbr: str,
    home_name: str,
    away_name: str,
    log: list[_ScriptedPlay],
    elapsed_seconds: float,
) -> LiveGame:
    """Filters the play log to everything already revealed as of
    `elapsed_seconds`, then replays it into current score/drive/down-
    distance/possession state — the same "fold a log into a snapshot"
    shape a real provider's incremental feed would need too."""
    now = datetime.now(timezone.utc)
    revealed = [p for p in log if p.reveal_at <= elapsed_seconds]

    if elapsed_seconds < 0:
        status = GameStatus.SCHEDULED
    elif not revealed:
        status = GameStatus.SCHEDULED
    elif len(revealed) >= len(log):
        status = GameStatus.FINAL
    elif revealed[-1].period == 2 and elapsed_seconds < (revealed[-1].reveal_at + HALFTIME_REAL_SECONDS):
        status = GameStatus.HALFTIME
    else:
        status = GameStatus.IN_PROGRESS

    home_score = away_score = 0
    drives: list[Drive] = []
    plays_out: list[Play] = []
    scoring_plays: list[ScoringPlay] = []
    current_drive: Drive | None = None
    last_offense = None

    for i, sp in enumerate(revealed):
        p = sp.play.model_copy(update={"play_id": f"{game_id}-p{i}", "timestamp": now})
        if sp.team_abbr != last_offense:
            drive_result = None
            if current_drive is not None:
                current_drive.result = (
                    "TD" if current_drive.plays[-1].is_scoring_play and current_drive.plays[-1].play_type != "field_goal"
                    else "FG" if current_drive.plays[-1].play_type == "field_goal" and current_drive.plays[-1].is_scoring_play
                    else "TURNOVER" if current_drive.plays[-1].is_turnover
                    else "PUNT" if current_drive.plays[-1].play_type == "punt"
                    else drive_result
                )
                drives.append(current_drive)
            current_drive = Drive(
                drive_id=f"{game_id}-d{len(drives) + 1}",
                team_abbr=sp.team_abbr,
                start_yard_line=p.yard_line,
            )
            last_offense = sp.team_abbr
        current_drive.plays.append(p)
        current_drive.play_count = len(current_drive.plays)
        current_drive.yards = sum(pl.yards_gained or 0 for pl in current_drive.plays)
        plays_out.append(p)

        if p.is_scoring_play:
            scoring_plays.append(
                ScoringPlay(
                    play_id=p.play_id,
                    period=p.period,
                    clock=p.clock,
                    team_abbr=sp.team_abbr,
                    score_type="FG" if p.play_type == "field_goal" else "TD",
                    description=p.description,
                    home_score_after=sp.score_after[0],
                    away_score_after=sp.score_after[1],
                )
            )
        home_score, away_score = sp.score_after

    latest = revealed[-1] if revealed else None
    possession_abbr = latest.team_abbr if latest and status == GameStatus.IN_PROGRESS else None
    last_play = plays_out[-1] if plays_out else None

    # Down/distance/field position reflect the START of the next play to
    # come (i.e. the play just AFTER the last revealed one), same as a
    # real broadcast's "up next" state — fall back to the last play's own
    # numbers if the drive/game just ended.
    yards_to_goal = None
    down = distance = None
    if last_play and status == GameStatus.IN_PROGRESS:
        gained = last_play.yards_gained or 0
        yards_to_goal = max(0, (last_play.yard_line or 0) - gained)
        next_down = (last_play.down or 1) + 1
        if last_play.is_first_down or last_play.is_scoring_play:
            down, distance = 1, 10
        elif last_play.is_turnover or last_play.play_type in ("punt", "field_goal") or next_down > 4:
            # next_down > 4 covers the brief transition window between a
            # failed 4th-down snap (its own play, down=4, not a first
            # down) and the punt/field-goal play the drive generator
            # emits right after it — during that gap, "down 5" would
            # otherwise leak into the projection; there's no real
            # down/distance until the follow-up play (or the next drive)
            # actually reveals.
            down, distance = None, None
            possession_abbr = None if last_play.play_type != "field_goal" else possession_abbr
        else:
            down = next_down
            distance = max(1, (last_play.distance or 10) - gained)

    field_label = None
    if yards_to_goal is not None and possession_abbr:
        defense = away_abbr if possession_abbr == home_abbr else home_abbr
        field_label = _field_position_label(yards_to_goal, possession_abbr, defense)

    # current_drive (if any) is always the most recent one, never yet
    # appended to `drives` — that only happens above when possession
    # next changes, which hasn't happened yet for this last drive. Add
    # it to the historical list once the game itself isn't actively
    # mid-drive anymore (halftime/final); while in progress it stays
    # exclusively in current_drive, not duplicated into `drives` too.
    if current_drive is not None and status != GameStatus.IN_PROGRESS:
        drives.append(current_drive)

    period = latest.period if latest else None
    clock = last_play.clock if last_play and status == GameStatus.IN_PROGRESS else None
    period_label = {1: "1st", 2: "2nd", 3: "3rd", 4: "4th"}.get(period) if period else None
    if status == GameStatus.FINAL:
        clock = "Final"
        period_label = "Final"
    elif status == GameStatus.HALFTIME:
        clock = "Halftime"
        period_label = "Halftime"

    return LiveGame(
        game_id=game_id,
        provider=provider_name,
        status=status,
        season=season,
        week=week,
        scheduled_start=scheduled_start,
        home_team=TeamRef(abbr=home_abbr, name=home_name, score=home_score),
        away_team=TeamRef(abbr=away_abbr, name=away_name, score=away_score),
        period=period,
        period_label=period_label,
        clock=clock,
        possession_team_abbr=possession_abbr,
        down=down,
        distance=distance,
        yards_to_goal=yards_to_goal,
        field_position_label=field_label,
        is_redzone=bool(yards_to_goal is not None and yards_to_goal <= 20),
        current_drive=current_drive if status == GameStatus.IN_PROGRESS else None,
        drives=list(reversed(drives)),
        plays=list(reversed(plays_out))[:50],
        scoring_plays=list(reversed(scoring_plays)),
        last_updated=now,
    )


_MOCK_GAMES = [
    ("mock-kc-buf", "KC", "Kansas City Chiefs", "BUF", "Buffalo Bills", 7),
    ("mock-sf-dal", "SF", "San Francisco 49ers", "DAL", "Dallas Cowboys", 11),
]


class MockNFLDataProvider(NFLDataProvider):
    def __init__(self, season: int = 2026, week: int = 1, now_fn=None):
        # now_fn is an injectable clock (() -> datetime), defaulting to the
        # real wall clock. Production never passes it — games play out over
        # real time as documented above. Tests pass a fake that jumps
        # forward instantly, so "wait until several plays have revealed"
        # doesn't require actually sleeping for it; see
        # tests/test_gamecast_mock_provider.py's _FakeClock.
        self._now_fn = now_fn or (lambda: datetime.now(timezone.utc))
        self._season = season
        self._week = week
        self._started_at = self._now_fn()
        self._games: dict[str, dict] = {}
        for game_id, home_abbr, home_name, away_abbr, away_name, seed in _MOCK_GAMES:
            rng = random.Random(seed)
            self._games[game_id] = {
                "home_abbr": home_abbr,
                "home_name": home_name,
                "away_abbr": away_abbr,
                "away_name": away_name,
                "log": _generate_play_log(rng, home_abbr, away_abbr),
            }

    def _elapsed_seconds(self) -> float:
        return (self._now_fn() - self._started_at).total_seconds()

    def _state_for(self, game_id: str) -> LiveGame:
        g = self._games[game_id]
        return _reduce_state(
            game_id,
            "mock",
            self._season,
            self._week,
            self._started_at - timedelta(seconds=5),
            g["home_abbr"],
            g["away_abbr"],
            g["home_name"],
            g["away_name"],
            g["log"],
            self._elapsed_seconds(),
        )

    async def list_live_games(self) -> list[LiveGameSummary]:
        return [self._state_for(gid).to_summary() for gid in self._games]

    async def get_game_state(self, game_id: str) -> LiveGame:
        if game_id not in self._games:
            raise KeyError(f"Unknown mock game_id: {game_id!r}")
        return self._state_for(game_id)
