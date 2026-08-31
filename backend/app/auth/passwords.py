"""Password hashing for email/password accounts (Phase 5 of the
multi-league migration — see TODO.md's PHASE 9 entry). bcrypt handles
its own salting per call, so no separate salt column is needed —
password_hash on users is the complete, self-contained hash."""
import bcrypt

MIN_PASSWORD_LENGTH = 8


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        # Malformed hash (shouldn't happen for a real stored value, but
        # a corrupt/foreign string here should read as "wrong password,"
        # not crash the login endpoint.
        return False
