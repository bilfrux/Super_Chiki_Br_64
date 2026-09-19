#!/usr/bin/env python3
"""
TEMPORARY local dev mock for MONAD GRAND PRIX's JOIN / BOOSTER flow.

This is NOT the real multiplayer server. It exists only so the join -> choose
team -> booster -> BOOST flow can be tested end-to-end (including from a real
phone on the same network) before Member B's WebSocket server exists.

It does two things, nothing else:
  1. serves the whole repo as static files (so /test, /game, /booster, /shared
     all work with plain relative/absolute paths), with two convenience
     aliases: GET /join -> booster/ui/join/index.html
              GET /booster -> booster/ui/booster/index.html
  2. exposes a minimal HTTP mock of the BOOST event + team state, using the
     exact same field names as the shared protocol (shared/protocol/events.js):
       POST /api/boost  body: {"type":"BOOST","team":"red","amount":1}
       GET  /api/state  ->    {"teams":[{"id":"red","boosters":7,...}, ...]}

Delete this file once Member B's real server/WebSocket is wired up - the
front-end only talks to it through booster/mock/client.js, so nothing else
needs to change.
"""

import json
import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
TEAM_IDS = ["red", "blue", "green", "yellow"]
PORT = 8123

state_lock = threading.Lock()
boosters = {team_id: 0 for team_id in TEAM_IDS}


def team_state():
    with state_lock:
        return {
            "teams": [
                {
                    "id": team_id,
                    "boostEnergy": 0,
                    "boostRate": 0,
                    "position": 0,
                    "speed": 0,
                    "driverConnected": False,
                    "boosters": boosters[team_id],
                }
                for team_id in TEAM_IDS
            ]
        }


PATH_ALIASES = {
    "/": "/game/lobby/index.html",
    "/join": "/booster/ui/join/index.html",
    "/join/": "/booster/ui/join/index.html",
    "/booster": "/booster/ui/booster/index.html",
    "/booster/": "/booster/ui/booster/index.html",
}


class MockHandler(BaseHTTPRequestHandler):

    def _send_json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _serve_static(self, path):
        path = PATH_ALIASES.get(path, path)
        file_path = (REPO_ROOT / path.lstrip("/")).resolve()

        if REPO_ROOT not in file_path.parents and file_path != REPO_ROOT:
            self.send_error(403, "Forbidden")
            return
        if file_path.is_dir():
            file_path = file_path / "index.html"
        if not file_path.is_file():
            self.send_error(404, "File not found")
            return

        content_types = {
            ".html": "text/html; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".svg": "image/svg+xml",
            ".mp3": "audio/mpeg",
            ".ogg": "audio/ogg",
            ".json": "application/json",
        }
        content_type = content_types.get(file_path.suffix, "application/octet-stream")

        data = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/state":
            self._send_json(team_state())
            return
        self._serve_static(path)

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/boost":
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length) if length else b"{}"
            try:
                event = json.loads(raw or b"{}")
            except json.JSONDecodeError:
                self._send_json({"ok": False, "error": "invalid json"}, status=400)
                return

            team_id = event.get("teamId") or event.get("team")  # accept both event shapes in use across the front-end
            amount = event.get("amount", 1)
            if team_id not in TEAM_IDS:
                self._send_json({"ok": False, "error": "unknown team"}, status=400)
                return

            with state_lock:
                boosters[team_id] += amount

            self._send_json({"ok": True, **team_state()})
            return

        self.send_error(404, "Not found")

    def log_message(self, format, *args):
        pass  # keep the terminal quiet during a live demo


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", PORT), MockHandler)
    ip = lan_ip()
    print(f"MONAD GRAND PRIX mock server running (TEMPORARY - replace with Member B's real server)")
    print(f"  Big screen (this laptop) : http://localhost:{PORT}/game/lobby/")
    print(f"  Big screen (LAN, for QR) : http://{ip}:{PORT}/game/lobby/")
    print(f"  Join (phone, same wifi)  : http://{ip}:{PORT}/join")
    server.serve_forever()
