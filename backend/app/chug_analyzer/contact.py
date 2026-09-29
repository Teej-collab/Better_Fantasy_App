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


def wrist_relative_to_mouth(hand_px: list[tuple[float, float]], face_px: list[tuple[float, float]]) -> tuple[float, float]:
    """Wrist (hand landmark 0) position relative to the mouth, in face
    widths — for smoothness (app/chug_analyzer/scoring.py). Relative to
    the face rather than the frame, so a selfie camera moving in the
    other hand doesn't read as a shaky drinking hand."""
    mouth = face_px[MOUTH_LANDMARK]
    face_width = math.dist(face_px[FACE_LEFT_LANDMARK], face_px[FACE_RIGHT_LANDMARK]) or 1.0
    wrist = hand_px[0]
    return ((wrist[0] - mouth[0]) / face_width, (wrist[1] - mouth[1]) / face_width)


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


# ---- Pose-based drinking detection (2026-09-29) -----------------------------
#
# The contact metric above needs face mesh AND a hand in the same frame,
# and face mesh loses the face the moment a head tips back — worst of
# all from a low, upward-angled phone, where the chin and beard are all
# that's left. Real report: IMG_1527 (a clear ~10s chug, 0:26-0:36) came
# back "no clear angle" with face mesh blank for the entire chug, and a
# chug whose contact frames only overlapped for 0.7s posted a 0.70s time.
#
# mediapipe's body-pose model keeps tracking through that — it infers the
# nose/mouth from the whole upper body, not the face alone. Measured on
# IMG_1527 (pose y, lower = higher on screen): from 26.0s to 36.0s the
# drinking wrist sat well above the mouth (0.13-0.24 vs 0.32-0.36) with
# the elbow raised above the shoulder (0.26-0.40 vs 0.41-0.45); pouring
# the beer beforehand put a wrist near mouth height too, but with the
# elbow down at 0.6-0.7 — so "wrist up AND elbow up" is the chug.
POSE_MOUTH_LEFT, POSE_MOUTH_RIGHT = 9, 10
POSE_SHOULDERS = (11, 12)
POSE_ELBOWS = (13, 14)
POSE_WRISTS = (15, 16)
POSE_MIN_VISIBILITY = 0.3

# In shoulder widths (a body scale that survives the face disappearing).
WRIST_ABOVE_MOUTH_SLACK = 0.5  # wrist no lower than half a shoulder width below the mouth
ELBOW_ABOVE_SHOULDER_SLACK = 0.5  # elbow no lower than half a shoulder width below its shoulder
# ...and the wrist still near the mouth. IMG_1527: 0.31-0.89 throughout
# the chug, then 0.95-1.12 the moment the empty glass came off the lips
# and went up overhead — without this cap that celebration raise read
# as more chug (end 36.4s instead of ~35.8s).
WRIST_MAX_MOUTH_DISTANCE = 1.0

# Nobody finishes a drink in under 1.5s — anything shorter is a hand
# passing the face, not a chug.
MIN_CHUG_SECONDS = 1.5

# A typical face is ~0.4 shoulder widths across — converts pose wrist
# movement into the face-width units scoring.py's smoothness cutoffs
# were calibrated in, for frames where there's no face mesh to measure.
FACE_WIDTH_PER_SHOULDER_WIDTH = 0.4


def drinking_side(pose_px: list[tuple[float, float, float]]) -> int | None:
    """Which arm (0 = left, 1 = right) is in a drinking position this
    frame, or None. pose_px: mediapipe pose landmarks as (x_px, y_px,
    visibility)."""
    sh_l, sh_r = pose_px[POSE_SHOULDERS[0]], pose_px[POSE_SHOULDERS[1]]
    shoulder_width = math.dist(sh_l[:2], sh_r[:2])
    if shoulder_width <= 0:
        return None
    mouth_x = (pose_px[POSE_MOUTH_LEFT][0] + pose_px[POSE_MOUTH_RIGHT][0]) / 2
    mouth_y = (pose_px[POSE_MOUTH_LEFT][1] + pose_px[POSE_MOUTH_RIGHT][1]) / 2
    best_side, best_height = None, math.inf
    for side in (0, 1):
        shoulder, elbow, wrist = pose_px[POSE_SHOULDERS[side]], pose_px[POSE_ELBOWS[side]], pose_px[POSE_WRISTS[side]]
        if wrist[2] < POSE_MIN_VISIBILITY or elbow[2] < POSE_MIN_VISIBILITY:
            continue
        wrist_ok = wrist[1] <= mouth_y + WRIST_ABOVE_MOUTH_SLACK * shoulder_width
        elbow_ok = elbow[1] <= shoulder[1] + ELBOW_ABOVE_SHOULDER_SLACK * shoulder_width
        near_mouth = math.dist(wrist[:2], (mouth_x, mouth_y)) <= WRIST_MAX_MOUTH_DISTANCE * shoulder_width
        if wrist_ok and elbow_ok and near_mouth and wrist[1] < best_height:
            best_side, best_height = side, wrist[1]
    return best_side


