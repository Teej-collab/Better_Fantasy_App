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


def deadline_from_week_games(games: list[dict]) -> datetime | None:
    """The Monday-dated kickoff found directly inside a SPECIFIC week's
    own game list — no guessing from `now`'s weekday at all. get_mnf_
    deadline's `_relevant_monday` is deliberately calendar-anchored
    (needed by chug_standing.ensure_chug_deadline_settled, which asks
    "has THIS week's deadline passed as of right now") — but that same
    calendar guess breaks the /chug/deadline endpoint's forward-looking
    countdown: on a Tue/Wed after a week is already settled, it always
    resolves to the Monday that JUST passed, never the upcoming one a
    week away (real report, 2026-09-15: countdown showed "chug time"
    the morning after MNF, even though the next real deadline was six
    days out). Once the caller already knows which week to show (the
    league's cached current_week, already advanced past settlement),
    it can hand that week's own scoreboard here and get the right
    Monday back regardless of what day it is today. Returns None if
    this week's games don't include a Monday kickoff at all (rare
    holiday-shaped schedule) so the caller can fall back."""
    mondays: list[datetime] = []
    for g in games:
        raw_date = g.get("date")
        if not raw_date:
            continue
        try:
            kickoff = datetime.fromisoformat(raw_date.replace("Z", "+00:00")).astimezone(_ET)
        except ValueError:
            continue
        if kickoff.weekday() == 0:
            mondays.append(kickoff)
    return max(mondays) if mondays else None


def week_deadline(games: list[dict]) -> datetime | None:
    """When a specific week's chugs are due, from that week's own games:
    its Monday night kickoff, else 8:15 PM ET on the Monday after its
    first game. What settlement checks (chug_standing.
    ensure_chug_deadline_settled) — never today's date, which can't tell
    which week it's asked about (2026-11-08, real incident: from the
    Tuesday flip on, is_past_mnf_deadline answered for the Monday that
    had just passed, so the daily sync settled the new week's deadline,
    doubling everyone who owed six days early)."""
    monday = deadline_from_week_games(games)
    if monday is not None:
        return monday
    kickoffs: list[datetime] = []
    for g in games:
        try:
            kickoffs.append(datetime.fromisoformat((g.get("date") or "").replace("Z", "+00:00")).astimezone(_ET))
        except ValueError:
            continue
    if not kickoffs:
        return None
    return datetime.combine(_relevant_monday(min(kickoffs).date()), _FALLBACK_KICKOFF_ET, tzinfo=_ET)
