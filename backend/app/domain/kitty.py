"""
The league kitty (2026-10-28): what each manager owes the league's pot
and whether they've paid, kept by the commissioner. Franchise tag fees
land here on their own when keepers lock (league_keeper_rules.tag_fees:
a price by year kept, [0, 10, 25] is League #1's year 1 free, year 2
$10, year 3 $25); the commissioner adds anything else (buy-ins, side
bets) and marks each entry paid.
"""
import json


def tag_fee(fees, year: int) -> float:
    """The fee for keeping a player for the `year`th season in a row.
    Past the end of the list, the last price."""
    if isinstance(fees, str):
        fees = json.loads(fees)
    if not fees or year < 1:
        return 0.0
    return float(fees[min(year, len(fees)) - 1] or 0)


async def record_tag_fees(conn, season: int, league_id: int) -> int:
    """Turns this season's locked keepers into kitty entries. Safe to run
    again: each keeper's fee is one entry (source_key)."""
    fees = await conn.fetchval("SELECT tag_fees FROM league_keeper_rules WHERE season = $1 AND league_id = $2", season, league_id)
    if not fees:
        return 0
    added = 0
    for k in await conn.fetch(
        "SELECT owner_id, espn_player_id, player_name, consecutive_years_kept FROM keeper_selections WHERE season = $1 AND league_id = $2",
        season, league_id,
    ):
        year = k["consecutive_years_kept"] or 1
        amount = tag_fee(fees, year)
        if amount <= 0:
            continue
        status = await conn.execute(
            "INSERT INTO league_kitty_entries (league_id, season, owner_id, amount, reason, source_key) VALUES ($1, $2, $3, $4, $5, $6) "
            "ON CONFLICT (league_id, source_key) DO NOTHING",
            league_id, season, k["owner_id"], amount, f"Franchise tag: {k['player_name']} (year {year})",
            f"tag:{season}:{k['owner_id']}:{k['espn_player_id']}",
        )
        added += status.endswith("1")
    return added


async def clear_unpaid_tag_fees(conn, season: int, league_id: int) -> None:
    """Keepers unlocked to change: the season's unpaid tag fees come off
    until they lock again. Paid ones stay."""
    await conn.execute(
        "DELETE FROM league_kitty_entries WHERE league_id = $1 AND season = $2 AND source_key LIKE $3 AND paid_at IS NULL",
        league_id, season, f"tag:{season}:%",
    )


async def lock_keepers(conn, season: int, league_id: int):
    """Locks the season's keepers and bills their tag fees. Returns the
    rules row when this call locked it, None when it already was."""
    from app.queries import keepers as keeper_queries

    row = await keeper_queries.lock_rules(conn, season, league_id)
    if row is not None:
        await record_tag_fees(conn, season, league_id)
    return row


async def ledger(conn, league_id: int) -> dict:
    rows = await conn.fetch(
        """
        SELECT k.id, k.season, k.owner_id, COALESCE(o.goes_by, o.display_name) AS owner_name, k.amount, k.reason,
               k.source_key IS NOT NULL AS automatic, k.created_at, k.paid_at
        FROM league_kitty_entries k LEFT JOIN owners o ON o.owner_id = k.owner_id
        WHERE k.league_id = $1 ORDER BY k.paid_at IS NOT NULL, k.season DESC, k.created_at DESC
        """,
        league_id,
    )
    entries = [
        {
            "id": r["id"], "season": r["season"], "owner_id": r["owner_id"], "owner_name": r["owner_name"],
            "amount": float(r["amount"]), "reason": r["reason"], "automatic": r["automatic"],
            "created_at": r["created_at"].isoformat(), "paid_at": r["paid_at"].isoformat() if r["paid_at"] else None,
        }
        for r in rows
    ]
    return {
        "entries": entries,
        "collected": round(sum(e["amount"] for e in entries if e["paid_at"]), 2),
        "outstanding": round(sum(e["amount"] for e in entries if not e["paid_at"]), 2),
    }
