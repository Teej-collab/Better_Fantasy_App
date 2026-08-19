"""
Thin wrapper around Discord's OAuth2 endpoints. Not testable end-to-end
without a real registered Discord application (see DEVELOPMENT.md), so
this is covered by mocked tests (tests/test_auth.py) rather than a real
network call — worth a real live login test once real credentials exist.
"""
from urllib.parse import urlencode

import httpx

from app.auth.config import DiscordAuthConfig

DISCORD_API_BASE = "https://discord.com/api"


def build_authorize_url(config: DiscordAuthConfig, state: str) -> str:
    params = {
        "client_id": config.client_id,
        "redirect_uri": config.redirect_uri,
        "response_type": "code",
        "scope": "identify",
        "state": state,
    }
    return f"{DISCORD_API_BASE}/oauth2/authorize?{urlencode(params)}"


async def exchange_code_for_token(config: DiscordAuthConfig, code: str) -> str:
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{DISCORD_API_BASE}/oauth2/token",
            data={
                "client_id": config.client_id,
                "client_secret": config.client_secret,
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": config.redirect_uri,
            },
        )
        response.raise_for_status()
        return response.json()["access_token"]


async def fetch_discord_user(access_token: str) -> dict:
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{DISCORD_API_BASE}/users/@me",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        response.raise_for_status()
        return response.json()
