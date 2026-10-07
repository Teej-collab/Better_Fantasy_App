"""
Push alerts to the site's admins about app health — crashes, new errors,
and sign-in attacks — and about new feedback, so a problem (or a
suggestion) reaches the owner when it happens instead of whenever they
next open the admin dashboard.

Recipients are everyone app/auth/league_context.py's is_site_admin
would let into /admin (League #1's commissioner, or users.is_admin),
on every device they've registered for push. The health alerts are in
quiet_hours._ALWAYS_SEND, so they arrive regardless of quiet hours;
feedback is held until quiet hours end instead.

Each alert is throttled so a bad game day is a few pings, not dozens:
- a crash alerts only if it's the first on that page in the last hour;
- an error alerts only if it's the first of its kind (fingerprint) in
  the last 6 hours;
- failed sign-ins alert once when one IP reaches 10 in 15 minutes, or
  one account reaches 5;
- feedback alerts on every submission (it's rare, and each one matters),
  except to the admin who sent it.
Every event is still recorded — the throttle only limits the pings.
"""
import logging

from app.config import DEFAULT_LEAGUE_ID
from app.notifications import dispatcher, formatter

logger = logging.getLogger(__name__)

CRASH_QUIET_MINUTES = 60
ERROR_QUIET_HOURS = 6
LOGIN_BURST_WINDOW_MINUTES = 15
LOGIN_BURST_PER_IP = 10
LOGIN_BURST_PER_EMAIL = 5


async def admin_owner_ids(conn) -> list[int]:
    rows = await conn.fetch(
        """
        SELECT DISTINCT ou.owner_id
        FROM owner_users ou
        JOIN users u ON u.id = ou.user_id
        WHERE u.is_admin
           OR EXISTS (
               SELECT 1 FROM league_members lm
               WHERE lm.user_id = u.id AND lm.league_id = $1 AND lm.role = 'commissioner'
           )
        """,
        DEFAULT_LEAGUE_ID,
    )
    return [r["owner_id"] for r in rows]


async def _send(conn, payload: dict, exclude_owner_id: int | None = None) -> None:
    try:
        owner_ids = [o for o in await admin_owner_ids(conn) if o != exclude_owner_id]
        if owner_ids:
            await dispatcher.send_to_owners(conn, owner_ids, payload)
    except Exception:
        logger.warning("Admin alert failed to send", exc_info=True)


async def maybe_alert_crash(conn, owner_id: int, route: str | None, metadata: dict) -> None:
    """Called right after an app_crash event is recorded."""
    recent = await conn.fetchval(
        """
        SELECT count(*) FROM analytics_events
        WHERE event_name = 'app_crash' AND route IS NOT DISTINCT FROM $1
          AND created_at > now() - make_interval(mins => $2)
        """,
        route, CRASH_QUIET_MINUTES,
    )
    if recent != 1:
        return
    today = await conn.fetchval(
        """
        SELECT count(*) FROM analytics_events
        WHERE event_name = 'app_crash' AND route IS NOT DISTINCT FROM $1
          AND created_at > now() - interval '24 hours'
        """,
        route,
    )
    name = await conn.fetchval("SELECT display_name FROM owners WHERE owner_id = $1", owner_id)
    await _send(conn, formatter.admin_crash_alert(
        name or "Someone", route or "unknown page",
        str(metadata.get("os") or ""), str(metadata.get("screen") or ""), today or 1,
    ))


async def maybe_alert_error(conn, fp: str) -> None:
    """Called right after an app_errors row is inserted."""
    row = await conn.fetchrow(
        """
        SELECT
            count(*) FILTER (WHERE created_at > now() - make_interval(hours => $2)) AS recent,
            count(*) AS total,
            (array_agg(source ORDER BY created_at DESC))[1] AS source,
            (array_agg(message ORDER BY created_at DESC))[1] AS message,
            (array_agg(route ORDER BY created_at DESC))[1] AS route
        FROM app_errors WHERE fingerprint = $1
        """,
        fp, ERROR_QUIET_HOURS,
    )
    if row is None or row["recent"] != 1:
        return
    await _send(conn, formatter.admin_error_alert(
        row["source"], row["message"], row["route"], is_new=row["total"] == 1, fingerprint=fp,
    ))


async def maybe_alert_login_burst(conn, ip: str | None, email: str | None) -> None:
    """Called right after a login_failed security event is recorded."""
    window = LOGIN_BURST_WINDOW_MINUTES
    if ip:
        by_ip = await conn.fetchval(
            """
            SELECT count(*) FROM security_events
            WHERE kind = 'login_failed' AND ip = $1 AND created_at > now() - make_interval(mins => $2)
            """,
            ip, window,
        )
        if by_ip == LOGIN_BURST_PER_IP:
            await _send(conn, formatter.admin_security_alert(
                f"{by_ip} failed sign-ins from one IP ({ip}) in {window} minutes."
            ))
            return
    if email:
        by_email = await conn.fetchval(
            """
            SELECT count(*) FROM security_events
            WHERE kind = 'login_failed' AND email = $1 AND created_at > now() - make_interval(mins => $2)
            """,
            email, window,
        )
        if by_email == LOGIN_BURST_PER_EMAIL:
            await _send(conn, formatter.admin_security_alert(
                f"{by_email} failed sign-ins for {email} in {window} minutes."
            ))


async def alert_feedback(conn, submitted_by: str, message: str, has_image: bool, submitter_owner_id: int | None) -> None:
    """Called right after a feedback row is inserted."""
    await _send(conn, formatter.admin_feedback_alert(submitted_by, message, has_image), exclude_owner_id=submitter_owner_id)


async def alert_chat_report(conn, reporter: str, reported: str, reason: str, reporter_owner_id: int | None) -> None:
    """Called right after a message_reports row is inserted. Apple
    expects reports to be acted on within a day, so every one pings."""
    await _send(conn, formatter.admin_chat_report_alert(reporter, reported, reason), exclude_owner_id=reporter_owner_id)
