"""
Session as a signed JWT in an httpOnly cookie — no server-side session
table. Reasonable for a ~12-person private league; revisit if real
session revocation (e.g. "log out everywhere") is ever needed.
"""
import time

import jwt

SESSION_COOKIE_NAME = "session"
SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30  # 30 days


def create_session_token(
    secret: str, *, user_id: int, owner_id: int, discord_user_id: int, is_commissioner: bool
) -> str:
    payload = {
        "user_id": user_id,
        "owner_id": owner_id,
        "discord_user_id": discord_user_id,
        "is_commissioner": is_commissioner,
        "exp": int(time.time()) + SESSION_MAX_AGE_SECONDS,
    }
    return jwt.encode(payload, secret, algorithm="HS256")


def decode_session_token(secret: str, token: str) -> dict | None:
    try:
        return jwt.decode(token, secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
