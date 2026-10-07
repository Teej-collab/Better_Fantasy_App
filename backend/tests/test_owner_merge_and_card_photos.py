"""Owner merge (app/domain/owner_merge.py) and private card photos
(app/routers/profile.py, app/providers/card_photo_storage.py)."""
import uuid

import pytest

from app.domain.owner_merge import merge_owners
from app.providers import card_photo_storage
from tests.conftest import TEST_SEASON
from tests.test_chat import _SESSION_SECRET, _client, _league_session_cookie, _seed_league_owner


async def _owner(conn, name):
    return await conn.fetchval(
        "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
        f"test-merge-{uuid.uuid4().hex}", name,
    )


async def test_merge_moves_everything_and_keeps_one_copy_of_overlaps(pool):
    async with pool.acquire() as conn:
        real = await _owner(conn, "Real Person")
        dupe = await _owner(conn, "Second Account")
        dupe_espn = await conn.fetchval("SELECT espn_member_id FROM owners WHERE owner_id = $1", dupe)
        await conn.execute(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, 9101, $2, 'Old Team')",
            TEST_SEASON, real,
        )
        await conn.execute(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name) VALUES ($1, 9102, $2, 'New Team')",
            TEST_SEASON, dupe,
        )
        # The same week of chug debt under both — the duplicate's copy wins.
        for owner, owed in ((real, 1), (dupe, 2)):
            await conn.execute(
                "INSERT INTO chug_debts (season, week, owner_id, chugs_owed, league_id) VALUES ($1, 3, $2, $3, 1)",
                TEST_SEASON, owner, owed,
            )
        await conn.execute(
            "INSERT INTO chug_debts (season, week, owner_id, chugs_owed, league_id) VALUES ($1, 4, $2, 1, 1)",
            TEST_SEASON, dupe,
        )

        dry = await merge_owners(conn, dupe, real, apply=False)
        assert dry["applied"] is False
        assert await conn.fetchval("SELECT 1 FROM owners WHERE owner_id = $1", dupe)  # untouched

        report = await merge_owners(conn, dupe, real)
        assert report["moved"]["teams_by_season.owner_id"] == 1
        assert report["dropped_duplicates"]["chug_debts.owner_id"] == 1

        assert not await conn.fetchval("SELECT 1 FROM owners WHERE owner_id = $1", dupe)
        teams = await conn.fetch("SELECT team_name FROM teams_by_season WHERE owner_id = $1 ORDER BY espn_team_id", real)
        assert [t["team_name"] for t in teams] == ["Old Team", "New Team"]
        debts = await conn.fetch(
            "SELECT week, chugs_owed FROM chug_debts WHERE owner_id = $1 AND season = $2 ORDER BY week", real, TEST_SEASON
        )
        assert [(d["week"], d["chugs_owed"]) for d in debts] == [(3, 2), (4, 1)]
        assert await conn.fetchval("SELECT owner_id FROM owner_espn_aliases WHERE espn_member_id = $1", dupe_espn) == real
        await conn.execute("DELETE FROM owner_espn_aliases WHERE owner_id = $1", real)


async def test_merge_refuses_self_and_missing(pool):
    async with pool.acquire() as conn:
        with pytest.raises(ValueError):
            await merge_owners(conn, 5, 5)
        with pytest.raises(ValueError):
            await merge_owners(conn, 999999991, 999999992)


@pytest.fixture
def fake_storage(monkeypatch):
    stored = {}
    monkeypatch.setattr(card_photo_storage, "configured", lambda: True)
    monkeypatch.setattr(card_photo_storage, "upload", lambda data, key, ct: stored.__setitem__(key, data))
    monkeypatch.setattr(card_photo_storage, "delete", lambda key: stored.pop(key, None))
    monkeypatch.setattr(card_photo_storage, "signed_url", lambda key: f"https://bucket.example/{key}?sig=abc")
    return stored


async def test_card_photo_permissions_and_signed_links(pool, monkeypatch, fake_storage):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    c_user, c_owner, league_id = await _seed_league_owner(pool, 801, role="commissioner")
    m_user, m_owner, _ = await _seed_league_owner(pool, 802, league_id=league_id)
    o_user, o_owner, _ = await _seed_league_owner(pool, 803, league_id=league_id)
    outsider_user, outsider_owner, _ = await _seed_league_owner(pool, 804)
    jpeg = {"photo": ("me.jpg", b"\xff\xd8fake", "image/jpeg")}

    async with _client() as client:
        client.cookies.update(_league_session_cookie(m_user, m_owner))
        own = await client.post(f"/owners/{m_owner}/card-photo", files=jpeg)
        someone_else = await client.post(f"/owners/{o_owner}/card-photo", files=jpeg)
        wrong_type = await client.post(f"/owners/{m_owner}/card-photo", files={"photo": ("x.gif", b"GIF89a", "image/gif")})
        listed = (await client.get("/owners")).json()["owners"]

        client.cookies.update(_league_session_cookie(c_user, c_owner))
        by_commish = await client.post(f"/owners/{o_owner}/card-photo", files=jpeg)

        client.cookies.update(_league_session_cookie(outsider_user, outsider_owner))
        outsider_view = (await client.get("/owners")).json()["owners"]

    assert own.status_code == 200
    assert someone_else.status_code == 403
    assert wrong_type.status_code == 415
    assert by_commish.status_code == 200
    mine = next(o for o in listed if o["owner_id"] == m_owner)
    assert mine["photo_url"].startswith("https://bucket.example/card-photos/") and mine["photo_version"]
    # Another league's members never get this league's photos.
    assert all(o["owner_id"] not in (m_owner, o_owner) for o in outsider_view)
    assert len(fake_storage) == 2
