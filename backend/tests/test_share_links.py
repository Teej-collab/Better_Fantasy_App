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


# ---- the second pass (2026-11-11) ----------------------------------------


async def _two_teams(pool, league_id: int) -> tuple[list[int], list[int]]:
    """(owner_ids, team_ids) for Kim and Eric in this league."""
    owners, teams = [], []
    async with pool.acquire() as conn:
        for i, name in enumerate(["Kim Smith", "Eric Jones"], 1):
            owner_id = await conn.fetchval(
                "INSERT INTO owners (espn_member_id, display_name, discord_user_id) VALUES ($1, $2, $3) RETURNING owner_id",
                f"test-share-owner-{uuid.uuid4().hex[:8]}", name, 990000000000 + int(uuid.uuid4().int % 1000000),
            )
            team_id = await conn.fetchval(
                "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name, league_id) VALUES ($1, $2, $3, $4, $5) RETURNING id",
                TEST_SEASON, 870000 + i, owner_id, f"{name.split()[0]} FC", league_id,
            )
            owners.append(owner_id)
            teams.append(team_id)
    return owners, teams


async def test_second_pass_cards_build_from_the_leagues_data(pool):
    async with _client() as client:
        league_id = await _member_of_a_new_league(client)
        (kim, eric), (kim_team, eric_team) = await _two_teams(pool, league_id)
        async with pool.acquire() as conn:
            await conn.execute("INSERT INTO season_champions (season, owner_id, team_name, league_id) VALUES ($1, $2, 'Kim FC', $3)", TEST_SEASON, kim, league_id)
            await conn.execute(
                "INSERT INTO season_awards (season, owner_id, award_type, detail, league_id) VALUES ($1, $2, 'Boom Week', '151.8 pts', $4), ($1, $3, 'Bust Week', '61.2 pts', $4)",
                TEST_SEASON, kim, eric, league_id,
            )
            await conn.execute(
                "INSERT INTO season_punishments (league_id, season, text, landed_index, items_snapshot) VALUES ($1, $2, 'Wear a jersey', 0, '[\"a\", \"b\"]'::jsonb)",
                league_id, TEST_SEASON,
            )
            discord = await conn.fetchval("SELECT discord_user_id FROM owners WHERE owner_id = $1", kim)
            chug_id = await conn.fetchval(
                "INSERT INTO chug_scores (discord_user_id, chug_time_seconds, final_score, season, week, league_id, roast, hype_detail) "
                "VALUES ($1, 4.6, 8.7, $2, 3, $3, 'Fast.', '{\"comedy\": 2, \"quote\": \"cheers\"}'::jsonb) RETURNING id",
                discord, TEST_SEASON, league_id,
            )
            trade_id = await conn.fetchval(
                "INSERT INTO trades (league_id, season, proposing_team_id, receiving_team_id, status, accepted_at) VALUES ($1, $2, $3, $4, 'accepted', now()) RETURNING id",
                league_id, TEST_SEASON, kim_team, eric_team,
            )

        for ref in (
            {"kind": "champion", "season": TEST_SEASON},
            {"kind": "season_awards", "season": TEST_SEASON},
            {"kind": "wheel", "season": TEST_SEASON},
            {"kind": "chug", "chug_id": chug_id},
            {"kind": "trade", "trade_id": trade_id},
            {"kind": "invite"},
        ):
            resp = await client.post("/share", json=ref)
            assert resp.status_code == 200, (ref, resp.text)
            card = (await client.get(f"/share/{resp.json()['token']}")).json()["card"]
            if ref["kind"] == "champion":
                assert card["name"] == "Kim" and card["titles"] == 1
            if ref["kind"] == "season_awards":
                assert [a["tone"] for a in card["awards"]] == ["glory", "shame"]
            if ref["kind"] == "wheel":
                assert card["text"] == "Wear a jersey" and card["slices"] == 2
            if ref["kind"] == "chug":
                assert card["name"] == "Kim" and card["score"] == 8.7 and card["quote"] == "cheers"
            if ref["kind"] == "trade":
                assert [s["name"] for s in card["sides"]] == ["Kim", "Eric"]
            if ref["kind"] == "invite":
                assert card["invite_code"]


async def test_only_the_bettor_shares_a_bet(pool):
    async with _client() as bettor, _client() as other:
        league_id = await _member_of_a_new_league(bettor)
        await _member_of_a_new_league(other)
        me = (await bettor.get("/auth/me")).json()
        async with pool.acquire() as conn:
            bet_id = await conn.fetchval(
                "INSERT INTO bets (user_id, league_id, stake_cents, odds_american, payout_cents, status, source) VALUES ($1, $2, 2000, 1130, 24600, 'open', 'manual') RETURNING id",
                me["user_id"], league_id,
            )
            await conn.execute(
                "INSERT INTO bet_legs (bet_id, position, description, market) VALUES ($1, 1, 'Justin Jefferson 90+ rec yds', 'player_prop')", bet_id
            )
        resp = await bettor.post("/share", json={"kind": "bet", "bet_id": bet_id})
        assert resp.status_code == 200, resp.text
        card = (await bettor.get(f"/share/{resp.json()['token']}")).json()["card"]
        assert card["stake"] == 20 and card["legs"][0]["text"] == "Justin Jefferson 90+ rec yds"
        assert (await other.post("/share", json={"kind": "bet", "bet_id": bet_id})).status_code == 404
