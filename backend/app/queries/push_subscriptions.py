"""
Push subscription storage — one row per browser/device an owner has
enabled push on. See migration 6a96fdae6d6c for the table shape and
why endpoint (not owner_id) is the unique key.
"""


async def upsert_subscription(conn, owner_id: int, endpoint: str, p256dh: str, auth: str, device_label: str | None):
    """Re-subscribing the same browser (same endpoint) — e.g. after
    toggling permission off and back on — updates the existing row in
    place (including reviving it if it had been deactivated) rather
    than creating a duplicate. If the endpoint previously belonged to a
    different owner (a shared/reused browser profile), it's reassigned
    to whoever is subscribing now — a stale mapping to the old owner
    would be strictly worse than the current, real one."""
    return await conn.fetchrow(
        """
        INSERT INTO push_subscriptions (owner_id, endpoint, p256dh, auth, device_label, active, updated_at)
        VALUES ($1, $2, $3, $4, $5, TRUE, now())
        ON CONFLICT (endpoint) DO UPDATE SET
            owner_id = EXCLUDED.owner_id,
            p256dh = EXCLUDED.p256dh,
            auth = EXCLUDED.auth,
            device_label = EXCLUDED.device_label,
            active = TRUE,
            updated_at = now()
        RETURNING id, owner_id, endpoint, device_label, active, created_at
        """,
        owner_id, endpoint, p256dh, auth, device_label,
    )


async def deactivate_subscription(conn, owner_id: int, endpoint: str) -> bool:
    """Scoped to the requesting owner's own endpoint — an owner can
    never deactivate someone else's subscription by guessing/reusing an
    endpoint string. Returns whether a row was actually found+updated
    (the caller 404s if not, rather than silently succeeding on a
    subscription that was never theirs)."""
    result = await conn.execute(
        "UPDATE push_subscriptions SET active = FALSE, updated_at = now() WHERE owner_id = $1 AND endpoint = $2",
        owner_id, endpoint,
    )
    return result.endswith(" 1")


async def list_active_subscriptions_for_owner(conn, owner_id: int):
    return await conn.fetch(
        "SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE owner_id = $1 AND active",
        owner_id,
    )


async def list_active_subscriptions_for_owners(conn, owner_ids: list[int]):
    """Batched variant for the notification dispatcher — one query per
    fan-out event (e.g. "everyone who owns this player"), not one query
    per owner."""
    if not owner_ids:
        return []
    return await conn.fetch(
        "SELECT id, owner_id, endpoint, p256dh, auth FROM push_subscriptions WHERE owner_id = ANY($1::int[]) AND active",
        owner_ids,
    )


async def mark_delivery_success(conn, subscription_id: int):
    await conn.execute(
        "UPDATE push_subscriptions SET last_successful_delivery_at = now() WHERE id = $1",
        subscription_id,
    )


async def mark_delivery_failed(conn, subscription_id: int, *, permanent: bool):
    """permanent=True for a push provider telling us the endpoint is
    gone for good (410 Gone / 404) — deactivates it so the dispatcher
    stops retrying a subscription that can never succeed again. A
    transient failure (network blip, 5xx) just records the failure
    timestamp and keeps trying next time."""
    if permanent:
        await conn.execute(
            "UPDATE push_subscriptions SET active = FALSE, last_failure_at = now() WHERE id = $1",
            subscription_id,
        )
    else:
        await conn.execute(
            "UPDATE push_subscriptions SET last_failure_at = now() WHERE id = $1",
            subscription_id,
        )
