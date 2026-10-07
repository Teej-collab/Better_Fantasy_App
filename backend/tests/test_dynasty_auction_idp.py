"""Dynasty, IDP and auction leagues (league formats, 2026-10)."""
import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.domain import auction_engine, draft_engine
from app.domain.roster_slots import is_eligible_for_slot
from app.domain.stat_derivations import derive_stat_line
from app.queries import leagues as leagues_queries
from tests.conftest import TEST_SEASON

SLOTS = {"QB": 1, "RB": 1, "BE": 1}  # 3 players a team


# ---- IDP and taxi (pure) ---------------------------------------------------


def test_a_defenders_own_stats_become_idp_stats_and_nobody_elses_do():
    line = {"def_tackle": 7, "def_sack_ind": 1, "def_int_ind": 1, "def_pd": 2}
    assert derive_stat_line(line, "OLB") == {"idp_tackle": 7, "idp_sack": 1, "idp_int": 1, "idp_pass_def": 2}
    assert derive_stat_line(line, "WR") == {}


def test_taxi_squad_takes_first_and_second_year_players_only():
    assert is_eligible_for_slot("WR", "TAXI", years_exp=0)
    assert is_eligible_for_slot("WR", "TAXI", years_exp=1)
    assert not is_eligible_for_slot("WR", "TAXI", years_exp=2)
    assert not is_eligible_for_slot("WR", "TAXI")


def test_rookie_draft_runs_the_same_order_every_round():
    assert draft_engine.plan_linear_order([7, 8], 2) == [(1, 1, 1, 7), (2, 1, 2, 8), (3, 2, 1, 7), (4, 2, 2, 8)]


# ---- shared DB seeding --------------------------------------------------------


async def _league(pool, *, draft_type="snake", league_type="redraft", settings=None, teams=2, season=TEST_SEASON):
    async with pool.acquire() as conn:
        user_id = await conn.fetchval(
            "INSERT INTO users (email, password_hash, display_name, token_version) VALUES ($1, 'x', 'F', 1) RETURNING id",
            f"test-formats-{uuid.uuid4().hex[:8]}@example.com",
        )
        league_id = await leagues_queries.create_league(conn, "Test League Formats P4", user_id, uuid.uuid4().hex[:10])
        await conn.execute(
            "UPDATE leagues SET draft_type = $2, league_type = $3, type_settings = $4::jsonb WHERE id = $1",
            league_id, draft_type, league_type, json.dumps(settings or {}),
        )
        owners = []
        for i in range(teams):
            owner_id = await conn.fetchval(
                "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
                f"test-formats-{uuid.uuid4().hex[:8]}", f"Owner {i}",
            )
            owners.append(owner_id)
            await conn.execute(
                "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name, league_id) "
                "VALUES ($1, nextval('synthetic_espn_team_id_seq'), $2, $3, $4)",
                season, owner_id, f"Format Team {i}", league_id,
            )
    return league_id, owners


async def _player(conn, position, years_exp=3, rank=1):
    sleeper_id = f"test-formats-player-{uuid.uuid4().hex[:8]}"
    await conn.execute(
        "INSERT INTO players (sleeper_player_id, full_name, position, fantasy_positions, pro_team, status, is_draftable, "
        "years_exp, search_rank) VALUES ($1, $2, $3, ARRAY[$3], 'KC', 'Active', TRUE, $4, $5)",
        sleeper_id, f"Format {position} {sleeper_id[-4:]}", position, years_exp, rank,
    )
    return sleeper_id


async def _expire_clock(conn, league_id):
    await conn.execute(
        "UPDATE draft_config SET current_pick_deadline = $3 WHERE season = $1 AND league_id = $2",
        TEST_SEASON, league_id, datetime.now(timezone.utc) - timedelta(seconds=1),
    )


# ---- auction ---------------------------------------------------------------------


