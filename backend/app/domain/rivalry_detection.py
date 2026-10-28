"""
Rivalries the league's own history suggests (2026-10-27) — the first
half of the scheduling work: rivalries feed Rivalry Week and the
schedule builder later. See migration e4a6c8d0f2b5.

Every owner pair that has played each other is scored 0-100 from:
- how often they've met (MEETINGS points, full at FULL_MEETINGS games),
- how close those games were (CLOSE points, share decided by under
  CLOSE_MARGIN),
- how even the all-time series is (BALANCE points),
- playoff meetings (PLAYOFF points, full at three) and a championship
  game between them (CHAMPIONSHIP points),
- how many times the series lead has changed hands (LEAD_CHANGE points),
- trades between them (TRADE points) — people who deal with each other
  usually talk to each other.

Pairs scoring SUGGEST_AT or more become suggestions, strongest first,
at most a few pending at a time so the commissioner isn't buried. The
commissioner approves (the pair becomes a rivalries row, with a name and
tagline they can edit first) or dismisses; a dismissed pair is never
suggested again, and a pair already in rivalries never is.
"""
import asyncio
import json
import logging

from app import ai_usage, config
from app.providers.anthropic_narrative import generate_narrative

logger = logging.getLogger(__name__)

MIN_GAMES = 4  # fewer and it's not a rivalry yet — unless they met in the playoffs
FULL_MEETINGS = 12
CLOSE_MARGIN = 10.0
MEETINGS, CLOSE, BALANCE, PLAYOFF, CHAMPIONSHIP, LEAD_CHANGE, TRADE = 25, 20, 15, 20, 15, 10, 5
SUGGEST_AT = 45.0
# The tier names this league's hand-made rivalries already use.
TIERS = ((75.0, "Legendary"), (60.0, "Historic"), (0.0, "Developing"))


def tier_for(score: float) -> str:
    return next(name for floor, name in TIERS if score >= floor)


def score_pair(games: list[dict], trades: int, a_name: str, b_name: str) -> tuple[float, list[str]] | None:
    """(score, reasons) for one pair, or None when they haven't played
    enough to count. `games`: oldest first, each {"season", "a_score",
    "b_score", "is_playoff", "is_championship"}."""
    playoff_games = [g for g in games if g["is_playoff"]]
    if len(games) < MIN_GAMES and not playoff_games:
        return None

    n = len(games)
    a_wins = sum(1 for g in games if g["a_score"] > g["b_score"])
    b_wins = sum(1 for g in games if g["b_score"] > g["a_score"])
    close = [g for g in games if abs(g["a_score"] - g["b_score"]) < CLOSE_MARGIN]
    championships = [g for g in games if g["is_championship"]]

    lead_changes, leader, running = 0, None, 0
    for g in games:
        running += 1 if g["a_score"] > g["b_score"] else -1 if g["b_score"] > g["a_score"] else 0
        now = "a" if running > 0 else "b" if running < 0 else leader
        if leader is not None and now != leader:
            lead_changes += 1
        leader = now

    score = (
        MEETINGS * min(n, FULL_MEETINGS) / FULL_MEETINGS
        + CLOSE * len(close) / n
        + BALANCE * (1 - abs(a_wins - b_wins) / n)
        + PLAYOFF * min(len(playoff_games), 3) / 3
        + (CHAMPIONSHIP if championships else 0)
        + LEAD_CHANGE * min(lead_changes, 4) / 4
        + TRADE * min(trades, 3) / 3
    )

    record = f"{a_wins}-{b_wins}" if a_wins >= b_wins else f"{b_wins}-{a_wins}"
    leader_name = a_name if a_wins > b_wins else b_name if b_wins > a_wins else None
    reasons = [
        f"{n} games all-time, {leader_name} leads {record}" if leader_name else f"{n} games all-time, dead even at {record}"
    ]
    for g in championships:
        winner = a_name if g["a_score"] > g["b_score"] else b_name
        reasons.append(f"Met in the {g['season']} championship ({winner} won)")
    if len(playoff_games) > len(championships):
        others = len(playoff_games) - len(championships)
        reasons.append(f"{others} other playoff meeting{'s' if others != 1 else ''}")
    if len(close) >= 2:
        reasons.append(f"{len(close)} games decided by under {CLOSE_MARGIN:g} points")
    if lead_changes >= 2:
        reasons.append(f"The series lead has changed hands {lead_changes} times")
    if trades:
        reasons.append(f"{trades} trade{'s' if trades != 1 else ''} with each other")
    return round(min(score, 100.0), 1), reasons


