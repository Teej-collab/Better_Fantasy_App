"""
Full chug analyzer pipeline: real detection, real motion scoring, and
a transcript of what was said for the content-based hype grade
(app/domain/chug_hype.py, graded by the main backend). Originally
ported from Fantasy_Helper's bot/chug_analyzer/analyzer.py.
"""
from app.chug_analyzer.pose_detection import detect_can_to_mouth
from app.chug_analyzer.scoring import NEUTRAL_HYPE, compute_wobble, final_grade, score_chug_time, score_smoothness
from app.chug_analyzer.transcribe import transcribe


def analyze_chug_video(video_path: str) -> dict:
    detection = detect_can_to_mouth(video_path)

    if not detection["contact"]:
        return {"can_to_mouth": False, "final": 0.0}

    time_score = score_chug_time(detection["duration_seconds"])
    wobble = compute_wobble(detection["wrist_track"])
    smoothness_score = score_smoothness(wobble)

    return {
        "can_to_mouth": True,
        "duration_seconds": detection["duration_seconds"],
        "time_score": time_score,
        # Median wrist movement per frame in face widths (None if too
        # few frames to measure) — see scoring.compute_wobble.
        "wobble": round(wobble, 4) if wobble is not None else None,
        "smoothness_score": round(smoothness_score, 2),
        "hype_score": NEUTRAL_HYPE,
        "final": final_grade(time_score, smoothness_score, NEUTRAL_HYPE),
        # Where the chug sits in the clip, and everything said in it,
        # for the hype grader.
        "chug_start_seconds": round(detection["start_frame"] / detection["fps"], 2),
        "chug_end_seconds": round(detection["end_frame"] / detection["fps"], 2),
        "transcript": transcribe(video_path),
    }
