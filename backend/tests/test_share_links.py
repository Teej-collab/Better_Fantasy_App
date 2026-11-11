"""Public share links (2026-11-10): a member makes one, anyone opens it,
and the card only carries what's drawn on it (app/domain/share_cards.py)."""
import uuid

from httpx import ASGITransport, AsyncClient

from app.domain import share_cards
from app.main import app
from tests.conftest import TEST_SEASON


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _member_of_a_new_league(client: AsyncClient) -> int:
    email = f"test-share-{uuid.uuid4().hex[:8]}@example.com"
    resp = await client.post("/auth/signup", json={"email": email, "password": "correct-horse", "display_name": "Kim Share"})
    assert resp.status_code == 200
    resp = await client.post(
        "/leagues",
        json={"name": "Test League Share", "league_type": "redraft", "matchup_type": "h2h", "make_active": True},
    )
    assert resp.status_code == 200, resp.text
    return (await client.get("/auth/me")).json()["active_league_id"]


def test_stat_line_reads_like_a_box_score():
    assert share_cards.stat_line({"rec": 9, "rec_yd": 148, "rec_td": 2}, "WR") == "9 rec · 148 yds · 2 TD"
    assert share_cards.stat_line({"pass_yd": 312, "pass_td": 3, "pass_int": 1}, "QB") == "312 pass yds · 3 TD · 1 INT"
    assert share_cards.stat_line({}, "RB") is None


def test_headline_is_the_recaps_first_sentence():
    assert share_cards.headline("Reggie benched 31 points. Then it got worse.") == "Reggie benched 31 points."
    assert share_cards.headline("x " * 200).endswith("…")


async def _seed_teams(pool, league_id: int) -> None:
    async with pool.acquire() as conn:
        for i, (name, team) in enumerate([("Kim Smith", "Cleat Chasers"), ("Eric Jones", "Fourth & Long")], 1):
            owner_id = await conn.fetchval(
                "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
                f"test-share-owner-{uuid.uuid4().hex[:8]}", name,
            )
            await conn.execute(
                "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name, league_id) VALUES ($1, $2, $3, $4, $5)",
                TEST_SEASON, 880000 + i, owner_id, team, league_id,
            )


async def test_a_member_shares_standings_and_anyone_can_open_it(pool):
    async with _client() as client:
        league_id = await _member_of_a_new_league(client)
        await _seed_teams(pool, league_id)
        resp = await client.post("/share", json={"kind": "standings", "season": TEST_SEASON})
        assert resp.status_code == 200, resp.text
        token = resp.json()["token"]
        # Sharing again hands back the same link.
        again = await client.post("/share", json={"kind": "standings", "season": TEST_SEASON})
        assert again.json()["token"] == token

    async with _client() as stranger:
        resp = await stranger.get(f"/share/{token}")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["kind"] == "standings" and body["league_name"] == "Test League Share"
        assert {t["name"] for t in body["card"]["teams"]} == {"Kim", "Eric"}
        # First names and team names only: no ids, emails or owner records.
        assert set(body["card"]["teams"][0]) == {"seed", "name", "team_name", "record", "points_for"}


async def test_share_links_need_a_member_and_a_real_link(pool):
    async with _client() as client:
        assert (await client.post("/share", json={"kind": "standings", "season": 2026})).status_code == 401
        assert (await client.get("/share/not-a-real-token")).status_code == 404
        await _member_of_a_new_league(client)
        assert (await client.post("/share", json={"kind": "nope"})).status_code == 422
        assert (await client.post("/share", json={"kind": "recap", "season": 2026})).status_code == 422