def max_pending(team_count: int) -> int:
    return max(3, team_count // 3)


async def _load_pairs(conn, league_id: int) -> tuple[dict, dict, dict]:
    """(games by pair, trades by pair, owner names) — pairs keyed
    (lower owner_id, higher owner_id), games from the lower id's side."""
    rows = await conn.fetch(
        """
        SELECT m.season, m.week, m.is_playoff, th.owner_id AS home_owner, ta.owner_id AS away_owner,
               m.home_score, m.away_score,
               m.is_playoff AND m.week = MAX(m.week) FILTER (WHERE m.is_playoff) OVER (PARTITION BY m.season)
                   AND EXISTS (
                       SELECT 1 FROM season_champions sc
                       WHERE sc.league_id = m.league_id AND sc.season = m.season
                         AND sc.owner_id IN (th.owner_id, ta.owner_id)
                   ) AS is_championship
        FROM matchups m
        JOIN teams_by_season th ON th.id = m.home_team_id
        JOIN teams_by_season ta ON ta.id = m.away_team_id
        WHERE m.league_id = $1 AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL
          AND NOT (m.home_score = 0 AND m.away_score = 0)
          AND th.owner_id IS NOT NULL AND ta.owner_id IS NOT NULL AND th.owner_id <> ta.owner_id
        ORDER BY m.season, m.week
        """,
        league_id,
    )
    games: dict[tuple[int, int], list[dict]] = {}
    for r in rows:
        home_first = r["home_owner"] < r["away_owner"]
        pair = (r["home_owner"], r["away_owner"]) if home_first else (r["away_owner"], r["home_owner"])
        games.setdefault(pair, []).append({
            "season": r["season"],
            "a_score": float(r["home_score"] if home_first else r["away_score"]),
            "b_score": float(r["away_score"] if home_first else r["home_score"]),
            "is_playoff": r["is_playoff"],
            "is_championship": bool(r["is_championship"]),
        })

    trade_rows = await conn.fetch(
        """
        SELECT LEAST(tp.owner_id, tr.owner_id) AS a, GREATEST(tp.owner_id, tr.owner_id) AS b, count(*) AS n
        FROM trades t
        JOIN teams_by_season tp ON tp.id = t.proposing_team_id
        JOIN teams_by_season tr ON tr.id = t.receiving_team_id
        WHERE t.league_id = $1 AND t.status = 'accepted' AND tp.owner_id <> tr.owner_id
        GROUP BY 1, 2
        """,
        league_id,
    )
    trades = {(r["a"], r["b"]): r["n"] for r in trade_rows}

    owner_ids = {o for pair in games for o in pair}
    names = {
        r["owner_id"]: r["display_name"]
        for r in await conn.fetch("SELECT owner_id, display_name FROM owners WHERE owner_id = ANY($1::int[])", list(owner_ids))
    }
    return games, trades, names


async def score_league(conn, league_id: int) -> list[dict]:
    """Every scorable pair of managers still in the league, strongest
    first: {"owner_a_id", "owner_b_id", "score", "tier", "reasons"}.
    A pair where one manager has left the league is skipped — a
    rivalry needs both sides around to keep it going."""
    games, trades, names = await _load_pairs(conn, league_id)
    current = {
        r["owner_id"]
        for r in await conn.fetch(
            "SELECT owner_id FROM teams_by_season WHERE league_id = $1 "
            "AND season = (SELECT MAX(season) FROM teams_by_season WHERE league_id = $1)",
            league_id,
        )
    }
    scored = []
    for (a, b), pair_games in games.items():
        if a not in current or b not in current:
            continue
        result = score_pair(pair_games, trades.get((a, b), 0), names.get(a, "Someone"), names.get(b, "Someone"))
        if result:
            score, reasons = result
            scored.append({"owner_a_id": a, "owner_b_id": b, "score": score, "tier": tier_for(score), "reasons": reasons})
    return sorted(scored, key=lambda p: p["score"], reverse=True)


NAME_PROMPT = """You name rivalries for a fantasy football league's website. Given two \
managers and the real history between them, reply with exactly two lines and nothing else:
Line 1: the rivalry's name, two to five words, punchy, like a real sports rivalry \
("The Border War", "The Iron Bowl") — may play on their names, never a stat.
Line 2: a one-sentence tagline, funny trash talk grounded only in the facts given.
No quotes, no labels, no markdown."""


def _default_name(a_name: str, b_name: str) -> str:
    return f"{a_name} vs {b_name}"


async def _suggest_name(a_name: str, b_name: str, reasons: list[str]) -> tuple[str, str | None]:
    """(name, tagline) — written by the model when there's a key,
    else plain names and no tagline. Never raises."""
    if not config.ANTHROPIC_API_KEY:
        return _default_name(a_name, b_name), None
    facts = f"{a_name} vs {b_name}. " + "; ".join(reasons)
    try:
        with ai_usage.tagged("rivalry_name"):
            text = await asyncio.to_thread(generate_narrative, NAME_PROMPT, facts, 200)
    except Exception:
        logger.exception("Rivalry naming failed for %s vs %s", a_name, b_name)
        return _default_name(a_name, b_name), None
    lines = [line.strip().strip('"') for line in (text or "").splitlines() if line.strip()]
    if not lines:
        return _default_name(a_name, b_name), None
    return lines[0][:60], (lines[1][:200] if len(lines) > 1 else None)


async def refresh_suggestions(conn, league_id: int) -> int:
    """Re-scores the league, keeps pending suggestions' scores and
    reasons current, and adds the strongest new pairs up to
    max_pending. Returns how many are pending afterward."""
    taken = {
        (min(r["owner_a_id"], r["owner_b_id"]), max(r["owner_a_id"], r["owner_b_id"]))
        for r in await conn.fetch("SELECT owner_a_id, owner_b_id FROM rivalries WHERE league_id = $1", league_id)
    }
    existing = {
        (r["owner_a_id"], r["owner_b_id"]): r["status"]
        for r in await conn.fetch(
            "SELECT owner_a_id, owner_b_id, status FROM rivalry_suggestions WHERE league_id = $1", league_id
        )
    }
    team_count = await conn.fetchval(
        "SELECT count(*) FROM teams_by_season WHERE league_id = $1 AND season = (SELECT MAX(season) FROM teams_by_season WHERE league_id = $1)",
        league_id,
    )
    names = {
        r["owner_id"]: r["display_name"]
        for r in await conn.fetch(
            "SELECT DISTINCT o.owner_id, o.display_name FROM owners o JOIN teams_by_season t ON t.owner_id = o.owner_id WHERE t.league_id = $1",
            league_id,
        )
    }

    pending = sum(1 for status in existing.values() if status == "pending")
    for pair in await score_league(conn, league_id):
        key = (pair["owner_a_id"], pair["owner_b_id"])
        if key in taken:
            continue
        if existing.get(key) == "pending":
            await conn.execute(
                """
                UPDATE rivalry_suggestions SET score = $4, tier = $5, reasons = $6::jsonb, updated_at = now()
                WHERE league_id = $1 AND owner_a_id = $2 AND owner_b_id = $3
                """,
                league_id, *key, pair["score"], pair["tier"], json.dumps(pair["reasons"]),
            )
            continue
        if key in existing or pair["score"] < SUGGEST_AT or pending >= max_pending(team_count or 0):
            continue
        name, tagline = await _suggest_name(names.get(key[0], "Someone"), names.get(key[1], "Someone"), pair["reasons"])
        await conn.execute(
            """
            INSERT INTO rivalry_suggestions
                (league_id, owner_a_id, owner_b_id, score, tier, reasons, suggested_name, suggested_tagline)
            VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
            ON CONFLICT (league_id, owner_a_id, owner_b_id) DO NOTHING
            """,
            league_id, *key, pair["score"], pair["tier"], json.dumps(pair["reasons"]), name, tagline,
        )
        pending += 1
    return pending


async def list_pending(conn, league_id: int) -> list[dict]:
    rows = await conn.fetch(
        """
        SELECT s.id, s.owner_a_id, s.owner_b_id, s.score, s.tier, s.reasons, s.suggested_name, s.suggested_tagline,
               oa.display_name AS owner_a_name, ob.display_name AS owner_b_name
        FROM rivalry_suggestions s
        JOIN owners oa ON oa.owner_id = s.owner_a_id
        JOIN owners ob ON ob.owner_id = s.owner_b_id
        WHERE s.league_id = $1 AND s.status = 'pending'
        ORDER BY s.score DESC
        """,
        league_id,
    )
    return [
        {
            **dict(r),
            "score": float(r["score"]),
            "reasons": json.loads(r["reasons"]) if isinstance(r["reasons"], str) else r["reasons"],
        }
        for r in rows
    ]


async def count_pending(conn, league_id: int) -> int:
    return await conn.fetchval(
        "SELECT count(*) FROM rivalry_suggestions WHERE league_id = $1 AND status = 'pending'", league_id
    )


class SuggestionNotFoundError(Exception):
    pass


class RivalryExistsError(Exception):
    pass


async def approve(conn, league_id: int, suggestion_id: int, user_id: int, name: str, tagline: str | None) -> dict:
    """Turns a pending suggestion into a rivalries row with the
    commissioner's name and tagline. Raises SuggestionNotFoundError or
    RivalryExistsError."""
    async with conn.transaction():
        s = await conn.fetchrow(
            "SELECT * FROM rivalry_suggestions WHERE id = $1 AND league_id = $2 AND status = 'pending' FOR UPDATE",
            suggestion_id, league_id,
        )
        if s is None:
            raise SuggestionNotFoundError("That suggestion isn't there anymore.")
        # rivalries is unique on the owner pair across leagues (it
        # predates multi-league), so a pair can only be a rivalry once.
        if await conn.fetchval(
            """
            SELECT 1 FROM rivalries
            WHERE (owner_a_id = $1 AND owner_b_id = $2) OR (owner_a_id = $2 AND owner_b_id = $1)
            """,
            s["owner_a_id"], s["owner_b_id"],
        ):
            raise RivalryExistsError("Those two are already a rivalry.")
        rivalry = await conn.fetchrow(
            """
            INSERT INTO rivalries (owner_a_id, owner_b_id, name, tagline, tier, league_id)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id, name, tagline, tier
            """,
            s["owner_a_id"], s["owner_b_id"], name, tagline, s["tier"], league_id,
        )
        await conn.execute(
            "UPDATE rivalry_suggestions SET status = 'approved', decided_at = now(), decided_by_user_id = $2 WHERE id = $1",
            suggestion_id, user_id,
        )
    return dict(rivalry)


async def dismiss(conn, league_id: int, suggestion_id: int, user_id: int) -> None:
    result = await conn.execute(
        """
        UPDATE rivalry_suggestions SET status = 'dismissed', decided_at = now(), decided_by_user_id = $3
        WHERE id = $1 AND league_id = $2 AND status = 'pending'
        """,
        suggestion_id, league_id, user_id,
    )
    if result.endswith(" 0"):
        raise SuggestionNotFoundError("That suggestion isn't there anymore.")
