"""Tests for app/providers/sleeper/ingest.py. No network — the Sleeper
client's fetch is monkeypatched with a small fake payload covering the
real filtering edge cases: an active skill-position player (draftable),
a DEF entry keyed by team abbreviation (draftable, special-cased name),
a practice-squad player (excluded), and a retired/teamless player
(excluded). Test rows use a 'test-' sleeper_player_id prefix so
conftest.py's cleanup_test_season fixture can find them."""
from app.providers.sleeper import ingest

_FAKE_PLAYERS = {
    "test-1": {
        "player_id": "test-1",
        "espn_id": 555001,
        "full_name": "Test Star Rb",
        "first_name": "Test Star",
        "last_name": "Rb",
        "position": "RB",
        "fantasy_positions": ["RB"],
        "team": "KC",
        "status": "Active",
        "injury_status": None,
        "search_rank": 12,
        "age": 24,
        "height": "73",
        "weight": 202,  # Sleeper's raw payload isn't consistent about str vs number here
        "number": 4,
        "years_exp": 3,
    },
    "test-2": {
        "player_id": "test-2",
        "espn_id": None,
        "full_name": None,
        "first_name": None,
        "last_name": None,
        "position": "DEF",
        "fantasy_positions": ["DEF"],
        "team": "SF",
        "status": None,
        "injury_status": None,
        "search_rank": None,
    },
    "test-3": {
        "player_id": "test-3",
        "espn_id": 555003,
        "full_name": "Test Practice Squader",
        "first_name": "Test",
        "last_name": "Practice Squader",
        "position": "WR",
        "fantasy_positions": ["WR"],
        "team": "DAL",
        "status": "Practice Squad",
        "injury_status": None,
        "search_rank": 400,
    },
    "test-5": {
        "player_id": "test-5",
        "espn_id": 555005,
        "full_name": "Test Hurt Receiver",
        "first_name": "Test",
        "last_name": "Hurt Receiver",
        "position": "WR",
        "fantasy_positions": ["WR"],
        "team": "IND",
        "status": "Inactive",
        "injury_status": "IR",
        "search_rank": 93,
    },
    "test-4": {
        "player_id": "test-4",
        "espn_id": 555004,
        "full_name": "Test Retired Guy",
        "first_name": "Test",
        "last_name": "Retired Guy",
        "position": "QB",
        "fantasy_positions": ["QB"],
        "team": None,
        "status": "Inactive",
        "injury_status": None,
        "search_rank": None,
    },
}


def _patch_fetch(monkeypatch, players=None):
    monkeypatch.setattr(ingest, "fetch_all_players", lambda: players if players is not None else _FAKE_PLAYERS)


async def test_sync_players_filters_and_upserts(pool, monkeypatch):
    _patch_fetch(monkeypatch)

    count = await ingest.sync_players(pool)
    assert count == 5

    async with pool.acquire() as conn:
        rows = {r["sleeper_player_id"]: r for r in await conn.fetch(
            "SELECT * FROM players WHERE sleeper_player_id = ANY($1::text[])",
            ["test-1", "test-2", "test-3", "test-4", "test-5"],
        )}

    assert rows["test-1"]["is_draftable"] is True
    assert rows["test-1"]["espn_player_id"] == 555001
    assert rows["test-1"]["full_name"] == "Test Star Rb"
    assert rows["test-1"]["age"] == 24
    assert rows["test-1"]["height"] == "73"
    assert rows["test-1"]["weight"] == "202"  # cast to TEXT regardless of raw type
    assert rows["test-1"]["jersey_number"] == "4"
    assert rows["test-1"]["years_exp"] == 3

    assert rows["test-2"]["is_draftable"] is True
    assert rows["test-2"]["position"] == "DEF"
    assert rows["test-2"]["full_name"] == "San Francisco 49ers"

    assert rows["test-3"]["is_draftable"] is False  # practice squad
    assert rows["test-4"]["is_draftable"] is False  # no pro team (retired)
    # Hurt but still on an NFL roster — addable, so they can go on IR.
    assert rows["test-5"]["is_draftable"] is True
    assert rows["test-5"]["injury_status"] == "IR"


