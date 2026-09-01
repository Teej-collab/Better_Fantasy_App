"""
Thin wrapper around Google's OAuth2/OpenID Connect endpoints — same
shape as app/auth/discord_oauth.py. Not testable end-to-end without a
real registered Google Cloud OAuth client, so this is covered by
mocked tests rather than a real network call — worth a real live login
test once real credentials exist.
"""
from urllib.parse import urlencode

import httpx

from app.auth.config import GoogleAuthConfig

GOOGLE_AUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"


def build_authorize_url(config: GoogleAuthConfig, state: str) -> str:
    params = {
        "client_id": config.client_id,
        "redirect_uri": config.redirect_uri,
        "response_type": "code",
        # openid+profile+email is the minimum that gets a stable "sub"
        # (the actual identity key — see queries/auth.py) plus a real,
        # Google-verified email and display name.
        "scope": "openid email profile",
        "state": state,
    }
    return f"{GOOGLE_AUTH_BASE}?{urlencode(params)}"


async def exchange_code_for_token(config: GoogleAuthConfig, code: str) -> str:
    async with httpx.AsyncClient() as client:
        response = await client.post(
            GOOGLE_TOKEN_URL,
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


async def fetch_google_user(access_token: str) -> dict:
    """Returns Google's userinfo payload — the fields this app actually
    reads are `sub` (Google's stable user id, a string, not numeric —
    see the google_user_id migration), `email`, and `name`."""
    async with httpx.AsyncClient() as client:
        response = await client.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        response.raise_for_status()
        return response.json()
