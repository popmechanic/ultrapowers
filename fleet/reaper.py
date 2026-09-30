#!/usr/bin/env python3
"""The hub's reaper (#1470): a fleet VM asks the hub to remove it.

POST /reap from a fleet VM, body {"run": <int>, "target": "<owner>/<repo>"}.
The caller is read from X-Exedev-Source-Vm, which the platform sets after
stripping anything the caller sent. The hub removes only the VM that asked,
and only once its kata run issue closed as done. Standard library only.
"""
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

KATA_URL = "http://localhost:8000"
# https: the plain http:// address answers 301.
RM_URL = "https://lobby-rm.int.exe.xyz/exec"
VM_RE = re.compile(r"^fleet-r([1-9][0-9]*)-")
TARGET_RE = re.compile(r"^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$")


def decide(source_vm, body, issue):
    """Pure: return (status, vm); vm is named only on 202 and is the caller's own."""
    if not isinstance(source_vm, str) or not source_vm:
        return (403, None)
    vm = source_vm.split(".", 1)[0]
    m = VM_RE.match(vm)
    run = body.get("run") if isinstance(body, dict) else None
    if m is None or type(run) is not int or int(m.group(1)) != run:
        return (403, None)
    target = body.get("target")
    if not isinstance(target, str) or not TARGET_RE.match(target):
        return (400, None)
    if not isinstance(issue, dict) or issue.get("status") != "closed" or issue.get("closed_reason") != "done":
        return (409, None)
    return (202, vm)


def rm_succeeded(code, text):
    """A 2xx, or a VM already gone ("not found" in any case), is success."""
    if isinstance(code, int) and 200 <= code < 300:
        return True
    return "not found" in (text or "").lower()


def _kata_get(path):
    req = urllib.request.Request(
        KATA_URL + path,
        headers={"Authorization": "Bearer " + os.environ.get("KATA_AUTH_TOKEN", "")},
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _items(data, key):
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for k in (key, "items", "data"):
            if isinstance(data.get(k), list):
                return data[k]
    return []


def find_issue(target, run):
    """The run issue (metadata run, no task key) on the hub's kata, or None."""
    name = target.replace("/", "-")
    projects = _items(_kata_get("/api/v1/projects?limit=1000"), "projects")
    project = next((p for p in projects if isinstance(p, dict) and p.get("name") == name), None)
    if project is None:
        return None
    pid = urllib.parse.quote(str(project.get("id")), safe="")
    issues = _items(_kata_get(f"/api/v1/projects/{pid}/issues?limit=1000"), "issues")
    for issue in issues:
        if not isinstance(issue, dict):
            continue
        meta = issue.get("metadata")
        if isinstance(meta, dict) and type(meta.get("run")) is int and meta["run"] == run and "task" not in meta:
            return issue
    return None


def remove_vm(vm):
    """rm <vm> --json through the hub-only lobby-rm integration."""
    req = urllib.request.Request(RM_URL, data=f"rm {vm} --json".encode("utf-8"), method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return rm_succeeded(resp.status, resp.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        try:
            text = e.read().decode("utf-8", "replace")
        except Exception:
            text = ""
        return rm_succeeded(e.code, text)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _answer(self, status, payload):
        data = (json.dumps(payload) + "\n").encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(data)
        self.wfile.flush()

    def _not_found(self):
        try:
            self._answer(404, {"status": 404})
        except Exception:
            pass

    do_GET = do_PUT = do_DELETE = do_PATCH = do_HEAD = do_OPTIONS = _not_found

    def do_POST(self):
        caller, run, status, vm, removed = None, None, 500, None, None
        try:
            if self.path.split("?", 1)[0] != "/reap":
                status = 404
                self._answer(404, {"status": 404})
                return
            caller = self.headers.get("X-Exedev-Source-Vm")
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length > 0 else b""
            if not caller:
                status = 403
            else:
                try:
                    body = json.loads(raw.decode("utf-8"))
                    parsed = True
                except Exception:
                    body, parsed = None, False
                    status = 400
                if parsed:
                    run = body.get("run") if isinstance(body, dict) else None
                    # Refuse a wrong caller or target before asking kata anything.
                    status, _ = decide(caller, body, {"status": "closed", "closed_reason": "done"})
                    if status == 202:
                        status, vm = decide(caller, body, find_issue(body["target"], run))
            self._answer(status, {"status": status, "vm": vm})
        except Exception as e:
            status, vm = 500, None
            try:
                self._answer(500, {"status": 500, "error": type(e).__name__})
            except Exception:
                pass
        finally:
            # Only after the answer is sent: remove the caller's own VM.
            try:
                if status == 202 and vm:
                    try:
                        removed = remove_vm(vm)
                    except Exception:
                        removed = False
                line = f"reap caller={caller} run={run} status={status}"
                if status == 202:
                    line += f" vm={vm} removed={removed}"
                print(line, flush=True)
            except Exception:
                pass


def main():
    port = int(os.environ.get("PORT", "8001"))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"reaper listening on 0.0.0.0:{port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
