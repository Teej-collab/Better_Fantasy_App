"""
A player's game log, like ESPN's (2026-10): every game this season with
the real box-score line by category — passing (CMP, ATT, YDS…), rushing
(CAR, YDS, AVG, TD, LNG), receiving (REC, TGTS…), fumbles, kicking —
from ESPN's public athlete game log (no credentials). The categories are
whatever ESPN lists for the player, so a QB gets passing + rushing, a
kicker field goals + PATs. Team D/STs have no athlete page and no log.

Fantasy points come from our own scoring, not ESPN's; app/domain/
player_card.py joins the two by week.
"""
import time

import httpx

GAMELOG_URL = "https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/{id}/gamelog"

# A game log only moves when a game finishes; a few minutes is plenty.
_TTL_SECONDS = 300
_CACHE: dict[tuple[int, int], tuple[float, dict | None]] = {}


def parse_game_log(data: dict) -> dict | None:
    """{"categories": [{"key", "title", "labels"}],
        "games": [{"week", "opponent", "result", "stats": {key: [values]}}]}
    for the regular season, oldest week first; None with nothing to show."""
    columns = data.get("categories") or []
    labels = [str(label).strip() for label in data.get("labels") or []]
    if not columns or not labels:
        return None
    categories, spans, start = [], [], 0
    for column in columns:
        count = int(column.get("count") or 0)
        key = column.get("name") or f"c{len(categories)}"
        categories.append({"key": key, "title": column.get("displayName") or key.title(), "labels": labels[start : start + count]})
        spans.append((key, start, start + count))
        start += count

    regular = next(
        (s for s in data.get("seasonTypes") or [] if "regular" in str(s.get("displayName", "")).lower()),
        None,
    )
    if regular is None:
        return None
    events = data.get("events") or {}
    games = []
    for category in regular.get("categories") or []:
        for row in category.get("events") or []:
            event = events.get(str(row.get("eventId"))) or {}
            stats = [str(v) for v in row.get("stats") or []]
            opponent = (event.get("opponent") or {}).get("abbreviation")
            at_vs = event.get("atVs") or ""
            games.append(
                {
                    "week": event.get("week"),
                    "opponent": f"{'@' if at_vs == '@' else ''}{opponent}" if opponent else None,
                    "result": f"{event.get('gameResult') or ''} {event.get('score') or ''}".strip() or None,
                    "stats": {key: stats[a:b] for key, a, b in spans},
                }
            )
    games = [g for g in games if g["week"] is not None]
    games.sort(key=lambda g: g["week"])
    return {"categories": categories, "games": games} if games else None


async def get_player_game_log(espn_player_id: int, season: int) -> dict | None:
    key = (espn_player_id, season)
    cached = _CACHE.get(key)
    if cached and cached[0] > time.monotonic():
        return cached[1]
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(GAMELOG_URL.format(id=espn_player_id), params={"season": season})
        response.raise_for_status()
        result = parse_game_log(response.json())
    _CACHE[key] = (time.monotonic() + _TTL_SECONDS, result)
    return result
