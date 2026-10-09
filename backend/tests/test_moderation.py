"""The chat filter (app/moderation.py) and where it applies."""
from app import moderation
from app.queries import chat as chat_queries
from tests.conftest import TEST_SEASON
from tests.test_chat import _SESSION_SECRET, _client, _league_session_cookie, _seed_league_owner


def test_masks_slurs_and_their_disguises_but_not_swearing():
    assert moderation.clean("you n1gg3r") == "you ******"
    assert moderation.clean("what a faaaggot move") == "what a ******** move"
    assert moderation.clean("NIGGAS in paris") == "****** in paris"
    assert moderation.clean("f@g") == "***"
    assert moderation.clean("fuck you, nice pick") == "fuck you, nice pick"


def test_leaves_innocent_words_alone():
    for text in ("spicy wings, spices, spiced", "Niger and Nigeria", "coon hunter", "bigger snigger", "Booooo"):
        assert moderation.clean(text) == text


def test_a_leagues_own_words():
    keys = moderation.keys_for(["Jabroni"])
    assert moderation.clean("jabroni, jabronis, jaaabroni", keys) == "*******, ********, *********"
    assert moderation.clean("jabroni") == "jabroni"


async def test_chat_messages_are_masked_with_the_leagues_words_too(pool):
    _, owner, league_id = await _seed_league_owner(pool, "filter-chat")
    async with pool.acquire() as conn:
        await conn.execute("INSERT INTO league_chat_filter_words (league_id, words) VALUES ($1, $2)", league_id, ["jabroni"])
        conversation = await chat_queries.create_conversation_for_league(conn, league_id, "league", [owner])
        row = await chat_queries.insert_message(conn, conversation, owner, "nice pick jabroni, you f@g", None)
    assert row["body"] == "nice pick *******, you ***"


async def test_commissioner_edits_the_word_list_and_names_are_checked(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    monkeypatch.setenv("ACTIVE_SEASON", str(TEST_SEASON))
    c_user, c_owner, league_id = await _seed_league_owner(pool, "filter-commish", role="commissioner")
    m_user, m_owner, _ = await _seed_league_owner(pool, "filter-member", league_id=league_id)
    async with _client() as client:
        client.cookies.update(_league_session_cookie(m_user, m_owner))
        denied = await client.put("/league/chat-filter", json={"words": ["x"]})
        bad_name = await client.put("/settings/display-name", json={"display_name": "Big F@g"})
        client.cookies.update(_league_session_cookie(c_user, c_owner))
        saved = await client.put("/league/chat-filter", json={"words": [" Jabroni ", "jabroni", "Scrub"]})
        read = await client.get("/league/chat-filter")
        two_words = await client.put("/league/chat-filter", json={"words": ["two words"]})
    assert denied.status_code == 403
    assert bad_name.status_code == 400
    assert saved.json() == {"words": ["jabroni", "scrub"]}
    assert read.json() == {"words": ["jabroni", "scrub"]}
    assert two_words.status_code == 400
