"""
roster_transactions — the write side of the League Activity feed
(app/domain/league_activity.py does the reads/merging with trades).
See migration cda4f0235dde's own docstring for why this table exists
at all: every add/drop already writes acquired_via/acquired_at onto
current_rosters, but a drop just deletes that row with nothing left
behind. This is the log a drop (and, for a uniform single-row-per-
action shape, its paired add when one happens in the same move) writes
to instead.
"""
from app.config import DEFAULT_LEAGUE_ID


async def log_transaction(
    conn,
    season: int,
    team_id: int,
    source: str,
    added_sleeper_player_id: str | None = None,
    dropped_sleeper_player_id: str | None = None,
    league_id: int = DEFAULT_LEAGUE_ID,
) -> None:
    """Best-effort activity log for one real roster move — never the
    thing that decides whether an add/drop itself succeeds. Callers
    already run this inside the same transaction as the actual
    current_rosters mutation, so a logging failure rolls back the whole
    move rather than silently going unlogged; that's the right trade
    here (a logged-but-failed move would be worse than a rare failed
    move) since this table has no other consumer that could break.
    `source` is one of 'free_agent', 'waiver', 'commissioner' — never
    'trade' (trades.py's own trades/trade_assets tables are the real
    history for that; see league_activity.py's own docstring)."""
    if added_sleeper_player_id is None and dropped_sleeper_player_id is None:
        return
    await conn.execute(
        """
        INSERT INTO roster_transactions
            (season, league_id, team_id, added_sleeper_player_id, dropped_sleeper_player_id, source)
        VALUES ($1, $2, $3, $4, $5, $6)
        """,
        season, league_id, team_id, added_sleeper_player_id, dropped_sleeper_player_id, source,
    )
