"""
CLI entrypoint for the chug analyzer -- meant to be run inside venv311,
invoked as a subprocess from the main backend (running in the separate
.venv/Python 3.13 environment). Takes a video path as an argument,
prints ONLY a JSON result to stdout so the calling process can parse it
cleanly (mediapipe's noisy logs already go to stderr, which we leave
alone). Run as `python -m app.chug_analyzer.cli <path>` from the
backend/ directory — see app/providers/chug_analyzer_bridge.py.

Ported from Fantasy_Helper's scripts/run_chug_analyzer_cli.py.
"""
import sys
import json

from app.chug_analyzer.analyzer import analyze_chug_video

if __name__ == "__main__":
    video_path = sys.argv[1]
    result = analyze_chug_video(video_path)
    print(json.dumps(result))
