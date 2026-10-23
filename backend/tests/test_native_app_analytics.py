"""The Expo app's analytics (mobile/src/lib/analytics.ts): the exact
payloads it sends to POST /admin/track, authenticated with a Bearer
token rather than the web's cookie. Each native screen is logged under
the web route it matches, so these are ordinary route-based events
with platform=ios."""
from httpx import ASGITransport, AsyncClient

from app.auth.session import create_session_token
from app.main import app
from tests.conftest import make_safe_session_user_id_for_owner

_SESSION_SECRET = "test-secret-thats-at-least-32-bytes-long"


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _bearer(pool, owner_id: int) -> dict:
    token = create_session_token(
        _SESSION_SECRET, user_id=await make_safe_session_user_id_for_owner(pool, owner_id), owner_id=owner_id,
    )
    return {"Authorization": f"Bearer {token}"}


async def _seed_owner(pool, suffix):
    async with pool.acquire() as conn:
        return await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            f"test-native-analytics-owner-{suffix}", f"Owner {suffix}",
        )


async def test_native_page_view_under_its_web_route_is_accepted(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_id = await _seed_owner(pool, 1)
    async with _client() as client:
        resp = await client.post(
            "/admin/track",
            headers=await _bearer(pool, owner_id),
            json={
                "session_id": "test-native-sess-1",
                "event_name": "nav_matchups",
                "event_type": "page_view",
                "route": "/matchups/12",
                "device_type": "mobile",
                "platform": "ios",
            },
        )
    assert resp.status_code == 200


async def test_native_gamecast_feature_event_is_accepted(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    owner_id = await _seed_owner(pool, 2)
    async with _client() as client:
        resp = await client.post(
            "/admin/track",
            headers=await _bearer(pool, owner_id),
            json={
                "session_id": "test-native-sess-2",
                "event_name": "gamecast_game_selected",
                "event_type": "feature",
                "metadata": {"game_id": "401772510"},
                "device_type": "mobile",
                "platform": "ios",
            },
        )
    assert resp.status_code == 200


async def test_taps_are_tracked_and_reported_by_target_and_person(pool, monkeypatch):
    from app.queries import admin_analytics

    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    a = await _seed_owner(pool, "tap-a")
    b = await _seed_owner(pool, "tap-b")

    async def tap(owner_id, target, screen="/matchups/12"):
        async with _client() as client:
            return await client.post(
                "/admin/track",
                headers=await _bearer(pool, owner_id),
                json={
                    "session_id": f"test-native-tap-{owner_id}",
                    "event_name": "tap",
                    "event_type": "feature",
                    "metadata": {"target": target, "screen": screen},
                    "device_type": "mobile",
                    "platform": "ios",
                },
            )

    assert (await tap(a, "matchup.pregame_open")).status_code == 200
    assert (await tap(a, "matchup.pregame_open")).status_code == 200
    assert (await tap(b, "matchup.pregame_open")).status_code == 200
    assert (await tap(b, "league_hub.scoring", "/league")).status_code == 200
    # A target is an id from the code, never free text.
    assert (await tap(a, "Hello there!")).status_code == 400
    assert (await tap(a, "x" * 80)).status_code == 400

    async with pool.acquire() as conn:
        usage = await admin_analytics.get_tap_usage(conn, 30)
        features = await admin_analytics.get_feature_usage(conn, 30)
    targets = {t["target"]: t for t in usage["targets"]}
    assert targets["matchup.pregame_open"]["taps"] == 3
    assert targets["matchup.pregame_open"]["unique_people"] == 2
    assert targets["matchup.pregame_open"]["people"][0]["owner_id"] == a  # most taps first
    people = {p["owner_id"]: p for p in usage["people"]}
    assert [t["target"] for t in people[b]["top_taps"]] in (
        ["matchup.pregame_open", "league_hub.scoring"],
        ["league_hub.scoring", "matchup.pregame_open"],
    )
    # Taps have their own page, not the curated Features list.
    assert all(f["event_name"] != "tap" for f in features)
