"""
NFL game-window detection for live sync (see app/scheduler.py). Gates
frequent ESPN polling to roughly when games are actually being played,
so an unofficial API isn't hit around the clock for no reason — a
product decision made explicitly with the project owner (Aug 19 2026),
not assumed.

Windows are deliberately generous (buffer before/after typical kickoff
times) rather than pinned to exact per-week broadcast schedules, which
vary and aren't worth tracking here. Doesn't cover the rare
Saturday-only late-season slate — a real, known gap, not an oversight;
see TODO.md.
"""
from datetime import datetime
from zoneinfo import ZoneInfo

_ET = ZoneInfo("America/New_York")

# datetime.weekday(): Monday=0 ... Sunday=6
_WINDOWS = {
    3: (19, 24),  # Thursday evening through midnight (TNF)
    6: (12, 24),  # Sunday early afternoon through midnight (early/late/SNF)
    0: (19, 24),  # Monday evening through midnight (MNF)
}


def is_within_nfl_game_window(now: datetime | None = None) -> bool:
    now_et = (now or datetime.now(_ET)).astimezone(_ET)
    window = _WINDOWS.get(now_et.weekday())
    if window is None:
        return False
    start_hour, end_hour = window
    return start_hour <= now_et.hour < end_hour
