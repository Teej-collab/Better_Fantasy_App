"""
When the league's fantasy week flips (2026-09-25, commissioner's call):
2:00 AM Central on the Tuesday after the week's last NFL game — not the
instant Monday Night Football goes final. Power rankings are decided at
this flip and stay put until the next one (see weekly_team_stats.py's
lock_power_ranks_for_week).

Anchored to the week's own real last kickoff (ESPN scoreboard `date`),
not a fixed calendar Tuesday, so a normal Thu -> Mon week flips the
following Tuesday 2 AM, and a game moved to Tuesday/Wednesday pushes
the flip to 2 AM the next morning. The flip also requires every game
to actually be final (app/scheduler.py's _run_week_settlement_job).
"""
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

_CT = ZoneInfo("America/Chicago")  # follows CST/CDT automatically
_FLIP_WEEKDAY = 1  # Tuesday (Mon=0)
_FLIP_TIME_CT = time(2, 0)


def _kickoff(game: dict) -> datetime | None:
    raw = game.get("date")
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None


def get_week_flip_at(week_games: list[dict]) -> datetime | None:
    """The first Tuesday 2:00 AM Central after this week's last kickoff
    (2 AM the next morning if that game itself was moved to a Tuesday or
    Wednesday), or None when the scoreboard has no usable kickoff
    times."""
    kickoffs = [k for k in (_kickoff(g) for g in week_games) if k is not None]
    if not kickoffs:
        return None
    last_ct = max(kickoffs).astimezone(_CT)
    if last_ct.weekday() in (1, 2):
        # A game rescheduled to Tuesday/Wednesday — flip at 2 AM the
        # next morning instead of waiting a whole extra week.
        return datetime.combine(last_ct.date() + timedelta(days=1), _FLIP_TIME_CT, tzinfo=_CT)
    days_until = (_FLIP_WEEKDAY - last_ct.weekday()) % 7
    candidate = datetime.combine(last_ct.date() + timedelta(days=days_until), _FLIP_TIME_CT, tzinfo=_CT)
    if candidate <= last_ct:
        candidate += timedelta(days=7)
    return candidate


def is_past_week_flip(week_games: list[dict], now: datetime | None = None) -> bool:
    """True once this week's flip time has passed. With no kickoff times
    to anchor to, falls back to "every game is final" — the old flip
    rule — rather than never flipping at all."""
    flip_at = get_week_flip_at(week_games)
    if flip_at is None:
        return True
    return (now or datetime.now(timezone.utc)) >= flip_at
