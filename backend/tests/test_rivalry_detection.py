"""Tests for app/domain/rivalry_detection.py and the commissioner's
suggestion endpoints (app/routers/rivalry_suggestions.py)."""
import itertools

from httpx import ASGITransport, AsyncClient

from app.domain import rivalry_detection
from app.domain.rivalry_detection import SUGGEST_AT, score_pair, tier_for
from app.main import app
from tests.conftest import TEST_SEASON


def _game(a, b, season=2024, playoff=False, championship=False):
    return {"season": season, "a_score": a, "b_score": b, "is_playoff": playoff, "is_championship": championship}


def test_too_few_games_is_not_a_rivalry_unless_they_met_in_the_playoffs():
    assert score_pair([_game(100, 90)] * 3, 0, "A", "B") is None
    assert score_pair([_game(100, 90, playoff=True)], 0, "A", "B") is not None


def test_close_even_series_with_a_title_game_outscores_a_lopsided_one():
    feud = [_game(100, 95), _game(90, 96), _game(110, 104), _game(88, 92), _game(120, 115), _game(101, 99, playoff=True)]
    feud.append(_game(130, 126, season=2025, playoff=True, championship=True))
    lopsided = [_game(140, 80)] * 7
    feud_score, feud_reasons = score_pair(feud, 2, "Jeff", "Ryan")
    lopsided_score, _ = score_pair(lopsided, 0, "Jeff", "Ryan")
    assert feud_score > SUGGEST_AT > lopsided_score
    assert "Met in the 2025 championship (Jeff won)" in feud_reasons
    assert "1 other playoff meeting" in feud_reasons
    assert "2 trades with each other" in feud_reasons
    assert feud_reasons[0] == "7 games all-time, Jeff leads 5-2"


def test_lead_changes_are_counted_and_ties_dont_flip_the_lead():
    games = [_game(100, 90), _game(90, 100), _game(90, 100), _game(100, 100), _game(100, 90), _game(100, 90)]
    _, reasons = score_pair(games, 0, "A", "B")
    assert "The series lead has changed hands 2 times" in reasons


def test_tiers():
    assert tier_for(80) == "Legendary"
    assert tier_for(65) == "Historic"
    assert tier_for(46) == "Developing"


def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


_espn_ids = itertools.count(930001)


async def _seed_league_history(pool, league_id):
    """Three owners. Feud vs Rival: eight close, even games plus a title
    game. Feud vs Bystander: four blowouts."""
    async with pool.acquire() as conn:
        owners, teams = {}, {}
        for name in ("Feud", "Rival", "Bystander"):
            owners[name] = await conn.fetchval(
                "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
                f"test-rivalry-{name}-{league_id}", name,
            )
            teams[name] = await conn.fetchval(
                "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name, league_id) "
                "VALUES ($1, $2, $3, $4, $5) RETURNING id",
                TEST_SEASON, next(_espn_ids), owners[name], f"Team {name}", league_id,
            )

        async def game(week, home, away, hs, as_, playoff=False):
            await conn.execute(
                "INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff, league_id) "
                "VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
                TEST_SEASON, week, teams[home], teams[away], hs, as_, playoff, league_id,
            )

        for week in range(1, 9):
            winner_home = week % 2 == 0
            await game(week, "Feud", "Rival", 105 if winner_home else 98, 100)
        for week in range(9, 13):
            await game(week, "Feud", "Bystander", 150, 70)
        await game(16, "Feud", "Rival", 120, 118, playoff=True)
        await conn.execute(
            "INSERT INTO season_champions (season, owner_id, team_name, league_id) VALUES ($1, $2, 'Team Feud', $3)",
            TEST_SEASON, owners["Feud"], league_id,
        )
    return owners


async def _commissioner_league(client, email):
    resp = await client.post("/auth/signup", json={"email": email, "password": "correct-horse", "display_name": "Commish"})
    assert resp.status_code == 200
    created = await client.post("/leagues", json={"name": f"Test League {email}"})
    return created.json()["id"], created.json()["invite_code"]


