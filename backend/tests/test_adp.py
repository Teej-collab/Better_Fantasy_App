"""Tests for app/domain/adp.py — matching Fantasy Football Calculator's
players to ours, pinning ADP to a draft when it starts, and autopick,
the draft board and grades reading it."""
from datetime import date

from app.config import DEFAULT_LEAGUE_ID
from app.domain import adp, draft_engine
from app.domain.draft_grades import compute_draft_grades, get_draft_grades_for_season
from app.providers import ffc_adp
from app.queries import draft as draft_queries
from tests.conftest import TEST_SEASON

_ROSTER_SLOTS = {"QB": 1, "RB": 2, "WR": 2, "TE": 1, "RB/WR/TE": 1, "D/ST": 1, "K": 1, "BE": 2}


def test_normalize_name_drops_suffixes_and_punctuation():
    assert adp.normalize_name("Kenneth Walker III") == "kenneth walker"
    assert adp.normalize_name("D.K. Metcalf") == "dk metcalf"
    assert adp.normalize_name("Amon-Ra St. Brown") == "amon ra st brown"
    assert adp.normalize_name("Marvin Harrison Jr.") == "marvin harrison"


def test_match_players_uses_team_to_split_same_names_and_never_guesses():
    players = [
        {"sleeper_player_id": "1", "full_name": "Mike Williams", "position": "WR", "pro_team": "PIT"},
        {"sleeper_player_id": "2", "full_name": "Mike Williams", "position": "WR", "pro_team": "LAC"},
        {"sleeper_player_id": "3", "full_name": "Josh Allen", "position": "QB", "pro_team": "BUF"},
        {"sleeper_player_id": "4", "full_name": "Brandon Aubrey", "position": "K", "pro_team": "DAL"},
        {"sleeper_player_id": "JAX", "full_name": "Jacksonville Jaguars", "position": "DEF", "pro_team": "JAX"},
    ]
    entries = [
        {"player_id": 10, "name": "Mike Williams", "position": "WR", "team": "LAC"},
        {"player_id": 11, "name": "Mike Williams", "position": "WR", "team": "NYJ"},  # neither: don't guess
        {"player_id": 12, "name": "Josh Allen", "position": "QB", "team": "BUF"},
        {"player_id": 13, "name": "Brandon Aubrey", "position": "PK", "team": "DAL"},
        {"player_id": 14, "name": "Jacksonville Defense", "position": "DEF", "team": "JAC"},
        {"player_id": 15, "name": "Nobody Here", "position": "RB", "team": "KC"},
    ]
    assert adp.match_players(entries, players) == {10: "2", 11: None, 12: "3", 13: "4", 14: "JAX", 15: None}


def test_nearest_team_size_and_preseason_window():
    assert adp.nearest_team_size(12) == 12
    assert adp.nearest_team_size(11) in (10, 12)
    assert adp.nearest_team_size(16) == 14
    assert adp.nearest_team_size(None) == 12
    assert adp.in_snapshot_window(date(2027, 8, 20))
    assert not adp.in_snapshot_window(date(2027, 10, 1))


def _fake_feed(players: list[tuple[str, str, float]]):
    """A stand-in for ffc_adp.fetch_adp returning (name, position, adp)."""
    calls = []

    async def fetch(fmt, teams, year, timeout=20):
        calls.append((fmt, teams, year))
        return {
            "status": "Success",
            "meta": {"total_drafts": 500, "start_date": "2027-08-20", "end_date": "2027-08-27"},
            "players": [
                {"player_id": i, "name": name, "position": pos, "team": "KC", "adp": value, "stdev": 1.0, "times_drafted": 50}
                for i, (name, pos, value) in enumerate(players, start=1)
            ],
        }

    return fetch, calls


async def _seed_owner_and_team(conn, suffix, espn_team_id):
    owner_id = await conn.fetchval(
        "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
        f"test-adp-owner-{suffix}", f"Owner {suffix}",
    )
    await conn.execute(
        "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, $2, $3, $4)",
        TEST_SEASON, espn_team_id, owner_id, f"Team {suffix}",
    )
    return owner_id


async def _seed_player(conn, suffix, position="RB", search_rank=100, projected=100.0):
    sleeper_id = f"test-adp-player-{suffix}"
    await conn.execute(
        """
        INSERT INTO players (sleeper_player_id, full_name, position, fantasy_positions, pro_team, status,
                             search_rank, is_draftable, projected_points)
        VALUES ($1, $2, $3, $4, 'KC', 'Active', $5, TRUE, $6)
        """,
        sleeper_id, f"Test Player {suffix}", position, [position], search_rank, projected,
    )
    return sleeper_id


async def _two_team_draft(conn):
    owner_a = await _seed_owner_and_team(conn, "a", 910001)
    owner_b = await _seed_owner_and_team(conn, "b", 910002)
    await draft_engine.create_draft(conn, TEST_SEASON, [owner_a, owner_b], _ROSTER_SLOTS)
    return owner_a, owner_b


