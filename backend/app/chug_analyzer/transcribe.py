"""
Speech-to-text for a chug video — what the chugger actually says, so
the hype grade can judge content (app/domain/chug_hype.py) instead of
loudness. The old hype score was the RMS volume of the two seconds
after the chug, which a TV turned up maxed out every time; nobody's
cheering for a guy chugging because his kicker scored zero anyway.

faster-whisper's "base.en" model, CPU int8: ~1-2s for a 45s clip
(measured 2026-10 on the league's real videos). The model (~145MB) is
downloaded on first use into app/chug_analyzer/models/whisper (git-
ignored, same as the vessel detector), so the first chug after a
deploy pays a few seconds extra. Best-effort: any failure returns None
and the hype grade falls back to neutral rather than blocking the chug.
"""
import os
import sys

WHISPER_MODEL = "base.en"
MODELS_DIR = os.path.join(os.path.dirname(__file__), "models", "whisper")

_model = None


def _log(msg: str) -> None:
    print(f"[transcribe] {msg}", file=sys.stderr)


def transcribe(video_path: str) -> dict | None:
    """{"duration": seconds, "segments": [{"start", "end", "text"}]} or
    None. vad_filter skips stretches with no voice, which also keeps
    whisper from hallucinating words into silence or music."""
    global _model
    try:
        from faster_whisper import WhisperModel

        if _model is None:
            _model = WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8", download_root=MODELS_DIR)
        segments, info = _model.transcribe(video_path, vad_filter=True, beam_size=1, language="en")
        return {
            "duration": round(info.duration, 2),
            "segments": [
                {"start": round(s.start, 1), "end": round(s.end, 1), "text": s.text.strip()}
                for s in segments
                if s.text.strip()
            ],
        }
    except Exception as e:
        _log(f"transcription failed: {e!r}")
        return None
