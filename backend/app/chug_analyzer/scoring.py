"""
Scoring functions. Ported verbatim from Fantasy_Helper's
bot/chug_analyzer/scoring.py.
"""
import statistics


def score_chug_time(seconds: float) -> float:
    if seconds <= 2:
        return 10
    elif seconds <= 3:
        return 9
    elif seconds <= 4:
        return 8
    elif seconds <= 5:
        return 7
    else:
        return max(4, 10 - (seconds - 5))


def compute_jitter(wrist_positions: list[tuple]) -> float:
    """
    Measures how much the wrist wobbled frame-to-frame during contact.
    Returns 0-1: near 0 = smooth steady motion, near 1 = jerky/shaky.
    """
    if len(wrist_positions) < 3:
        return 0.0

    frame_to_frame_deltas = []
    for i in range(1, len(wrist_positions)):
        x1, y1 = wrist_positions[i - 1]
        x2, y2 = wrist_positions[i]
        delta = ((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5
        frame_to_frame_deltas.append(delta)

    if not frame_to_frame_deltas:
        return 0.0

    variance = statistics.pvariance(frame_to_frame_deltas)
    # normalize into a roughly 0-1 range; tuned against real test data,
    # may need adjustment once more real chug videos are tested
    return min(1.0, variance * 500)


def score_smoothness(jitter_amount: float) -> float:
    return max(0, 10 - (jitter_amount * 10))


def score_hype(audio_energy: float) -> float:
    """
    audio_energy is 0-1 (normalized RMS loudness). More hype = better.
    """
    return min(10, audio_energy * 12)
