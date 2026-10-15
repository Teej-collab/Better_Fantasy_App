"""
Videos in chat (2026-10, commissioner's request), on web and native.

A posted video lands in the private chug-videos bucket under
"chat-videos/<conversation>/" (app/providers/chug_storage.py), never a
public host: every message a client loads carries freshly signed links
(CHAT_URL_TTL_SECONDS) and only a conversation's own participants ever
load its messages.

Every video is stored as an H.264/AAC MP4 with its index up front
(faststart), because that's the one format every browser and both
phone platforms play. An upload that already is one (the native app
asks iOS for H.264 when it picks a video) is just repackaged, which
takes a second; anything else (an iPhone's HEVC .mov from a desktop, a
WebM) is converted, capped at 1280px on the long edge. A poster frame
goes up beside it so the chat shows something before anyone taps play.
"""
import asyncio
import json
import logging
import os
import tempfile
import uuid

from app.providers import chug_storage

logger = logging.getLogger(__name__)

MAX_VIDEO_BYTES = 250 * 1024 * 1024
MAX_DURATION_SECONDS = 3 * 60
MAX_LONG_EDGE = 1280
TRANSCODE_TIMEOUT_SECONDS = 8 * 60
POSTER_LONG_EDGE = 720


class ChatVideoError(Exception):
    """A video we can't post, with the reason to show the person."""


def storage_ready() -> bool:
    return chug_storage.chug_storage_configured()


async def _run(*args: str, timeout: float) -> tuple[int, bytes]:
    proc = await asyncio.create_subprocess_exec(
        *args, stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        raise ChatVideoError("That video took too long to process. Try a shorter clip.")
    if proc.returncode != 0:
        logger.warning("%s failed: %s", args[0], err.decode(errors="replace")[-800:])
    return proc.returncode, out


async def probe(path: str) -> dict:
    code, out = await _run(
        "ffprobe", "-v", "error", "-print_format", "json", "-show_streams", "-show_format", path, timeout=30
    )
    if code != 0:
        raise ChatVideoError("That file isn't a video we can read.")
    info = json.loads(out or b"{}")
    streams = info.get("streams") or []
    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    if video is None:
        raise ChatVideoError("That file has no video in it.")
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    duration = float((info.get("format") or {}).get("duration") or video.get("duration") or 0)
    return {
        "duration": duration,
        "vcodec": video.get("codec_name"),
        "pix_fmt": video.get("pix_fmt"),
        "width": int(video.get("width") or 0),
        "height": int(video.get("height") or 0),
        "acodec": audio.get("codec_name") if audio else None,
        "format": (info.get("format") or {}).get("format_name") or "",
    }


def _playable_as_is(p: dict) -> bool:
    return (
        p["vcodec"] == "h264"
        and p["pix_fmt"] in ("yuv420p", "yuvj420p")
        and p["acodec"] in (None, "aac")
        and max(p["width"], p["height"]) <= 1920
        and ("mp4" in p["format"] or "mov" in p["format"])
    )


async def normalize(src: str, dst: str, p: dict) -> None:
    if _playable_as_is(p):
        code, _ = await _run(
            "ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-i", src,
            "-map", "0:v:0", "-map", "0:a:0?", "-c", "copy", "-movflags", "+faststart", dst,
            timeout=120,
        )
        if code == 0:
            return
    # The long edge capped at MAX_LONG_EDGE, after ffmpeg applies the
    # phone's rotation (so iw/ih are the upright size).
    scale = (
        f"scale=w='if(gte(iw,ih),min({MAX_LONG_EDGE},iw),-2)':"
        f"h='if(gte(iw,ih),-2,min({MAX_LONG_EDGE},ih))'"
    )
    code, _ = await _run(
        "ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-i", src,
        "-map", "0:v:0", "-map", "0:a:0?", "-vf", scale,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", dst,
        timeout=TRANSCODE_TIMEOUT_SECONDS,
    )
    if code != 0:
        raise ChatVideoError("We couldn't convert that video. Try a different clip.")


async def _poster(src: str, dst: str, duration: float) -> tuple[int, int]:
    """A JPEG from a second in (or the middle of a very short clip),
    upright; returns its width and height, which are the video's
    upright proportions too."""
    at = f"{min(1.0, duration / 2):.2f}"
    scale = (
        f"scale=w='if(gte(iw,ih),min({POSTER_LONG_EDGE},iw),-2)':"
        f"h='if(gte(iw,ih),-2,min({POSTER_LONG_EDGE},ih))'"
    )
    code, _ = await _run(
        "ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-ss", at, "-i", src,
        "-frames:v", "1", "-vf", scale, "-q:v", "4", dst, timeout=60,
    )
    if code != 0 or not os.path.exists(dst):
        raise ChatVideoError("We couldn't read a frame from that video.")
    code, out = await _run(
        "ffprobe", "-v", "error", "-print_format", "json", "-show_streams", dst, timeout=15
    )
    stream = (json.loads(out or b"{}").get("streams") or [{}])[0]
    return int(stream.get("width") or 0), int(stream.get("height") or 0)


async def process_upload(src: str, conversation_id: int) -> dict:
    """The stored video for a message's `video` column. Raises
    ChatVideoError with a reason the person can act on."""
    p = await probe(src)
    if p["duration"] <= 0:
        raise ChatVideoError("That video is empty.")
    if p["duration"] > MAX_DURATION_SECONDS + 1:
        raise ChatVideoError(f"Videos can be up to {MAX_DURATION_SECONDS // 60} minutes long.")

    unique = uuid.uuid4().hex
    key = f"chat-videos/{conversation_id}/{unique}.mp4"
    poster_key = f"chat-videos/{conversation_id}/{unique}.jpg"
    with tempfile.TemporaryDirectory() as work:
        mp4 = os.path.join(work, "video.mp4")
        jpg = os.path.join(work, "poster.jpg")
        await normalize(src, mp4, p)
        width, height = await _poster(mp4, jpg, p["duration"])
        await asyncio.to_thread(chug_storage.upload_object, mp4, key, "video/mp4")
        await asyncio.to_thread(chug_storage.upload_object, jpg, poster_key, "image/jpeg")
    return {
        "key": key,
        "poster_key": poster_key,
        "width": width,
        "height": height,
        "duration": round(p["duration"], 1),
    }


def public_video(stored) -> dict | None:
    """The `video` a client gets on a message: signed links plus size
    and length. None when there's no video (or no bucket to sign for)."""
    if not stored:
        return None
    if isinstance(stored, str):
        stored = json.loads(stored)
    if not storage_ready():
        return None
    ttl = chug_storage.CHAT_URL_TTL_SECONDS
    return {
        "url": chug_storage.presigned_url(stored["key"], ttl),
        "poster_url": chug_storage.presigned_url(stored["poster_key"], ttl),
        "width": stored.get("width"),
        "height": stored.get("height"),
        "duration": stored.get("duration"),
    }
