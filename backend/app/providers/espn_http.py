"""
The one HTTP client for ESPN's public NFL APIs, with a way around a
block on Railway.

On 2026-10-22 ESPN started answering requests from Railway, where this
backend runs, with 403 Forbidden, while the same requests from anywhere
else still worked: the scoreboard, game summaries (live scoring),
Gamecast plays, inactives and player pages all went dark at once. Every
ESPN call now goes through espn_client(), whose transport tries ESPN
directly and, when ESPN refuses (403 or 429) or can't be reached, sends
the same GET through the website's relay on Vercel
(frontend/src/app/api/espn-relay/route.ts), which fetches it from ESPN
and hands back ESPN's own answer. After a refusal, requests go straight
to the relay for a few minutes before trying ESPN directly again, so a
blocked backend doesn't pay a wasted round trip on every call.

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
_RELAY_FOR_SECONDS = 300.0

# monotonic time until which requests skip ESPN and use the relay.
_relay_until = 0.0


def reset_relay_state() -> None:
    global _relay_until
    _relay_until = 0.0


def _relay_config() -> tuple[str, str] | None:
    url = os.getenv("ESPN_RELAY_URL", "").strip()
    secret = os.getenv("ESPN_RELAY_SECRET", "").strip()
    return (url, secret) if url and secret else None


class _EspnTransport(httpx.AsyncBaseTransport):
    def __init__(self) -> None:
        self._inner = httpx.AsyncHTTPTransport()

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        global _relay_until
        relay = _relay_config()
        if relay is None or request.method != "GET" or request.url.host not in ESPN_PUBLIC_HOSTS:
            return await self._inner.handle_async_request(request)

        if time.monotonic() >= _relay_until:
            try:
                response = await self._inner.handle_async_request(request)
            except httpx.TransportError as error:
                reason = repr(error)
            else:
                if response.status_code not in _REFUSED:
                    return response
                reason = f"HTTP {response.status_code}"
                await response.aclose()
            _relay_until = time.monotonic() + _RELAY_FOR_SECONDS
            logger.warning("ESPN refused the backend (%s); using the Vercel relay for %d minutes", reason, _RELAY_FOR_SECONDS // 60)

        relay_url, secret = relay
        relayed = httpx.Request(
            "GET",
            httpx.URL(relay_url, params={"url": str(request.url)}),
            headers={"x-relay-secret": secret, "accept": "application/json"},
            extensions=request.extensions,
        )
        return await self._inner.handle_async_request(relayed)

    async def aclose(self) -> None:
        await self._inner.aclose()


def espn_client(timeout: float = 10) -> httpx.AsyncClient:
    """An httpx.AsyncClient for ESPN's public NFL APIs; use it exactly
    like the plain client it replaces (`async with espn_client() as c:`)."""
    return httpx.AsyncClient(timeout=timeout, transport=_EspnTransport())
