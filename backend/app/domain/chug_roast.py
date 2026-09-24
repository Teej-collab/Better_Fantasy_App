"""
A short AI trash-talk write-up for each graded chug (2026-09-24,
commissioner's request) — the chug board's version of the weekly recap
column (app/domain/narrative_engine.py), through the same Anthropic
wrapper (app/providers/anthropic_narrative.py) and the same rule: the
model only phrases facts it's handed, it never invents any.

Generated right after a chug is recorded (app/routers/chug.py's
upload). Strictly best-effort: no API key, an API error, or a slow
response (ROAST_TIMEOUT_SECONDS) just means that chug has no write-up —
the grade and debt payoff never depend on it.
"""
import asyncio
import logging

from app import config
from app.providers.anthropic_narrative import generate_narrative

logger = logging.getLogger(__name__)

ROAST_TIMEOUT_SECONDS = 25
# Room for the model's own thinking on top of a 2-3 sentence answer —
# generate_narrative logs if this is ever hit.
ROAST_MAX_TOKENS = 1000

ROAST_PROMPT = """You are the trash-talking voice of a fantasy football league's chug board. In this \
league, every starter who scores zero or fewer fantasy points costs their owner one beer chug, filmed and \
graded by the app. Unpaid chugs double every Monday night; three missed weeks in a row turn them into a \
$10-per-chug fine. You're given the facts of one chug that was just graded. Write a short reaction to it.

Use ONLY the facts you're handed — never invent a stat, a name, a detail about the video, or anything \
else not in the data. The grading: final grade out of 10 = 50% time score + 30% smoothness + 20% hype \
(crowd noise right after the chug). Time score is 10 for 2 seconds or less, 9 for 3, 8 for 4, 7 for 5, \
dropping a point per extra second after that.

Tone: your most ruthless group-chat friend — cocky, quick, genuinely funny. Roast a slow or sloppy chug, \
grudgingly respect a fast one, and needle anyone still owing chugs or fines. Keep it about the chug, the \
debt and their fantasy season — never about anyone's body, looks, health, drinking habits outside this \
game, or anything personal. Don't assume anyone's gender — use names, or "they". Two or three \
sentences, plain text only: no title, no hashtags, no markdown, at most one emoji."""


async def gather_facts(
    conn, *, chug_id: int, owner_name: str, discord_user_id: int, season: int, league_id: int,
    result: dict, owed_before: int, owed_after: int, fined_owed: int, posted_by_commissioner: bool,
) -> str:
    history = await conn.fetchrow(
        """
        SELECT count(*) AS lifetime, min(chug_time_seconds) AS best_time, max(final_score) AS best_grade
        FROM chug_scores
        WHERE discord_user_id = $1 AND league_id = $2 AND id <> $3
        """,
        discord_user_id, league_id, chug_id,
    )
    fastest = await conn.fetchrow(
        """
        SELECT owners.display_name, cs.chug_time_seconds
        FROM chug_scores cs JOIN owners ON owners.discord_user_id = cs.discord_user_id
        WHERE cs.league_id = $1 AND cs.season = $2 AND cs.id <> $3
        ORDER BY cs.chug_time_seconds ASC LIMIT 1
        """,
        league_id, season, chug_id,
    )

    lines = [
        f"Chugger: {owner_name}",
        f"Chug time: {result['duration_seconds']:.2f} seconds",
        f"Final grade: {result['final']}/10 (time {result['time_score']}/10, "
        f"smoothness {result['smoothness_score']}/10, hype {result['hype_score']}/10)",
    ]
    if owed_before > 0:
        lines.append(f"This chug paid off one owed chug: owed {owed_before} before, {owed_after} still owed")
    else:
        lines.append("Owed nothing — this was a bonus chug, done for fun")
    if fined_owed > 0:
        lines.append(f"Still owes ${fined_owed * 10} in unpaid chug fines ({fined_owed} fined chugs)")
    if history["lifetime"]:
        lines.append(
            f"Their previous chugs in this league: {history['lifetime']}; "
            f"previous fastest {float(history['best_time']):.2f}s, previous best grade {history['best_grade']}/10"
        )
    else:
        lines.append("This is their first chug on record in this league")
    if fastest:
        lines.append(
            f"League's fastest chug this season (before this one): {fastest['display_name']}, "
            f"{float(fastest['chug_time_seconds']):.2f}s"
        )
    if posted_by_commissioner:
        lines.append("The commissioner had to upload this video for them")
    return "\n".join(lines)


async def write_roast(facts: str) -> str | None:
    if not config.ANTHROPIC_API_KEY:
        return None
    try:
        return await asyncio.wait_for(
            asyncio.to_thread(generate_narrative, ROAST_PROMPT, facts, ROAST_MAX_TOKENS),
            timeout=ROAST_TIMEOUT_SECONDS,
        )
    except Exception:
        logger.warning("Chug roast generation failed or timed out", exc_info=True)
        return None
