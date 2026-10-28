"""
Shared bet slips from sportsbooks that run on Kambi (Bally Bet; 2026-10).

Their Share button gives an AppsFlyer link that only opens the app or
the App Store: there's no web page to read like DraftKings'. The bet
itself rides in the link as `betslip_id`, base64 of three ;-separated
lists of numeric ids (events; bet offers; outcomes). Kambi's public
odds API turns each outcome id into the player, market and price, and
that becomes plain text for the same reader as a shared-bet page
(bet_slip_reader.read_bet_page).

The lookup goes through Unibet's public offering feed: the ids are
Kambi-wide, and the operator-specific feeds (ballyus…) refuse outside
callers. A market drops out of the feed once it closes (its game
started, or the player was ruled out), so those legs are reported as
missing for the user to fill in.
"""
import asyncio
import base64
import binascii
import re
from urllib.parse import unquote, urlsplit

import httpx

_OUTCOME_URL = "https://eu-offering-api.kambicdn.com/offering/v2018/ub/betoffer/outcome.json"
_MAX_LEGS = 25
_BETSLIP_RE = re.compile(r"betslip_id=([A-Za-z0-9+/_-]+=*)")
_SPORTSBOOKS = {"bally": "Bally Bet"}


def outcome_ids(url: str) -> list[int] | None:
    """The outcome ids in a shared slip link, or None if it isn't one."""
    text = url
    # The slip sits inside an escaped deep link, sometimes escaped twice.
    for _ in range(3):
        if (match := _BETSLIP_RE.search(text)) is not None:
            break
        text = unquote(text)
    if match is None:
        return None
    raw = match.group(1).replace("-", "+").replace("_", "/")
    try:
        decoded = base64.b64decode(raw + "=" * (-len(raw) % 4), validate=True).decode("ascii")
    except (binascii.Error, ValueError, UnicodeDecodeError):
        return None
    groups = [g for g in decoded.split(";") if g]
    if not groups:
        return None
    try:
        ids = [int(x) for x in groups[-1].split(",") if x]
    except ValueError:
        return None
    return ids[:_MAX_LEGS] or None


def sportsbook(url: str) -> str | None:
    host = (urlsplit(url).hostname or "").lower()
    return next((name for key, name in _SPORTSBOOKS.items() if key in host), None)


async def _outcome(client: httpx.AsyncClient, outcome_id: int) -> dict | None:
    try:
        response = await client.get(_OUTCOME_URL, params={"id": outcome_id, "lang": "en_US", "market": "US"})
        if response.status_code != 200:
            return None
        data = response.json()
        offer = data["betOffers"][0]
        outcome = next(o for o in offer["outcomes"] if o["id"] == outcome_id)
        event = next((e for e in data.get("events", []) if e["id"] == offer["eventId"]), {})
    except (httpx.HTTPError, ValueError, KeyError, IndexError, StopIteration):
        return None
    return {
        "game": event.get("englishName") or event.get("name"),
        "start": event.get("start"),
        "market": offer["criterion"].get("englishLabel") or offer["criterion"].get("label"),
        "player": outcome.get("participant"),
        "pick": outcome.get("englishLabel") or outcome.get("label"),
        "line": outcome["line"] / 1000 if isinstance(outcome.get("line"), (int, float)) else None,
        "decimal": outcome["odds"] / 1000 if isinstance(outcome.get("odds"), (int, float)) else None,
        "american": outcome.get("oddsAmerican"),
    }


def _american(decimal: float) -> str:
    return f"+{round((decimal - 1) * 100)}" if decimal >= 2 else f"-{round(100 / (decimal - 1))}"


async def slip_text(url: str, ids: list[int]) -> str:
    """The slip as plain text, like a shared-bet page would show it."""
    async with httpx.AsyncClient(timeout=8, headers={"User-Agent": "Mozilla/5.0"}) as client:
        legs = await asyncio.gather(*(_outcome(client, i) for i in ids))
    found = [leg for leg in legs if leg is not None]
    if not found:
        raise LookupError("none of the slip's markets could be looked up")
    lines = [f"Sportsbook: {sportsbook(url) or 'unknown'}", f"{'Parlay' if len(ids) > 1 else 'Straight bet'}, {len(ids)} legs", ""]
    for leg in found:
        parts = [leg["player"], leg["market"], leg["pick"]]
        if leg["line"] is not None:
            parts.append(f"line {leg['line']:g}")
        parts += [leg["game"], f"kickoff {leg['start']}", f"odds {leg['american']}"]
        lines.append(" · ".join(str(p) for p in parts if p))
    missing = len(ids) - len(found)
    if missing:
        lines += ["", f"{missing} more leg{'s' if missing > 1 else ''} couldn't be looked up (market closed)."]
    elif len(found) > 1 and all(leg["decimal"] for leg in found):
        total = 1.0
        for leg in found:
            total *= leg["decimal"]
        lines += ["", f"Parlay odds at current prices: {_american(total)}"]
    lines.append("The wager isn't on the shared slip.")
    return "\n".join(lines)
