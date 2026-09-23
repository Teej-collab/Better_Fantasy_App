"""Pure contact math behind the chug analyzer's can-to-mouth detection
(app/chug_analyzer/contact.py) plus jitter's gap handling — the parts
testable without mediapipe, which this Python can't import."""
import math

from app.chug_analyzer.contact import (
    FACE_LEFT_LANDMARK,
    FACE_RIGHT_LANDMARK,
    MOUTH_LANDMARK,
    contact_ratio,
    longest_contact_episode,
)
from app.chug_analyzer.scoring import compute_jitter


def _face(mouth=(500.0, 800.0), width=200.0):
    points = [(0.0, 0.0)] * 468
    points[MOUTH_LANDMARK] = mouth
    points[FACE_LEFT_LANDMARK] = (mouth[0] - width / 2, mouth[1] - 50)
    points[FACE_RIGHT_LANDMARK] = (mouth[0] + width / 2, mouth[1] - 50)
    return points


def _hand(near):
    # wrist far below, one knuckle at `near` — the can-grip shape where
    # the wrist is nowhere near the mouth but the fingers are
    return [(near[0], near[1] + 400)] + [(near[0] + 5 * i, near[1] + 5 * i) for i in range(20)]


def test_ratio_uses_nearest_point_on_any_hand_not_wrist():
    face = _face()
    far_hand = _hand((900.0, 1500.0))
    drinking_hand = _hand((520.0, 800.0))  # knuckle 20px from mouth
    ratio, index = contact_ratio([far_hand, drinking_hand], face)
    assert index == 1
    assert math.isclose(ratio, 20 / 200)


def test_ratio_is_scale_invariant():
    small, _ = contact_ratio([_hand((520.0, 800.0))], _face(width=200.0))
    zoomed = [[(x * 2, y * 2) for x, y in _hand((520.0, 800.0))]]
    big_face = [(x * 2, y * 2) for x, y in _face(width=200.0)]
    large, _ = contact_ratio(zoomed, big_face)
    assert math.isclose(small, large)


def test_degenerate_face_width_is_never_contact():
    face = _face(width=0.0)
    ratio, _ = contact_ratio([_hand((500.0, 800.0))], face)
    assert ratio == math.inf


def test_episode_bridges_short_gaps_mid_chug():
    # 30fps: contact 330-400, face lost ~1.6s, contact again 450-620
    frames = list(range(330, 401)) + list(range(450, 621))
    assert longest_contact_episode(frames, 30.0) == (330, 620)


def test_episode_splits_on_long_gap_and_picks_longest():
    frames = list(range(0, 20)) + list(range(200, 400))
    assert longest_contact_episode(frames, 30.0) == (200, 399)


def test_stray_frames_are_not_a_chug():
    assert longest_contact_episode([45], 30.0) is None
    assert longest_contact_episode([10, 11, 12], 30.0) is None


def test_no_contact():
    assert longest_contact_episode([], 30.0) is None
    assert longest_contact_episode([1, 2, 3], 0.0) is None


def test_jitter_ignores_jumps_across_gaps():
    steady = [(0.5, 0.5 + 0.001 * i) for i in range(10)]
    moved = [(0.1, 0.1 + 0.001 * i) for i in range(10)]
    # every real frame-to-frame delta is identical, so no wobble at all
    assert compute_jitter(steady + [None] + moved) == 0.0
    assert compute_jitter(steady + moved) > 0.0
