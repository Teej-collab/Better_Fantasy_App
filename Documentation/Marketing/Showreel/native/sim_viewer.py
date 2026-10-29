"""
A live view of the booted iOS Simulator in a browser tab, for this Mac's
Xcode install, which has no Simulator window app. Polls simctl
screenshots; local only (127.0.0.1).

    python3 sim_viewer.py      # then open http://127.0.0.1:8833
"""
import http.server
import subprocess
import tempfile
import threading
import time
from pathlib import Path

PORT = 8833
SHOT = Path(tempfile.gettempdir()) / "sim_viewer_latest.jpg"
lock = threading.Lock()

PAGE = b"""<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Simulator</title>
<style>body{margin:0;background:#0d1016;display:grid;place-items:center;height:100vh}
img{max-height:96vh;max-width:96vw;border-radius:28px;box-shadow:0 0 0 2px #2b3340}</style>
<img id=s src="/shot.jpg">
<script>const s=document.getElementById('s');setInterval(()=>{s.src='/shot.jpg?'+Date.now()},700)</script>"""


def grab_forever() -> None:
    tmp = SHOT.with_suffix(".tmp.jpg")
    while True:
        r = subprocess.run(["xcrun", "simctl", "io", "booted", "screenshot", "--type=jpeg", str(tmp)], capture_output=True)
        if r.returncode == 0:
            with lock:
                tmp.replace(SHOT)
        time.sleep(0.5)


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/shot.jpg"):
            with lock:
                data = SHOT.read_bytes() if SHOT.exists() else b""
            self.send_response(200)
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(PAGE)

    def log_message(self, *args):
        pass


threading.Thread(target=grab_forever, daemon=True).start()
http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
