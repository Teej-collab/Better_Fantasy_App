from httpx import ASGITransport, AsyncClient

from app.auth.session import create_session_token
from app.config import CHAT_IMAGE_HOST, DEFAULT_LEAGUE_ID
from app.main import app
from app.queries import leagues as league_queries

_VALID_BLOB_URL = f"https://{CHAT_IMAGE_HOST}/test-feedback-screenshot.png"

_SESSION_SECRET = "test-secret-thats-at-least-32-bytes-long"


def _session_cookie(user_id: int) -> dict:
    token = create_session_token(_SESSION_SECRET, user_id=user_id)
    return {"session": token}


async def _make_user(conn, suffix: str, display_name: str | None = None) -> int:
    return await conn.fetchval(
        "INSERT INTO users (email, password_hash, display_name) VALUES ($1, 'x', $2) RETURNING id",
        f"test-feedback-{suffix}@example.com", display_name or f"Test Feedback {suffix}",
    )


async def _plain_user_cookies(pool, suffix: str, display_name: str | None = None) -> dict:
    """A real, isolated, league-less test user — feedback submission
    itself has no league requirement at all, unlike the commissioner-
    gated listing endpoint below."""
    async with pool.acquire() as conn:
        user_id = await _make_user(conn, suffix, display_name)
    return _session_cookie(user_id)


async def _commissioner_cookies(pool, suffix: str) -> dict:
    """A real test user actually made a league's commissioner for the
    duration of one test — require_league_commissioner is a live
    per-league DB check (app/auth/league_context.py), not a JWT claim,
    so this is the only legitimate way to exercise the success path.
    add_member auto-activates this league for the user since they have
    no active league yet (app/queries/leagues.py)."""
    async with pool.acquire() as conn:
        user_id = await _make_user(conn, suffix)
        await league_queries.add_member(conn, DEFAULT_LEAGUE_ID, user_id, "commissioner")
    return _session_cookie(user_id)


async def _post(path, json=None, cookies=None):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        if cookies:
            client.cookies.update(cookies)
        return await client.post(path, json=json)


async def _get(path, cookies=None):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        if cookies:
            client.cookies.update(cookies)
        return await client.get(path)


async def test_submit_feedback_requires_session(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _post("/feedback", json={"message": "Add a search box please"})
    assert response.status_code == 401


async def test_submit_feedback_rejects_empty_message(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    cookies = await _plain_user_cookies(pool, "empty-msg")
    response = await _post("/feedback", json={"message": "   "}, cookies=cookies)
    assert response.status_code == 400


async def test_submit_feedback_writes_a_real_row_with_resolved_display_name(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    cookies = await _plain_user_cookies(pool, "writer", display_name="Feedback Writer")

    response = await _post(
        "/feedback",
        json={"message": "The free agents search box is great now", "page_url": "/free-agents"},
        cookies=cookies,
    )
    assert response.status_code == 200

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT submitted_by, message, page_url FROM feedback WHERE message = $1",
            "The free agents search box is great now",
        )
    assert row is not None
    assert row["submitted_by"] == "Feedback Writer"
    assert row["page_url"] == "/free-agents"


async def test_submit_feedback_rejects_empty_message_and_no_image(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    cookies = await _plain_user_cookies(pool, "empty-both")
    response = await _post("/feedback", json={"message": "   ", "image_url": None}, cookies=cookies)
    assert response.status_code == 400


async def test_submit_feedback_allows_a_screenshot_with_no_message(pool, monkeypatch):
    """A screenshot alone is a real, complete bug report — same "body
    or image, at least one" rule chat's own WS message handler already
    uses (app/routers/chat.py), not a new concept invented here."""
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    cookies = await _plain_user_cookies(pool, "image-only", display_name="Image Only Submitter")
    response = await _post("/feedback", json={"message": "  ", "image_url": _VALID_BLOB_URL}, cookies=cookies)
    assert response.status_code == 200

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT message, image_url FROM feedback WHERE submitted_by = 'Image Only Submitter'"
        )
    assert row is not None
    assert row["image_url"] == _VALID_BLOB_URL


async def test_submit_feedback_silently_drops_an_untrusted_image_url(pool, monkeypatch):
    """Same validation every other client-supplied Blob URL in this app
    gets (app/image_url.py's validate_blob_image_url) — a URL that
    doesn't actually point at our own Blob store (or GIPHY's CDN) is
    dropped rather than trusted, so this can't become a way to get an
    arbitrary attacker-hosted URL rendered back to a commissioner."""
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    cookies = await _plain_user_cookies(pool, "untrusted-image", display_name="Untrusted Image Submitter")
    response = await _post(
        "/feedback",
        json={"message": "Real message", "image_url": "https://evil.example.com/not-our-blob.png"},
        cookies=cookies,
    )
    assert response.status_code == 200

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT image_url FROM feedback WHERE submitted_by = 'Untrusted Image Submitter'"
        )
    assert row is not None
    assert row["image_url"] is None


async def test_list_feedback_requires_session(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    response = await _get("/feedback")
    assert response.status_code == 401


async def test_list_feedback_rejects_non_commissioner(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    cookies = await _plain_user_cookies(pool, "non-commish")
    response = await _get("/feedback", cookies=cookies)
    assert response.status_code in (403, 409)  # 409 if this account also has no active league yet


async def test_list_feedback_returns_real_rows_for_a_commissioner(pool, monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", _SESSION_SECRET)
    submitter_cookies = await _plain_user_cookies(pool, "listed-submitter", display_name="Listed Submitter")
    await _post(
        "/feedback",
        json={"message": "A real feedback item to list", "image_url": _VALID_BLOB_URL},
        cookies=submitter_cookies,
    )

    commissioner_cookies = await _commissioner_cookies(pool, "listing-commish")
    response = await _get("/feedback", cookies=commissioner_cookies)

    assert response.status_code == 200
    items = response.json()["items"]
    item = next(item for item in items if item["message"] == "A real feedback item to list")
    assert item["image_url"] == _VALID_BLOB_URL
