"""The admin inbox (2026-10-28): everything that needs a person, in one
feed, for the site admins (TJ and Niko). Items are read live from their
own tables — new kinds of error, crashes, feedback, waitlist sign-ups,
ask-to-join requests and new leagues — and admin_inbox_claims only adds
who claimed each one and whether it's done. An error marked done comes
back if it happens again afterwards.
"""
from app.analytics import taxonomy

KINDS = ("error", "crash", "feedback", "waitlist", "join", "league")

# How far back each source reaches. Older items drop off on their own.
WINDOW_DAYS = 14


async def _admin_names(conn, user_ids: set[int]) -> dict[int, str]:
    if not user_ids:
        return {}
    rows = await conn.fetch(
        "SELECT id, COALESCE(NULLIF(display_name, ''), split_part(email, '@', 1)) AS name FROM users WHERE id = ANY($1::int[])",
        list(user_ids),
    )
    return {r["id"]: r["name"] for r in rows}


async def _errors(conn) -> list[dict]:
    rows = await conn.fetch(
        """
        SELECT fingerprint,
               (array_agg(message ORDER BY created_at DESC))[1] AS message,
               (array_agg(route ORDER BY created_at DESC))[1] AS route,
               count(*) AS occurrences,
               count(DISTINCT coalesce(owner_id::text, user_id::text)) AS affected,
               max(created_at) AS last_seen
        FROM app_errors
        WHERE created_at >= now() - ($1 || ' days')::interval
        GROUP BY fingerprint
        ORDER BY max(created_at) DESC
        LIMIT 40
        """,
        str(WINDOW_DAYS),
    )
    items = []
    for r in rows:
        people = r["affected"]
        detail = f"{r['occurrences']}× · {people} {'person' if people == 1 else 'people'}"
        if r["route"]:
            detail += f" · {r['route']}"
        items.append({
            "kind": "error", "ref": r["fingerprint"], "title": r["message"][:140], "detail": detail,
            "at": r["last_seen"], "link": {"screen": "error", "id": r["fingerprint"]},
        })
    return items


async def _crashes(conn) -> list[dict]:
    rows = await conn.fetch(
        """
        SELECT ae.id, ae.route, ae.created_at, ae.metadata->>'message' AS message,
               ae.metadata->>'os' AS os, o.display_name
        FROM analytics_events ae
        LEFT JOIN owners o ON o.owner_id = ae.owner_id
        WHERE ae.event_name = $2 AND ae.created_at >= now() - ($1 || ' days')::interval
        ORDER BY ae.created_at DESC
        LIMIT 20
        """,
        str(WINDOW_DAYS), taxonomy.CRASH_EVENT_NAME,
    )
    return [
        {
            "kind": "crash", "ref": str(r["id"]),
            "title": (r["message"] or "The app crashed")[:140],
            "detail": " · ".join(x for x in (r["display_name"], r["route"], r["os"]) if x),
            "at": r["created_at"], "link": {"screen": "crashes"},
        }
        for r in rows
    ]


async def _feedback(conn) -> list[dict]:
    rows = await conn.fetch(
        """
        SELECT id, submitted_by, message, page_url, image_url, created_at FROM feedback
        WHERE created_at >= now() - ($1 || ' days')::interval
        ORDER BY created_at DESC LIMIT 30
        """,
        str(WINDOW_DAYS),
    )
    return [
        {
            "kind": "feedback", "ref": str(r["id"]), "title": r["message"][:200],
            "detail": " · ".join(x for x in (r["submitted_by"], r["page_url"], "screenshot attached" if r["image_url"] else None) if x),
            "at": r["created_at"], "link": {"screen": "feedback", "id": str(r["id"]), "image_url": r["image_url"]},
        }
        for r in rows
    ]


async def _waitlist(conn) -> list[dict]:
    rows = await conn.fetch(
        """
        SELECT id, email, name, role, league_size, platform, created_at FROM waitlist_signups
        WHERE created_at >= now() - ($1 || ' days')::interval
        ORDER BY created_at DESC LIMIT 30
        """,
        str(WINDOW_DAYS),
    )
    items = []
    for r in rows:
        who = r["name"] or r["email"]
        if r["role"] == "commissioner":
            title = f"{who} wants to bring a league"
            bits = [f"{r['league_size']} teams" if r["league_size"] else None, (r["platform"] or "").upper() or None]
        else:
            title = f"{who} joined the waitlist"
            bits = []
        items.append({
            "kind": "waitlist", "ref": str(r["id"]), "title": title,
            "detail": " · ".join(b for b in [*bits, r["email"]] if b),
            "at": r["created_at"], "link": {"screen": "waitlist"},
        })
    return items


