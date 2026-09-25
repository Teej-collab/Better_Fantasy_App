"""
The one canonical list of analytics event names this app tracks — see
ANALYTICS_EVENTS.md at the repo root for the human-readable version of
this same taxonomy. Both the frontend's trackEvent() call sites
(frontend/src/lib/analyticsEvents.ts) and this backend's validation
(app/routers/admin.py's POST /admin/track) are meant to stay in sync
with this file; a client sending an event_name not listed here gets
rejected outright rather than silently accepted into the table (see
this module's own validate_event for why: an unvalidated event name/
metadata shape is exactly how analytics tables end up full of noise,
or worse, an accidental leak of something that shouldn't have been
sent).

Two event types for Phase 1, deliberately not three: `page_view` (one
per real route, auto-classified from the URL — see classify_route
below, kept in lockstep with frontend/src/lib/navDestinations.ts's own
DESTINATIONS/DESTINATION_HREF map) and `feature` (a small, deliberately
curated set of meaningful product interactions — NOT a raw click
logger; see FEATURE_EVENTS' own comment for why). Click-level tracking
(every button, every card) is real, separate future work once there's
a specific product question it would answer — instrumenting it
blindly produces a wall of noise nobody reads, the opposite of what
this dashboard is for.
"""

EVENT_TYPES = {"page_view", "feature"}

# One event name per real route/destination, matching frontend/src/lib/
# navDestinations.ts and the actual app/(app)/* route tree — kept as a
# flat prefix-match list (order matters: longer/more specific prefixes
# first) rather than a dict, since several destinations are dynamic
# routes ("/matchups/123") that only a startswith check can classify.
# NAV_EVENT_NAMES below is derived from this list, not hand-duplicated.
_ROUTE_PREFIXES: list[tuple[str, str]] = [
    ("/seasons", "nav_seasons"),  # /seasons/{s}/awards, /awards/all-time, /weeks/{w}
    ("/standings", "nav_standings"),
    ("/matchups", "nav_matchups"),
    ("/gamecast", "nav_gamecast"),
    ("/history", "nav_history"),
    ("/rivalries", "nav_rivalries"),
    ("/rules", "nav_rules"),
    ("/power-rankings", "nav_power_rankings"),
    ("/draft", "nav_draft"),
    ("/keepers", "nav_keepers"),
    ("/free-agents", "nav_free_agents"),
    ("/trades", "nav_trades"),
    ("/teams", "nav_teams"),
    ("/team", "nav_team"),
    ("/players", "nav_players"),
    ("/leagues", "nav_leagues"),
    ("/league", "nav_league"),
    ("/chat", "nav_chat"),
    ("/chug", "nav_chug"),
    ("/owners", "nav_owners"),
    ("/settings", "nav_settings"),
    ("/commissioner", "nav_commissioner"),
    ("/admin", "nav_admin"),
    ("/weekend", "nav_weekend"),
    ("/login", "nav_login"),
]

# The one non-prefix special case — "/" itself would otherwise match
# nothing above (and must NOT be treated as a prefix of everything, or
# every route would classify as home).
_HOME_ROUTE = "nav_home"

# Anything that doesn't match a known prefix — a real route this
# taxonomy hasn't been taught about yet, not silently dropped or
# mis-classified. Shows up as its own row in the navigation heat map
# rather than corrupting another route's count, which is the signal
# that this list needs a new entry.
FALLBACK_EVENT_NAME = "nav_other"

NAV_EVENT_NAMES = {name for _, name in _ROUTE_PREFIXES} | {_HOME_ROUTE, FALLBACK_EVENT_NAME}


def classify_route(path: str) -> str:
    """Pure function, mirrors frontend/src/lib/analyticsEvents.ts's
    classifyRoute exactly — the frontend calls this to pick
    event_name before ever sending an event; the backend's own copy
    here is authoritative for validation (POST /admin/track) and for
    reclassifying legacy page_view_events rows during the
    2026-09-04 backfill migration, not something a client-sent
    event_name is trusted to already equal."""
    if path == "/" or path == "":
        return _HOME_ROUTE
    for prefix, name in _ROUTE_PREFIXES:
        if path == prefix or path.startswith(prefix + "/"):
            return name
    return FALLBACK_EVENT_NAME


