"""
AI-generated draft recap per team, reusing app/providers/anthropic_narrative.py's
generate_narrative() unchanged — same "professional shit-talker, never invent a
stat" voice and cache-forever-once-generated shape as
app/domain/narrative_engine.py's matchup/weekly write-ups. See migration
03100a8a1874 and app/domain/draft_grades.py for why the letter grade
itself is a single, reliable-field metric — this module only turns
that grade plus the real pick-by-pick data into copy.

generate_narrative() is a synchronous, blocking call (a real network
request to Anthropic) — called here via asyncio.to_thread so a batch of
~12 sequential calls (one per team, right after a real draft finishes)
doesn't freeze this single-process app's event loop for everyone else
using it at the same time.
"""
import asyncio

from app import config
from app.domain.draft_grades import get_draft_grades_for_season
from app.providers.anthropic_narrative import MODEL, generate_narrative

DRAFT_RECAP_PROMPT = """You are the voice of a fantasy football league's website, writing a draft \
recap for one team's draft class — and you are NOT neutral. You are a professional shit-talker: \
roasting (or grudgingly crediting) how this team's draft actually went, using ONLY the real facts \
you're given: this team's letter grade and percentile among the league's real drafters, its total \
projected points versus the league average, and every real pick it made (round, player, position, \
that player's real projected season points, and Sleeper's own rough overall-rank proxy where \
available). Never invent a stat, a player, or an event not present in the data — every jab must be \
traceable to a specific fact you were handed. The rank proxy is a single-source estimate, not real \
market consensus ADP — treat it as rough color ("a bit of a reach," "great value"), never as gospel.

Some picks are marked KEEPER — that slot was locked in by this league's keeper rules before the draft \
even started, not a decision this team made on draft day. Never call a keeper pick a "steal," "value \
pick," or "reach" — that framing only ever applies to a real, live draft-day decision. You may still \
mention a keeper matter-of-factly (e.g. "kept X, a real anchor") or note the team got a strong keeper \
slot, but credit or blame for keepers belongs to the keeper rules, not this team's draft-day judgment — \
reserve all "steal"/"reach"/"value" language for the team's actual, non-keeper picks.

Open with the letter grade and what it means relative to the league, call out the single best value \
pick and the single biggest reach among this team's real (non-keeper) picks using the rank proxy, and \
close with a verdict on the whole draft class. Tone: brutal, sharp, genuinely funny, zero mercy — same \
voice as this league's matchup write-ups. Four to six sentences. No hedging, no disclaimers."""


def _build_draft_facts(picks: list[dict], grade: dict) -> str:
    facts = [
        f"This team's draft grade: {grade['letter_grade']} ({grade['percentile']:.0f}th percentile in the league)",
        f"Total projected points drafted: {float(grade['total_projected_points']):.1f} "
        f"(league average: {float(grade['league_avg_projected_points']):.1f})",
    ]
    for p in picks:
        rank_note = f", overall rank proxy {p['search_rank']}" if p.get("search_rank") is not None else ""
        keeper_note = " — KEEPER, locked in before the draft by this league's keeper rules" if p.get("is_keeper") else ""
        facts.append(
            f"Round {p['round']}, pick {p['pick_number']}: {p['player_name']} ({p['player_position']}), "
            f"projected {float(p['projected_points']):.1f} points{rank_note}{keeper_note}"
        )
    return "; ".join(facts)


async def generate_draft_narratives(conn, season: int, league_id: int) -> dict:
    """Generates and caches one recap per owner for this season's real,
    completed draft. Skips cleanly (no crash, no partial writes) when
    ANTHROPIC_API_KEY isn't set — same degrade-gracefully contract
    app/domain/narrative_engine.py's get_or_generate_narrative already
    has. Safe to call again later (e.g. a manual re-trigger after
    deleting the cached rows) — each owner's narrative is its own
    independent UPSERT."""
    if not config.ANTHROPIC_API_KEY:
        return {}

    grades = await get_draft_grades_for_season(conn, season, league_id)
    generated = {}
    for grade in grades:
        picks = await conn.fetch(
            """
            SELECT dp.round, dp.pick_number, dp.is_keeper, p.full_name AS player_name,
                   p.position AS player_position, p.projected_points, p.search_rank
            FROM draft_picks dp JOIN players p ON p.sleeper_player_id = dp.sleeper_player_id
            WHERE dp.season = $1 AND dp.league_id = $2 AND dp.owner_id = $3
            ORDER BY dp.pick_number
            """,
            season, league_id, grade["owner_id"],
        )
        if not picks:
            continue
        facts = _build_draft_facts([dict(p) for p in picks], dict(grade))
        # max_tokens above the 500 default: a real production failure
        # (2026-09) showed the model can spend its whole budget on
        # internal reasoning before ever emitting the actual text block
        # when given ~16 real picks' worth of facts to weigh — 500 left
        # no room for the answer itself once that happened.
        text = await asyncio.to_thread(generate_narrative, DRAFT_RECAP_PROMPT, facts, 1200)
        await conn.execute(
            """
            INSERT INTO draft_narratives (season, league_id, owner_id, text, model)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (season, league_id, owner_id) DO UPDATE SET
                text = EXCLUDED.text, model = EXCLUDED.model, generated_at = now()
            """,
            season, league_id, grade["owner_id"], text, MODEL,
        )
        generated[grade["owner_id"]] = text
    return generated


async def get_draft_narrative(conn, season: int, owner_id: int, league_id: int):
    return await conn.fetchval(
        "SELECT text FROM draft_narratives WHERE season = $1 AND league_id = $2 AND owner_id = $3",
        season, league_id, owner_id,
    )
