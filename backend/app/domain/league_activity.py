"""
League Activity feed — trades, waiver pickups, and free-agent adds/
drops, merged into one reverse-chronological feed (2026-09-15 ask:
"show activity like trades, waiver pick ups, or when a user add/drops
a player").

Two real sources, deliberately not one unified table:
  - roster_transactions (app/queries/roster_transactions.py) — every
    add/drop of every kind writes here now. Before this feature, a drop
    just deleted its current_rosters row with nothing left behind (see
    that module's own docstring); adds were technically recoverable
    from current_rosters.acquired_at, but reconstructing a paired
    "added X, dropped Y" move from two separately-timestamped rows
    after the fact is fragile, so both write to roster_transactions as
    one action now.
  - trades / trade_assets (app/domain/trades.py) — already had full,
    real history long before this feature; duplicating accepted trades
    into roster_transactions too would just be two sources of truth for
    the same event. Read directly from where they already live instead.

Nothing here is retroactive: a league's activity feed only goes back to
whenever this feature deployed for adds/waivers/drops (trades go back
further, since that table already existed). That's a real, accepted
trade-off (nothing before deploy can be recovered), not a bug.
"""
from app.config import DEFAULT_LEAGUE_ID


async def _recent_roster_transactions(conn, season: int, league_id: int, limit: int) -> list[dict]:
    rows = await conn.fetch(
        """
        SELECT
            rt.created_at, rt.source,
            t.team_name, o.owner_id, o.display_name AS owner_name,
            added.full_name AS added_player_name, added.position AS added_position,
            dropped.full_name AS dropped_player_name, dropped.position AS dropped_position
        FROM roster_transactions rt
        JOIN teams_by_season t ON t.id = rt.team_id
        JOIN owners o ON o.owner_id = t.owner_id
        LEFT JOIN players added ON added.sleeper_player_id = rt.added_sleeper_player_id
        LEFT JOIN players dropped ON dropped.sleeper_player_id = rt.dropped_sleeper_player_id
        WHERE rt.season = $1 AND rt.league_id = $2
        ORDER BY rt.created_at DESC
        LIMIT $3
        """,
        season, league_id, limit,
    )
    return [
        {
            "kind": "roster",
            "timestamp": r["created_at"],
            "team_name": r["team_name"],
            "owner_id": r["owner_id"],
            "owner_name": r["owner_name"],
            "source": r["source"],
            "added_player_name": r["added_player_name"],
            "added_position": r["added_position"],
            "dropped_player_name": r["dropped_player_name"],
            "dropped_position": r["dropped_position"],
        }
        for r in rows
    ]


async def _recent_trades(conn, season: int, league_id: int, limit: int) -> list[dict]:
    trade_rows = await conn.fetch(
        """
        SELECT
            tr.id, tr.resolved_at,
            pt.team_name AS proposing_team_name, po.owner_id AS proposing_owner_id,
            po.display_name AS proposing_owner_name,
            rt.team_name AS receiving_team_name, ro.owner_id AS receiving_owner_id,
            ro.display_name AS receiving_owner_name
        FROM trades tr
        JOIN teams_by_season pt ON pt.id = tr.proposing_team_id
        JOIN owners po ON po.owner_id = pt.owner_id
        JOIN teams_by_season rt ON rt.id = tr.receiving_team_id
        JOIN owners ro ON ro.owner_id = rt.owner_id
        WHERE tr.season = $1 AND tr.league_id = $2 AND tr.status = 'accepted'
        ORDER BY tr.resolved_at DESC
        LIMIT $3
        """,
        season, league_id, limit,
    )
    if not trade_rows:
        return []

    trade_ids = [r["id"] for r in trade_rows]
    asset_rows = await conn.fetch(
        """
        SELECT ta.trade_id, ta.from_team_id, ta.to_team_id, p.full_name AS player_name, p.position
        FROM trade_assets ta
        JOIN players p ON p.sleeper_player_id = ta.sleeper_player_id
        WHERE ta.trade_id = ANY($1::int[])
        ORDER BY ta.id
        """,
        trade_ids,
    )
    assets_by_trade: dict[int, list[dict]] = {}
    for a in asset_rows:
        assets_by_trade.setdefault(a["trade_id"], []).append(
            {"player_name": a["player_name"], "position": a["position"], "to_team_id": a["to_team_id"]}
        )

    return [
        {
            "kind": "trade",
            "timestamp": r["resolved_at"],
            "proposing_team_name": r["proposing_team_name"],
            "proposing_owner_id": r["proposing_owner_id"],
            "proposing_owner_name": r["proposing_owner_name"],
            "receiving_team_name": r["receiving_team_name"],
            "receiving_owner_id": r["receiving_owner_id"],
            "receiving_owner_name": r["receiving_owner_name"],
            "assets": assets_by_trade.get(r["id"], []),
        }
        for r in trade_rows
    ]


async def get_league_activity(conn, season: int, league_id: int = DEFAULT_LEAGUE_ID, limit: int = 30) -> list[dict]:
    """Merges both sources above into one reverse-chronological feed,
    each item already carrying everything the frontend needs to render
    a row with no further per-item fetch. Overfetches each source by
    `limit` before merging+trimming — cheap (both tables are small,
    league-scoped, and indexed on season/league_id/timestamp) and much
    simpler than a real SQL UNION across two very differently-shaped
    queries."""
    roster_items = await _recent_roster_transactions(conn, season, league_id, limit)
    trade_items = await _recent_trades(conn, season, league_id, limit)
    merged = roster_items + trade_items
    merged.sort(key=lambda item: item["timestamp"], reverse=True)
    return merged[:limit]
