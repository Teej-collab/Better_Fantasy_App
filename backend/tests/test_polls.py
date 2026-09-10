from httpx import ASGITransport, AsyncClient

from app.main import app


def _client(base_url="http://test"):
    return AsyncClient(transport=ASGITransport(app=app), base_url=base_url)


async def _sign_up(client: AsyncClient, email: str, display_name: str = "Test Person"):
    resp = await client.post(
        "/auth/signup", json={"email": email, "password": "correct-horse", "display_name": display_name}
    )
    assert resp.status_code == 200


async def test_create_poll_requires_session():
    async with _client() as client:
        resp = await client.post("/leagues/1/polls", json={"question": "Q?", "options": ["A", "B"]})
    assert resp.status_code == 401


async def test_commissioner_can_create_a_poll(pool):
    async with _client() as client:
        await _sign_up(client, "test-polls-create@example.com")
        created = await client.post("/leagues", json={"name": "Test League Polls Create"})
        league_id = created.json()["id"]

        resp = await client.post(
            f"/leagues/{league_id}/polls",
            json={"question": "Push the trade deadline back a week?", "options": ["Yes", "No"]},
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["question"] == "Push the trade deadline back a week?"
    assert body["options"] == ["Yes", "No"]
    assert body["status"] == "open"
    assert body["results"] == [0, 0]
    assert body["my_vote"] is None


async def test_non_commissioner_cannot_create_a_poll(pool):
    async with _client() as creator:
        await _sign_up(creator, "test-polls-unauth-creator@example.com")
        created = await creator.post("/leagues", json={"name": "Test League Polls Unauth"})
        league_id = created.json()["id"]
        invite_code = created.json()["invite_code"]

    async with _client() as member:
        await _sign_up(member, "test-polls-unauth-member@example.com")
        await member.post("/leagues/join", json={"invite_code": invite_code})
        resp = await member.post(
            f"/leagues/{league_id}/polls", json={"question": "Q?", "options": ["A", "B"]}
        )
    assert resp.status_code == 403


async def test_create_poll_requires_at_least_two_options(pool):
    async with _client() as client:
        await _sign_up(client, "test-polls-oneoption@example.com")
        created = await client.post("/leagues", json={"name": "Test League Polls One Option"})
        league_id = created.json()["id"]

        resp = await client.post(f"/leagues/{league_id}/polls", json={"question": "Q?", "options": ["Only one"]})
    assert resp.status_code == 400


async def test_member_can_vote_and_see_live_results(pool):
    async with _client() as creator:
        await _sign_up(creator, "test-polls-vote-creator@example.com")
        created = await creator.post("/leagues", json={"name": "Test League Polls Vote"})
        league_id = created.json()["id"]
        invite_code = created.json()["invite_code"]
        poll_resp = await creator.post(
            f"/leagues/{league_id}/polls", json={"question": "Q?", "options": ["A", "B"]}
        )
        poll_id = poll_resp.json()["id"]

    async with _client() as member:
        await _sign_up(member, "test-polls-vote-member@example.com")
        await member.post("/leagues/join", json={"invite_code": invite_code})
        vote_resp = await member.post(f"/leagues/{league_id}/polls/{poll_id}/vote", json={"option_index": 1})
        assert vote_resp.status_code == 200
        assert vote_resp.json()["results"] == [0, 1]
        assert vote_resp.json()["my_vote"] == 1

        list_resp = await member.get(f"/leagues/{league_id}/polls")
    poll = next(p for p in list_resp.json()["polls"] if p["id"] == poll_id)
    assert poll["results"] == [0, 1]
    assert poll["my_vote"] == 1


async def test_changing_a_vote_replaces_the_old_one(pool):
    async with _client() as creator:
        await _sign_up(creator, "test-polls-change-creator@example.com")
        created = await creator.post("/leagues", json={"name": "Test League Polls Change"})
        league_id = created.json()["id"]
        poll_resp = await creator.post(
            f"/leagues/{league_id}/polls", json={"question": "Q?", "options": ["A", "B"]}
        )
        poll_id = poll_resp.json()["id"]

        await creator.post(f"/leagues/{league_id}/polls/{poll_id}/vote", json={"option_index": 0})
        second = await creator.post(f"/leagues/{league_id}/polls/{poll_id}/vote", json={"option_index": 1})
    assert second.json()["results"] == [0, 1]


async def test_vote_rejects_an_invalid_option_index(pool):
    async with _client() as client:
        await _sign_up(client, "test-polls-badindex@example.com")
        created = await client.post("/leagues", json={"name": "Test League Polls Bad Index"})
        league_id = created.json()["id"]
        poll_resp = await client.post(
            f"/leagues/{league_id}/polls", json={"question": "Q?", "options": ["A", "B"]}
        )
        poll_id = poll_resp.json()["id"]

        resp = await client.post(f"/leagues/{league_id}/polls/{poll_id}/vote", json={"option_index": 5})
    assert resp.status_code == 400


async def test_commissioner_can_close_a_poll_and_voting_then_fails(pool):
    async with _client() as client:
        await _sign_up(client, "test-polls-close@example.com")
        created = await client.post("/leagues", json={"name": "Test League Polls Close"})
        league_id = created.json()["id"]
        poll_resp = await client.post(
            f"/leagues/{league_id}/polls", json={"question": "Q?", "options": ["A", "B"]}
        )
        poll_id = poll_resp.json()["id"]

        close_resp = await client.patch(f"/leagues/{league_id}/polls/{poll_id}")
        assert close_resp.status_code == 200
        assert close_resp.json()["status"] == "closed"

        vote_resp = await client.post(f"/leagues/{league_id}/polls/{poll_id}/vote", json={"option_index": 0})
    assert vote_resp.status_code == 409


async def test_non_commissioner_cannot_close_a_poll(pool):
    async with _client() as creator:
        await _sign_up(creator, "test-polls-closeauth-creator@example.com")
        created = await creator.post("/leagues", json={"name": "Test League Polls Close Auth"})
        league_id = created.json()["id"]
        invite_code = created.json()["invite_code"]
        poll_resp = await creator.post(
            f"/leagues/{league_id}/polls", json={"question": "Q?", "options": ["A", "B"]}
        )
        poll_id = poll_resp.json()["id"]

    async with _client() as member:
        await _sign_up(member, "test-polls-closeauth-member@example.com")
        await member.post("/leagues/join", json={"invite_code": invite_code})
        resp = await member.patch(f"/leagues/{league_id}/polls/{poll_id}")
    assert resp.status_code == 403


async def test_member_of_another_league_cannot_list_polls(pool):
    async with _client() as creator:
        await _sign_up(creator, "test-polls-isolation-creator@example.com")
        created = await creator.post("/leagues", json={"name": "Test League Polls Isolation A"})
        league_id = created.json()["id"]
        await creator.post(f"/leagues/{league_id}/polls", json={"question": "Q?", "options": ["A", "B"]})

    async with _client() as outsider:
        await _sign_up(outsider, "test-polls-isolation-outsider@example.com")
        await outsider.post("/leagues", json={"name": "Test League Polls Isolation B"})
        resp = await outsider.get(f"/leagues/{league_id}/polls")
    assert resp.status_code == 403


async def test_member_of_another_league_cannot_vote(pool):
    async with _client() as creator:
        await _sign_up(creator, "test-polls-isolation-vote-creator@example.com")
        created = await creator.post("/leagues", json={"name": "Test League Polls Isolation Vote A"})
        league_id = created.json()["id"]
        poll_resp = await creator.post(
            f"/leagues/{league_id}/polls", json={"question": "Q?", "options": ["A", "B"]}
        )
        poll_id = poll_resp.json()["id"]

    async with _client() as outsider:
        await _sign_up(outsider, "test-polls-isolation-vote-outsider@example.com")
        await outsider.post("/leagues", json={"name": "Test League Polls Isolation Vote B"})
        resp = await outsider.post(f"/leagues/{league_id}/polls/{poll_id}/vote", json={"option_index": 0})
    assert resp.status_code == 403


async def test_list_polls_shows_newest_first(pool):
    async with _client() as client:
        await _sign_up(client, "test-polls-order@example.com")
        created = await client.post("/leagues", json={"name": "Test League Polls Order"})
        league_id = created.json()["id"]

        first = await client.post(f"/leagues/{league_id}/polls", json={"question": "First?", "options": ["A", "B"]})
        second = await client.post(f"/leagues/{league_id}/polls", json={"question": "Second?", "options": ["A", "B"]})

        list_resp = await client.get(f"/leagues/{league_id}/polls")
    ids = [p["id"] for p in list_resp.json()["polls"]]
    assert ids.index(second.json()["id"]) < ids.index(first.json()["id"])
