"""
Chug Analyzer CV pipeline — ported verbatim from Fantasy_Helper's
bot/chug_analyzer/. Python 3.11 only (mediapipe has no working build
for this backend's Python 3.13) — this package is never imported by the
main app process directly. It's only ever run as a subprocess in the
dedicated venv311 environment (see requirements-chug-analyzer.txt and
app/providers/chug_analyzer_bridge.py, which is what the main app
actually imports).
"""
