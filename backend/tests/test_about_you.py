"""The About you step (2026-11-10): a birthday that keeps under-13s
out for good, and a gender the AI writers use (app/domain/pronouns.py)."""
import uuid
from datetime import date

from httpx import ASGITransport, AsyncClient

from app.domain import pronouns
from app.main import app


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _sign_up(client: AsyncClient) -> None:
    email = f"test-about-you-{uuid.uuid4().hex[:8]}@example.com"
    resp = await client.post("/auth/signup", json={"email": email, "password": "correct-horse", "display_name": "About Tester"})
    assert resp.status_code == 200


def _birthday(years_ago: int) -> str:
    today = date.today()
    return today.replace(year=today.year - years_ago).isoformat()


async def test_a_new_account_answers_once_then_can_change_gender(pool):
    async with _client() as client:
        await _sign_up(client)
        assert (await client.get("/auth/me")).json()["about_you_needed"] is True

        # Gender alone isn't enough the first time.
        assert (await client.put("/auth/about-you", json={"gender": "female"})).status_code == 422

        resp = await client.put("/auth/about-you", json={"birthdate": _birthday(30), "gender": "female"})
        assert resp.status_code == 200, resp.text
        me = (await client.get("/auth/me")).json()
        assert me["about_you_needed"] is False and me["gender"] == "female"

        # Later, from Settings: Prefer not to say.
        assert (await client.put("/auth/about-you", json={"gender": None})).status_code == 200
        assert (await client.get("/auth/me")).json()["gender"] is None


async def test_under_13_locks_the_account_for_good(pool):
    async with _client() as client:
        await _sign_up(client)
        resp = await client.put("/auth/about-you", json={"birthdate": _birthday(12), "gender": None})
        assert resp.status_code == 403 and resp.json()["detail"] == "under_13"

        # A second try with an older birthday doesn't get back in.
        retry = await client.put("/auth/about-you", json={"birthdate": _birthday(30), "gender": None})
        assert retry.status_code == 403
        assert (await client.get("/auth/me")).status_code == 403


async def test_bad_answers_are_turned_away(pool):
    async with _client() as client:
        await _sign_up(client)
        assert (await client.put("/auth/about-you", json={"birthdate": "not-a-date"})).status_code == 422
        assert (await client.put("/auth/about-you", json={"birthdate": _birthday(30), "gender": "other"})).status_code == 422
        tomorrow = date.today().replace(year=date.today().year + 1).isoformat()
        assert (await client.put("/auth/about-you", json={"birthdate": tomorrow})).status_code == 422


def test_people_line_lists_only_those_who_answered():
    names = {1: "Kim", 2: "Eric", 3: "Shirley"}
    assert pronouns.people_line(names, {1: "female", 2: "male"}) == "PEOPLE: Kim she/her; Eric he/him"
    assert pronouns.people_line(names, {}) == ""
