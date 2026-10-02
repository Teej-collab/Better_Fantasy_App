"""
Why an owner owes what they owe — the chug history behind the
leaderboard's numbers, one short line per event:

    Wk 2  +1  Dolphins D/ST (-6)
    Wk 3  deadline missed — doubled 1 → 2
    Chug posted (8.4)  -1

Rebuilt from the records Jeffrey's Rule already keeps (app/domain/
chug_standing.py): chug_debts for what each week earned (and the roster
rows for which starters earned it — app/domain/chug_debt.py's rule),
chug_deadline_settlements for each Monday deadline's doubling, fine or
waiver, and chug_scores for chugs posted. Nothing here changes a balance.

Everything a commissioner or admin does by hand comes from
chug_adjustments: chugs marked "Paid" ($10 a chug, or done in person),
fines paid off, and "Correction"s with their note. Payments from before
that log existed (migration e9c4a1b7d3f2) were never recorded, so when
the replay lands above the real balance, the gap shows as one "Paid"
line — the only way a balance went down outside these records back
then. A gap the other way is a plain "adjustment".
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.config import DEFAULT_LEAGUE_ID
from app.domain.chug_standing import FINE_PER_CHUG
from app.domain.roster_source import uses_in_app_rosters

_FAR_FUTURE = datetime(9999, 1, 1, tzinfo=timezone.utc)


def replay(
    earned: dict[int, int],
    reasons: dict[int, list[dict]],
    settlements: list[dict],
    chugs: list[dict],
    actual_outstanding: int | None,
    week_deadlines: dict[int, datetime] | None = None,
    payments: list[dict] | None = None,
) -> list[dict]:
    """One owner's events in order. `earned`: week → chugs owed that
    week. `settlements`: {week, action, owed_before, owed_after,
    settled_at}. `chugs`: {created_at, final_score}. `actual_outstanding`
    is chug_standing's real balance (None for a past season, which has
    no running balance to reconcile against). `week_deadlines`: week →
    when that week's deadline was settled league-wide (an owner who owed
    nothing yet has no settlement row of their own for it).

    A week's chugs are earned once its games are final — after that
    week's own Monday deadline — so they're placed just after it, and
    are first due at the next week's deadline."""
    settled_at_by_week = dict(week_deadlines or {})
    for s in settlements:
        if s.get("settled_at"):
            settled_at_by_week.setdefault(s["week"], s["settled_at"])
    events: list[tuple[datetime, int, dict]] = []
    for week, count in earned.items():
        if count <= 0:
            continue
        at = settled_at_by_week.get(week)
        when = at + timedelta(seconds=1) if at else _FAR_FUTURE - timedelta(days=1000 - week)
        events.append((when, 1, {"kind": "earned", "week": week, "chugs": count, "reasons": reasons.get(week, [])}))
    for s in settlements:
        if s["action"] == "no_debt":
            continue
        events.append((s.get("settled_at") or _FAR_FUTURE, 0, {"kind": s["action"], "week": s["week"], "owed_before": s["owed_before"], "owed_after": s["owed_after"]}))
    for p in payments or []:
        e = {"kind": p["kind"], "at": p["created_at"].isoformat(), "amount": p["amount"]}
        if p["kind"] in ("paid", "fine_paid"):
            e["dollars"] = p["amount"] * FINE_PER_CHUG
        else:
            e["note"] = p.get("note")
        events.append((p["created_at"], 3, e))
    for c in chugs:
        events.append((c["created_at"], 2, {"kind": "chug", "at": c["created_at"].isoformat(), "score": float(c["final_score"]) if c.get("final_score") is not None else None}))
    events.sort(key=lambda e: (e[0], e[1]))

    balance = 0
    out: list[dict] = []
    for _, _, e in events:
        if e["kind"] == "earned":
            balance += e["chugs"]
            e["change"] = e["chugs"]
        elif e["kind"] == "doubled":
            # The settlement's own numbers are the truth for what was due.
            e["change"] = e["owed_after"] - e["owed_before"]
            balance += e["change"]
        elif e["kind"] == "fined":
            e["change"] = -e["owed_before"]
            e["fine_amount"] = e["owed_before"] * FINE_PER_CHUG
            balance -= e["owed_before"]
        elif e["kind"] == "waived":
            e["change"] = 0
        elif e["kind"] == "paid":
            e["change"] = -min(e["amount"], balance)
            balance += e["change"]
        elif e["kind"] == "correction":
            e["change"] = max(e["amount"], -balance)
            balance += e["change"]
        elif e["kind"] == "fine_paid":
            # Clears the fine, not the chug balance.
            e["change"] = 0
        elif e["kind"] == "chug":
            # A chug only pays something down when something's owed.
            e["change"] = -1 if balance > 0 else 0
            balance += e["change"]
        balance = max(balance, 0)
        e["balance"] = balance
        out.append(e)

    if actual_outstanding is not None and actual_outstanding < balance:
        paid = balance - actual_outstanding
        out.append({"kind": "paid", "at": None, "amount": paid, "dollars": paid * FINE_PER_CHUG, "change": -paid, "balance": actual_outstanding})
    elif actual_outstanding is not None and actual_outstanding > balance:
        out.append({"kind": "adjustment", "change": actual_outstanding - balance, "balance": actual_outstanding})
    return out


