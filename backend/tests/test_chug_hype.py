"""Content-based hype grading (app/domain/chug_hype.py) — the model
call itself is faked; these cover what's sent and how the grade is
read back."""
from app.domain import chug_hype

_RESULT = {
    "can_to_mouth": True, "duration_seconds": 8.3, "time_score": 6.7, "smoothness_score": 9.0,
    "hype_score": 5.0, "final": 7.05, "chug_start_seconds": 31.9, "chug_end_seconds": 40.1,
    "transcript": {
        "duration": 43.1,
        "segments": [
            {"start": 17.7, "end": 20.2, "text": "Isaiah Likely, this one's for you, pal."},
            {"start": 41.0, "end": 42.5, "text": "Never again."},
        ],
    },
}
_CONTEXT = {"owner_name": "Sam", "busts": ["Isaiah Likely (0 pts, week 6)"]}


async def _no_frames(video_path, duration, out_dir):
    return [(7.2, b"jpeg-bytes")]


async def test_grade_hype_sums_the_rubric_and_clamps_out_of_range_parts(monkeypatch):
    monkeypatch.setattr(chug_hype.config, "ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(chug_hype, "_extract_frames", _no_frames)
    sent = {}

    def fake_call(content):
        sent["content"] = content
        return {"self_roast": 9, "comedy": 2, "commitment": -1, "verdict": " Toasted the bust. ", "quote": ""}

    monkeypatch.setattr(chug_hype, "_call_claude", fake_call)

    grade = await chug_hype.grade_hype("/tmp/video.mov", _RESULT, _CONTEXT)

    assert grade == {
        "score": 6.0, "self_roast": 4, "comedy": 2, "commitment": 0,
        "verdict": "Toasted the bust.", "quote": None,
    }
    text = sent["content"][0]["text"]
    assert "Chugger: Sam" in text
    assert "Isaiah Likely (0 pts, week 6)" in text
    assert "[17.7s, before the chug] Isaiah Likely, this one's for you, pal." in text
    assert "[41.0s, after the chug] Never again." in text
    assert sent["content"][1]["text"] == "Frame at 7.2s (before the chug):"
    assert sent["content"][2]["type"] == "image"


async def test_grade_hype_is_skipped_without_a_transcript_or_api_key(monkeypatch):
    def must_not_call(content):
        raise AssertionError("model should not be called")

    monkeypatch.setattr(chug_hype, "_call_claude", must_not_call)
    monkeypatch.setattr(chug_hype.config, "ANTHROPIC_API_KEY", "test-key")
    assert await chug_hype.grade_hype("/tmp/video.mov", {**_RESULT, "transcript": None}, _CONTEXT) is None
    monkeypatch.setattr(chug_hype.config, "ANTHROPIC_API_KEY", "")
    assert await chug_hype.grade_hype("/tmp/video.mov", _RESULT, _CONTEXT) is None


async def test_grade_hype_failure_falls_back_to_none(monkeypatch):
    monkeypatch.setattr(chug_hype.config, "ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(chug_hype, "_extract_frames", _no_frames)

    def boom(content):
        raise RuntimeError("API down")

    monkeypatch.setattr(chug_hype, "_call_claude", boom)
    assert await chug_hype.grade_hype("/tmp/video.mov", _RESULT, _CONTEXT) is None