async def test_sync_players_is_idempotent(pool, monkeypatch):
    _patch_fetch(monkeypatch)

    await ingest.sync_players(pool)
    await ingest.sync_players(pool)

    async with pool.acquire() as conn:
        count = await conn.fetchval(
            "SELECT count(*) FROM players WHERE sleeper_player_id = ANY($1::text[])",
            ["test-1", "test-2", "test-3", "test-4", "test-5"],
        )
    assert count == 5


async def test_sync_players_updates_changed_fields_on_rerun(pool, monkeypatch):
    _patch_fetch(monkeypatch)
    await ingest.sync_players(pool)

    updated = dict(_FAKE_PLAYERS)
    updated["test-1"] = {**_FAKE_PLAYERS["test-1"], "status": "Suspended"}
    _patch_fetch(monkeypatch, updated)
    await ingest.sync_players(pool)

    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM players WHERE sleeper_player_id = 'test-1'")
    assert row["status"] == "Suspended"
    assert row["is_draftable"] is False


async def test_sync_players_preserves_a_backfilled_espn_id_sleeper_doesnt_have(pool, monkeypatch):
    """The player-card feature (app/domain/player_card.py) resolves and
    persists an espn_player_id via a name-based ESPN lookup when
    Sleeper's own crosswalk is null — a real, later sync run for the
    same player (still null on Sleeper's side) must not wipe that back
    out. Regression test for a real bug: the upsert used to write
    EXCLUDED.espn_player_id unconditionally."""
    _patch_fetch(monkeypatch)
    await ingest.sync_players(pool)  # test-1 has espn_id=555001 from the fixture

    async with pool.acquire() as conn:
        # Simulate the player-card backfill resolving a DIFFERENT/better
        # id than Sleeper's own fixture value, the way a real name-based
        # ESPN lookup result gets persisted.
        await conn.execute("UPDATE players SET espn_player_id = 999999 WHERE sleeper_player_id = 'test-1'")

    # Re-sync with Sleeper's own value now null for this player (a real,
    # common case — Sleeper's crosswalk is sparse) — must not clobber it.
    updated = dict(_FAKE_PLAYERS)
    updated["test-1"] = {**_FAKE_PLAYERS["test-1"], "espn_id": None}
    _patch_fetch(monkeypatch, updated)
    await ingest.sync_players(pool)

    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT espn_player_id FROM players WHERE sleeper_player_id = 'test-1'")
    assert row["espn_player_id"] == 999999


# ---- team-abbreviation normalization (pure, no DB — see ingest.py's
# _TEAM_ABBR_NORMALIZE docstring: a real ingestion run confirmed
# Sleeper's raw data disagrees with ESPN's convention for Washington
# specifically). Deliberately not going through sync_players()/the DB
# here — a fake payload keyed "WAS" would upsert a real "WSH" row,
# colliding with whatever a real ingestion run already wrote for the
# actual Washington Commanders, unlike every other test in this file's
# safely 'test-'-prefixed fake ids. -----------------------------------

def test_normalize_team_abbr_maps_washington_to_espn_convention():
    assert ingest._normalize_team_abbr("WAS") == "WSH"


def test_normalize_team_abbr_leaves_other_teams_unchanged():
    assert ingest._normalize_team_abbr("SF") == "SF"
    assert ingest._normalize_team_abbr("JAX") == "JAX"  # matches on both Sleeper and ESPN already


def test_normalize_team_abbr_passes_through_none():
    assert ingest._normalize_team_abbr(None) is None


def test_normalize_maps_a_skill_players_pro_team():
    row = ingest._normalize("test-was-player", {
        "position": "QB", "fantasy_positions": ["QB"], "team": "WAS", "status": "Active",
        "full_name": "Test Commander", "espn_id": 1,
    })
    assert row["pro_team"] == "WSH"


def test_normalize_maps_a_def_entrys_own_id_and_name():
    row = ingest._normalize("WAS", {
        "position": "DEF", "fantasy_positions": ["DEF"], "team": "WAS", "status": None,
    })
    assert row["sleeper_player_id"] == "WSH"
    assert row["pro_team"] == "WSH"
    assert row["full_name"] == "Washington Commanders"