async def test_start_draft_pins_adp_and_projections_and_autopick_follows_adp(pool, monkeypatch):
    async with pool.acquire() as conn:
        sleeper_rank_1 = await _seed_player(conn, "rank1", search_rank=1, projected=150.0)
        adp_1 = await _seed_player(conn, "adp1", search_rank=500, projected=140.0)
        fetch, calls = _fake_feed([("Test Player adp1", "RB", 1.4), ("Test Player rank1", "RB", 30.0)])
        monkeypatch.setattr(ffc_adp, "fetch_adp", fetch)

        await _two_team_draft(conn)
        await draft_engine.start_draft(conn, TEST_SEASON)

        assert len(calls) == 1
        snapshot_id = await conn.fetchval(
            "SELECT adp_snapshot_id FROM draft_config WHERE season = $1 AND league_id = $2", TEST_SEASON, DEFAULT_LEAGUE_ID
        )
        assert snapshot_id is not None
        assert await adp.adp_for_draft(conn, TEST_SEASON, DEFAULT_LEAGUE_ID) == {adp_1: 1.4, sleeper_rank_1: 30.0}
        frozen = await conn.fetchval(
            "SELECT projected_points FROM draft_projection_snapshots WHERE season = $1 AND league_id = $2 AND sleeper_player_id = $3",
            TEST_SEASON, DEFAULT_LEAGUE_ID, sleeper_rank_1,
        )
        assert float(frozen) == 150.0

        # The draft room lists the ADP pick first, with its ADP.
        pool_rows = await draft_queries.get_draft_pool(conn, TEST_SEASON, league_id=DEFAULT_LEAGUE_ID)
        assert pool_rows[0]["sleeper_player_id"] == adp_1
        assert float(pool_rows[0]["adp"]) == 1.4

        # Sleeper ranks the other player first; autopick goes by ADP.
        result = await draft_engine.autopick(conn, TEST_SEASON)
        assert result["pick"]["sleeper_player_id"] == adp_1


async def test_start_draft_without_a_feed_still_starts_and_ranks_by_sleeper(pool):
    """conftest's _no_live_adp_feed makes every fetch fail."""
    async with pool.acquire() as conn:
        sleeper_rank_1 = await _seed_player(conn, "rank1", search_rank=1)
        await _seed_player(conn, "rank2", search_rank=2)
        await _two_team_draft(conn)
        await draft_engine.start_draft(conn, TEST_SEASON)

        assert await adp.adp_for_draft(conn, TEST_SEASON, DEFAULT_LEAGUE_ID) == {}
        result = await draft_engine.autopick(conn, TEST_SEASON)
        assert result["pick"]["sleeper_player_id"] == sleeper_rank_1


async def test_freeze_reuses_a_saved_copy_instead_of_fetching_again(pool, monkeypatch):
    async with pool.acquire() as conn:
        await _seed_player(conn, "saved")
        fetch, calls = _fake_feed([("Test Player saved", "RB", 3.0)])
        monkeypatch.setattr(ffc_adp, "fetch_adp", fetch)
        await _two_team_draft(conn)
        fmt, teams = await adp.league_adp_format(conn, TEST_SEASON, DEFAULT_LEAGUE_ID)
        today = date.today()
        saved = await adp.save_snapshot(conn, TEST_SEASON, fmt, teams, today)

        assert await adp.freeze_for_draft(conn, TEST_SEASON, DEFAULT_LEAGUE_ID, today) == saved
        assert len(calls) == 1  # the save above, not a second fetch


async def test_board_tags_steals_and_reaches_and_grades_use_adp(pool, monkeypatch):
    """Two teams (snake: A, B, B, A). A takes the player the market had
    going 20th first overall (a reach); B takes a fair pick second,
    then gets the market's 1.0 player third (a steal — a full round
    later)."""
    async with pool.acquire() as conn:
        late = await _seed_player(conn, "late", projected=200.0)
        fair = await _seed_player(conn, "fair", projected=200.0)
        early = await _seed_player(conn, "early", projected=200.0)
        fetch, _ = _fake_feed([
            ("Test Player early", "RB", 1.0), ("Test Player fair", "RB", 2.0), ("Test Player late", "RB", 20.0),
        ])
        monkeypatch.setattr(ffc_adp, "fetch_adp", fetch)
        owner_a, owner_b = await _two_team_draft(conn)
        await draft_engine.start_draft(conn, TEST_SEASON)
        await draft_engine.make_pick(conn, TEST_SEASON, owner_a, late)
        await draft_engine.make_pick(conn, TEST_SEASON, owner_b, fair)
        await draft_engine.make_pick(conn, TEST_SEASON, owner_b, early)

        state = await draft_queries.get_draft_state(conn, TEST_SEASON, DEFAULT_LEAGUE_ID)
        verdicts = {p["sleeper_player_id"]: p["adp_verdict"] for p in state["picks"] if p["sleeper_player_id"]}
        assert verdicts == {late: "reach", fair: None, early: "steal"}

        await compute_draft_grades(conn, TEST_SEASON)
        by_owner = {g["owner_id"]: g for g in await get_draft_grades_for_season(conn, TEST_SEASON)}
        assert float(by_owner[owner_a]["pick_value_rounds"]) == -3.0  # capped
        assert float(by_owner[owner_b]["pick_value_rounds"]) == 0.5
        assert by_owner[owner_b]["letter_grade"] == "A"
