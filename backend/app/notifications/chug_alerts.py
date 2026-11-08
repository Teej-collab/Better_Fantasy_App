"""
The chug rule's pushes (2026-11-08), for leagues with it on — before
this, the only way to find out you owed was opening the Chug page:

- notify_chugs_owed — when the week flips (Tuesday 2 PM Central, once
  stat corrections have had a day): "🍺 You owe 2 chugs from Week 9",
  naming the starters who scored 0 or less.
- remind_deadline — Monday, within REMIND_BEFORE of the Monday night
  kickoff, to anyone with chugs due: "⏰ 2 chugs due by kickoff tonight".
- notify_settlements — once the deadline settles (app/domain/
  chug_standing.py): "doubled to 4", or "became a $40 fine".

Each goes once per owner per week (notification_once), under "my
fantasy team" in the owner's push preferences.
"""
from datetime import datetime, timedelta, timezone

from app.domain.chug_debt import zero_point_starters
from app.domain.chug_standing import FINE_PER_CHUG
from app.notifications import formatter
from app.notifications.game_alerts import _kickoff_label, _send, claim_once

REMIND_BEFORE = timedelta(hours=6)


async def notify_chugs_owed(conn, season: int, week: int, league_id: int) -> int:
    rows = await conn.fetch(
        """
        SELECT d.owner_id, d.chugs_owed, COALESCE(s.outstanding_owed, d.chugs_owed) AS balance
        FROM chug_debts d
        LEFT JOIN chug_standing s ON s.season = d.season AND s.owner_id = d.owner_id AND s.league_id = d.league_id
        WHERE d.season = $1 AND d.week = $2 AND d.league_id = $3 AND d.chugs_owed > 0
        """,
        season, week, league_id,
    )
    sent = 0
    for r in rows:
        key = f"chug-owed-{league_id}-{season}-{week}-{r['owner_id']}"
        if not await claim_once(conn, key):
            continue
        names = await zero_point_starters(conn, season, week, r["owner_id"], league_id)
        push = formatter.chugs_owed(week, r["chugs_owed"], names, r["balance"], key)
        await _send(conn, r["owner_id"], push, "notify_fantasy_team", league_id)
        sent += 1
    return sent


async def remind_deadline(conn, season: int, week: int, league_id: int, deadline: datetime, now: datetime | None = None) -> int:
    """`week` is the week whose Monday night is the deadline; chugs that
    week earned itself aren't due until the next one (the same split
    settle_deadline_for_week makes)."""
    now = now or datetime.now(timezone.utc)
    if not (timedelta(0) < deadline - now <= REMIND_BEFORE):
        return 0
    rows = await conn.fetch(
        """
        SELECT s.owner_id, s.outstanding_owed - COALESCE(a.applied_amount, 0) AS due
        FROM chug_standing s
        LEFT JOIN chug_debt_accruals a
            ON a.season = s.season AND a.week = $2 AND a.owner_id = s.owner_id AND a.league_id = s.league_id
        WHERE s.season = $1 AND s.league_id = $3 AND s.outstanding_owed > 0
        """,
        season, week, league_id,
    )
    sent = 0
    for r in rows:
        if r["due"] <= 0:
            continue
        key = f"chug-due-{league_id}-{season}-{week}-{r['owner_id']}"
        if not await claim_once(conn, key):
            continue
        push = formatter.chug_deadline_soon(r["due"], _kickoff_label(deadline.isoformat()), deadline, key)
        await _send(conn, r["owner_id"], push, "notify_fantasy_team", league_id)
        sent += 1
    return sent


async def notify_settlements(conn, season: int, week: int, league_id: int) -> int:
    rows = await conn.fetch(
        """
        SELECT owner_id, action, owed_before, owed_after FROM chug_deadline_settlements
        WHERE season = $1 AND week = $2 AND league_id = $3 AND action IN ('doubled', 'fined')
        """,
        season, week, league_id,
    )
    sent = 0
    for r in rows:
        key = f"chug-settled-{league_id}-{season}-{week}-{r['owner_id']}"
        if not await claim_once(conn, key):
            continue
        push = formatter.chug_settled(r["action"], r["owed_before"], r["owed_after"], r["owed_before"] * FINE_PER_CHUG, key)
        await _send(conn, r["owner_id"], push, "notify_fantasy_team", league_id)
        sent += 1
    return sent
