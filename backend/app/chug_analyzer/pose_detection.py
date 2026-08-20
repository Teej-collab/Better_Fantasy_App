"""
Can-to-mouth contact detection. Tracks wrist-to-mouth distance per
frame. Critically: losing face tracking AFTER contact has started is
treated as continued contact, not a gap — a real chug involves tilting
the head back, which naturally loses front-facing tracking. This was
confirmed against a real test video (see project notes).

Ported verbatim from Fantasy_Helper's
bot/chug_analyzer/pose_detection.py.
"""
import cv2
import mediapipe as mp

CONTACT_THRESHOLD = 0.18  # distance below this = can touching mouth, tuned from real test data


def detect_can_to_mouth(video_path: str):
    mp_hands = mp.solutions.hands
    mp_face_mesh = mp.solutions.face_mesh

    hands = mp_hands.Hands(static_image_mode=False, max_num_hands=2)
    face_mesh = mp_face_mesh.FaceMesh(static_image_mode=False)

    cap = cv2.VideoCapture(video_path)
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
