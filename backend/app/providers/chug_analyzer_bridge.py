"""
Bridges the main backend process (.venv, Python 3.13, no working
mediapipe) to the chug analyzer (venv311, Python 3.11, working
mediapipe) by running it as a subprocess and reading back its JSON
result — same pattern as Fantasy_Helper's
bot/chug_analyzer/analyzer_bridge.py.

Path to the venv311 interpreter is configurable via
CHUG_ANALYZER_PYTHON, defaulting to venv311/bin/python relative to the
backend/ working directory (see requirements-chug-analyzer.txt for how
that environment gets set up).
"""
import asyncio
import json
import logging
import os

logger = logging.getLogger(__name__)

ANALYZER_PYTHON = os.getenv("CHUG_ANALYZER_PYTHON", "venv311/bin/python")


async def run_chug_analysis(video_path: str) -> dict:
    process = await asyncio.create_subprocess_exec(
        ANALYZER_PYTHON, "-m", "app.chug_analyzer.cli", video_path,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await process.communicate()

    # 2026-09-14: previously only read on a crash (returncode != 0),
    # so pose_detection.py's own diagnostic logging (ffmpeg normalize
    # failures, cv2 failing to open a file, per-run frame counts) had
    # nowhere real to go on an ordinary successful exit — the analyzer
    # can run to completion, return can_to_mouth: false, and exit 0,
    # while still having silently hit a real failure internally on the
    # way there. Logging it here, into the main backend process's own
    # logs, is what actually makes it show up in Railway's log stream
    # (mediapipe's own noise included — cli.py already left that alone
    # deliberately, so this isn't new log spew, just no longer thrown away).
    # .warning, not .info: this app has no logging.basicConfig anywhere
    # (confirmed — grepped for it), so an uncofigured root logger drops
    # INFO-level records entirely and only surfaces WARNING+ via
    # Python's automatic "last resort" handler. scheduler.py's existing
    # production error logging (logger.exception, effectively ERROR)
    # relies on this same fallback — matching that rather than adding
    # a new, untested basicConfig() that could affect other loggers.
    if stderr:
        logger.warning("chug analyzer stderr for %s:\n%s", video_path, stderr.decode(errors="replace"))

    if process.returncode != 0:
        raise RuntimeError(f"Chug analyzer subprocess failed: {stderr.decode()}")

    try:
        return json.loads(stdout.decode().strip())
    except json.JSONDecodeError:
        raise RuntimeError(f"Chug analyzer returned unparseable output: {stdout.decode()}")
