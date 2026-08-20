"""
Full chug analyzer pipeline: real detection, real motion scoring, real
audio/hype scoring. Ported verbatim from Fantasy_Helper's
bot/chug_analyzer/analyzer.py.
"""
from app.chug_analyzer.pose_detection import detect_can_to_mouth
from app.chug_analyzer.scoring import score_chug_time, compute_jitter, score_smoothness, score_hype
from app.chug_analyzer.audio_analysis import extract_hype_energy


def analyze_chug_video(video_path: str) -> dict:
    detection = detect_can_to_mouth(video_path)

    if not detection["contact"]:
        return {"can_to_mouth": False, "final": 0.0}

    time_score = score_chug_time(detection["duration_seconds"])
    jitter = compute_jitter(detection["wrist_positions"])
    smoothness_score = score_smoothness(jitter)

    chug_end_seconds = detection["end_frame"] / detection["fps"]
    audio_energy = extract_hype_energy(video_path, chug_end_seconds)
    hype_score = score_hype(audio_energy)

    final_score = round(
        (time_score * 0.5) + (smoothness_score * 0.3) + (hype_score * 0.2), 2
    )

    return {
        "can_to_mouth": True,
        "duration_seconds": detection["duration_seconds"],
        "time_score": time_score,
        "jitter": round(jitter, 3),
        "smoothness_score": round(smoothness_score, 2),
        "audio_energy": audio_energy,
        "hype_score": round(hype_score, 2),
        "final": final_score,
    }
