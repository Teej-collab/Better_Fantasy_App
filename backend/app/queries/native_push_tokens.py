"""
Native (APNs/FCM) push token storage — the additive counterpart to
app/queries/push_subscriptions.py (Web Push/VAPID). See migration
796e33a7e4dd for the table shape and why it has two unique constraints
instead of one.
"""


async def upsert_registration(
    conn, owner_id: int, device_id: str, platform: str, push_token: str,
    app_version: str | None, os_version: str | None,
):
    """Re-registering the same device (same device_id) — e.g. the OS
    issued a new token on app-foreground — updates the existing row in
    place (including reviving it if it had been deactivated) rather
    than creating a duplicate; this is how token rotation and "one row
    per device" both work. If push_token previously belonged to a
    DIFFERENT (owner_id, device_id) — the OS handed an identical opaque
    token to a reinstalled app now logged into a different account —
    that stale row is deactivated first, the same reassignment
    reasoning push_subscriptions.upsert_subscription already applies to
    a reused endpoint. Two separate statements because one INSERT can
    only target one ON CONFLICT constraint, and (owner_id, device_id)
    has to be the upsert target (not push_token) so rotation updates
    the SAME row rather than churning a new one every time the OS
    reissues a token."""
    await conn.execute(
        """
        UPDATE native_push_tokens SET active = FALSE, updated_at = now()
        WHERE push_token = $1 AND NOT (owner_id = $2 AND device_id = $3)
        """,
        push_token, owner_id, device_id,
    )
    return await conn.fetchrow(
        """
        INSERT INTO native_push_tokens
            (owner_id, device_id, platform, push_token, app_version, os_version, active, updated_at, last_seen_at)
        VALUES ($1, $2, $3, $4, $5, $6, TRUE, now(), now())
        ON CONFLICT (owner_id, device_id) DO UPDATE SET
            platform = EXCLUDED.platform,
            push_token = EXCLUDED.push_token,
            app_version = EXCLUDED.app_version,
            os_version = EXCLUDED.os_version,
            active = TRUE,
            updated_at = now(),
            last_seen_at = now()
        RETURNING id, owner_id, device_id, platform, active, created_at
        """,
        owner_id, device_id, platform, push_token, app_version, os_version,
    )


async def deactivate_registration(conn, owner_id: int, device_id: str) -> bool:
    """Scoped to the requesting owner's own device_id — an owner can
    never deactivate someone else's registration by guessing/reusing a
    device_id. Returns whether a row was actually found+updated (the
    caller 404s if not, rather than silently succeeding on a device
    that was never theirs)."""
    result = await conn.execute(
        "UPDATE native_push_tokens SET active = FALSE, updated_at = now() WHERE owner_id = $1 AND device_id = $2",
        owner_id, device_id,
    )
    return result.endswith(" 1")


async def list_active_registrations_for_owner(conn, owner_id: int):
    return await conn.fetch(
        "SELECT id, platform, push_token FROM native_push_tokens WHERE owner_id = $1 AND active",
        owner_id,
    )


async def list_active_registrations_for_owners(conn, owner_ids: list[int]):
    """Batched variant for the notification dispatcher — one query per
    fan-out event, not one query per owner. Mirrors
    push_subscriptions.list_active_subscriptions_for_owners."""
    if not owner_ids:
        return []
    return await conn.fetch(
        "SELECT id, owner_id, platform, push_token FROM native_push_tokens WHERE owner_id = ANY($1::int[]) AND active",
        owner_ids,
    )


async def has_any_active_registration(conn, owner_id: int) -> bool:
    """For push.py's combined-channel push_enabled check — an owner
    with an active native device must keep the master toggle on even
    after their last web subscription is removed, and vice versa."""
    return bool(
        await conn.fetchval(
            "SELECT 1 FROM native_push_tokens WHERE owner_id = $1 AND active LIMIT 1", owner_id
        )
    )


async def mark_delivery_success(conn, registration_id: int):
    await conn.execute(
        "UPDATE native_push_tokens SET last_successful_delivery_at = now() WHERE id = $1",
        registration_id,
    )


async def mark_delivery_failed(conn, registration_id: int, *, permanent: bool):
    """permanent=True for a provider telling us the token is gone for
    good (APNs BadDeviceToken/Unregistered/DeviceTokenNotForTopic, FCM
    UNREGISTERED/INVALID_ARGUMENT) — deactivates it so the dispatcher
    stops retrying a token that can never succeed again. A transient
    failure (rate limit, 5xx, network error) just records the failure
    timestamp and keeps trying next time. Mirrors
    push_subscriptions.mark_delivery_failed exactly."""
    if permanent:
        await conn.execute(
            "UPDATE native_push_tokens SET active = FALSE, last_failure_at = now() WHERE id = $1",
            registration_id,
        )
    else:
        await conn.execute(
            "UPDATE native_push_tokens SET last_failure_at = now() WHERE id = $1",
            registration_id,
        )
