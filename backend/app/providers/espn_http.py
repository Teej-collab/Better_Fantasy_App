"""
The one HTTP client for ESPN's public NFL APIs, with a way around a
block on Railway.

On 2026-10-22 ESPN started answering requests from Railway, where this
backend runs, with 403 Forbidden, while the same requests from anywhere
else still worked: the scoreboard, game summaries (live scoring),
Gamecast plays, inactives and player pages all went dark at once. Every
ESPN call now goes through espn_client().

Since 2026-10-23 the relay is the default route: with the relay set up,
every request goes through the website's relay on Vercel
(frontend/src/app/api/espn-relay/route.ts), which fetches it from ESPN
and hands back ESPN's own answer. Going to ESPN first meant a refused
request (and a 403 in the logs) every few minutes, for nothing. ESPN
directly is now the backup: when the relay itself fails (it can't be
reached, errors, or ESPN refuses Vercel too), the same request goes
straight to ESPN.

Configured by ESPN_RELAY_URL (the relay's full address) and
ESPN_RELAY_SECRET (shared with the relay; it 404s without it). With
either unset, every request goes straight to ESPN, as before. Only GETs
to ESPN's public NFL hosts are relayed: the private fantasy API
(app/providers/espn/) keeps talking to ESPN directly with its own
credentials, never through Vercel.
"""
import logging
import os
import time

import httpx

logger = logging.getLogger(__name__)

ESPN_PUBLIC_HOSTS = frozenset({"site.api.espn.com", "site.web.api.espn.com", "sports.core.api.espn.com"})
_REFUSED = frozenset({403, 429})

_RELAY_FAILED = frozenset({403, 429, 500, 502, 503, 504})
# How long after a relay failure the Brain and health alerts call it down.
_RELAY_DOWN_FOR_SECONDS = 300.0

# monotonic time of the relay's last failure.
_relay_failed_mono: float | None = None
# wall-clock times: the relay's last failure, and ESPN's last refusal of
# a direct request (only tried when the relay fails).
relay_last_failed_at: float | None = None
last_refused_at: float | None = None


def reset_relay_state() -> None:
    global _relay_failed_mono, relay_last_failed_at, last_refused_at
    _relay_failed_mono = relay_last_failed_at = last_refused_at = None


def relay_status() -> dict:
    """For the live system map: does ESPN go through the relay, has the
    relay failed in the last few minutes, and when did ESPN last refuse
    the backend directly."""
    configured = _relay_config() is not None
    return {
        "relay_configured": configured,
        "using_relay": configured,
        "relay_down": _relay_failed_mono is not None and time.monotonic() - _relay_failed_mono < _RELAY_DOWN_FOR_SECONDS,
        "relay_last_failed_at": relay_last_failed_at,
        "last_refused_at": last_refused_at,
    }


def _relay_config() -> tuple[str, str] | None:
    url = os.getenv("ESPN_RELAY_URL", "").strip()
    secret = os.getenv("ESPN_RELAY_SECRET", "").strip()
    return (url, secret) if url and secret else None


class _EspnTransport(httpx.AsyncBaseTransport):
    def __init__(self) -> None:
        self._inner = httpx.AsyncHTTPTransport()

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        global _relay_failed_mono, relay_last_failed_at, last_refused_at
        relay = _relay_config()
        if relay is None or request.method != "GET" or request.url.host not in ESPN_PUBLIC_HOSTS:
            return await self._inner.handle_async_request(request)

        relay_url, secret = relay
        relayed = httpx.Request(
            "GET",
            httpx.URL(relay_url, params={"url": str(request.url)}),
            headers={"x-relay-secret": secret, "accept": "application/json"},
            extensions=request.extensions,
        )
        try:
            response = await self._inner.handle_async_request(relayed)
        except httpx.TransportError as error:
            reason = repr(error)
        else:
            if response.status_code not in _RELAY_FAILED:
                return response
            reason = f"HTTP {response.status_code}"
            await response.aclose()
        _relay_failed_mono = time.monotonic()
        relay_last_failed_at = time.time()
        logger.warning("The Vercel relay failed (%s); trying ESPN directly", reason)

        response = await self._inner.handle_async_request(request)
        if response.status_code in _REFUSED:
            last_refused_at = time.time()
        return response

    async def aclose(self) -> None:
        await self._inner.aclose()


def espn_client(timeout: float = 10) -> httpx.AsyncClient:
    """An httpx.AsyncClient for ESPN's public NFL APIs; use it exactly
    like the plain client it replaces (`async with espn_client() as c:`)."""
    return httpx.AsyncClient(timeout=timeout, transport=_EspnTransport())
