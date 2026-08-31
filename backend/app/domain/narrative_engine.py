"""
Weekly matchup write-ups — the app's only LLM-backed feature. Adapted
from Fantasy_Helper's bot/narrative_engine/ + discord_bot/embeds/
{preview,recap}_embed.py: same "copywriter, not analyst" principle
(the model only ever receives already-verified numbers pulled from
app/domain/matchup_context.py's assembled payload, never invents a
fact), same brutal/on-brand voice this league already has everywhere
else (Chug penalties, the Sweaty Parlay Rule, trash-talk chat) — but
describing the whole matchup (both teams), not a one-sided jab at
whoever lost, since this fills a page's narrative card rather than a
Discord roast field aimed at one person.

Two states:
  - "preview" — before the matchup has any real data (both scores
    still 0-0). Built from records, streaks, rivalry, and projections.
    Hype tone.
  - "recap" — only once the league has moved past this matchup's week
    entirely (get_or_generate_narrative checks queries.
    get_cached_current_week against the matchup's own week), NOT
    simply "scores are non-zero." Scores update live mid-slate on a
    real Sunday, and since a generated result is cached forever (see
    below), generating a "recap" while a game is still in progress
    would freeze an incomplete, wrong result into the cache
    permanently. The trade-off: a recap doesn't appear until the
    following week starts, not the instant Sunday Night Football ends
    — deliberate, not an oversight.

Results are cached in matchup_narratives (migration 7a2c9e4b6f1d) —
Claude is called once per matchup per state, never once per page view.
get_or_generate_narrative returns None (no attempt to generate, no
error) whenever ANTHROPIC_API_KEY isn't set, so the feature degrades to
today's placeholder rather than erroring on every page load for every
visitor until a real key is supplied.
"""
from app.config import ANTHROPIC_API_KEY
from app.providers.anthropic_narrative import MODEL, generate_narrative
from app.queries import league as league_queries
from app.queries import narrative as narrative_queries

PREVIEW_PROMPT = """You are the hype voice of a fantasy football league's website, building \
anticipation for an upcoming matchup between two teams. Use ONLY the real facts you're given — \
records, streaks, projections, rivalry history — never invent a stat, a player, or an event not \
present in the data.

Cover both teams, not just one. Tone: intense, dramatic, a little unhinged — like a boxing match \
announcer, or the pre-game hype video for a genuinely stupid but beloved league. Two to four \
sentences. No hedging, no disclaimers, no "may the best team win" softening."""

RECAP_PROMPT = """You are the recap voice of a fantasy football league's website, writing up how a \
matchup actually played out. Use ONLY the real facts you're given — final scores, who over/under-\
performed their projection, bench mistakes, clutch or choke results, head-to-head history — never \
invent a stat, a player, or an event not present in the data.

Cover both teams: what the winner did right, what the loser did wrong (or how close it actually \
was, if it was close). Tone: brutal, sharp, specific, funny — anchor every jab in the actual number \
or fact provided, never a generic "you're bad at this." Two to four sentences. No hedging, no \
disclaimers, no consolation-prize softening for the loser."""


def _fmt_boom_bust(roster: list[dict]) -> tuple[list[str], list[str]]:
    boom = [p["player_name"] for p in roster if p.get("is_boom")]
    bust = [p["player_name"] for p in roster if p.get("is_bust")]
    return boom, bust


def _side_facts(side: dict, include_result: bool) -> list[str]:
    facts = [f"{side['team_name']} (owner {side['owner_name']}), season record {side['record'] or '0-0'}"]

    if side["streak"] != "neutral":
        facts.append(f"{side['team_name']} is on a {side['streak']} streak")

    if side["projected_total"] is not None:
        facts.append(f"{side['team_name']}'s projected total: {side['projected_total']}")

    if include_result:
        if side["score"] is not None:
            facts.append(f"{side['team_name']} scored {side['score']}")

        if side["clutch_choke"]:
            facts.append(
                f"{side['team_name']} was {side['clutch_choke']['label']} this week: {side['clutch_choke']['reason']}"
            )

        if side["bench_crime"]:
            bc = side["bench_crime"]
            facts.append(
                f"{side['team_name']} benched {bc['bench_player']}, who outscored started player "
                f"{bc['started_player']} by {bc['points_diff']} points ({bc['severity']})"
            )

        boom, bust = _fmt_boom_bust(side["roster"])
        if boom:
            facts.append(f"{side['team_name']}'s standout performers: {', '.join(boom)}")
        if bust:
            facts.append(f"{side['team_name']}'s disappointing performers: {', '.join(bust)}")

    return facts


