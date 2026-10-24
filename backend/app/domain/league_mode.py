"""
Mirror mode (2026-10-24): a league connected to ESPN or Sleeper and not
yet switched over. Its rosters follow the source (the scheduler's mirror
roster sync), its matchup scores come from the source, and every roster
move here — lineup, add, drop, waiver claim, trade, draft, keeper — is
refused with a plain "make moves there" message, so the two never drift.

The league leaves mirror mode when the commissioner switches it over
(app/domain/league_switch.py), which removes the connection: from then
on this app is the source of truth.
"""
from fastapi import HTTPException

PLATFORM_NAMES = {"espn": "ESPN", "sleeper": "Sleeper"}


async def mirror_platform(conn, league_id: int) -> str | None:
    """'espn' or 'sleeper' while the league mirrors one; None otherwise."""
    if await conn.fetchval("SELECT 1 FROM league_sleeper_connections WHERE league_id = $1", league_id):
        return "sleeper"
    if await conn.fetchval("SELECT 1 FROM league_espn_connections WHERE league_id = $1", league_id):
        return "espn"
    return None


def mirror_message(platform: str) -> str:
    name = PLATFORM_NAMES.get(platform, platform)
    return (
        f"Your league runs on {name} for now. Make roster moves there and they'll show up here within a few "
        f"minutes. Once everyone's here, your commissioner can move the league to The Weekend for good."
    )


async def mirror_block(conn, league_id: int) -> str | None:
    platform = await mirror_platform(conn, league_id)
    return mirror_message(platform) if platform else None


async def forbid_if_mirrored(conn, league_id: int) -> None:
    """For any route that changes a roster: 409 with the message."""
    message = await mirror_block(conn, league_id)
    if message:
        raise HTTPException(status_code=409, detail=message)
