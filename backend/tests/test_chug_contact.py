"""Pure contact math behind the chug analyzer's can-to-mouth detection
(app/chug_analyzer/contact.py) plus smoothness scoring — the parts
testable without mediapipe, which this Python can't import."""
import math

import pytest

from app.chug_analyzer.contact import (
    FACE_LEFT_LANDMARK,
    FACE_RIGHT_LANDMARK,
    MOUTH_LANDMARK,
    contact_ratio,
    longest_contact_episode,
    wrist_relative_to_mouth,
)
from app.chug_analyzer.scoring import compute_wobble, score_smoothness


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


def _track(points, hands=None, start=0):
    hands = hands or ["Right"] * len(points)
    return [{"frame": start + i, "rel": p, "hand": h} for i, (p, h) in enumerate(zip(points, hands))]


def test_wrist_position_is_relative_to_the_mouth_in_face_widths():
    face = _face(mouth=(500.0, 800.0), width=200.0)
    hand = [(560.0, 900.0)] + [(0.0, 0.0)] * 20
    assert wrist_relative_to_mouth(hand, face) == (0.3, 0.5)
    # The same hand-to-face geometry anywhere in a zoomed/moved frame reads the same.
    moved = [(x * 2 + 100, y * 2 - 50) for x, y in hand]
    moved_face = [(x * 2 + 100, y * 2 - 50) for x, y in face]
    assert wrist_relative_to_mouth(moved, moved_face) == (0.3, 0.5)


def test_wobble_is_the_median_same_hand_movement():
    steady = _track([(0.1, 0.5 + 0.02 * i) for i in range(6)])
    assert compute_wobble(steady) == pytest.approx(0.02)


def test_wobble_ignores_hand_switches_gaps_and_tracker_glitches():
    points = [(0.1, 0.5), (0.1, 0.52), (0.1, 0.54), (0.9, 0.54), (0.1, 0.56), (0.1, 0.58), (0.1, 0.60)]
    hands = ["Right", "Right", "Right", "Left", "Right", "Right", "Right"]
    # Frame 3 is the other hand (two switch pairs, skipped); 3->4 also
    # isn't consecutive-same-hand. A 0.8-face-width snap is a glitch.
    track = _track(points, hands)
    glitch = _track([(0.1, 0.62), (0.9, 0.62), (0.1, 0.64)], start=7)
    assert compute_wobble(track + glitch) == pytest.approx(0.02)
    # A gap in frames is never measured across.
    gapped = _track([(0.1, 0.5), (0.1, 0.52)]) + _track([(0.4, 0.9), (0.4, 0.92)], start=10)
    assert compute_wobble(gapped) == pytest.approx(0.02)


def test_smoothness_scale():
    assert score_smoothness(None) == 10.0
    assert score_smoothness(0.02) == 10.0
    assert score_smoothness(0.05) == 10.0
    assert score_smoothness(0.125) == 5.0
    assert score_smoothness(0.20) == 0.0
    assert score_smoothness(0.5) == 0.0
