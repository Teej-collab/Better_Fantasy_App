"""The app's only outbound email path — Resend's plain REST API via
httpx (already a dependency for Discord/Google OAuth, see
app/auth/discord_oauth.py), not the `resend` SDK package, to avoid
adding a new dependency for what's a single POST call.

Mirrors app/notifications/dispatcher.py's shape for push: one function
per real email this app sends, all funneled through one private
`_send` that's the only place that actually calls out to Resend. A
send failure here must never look like the request itself failed in a
way that leaks account existence (see POST /auth/forgot-password's own
generic-response handling) — callers log and swallow, same discipline
dispatcher.py already uses for a failed push.
"""
import logging

import httpx

from app.config import require_email_configured

logger = logging.getLogger(__name__)

RESEND_API_URL = "https://api.resend.com/emails"


async def _send(to_email: str, subject: str, html_body: str) -> None:
    api_key, from_email = require_email_configured()
    async with httpx.AsyncClient() as client:
        response = await client.post(
            RESEND_API_URL,
            headers={"Authorization": f"Bearer {api_key}"},
            json={"from": from_email, "to": [to_email], "subject": subject, "html": html_body},
            timeout=10.0,
        )
        response.raise_for_status()


async def send_password_reset_email(to_email: str, reset_url: str) -> None:
    """Best-effort — POST /auth/forgot-password already returns its
    generic "if that account exists" response before this is even
    awaited far enough to know whether it succeeded, so a delivery
    failure here is logged, never raised back into that response (that
    would turn a Resend outage into an account-enumeration oracle: a
    500 only on real accounts)."""
    try:
        await _send(
            to_email,
            subject="Reset your Weekend League password",
            html_body=(
                f'<p>Someone asked to reset the password on this Weekend League account.</p>'
                f'<p><a href="{reset_url}">Choose a new password</a> — this link works once and expires in an hour.</p>'
                f"<p>If this wasn't you, you can ignore this email.</p>"
            ),
        )
    except Exception:
        logger.exception("Password reset email failed to send to %s", to_email)