async def test_auction_nominate_bid_and_win_with_budgets(pool):
    league_id, (a, b) = await _league(pool, draft_type="auction", settings={"auction_budget": 10})
    async with pool.acquire() as conn:
        qb = await _player(conn, "QB", rank=-2)
        rb = await _player(conn, "RB", rank=-1)
        await draft_engine.create_draft(conn, TEST_SEASON, [a, b], SLOTS, league_id=league_id)
        await draft_engine.start_draft(conn, TEST_SEASON, league_id)

        state = await auction_engine.get_state(conn, TEST_SEASON, league_id)
        assert state["nominator_owner_id"] == a and state["budget"] == 10
        # $10 for 3 spots: keep $1 for each of the other 2 -> max bid $8.
        assert {t["owner_id"]: t["max_bid"] for t in state["teams"]} == {a: 8, b: 8}

        with pytest.raises(auction_engine.AuctionError):
            await auction_engine.nominate(conn, TEST_SEASON, league_id, b, qb, 1)  # not b's turn
        await auction_engine.nominate(conn, TEST_SEASON, league_id, a, qb, 2)
        with pytest.raises(auction_engine.AuctionError):
            await auction_engine.bid(conn, TEST_SEASON, league_id, b, 9)  # over max
        await auction_engine.bid(conn, TEST_SEASON, league_id, b, 5)

        await _expire_clock(conn, league_id)
        won = await auction_engine.tick(conn, TEST_SEASON, league_id)
        state = await auction_engine.get_state(conn, TEST_SEASON, league_id)
        roster_owner = await conn.fetchval(
            "SELECT t.owner_id FROM current_rosters cr JOIN teams_by_season t ON t.id = cr.team_id "
            "WHERE cr.league_id = $1 AND cr.sleeper_player_id = $2",
            league_id, qb,
        )
        price = await conn.fetchval(
            "SELECT price FROM draft_picks WHERE league_id = $1 AND sleeper_player_id = $2", league_id, qb
        )

        # Nobody nominates in time: the clock puts up the best player left for b at $1.
        await _expire_clock(conn, league_id)
        auto = await auction_engine.tick(conn, TEST_SEASON, league_id)
    assert won == {"event": "won", "owner_id": b, "sleeper_player_id": qb, "price": 5}
    assert roster_owner == b and price == 5
    assert {t["owner_id"]: t["remaining"] for t in state["teams"]} == {a: 10, b: 5}
    assert state["nominator_owner_id"] == b
    assert auto["event"] == "auto_nominated" and auto["sleeper_player_id"] == rb


# ---- dynasty rookie draft ----------------------------------------------------------


async def test_dynasty_keeps_rosters_and_drafts_rookies_worst_team_first(pool):
    league_id, (champ, last) = await _league(
        pool, league_type="dynasty", settings={"rookie_draft_rounds": 2}, season=TEST_SEASON - 1,
    )
    async with pool.acquire() as conn:
        # Last season: `last` lost every game, and each team had a player.
        old = {
            r["owner_id"]: r["id"]
            for r in await conn.fetch("SELECT id, owner_id FROM teams_by_season WHERE league_id = $1", league_id)
        }
        await conn.execute(
            "INSERT INTO matchups (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff, league_id) "
            "VALUES ($1, 1, $2, $3, 120, 80, FALSE, $4)",
            TEST_SEASON - 1, old[champ], old[last], league_id,
        )
        vet = await _player(conn, "RB")
        await conn.execute(
            "INSERT INTO current_rosters (season, team_id, sleeper_player_id, lineup_slot, acquired_via, league_id) "
            "VALUES ($1, $2, $3, 'RB', 'draft', $4)",
            TEST_SEASON - 1, old[last], vet, league_id,
        )
        for owner_id in (champ, last):
            await conn.execute(
                "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name, league_id) "
                "VALUES ($1, nextval('synthetic_espn_team_id_seq'), $2, 'This Year', $3)",
                TEST_SEASON, owner_id, league_id,
            )
        rookie = await _player(conn, "WR", years_exp=0, rank=-5)

        await draft_engine.create_draft(conn, TEST_SEASON, [champ, last], SLOTS, league_id=league_id)
        config = await conn.fetchrow("SELECT draft_type, pool, draft_order FROM draft_config WHERE season = $1 AND league_id = $2", TEST_SEASON, league_id)
        picks = await conn.fetch("SELECT pick_number, owner_id FROM draft_picks WHERE season = $1 AND league_id = $2 ORDER BY pick_number", TEST_SEASON, league_id)
        carried = await conn.fetchval(
            "SELECT 1 FROM current_rosters WHERE season = $1 AND league_id = $2 AND sleeper_player_id = $3",
            TEST_SEASON, league_id, vet,
        )
        pool_ids = {p["sleeper_player_id"] for p in await draft_engine.draftable_pool(conn, TEST_SEASON, league_id)}
        rookie_ok = await draft_engine.is_draftable_in_league(conn, TEST_SEASON, league_id, rookie)
        vet_ok = await draft_engine.is_draftable_in_league(conn, TEST_SEASON, league_id, vet)
        for season in (TEST_SEASON, TEST_SEASON - 1):
            await conn.execute("DELETE FROM draft_picks WHERE league_id = $1 AND season = $2", league_id, season)
            await conn.execute("DELETE FROM draft_config WHERE league_id = $1 AND season = $2", league_id, season)
    assert (config["draft_type"], config["pool"]) == ("linear", "rookies")
    assert list(config["draft_order"]) == [last, champ]
    assert [p["owner_id"] for p in picks] == [last, champ, last, champ]
    assert carried
    assert rookie in pool_ids and vet not in pool_ids
    assert rookie_ok and not vet_ok