# A small, deliberately curated set of real product interactions worth
# tracking as their own event — NOT a general click logger (see this
# module's own docstring). Each maps to the metadata keys a valid
# event of that name may carry; POST /admin/track rejects any key not
# in this set for that event_name, and rejects the event entirely if
# event_name isn't in NAV_EVENT_NAMES or here. Grow this list only when
# a real product question needs it, not preemptively.
FEATURE_EVENTS: dict[str, set[str]] = {
    "league_switched": {"to_league_id"},
    "gamecast_game_selected": {"game_id"},
}

# Screen-view names for a genuinely native (non-WebView) screen that
# has no URL route to auto-classify from the way NAV_EVENT_NAMES above
# does — see app/routers/admin.py's track_event for the rule that
# actually requires these (route is null AND platform is ios/android).
# Today's "native" iOS/Android apps are Capacitor WebView shells around
# this same site (frontend/capacitor.config.ts) and so always have a
# real route — this taxonomy exists ahead of any screen that needs it,
# derived from the real frontend/src/app/(app)/* route tree so it's
# ready the moment a truly native screen is built, not a placeholder
# guess. Collapses each dynamic route segment ([matchupId], [gameId],
# etc.) into one canonical name, never one per instance.
SCREEN_NAMES = {
    "home", "marketing_welcome", "marketing_commissioners",
    "login", "forgot_password", "reset_password",
    "leagues_list", "league_home",
    "standings", "power_rankings", "history", "rivalries", "rules",
    "seasons_hub", "season_detail", "season_awards", "season_draft_recap",
    "draft_room",
    "matchup_list", "matchup_detail",
    "gamecast_hub", "gamecast_game",
    "team_mine", "team_other", "players", "free_agents", "trades", "keepers",
    "chat", "chug", "activity", "owners_list", "owner_detail",
    "commissioner_home", "commissioner_league", "commissioner_members", "commissioner_polls",
    "commissioner_roster", "commissioner_scoring", "commissioner_teams", "commissioner_trades",
    "settings", "more",
    "admin_overview", "admin_navigation", "admin_leagues", "admin_league_detail",
    "admin_users", "admin_user_detail",
    "weekend",
}

ALL_EVENT_NAMES = NAV_EVENT_NAMES | set(FEATURE_EVENTS.keys()) | SCREEN_NAMES

ALLOWED_DEVICE_TYPES = {"mobile", "tablet", "desktop"}
ALLOWED_PLATFORMS = {"ios", "android", "web"}
NATIVE_PLATFORMS = {"ios", "android"}

MAX_ROUTE_LENGTH = 200
MAX_METADATA_VALUE_LENGTH = 200


def validate_event(
    event_name: str, event_type: str, metadata: dict, device_type: str | None, platform: str | None
) -> str | None:
    """Returns an error message if this event should be rejected, None
    if it's valid — the one gate POST /admin/track runs every incoming
    event through before it ever reaches the database. Deliberately
    strict: a client is never trusted to send an event_name/metadata
    shape this taxonomy doesn't already know about (see this module's
    own docstring on why an unvalidated event table is a real risk,
    not just noise)."""
    if event_type not in EVENT_TYPES:
        return f"event_type must be one of {sorted(EVENT_TYPES)}"
    # NAV_EVENT_NAMES (route-classified, the web/Capacitor-WebView case)
    # or SCREEN_NAMES (a genuinely native screen with no route — see
    # this module's own SCREEN_NAMES docstring) are both valid
    # page_view names here; app/routers/admin.py's track_event is what
    # enforces WHICH of the two applies to a given request (based on
    # whether route/platform were sent), not this function — this stays
    # a plain "is this name known at all" check, unchanged in shape,
    # so every existing caller/test keeps working exactly as before.
    if event_type == "page_view" and event_name not in NAV_EVENT_NAMES and event_name not in SCREEN_NAMES:
        return "unknown page_view event_name"
    if event_type == "feature":
        if event_name not in FEATURE_EVENTS:
            return "unknown feature event_name"
        allowed_keys = FEATURE_EVENTS[event_name]
        if not isinstance(metadata, dict) or set(metadata.keys()) - allowed_keys:
            return f"metadata for {event_name} may only contain keys {sorted(allowed_keys)}"
        for value in metadata.values():
            if isinstance(value, str) and len(value) > MAX_METADATA_VALUE_LENGTH:
                return "metadata value too long"
    if device_type is not None and device_type not in ALLOWED_DEVICE_TYPES:
        return f"device_type must be one of {sorted(ALLOWED_DEVICE_TYPES)} or null"
    if platform is not None and platform not in ALLOWED_PLATFORMS:
        return f"platform must be one of {sorted(ALLOWED_PLATFORMS)} or null"
    return None
