"""Native screen-view taxonomy — the route=null + platform=native branch
added to POST /admin/track and app/analytics/taxonomy.py's SCREEN_NAMES.
Pure taxonomy behavior is covered by test_analytics_taxonomy.py's
existing unit tests (validate_event now accepts SCREEN_NAMES too, and
every existing assertion there still passes unmodified); this file
covers the route-based business rule that only track_event's own
handler enforces (route required for NAV_EVENT_NAMES vs. explicitly
null + native platform for SCREEN_NAMES)."""
from httpx import ASGITransport, AsyncClient

from app.analytics import taxonomy
from app.auth.session import create_session_token
from app.main import app
from tests.conftest import make_safe_session_user_id_for_owner

_SESSION_SECRET = "test-secret-thats-at-least-32-bytes-long"


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _session_cookie(pool, owner_id: int):
    # _for_owner — resolve_owner_id does a live DB lookup, not a trust of
    # the JWT's own owner_id claim (see test_native_push_registration.py's
    # _session_cookie for the same note).
    token = create_session_token(
        _SESSION_SECRET, user_id=await make_safe_session_user_id_for_owner(pool, owner_id), owner_id=owner_id,
        discord_user_id=400000 + owner_id, is_commissioner=False,
    )
    return {"session": token}


async def _seed_owner(pool, suffix):
    async with pool.acquire() as conn:
        return await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            f"test-screen-taxonomy-owner-{suffix}", f"Owner {suffix}",
        )


def _screen_view_body(screen_name: str, platform: str | None = "ios", session_id: str = "sess-1"):
    return {
        "session_id": session_id,
        "event_name": screen_name,
        "event_type": "page_view",
        "route": None,
        "platform": platform,
    }


async def test_a_valid_native_screen_view_is_accepted(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_id = await _seed_owner(pool, 1)
    screen_name = next(iter(taxonomy.SCREEN_NAMES))

    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, owner_id))
        resp = await client.post("/admin/track", json=_screen_view_body(screen_name))

    assert resp.status_code == 200


async def test_a_route_null_page_view_with_web_platform_is_rejected(pool, monkeypatch):
    """route: null is only meaningful for a genuinely native screen —
    "web" has no such thing as a screen with no route."""
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_id = await _seed_owner(pool, 2)
    screen_name = next(iter(taxonomy.SCREEN_NAMES))

    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, owner_id))
        resp = await client.post("/admin/track", json=_screen_view_body(screen_name, platform="web"))

    assert resp.status_code == 400


async def test_a_route_null_page_view_with_no_platform_is_rejected(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_id = await _seed_owner(pool, 3)
    screen_name = next(iter(taxonomy.SCREEN_NAMES))

    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, owner_id))
        resp = await client.post("/admin/track", json=_screen_view_body(screen_name, platform=None))

    assert resp.status_code == 400


async def test_a_route_null_page_view_with_an_unknown_screen_name_is_rejected(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_id = await _seed_owner(pool, 4)

    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, owner_id))
        resp = await client.post("/admin/track", json=_screen_view_body("not_a_real_screen"))

    assert resp.status_code == 400


async def test_existing_route_based_page_view_is_completely_unaffected(pool, monkeypatch):
    """Regression guard for the web/Capacitor-WebView path — a real
    route present alongside a native platform value (today's actual
    Capacitor apps: same JS, still a real route) keeps validating
    against NAV_EVENT_NAMES exactly as before, never SCREEN_NAMES."""
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_id = await _seed_owner(pool, 5)

    async with _client() as client:
        client.cookies.update(await _session_cookie(pool, owner_id))
        resp = await client.post(
            "/admin/track",
            json={
                "session_id": "sess-2",
                "event_name": "nav_standings",
                "event_type": "page_view",
                "route": "/standings",
                "platform": "ios",
            },
        )

    assert resp.status_code == 200
