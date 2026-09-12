"""
Can-to-mouth contact detection. Tracks wrist-to-mouth distance per
frame. Critically: losing face tracking AFTER contact has started is
treated as continued contact, not a gap — a real chug involves tilting
the head back, which naturally loses front-facing tracking. This was
confirmed against a real test video (see project notes).

Ported verbatim from Fantasy_Helper's
bot/chug_analyzer/pose_detection.py.
"""
import subprocess
import tempfile
import os

import cv2
import mediapipe as mp

CONTACT_THRESHOLD = 0.18  # distance below this = can touching mouth, tuned from real test data

# 2026-09-12 fix, real report: a member's own video (confirmed by them
# to clearly show a chug) still came back "no chug detected" — every
# single frame failed to register a hand+face detection close enough
# to count, an all-or-nothing miss rather than a borderline distance
# call. cv2.VideoCapture ignores a video's rotation metadata entirely
# (confirmed: CAP_PROP_ORIENTATION_AUTO does not reorient frames on
# this build regardless of platform — tested directly, not assumed),
# so a portrait phone video — stored with landscape sensor dimensions
# plus a 90°/270° rotation flag, which every normal video player
# already honors when displaying it upright — gets read by OpenCV
# completely sideways. Mediapipe's face mesh in particular degrades
# hard on a 90°-rotated face; a sideways video failing to register a
# single frame of "face detected" for its entire length, despite a
# real, visible chug throughout, is exactly this failure mode.
#
# Fixed at the source rather than by guessing a rotation-correction
# sign convention ourselves (ffmpeg's own rotation metadata sign
# convention has genuinely changed across versions historically, so
# hand-rolling "rotation == -90 means rotate clockwise" risks being
# right on one device/OS and backwards on another): re-encoding through
# the ffmpeg CLI first, which already handles decoding-with-rotation
# correctly and bakes the corrected orientation into the output pixels
# themselves — cv2.VideoCapture then reads an already-upright video and
# needs no rotation awareness of its own. ffmpeg is already a hard
# dependency here (audio_analysis.py's moviepy import needs it too), so
# this adds no new external dependency. Best-effort: if ffmpeg isn't on
# PATH or the re-encode fails for any reason, falls back to the
# original file — this can only ever improve detection, never make an
# already-working video newly fail.
def _normalize_orientation(video_path: str) -> tuple[str, str | None]:
    """Returns (path_to_use, temp_path_to_clean_up_or_None)."""
    fd, normalized_path = tempfile.mkstemp(suffix=".mp4")
    os.close(fd)
    try:
        result = subprocess.run(
            [
                "ffmpeg", "-y", "-i", video_path,
                "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28", "-an",
                normalized_path,
            ],
            capture_output=True,
            timeout=60,
        )
        if result.returncode == 0 and os.path.getsize(normalized_path) > 0:
            return normalized_path, normalized_path
    except (OSError, subprocess.TimeoutExpired):
        pass
    # ffmpeg missing, timed out, or failed — clean up any partial output
    # and fall back to analyzing the original file exactly as before.
    try:
        os.remove(normalized_path)
    except OSError:
        pass
    return video_path, None


def detect_can_to_mouth(video_path: str):
    mp_hands = mp.solutions.hands
    mp_face_mesh = mp.solutions.face_mesh

    # Lowered from mediapipe's 0.5 defaults — a fast head-tilt (the
    # motion a real chug's "tip the can back" moment produces) causes
    # real motion blur right at the one instant contact needs to
    # register, and the hand/can itself partially occludes the mouth
    # landmarks at the moment they're closest together. Still a real
    # detection, not a rubber stamp: this only affects how confident
    # mediapipe must be that it found a hand/face at all, not the
    # CONTACT_THRESHOLD distance check that decides whether a detected
    # hand and face actually count as touching.
    hands = mp_hands.Hands(static_image_mode=False, max_num_hands=2, min_detection_confidence=0.3, min_tracking_confidence=0.3)
    face_mesh = mp_face_mesh.FaceMesh(static_image_mode=False, min_detection_confidence=0.3, min_tracking_confidence=0.3)

    analysis_path, temp_path = _normalize_orientation(video_path)
    try:
        cap = cv2.VideoCapture(analysis_path)
        fps = cap.get(cv2.CAP_PROP_FPS)

        in_contact = False
        contact_start_frame = None
        contact_end_frame = None
        wrist_positions_during_contact = []
        frame_number = 0

        while True:
            ret, frame = cap.read()
            if not ret:
                break

            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            hand_results = hands.process(frame_rgb)
            face_results = face_mesh.process(frame_rgb)

            if hand_results.multi_hand_landmarks and face_results.multi_face_landmarks:
                wrist = hand_results.multi_hand_landmarks[0].landmark[0]
                mouth = face_results.multi_face_landmarks[0].landmark[13]
                distance = ((wrist.x - mouth.x) ** 2 + (wrist.y - mouth.y) ** 2) ** 0.5

                if distance < CONTACT_THRESHOLD:
                    if not in_contact:
                        in_contact = True
                        contact_start_frame = frame_number
                    contact_end_frame = frame_number
                    wrist_positions_during_contact.append((wrist.x, wrist.y))
                else:
                    if in_contact:
                        contact_end_frame = frame_number
                        break

            frame_number += 1

        cap.release()
    finally:
        if temp_path is not None:
            try:
                os.remove(temp_path)
            except OSError:
                pass

    if contact_start_frame is None:
        return {"contact": False}

    return {
        "contact": True,
        "start_frame": contact_start_frame,
        "end_frame": contact_end_frame,
        "duration_seconds": round((contact_end_frame - contact_start_frame) / fps, 2),
        "wrist_positions": wrist_positions_during_contact,
        "fps": fps,
    }
