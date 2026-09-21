"""
Extracts audio energy right after the chug ends (not the whole clip)
-- this is a better proxy for "that was impressive" (crowd reaction)
than ambient room noise throughout the whole video, which would
unfairly reward chugging in a loud bar over a quiet room regardless
of actual performance.

Originally ported verbatim from Fantasy_Helper's
bot/chug_analyzer/audio_analysis.py, which used moviepy's
VideoFileClip for both duration probing and audio extraction. Rewritten
2026-09-21 to shell out to ffmpeg/ffprobe directly instead: a real
member's HEVC Dolby Vision iPhone video (10-bit, with the extra `mebx`
metadata tracks iPhones embed for gyroscope/exposure data) crashed
moviepy's ffmpeg_parse_infos with `TypeError: unsupported operand
type(s) for +: 'float' and 'str'` -- moviepy parses `ffmpeg -i`'s
human-readable stderr text with regexes that don't handle this real
device output, well upstream of anything this module actually needs
(just a duration and a short audio window as samples). ffprobe's own
structured output and a direct `ffmpeg ... -f wav` extraction sidestep
that fragile text parsing entirely, the same "trust ffmpeg's own
decoding, don't hand-parse it" fix already applied to the rotation
issue in pose_detection.py's _normalize_orientation.
"""
import subprocess
import tempfile
import os
import wave

import numpy as np


def _probe_duration(video_path: str) -> float:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video_path],
        capture_output=True,
        timeout=30,
    )
    return float(result.stdout.decode().strip())


def extract_hype_energy(video_path: str, chug_end_seconds: float, window_seconds: float = 2.0) -> float:
    duration = _probe_duration(video_path)
    start = min(chug_end_seconds, max(0, duration - 0.1))
    end = min(start + window_seconds, duration)

    fd, wav_path = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    try:
        # Mono, 22050 Hz PCM -- matches the sample rate the 0.15 RMS
        # normalization below was tuned against. -vn drops video
        # entirely, so this never touches the same ffmpeg -i info
        # parsing that crashed moviepy.
        result = subprocess.run(
            [
                "ffmpeg", "-y", "-ss", str(start), "-to", str(end), "-i", video_path,
                "-vn", "-ac", "1", "-ar", "22050", "-f", "wav",
                wav_path,
            ],
            capture_output=True,
            timeout=30,
        )
        if result.returncode != 0:
            # No audio stream (-vn finds nothing to map) or extraction
            # otherwise failed -- same "no audio" case the old
            # `clip.audio is None` check handled.
            return 0.0

        with wave.open(wav_path, "rb") as wav_file:
            n_frames = wav_file.getnframes()
            if n_frames == 0:
                return 0.0
            raw = wav_file.readframes(n_frames)
            array = np.frombuffer(raw, dtype=np.int16).astype(np.float64) / 32768.0
    except (OSError, subprocess.TimeoutExpired):
        return 0.0
    finally:
        try:
            os.remove(wav_path)
        except OSError:
            pass

    if array.size == 0:
        return 0.0

    rms = float(np.sqrt(np.mean(array ** 2)))
    # normalize: typical speech/ambient RMS sits well under 0.15 for this
    # sample rate -- this may need tuning once tested against more real clips
    energy = min(1.0, rms / 0.15)
    return round(energy, 3)