async def test_commissioner_reviews_suggestions_and_approves_one(pool, monkeypatch):
    monkeypatch.setattr(rivalry_detection.config, "ANTHROPIC_API_KEY", None)
    async with _client() as client:
        league_id, _ = await _commissioner_league(client, "test-rivalry-approve@example.com")
        owners = await _seed_league_history(pool, league_id)

        listed = await client.get(f"/leagues/{league_id}/rivalry-suggestions")
        assert listed.status_code == 200
        suggestions = listed.json()["suggestions"]
        assert len(suggestions) == 1  # the blowout series doesn't qualify
        s = suggestions[0]
        assert {s["owner_a_id"], s["owner_b_id"]} == {owners["Feud"], owners["Rival"]}
        assert s["suggested_name"] == f"{s['owner_a_name']} vs {s['owner_b_name']}"
        assert f"Met in the {TEST_SEASON} championship (Feud won)" in s["reasons"]

        async with pool.acquire() as conn:
            hub_count = await rivalry_detection.count_pending(conn, league_id)
        assert hub_count == 1

        approved = await client.post(
            f"/leagues/{league_id}/rivalry-suggestions/{s['id']}/approve",
            json={"name": "The Grudge Match", "tagline": "Eight games, nobody blinks."},
        )
        assert approved.status_code == 200
        assert approved.json()["rivalry"]["name"] == "The Grudge Match"

        # It's a real rivalry now, and never suggested again.
        assert (await client.get(f"/leagues/{league_id}/rivalry-suggestions")).json()["suggestions"] == []
        again = await client.post(
            f"/leagues/{league_id}/rivalry-suggestions/{s['id']}/approve", json={"name": "Twice"}
        )
        assert again.status_code == 404

    async with pool.acquire() as conn:
        rivalry = await conn.fetchrow("SELECT * FROM rivalries WHERE league_id = $1", league_id)
    assert rivalry["tagline"] == "Eight games, nobody blinks."
    assert rivalry["tier"] == s["tier"]


async def test_dismissed_suggestions_stay_dismissed(pool, monkeypatch):
    monkeypatch.setattr(rivalry_detection.config, "ANTHROPIC_API_KEY", None)
    async with _client() as client:
        league_id, _ = await _commissioner_league(client, "test-rivalry-dismiss@example.com")
        await _seed_league_history(pool, league_id)
        s = (await client.get(f"/leagues/{league_id}/rivalry-suggestions")).json()["suggestions"][0]
        resp = await client.post(f"/leagues/{league_id}/rivalry-suggestions/{s['id']}/dismiss")
        assert resp.status_code == 200
        assert (await client.get(f"/leagues/{league_id}/rivalry-suggestions")).json()["suggestions"] == []


async def test_only_the_commissioner_sees_suggestions(pool):
    async with _client() as commish:
        league_id, invite_code = await _commissioner_league(commish, "test-rivalry-owner@example.com")
    async with _client() as member:
        await member.post(
            "/auth/signup", json={"email": "test-rivalry-member@example.com", "password": "correct-horse", "display_name": "M"}
        )
        await member.post("/leagues/join", json={"invite_code": invite_code})
        assert (await member.get(f"/leagues/{league_id}/rivalry-suggestions")).status_code == 403


async def test_the_same_two_people_can_be_rivals_in_two_leagues(pool, monkeypatch):
    """Rivalries are per league (2026-10-28, migration c8e0a2d4f6b9): a
    pair already rivals in one league can still be approved in another."""
    monkeypatch.setattr(rivalry_detection.config, "ANTHROPIC_API_KEY", None)
    async with _client() as other:
        other_league_id, _ = await _commissioner_league(other, "test-rivalry-elsewhere@example.com")
    async with _client() as client:
        league_id, _ = await _commissioner_league(client, "test-rivalry-twoleagues@example.com")
        owners = await _seed_league_history(pool, league_id)
        async with pool.acquire() as conn:
            await conn.execute(
                "INSERT INTO rivalries (owner_a_id, owner_b_id, name, tier, league_id) VALUES ($1, $2, 'Old Feud', 'Historic', $3)",
                owners["Feud"], owners["Rival"], other_league_id,
            )
        s = (await client.get(f"/leagues/{league_id}/rivalry-suggestions")).json()["suggestions"][0]
        approved = await client.post(
            f"/leagues/{league_id}/rivalry-suggestions/{s['id']}/approve", json={"name": "Round Two"}
        )
    assert approved.status_code == 200
    async with pool.acquire() as conn:
        assert await conn.fetchval("SELECT count(*) FROM rivalries WHERE owner_a_id = ANY($1::int[])", [owners["Feud"], owners["Rival"]]) == 2
