"""
Reads a sportsbook bet-slip screenshot with Claude's vision — or the text
of a sportsbook's shared-bet web page — and returns every bet on it as
structured data, for the user to check before it's saved
(app/routers/bets.py's POST /bets/parse-slip and /bets/parse-page).
Tracking only.

The screenshot or page is passed straight through and never stored — a
slip can show account details, and only the confirmed legs are worth
keeping.
Uses a forced tool call so the answer is always the JSON shape below,
never prose.

Cost (2026-10-30): Haiku reads first, about 20x cheaper than Sonnet; a
read that fails _needs_second_look (no bet found, a guessed bet, missing
odds or a leg without its player, stat, team or line) is read again by
Sonnet. The same slip or page read again (league-mates adding the same
shared bet) comes from a short in-memory cache instead of another call.
Either way the user checks every bet before it's saved.
"""
import hashlib
import json
import logging
import threading
import time
from collections import OrderedDict

from app import ai_usage, config
from app.domain.bets import STAT_KEYS
from app.providers.anthropic_narrative import MODEL, _get_client

FIRST_MODEL = "claude-haiku-5-5"

logger = logging.getLogger(__name__)

_LEGS = {
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
}

_TOOL = {
    "name": "record_bet_slips",
    "description": "Record every bet shown on a sportsbook screenshot.",
    "input_schema": {
        "type": "object",
        "properties": {
            "is_bet_slip": {"type": "boolean", "description": "False if the image isn't a sportsbook bet slip."},
            "bets": {
                "type": "array",
                "description": "One entry per separate bet (its own wager), top of the screen first.",
                "items": {
                    "type": "object",
                    "properties": {
                        "sportsbook": {"type": ["string", "null"], "description": "e.g. DraftKings, FanDuel, BetMGM."},
                        "stake": {"type": ["number", "null"], "description": "Wager amount in dollars."},
                        "odds_american": {"type": ["integer", "null"], "description": "This bet's American odds, e.g. 450 or -110."},
                        "payout": {"type": ["number", "null"], "description": "Total payout/to-win-plus-stake in dollars, if shown."},
                        "legs": _LEGS,
                        "unclear": {
                            "type": "boolean",
                            "description": "True if any part of this bet had to be guessed: cut off, blurry, hidden or ambiguous.",
                        },
                    },
                    "required": ["legs", "unclear"],
                },
            },
        },
        "required": ["is_bet_slip", "bets"],
    },
}

_SYSTEM = (
    "You read NFL sportsbook bet slips for a fantasy football league's bet tracker. "
    "Record exactly what the slip shows — never invent a leg, a number, or odds that aren't visible. "
    "A screenshot can show several separate bets (each with its own wager) — record every one, top first. "
    "A parlay or same-game parlay is one bet with several legs; a straight bet has one leg. "
    "For player props, pick the closest stat_key: pass_yd, pass_td, pass_int, pass_cmp, pass_att, rush_yd, rush_att, "
    "rec, rec_yd, rush_rec_yd, pass_rush_yd, anytime_td, long_rush, long_rec, "
    "sacks, tackles, kick_pts, fg_made. Anything else (first TD scorer, quarter or half lines, alt markets you can't map) "
    "is market 'other' with the slip's wording in description. "
    "Touchdown props use stat_key anytime_td with direction yes: line null for 'Anytime Touchdown Scorer', "
    "and line 2 or 3 ONLY when the slip literally says '2+' or '3+ touchdowns'. "
    "'X+ yards' means over X-0.5 (e.g. 80+ rushing yards = rush_yd over 79.5). "
    "Spreads: line is the picked team's number (-3.5, +7). Totals: line is the game total with over/under, "
    "and team_abbr is either team in the game. "
    "Ignore account balances, promos and anything that isn't a bet. "
    "Set unclear on a bet if you had to guess at any part of it; it's checked by hand then. "
    "Sometimes you get the text of a sportsbook's shared-bet web page instead of a screenshot: read it the same way, "
    "ignoring the site's menus, app banners and legal fine print, and set is_bet_slip false if it shows no bet."
)

