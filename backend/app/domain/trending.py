"""
Trending players (2026-11-05): the most added and most dropped players
across every league in this app, read from roster_transactions — in-app
leagues log each move as it happens, mirrored ESPN/Sleeper leagues log
what changed between roster copies (app/providers/mirror_rosters.py).
Next to it, the same lists across all of Sleeper from Sleeper's public
trending feed, which carries the page while this app's own numbers are
still small.

Each player row also says how many of this app's leagues roster him and
whether he's free in the caller's own league.
"""
from datetime import UTC, datetime, timedelta

from app.domain.headshots import headshot_url
from app.domain.player_views import sleeper_trending

KINDS = {"add", "drop"}
WINDOWS = {"24h": timedelta(hours=24), "7d": timedelta(days=7), "season": None}
SLEEPER_WINDOWS = {"24h": 24, "7d": 168}
LIMIT = 50

_PLAYER_COLUMNS = """
    p.sleeper_player_id, p.full_name, p.position, p.pro_team, p.injury_status, p.espn_player_id,
    (SELECT count(DISTINCT cr.league_id) FROM current_rosters cr
     WHERE cr.season = $1 AND cr.sleeper_player_id = p.sleeper_player_id) AS rostered_leagues,
    NOT EXISTS (SELECT 1 FROM current_rosters cr
                WHERE cr.season = $1 AND cr.league_id = $2 AND cr.sleeper_player_id = p.sleeper_player_id) AS available
"""


async def _leagues_tracked(conn, season: int) -> int:
    return await conn.fetchval("SELECT count(DISTINCT league_id) FROM current_rosters WHERE season = $1", season)


async def app_trending(
    conn, season: int, league_id: int, kind: str, window: str, position: str | None
) -> list[dict]:
    span = WINDOWS[window]
    since = datetime.now(UTC) - span if span else None
    rows = await conn.fetch(
        f"""
        WITH moves AS (
            SELECT added_sleeper_player_id AS pid, 'add' AS kind, league_id FROM roster_transactions
            WHERE season = $1 AND ($3::timestamptz IS NULL OR created_at >= $3) AND added_sleeper_player_id IS NOT NULL
            UNION ALL
            SELECT dropped_sleeper_player_id, 'drop', league_id FROM roster_transactions
            WHERE season = $1 AND ($3::timestamptz IS NULL OR created_at >= $3) AND dropped_sleeper_player_id IS NOT NULL
        ), totals AS (
            SELECT pid,
                   count(*) FILTER (WHERE kind = 'add') AS adds,
                   count(*) FILTER (WHERE kind = 'drop') AS drops,
                   count(DISTINCT league_id) FILTER (WHERE kind = $4) AS leagues
            FROM moves GROUP BY pid
        )
        SELECT {_PLAYER_COLUMNS}, t.adds, t.drops, t.leagues,
               CASE WHEN $4 = 'add' THEN t.adds ELSE t.drops END AS count
        FROM totals t JOIN players p ON p.sleeper_player_id = t.pid
        WHERE CASE WHEN $4 = 'add' THEN t.adds ELSE t.drops END > 0
          AND ($5::text IS NULL OR p.position = $5)
        ORDER BY count DESC, t.leagues DESC, p.search_rank ASC NULLS LAST
        LIMIT {LIMIT}
        """,
        season, league_id, since, kind, position,
    )
    return [dict(r) for r in rows]


async def sleeper_wide_trending(
    conn, season: int, league_id: int, kind: str, window: str, position: str | None
) -> list[dict]:
    feed = await sleeper_trending(kind, SLEEPER_WINDOWS[window])
    counts = {row["player_id"]: row["count"] for row in feed}
    rows = await conn.fetch(
        f"""
        SELECT {_PLAYER_COLUMNS}
        FROM players p
        WHERE p.sleeper_player_id = ANY($3::text[]) AND ($4::text IS NULL OR p.position = $4)
        """,
        season, league_id, list(counts), position,
    )
    out = [{**dict(r), "count": counts[r["sleeper_player_id"]], "adds": None, "drops": None, "leagues": None} for r in rows]
    out.sort(key=lambda r: r["count"], reverse=True)
    return out[:LIMIT]


async def get_trending(
    conn, season: int, league_id: int, source: str, kind: str, window: str, position: str | None
) -> dict:
    if source == "sleeper":
        players = await sleeper_wide_trending(conn, season, league_id, kind, window, position)
    else:
        players = await app_trending(conn, season, league_id, kind, window, position)
    for row in players:
        row["headshot_url"] = headshot_url(row["sleeper_player_id"], row.pop("espn_player_id"), row["position"])
    return {
        "source": source,
        "kind": kind,
        "window": window,
        "leagues_tracked": await _leagues_tracked(conn, season),
        "players": players,
    }
