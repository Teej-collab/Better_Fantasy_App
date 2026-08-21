"""
Auth config, loaded lazily (only when auth routes are actually hit) —
same pattern as app/providers/espn/config.py, for the same reason: a
developer not touching auth shouldn't need these set just to run the
backend.

Split into two classes so /auth/me and /auth/logout — which only ever
verify or clear a session cookie — don't require Discord application
credentials they never use. Only /auth/discord/login and
/auth/discord/callback need the full DiscordAuthConfig.
"""
import os

from app.config import _require


class SessionConfig:
    def __init__(self):
        self.session_secret = _require("SESSION_SECRET")
        # true in real production (HTTPS) — false for local dev, which runs
        # over plain http (including from a phone on the LAN), where a
        # Secure cookie won't be set at all.
        self.cookie_secure = os.getenv("SESSION_COOKIE_SECURE", "false").lower() == "true"
        # Local dev: frontend and backend share a site (same hostname, just
        # different ports — tjs-macbook-air.local:3000 / :8000), so
        # SameSite=Lax already lets the browser attach the cookie to the
        # frontend's fetch(credentials:"include") calls. Real production
        # deploys the frontend and backend to two genuinely different
        # domains (vercel.app / railway.app) — a real cross-SITE request,
        # which Lax deliberately never attaches cookies to (it only allows
        # top-level navigations, e.g. the OAuth redirect itself — that part
        # already worked). Cross-site fetch needs SameSite=None, which
        # browsers only honor when Secure is also set — exactly the
        # cookie_secure flag above, so this just follows it.
        self.cookie_samesite = "none" if self.cookie_secure else "lax"


class DiscordAuthConfig(SessionConfig):
    def __init__(self):
        super().__init__()
        self.client_id = _require("DISCORD_CLIENT_ID")
        self.client_secret = _require("DISCORD_CLIENT_SECRET")
        self.redirect_uri = _require("DISCORD_REDIRECT_URI")
        # Optional: matches Fantasy_Helper's bot/config.py COMMISSIONER_DISCORD_ID
        # pattern. No commissioner-only features exist yet — this just makes
        # the role available on the session for when they do.
        self.commissioner_discord_id = os.getenv("COMMISSIONER_DISCORD_ID")
        self.frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000")
