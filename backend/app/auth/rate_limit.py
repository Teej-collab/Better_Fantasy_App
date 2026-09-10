"""In-memory rate limiting for the two unauthenticated auth endpoints
that had none at all (2026-09 security audit): POST /auth/login and
POST /auth/signup, both wide open to unlimited brute-force/credential-
stuffing/signup-spam attempts.

Two independent limits, both keyed by string, both fixed-window:
  - Per target EMAIL (strict) — stops hammering one specific account's
    password, or spamming signups for one address. This is the primary
    defense and doesn't depend on network topology at all.
  - Per source IP (generous) — best-effort defense-in-depth against a
    script rotating through many different emails. Deliberately loose
    (a real ~12-person league's normal traffic should never come close
    to it): this Railway deployment's proxy-forwarding setup isn't
    verified from this repo, so request.client.host might be Railway's
    own edge IP for every visitor rather than each real client's — a
    strict IP limit risks throttling everyone at once if so. A generous
    one still catches genuine bulk scripted abuse without that risk.

In-memory and per-process is a deliberate, accepted trade-off for a
single-instance deployment this size, not an oversight — it resets on
every redeploy, which is fine for this threat model. Revisit only if
this ever runs as more than one backend instance at once (a shared
store like Redis would be needed then, since each process would
otherwise track its own separate counts)."""
import time
from collections import defaultdict

from fastapi import HTTPException

_EMAIL_WINDOW_SECONDS = 15 * 60
_EMAIL_MAX_ATTEMPTS = 5

_IP_WINDOW_SECONDS = 15 * 60
_IP_MAX_ATTEMPTS = 30

_attempts: dict[str, list[float]] = defaultdict(list)


def _check(key: str, window_seconds: int, max_attempts: int) -> None:
    now = time.monotonic()
    window_start = now - window_seconds
    recent = [t for t in _attempts[key] if t > window_start]
    if len(recent) >= max_attempts:
        raise HTTPException(status_code=429, detail="Too many attempts — try again later")
    recent.append(now)
    _attempts[key] = recent


def check_login_or_signup_rate_limit(action: str, email: str, client_ip: str | None) -> None:
    """`action` is "login" or "signup", just a namespace so the two
    endpoints' counts never collide for the same email. Checks the
    email limit first (the one that actually matters) — if that trips,
    there's no reason to also burn an IP-limit slot."""
    _check(f"{action}:email:{email}", _EMAIL_WINDOW_SECONDS, _EMAIL_MAX_ATTEMPTS)
    if client_ip:
        _check(f"{action}:ip:{client_ip}", _IP_WINDOW_SECONDS, _IP_MAX_ATTEMPTS)


def check_forgot_password_rate_limit(email: str, client_ip: str | None) -> None:
    """Same two-tier shape as login/signup above, own namespace —
    POST /auth/forgot-password is unauthenticated and now triggers a
    real outbound email, so it needs the same abuse resistance
    (someone spam-bombing a target's inbox by hammering this endpoint)
    that login/signup already had closed."""
    _check(f"forgot_password:email:{email}", _EMAIL_WINDOW_SECONDS, _EMAIL_MAX_ATTEMPTS)
    if client_ip:
        _check(f"forgot_password:ip:{client_ip}", _IP_WINDOW_SECONDS, _IP_MAX_ATTEMPTS)


def reset_for_tests() -> None:
    """Test-only. httpx's ASGITransport reports the same fixed fake
    client IP for every request, so every /auth/signup or /auth/login
    call across the whole test suite shares one IP-limit bucket — a
    real full-suite run does far more than _IP_MAX_ATTEMPTS(30) of
    those across all test files combined, well within one 15-minute
    window, which trips the 429 for later tests even though each one
    targets its own unique email and would never trip the real
    per-email limit. tests/conftest.py calls this before every test so
    each test's own attempts are the only ones counted, matching the
    generous IP limit's actual intent (catch bulk abuse, not normal
    multi-signup traffic) rather than an artifact of test-process
    state persisting for the run's full ~15+ minutes."""
    _attempts.clear()
