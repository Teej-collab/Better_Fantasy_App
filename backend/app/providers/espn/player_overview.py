"""
ESPN's public athlete "overview" endpoint — the same data ESPN's own
player page renders: real recent news, a RotoWire beat-writer note
(the exact same content Sleeper's player cards show — this app's
scoring/roster pivot moved off ESPN's *private* fantasy API for draft/
rosters/lineups, but this is a different, unauthenticated, public
endpoint, same category as nfl_scoreboard.py's scoreboard/summary
calls), a real draft-rank/position-rank pair (the ADP-equivalent
number flagged as unavailable earlier — turns out ESPN's site exposes
one for free, just not through the espn_api library's Player class),
and a real prose "season outlook" (misleadingly keyed "projection" in
ESPN's own response — it's a paragraph, not a number).

Verified live (2026-08-26): unlike site.api.espn.com/apis/site/v2/...
(the scoreboard/summary host, blocked by this sandbox's own egress
rules earlier this session), this is a DIFFERENT subdomain
(site.web.api.espn.com) that this sandbox can reach directly — no
Railway debug-route workaround needed to confirm the shape this time.
"""
import httpx

OVERVIEW_URL = "https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/{espn_player_id}/overview"

# ESPN's own athlete page shows more than this, but a player card is a
# quick-glance UI, not a full news reader — enough to know "is anything
# going on with this player" without turning the card into a scroll.
_MAX_NEWS_ITEMS = 5


def _parse_news_item(article: dict) -> dict:
    return {
        "headline": article.get("headline"),
        "description": article.get("description"),
        "published": article.get("published") or article.get("lastModified"),
        "link": article.get("links", {}).get("web", {}).get("href"),
    }


def _parse_int(value) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


async def get_player_overview(espn_player_id: int) -> dict | None:
    """Returns None for a 404 (a rare id ESPN's site doesn't have an
    overview page for) — every other real failure (timeout, 5xx)
    raises, same as nfl_scoreboard.py's httpx calls; the caller
    (app/domain/player_card.py) is the layer responsible for degrading
    this gracefully, same as it already does for player_info.py."""
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(OVERVIEW_URL.format(espn_player_id=espn_player_id))
        if response.status_code == 404:
            return None
        response.raise_for_status()
        data = response.json()

    news = [_parse_news_item(a) for a in data.get("news", [])[:_MAX_NEWS_ITEMS]]

    rotowire = data.get("rotowire") or {}
    latest_note = None
    if rotowire.get("headline"):
        latest_note = {
            "headline": rotowire.get("headline"),
            "story": rotowire.get("story"),
            "published": rotowire.get("published"),
        }

    fantasy = data.get("fantasy") or {}

    return {
        "news": news,
        "latest_note": latest_note,
        "draft_rank": _parse_int(fantasy.get("draftRank")),
        "position_rank": _parse_int(fantasy.get("positionRank")),
        "season_outlook": fantasy.get("projection"),
    }