def _build_facts(matchup: dict, kind: str) -> str:
    include_result = kind == "recap"
    facts: list[str] = []
    facts += _side_facts(matchup["home"], include_result)
    facts += _side_facts(matchup["away"], include_result)

    h2h = matchup["head_to_head"]
    total_h2h = h2h["wins_home"] + h2h["wins_away"] + h2h["ties"]
    if total_h2h > 0:
        meeting = (
            f"All-time head-to-head: {matchup['home']['team_name']} {h2h['wins_home']} - "
            f"{h2h['wins_away']} {matchup['away']['team_name']}"
        )
        if h2h["last_season"] is not None:
            meeting += f", last met {h2h['last_season']} Wk {h2h['last_week']}"
        facts.append(meeting)
    else:
        facts.append("This is the first-ever meeting between these two teams.")

    if matchup["rivalry"]:
        r = matchup["rivalry"]
        tagline = f": {r['description']}" if r["description"] else ""
        facts.append(f"This is the '{r['name']}' rivalry ({r['tier']} tier){tagline}")

    if matchup["is_playoff"]:
        facts.append("This is a playoff matchup.")
    if matchup["is_game_of_the_week"]:
        facts.append("This is the league's Game of the Week.")

    return "; ".join(facts)


def _resolve_kind(matchup: dict, current_week: int | None) -> str | None:
    if current_week is not None and matchup["week"] < current_week:
        return "recap"
    home_score = matchup["home"]["score"]
    away_score = matchup["away"]["score"]
    if home_score == 0 and away_score == 0:
        return "preview"
    return None  # matchup is mid-week/in-progress — no eligible state yet


async def get_cached_narrative(conn, matchup: dict) -> str | None:
    """Cache read only, never generates — used by build_week_matchup_
    context, which assembles up to a whole league's worth of matchups
    (~7 for a 14-team league) in one call. Triggering a live Claude
    call per matchup there would mean up to 7 sequential API calls on
    the very first visit to a week's page, which is real, bad latency.
    Once get_or_generate_narrative (below) has been called for a given
    matchup via the detail page, this starts picking it up for free."""
    current_week = await league_queries.get_cached_current_week(conn, matchup["season"])
    kind = _resolve_kind(matchup, current_week)
    if kind is None:
        return None
    return await narrative_queries.get_cached_narrative(conn, matchup["matchup_id"], kind)


async def get_or_generate_narrative(conn, matchup: dict) -> str | None:
    """Cache read + generate-on-miss — used by build_matchup_detail,
    which only ever handles one matchup per call, so one possible
    Claude call per request is an acceptable, bounded cost. `matchup`
    is the exact dict app/domain/matchup_context.py's _matchup_entry
    already built — reused directly, nothing is re-fetched here.
    Returns None (never raises) whenever there's nothing eligible to
    generate yet, or no real API key is configured."""
    current_week = await league_queries.get_cached_current_week(conn, matchup["season"])
    kind = _resolve_kind(matchup, current_week)
    if kind is None:
        return None

    cached = await narrative_queries.get_cached_narrative(conn, matchup["matchup_id"], kind)
    if cached is not None:
        return cached

    if not ANTHROPIC_API_KEY:
        return None

    system_prompt = RECAP_PROMPT if kind == "recap" else PREVIEW_PROMPT
    facts = _build_facts(matchup, kind)
    text = generate_narrative(system_prompt, facts)
    await narrative_queries.save_narrative(conn, matchup["matchup_id"], kind, text, MODEL)
    return text
