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
import os

ANALYZER_PYTHON = os.getenv("CHUG_ANALYZER_PYTHON", "venv311/bin/python")


async def run_chug_analysis(video_path: str) -> dict:
    process = await asyncio.create_subprocess_exec(
        ANALYZER_PYTHON, "-m", "app.chug_analyzer.cli", video_path,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await process.communicate()

    if process.returncode != 0:
        raise RuntimeError(f"Chug analyzer subprocess failed: {stderr.decode()}")

    try:
        return json.loads(stdout.decode().strip())
    except json.JSONDecodeError:
        raise RuntimeError(f"Chug analyzer returned unparseable output: {stdout.decode()}")
