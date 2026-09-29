"""A local stand-in for Jev: `jev_standin.py <noul> [--log <file>] -- <command...>`.

Serves POST /v1/systemone on 127.0.0.1 (an OS-picked port), answering every question asked
with {"noul": <noul>}, and runs the command with TYPESAFE_BASE_URL pointed at it and
ULTRAPOWERS_HOME at a fresh directory holding a stand-in key. Exits with the command's code.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def usage():
    sys.stderr.write("usage: jev_standin.py <noul> [--log <file>] -- <command...>\n")
    sys.exit(2)


def main(argv):
    if "--" not in argv:
        usage()
    sep = argv.index("--")
    opts, command = argv[:sep], argv[sep + 1:]
    if not command or not opts:
        usage()
    try:
        value = float(opts[0])
    except ValueError:
        usage()
    log_path = None
    rest = opts[1:]
    if rest:
        if len(rest) != 2 or rest[0] != "--log":
            usage()
        log_path = rest[1]
    log_lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def reply(self, status, body):
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_POST(self):
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length)
            if self.path.split("?")[0] != "/v1/systemone":
                return self.reply(404, {"error": "not found"})
            try:
                body = json.loads(raw)
            except ValueError:
                return self.reply(400, {"error": "body is not JSON"})
            if log_path:
                with log_lock, open(log_path, "a") as f:
                    f.write(json.dumps(body, separators=(",", ":")) + "\n")
            questions = body.get("questions") if isinstance(body, dict) else None
            keys = list(questions) if isinstance(questions, dict) else []
            self.reply(200, {"answers": {k: {"noul": value} for k in keys}})

        def do_GET(self):
            self.reply(404, {"error": "not found"})

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.daemon_threads = True
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    home = tempfile.mkdtemp(prefix="jev-standin-")
    try:
        with open(os.path.join(home, "typesafe.env"), "w") as f:
            f.write("TYPESAFE_API_KEY=standin-key\n")
        env = dict(os.environ)
        env["TYPESAFE_BASE_URL"] = "http://127.0.0.1:%d" % server.server_address[1]
        env["ULTRAPOWERS_HOME"] = home
        code = subprocess.call(command, env=env)
    finally:
        server.shutdown()
        server.server_close()
        shutil.rmtree(home, ignore_errors=True)
    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