async def _join_requests(conn) -> list[dict]:
    # POST /leagues/request-join keeps no table of its own: its once-a-day
    # guard key (join-request:<league>:<user>:<date>) is the record.
    rows = await conn.fetch(
        """
        SELECT n.key, n.sent_at, l.id AS league_id, l.name AS league, COALESCE(u.display_name, u.email) AS who,
               EXISTS (SELECT 1 FROM league_members lm WHERE lm.league_id = l.id AND lm.user_id = u.id) AS joined
        FROM notification_once n
        JOIN leagues l ON l.id = split_part(n.key, ':', 2)::int
        JOIN users u ON u.id = split_part(n.key, ':', 3)::int
        WHERE n.key LIKE 'join-request:%' AND n.sent_at >= now() - ($1 || ' days')::interval
        ORDER BY n.sent_at DESC LIMIT 30
        """,
        str(WINDOW_DAYS),
    )
    return [
        {
            "kind": "join", "ref": r["key"], "title": f"{r['who']} asked to join {r['league']}",
            "detail": "They're in now" if r["joined"] else "The commissioner hasn't let them in yet",
            "at": r["sent_at"], "link": {"screen": "league", "id": str(r["league_id"])},
            "resolved": r["joined"],
        }
        for r in rows
    ]


async def _new_leagues(conn) -> list[dict]:
    rows = await conn.fetch(
        """
        SELECT l.id, l.name, l.created_at,
               (SELECT count(*) FROM league_members lm WHERE lm.league_id = l.id) AS members,
               EXISTS (SELECT 1 FROM league_espn_connections c WHERE c.league_id = l.id) AS espn,
               EXISTS (SELECT 1 FROM league_sleeper_connections c WHERE c.league_id = l.id) AS sleeper
        FROM leagues l
        WHERE l.created_at >= now() - ($1 || ' days')::interval
        ORDER BY l.created_at DESC LIMIT 20
        """,
        str(WINDOW_DAYS),
    )
    return [
        {
            "kind": "league", "ref": str(r["id"]), "title": f"New league: {r['name']}",
            "detail": f"{'ESPN sync' if r['espn'] else 'Sleeper sync' if r['sleeper'] else 'Made in the app'} · "
                      f"{r['members']} {'person' if r['members'] == 1 else 'people'} in",
            "at": r["created_at"], "link": {"screen": "league", "id": str(r["id"])},
        }
        for r in rows
    ]


async def get_inbox(conn) -> list[dict]:
    items = [
        *await _errors(conn), *await _crashes(conn), *await _feedback(conn),
        *await _waitlist(conn), *await _join_requests(conn), *await _new_leagues(conn),
    ]
    claims = {
        (r["kind"], r["ref"]): r
        for r in await conn.fetch(
            "SELECT kind, ref, claimed_by, claimed_at, done_by, done_at FROM admin_inbox_claims "
            "WHERE (kind, ref) IN (SELECT * FROM unnest($1::text[], $2::text[]))",
            [i["kind"] for i in items], [i["ref"] for i in items],
        )
    }
    names = await _admin_names(conn, {v for c in claims.values() for v in (c["claimed_by"], c["done_by"]) if v})
    for item in items:
        c = claims.get((item["kind"], item["ref"]))
        # Done, unless it happened again after it was marked done.
        done = c is not None and c["done_at"] is not None and not (item["kind"] == "error" and item["at"] > c["done_at"])
        item["done"] = done or bool(item.pop("resolved", False))
        item["claimed_by"] = (
            {"user_id": c["claimed_by"], "name": names.get(c["claimed_by"], "An admin")} if c and c["claimed_by"] else None
        )
        item["done_by"] = names.get(c["done_by"]) if done and c["done_by"] else None
    items.sort(key=lambda i: i["at"], reverse=True)
    return items


async def claim(conn, kind: str, ref: str, user_id: int | None) -> None:
    """Claim (user_id) or let go (None)."""
    await conn.execute(
        """
        INSERT INTO admin_inbox_claims (kind, ref, claimed_by, claimed_at) VALUES ($1, $2, $3::int, CASE WHEN $3::int IS NULL THEN NULL ELSE now() END)
        ON CONFLICT (kind, ref) DO UPDATE SET claimed_by = EXCLUDED.claimed_by, claimed_at = EXCLUDED.claimed_at
        """,
        kind, ref[:200], user_id,
    )


async def set_done(conn, kind: str, ref: str, user_id: int, done: bool) -> None:
    """Done also claims it for whoever finished it, when nobody had."""
    await conn.execute(
        """
        INSERT INTO admin_inbox_claims (kind, ref, claimed_by, claimed_at, done_by, done_at)
        VALUES ($1, $2, $3::int, now(), CASE WHEN $4 THEN $3::int END, CASE WHEN $4 THEN now() END)
        ON CONFLICT (kind, ref) DO UPDATE SET
            claimed_by = COALESCE(admin_inbox_claims.claimed_by, EXCLUDED.claimed_by),
            claimed_at = COALESCE(admin_inbox_claims.claimed_at, EXCLUDED.claimed_at),
            done_by = EXCLUDED.done_by, done_at = EXCLUDED.done_at
        """,
        kind, ref[:200], user_id, done,
    )
