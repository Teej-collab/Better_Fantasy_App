"""app/providers/espn_http.py: the Vercel relay by default, ESPN
directly when the relay fails. No real network: the transport's inner
HTTP transport is an httpx.MockTransport recording every request it's
asked to send."""
import httpx
import pytest

from app.providers import espn_http

SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"
RELAY = "https://relay.example/api/espn-relay"


@pytest.fixture
def sent(monkeypatch):
    """Requests the inner transport saw; ESPN answers `espn_status`, the
    relay `relay_status` (None: it can't be reached)."""
    seen: list[httpx.Request] = []
    state = {"espn_status": 200, "relay_status": 200}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.host == "relay.example":
            if state["relay_status"] is None:
                raise httpx.ConnectError("relay down")
            return httpx.Response(state["relay_status"], json={"via": "relay"})
        return httpx.Response(state["espn_status"], json={"via": "espn"})

    monkeypatch.setattr(espn_http.httpx, "AsyncHTTPTransport", lambda: httpx.MockTransport(handler))
    espn_http.reset_relay_state()
    yield seen, state
    espn_http.reset_relay_state()


def _relay_on(monkeypatch):
    monkeypatch.setenv("ESPN_RELAY_URL", RELAY)
    monkeypatch.setenv("ESPN_RELAY_SECRET", "s3cret")


async def test_goes_through_the_relay_first(sent, monkeypatch):
    # 2026-10-23: ESPN refuses Railway, so the relay is the default route.
    _relay_on(monkeypatch)
    seen, _ = sent
    async with espn_http.espn_client() as client:
        response = await client.get(SCOREBOARD, params={"week": 7})
    assert response.json() == {"via": "relay"}
    assert [r.url.host for r in seen] == ["relay.example"]
    assert seen[0].headers["x-relay-secret"] == "s3cret"
    assert seen[0].url.params["url"] == f"{SCOREBOARD}?week=7"
    assert espn_http.relay_status()["relay_down"] is False


@pytest.mark.parametrize("relay_status", [None, 502, 403])
async def test_a_failing_relay_falls_back_to_espn_directly(sent, monkeypatch, relay_status):
    _relay_on(monkeypatch)
    seen, state = sent
    state["relay_status"] = relay_status
    async with espn_http.espn_client() as client:
        response = await client.get(SCOREBOARD)
    assert response.json() == {"via": "espn"}
    assert [r.url.host for r in seen] == ["relay.example", "site.api.espn.com"]
    status = espn_http.relay_status()
    assert status["relay_down"] is True and status["last_refused_at"] is None


async def test_relay_and_espn_both_refusing_reaches_the_caller(sent, monkeypatch):
    _relay_on(monkeypatch)
    _, state = sent
    state["relay_status"], state["espn_status"] = 502, 403
    async with espn_http.espn_client() as client:
        response = await client.get(SCOREBOARD)
    assert response.status_code == 403
    assert espn_http.relay_status()["last_refused_at"] is not None


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
