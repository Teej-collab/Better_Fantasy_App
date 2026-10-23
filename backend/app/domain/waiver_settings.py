"""
A league's own waiver rules (2026-10-23, Commissioner → Waivers).

Until now every league ran on the same built-in rules (app/domain/
waivers.py): worst record gets first claim, reset every week, with a
winner dropping to the back for the rest of that week; FAAB bids only
in a guillotine league; claims clearing Wednesday 3:00 AM ET; dropped
players on waivers for 1 day; and a player held for that clear once
his game kicks off. Those stay the defaults: a league with no row in
league_waiver_settings behaves exactly as before.

waiver_type:
- "reverse": worst record first, the order reset every week (the
  default outside guillotine).
- "rolling": the order carries over week to week; whoever wins a claim
  goes to the back for good, not just for that week.
- "faab": blind bids from a season budget; the waiver order breaks a
  tie (the guillotine default).

Reads never fail on a database that's missing the table (a deploy that
ran before its migration): they fall back to the defaults.
"""
import json
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

import asyncpg

ET = ZoneInfo("America/New_York")
WAIVER_TYPES = ("reverse", "rolling", "faab")
DEFAULT_FAAB_BUDGET = 100

DEFAULTS = {
    "waiver_type": "reverse",
    "faab_budget": DEFAULT_FAAB_BUDGET,
    "min_bid": 0,
    "clear_weekday": 2,  # Mon=0 ... Wed=2
    "clear_hour": 3,  # 3:00 AM ET
    "drop_days": 1,
    "hold_played": True,
    "post_results": False,
}

_FIELDS = tuple(DEFAULTS)


def defaults_for(league_type: str | None, type_settings: dict | None = None) -> dict:
    out = dict(DEFAULTS)
    if league_type == "guillotine":
        out["waiver_type"] = "faab"
        budget = (type_settings or {}).get("faab_budget")
        if budget:
            out["faab_budget"] = int(budget)
    return out


async def get_waiver_settings(conn, league_id: int) -> dict:
    """The league's rules, with "custom": whether its commissioner has
    saved any (False means it's on the defaults)."""
    league = await conn.fetchrow("SELECT league_type, type_settings FROM leagues WHERE id = $1", league_id)
    type_settings = league["type_settings"] if league else None
    if isinstance(type_settings, str):
        type_settings = json.loads(type_settings)
    settings = defaults_for(league["league_type"] if league else None, type_settings)
    try:
        async with conn.transaction():  # a savepoint: a missing table can't abort the caller's transaction
            row = await conn.fetchrow(f"SELECT {', '.join(_FIELDS)} FROM league_waiver_settings WHERE league_id = $1", league_id)
    except asyncpg.UndefinedTableError:
        row = None
    if row is not None:
        settings.update({k: row[k] for k in _FIELDS})
    settings["custom"] = row is not None
    return settings


async def custom_league_settings(conn) -> dict[int, dict]:
    """{league_id: settings} for every league that has saved its own
    rules — for the season-wide waiver jobs, which otherwise apply the
    defaults to every league in one statement."""
    try:
        async with conn.transaction():
            rows = await conn.fetch(f"SELECT league_id, {', '.join(_FIELDS)} FROM league_waiver_settings")
    except asyncpg.UndefinedTableError:
        return {}
    return {r["league_id"]: {k: r[k] for k in _FIELDS} for r in rows}


async def save_waiver_settings(conn, league_id: int, settings: dict) -> None:
    values = [settings[k] for k in _FIELDS]
    await conn.execute(
        f"""
        INSERT INTO league_waiver_settings (league_id, {', '.join(_FIELDS)})
        VALUES ($1, {', '.join(f'${i + 2}' for i in range(len(_FIELDS)))})
        ON CONFLICT (league_id) DO UPDATE SET
            {', '.join(f'{k} = EXCLUDED.{k}' for k in _FIELDS)}, updated_at = now()
        """,
        league_id, *values,
    )


def next_clear(now: datetime, settings: dict | None = None) -> datetime:
    """The next waiver run strictly after `now`: the league's clear day
    and hour, ET. A full week out if `now` is already at or past this
    week's."""
    s = settings or DEFAULTS
    now_et = now.astimezone(ET)
    days_until = (s["clear_weekday"] - now_et.weekday()) % 7
    candidate = datetime.combine(now_et.date(), time(s["clear_hour"], 0), tzinfo=ET) + timedelta(days=days_until)
    if candidate <= now_et:
        candidate += timedelta(days=7)
    return candidate.astimezone(timezone.utc)


def is_default_schedule(settings: dict) -> bool:
    return settings["clear_weekday"] == DEFAULTS["clear_weekday"] and settings["clear_hour"] == DEFAULTS["clear_hour"]
