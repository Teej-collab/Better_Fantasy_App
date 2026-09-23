"""
Pure contact math for pose_detection.py — deliberately free of cv2 and
mediapipe imports so it's unit-testable from the main backend's Python
3.13 test suite (see tests/test_chug_contact.py), which can't import
mediapipe at all.

2026-09-23 rewrite, real report: IMG_9992.MOV (a clear ~9s chug)
came back "no chug detected" in production with the old metric's
closest reading at 0.371 against a 0.27 threshold — the third real miss
after two threshold bumps (0.18 -> 0.22 -> 0.27). Per-frame data from
that video showed why bumping was never going to converge: the old
metric measured WRIST-to-mouth, but while drinking, the can sits
between the hand and the mouth, so the wrist stays a full can-length
below the lips for the entire chug (0.38-0.52 in normalized units
throughout most of it). Whether a video passed depended on framing.

Measured on the same video instead: the closest point on EITHER hand
(any of mediapipe's 21 landmarks — the knuckles and fingertips wrapped
around the can are what's actually up near the face), in pixel space
(normalized x/y are squashed differently on a 1080x1920 portrait
frame), divided by face width. That ratio is 0.01-0.34 through
nearly the whole chug and 1.1+ everywhere else (showing the can to the
camera, talking) — a wide, framing-independent gap.
"""
import math

MOUTH_LANDMARK = 13  # face mesh: upper inner lip
FACE_LEFT_LANDMARK = 234  # face mesh: cheek edges, for face width
FACE_RIGHT_LANDMARK = 454

# Nearest hand point to mouth, as a fraction of face width. Real data:
# chug frames 0.01-0.34, non-chug frames 1.1+ — 0.5 sits well inside
# that gap on both sides.
CONTACT_RATIO = 0.5

# Mid-chug, the face routinely drops out (head tilted back, can
# covering the mouth) and the ratio briefly spikes when face mesh
# misplaces the mouth on a steeply tilted head — IMG_9992 had a ~1.6s
# stretch like that in the middle of one continuous chug. Contact
# frames closer together than this are one chug, not two.
MAX_GAP_SECONDS = 2.0

# A single stray frame (hand brushing the chin) isn't a chug.
MIN_CONTACT_SECONDS = 0.5


def contact_ratio(hands_px: list[list[tuple[float, float]]], face_px: list[tuple[float, float]]) -> tuple[float, int]:
    """(ratio, index of the nearest hand). All points are pixel
    coordinates; face_px is the full face-mesh landmark list."""
    mouth = face_px[MOUTH_LANDMARK]
    face_width = math.dist(face_px[FACE_LEFT_LANDMARK], face_px[FACE_RIGHT_LANDMARK])
    if face_width <= 0:
        return math.inf, 0
    best, best_hand = math.inf, 0
    for i, hand in enumerate(hands_px):
        for point in hand:
            d = math.dist(point, mouth)
            if d < best:
                best, best_hand = d, i
    return best / face_width, best_hand


def longest_contact_episode(contact_frames: list[int], fps: float) -> tuple[int, int] | None:
    """Groups contact frames into episodes (splitting on gaps longer
    than MAX_GAP_SECONDS) and returns (start_frame, end_frame) of the
    longest one that has enough contact frames to count, else None."""
    if not contact_frames or fps <= 0:
        return None
    max_gap = MAX_GAP_SECONDS * fps
    min_frames = max(1, math.ceil(MIN_CONTACT_SECONDS * fps))

    episodes = []
    start = prev = contact_frames[0]
    count = 1
    for f in contact_frames[1:]:
        if f - prev > max_gap:
            episodes.append((start, prev, count))
            start, count = f, 0
        prev = f
        count += 1
    episodes.append((start, prev, count))

    eligible = [e for e in episodes if e[2] >= min_frames]
    if not eligible:
        return None
    start, end, _ = max(eligible, key=lambda e: e[1] - e[0])
    return start, end
