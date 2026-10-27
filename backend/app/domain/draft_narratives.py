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
from app.domain.draft_grades import get_draft_grades_for_season, pick_gains
from app.providers.anthropic_narrative import MODEL, generate_narrative

DRAFT_RECAP_PROMPT = """You are the voice of a fantasy football league's website, writing a draft \
recap for one team's draft class — and you are NOT neutral. You are a professional shit-talker: \
roasting (or grudgingly crediting) how this team's draft actually went, using ONLY the real facts \
you're given: this team's letter grade, how its starting lineup stacks up against the league, how \
many players it took at each position, and every real pick it made (round, player, position), with \
the clear steals and reaches already called out for you. Never invent a stat, a player, or an event \
not present in the data — every jab must be traceable to a specific fact you were handed.

The grade itself was worked out from the numbers (projections, market draft position, lineup value); \
your job is NOT to explain that math. Talk like the funniest guy in the group chat, not a draft \
analyst: never mention ADP, rankings, rounds gained, percentiles, projections, value or any formula, \
and never quote a number other than the grade, a round, or a count of players. Say "stole X in the \
ninth" or "reached for X in the second" or "drafted four quarterbacks like he's starting a backup \
QB farm," not "taken 2.1 rounds after his ADP."

Some picks are marked KEEPER — that slot was locked in by this league's keeper rules before the draft \
even started, not a decision this team made on draft day. Never call a keeper pick a "steal," "value \
pick," or "reach" — that framing only ever applies to a real, live draft-day decision. You may still \
mention a keeper matter-of-factly (e.g. "kept X, a real anchor") or note the team got a strong keeper \
slot, but credit or blame for keepers belongs to the keeper rules, not this team's draft-day judgment.

Open with the letter grade and what it says about this team, hit the best steal and the worst reach \
if any were called out (and the lineup's strength or holes, or any position this team hoarded), and \
close with a verdict on the whole draft class. Compliment what deserves it, roast what doesn't. Tone: \
brutal, sharp, genuinely funny — same voice as this league's matchup write-ups. Four to six \
sentences. No hedging, no disclaimers."""

# Share of the room's picks (from each end) that get each label, so a
# write-up gets a pick or two worth calling out per team instead of
# half its roster: the value-board fallback scatters too widely for
# fixed cutoffs (2026: ~45% of picks came out as "big" steals or
# reaches). Kickers and defenses never get one.
BIG_SHARE = 0.05
LABEL_SHARE = 0.15
_NO_LABEL_POSITIONS = {"K", "DEF"}


def pick_labels(gains: dict[str, float], positions: dict[str, str]) -> dict[str, str]:
    """sleeper_player_id -> "a big steal" / "a steal" / "a reach" / "a
    big reach" for the picks at either end of the room's rounds gained
    (app/domain/draft_grades.py's pick_gains)."""
    ranked = sorted(
        (player_id for player_id in gains if positions.get(player_id) not in _NO_LABEL_POSITIONS),
        key=lambda player_id: gains[player_id],
    )
    n = len(ranked)
    big, labeled = round(n * BIG_SHARE), round(n * LABEL_SHARE)
    labels = {}
    for i, player_id in enumerate(ranked):
        from_top = n - 1 - i
        if gains[player_id] > 0 and from_top < labeled:
            labels[player_id] = "a big steal" if from_top < big else "a steal"
        elif gains[player_id] < 0 and i < labeled:
            labels[player_id] = "a big reach" if i < big else "a reach"
    return labels


def _lineup_standing(grade: dict) -> str:
    ratio = float(grade["starter_projected_points"]) / float(grade["league_avg_starter_projected_points"] or 1)
    if ratio >= 1.06:
        return "one of the strongest starting lineups in the league on paper"
    if ratio >= 1.02:
        return "a starting lineup a bit better than the league average on paper"
    if ratio > 0.98:
        return "a starting lineup right around the league average on paper"
    if ratio > 0.94:
        return "a starting lineup a bit worse than the league average on paper"
    return "one of the weakest starting lineups in the league on paper"


def _build_draft_facts(picks: list[dict], grade: dict) -> str:
    facts = [f"This team's draft grade: {grade['letter_grade']}"]
    counts: dict[str, int] = {}
    for p in picks:
        counts[p["player_position"]] = counts.get(p["player_position"], 0) + 1
    if grade.get("starter_projected_points") is not None:
        facts.append(f"This team built {_lineup_standing(grade)}")
    facts.append("Players drafted by position: " + ", ".join(f"{n} {pos}" for pos, n in sorted(counts.items())))
    for p in picks:
        if p.get("is_keeper"):
            note = " — KEEPER, locked in before the draft by this league's keeper rules"
        else:
            note = f" — {p['label']}" if p.get("label") else ""
        facts.append(f"Round {p['round']}: {p['player_name']} ({p['player_position']}){note}")
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
    gains = await pick_gains(conn, season, league_id)
    positions = {
        r["sleeper_player_id"]: r["position"]
        for r in await conn.fetch(
            "SELECT p.sleeper_player_id, p.position FROM draft_picks dp JOIN players p ON p.sleeper_player_id = dp.sleeper_player_id "
            "WHERE dp.season = $1 AND dp.league_id = $2",
            season, league_id,
        )
    }
    labels = pick_labels(gains, positions)
    generated = {}
    for grade in grades:
        picks = await conn.fetch(
            """
            SELECT dp.round, dp.pick_number, dp.is_keeper, dp.sleeper_player_id, p.full_name AS player_name,
                   p.position AS player_position, p.projected_points, p.search_rank
            FROM draft_picks dp JOIN players p ON p.sleeper_player_id = dp.sleeper_player_id
            WHERE dp.season = $1 AND dp.league_id = $2 AND dp.owner_id = $3
            ORDER BY dp.pick_number
            """,
            season, league_id, grade["owner_id"],
        )
        if not picks:
            continue
        facts = _build_draft_facts(
            [{**dict(p), "label": labels.get(p["sleeper_player_id"])} for p in picks], dict(grade)
        )
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
