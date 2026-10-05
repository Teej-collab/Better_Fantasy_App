"""
Push notifications for every step of a trade (app/domain/trades.py) —
the 2026-10-04 report was a trade that went through with nobody told.
Modeled on ESPN/Sleeper: the other owner hears about an offer, the
proposer hears the answer, and once a deal is accepted the whole league
hears it's under review (with how to object), then how it ended.

Personal messages (an offer to you, an answer to your offer, your trade
vetoed or processed) only need push turned on; the league-wide ones also
respect the League toggle (notify_league), same as chug_events.py.

A push failure must never break a trade — every function here swallows
and logs its own errors, same discipline as the other *_events modules.
"""
import datetime
import logging
from zoneinfo import ZoneInfo

from app.notifications import dispatcher, formatter
from app.queries import owner_preferences as preferences_queries

logger = logging.getLogger(__name__)

_CENTRAL = ZoneInfo("America/Chicago")


def _names(trade: dict, to_team_id: int) -> str:
    names = [a["player_name"] for a in trade["assets"] if a["to_team_id"] == to_team_id]
    return ", ".join(names) or "nothing"


def _summary(trade: dict) -> str:
    return (
        f"{trade['proposing_team_name']} get {_names(trade, trade['proposing_team_id'])} · "
        f"{trade['receiving_team_name']} get {_names(trade, trade['receiving_team_id'])}"
    )


def _when(ts: datetime.datetime | None) -> str:
    if ts is None:
        return "soon"
    return ts.astimezone(_CENTRAL).strftime("%a %-I:%M %p CT")


async def _send(conn, owner_ids, payload: dict, *, league_wide: bool) -> None:
    for owner_id in {o for o in owner_ids if o is not None}:
        prefs = await preferences_queries.get_preferences(conn, owner_id)
        if not prefs["push_enabled"] or (league_wide and not prefs["notify_league"]):
            continue
        await dispatcher.send_to_owner(conn, owner_id, payload)


async def _league_owner_ids(conn, trade: dict) -> list[int]:
    rows = await conn.fetch(
        "SELECT DISTINCT owner_id FROM teams_by_season WHERE league_id = $1 AND season = $2",
        trade["league_id"], trade["season"],
    )
    parties = {trade["proposing_owner_id"], trade["receiving_owner_id"]}
    return [r["owner_id"] for r in rows if r["owner_id"] not in parties]


async def _commissioner_owner_ids(conn, trade: dict) -> list[int]:
    rows = await conn.fetch(
        """
        SELECT DISTINCT ou.owner_id FROM league_members lm
        JOIN owner_users ou ON ou.user_id = lm.user_id
        WHERE lm.league_id = $1 AND lm.role = 'commissioner'
        """,
        trade["league_id"],
    )
    return [r["owner_id"] for r in rows]


async def notify_trade_event(conn, trade: dict | None, event: str, settings: dict | None = None) -> None:
    """`event` is what just happened: proposed, rejected, cancelled,
    accepted (the trade's own status says whether it's processed, under
    review, or waiting on the commissioner), vetoed, processed, failed,
    expired."""
    if trade is None:
        return
    try:
        tid = trade["id"]
        proposer, receiver = trade["proposing_owner_id"], trade["receiving_owner_id"]
        both = [proposer, receiver]
        summary = _summary(trade)
        status = trade["status"]

        if event == "proposed":
            note = f" — “{trade['note']}”" if trade.get("note") else ""
            await _send(conn, [receiver], formatter.trade_offer(trade["proposing_team_name"], summary + note, tid), league_wide=False)
        elif event == "rejected":
            await _send(conn, [proposer], formatter.trade_update(f"❌ {trade['receiving_team_name']} declined your trade", summary, tid), league_wide=False)
        elif event == "cancelled":
            await _send(conn, [receiver], formatter.trade_update(f"{trade['proposing_team_name']} withdrew their offer", summary, tid), league_wide=False)
        elif event == "expired":
            await _send(conn, [proposer], formatter.trade_update("⌛ Your trade offer expired", summary, tid), league_wide=False)
        elif event == "accepted" and status == "accepted":
            await _send(conn, both, formatter.trade_update("✅ Trade processed", summary, tid), league_wide=False)
            await _send(conn, await _league_owner_ids(conn, trade), formatter.trade_update("🔁 Trade completed", summary, tid), league_wide=True)
        elif event == "accepted" and status == "in_review":
            ends = _when(trade.get("review_ends_at"))
            await _send(conn, [proposer], formatter.trade_update(f"🤝 {trade['receiving_team_name']} accepted your trade", f"Under league review until {ends}. {summary}", tid), league_wide=False)
            voting = settings is not None and settings.get("review_mode") == "league_vote"
            ask = "Vote to veto in Trades if it's unfair." if voting else "The commissioner can veto it until then."
            commissioners = await _commissioner_owner_ids(conn, trade)
            others = [o for o in await _league_owner_ids(conn, trade) if o not in commissioners]
            await _send(conn, others, formatter.trade_update("⚖️ Trade under review", f"{summary}. Processes {ends}. {ask}", tid), league_wide=True)
            await _send(conn, commissioners, formatter.trade_update("⚖️ Trade to review", f"{summary}. Processes {ends} unless you veto it.", tid), league_wide=False)
        elif event == "accepted" and status == "awaiting_review":
            await _send(conn, [proposer], formatter.trade_update(f"🤝 {trade['receiving_team_name']} accepted your trade", f"Waiting on commissioner approval. {summary}", tid), league_wide=False)
            await _send(conn, await _commissioner_owner_ids(conn, trade), formatter.trade_update("⚖️ Trade needs your approval", summary, tid), league_wide=False)
        elif event == "vetoed":
            await _send(conn, both, formatter.trade_update("🚫 Trade vetoed", summary, tid), league_wide=False)
            await _send(conn, await _league_owner_ids(conn, trade), formatter.trade_update("🚫 Trade vetoed", summary, tid), league_wide=True)
        elif event == "processed":
            await _send(conn, both, formatter.trade_update("✅ Trade processed", summary, tid), league_wide=False)
            await _send(conn, await _league_owner_ids(conn, trade), formatter.trade_update("🔁 Trade completed", summary, tid), league_wide=True)
        elif event == "failed":
            await _send(conn, both, formatter.trade_update("⚠️ Trade couldn't go through", f"A player in it moved before it processed. {summary}", tid), league_wide=False)
    except Exception:
        logger.exception("Trade notification failed (trade_id=%s event=%s)", trade.get("id"), event)


async def notify_processed_batch(conn, trades: list[dict]) -> None:
    """For process_due_trades' results."""
    for trade in trades:
        event = {"accepted": "processed", "failed": "failed", "expired": "expired"}.get(trade["status"])
        if event:
            await notify_trade_event(conn, trade, event)
