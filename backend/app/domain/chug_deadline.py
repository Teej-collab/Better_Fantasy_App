"""
Real ESPN schedule-based Monday Night Football deadline detection for
Jeffrey's Rule (backend/../TODO.md's rulebook: "chugs must be completed
by Monday Night Football kickoff" — see app/domain/chug_standing.py for
what happens once the deadline passes). Same principle as
app/providers/nfl_scoreboard.py's is_nfl_game_live: checks ESPN's own
real game data instead of guessing from a fixed calendar rule.

Falls back to a fixed 8:15 PM ET (the NFL's standard real MNF kickoff
slot) only when the current scoreboard snapshot has no game landing on
this week's Monday at all — confirmed this really happens (checked a
real live fetch: 2026 preseason week 3 has no separate Monday game,
its latest game is Sunday night), so a fallback is a real necessity,
not defensive-for-its-own-sake.
"""
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

_ET = ZoneInfo("America/New_York")
_FALLBACK_KICKOFF_ET = time(20, 15)  # 8:15 PM ET


def _relevant_monday(d: date) -> date:
    """An NFL week runs Thu -> Mon, not the ISO calendar's Mon -> Sun —
    so "the Monday this deadline is about" depends on where `d` falls:
    Thu/Fri/Sat/Sun are still waiting on the UPCOMING Monday; Mon/Tue/Wed
    are already past (or on) that same week's Monday. Naively using
    d - d.weekday() (the ISO week's Monday) gets Thu-Sun backwards — it
    anchors to the Monday that ALREADY happened, days before that
    week's games even started."""
    weekday = d.weekday()  # Mon=0 ... Sun=6
    if weekday <= 2:  # Mon, Tue, Wed
        return d - timedelta(days=weekday)
    return d + timedelta(days=7 - weekday)  # Thu, Fri, Sat, Sun


def get_mnf_deadline(games: list[dict], now: datetime | None = None) -> datetime:
    """The datetime (ET) chugs are due by, for whichever NFL week `now`
    falls in — real ESPN kickoff time for that Monday's game if the
    scoreboard has one, else the fallback slot."""
    now_et = (now or datetime.now(_ET)).astimezone(_ET)
    monday_date = _relevant_monday(now_et.date())

    for g in games:
        raw_date = g.get("date")
        if not raw_date:
            continue
        try:
            kickoff = datetime.fromisoformat(raw_date.replace("Z", "+00:00")).astimezone(_ET)
        except ValueError:
            continue
        if kickoff.date() == monday_date:
            return kickoff

    return datetime.combine(monday_date, _FALLBACK_KICKOFF_ET, tzinfo=_ET)


def is_past_mnf_deadline(games: list[dict], now: datetime | None = None) -> bool:
    now_et = (now or datetime.now(_ET)).astimezone(_ET)
    return now_et > get_mnf_deadline(games, now_et)
