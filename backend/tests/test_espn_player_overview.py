"""Never hits real ESPN — httpx.AsyncClient is replaced with a fake,
same principle as test_nfl_scoreboard.py. Real shape confirmed live
against site.web.api.espn.com (2026-08-26, see player_overview.py's
docstring) — this sandbox could reach that host directly, unlike
site.api.espn.com earlier this session."""
from app.providers.espn import player_overview

_FAKE_OVERVIEW = {
    "news": [
        {
            "headline": "Gibbs or Bijan: Who should be the first pick in fantasy drafts?",
            "description": "Gibbs or Bijan: Who should be the first pick in fantasy drafts?",
            "published": "2026-08-24T23:54:38.000+00:00",
            "links": {"web": {"href": "https://www.espn.com/video/clip/_/id/49716521"}},
        },
        {
            "headline": "Why Lions, NFL coaches believe Super Bowl chances are real",
            "lastModified": "2026-08-21T15:51:53.000+00:00",
            "links": {"web": {"href": "https://www.espn.com/nfl/story/_/id/1"}},
        },
    ],
    "rotowire": {
        "headline": "Gibbs was held out of Thursday's preseason opener against the Bengals.",
        "story": "The star running back was among a number of key skill players rested by the Lions...",
        "published": "Fri Aug 14 06:49:41 PDT 2026",
    },
    "fantasy": {
        "draftRank": "1",
        "positionRank": "4",
        "percentOwned": "99.91",
        "last7Days": "0.0",
        "projection": "Gibbs has finished in the top 10 among running backs...",
    },
}


class _FakeResponse:
    def __init__(self, data, status_code=200):
        self._data = data
        self.status_code = status_code

    def raise_for_status(self):
        pass

    def json(self):
        return self._data


class _FakeAsyncClient:
    def __init__(self, response, *args, **kwargs):
        self._response = response

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def get(self, url):
        self.last_url = url
        return self._response


async def test_get_player_overview_parses_real_shaped_response(monkeypatch):
    monkeypatch.setattr(
        player_overview.httpx, "AsyncClient", lambda *a, **kw: _FakeAsyncClient(_FakeResponse(_FAKE_OVERVIEW))
    )

    result = await player_overview.get_player_overview(4429795)

    assert len(result["news"]) == 2
    assert result["news"][0]["headline"] == "Gibbs or Bijan: Who should be the first pick in fantasy drafts?"
    assert result["news"][0]["link"] == "https://www.espn.com/video/clip/_/id/49716521"
    assert result["news"][1]["published"] == "2026-08-21T15:51:53.000+00:00"  # falls back to lastModified

    assert result["latest_note"]["headline"] == "Gibbs was held out of Thursday's preseason opener against the Bengals."
    assert result["draft_rank"] == 1
    assert result["position_rank"] == 4
    assert result["season_outlook"].startswith("Gibbs has finished")


async def test_get_player_overview_caps_news_at_five(monkeypatch):
    many_news = [{"headline": f"Story {i}", "links": {}} for i in range(10)]
    monkeypatch.setattr(
        player_overview.httpx, "AsyncClient",
        lambda *a, **kw: _FakeAsyncClient(_FakeResponse({**_FAKE_OVERVIEW, "news": many_news})),
    )

    result = await player_overview.get_player_overview(1)

    assert len(result["news"]) == 5


async def test_get_player_overview_returns_none_for_missing_player(monkeypatch):
    monkeypatch.setattr(
        player_overview.httpx, "AsyncClient", lambda *a, **kw: _FakeAsyncClient(_FakeResponse({}, status_code=404))
    )

    assert await player_overview.get_player_overview(999999) is None


async def test_get_player_overview_handles_no_rotowire_note(monkeypatch):
    data = {**_FAKE_OVERVIEW, "rotowire": {}}
    monkeypatch.setattr(player_overview.httpx, "AsyncClient", lambda *a, **kw: _FakeAsyncClient(_FakeResponse(data)))

    result = await player_overview.get_player_overview(1)

    assert result["latest_note"] is None
