"""
Private storage for player-card photos (2026-10), in the same private
Railway bucket as chug videos (app/providers/chug_storage.py) under
card-photos/. Photos are only ever handed out as short-lived signed
links, and only to members of the photo's league (app/routers/profile.py)
— never bundled in the app or served from the website's public folder.
"""
import uuid

from app.providers import chug_storage

CONTENT_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/heic": ".heic"}
MAX_BYTES = 8 * 1024 * 1024
# Long enough for a phone to load and cache the cards; short enough that
# a link copied out of the app soon stops working.
SIGNED_URL_TTL_SECONDS = 3600


def configured() -> bool:
    return chug_storage.chug_storage_configured()


def object_key(league_id: int, owner_id: int, content_type: str) -> str:
    return f"card-photos/{league_id}/{owner_id}/{uuid.uuid4().hex}{CONTENT_TYPES[content_type]}"


def upload(data: bytes, key: str, content_type: str) -> None:
    """Synchronous (boto3) — callers use asyncio.to_thread."""
    chug_storage._client().put_object(
        Bucket=chug_storage.CHUG_BUCKET_NAME, Key=key, Body=data, ContentType=content_type,
    )


def delete(key: str) -> None:
    chug_storage._client().delete_object(Bucket=chug_storage.CHUG_BUCKET_NAME, Key=key)


def signed_url(key: str) -> str:
    return chug_storage._client().generate_presigned_url(
        "get_object",
        Params={"Bucket": chug_storage.CHUG_BUCKET_NAME, "Key": key},
        ExpiresIn=SIGNED_URL_TTL_SECONDS,
    )
