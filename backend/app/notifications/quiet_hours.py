"""
Quiet hours — Settings > Notifications' "Quiet Hours" toggle and its
start/end times, enforced for every push in app/notifications/
dispatcher.py's send_to_owner (the preference was saved but never
checked until 2026-09-27).

What happens to a push that lands inside an owner's quiet hours
depends on its type (the `data.type` every formatter sets):

- Sent anyway: test pushes (the owner just asked for one) and draft/
  keeper deadlines — missing "you're on the clock" means an auto-pick,
  so a draft the league scheduled at night still reaches everyone.
- Held until quiet hours end: injury status changes and player news.
  An overnight downgrade is still worth knowing when you wake up.
- Dropped: everything else. A touchdown, a lead change, or a chat
  message is stale by morning and already visible in the app.

Times are read in the owner's own timezone (owner_preferences.
timezone, set from their device), falling back to the league's home
zone.
"""
import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

DEFAULT_TIMEZONE = "America/Chicago"

_ALWAYS_SEND = {
    "test",
    "draft_starting_soon",
    "draft_room_open",
    "draft_live",
    "draft_on_the_clock",
    "keeper_deadline_approaching",
    # Admin app-health alerts (admin_alerts.py) — a crash or attack
    # doesn't wait for morning.
    "admin_crash",
    "admin_error",
    "admin_security",
}
# The recap and new feedback stay worth reading in the morning.
_HOLD_UNTIL_MORNING = {"injury_update", "player_news", "weekly_recap", "admin_feedback"}

SEND = "send"
DEFER = "defer"
DROP = "drop"


def is_valid_timezone(name: str) -> bool:
    try:
        ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return False
    return True


def _zone(prefs: dict) -> ZoneInfo:
    name = prefs.get("timezone")
    if name and is_valid_timezone(name):
        return ZoneInfo(name)
    return ZoneInfo(DEFAULT_TIMEZONE)


def quiet_until(prefs: dict, now: datetime.datetime) -> datetime.datetime | None:
    """When the owner's current quiet hours end (timezone-aware), or
    None if they aren't in quiet hours right now. A window whose start
    is later than its end (22:00-08:00) runs past midnight; equal start
    and end is an empty window."""
    if not prefs.get("quiet_hours_enabled"):
        return None
    start, end = prefs["quiet_hours_start"], prefs["quiet_hours_end"]
    if start == end:
        return None
    local = now.astimezone(_zone(prefs))
    t = local.time().replace(tzinfo=None)
    if start < end:
        inside = start <= t < end
    else:
        inside = t >= start or t < end
    if not inside:
        return None
    end_at = local.replace(hour=end.hour, minute=end.minute, second=0, microsecond=0)
    if end_at <= local:
        # Wall-clock arithmetic (same ZoneInfo on both sides), so a DST
        # change overnight still lands on the owner's real end time.
        end_at += datetime.timedelta(days=1)
    return end_at


def decide(prefs: dict, payload: dict, now: datetime.datetime) -> tuple[str, datetime.datetime | None]:
    """(SEND | DEFER | DROP, send_after) for this push right now."""
    type_ = (payload.get("data") or {}).get("type")
    if type_ in _ALWAYS_SEND:
        return SEND, None
    until = quiet_until(prefs, now)
    if until is None:
        return SEND, None
    if type_ in _HOLD_UNTIL_MORNING:
        return DEFER, until
    return DROP, None
