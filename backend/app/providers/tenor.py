"""
Thin server-side proxy to Tenor's GIF search API (v2) — the chat GIF
picker (frontend/src/components/chat/GifPicker.tsx) never calls Tenor
directly, so TENOR_API_KEY never reaches the client, same "the key
stays server-side" discipline as every other provider in this
directory. TENOR_API_KEY is empty until the owner supplies a real one
(a free key from Google's developer console) — search() fails loud
with a clear message rather than a cryptic upstream 4xx if it's
missing, same pattern app/providers/anthropic_narrative.py already
uses for ANTHROPIC_API_KEY.
"""
import httpx

from app.config import TENOR_API_KEY

TENOR_SEARCH_URL = "https://tenor.googleapis.com/v2/search"
# Tenor asks every integration to send a stable client_key identifying
# the app (used for their own analytics/rate-limiting) — this app's
# name is as good a value as any, it isn't a secret.
CLIENT_KEY = "weekend_league"


async def search(query: str, limit: int = 24) -> list[dict]:
    if not TENOR_API_KEY:
        raise RuntimeError(
            "GIF search isn't configured — set TENOR_API_KEY (a free key from Google's "
            "developer console, see .env.example) before this feature can work."
        )
    async with httpx.AsyncClient() as client:
        response = await client.get(
            TENOR_SEARCH_URL,
            params={
                "q": query,
                "key": TENOR_API_KEY,
                "client_key": CLIENT_KEY,
                "limit": limit,
                "media_filter": "gif,tinygif",
                "contentfilter": "medium",
            },
            timeout=10.0,
        )
        response.raise_for_status()
        results = response.json().get("results", [])

    gifs = []
    for r in results:
        formats = r.get("media_formats", {})
        gif = formats.get("gif")
        preview = formats.get("tinygif") or gif
        if not gif or not preview:
            continue
        gifs.append(
            {
                "id": r.get("id"),
                "description": r.get("content_description", ""),
                "url": gif["url"],
                "preview_url": preview["url"],
                "width": gif.get("dims", [None, None])[0],
                "height": gif.get("dims", [None, None])[1],
            }
        )
    return gifs
