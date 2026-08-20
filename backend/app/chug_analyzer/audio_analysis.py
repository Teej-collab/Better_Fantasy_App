"""
Extracts audio energy right after the chug ends (not the whole clip)
-- this is a better proxy for "that was impressive" (crowd reaction)
than ambient room noise throughout the whole video, which would
unfairly reward chugging in a loud bar over a quiet room regardless
of actual performance.

Ported verbatim from Fantasy_Helper's bot/chug_analyzer/audio_analysis.py.
"""
import numpy as np
from moviepy import VideoFileClip


def extract_hype_energy(video_path: str, chug_end_seconds: float, window_seconds: float = 2.0) -> float:
    clip = VideoFileClip(video_path)

    if clip.audio is None:
        clip.close()
        return 0.0

    duration = clip.duration
    start = min(chug_end_seconds, max(0, duration - 0.1))
    end = min(start + window_seconds, duration)

    audio = clip.audio
    if hasattr(audio, "subclipped"):
        segment = audio.subclipped(start, end)
    else:
        segment = audio.subclip(start, end)

    array = segment.to_soundarray(fps=22050)
    clip.close()

    if array.size == 0:
        return 0.0

    rms = float(np.sqrt(np.mean(array ** 2)))
    # normalize: typical speech/ambient RMS sits well under 0.15 for this
    # sample rate -- this may need tuning once tested against more real clips
    energy = min(1.0, rms / 0.15)
    return round(energy, 3)
