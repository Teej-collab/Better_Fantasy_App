"""
Future draft picks (2026-10-28): the next two seasons' picks in keeper
and dynasty leagues, one per round per team, tradeable like players
(app/domain/trades.py). A redraft league starts over every year, so it
has none.

The rows are made on first look, for every team in the league this
season. When a season's draft is created, each pick someone traded
away goes to its new owner in the same round and slot
(apply_to_draft).
"""
from app.domain.league_format import get_league_format

SEASONS_AHEAD = 2


async def rounds_for(conn, league_id: int, season: int) -> int | None:
    """How many rounds a future draft here has: a dynasty league's
    rookie draft, or a keeper league's full draft. None for anything
    else."""
    fmt = await get_league_format(conn, league_id)
    if fmt["league_type"] == "dynasty":
        return int(fmt["type_settings"].get("rookie_draft_rounds", 4))
    if fmt["league_type"] == "keeper":
        from app.domain.keeper_costs import last_round

        return await last_round(conn, season, league_id)
    return None


async def ensure(conn, league_id: int, season: int) -> bool:
    """Makes sure next seasons' picks exist for every team this season.
    False when the league doesn't trade future picks."""
    rounds = await rounds_for(conn, league_id, season)
    if not rounds:
        return False
    owners = [
        r["owner_id"]
        for r in await conn.fetch("SELECT owner_id FROM teams_by_season WHERE season = $1 AND league_id = $2", season, league_id)
    ]
    rows = [
        (league_id, season + ahead, rnd, owner, owner)
        for ahead in range(1, SEASONS_AHEAD + 1)
        for rnd in range(1, rounds + 1)
        for owner in owners
    ]
    if rows:
        await conn.executemany(
            "INSERT INTO future_picks (league_id, season, round, original_owner_id, owner_id) VALUES ($1, $2, $3, $4, $5) "
            "ON CONFLICT (league_id, season, round, original_owner_id) DO NOTHING",
            rows,
        )
    return True


async def _names(conn, league_id: int, season: int) -> dict[int, str]:
    rows = await conn.fetch(
        "SELECT o.owner_id, COALESCE(o.goes_by, o.display_name) AS name FROM owners o "
        "WHERE o.owner_id IN (SELECT owner_id FROM teams_by_season WHERE league_id = $1 AND season = $2)",
        league_id, season,
    )
    return {r["owner_id"]: r["name"] for r in rows}


def label(pick: dict) -> str:
    base = f"{pick['season']} round {pick['round']}"
    return base if pick["original_owner_id"] == pick["owner_id"] else f"{base} (from {pick['original_name']})"


async def owned_by(conn, league_id: int, season: int, owner_id: int) -> list[dict]:
    """Every future pick this owner holds, theirs and ones traded for."""
    if not await ensure(conn, league_id, season):
        return []
    names = await _names(conn, league_id, season)
    rows = await conn.fetch(
        "SELECT id, season, round, original_owner_id, owner_id FROM future_picks "
        "WHERE league_id = $1 AND owner_id = $2 AND season > $3 ORDER BY season, round, original_owner_id",
        league_id, owner_id, season,
    )
    out = []
    for r in rows:
        pick = dict(r) | {"original_name": names.get(r["original_owner_id"], "Someone")}
        pick["label"] = label(pick)
        out.append(pick)
    return out


async def traded_away(conn, league_id: int, season: int, owner_id: int) -> list[dict]:
    names = await _names(conn, league_id, season)
    rows = await conn.fetch(
        "SELECT season, round, owner_id FROM future_picks WHERE league_id = $1 AND original_owner_id = $2 "
        "AND owner_id <> $2 AND season > $3 ORDER BY season, round",
        league_id, owner_id, season,
    )
    return [{"season": r["season"], "round": r["round"], "to": names.get(r["owner_id"], "Someone")} for r in rows]


async def assert_owns(conn, league_id: int, owner_id: int, pick_ids: list[int]) -> None:
    from app.domain.trade_exceptions import AssetNotOwnedError

    if not pick_ids:
        return
    owned = {
        r["id"]
        for r in await conn.fetch(
            "SELECT id FROM future_picks WHERE league_id = $1 AND owner_id = $2 AND id = ANY($3::int[])",
            league_id, owner_id, pick_ids,
        )
    }
    if set(pick_ids) - owned:
        raise AssetNotOwnedError("One of those draft picks isn't theirs to trade any more")


async def apply_to_draft(conn, season: int, league_id: int) -> None:
    """A just-created draft's picks follow any trades: a pick that
    started as one team's goes to whoever owns it now, same round and
    slot."""
    await conn.execute(
        """
        UPDATE draft_picks dp SET owner_id = fp.owner_id
        FROM future_picks fp
        WHERE fp.league_id = dp.league_id AND fp.season = dp.season AND fp.round = dp.round
          AND fp.original_owner_id = dp.owner_id AND fp.owner_id <> fp.original_owner_id
          AND dp.season = $1 AND dp.league_id = $2 AND dp.sleeper_player_id IS NULL
        """,
        season, league_id,
    )
