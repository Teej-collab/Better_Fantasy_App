"""
Thin server-side proxy to GIPHY's GIF search API (v1) — the chat GIF
picker (frontend/src/components/chat/GifPicker.tsx) never calls GIPHY
directly, so GIPHY_API_KEY never reaches the client, same "the key
stays server-side" discipline as every other provider in this
directory. GIPHY_API_KEY is empty until the owner supplies a real one
(a free key from developers.giphy.com — just an email and an app
name, no cloud console) — search() fails loud with a clear message
rather than a cryptic upstream 4xx if it's missing, same pattern
app/providers/anthropic_narrative.py already uses for ANTHROPIC_API_KEY.

Swapped in for Tenor (2026-09) after Tenor's key-provisioning flow
(Google Cloud Console) proved too much friction — the picker/proxy
shape above it didn't need to change at all, only this module.
"""
import httpx

from app.config import GIPHY_API_KEY

GIPHY_SEARCH_URL = "https://api.giphy.com/v1/gifs/search"


async def search(query: str, limit: int = 24) -> list[dict]:
    if not GIPHY_API_KEY:
        raise RuntimeError(
            "GIF search isn't configured — set GIPHY_API_KEY (a free key from "
            "developers.giphy.com, see .env.example) before this feature can work."
        )
    async with httpx.AsyncClient() as client:
        response = await client.get(
            GIPHY_SEARCH_URL,
            params={
                "api_key": GIPHY_API_KEY,
                "q": query,
                "limit": limit,
                "rating": "pg-13",
                "lang": "en",
            },
            timeout=10.0,
        )
        response.raise_for_status()
        results = response.json().get("data", [])

    gifs = []
    for r in results:
        images = r.get("images", {})
        original = images.get("original")
        # preview_gif is GIPHY's own smallest animated thumbnail —
        # exactly what a search-results grid wants; fixed_height_small
        # is a reasonable fallback for the rare result missing it.
        preview = images.get("preview_gif") or images.get("fixed_height_small")
        if not original or not original.get("url") or not preview or not preview.get("url"):
            continue
        gifs.append(
            {
                "id": r.get("id"),
                "description": r.get("title", ""),
                "url": original["url"],
                "preview_url": preview["url"],
                "width": int(original["width"]) if original.get("width") else None,
                "height": int(original["height"]) if original.get("height") else None,
            }
        )
    return gifs