async def _reasons_by_owner_week(conn, season: int, league_id: int) -> dict[tuple[int, int], list[dict]]:
    """The starters behind each week's chugs: every active (non-bench,
    non-IR) slot that scored 0 or less — chug_debt.compute_chugs_owed's
    rule, read from whichever roster source that season used."""
    if await uses_in_app_rosters(conn, season):
        rows = await conn.fetch(
            """
            SELECT tbs.owner_id, rh.week, p.full_name AS player_name, p.position, rh.lineup_slot,
                   pws.fantasy_points AS points
            FROM roster_history rh
            JOIN teams_by_season tbs ON tbs.id = rh.team_id AND tbs.league_id = $2
            JOIN players p ON p.sleeper_player_id = rh.sleeper_player_id
            LEFT JOIN player_week_stats pws
                ON pws.season = rh.season AND pws.week = rh.week AND pws.sleeper_player_id = rh.sleeper_player_id
                AND pws.league_id = $2
            WHERE rh.season = $1 AND rh.lineup_slot NOT IN ('BE', 'IR') AND COALESCE(pws.fantasy_points, 0) <= 0
            ORDER BY rh.week, pws.fantasy_points NULLS LAST
            """,
            season, league_id,
        )
    else:
        rows = await conn.fetch(
            """
            SELECT tbs.owner_id, r.week, r.player_name, r.position, r.lineup_slot, r.points_scored AS points
            FROM rosters r
            JOIN teams_by_season tbs ON tbs.id = r.team_id
            WHERE r.season = $1 AND r.league_id = $2 AND r.lineup_slot NOT IN ('BE', 'IR')
              AND COALESCE(r.points_scored, 0) <= 0
            ORDER BY r.week, r.points_scored NULLS LAST
            """,
            season, league_id,
        )
    out: dict[tuple[int, int], list[dict]] = {}
    for r in rows:
        out.setdefault((r["owner_id"], r["week"]), []).append(
            {
                "player_name": r["player_name"],
                "position": r["position"],
                "points": float(r["points"]) if r["points"] is not None else 0.0,
            }
        )
    return out


async def build_chug_ledger(conn, season: int, active_season: int, league_id: int = DEFAULT_LEAGUE_ID) -> dict[int, list[dict]]:
    """owner_id → that owner's events for the season (see replay)."""
    debts = await conn.fetch(
        "SELECT owner_id, week, chugs_owed FROM chug_debts WHERE season = $1 AND league_id = $2",
        season, league_id,
    )
    settlements = await conn.fetch(
        "SELECT owner_id, week, action, owed_before, owed_after, settled_at FROM chug_deadline_settlements "
        "WHERE season = $1 AND league_id = $2",
        season, league_id,
    )
    chugs = await conn.fetch(
        """
        SELECT owners.owner_id, cs.created_at, cs.final_score
        FROM chug_scores cs JOIN owners ON owners.discord_user_id = cs.discord_user_id
        WHERE cs.league_id = $1 AND cs.season = $2
        """,
        league_id, season,
    )
    standing = (
        {
            r["owner_id"]: r["outstanding_owed"]
            for r in await conn.fetch(
                "SELECT owner_id, outstanding_owed FROM chug_standing WHERE season = $1 AND league_id = $2", season, league_id
            )
        }
        if season == active_season
        else None
    )
    payments = await conn.fetch(
        "SELECT owner_id, kind, amount, note, created_at FROM chug_adjustments WHERE season = $1 AND league_id = $2",
        season, league_id,
    )
    reasons = await _reasons_by_owner_week(conn, season, league_id)

    week_deadlines: dict[int, datetime] = {}
    for s in settlements:
        if s["settled_at"] and (s["week"] not in week_deadlines or s["settled_at"] < week_deadlines[s["week"]]):
            week_deadlines[s["week"]] = s["settled_at"]

    owners = (
        {r["owner_id"] for r in debts}
        | {r["owner_id"] for r in settlements}
        | {r["owner_id"] for r in chugs}
        | {r["owner_id"] for r in payments}
    )
    out: dict[int, list[dict]] = {}
    for owner_id in owners:
        earned = {r["week"]: r["chugs_owed"] for r in debts if r["owner_id"] == owner_id}
        out[owner_id] = replay(
            earned,
            {week: reasons.get((owner_id, week), []) for week in earned},
            [dict(s) for s in settlements if s["owner_id"] == owner_id],
            [dict(c) for c in chugs if c["owner_id"] == owner_id],
            (standing or {}).get(owner_id, 0) if standing is not None else None,
            week_deadlines,
            [dict(p) for p in payments if p["owner_id"] == owner_id],
        )
    return out
