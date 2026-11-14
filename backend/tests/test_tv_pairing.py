"""The Weekend TV pairing (2026-11-14): a TV gets a code, a member
approves it, the TV redeems once, and its session can only watch."""
import uuid

from httpx import ASGITransport, AsyncClient

from app.auth.rate_limit import reset_for_tests
from app.auth.tv_session import tv_request_allowed
from app.main import app
from app.routers.tv import new_pairing_code, normalize_code


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _signed_in(client: AsyncClient) -> None:
    email = f"test-tv-{uuid.uuid4().hex[:8]}@example.com"
    resp = await client.post("/auth/signup", json={"email": email, "password": "correct-horse", "display_name": "Kim TV"})
    assert resp.status_code == 200, resp.text


def test_codes_skip_lookalike_characters():
    for _ in range(200):
        code = new_pairing_code()
        assert len(code) == 8
        assert not set(code) & set("01IO")


def test_typed_codes_forgive_case_and_dashes():
    assert normalize_code("k7qm-4xpr") == "K7QM4XPR"
    assert normalize_code(" K7QM 4XPR ") == "K7QM4XPR"


def test_a_tv_can_only_watch():
    assert tv_request_allowed("GET", "/me/week")
    assert tv_request_allowed("POST", "/tv/refresh")
    assert not tv_request_allowed("POST", "/me/team/lineup")
    assert not tv_request_allowed("DELETE", "/tv/devices/3")
    assert not tv_request_allowed("GET", "/tv/devices")
    assert not tv_request_allowed("GET", "/admin/overview")


async def test_pair_redeem_once_then_disconnect(pool):
    reset_for_tests()
    async with _client() as tv, _client() as phone:
        start = (await tv.post("/tv/pair/start", json={"device_name": "Living room TV"})).json()
        device_code = start["device_code"]

        assert (await tv.post("/tv/pair/token", json={"device_code": device_code})).json() == {"status": "pending"}

        await _signed_in(phone)
        code = start["code"]
        resp = await phone.post("/tv/pair/approve", json={"code": f"{code[:4].lower()}-{code[4:]}"})
        assert resp.status_code == 200, resp.text
        assert resp.json()["device_name"] == "Living room TV"

        resp = await tv.post("/tv/pair/token", json={"device_code": device_code})
        assert resp.json()["status"] == "ok"
        token = resp.json()["token"]
        device_id = resp.json()["device_id"]

        # One-time: the same device_code can't mint a second session.
        assert (await tv.post("/tv/pair/token", json={"device_code": device_code})).status_code == 404

        headers = {"Authorization": f"Bearer {token}"}
        me = await tv.get("/tv/me", headers=headers)
        assert me.status_code == 200 and me.json()["name"] == "Living room TV"
        assert (await tv.post("/leagues", headers=headers, json={"name": "x"})).status_code == 403
        assert (await tv.get("/tv/devices", headers=headers)).status_code == 403
        assert (await tv.post("/tv/refresh", headers=headers)).status_code == 200

        listed = (await phone.get("/tv/devices")).json()["devices"]
        assert [d["id"] for d in listed] == [device_id]

        assert (await phone.delete(f"/tv/devices/{device_id}")).status_code == 200
        assert (await tv.get("/tv/me", headers=headers)).status_code == 401
        assert (await phone.get("/tv/devices")).json()["devices"] == []


async def test_bad_or_reused_codes_are_refused(pool):
    reset_for_tests()
    async with _client() as tv, _client() as phone:
        await _signed_in(phone)
        assert (await phone.post("/tv/pair/approve", json={"code": "ZZZZZZZZ"})).status_code == 404
        start = (await tv.post("/tv/pair/start", json={"device_name": "TV"})).json()
        assert (await phone.post("/tv/pair/approve", json={"code": start["code"]})).status_code == 200
        # Already approved: a second approval (someone else's guess) fails.
        assert (await phone.post("/tv/pair/approve", json={"code": start["code"]})).status_code == 404


# ---- live events (app/tv_live.py) ----

from app import tv_live  # noqa: E402


def _snap(points=None, matchups=None, tds=None):
    return {"player_points": points or {}, "matchups": matchups or {}, "player_tds": tds or {}}


def test_only_leagues_whose_numbers_moved_hear_about_it():
    before = _snap(
        points={(1, "p1"): 4.0, (2, "p1"): 5.0},
        matchups={10: {"league_id": 3, "home_score": 50.0, "away_score": 40.0}},
    )
    after = _snap(
        points={(1, "p1"): 10.0, (2, "p1"): 5.0},
        matchups={10: {"league_id": 3, "home_score": 56.0, "away_score": 40.0}},
    )
    assert tv_live.changed_leagues(before, after) == {1, 3}


async def test_scores_go_only_to_that_leagues_tvs():
    mine = tv_live.subscribe(1)
    other = tv_live.subscribe(2)
    try:
        before = _snap(points={(1, "p1"): 4.0})
        after = _snap(points={(1, "p1"): 10.0})
        await tv_live.publish(None, 1900, before, after)  # no touchdowns, so no DB needed
        assert mine.get_nowait() == {"type": "scores"}
        assert other.empty()
    finally:
        tv_live.unsubscribe(1, mine)
        tv_live.unsubscribe(2, other)
    assert tv_live.connection_count() == 0


async def test_only_a_tv_can_open_the_live_line(pool):
    reset_for_tests()
    async with _client() as phone:
        await _signed_in(phone)
        assert (await phone.get("/tv/live")).status_code == 403