_MAX_TOKENS = 4000


def read_bet_slip(image_base64: str, media_type: str) -> dict:
    """The tool call's input dict (see _TOOL): {"is_bet_slip", "bets"}.
    Raises RuntimeError if the key isn't configured or the model didn't
    answer with the tool."""
    return _read(
        [
            {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": image_base64}},
            {"type": "text", "text": "Record the bets on this slip."},
        ]
    )


def read_bet_page(page_text: str, url: str) -> dict:
    """Same as read_bet_slip, from the visible text of a shared-bet page
    (the app opens the link on the phone and sends what it shows)."""
    return _read(
        [
            {
                "type": "text",
                "text": f"This is the text of a shared bet page from {url}:\n\n<page>\n{page_text}\n</page>\n\nRecord the bets on it.",
            }
        ]
    )


_CACHE_MAX = 256
_CACHE_SECONDS = 6 * 3600
_cache: "OrderedDict[str, tuple[float, dict]]" = OrderedDict()
_cache_lock = threading.Lock()


def _cache_key(content: list[dict]) -> str:
    return hashlib.sha256(json.dumps(content, sort_keys=True).encode()).hexdigest()


def _cached(key: str) -> dict | None:
    with _cache_lock:
        hit = _cache.get(key)
        if not hit or time.time() - hit[0] > _CACHE_SECONDS:
            _cache.pop(key, None)
            return None
        _cache.move_to_end(key)
        return json.loads(json.dumps(hit[1]))


def _remember(key: str, slip: dict) -> None:
    with _cache_lock:
        _cache[key] = (time.time(), json.loads(json.dumps(slip)))
        _cache.move_to_end(key)
        while len(_cache) > _CACHE_MAX:
            _cache.popitem(last=False)


def _needs_second_look(slip: dict) -> bool:
    """True when the cheap read left something a closer read might get:
    no bet found, a bet the reader flagged as guessed, missing odds, or a
    leg missing the piece its market needs."""
    bets = slip.get("bets") or []
    if not slip.get("is_bet_slip") or not bets:
        return True
    for bet in bets:
        legs = bet.get("legs") or []
        if bet.get("unclear") or not legs or (bet.get("odds_american") is None and bet.get("payout") is None):
            return True
        for leg in legs:
            market = leg.get("market")
            if market == "player_prop":
                if not leg.get("player_name") or not leg.get("stat_key"):
                    return True
                if leg.get("stat_key") != "anytime_td" and leg.get("line") is None:
                    return True
            elif market == "spread" and (leg.get("line") is None or not leg.get("team_abbr")):
                return True
            elif market == "moneyline" and not leg.get("team_abbr"):
                return True
            elif market == "total" and leg.get("line") is None:
                return True
    return False


def _read(content: list[dict]) -> dict:
    if not config.ANTHROPIC_API_KEY:
        raise RuntimeError("Bet-slip reading isn't set up (ANTHROPIC_API_KEY is missing).")
    key = _cache_key(content)
    hit = _cached(key)
    if hit is not None:
        return hit
    slip = None
    try:
        slip = _ask(FIRST_MODEL, content)
    except RuntimeError:
        slip = None
    if slip is None or _needs_second_look(slip):
        slip = _ask(MODEL, content)
    _remember(key, slip)
    return slip


def _ask(model: str, content: list[dict]) -> dict:
    client = _get_client()
    response = client.messages.create(
        model=model,
        max_tokens=_MAX_TOKENS,
        system=_SYSTEM,
        tools=[_TOOL],
        tool_choice={"type": "tool", "name": _TOOL["name"]},
        messages=[{"role": "user", "content": content}],
    )
    ai_usage.record(response, model, "bet_slip")
    for block in response.content:
        if getattr(block, "type", None) == "tool_use":
            return dict(block.input)
    logger.warning("Bet slip reader (%s) returned no tool call (stop_reason=%s)", model, getattr(response, "stop_reason", None))
    raise RuntimeError("Couldn't read that slip.")
