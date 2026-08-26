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
    assert count == 4

    async with pool.acquire() as conn:
        rows = {r["sleeper_player_id"]: r for r in await conn.fetch(
            "SELECT * FROM players WHERE sleeper_player_id = ANY($1::text[])",
            ["test-1", "test-2", "test-3", "test-4"],
        )}

    assert rows["test-1"]["is_draftable"] is True
    assert rows["test-1"]["espn_player_id"] == 555001
    assert rows["test-1"]["full_name"] == "Test Star Rb"

    assert rows["test-2"]["is_draftable"] is True
    assert rows["test-2"]["position"] == "DEF"
    assert rows["test-2"]["full_name"] == "San Francisco 49ers"

    assert rows["test-3"]["is_draftable"] is False  # practice squad
    assert rows["test-4"]["is_draftable"] is False  # no pro team / inactive


async def test_sync_players_is_idempotent(pool, monkeypatch):
    _patch_fetch(monkeypatch)

    await ingest.sync_players(pool)
    await ingest.sync_players(pool)

    async with pool.acquire() as conn:
        count = await conn.fetchval(
            "SELECT count(*) FROM players WHERE sleeper_player_id = ANY($1::text[])",
            ["test-1", "test-2", "test-3", "test-4"],
        )
    assert count == 4


async def test_sync_players_updates_changed_fields_on_rerun(pool, monkeypatch):
    _patch_fetch(monkeypatch)
    await ingest.sync_players(pool)

    updated = dict(_FAKE_PLAYERS)
    updated["test-1"] = {**_FAKE_PLAYERS["test-1"], "status": "Inactive"}
    _patch_fetch(monkeypatch, updated)
    await ingest.sync_players(pool)

    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM players WHERE sleeper_player_id = 'test-1'")
    assert row["status"] == "Inactive"
    assert row["is_draftable"] is False
