"""Chat video posting (app/domain/chat_video.py): probing, converting to
an H.264 MP4 every player handles, the poster frame, and the signed
links a message carries. Needs ffmpeg/ffprobe on PATH; the bucket is
stubbed."""
import asyncio
import json
import shutil
import subprocess

import pytest

from app.domain import chat_video
from app.providers import chug_storage

pytestmark = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="needs ffmpeg")


def _make_clip(path, codec: str, seconds: int = 2, size: str = "320x568"):
    subprocess.run(
        ["ffmpeg", "-nostdin", "-loglevel", "error", "-y",
         "-f", "lavfi", "-i", f"testsrc=duration={seconds}:size={size}:rate=24",
         "-f", "lavfi", "-i", f"sine=duration={seconds}",
         "-c:v", codec, "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(path)],
        check=True,
    )


def test_h264_clip_is_kept_and_hevc_is_converted(tmp_path):
    h264 = tmp_path / "a.mp4"
    _make_clip(h264, "libx264")
    hevc = tmp_path / "b.mov"
    _make_clip(hevc, "libx265")

    async def run():
        p1 = await chat_video.probe(str(h264))
        p2 = await chat_video.probe(str(hevc))
        assert chat_video._playable_as_is(p1)
        assert not chat_video._playable_as_is(p2)
        out = tmp_path / "out.mp4"
        await chat_video.normalize(str(hevc), str(out), p2)
        p3 = await chat_video.probe(str(out))
        assert p3["vcodec"] == "h264" and p3["acodec"] == "aac"

    asyncio.run(run())


def test_process_upload_stores_video_and_poster(tmp_path, monkeypatch):
    clip = tmp_path / "c.mp4"
    _make_clip(clip, "libx264", size="640x360")
    uploaded = {}
    monkeypatch.setattr(chug_storage, "upload_object", lambda path, key, ctype: uploaded.__setitem__(key, ctype))

    stored = asyncio.run(chat_video.process_upload(str(clip), 42))

    assert stored["key"].startswith("chat-videos/42/") and stored["key"].endswith(".mp4")
    assert uploaded[stored["key"]] == "video/mp4"
    assert uploaded[stored["poster_key"]] == "image/jpeg"
    assert stored["width"] > stored["height"]  # landscape stays landscape
    assert 1.5 <= stored["duration"] <= 2.5


def test_too_long_or_not_a_video_is_refused(tmp_path, monkeypatch):
    monkeypatch.setattr(chat_video, "MAX_DURATION_SECONDS", 1)
    clip = tmp_path / "long.mp4"
    _make_clip(clip, "libx264", seconds=3)
    with pytest.raises(chat_video.ChatVideoError, match="up to"):
        asyncio.run(chat_video.process_upload(str(clip), 1))

    junk = tmp_path / "junk.mp4"
    junk.write_bytes(b"not a video")
    with pytest.raises(chat_video.ChatVideoError):
        asyncio.run(chat_video.process_upload(str(junk), 1))


def test_public_video_signs_both_links(monkeypatch):
    monkeypatch.setattr(chat_video, "storage_ready", lambda: True)
    monkeypatch.setattr(chug_storage, "presigned_url", lambda key, ttl: f"https://signed/{key}?ttl={ttl}")
    stored = {"key": "chat-videos/1/x.mp4", "poster_key": "chat-videos/1/x.jpg", "width": 720, "height": 1280, "duration": 9.5}

    out = chat_video.public_video(json.dumps(stored))

    assert out["url"].startswith("https://signed/chat-videos/1/x.mp4")
    assert out["poster_url"].startswith("https://signed/chat-videos/1/x.jpg")
    assert (out["width"], out["height"], out["duration"]) == (720, 1280, 9.5)
    assert chat_video.public_video(None) is None


def test_processing_video_has_poster_but_no_link_until_ready(tmp_path, monkeypatch):
    clip = tmp_path / "d.mp4"
    _make_clip(clip, "libx264")
    uploaded = {}
    monkeypatch.setattr(chug_storage, "upload_object", lambda path, key, ctype: uploaded.__setitem__(key, ctype))
    monkeypatch.setattr(chat_video, "storage_ready", lambda: True)
    monkeypatch.setattr(chug_storage, "presigned_url", lambda key, ttl: f"https://signed/{key}")

    stored, probed = asyncio.run(chat_video.prepare(str(clip), 7))
    # Only the poster is up so far; the message can go out now.
    assert list(uploaded) == [stored["poster_key"]]
    shown = chat_video.public_video(stored)
    assert shown["status"] == "processing" and shown["url"] is None and shown["poster_url"]

    done = asyncio.run(chat_video.finish(str(clip), stored, probed))
    assert uploaded[stored["key"]] == "video/mp4"
    assert chat_video.public_video(done)["url"] == f"https://signed/{stored['key']}"

    # A conversion lost to a restart reads as failed, not spinning forever.
    stale = {**stored, "started_at": 0}
    assert chat_video.public_video(stale)["status"] == "failed"
