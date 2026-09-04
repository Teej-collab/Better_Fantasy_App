"""Notification, chat, and appearance preferences — one row per owner
in owner_preferences (migration 3da680665fb2), created lazily on first
write. Every column has a real default (see the migration), so a
missing row and a row full of defaults are equivalent to every reader
— get_preferences returns the defaults in Python rather than requiring
a row to exist first.

Same "no owner_id from the caller, only from the session" discipline
as app/queries/settings.py — enforced by app/routers/settings.py, not
here, but every function still takes owner_id as an explicit argument
rather than reading it from anywhere ambient.
"""
import datetime

_DEFAULT_PREFERENCES = {
    "notify_direct_messages": True,
    "notify_league_chat": True,
    "notify_mentions": True,
    "notify_replies": True,
    "sunday_mode": None,
    "quiet_hours_enabled": False,
    "quiet_hours_start": datetime.time(22, 0),
    "quiet_hours_end": datetime.time(8, 0),
    "read_receipts_enabled": True,
    "typing_indicators_enabled": True,
    "message_previews_enabled": True,
    "mention_highlighting_enabled": True,
    "neon_intensity": "standard",
    "reduced_motion": False,
    "accent_color": None,
    # Two independent personal colors on top of accent_color (2026-09):
    # your_week_color tints only the Home page's "Your Week" hero card;
    # border_glow_color is the moving neon ring on every card/countdown
    # tile. Both fall back to accent_color (then the app default) when
    # unset — see globals.css's --your-week-color/--ring-color chains.
    "your_week_color": None,
    "border_glow_color": None,
    # Settings > Appearance > Look. "calm" is today's shipped near-black,
    # flat-panel palette; "cosmic" restores the earlier starfield/nebula
    # background and a brighter mint-green accent as an opt-in choice —
    # not a light/dark mode switch, the app stays dark either way (see
    # globals.css's own "always dark by design" note). Drives
    # data-wl-theme on <html> (app/layout.tsx), the same before-first-
    # paint cookie mechanism neon_intensity already uses.
    "theme": "calm",
    "home_card_order": None,
    # None on all three below means "use the app's hardcoded default" —
    # same convention as home_card_order. home_hidden_cards is
    # deliberately its own list rather than "omit from home_card_order",
    # since the merge logic (frontend's mergeCardOrder) needs to tell
    # "owner explicitly hid this" apart from "this card type didn't
    # exist yet when they last saved an order" — the latter must still
    # auto-appear, the former must not.
    "bottom_nav_order": None,
    "home_hidden_cards": None,
    "home_desktop_layout": None,
    # Push notifications (migration 6a96fdae6d6c). push_enabled is
    # managed by app/routers/push.py's subscribe/unsubscribe flow, not
    # set directly through PATCH /settings/preferences (see settings.py)
    # — it should always reflect "does this owner have at least one
    # active device subscribed," not a value that could drift from
    # reality if set independently.
    "push_enabled": False,
    "notify_game_alerts": True,
    "notify_my_players": False,
    "notify_fantasy_team": True,
    "notify_league": True,
    # Consent for a not-yet-built feature (AI learning to shit-talk from
    # real chat messages, migration 6ed29b9f0609) — opt-OUT model, so
    # the default is False (opted in). ai_training_notice_seen tracks
    # whether the one-time warning shown before an owner's first-ever
    # chat send (MessageComposer.tsx) has actually been shown yet —
    # kept separate from the choice itself so "saw it, chose to stay
    # opted in" and "never saw it" don't collapse into the same value.
    "ai_training_opt_out": False,
    "ai_training_notice_seen": False,
}

# Every real column except owner_id itself — used to build a full
# upsert (see _upsert below) rather than a dynamic partial UPDATE,
# since this table is small and fixed-shape: simpler and safer than
# constructing a SET clause from whatever subset of keys a caller
# happens to pass.
_COLUMNS = list(_DEFAULT_PREFERENCES.keys())

# Hand-editing any of these directly means whatever Sunday Mode preset
# was active no longer describes the owner's real settings.
_SUNDAY_MODE_COLUMNS = {"notify_direct_messages", "notify_league_chat", "notify_mentions", "notify_replies"}

SUNDAY_MODE_PRESETS = {
    # "Everything important" — every Messages toggle on.
    "full_send": {"notify_direct_messages": True, "notify_league_chat": True, "notify_mentions": True, "notify_replies": True},
    # "Important fantasy events only" (not yet built — see Fantasy Activity
    # in the notifications router) plus DMs/mentions from Messages.
    "game_day": {"notify_direct_messages": True, "notify_league_chat": False, "notify_mentions": True, "notify_replies": False},
    # "Only DMs and @mentions" — identical to game_day today since the two
    # only really diverge on Fantasy Activity events, which don't exist
    # yet; they'll separate naturally once that infrastructure ships.
    "leave_me_alone": {"notify_direct_messages": True, "notify_league_chat": False, "notify_mentions": True, "notify_replies": False},
}


async def get_preferences(conn, owner_id: int) -> dict:
    row = await conn.fetchrow("SELECT * FROM owner_preferences WHERE owner_id = $1", owner_id)
    if row is None:
        return dict(_DEFAULT_PREFERENCES)
    return {k: row[k] for k in _COLUMNS}


async def _upsert(conn, owner_id: int, merged: dict) -> dict:
    values = [merged[c] for c in _COLUMNS]
    placeholders = ", ".join(f"${i + 2}" for i in range(len(_COLUMNS)))
    set_clause = ", ".join(f"{c} = EXCLUDED.{c}" for c in _COLUMNS)
    row = await conn.fetchrow(
        f"""
        INSERT INTO owner_preferences (owner_id, {", ".join(_COLUMNS)})
        VALUES ($1, {placeholders})
        ON CONFLICT (owner_id) DO UPDATE SET {set_clause}
        RETURNING *
        """,
        owner_id, *values,
    )
    return {k: row[k] for k in _COLUMNS}


async def update_preferences(conn, owner_id: int, patch: dict) -> dict:
    """Applies only the given fields — anything not in `patch` keeps its
    current (or default) value. Clears sunday_mode to NULL if the patch
    touches any Messages toggle directly, so the UI can show
    "Customized" instead of a stale preset name."""
    current = await get_preferences(conn, owner_id)
    merged = {**current, **patch}
    if _SUNDAY_MODE_COLUMNS & patch.keys():
        merged["sunday_mode"] = None
    return await _upsert(conn, owner_id, merged)


async def apply_sunday_mode(conn, owner_id: int, preset: str) -> dict:
    if preset not in SUNDAY_MODE_PRESETS:
        raise ValueError(f"Unknown Sunday Mode preset: {preset!r}")
    current = await get_preferences(conn, owner_id)
    merged = {**current, **SUNDAY_MODE_PRESETS[preset], "sunday_mode": preset}
    return await _upsert(conn, owner_id, merged)
