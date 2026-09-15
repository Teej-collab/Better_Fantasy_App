"""Tests for app/notifications/chug_events.py — dispatcher.send_to_owner
is patched (same pattern test_fantasy_events.py uses) so nothing tries
to reach a real push provider."""
import itertools

from app.config import DEFAULT_LEAGUE_ID
from app.notifications import chug_events
from app.queries import owner_preferences as preferences_queries
from tests.conftest import TEST_SEASON

_espn_team_id_counter = itertools.count(900001)


async def _seed_owner_and_team(pool, suffix, league_id=DEFAULT_LEAGUE_ID):
    async with pool.acquire() as conn:
        owner_id = await conn.fetchval(
            "INSERT INTO owners (espn_member_id, display_name) VALUES ($1, $2) RETURNING owner_id",
            f"test-chugevents-owner-{suffix}", f"Owner {suffix}",
        )
        await conn.execute(
            "INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name, league_id) "
            "VALUES ($1, $2, $3, $4, $5)",
            TEST_SEASON, next(_espn_team_id_counter), owner_id, f"Team {suffix}", league_id,
        )
    return owner_id


def _capture_sends(monkeypatch):
    sent = []

    async def fake_send_to_owner(conn, owner_id, payload):
        sent.append((owner_id, payload))
        return 1

    monkeypatch.setattr(chug_events.dispatcher, "send_to_owner", fake_send_to_owner)
    return sent


async def test_notify_chug_posted_reaches_every_other_opted_in_league_owner(pool, monkeypatch):
    poster = await _seed_owner_and_team(pool, "poster")
    subscribed = await _seed_owner_and_team(pool, "subscribed")
    not_subscribed = await _seed_owner_and_team(pool, "not-subscribed")

    async with pool.acquire() as conn:
        await preferences_queries.update_preferences(
            conn, subscribed, {"push_enabled": True, "notify_league": True}
        )
        await preferences_queries.update_preferences(
            conn, not_subscribed, {"push_enabled": False, "notify_league": True}
        )

    sent = _capture_sends(monkeypatch)

    async with pool.acquire() as conn:
        await chug_events.notify_chug_posted(
            conn, TEST_SEASON, DEFAULT_LEAGUE_ID, poster, "Poster Owner", 8.5, True
        )

    notified_owner_ids = [owner_id for owner_id, _ in sent]
    # The poster never gets their own notification, and an owner with
    # push disabled is skipped even though notify_league is on.
    assert poster not in notified_owner_ids
    assert not_subscribed not in notified_owner_ids
    assert notified_owner_ids == [subscribed]

    _, payload = sent[0]
    assert payload["title"] == "🍺 New Chug Posted"
    assert "Poster Owner" in payload["body"]
    assert "8.5/10" in payload["body"]
    assert "watch it" in payload["body"]
    assert payload["url"] == "/chug"


async def test_notify_chug_posted_respects_the_notify_league_toggle(pool, monkeypatch):
    poster = await _seed_owner_and_team(pool, "poster2")
    opted_out = await _seed_owner_and_team(pool, "opted-out")

    async with pool.acquire() as conn:
        await preferences_queries.update_preferences(
            conn, opted_out, {"push_enabled": True, "notify_league": False}
        )

    sent = _capture_sends(monkeypatch)

    async with pool.acquire() as conn:
        await chug_events.notify_chug_posted(
            conn, TEST_SEASON, DEFAULT_LEAGUE_ID, poster, "Poster Owner", 6.0, False
        )

    assert sent == []


async def test_notify_chug_posted_without_video_skips_the_watch_invite(pool, monkeypatch):
    poster = await _seed_owner_and_team(pool, "poster3")
    subscribed = await _seed_owner_and_team(pool, "subscribed3")

    async with pool.acquire() as conn:
        await preferences_queries.update_preferences(
            conn, subscribed, {"push_enabled": True, "notify_league": True}
        )

    sent = _capture_sends(monkeypatch)

    async with pool.acquire() as conn:
        await chug_events.notify_chug_posted(
            conn, TEST_SEASON, DEFAULT_LEAGUE_ID, poster, "Poster Owner", 9.1, False
        )

    assert len(sent) == 1
    _, payload = sent[0]
    assert "watch it" not in payload["body"]
    assert payload["body"].endswith(".")
