#!/usr/bin/env python3
"""The hub's reaper (#1470): a fleet VM asks the hub to remove it.

POST /reap from a fleet VM, body {"run": <int>, "target": "<owner>/<repo>"}.
The caller is read from X-Exedev-Source-Vm, which the platform sets after
stripping anything the caller sent. The hub removes only the VM that asked,
and only once the run's evidence record says it ended done: the status page
at the run's tag in the evidence repository. Standard library only.

Two settings, read from the unit's environment (/etc/reaper/reaper.env):
REAPER_EVIDENCE_REPO, the evidence repository as <owner>/<repo>, and
REAPER_RECORD, `evidence` (the default) or `kata`. `kata` is the rollback:
the run issue on the hub's own kata, closed as done, as before 2026-11-13.
"""
import base64
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

KATA_URL = "http://localhost:8000"
# The GitHub integration attached to the hub: the edge routes by repository and adds the credential.
GITHUB_URL = "https://github.int.exe.xyz/api/v3"
# https: the plain http:// address answers 301.
RM_URL = "https://lobby-rm.int.exe.xyz/exec"
VM_RE = re.compile(r"^fleet-r([1-9][0-9]*)-")
TARGET_RE = re.compile(r"^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$")
RECORDS = ("evidence", "kata")
# The calling boot waits five seconds for its answer; the one read stays under that.
READ_SECONDS = 4


def decide(source_vm, body, done):
    """Pure: return (status, vm); vm is named only on 202 and is the caller's own.

    `done` is what the record says of the run: True only when it ended done.
    """
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
    if done is not True:
        return (409, None)
    return (202, vm)


def status_done(status):
    """The evidence record: a status page whose state is done."""
    return isinstance(status, dict) and status.get("state") == "done"


def issue_done(issue):
    """The rollback's record: a kata run issue closed as done."""
    return isinstance(issue, dict) and issue.get("status") == "closed" and issue.get("closed_reason") == "done"


def record_of(value):
    """REAPER_RECORD as read: `kata` only when it says so, else `evidence`."""
    return value if value in RECORDS else RECORDS[0]


def status_url(evidence, target, run):
    """The run's status page at its tag, and at nothing else: a tag that is not there is a 404."""
    slug = target.replace("/", "-", 1)
    path = urllib.parse.quote(f"runs/{slug}/{run}/status.json")
    ref = urllib.parse.quote(f"refs/tags/{slug}/run-{run}", safe="")
    return f"{GITHUB_URL}/repos/{evidence}/contents/{path}?ref={ref}"


def status_of(raw):
    """The status page out of a contents answer: the raw file, or the base64 envelope. None for anything else."""
    try:
        data = json.loads(raw.decode("utf-8"))
        if isinstance(data, dict) and isinstance(data.get("content"), str) and data.get("encoding") == "base64":
            data = json.loads(base64.b64decode(data["content"]).decode("utf-8"))
    except Exception:
        return None
    return data if isinstance(data, dict) else None


def read_status(evidence, target, run):
    """The run's status page at its tag in the evidence repository, or None: no repository set, no tag, no page."""
    if not isinstance(evidence, str) or not TARGET_RE.match(evidence):
        return None
    req = urllib.request.Request(
        status_url(evidence, target, run),
        headers={"Accept": "application/vnd.github.raw", "User-Agent": "fleet-reaper"},
    )
    try:
        with urllib.request.urlopen(req, timeout=READ_SECONDS) as resp:
            return status_of(resp.read())
    except urllib.error.HTTPError:
        return None


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


def run_done(record, evidence, target, run, read=read_status, find=find_issue):
    """What the chosen record says: True only when the run ended done."""
    if record == "kata":
        return issue_done(find(target, run))
    return status_done(read(evidence, target, run))


def answer_for(caller, raw, record, evidence, read=read_status, find=find_issue):
    """One request, decided: (status, vm, run). No record is read for a wrong caller, body or target."""
    if not caller:
        return (403, None, None)
    try:
        body = json.loads(raw.decode("utf-8"))
    except Exception:
        return (400, None, None)
    run = body.get("run") if isinstance(body, dict) else None
    status, _ = decide(caller, body, True)
    if status != 202:
        return (status, None, run)
    status, vm = decide(caller, body, run_done(record, evidence, body["target"], run, read, find))
    return (status, vm, run)


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
        record = record_of(os.environ.get("REAPER_RECORD"))
        try:
            if self.path.split("?", 1)[0] != "/reap":
                status = 404
                self._answer(404, {"status": 404})
                return
            caller = self.headers.get("X-Exedev-Source-Vm")
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length > 0 else b""
            status, vm, run = answer_for(caller, raw, record, os.environ.get("REAPER_EVIDENCE_REPO"))
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
                line = f"reap caller={caller} run={run} status={status} record={record}"
                if status == 202:
                    line += f" vm={vm} removed={removed}"
                print(line, flush=True)
            except Exception:
                pass


def main():
    # REAPER_PORT, never PORT: the unit loads /etc/kata/kata.env, whose PORT=8000 is the daemon's own
    port = int(os.environ.get("REAPER_PORT", "8001"))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"reaper listening on 0.0.0.0:{port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
