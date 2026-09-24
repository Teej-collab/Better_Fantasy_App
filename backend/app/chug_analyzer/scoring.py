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


# Smoothness (2026-09-24 rewrite). The old score was the variance of the
# wrist's frame-to-frame movement in raw image coordinates, so a selfie
# camera moving in the other hand, the tracker briefly losing a hand
# that's half hidden behind the can, or it flipping between the two
# hands all counted as a shaky chug — a real, visibly steady chug
# (chug 614) scored 0/10 off 5 such glitches and 4 hand switches, while
# measured against the face it was the steadiest of the league's first
# five. Now: the wrist's position relative to the mouth in face widths
# (app/chug_analyzer/contact.py), only between consecutive frames of the
# same hand, ignoring physically impossible jumps, scored on the median
# movement per frame. Cutoffs calibrated on those five real chugs
# (median 0.022-0.065 face widths/frame): up to STEADY is a full 10,
# falling linearly to 0 at SHAKY.
GLITCH_FACE_WIDTHS = 0.5
STEADY_FACE_WIDTHS = 0.05
SHAKY_FACE_WIDTHS = 0.20


def compute_wobble(wrist_track: list[dict]) -> float | None:
    """Median frame-to-frame wrist movement, in face widths, over
    consecutive same-hand frames (tracker glitches excluded). None if
    there aren't at least two such movements to measure."""
    deltas = []
    for a, b in zip(wrist_track, wrist_track[1:]):
        if b["frame"] != a["frame"] + 1 or a["hand"] != b["hand"]:
            continue
        delta = ((b["rel"][0] - a["rel"][0]) ** 2 + (b["rel"][1] - a["rel"][1]) ** 2) ** 0.5
        if delta <= GLITCH_FACE_WIDTHS:
            deltas.append(delta)
    if len(deltas) < 2:
        return None
    return statistics.median(deltas)


def score_smoothness(wobble: float | None) -> float:
    if wobble is None or wobble <= STEADY_FACE_WIDTHS:
        return 10.0
    if wobble >= SHAKY_FACE_WIDTHS:
        return 0.0
    return round(10 * (SHAKY_FACE_WIDTHS - wobble) / (SHAKY_FACE_WIDTHS - STEADY_FACE_WIDTHS), 2)


def score_hype(audio_energy: float) -> float:
    """
    audio_energy is 0-1 (normalized RMS loudness). More hype = better.
    """
    return min(10, audio_energy * 12)
