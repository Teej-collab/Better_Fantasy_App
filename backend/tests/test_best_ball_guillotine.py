"""Best ball and guillotine leagues (league formats, 2026-10)."""
import json
import uuid

import pytest

from app.domain import guillotine, waivers
from app.domain.best_ball import best_lineup_points, optimal_lineup
from app.domain.waiver_exceptions import BidError
from app.queries import leagues as leagues_queries
from tests.conftest import TEST_SEASON

STANDARD = {"QB": 1, "RB": 2, "WR": 2, "TE": 1, "RB/WR/TE": 1, "D/ST": 1, "K": 1, "BE": 7, "IR": 1}


def _p(pid, position, value, slot="BE"):
    return {"sleeper_player_id": pid, "position": position, "value": value, "lineup_slot": slot}


# ---- best ball (pure) ------------------------------------------------------


def test_best_lineup_fills_positions_then_flex_with_the_best_left():
    players = [
        _p("qb", "QB", 20), _p("rb1", "RB", 15), _p("rb2", "RB", 12), _p("rb3", "RB", 11),
        _p("wr1", "WR", 18), _p("wr2", "WR", 9), _p("wr3", "WR", 3), _p("te", "TE", 7),
        _p("te2", "TE", 10), _p("k", "K", 8), _p("dst", "DEF", 6),
    ]
    lineup = optimal_lineup(players, STANDARD)
    assert lineup["te2"] == "TE" and lineup["te"] == "BE"
    assert lineup["rb3"] == "RB/WR/TE"  # 11 beats the 9 WR and the 7 TE for the flex
    assert lineup["wr3"] == "BE"
    assert best_lineup_points(players, STANDARD) == 20 + 15 + 12 + 18 + 9 + 10 + 11 + 8 + 6


def test_best_ball_superflex_takes_a_second_qb_and_leaves_ir_alone():
    slots = {**STANDARD, "QB/RB/WR/TE": 1}
    players = [
        _p("qb1", "QB", 25), _p("qb2", "QB", 22), _p("rb1", "RB", 5), _p("rb2", "RB", 4),
        _p("wr1", "WR", 6), _p("wr2", "WR", 5), _p("te", "TE", 3), _p("hurt", "RB", 40, slot="IR"),
    ]
    lineup = optimal_lineup(players, slots)
    assert lineup["qb2"] == "QB/RB/WR/TE"
    assert lineup["hurt"] == "IR"


# ---- guillotine (pure) -----------------------------------------------------


def test_cut_is_lowest_score_then_fewest_season_points():
    assert guillotine.pick_cut({1: 90, 2: 80, 3: 100}, {}) == 2
    assert guillotine.pick_cut({1: 80, 2: 80}, {1: 500, 2: 450}) == 2


# ---- guillotine + FAAB (DB) -------------------------------------------------


async def _guillotine_league(pool, teams=3, budget=100):
    async with pool.acquire() as conn:
        user_id = await conn.fetchval(
            "INSERT INTO users (email, password_hash, display_name, token_version) VALUES ($1, 'x', 'G', 1) RETURNING id",
            f"test-guillotine-{uuid.uuid4().hex[:8]}@example.com",
        )
        league_id = await leagues_queries.create_league(conn, "Test League Guillotine", user_id, uuid.uuid4().hex[:10])
        await conn.execute(
            "UPDATE leagues SET league_type = 'guillotine', matchup_type = 'points', type_settings = $2::jsonb WHERE id = $1",
            league_id, json.dumps({"faab_budget": budget}),
        )
        team_ids = []
        for i in range(teams):
            owner_id = await conn.fetchval(
                "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
                f"test-guillotine-{uuid.uuid4().hex[:8]}", f"Owner {i}",
            )
            team_ids.append(await conn.fetchval(
                "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name, league_id) "
                "VALUES ($1, nextval('synthetic_espn_team_id_seq'), $2, $3, $4) RETURNING id",
                TEST_SEASON, owner_id, f"Chop Team {i}", league_id,
            ))
    return league_id, team_ids


async def _player(pool, suffix):
    sleeper_id = f"test-guillotine-player-{suffix}-{uuid.uuid4().hex[:6]}"
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO players (sleeper_player_id, full_name, position, fantasy_positions, pro_team, status, is_draftable) "
            "VALUES ($1, $2, 'RB', ARRAY['RB'], 'KC', 'Active', TRUE)",
            sleeper_id, f"Chop Player {suffix}",
        )
    return sleeper_id


async def test_lowest_score_is_cut_and_its_roster_hits_waivers(pool):
    league_id, (a, b, c) = await _guillotine_league(pool)
    player = await _player(pool, "cut")
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO current_rosters (season, team_id, sleeper_player_id, lineup_slot, acquired_via, league_id) "
            "VALUES ($1, $2, $3, 'RB', 'draft', $4)",
            TEST_SEASON, b, player, league_id,
        )
        await conn.execute(
            "INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff, league_id) "
            "VALUES ($1, 1, $2, $3, 110, 70, FALSE, $5), ($1, 1, $4, $4, 95, 95, FALSE, $5)",
            TEST_SEASON, a, b, c, league_id,
        )
        cut = await guillotine.eliminate_for_week(conn, TEST_SEASON, 1, league_id)
        again = await guillotine.eliminate_for_week(conn, TEST_SEASON, 1, league_id)
        on_waivers = await waivers.is_on_waivers(conn, TEST_SEASON, league_id, player)
        still_rostered = await conn.fetchval("SELECT 1 FROM current_rosters WHERE sleeper_player_id = $1", player)
    assert cut["team_id"] == b and cut["survivors"] == 2
    assert again is None
    assert on_waivers and not still_rostered


async def test_faab_highest_bid_wins_and_is_spent(pool):
    league_id, (a, b, _c) = await _guillotine_league(pool, budget=100)
    player = await _player(pool, "faab")
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO draft_config (season, league_id, draft_order, roster_slots) VALUES ($1, $2, '{}', $3)",
            TEST_SEASON, league_id, json.dumps(STANDARD),
        )
        await waivers.start_waiver_clock(conn, TEST_SEASON, league_id, player)
        with pytest.raises(BidError):
            await waivers.submit_claim(conn, TEST_SEASON, league_id, a, player)
        with pytest.raises(BidError):
            await waivers.submit_claim(conn, TEST_SEASON, league_id, a, player, bid_amount=101)
        low = await waivers.submit_claim(conn, TEST_SEASON, league_id, a, player, bid_amount=10)
        high = await waivers.submit_claim(conn, TEST_SEASON, league_id, b, player, bid_amount=35)
        await conn.execute(
            "UPDATE waiver_wire SET clears_at = now() - interval '1 minute' WHERE league_id = $1 AND sleeper_player_id = $2",
            league_id, player,
        )
        await waivers.process_expired_waivers(conn, TEST_SEASON, league_id, week=2)
        statuses = {
            r["id"]: r["status"]
            for r in await conn.fetch("SELECT id, status FROM waiver_claims WHERE id = ANY($1::int[])", [low["id"], high["id"]])
        }
        left = await waivers.faab_remaining(conn, TEST_SEASON, league_id, b)
        reasons = await conn.fetch("SELECT id, failure_reason FROM waiver_claims WHERE id = ANY($1::int[])", [low["id"], high["id"]])
    assert statuses == {low["id"]: "failed", high["id"]: "successful"}, [dict(r) for r in reasons]
    assert left == 65
