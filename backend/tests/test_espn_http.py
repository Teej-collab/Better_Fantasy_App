"""app/providers/espn_http.py: ESPN directly, the Vercel relay when ESPN
refuses. No real network: the transport's inner HTTP transport is an
httpx.MockTransport recording every request it's asked to send."""
import httpx
import pytest

from app.providers import espn_http

SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"
RELAY = "https://relay.example/api/espn-relay"


@pytest.fixture
def sent(monkeypatch):
    """Requests the inner transport saw; ESPN answers `espn_status`."""
    seen: list[httpx.Request] = []
    state = {"espn_status": 200}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.host == "relay.example":
            return httpx.Response(200, json={"via": "relay"})
        return httpx.Response(state["espn_status"], json={"via": "espn"})

    monkeypatch.setattr(espn_http.httpx, "AsyncHTTPTransport", lambda: httpx.MockTransport(handler))
    espn_http.reset_relay_state()
    yield seen, state
    espn_http.reset_relay_state()


def _relay_on(monkeypatch):
    monkeypatch.setenv("ESPN_RELAY_URL", RELAY)
    monkeypatch.setenv("ESPN_RELAY_SECRET", "s3cret")


async def test_goes_straight_to_espn_when_it_answers(sent, monkeypatch):
    _relay_on(monkeypatch)
    seen, _ = sent
    async with espn_http.espn_client() as client:
        response = await client.get(SCOREBOARD)
    assert response.json() == {"via": "espn"}
    assert [r.url.host for r in seen] == ["site.api.espn.com"]


async def test_refused_request_goes_through_the_relay_and_later_ones_skip_espn(sent, monkeypatch):
    # 2026-10-22: ESPN answered Railway with 403 Forbidden.
    _relay_on(monkeypatch)
    seen, state = sent
    state["espn_status"] = 403
    async with espn_http.espn_client() as client:
        first = await client.get(SCOREBOARD, params={"week": 7})
        second = await client.get(SCOREBOARD)

    assert first.json() == {"via": "relay"} and second.json() == {"via": "relay"}
    first.raise_for_status()
    assert [r.url.host for r in seen] == ["site.api.espn.com", "relay.example", "relay.example"]
    relayed = seen[1]
    assert relayed.headers["x-relay-secret"] == "s3cret"
    assert relayed.url.params["url"] == f"{SCOREBOARD}?week=7"


async def test_without_relay_settings_a_refusal_reaches_the_caller(sent, monkeypatch):
    monkeypatch.delenv("ESPN_RELAY_URL", raising=False)
    monkeypatch.delenv("ESPN_RELAY_SECRET", raising=False)
    seen, state = sent
    state["espn_status"] = 403
    async with espn_http.espn_client() as client:
        response = await client.get(SCOREBOARD)
    assert response.status_code == 403
    assert [r.url.host for r in seen] == ["site.api.espn.com"]


async def test_other_hosts_are_never_relayed(sent, monkeypatch):
    _relay_on(monkeypatch)
    seen, state = sent
    state["espn_status"] = 403
    async with espn_http.espn_client() as client:
        response = await client.get("https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl")
    assert response.status_code == 403
    assert [r.url.host for r in seen] == ["lm-api-reads.fantasy.espn.com"]
