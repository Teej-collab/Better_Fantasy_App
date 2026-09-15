"""
S3-compatible storage for chug videos, backed by a Railway Bucket
(named "chug-videos" in the Railway project, provisioned 2026-09-15
specifically for this). Before this, a chug's video was analyzed and
immediately discarded (see app/routers/chug.py's original
_process_chug_upload) — nothing was ever kept for the rest of the
league to watch.

Credentials come from Railway's own bucket reference variables
(CHUG_BUCKET_NAME/ACCESS_KEY_ID/SECRET_ACCESS_KEY/ENDPOINT — see
backend/.env.example), set on the backend service as
${{chug-videos.BUCKET}} etc. Plain boto3 S3 calls throughout, so this
would work unchanged against any other S3-compatible bucket.

Buckets are private — there is no public-URL mode (see Railway's own
storage-buckets docs). The only way anything here reaches a browser is
a short-lived presigned GET URL, handed out by
app/routers/chug.py's GET /chug/{id}/video only after that request has
already proven real league membership. The object key itself (what
chug_scores.video_url stores) is never treated as a public link.
"""
import os
from functools import lru_cache

import boto3
from botocore.config import Config

CHUG_BUCKET_NAME = os.getenv("CHUG_BUCKET_NAME")
CHUG_BUCKET_ACCESS_KEY_ID = os.getenv("CHUG_BUCKET_ACCESS_KEY_ID")
CHUG_BUCKET_SECRET_ACCESS_KEY = os.getenv("CHUG_BUCKET_SECRET_ACCESS_KEY")
CHUG_BUCKET_REGION = os.getenv("CHUG_BUCKET_REGION", "auto")
CHUG_BUCKET_ENDPOINT = os.getenv("CHUG_BUCKET_ENDPOINT")

# Long enough for a real viewing session (including scrubbing around on
# a slow connection), short enough that a leaked/logged URL doesn't
# stay live for long. Real access control is the league-membership
# check every fresh request for one of these runs through, not this
# expiry — this is just blast-radius limiting.
PRESIGNED_URL_TTL_SECONDS = 15 * 60

CONTENT_TYPE_BY_EXT = {
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".m4v": "video/x-m4v",
}


def chug_storage_configured() -> bool:
    """Same optional-at-import, fail-loud-at-use pattern as the rest of
    app/config.py's optional providers (GIPHY_API_KEY, VAPID, RESEND) —
    a chug can still be graded and paid down against debt with storage
    unconfigured (local dev, or before the bucket existed at all); it
    just won't have a video to show afterward."""
    return bool(CHUG_BUCKET_NAME and CHUG_BUCKET_ACCESS_KEY_ID and CHUG_BUCKET_SECRET_ACCESS_KEY and CHUG_BUCKET_ENDPOINT)


@lru_cache
def _client():
    if not chug_storage_configured():
        raise RuntimeError(
            "Chug video storage isn't configured — set CHUG_BUCKET_NAME, "
            "CHUG_BUCKET_ACCESS_KEY_ID, CHUG_BUCKET_SECRET_ACCESS_KEY, and "
            "CHUG_BUCKET_ENDPOINT (see .env.example)."
        )
    return boto3.client(
        "s3",
        endpoint_url=CHUG_BUCKET_ENDPOINT,
        aws_access_key_id=CHUG_BUCKET_ACCESS_KEY_ID,
        aws_secret_access_key=CHUG_BUCKET_SECRET_ACCESS_KEY,
        region_name=CHUG_BUCKET_REGION,
        config=Config(signature_version="s3v4"),
    )


def object_key(league_id: int, season: int, week: int | None, unique: str, ext: str) -> str:
    return f"chug-videos/{league_id}/{season}/{week or 0}/{unique}{ext}"


def upload_video(local_path: str, key: str, ext: str) -> None:
    """Synchronous (boto3 has no native asyncio client) — callers run
    this via asyncio.to_thread so it doesn't block the event loop for
    however long the real upload takes."""
    content_type = CONTENT_TYPE_BY_EXT.get(ext, "application/octet-stream")
    _client().upload_file(local_path, CHUG_BUCKET_NAME, key, ExtraArgs={"ContentType": content_type})


def presigned_video_url(key: str) -> str:
    return _client().generate_presigned_url(
        "get_object",
        Params={"Bucket": CHUG_BUCKET_NAME, "Key": key},
        ExpiresIn=PRESIGNED_URL_TTL_SECONDS,
    )