def pose_wrist_relative_to_mouth(pose_px: list[tuple[float, float, float]], side: int) -> tuple[float, float]:
    """Same units as wrist_relative_to_mouth (face widths), from pose
    alone — face width estimated from shoulder width."""
    sh_l, sh_r = pose_px[POSE_SHOULDERS[0]], pose_px[POSE_SHOULDERS[1]]
    face_width = (math.dist(sh_l[:2], sh_r[:2]) * FACE_WIDTH_PER_SHOULDER_WIDTH) or 1.0
    mouth_x = (pose_px[POSE_MOUTH_LEFT][0] + pose_px[POSE_MOUTH_RIGHT][0]) / 2
    mouth_y = (pose_px[POSE_MOUTH_LEFT][1] + pose_px[POSE_MOUTH_RIGHT][1]) / 2
    wrist = pose_px[POSE_WRISTS[side]]
    return ((wrist[0] - mouth_x) / face_width, (wrist[1] - mouth_y) / face_width)


# A frame only counts if most of the frames within this many seconds
# either side of it are drinking frames too. IMG_1527: the arm coming
# back DOWN past the mouth after the chug flagged for 2 frames at 36.7s,
# and the gap tolerance stitched that onto the chug (+0.8s).
POSE_SMOOTHING_SECONDS = 0.25


def smooth_frames(frames: list[int], fps: float) -> list[int]:
    """Majority filter over a ±POSE_SMOOTHING_SECONDS window."""
    radius = max(1, round(POSE_SMOOTHING_SECONDS * fps))
    flagged = set(frames)
    return [
        f for f in frames
        if sum(1 for g in range(f - radius, f + radius + 1) if g in flagged) > radius
    ]


def _runs(frames: list[int], max_gap_frames: float) -> list[tuple[int, int]]:
    """Sorted frame numbers -> (start, end) runs, splitting on gaps
    longer than max_gap_frames."""
    if not frames:
        return []
    runs, start, prev = [], frames[0], frames[0]
    for f in frames[1:]:
        if f - prev > max_gap_frames:
            runs.append((start, prev))
            start = f
        prev = f
    runs.append((start, prev))
    return runs


# ---- Choosing the chug (2026-09-29) -----------------------------------------
#
# Neither signal is enough alone. Measured on the league's 10 real chug
# videos plus IMG_1527, each hand-labeled from quarter-second frames:
#   - pose is right on full-body shots (612, 613, 617, 618, IMG_1527) but
#     flickers on close-up selfies, where the shoulders sit at the frame
#     edge and the elbows are off-screen (614, 620), and it mistook a
#     can held high to POUR for drinking (526);
#   - hand-near-mouth contact is right on those close-ups but misses
#     whole stretches when the face drops out;
#   - the face itself disappearing is evidence: the glass covers it
#     (619 — Niko's "0.70s", really 4.35s — and IMG_1527).
# So every signal proposes chug frames, and a stretch only counts if it's
# CONFIRMED by a hand at the mouth or the face being covered — the pour
# had neither. Chosen by searching these rules against those labels:
# mean error 0.56s (old analyzer: 3.47s), 9 of 11 within a second.
EPISODE_MAX_GAP_SECONDS = 0.5
MIN_CONFIRMING_CONTACT_SECONDS = 0.2
MIN_CONFIRMING_FACE_LOST_SECONDS = 0.5
# A face-lost run only counts as "covered by the glass" if it's no longer
# than a real chug and the face is visible on both sides of it — not the
# phone pointing away, or the start/end of the clip.
MAX_FACE_COVERED_SECONDS = 8.0
# When pose covers at least this much of a stretch, its own start/end
# are the tighter boundaries (contact lingers — a hand wiping the mouth
# after 617's chug added 2s).
TRIM_TO_POSE_COVERAGE = 0.4


def choose_chug_episode(
    pose_frames: list[int], contact_frames: list[int], face_frames: list[int], total_frames: int, fps: float,
) -> tuple[int, int, str] | None:
    """(start_frame, end_frame, source) of the chug, or None. source is
    what set the boundaries: "pose" or "combined"."""
    if fps <= 0:
        return None
    pose = smooth_frames(sorted(pose_frames), fps)
    contact = set(contact_frames)
    face = set(face_frames)

    candidates = set(pose) | contact
    face_lost = [f for f in range(total_frames) if f not in face]
    for s, e in _runs(face_lost, 0.2 * fps):
        if s > 0 and e < total_frames - 1 and (e - s) / fps <= MAX_FACE_COVERED_SECONDS:
            candidates.update(range(s, e + 1))

    best = None
    for s, e in _runs(sorted(candidates), EPISODE_MAX_GAP_SECONDS * fps):
        if (e - s) / fps < MIN_CHUG_SECONDS:
            continue
        contact_s = sum(1 for f in contact if s <= f <= e) / fps
        face_lost_s = sum(1 for f in range(s, e + 1) if f not in face) / fps
        if contact_s < MIN_CONFIRMING_CONTACT_SECONDS and face_lost_s < MIN_CONFIRMING_FACE_LOST_SECONDS:
            continue
        source = "combined"
        pose_in = [f for f in pose if s <= f <= e]
        if pose_in and len(pose_in) >= TRIM_TO_POSE_COVERAGE * (e - s + 1):
            s, e, source = pose_in[0], pose_in[-1], "pose"
        if best is None or e - s > best[1] - best[0]:
            best = (s, e, source)
    if best is not None and (best[1] - best[0]) / fps < MIN_CHUG_SECONDS:
        return None
    return best
