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


# ---- pose-based detection ----------------------------------------------------
from app.chug_analyzer.contact import choose_chug_episode, drinking_side, smooth_frames


def _pose(wrist_r=(360, 300), elbow_r=(420, 480), wrist_l=(200, 1000), elbow_l=(200, 800)):
    """33 pose landmarks (x, y, visibility) with shoulders 300px apart at
    y=560 and the mouth at y=440 — IMG_1527's real proportions."""
    pts = [(0.0, 0.0, 1.0)] * 33
    pts[9], pts[10] = (340, 440, 1.0), (380, 440, 1.0)
    pts[11], pts[12] = (510, 560, 1.0), (210, 560, 1.0)
    pts[13], pts[14] = (*elbow_l, 1.0), (*elbow_r, 1.0)
    pts[15], pts[16] = (*wrist_l, 1.0), (*wrist_r, 1.0)
    return pts


def test_drinking_side_wrist_up_and_elbow_up():
    assert drinking_side(_pose()) == 1


def test_pouring_is_not_drinking_elbow_down():
    # Wrist near mouth height while pouring, but the elbow hangs low.
    assert drinking_side(_pose(wrist_r=(360, 520), elbow_r=(420, 800))) is None


def test_empty_glass_raised_overhead_is_not_drinking():
    # Arm still up, but the wrist has left the mouth (>1 shoulder width).
    assert drinking_side(_pose(wrist_r=(360, 60))) is None


def test_invisible_wrist_is_ignored():
    pts = _pose()
    pts[16] = (360, 300, 0.1)
    assert drinking_side(pts) is None


FPS = 30
ALL_FACE = list(range(0, 900))  # face visible the whole clip unless a test removes it


def _without(frames, start, end):
    return [f for f in frames if not start <= f <= end]


def test_smoothing_drops_a_brief_pass_but_keeps_short_dropouts():
    chug = [f for f in range(100, 400) if not 200 <= f < 206]  # 6-frame tracker dropout mid-chug
    stray = [420, 421]  # arm passing the mouth on the way down
    smoothed = smooth_frames(chug + stray, fps=FPS)
    assert 420 not in smoothed
    assert smoothed[0] == 100 and smoothed[-1] == 399


def test_pose_chug_confirmed_by_contact_uses_pose_boundaries():
    pose = list(range(300, 600))
    contact = list(range(290, 330)) + list(range(600, 660))  # contact lingers after (wiping the mouth)
    assert choose_chug_episode(pose, contact, ALL_FACE, 900, FPS) == (300, 599, "pose")


def test_unconfirmed_pose_stretch_is_not_a_chug():
    # 526: a can held high to pour looks like drinking to pose, but no hand
    # at the mouth and the face never covered.
    pour = list(range(100, 280))
    chug = list(range(500, 650))
    contact = list(range(500, 650))
    assert choose_chug_episode(pour, contact, ALL_FACE, 900, FPS)[:2] == (500, 649)
    assert choose_chug_episode(pour, [], ALL_FACE, 900, FPS) is None


def test_face_covered_by_the_glass_is_a_chug():
    # 619: pose never fired, contact only 0.7s — but the glass covered the
    # face for 4s with the face visible either side.
    face = _without(ALL_FACE, 400, 520)
    contact = list(range(395, 416))
    start, end, _ = choose_chug_episode([], contact, face, 900, FPS)
    assert (start, end) == (395, 520)


def test_face_lost_at_the_clip_edge_or_too_long_is_not_a_chug():
    assert choose_chug_episode([], [], _without(ALL_FACE, 0, 200), 900, FPS) is None  # clip starts off-face
    assert choose_chug_episode([], [], _without(ALL_FACE, 100, 500), 900, FPS) is None  # 13s away


def test_too_short_is_not_a_chug():
    # Niko's old "0.70s": a brief hand-at-mouth moment on its own.
    assert choose_chug_episode([], list(range(100, 121)), ALL_FACE, 900, FPS) is None
