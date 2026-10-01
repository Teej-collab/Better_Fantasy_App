"""
Reads a sportsbook bet-slip screenshot with Claude's vision and returns
the bet as structured data, for the user to check before it's saved
(app/routers/bets.py's POST /bets/parse-slip). Tracking only.

The screenshot is passed straight through and never stored — a slip can
show account details, and only the confirmed legs are worth keeping.
Uses a forced tool call so the answer is always the JSON shape below,
never prose.
"""
import logging

from app import config
from app.domain.bets import STAT_KEYS
from app.providers.anthropic_narrative import MODEL, _get_client

logger = logging.getLogger(__name__)

_TOOL = {
    "name": "record_bet_slip",
    "description": "Record the bet shown on a sportsbook bet slip screenshot.",
    "input_schema": {
        "type": "object",
        "properties": {
            "is_bet_slip": {"type": "boolean", "description": "False if the image isn't a sportsbook bet slip."},
            "sportsbook": {"type": ["string", "null"], "description": "e.g. DraftKings, FanDuel, BetMGM."},
            "stake": {"type": ["number", "null"], "description": "Wager amount in dollars."},
            "odds_american": {"type": ["integer", "null"], "description": "Whole slip's American odds, e.g. 450 or -110."},
            "payout": {"type": ["number", "null"], "description": "Total payout/to-win-plus-stake in dollars, if shown."},
            "legs": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "description": {"type": "string", "description": "The leg as written on the slip."},
                        "market": {"type": "string", "enum": ["player_prop", "moneyline", "spread", "total", "other"]},
                        "player_name": {"type": ["string", "null"]},
                        "team_abbr": {
                            "type": ["string", "null"],
                            "description": "NFL team abbreviation (e.g. DET, KC, WSH, LAR) — the player's team for a prop, the picked team for a spread/moneyline.",
                        },
                        "stat_key": {"type": ["string", "null"], "enum": [*STAT_KEYS.keys(), None]},
                        "line": {"type": ["number", "null"], "description": "The number: 79.5 for Over 79.5, -3.5 for a spread; null for an anytime TD (2 only for a slip that says '2+ TDs')."},
                        "direction": {"type": ["string", "null"], "enum": ["over", "under", "yes", "no", None]},
                        "odds_american": {"type": ["integer", "null"]},
                        "opponent_abbr": {"type": ["string", "null"], "description": "The other team in the game, if shown."},
                    },
                    "required": ["description", "market"],
                },
            },
        },
        "required": ["is_bet_slip", "legs"],
    },
}

_SYSTEM = (
    "You read NFL sportsbook bet slips for a fantasy football league's bet tracker. "
    "Record exactly what the slip shows — never invent a leg, a number, or odds that aren't visible. "
    "A parlay or same-game parlay has several legs; a straight bet has one. "
    "For player props, pick the closest stat_key: pass_yd, pass_td, pass_int, pass_cmp, pass_att, rush_yd, rush_att, "
    "rec, rec_yd, rush_rec_yd, pass_rush_yd, anytime_td, long_rush, long_rec, "
    "sacks, tackles, kick_pts, fg_made. Anything else (first TD scorer, quarter or half lines, alt markets you can't map) "
    "is market 'other' with the slip's wording in description. "
    "Touchdown props use stat_key anytime_td with direction yes: line null for 'Anytime Touchdown Scorer', "
    "and line 2 or 3 ONLY when the slip literally says '2+' or '3+ touchdowns'. "
    "'X+ yards' means over X-0.5 (e.g. 80+ rushing yards = rush_yd over 79.5). "
    "Spreads: line is the picked team's number (-3.5, +7). Totals: line is the game total with over/under, "
    "and team_abbr is either team in the game. "
    "Ignore account balances, promos and anything that isn't the bet itself."
)

_MAX_TOKENS = 2000


def read_bet_slip(image_base64: str, media_type: str) -> dict:
    """The tool call's input dict (see _TOOL). Raises RuntimeError if the
    key isn't configured or the model didn't answer with the tool."""
    if not config.ANTHROPIC_API_KEY:
        raise RuntimeError("Bet-slip reading isn't set up (ANTHROPIC_API_KEY is missing).")
    client = _get_client()
    response = client.messages.create(
        model=MODEL,
        max_tokens=_MAX_TOKENS,
        system=_SYSTEM,
        tools=[_TOOL],
        tool_choice={"type": "tool", "name": _TOOL["name"]},
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": image_base64}},
                    {"type": "text", "text": "Record this bet slip."},
                ],
            }
        ],
    )
    for block in response.content:
        if getattr(block, "type", None) == "tool_use":
            return dict(block.input)
    logger.warning("Bet slip reader returned no tool call (stop_reason=%s)", getattr(response, "stop_reason", None))
    raise RuntimeError("Couldn't read that slip.")
