#!/usr/bin/env bash
#
# fleet/sandbox-boot.sh — the sandbox side of a run, from the assignment to the PR.
#
# The immutable bootstrap (`fleet/fleet-bootstrap.sh`, the main process of the
# run unit `fleet-run@<N>.service`) reads the VM comment, clones this engine at
# the sha the comment names, and execs this file with the assignment in
# FLEET_ASSIGNMENT — so THIS script is the run unit's process, and its exit is
# the unit's result. It starts and stops the engine unit `fleet-engine-<N>` and
# never its own.
# From here: refuse to boot when two GitHub integrations name one repository,
# clone the target through exe.dev's edge-injected GitHub integrations, take the
# plan off the target's own `ultra/plan-run-<N>`, run the engine as a transient
# user SERVICE with the Anthropic pair in the ENGINE'S CHILD ENV ONLY, serve the
# status page from a service of its own, commit the receipts to the target's
# `ultra/evidence-run-<N>` at every transition, and — only when the branch has
# something to publish — push and open the PR over GitHub's REST
# API through the edge. The PR is the human gate; there is no write grant to
# wait for, because the target's one integration is attached for the run's
# whole life (measured 2026-09-03: the edge routes by repo path and caches an
# installation token for 30–60 s after an attach, so a grant swapped in at
# publish time produced a bot-authored PR).
#
# No orchestrator, no control VM, no token on this box, and no waiting for an
# assignment: the launcher writes the comment, and the integrations reach this
# box by the policy tag:fleet, BEFORE it starts the unit. Amendment 10 holds:
# every git command and every GitHub call below is this script's, never a
# model's, and the push happens only after systemd says the engine service is
# inactive.
#
# THREE TRANSIENT BRANCHES AND TWO TAGS, all on the TARGET repository and none
# of them anywhere else (#598). What a run leaves behind is the two tags:
# `ultra/plan/run-<N>` on the plan commit and `ultra/evidence/run-<N>` on the
# evidence head. The branches are only where the run works.
# `ultra/plan-run-<N>` carries `.ultrapowers/plan.md` in — the launcher pushed
# it before this VM existed, so the plan this box runs is the one the
# assignment's `plan=` signed; `ultra/integration-run-<N>` is the engine's own,
# and the PR head; `ultra/evidence-run-<N>` is this script's — one commit per
# transition, parented on the plan commit. After the last evidence push of a
# `done` or `parked` run, `record_tags` writes both tags, and then
# `ultra/plan-run-<N>` and `ultra/evidence-run-<N>` are deleted at publish, in
# one push, once `git ls-remote --tags` verifies both tags against the remote;
# a run that ends `failed`, or whose tags do not verify, keeps both branches
# for the one-time sweep. The PR body links the plan blob and the evidence tree
# by tag. Nothing under `.claude/` is ever committed: that directory is the
# engine's scratch, and the evidence is a copy of it under `.ultrapowers/`.
#
# IDEMPOTENCE IS A REQUIREMENT, not a nicety: this script can be started again
# on the same box, and re-entering must not re-clone a clone that exists and
# must never re-run an engine that finished — the engine spends real
# subscription money and leaves a branch. The markers are the clone and the
# evidence worktree themselves, `$FLEET_HOME/.fleet-engine-done`, and the
# status page.
#
# SEAMS. Every external program goes through a `fleet_*` wrapper and `PATH` is
# prefixed with `$FLEET_BIN_DIR`, so `fleet/tests/test_sandbox_boot.mjs` drives
# the whole state machine against stub binaries; `$FLEET_HOME` relocates every
# path. Neither is set in production and both default to the real thing.
set -euo pipefail

# --- relocatable roots -------------------------------------------------------

FLEET_HOME="${FLEET_HOME:-/home/exedev}"
if [ -n "${FLEET_BIN_DIR:-}" ]; then
  PATH="$FLEET_BIN_DIR:$PATH"
  export PATH
fi
# The one line the setup script writes for the renderer: `TINYAPP_RENDER_URL=…`,
# exe.dev's edge address for browser rendering. `run_engine` sources it when it
# is readable and hands the value to the engine unit in its own argv. The
# production path is the literal; the variable exists so a sim can plant the
# file, exactly like `FLEET_HOME` and `FLEET_BIN_DIR`.
FLEET_RENDER_ENV="${FLEET_RENDER_ENV:-/etc/fleet/render.env}"

# systemd's user manager needs a bus address. The unit inherits one; a human
# debugging over ssh does not, and `systemd-run --user` then dies with "Failed to
# connect to bus: No medium found" — measured on stock exeuntu. Linger is on in
# the image, so the manager is always running; only the address is missing.
XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"
export XDG_RUNTIME_DIR DBUS_SESSION_BUS_ADDRESS

WWW_DIR="$FLEET_HOME/www"
STATUS_FILE="$WWW_DIR/status.json"
BOOT_LOG="$FLEET_HOME/fleet-boot.log"
# The engine's combined output, IN THE SERVED DIRECTORY. run-66 exited 1 and the
# only trace anywhere was "engine: exited 1"; the reason (`run-main:
# knob-validate-failed`) had to be reproduced by hand on the box. An engine's
# own words are the first thing anyone wants and the one thing that was thrown
# away, so they go where the status page already reaches: /engine.log.
ENGINE_LOG="$WWW_DIR/engine.log"
TARGET_DIR="$FLEET_HOME/target"
# The evidence branch's checkout: a detached worktree OF THE TARGET CLONE, so
# the receipts commit onto the target repository and nowhere else.
EVIDENCE_DIR="$FLEET_HOME/evidence"
# Where the plan blob lands after it is read off the plan branch. This path is
# what the engine's argv carries.
PLANS_DIR="$FLEET_HOME/plans"
ENGINE_DONE_MARKER="$FLEET_HOME/.fleet-engine-done"
# The one lock the evidence worktree's two writers share. While the engine unit
# runs, `phase_refresher` is a writer of its own — it commits the page at every
# `engine:phase` it relays (#723) — and `run_engine` kills it the moment the
# unit is done. A kill that landed INSIDE a commit would leave a half-made
# `pull --rebase` behind for the `publishing` commit to trip over, so both sides
# take this directory around their git work: `mkdir` is the atomic
# test-and-set every filesystem has, and holding it is what makes the kill land
# between commits rather than inside one.
EVIDENCE_LOCK="$FLEET_HOME/.fleet-evidence-lock"
# How many 0.1s tries either side waits for it before giving up (30s). The
# refresher that gives up simply commits the phase on its next poll; the
# foreground that gives up kills a refresher that is wedged, which is the one
# case where a lost commit beats a hung run.
EVIDENCE_LOCK_TRIES=300
# `claude --version`, written by `log_auth_status` before the engine unit is
# started and copied into the evidence by `collect_evidence` at every later
# transition — so the branch says which engine binary the run actually ran on.
CLAUDE_VERSION_FILE="$FLEET_HOME/claude-version.txt"
# Set once the assignment is parsed: the bootstrap's content-addressed clone.
ENGINE_REPO_DIR=""

# The literals. They are the contract; nothing here is configurable in
# production because every one of them is also a name somewhere else.
REFLECTION_URL="https://reflection.int.exe.xyz"
NOTIFY_URL="https://notify.int.exe.xyz/"
GITHUB_INT_HOST="github.int.exe.xyz"
ANTHROPIC_PROXY_URL="https://claude-max.int.exe.xyz"
# The kata daemon, behind the hub's exe.dev auth proxy. The request carries no
# bearer of its own: the edge injects the peer key, which is the whole reason a
# sandbox that holds no kata token at all can still be answered, and the daemon
# sees the hub's own host as `Host`, which is what kata's `public_origin` check
# needs. `FLEET_KATA_URL` exists for the same reason `FLEET_RENDER_ENV` does —
# so a sim can pin the address inside its own home — and the literal is the
# production value.
KATA_URL="${FLEET_KATA_URL:-https://kata.int.exe.xyz}"
# The plan's path inside the plan commit's tree, and the run's directory inside
# the evidence commit's. Both are `.ultrapowers/`, never `.claude/`.
PLAN_BLOB_PATH=".ultrapowers/plan.md"
# The gate's verdict record, when the launcher had one to push. The compiler
# refuses a claims-v1 plan without its record beside it (spec §4.5), under the
# name `<plan-stem>.gate-verdicts.json` — so it lands next to the plan under
# that name, and a plan branch without one is a legacy-grammar plan, not a fault.
VERDICTS_BLOB_PATH=".ultrapowers/gate-verdicts.json"
# The run's kata record, when the launcher made one: the project the run's state
# lives in, pushed on the plan branch beside the plan itself. A plan branch
# without one is a run that proceeds without kata, not a fault — so the read is
# the verdicts record's read exactly, and its absence is a log line.
KATA_BLOB_PATH=".ultrapowers/kata.json"
# The hub's own record, beside the engine's, inside the run's directory on the
# evidence branch: one JSON object per line, `kind` first — `issue` for every
# issue of the run's project, `event` for every envelope of its event log.
KATA_EXPORT_FILE="kata.jsonl"
# The residual ledger's name inside the run's directory on the evidence branch:
# one JSON object per residual, written beside the two documents it is read
# from. The run's residuals leave the box on the record and nowhere else.
RESIDUALS_FILE="residuals.jsonl"

# Poll cadences. The defaults are the contract's; the tests set them to 0 so the
# whole state machine runs in a second.
POLL_SECONDS="${FLEET_POLL_SECONDS:-2}"
STATUS_INTERVAL="${FLEET_STATUS_INTERVAL:-30}"
# How far the evidence branch is allowed to fall behind the engine's event log.
# The refresher commits on the first tick that has seen EITHER this many new
# lines in `events.jsonl` since its last commit OR this many seconds since it —
# so a watcher of the record is never more than ten events or two minutes
# behind the page, and a wave that emits nothing costs the branch nothing. The
# per-relayed-phase gate these replace (#723) lagged by a WHOLE WAVE, because a
# wave writes its phase once and then works for an hour.
COMMIT_EVENTS="${FLEET_COMMIT_EVENTS:-10}"                   # new lines that earn a commit
COMMIT_SECONDS="${FLEET_COMMIT_SECONDS:-120}"                # seconds that earn one
ENGINE_STOP_TIMEOUT="${FLEET_ENGINE_STOP_TIMEOUT:-300}"     # 5 min for the service to go inactive
PUBLISH_BRANCH_WAIT="${PUBLISH_BRANCH_WAIT:-60}"             # for the pushed branch to show at the edge
MERGE_CHECK_WAIT="${FLEET_MERGE_CHECK_WAIT:-1800}"           # 30 min for GitHub to recompute mergeability
# How long a base-moved 405 keeps buying another fold. The bound is a WALL
# CLOCK and not a count: the base moves as often as the target's own traffic
# says it does, and a run that can still fold cleanly onto it and still green
# its suite has no reason to stop after two. Measured from the FIRST base-moved
# 405 of the run, so a run that has been folding again for an hour stops rather
# than chasing a branch it will never catch.
FOLD_AGAIN_WAIT="${FLEET_FOLD_AGAIN_WAIT:-3600}"             # 1 h of folding onto a moving base

# Run identity, filled by `parse_assignment`. `RUN_N` is the bare number (the
# `runs/<N>/` path); `RUN_ID` is `run-<N>` (the engine's runId, its run dir and
# its branch).
RUN_N=""
RUN_ID=""
PLAN_SHA=""
TARGET_REPO=""
BASE_SHA=""
ENGINE_SHA=""
OVERLAP=""
TIER=""
EFFORT=""
# `hold=1` in the assignment: publish the PR and stop there, leaving the merge
# button to a human. Empty is the default — the sandbox finishes its own PR.
HOLD=""
BRANCH=""
# The other two of #598's three branches, and the paths that hang off them.
PLAN_BRANCH=""
EVIDENCE_BRANCH=""
EVIDENCE_PATH=""
PLAN_FILE=""
# Where the run's kata record landed, or EMPTY when the plan commit carried
# none. Set by `prepare_plan`, and the one test three later steps make: the
# ping, the engine's `--kata` pair and the export all read it, so a run without
# the file makes no kata request at all.
KATA_FILE=""
# Set once the run issue's close has been attempted — the write is made once
# per boot whatever the terminal transition, and a re-entered boot's close
# rides the same idempotency key.
KATA_RUN_CLOSED=""
VM_NAME=""
VM_EMAIL=""
STARTED_AT=""
STATE=""
PHASE=""
PR_URL=""
# Who GitHub says opened the PR (`.user.login`): the operator when
# `--act-as-user` took, the app bot when it did not. Recorded so a bot-authored
# PR is a fact on the page, not a surprise on GitHub.
PR_AUTHOR=""
# The pushed head of the integration branch, read once — by `await_branch_visible`
# before the PR POST, and reused by the merge step, which asks the edge about
# the checks of THAT sha. One read, so the run branch is read back for its head
# exactly once in a run.
BRANCH_HEAD=""
# The squash commit the PR merged as, once the sandbox has merged it. Empty is
# `null` on the page: a PR still open, or one deliberately left open.
MERGED_SHA=""
# What the `done` phase says about the merge — `merged <sha>`, or
# `left open: <reason>`. Set by `merge_pr`, read by `do_boot`.
MERGE_NOTE=""
# What the publish fold left behind, as a merge note: empty when the fold
# folded (or had nothing to join), and `left open: publish fold — …` otherwise.
# Set by `publish_fold`, read by `merge_pr`, which treats a non-empty value
# exactly as `hold=1` — no tip read, no PUT issued.
FOLD_HOLD=""
# The merge's fold-again signal. Every path of `merge_pr` returns 0 under
# `set -e`, so the two outcomes that earn another fold — a default branch whose
# tip is no longer the one the fold joined onto, and a 405 whose body says the
# PR is not mergeable, that the base branch was modified, or that a required
# status check is expected — are carried in a variable. `merge_pr` clears it on
# entry and raises it on either; `do_boot` loops on it.
FOLD_AGAIN=""
# The fold tip this run has already folded again for. A re-fold that comes back
# on the tip it already offered has nothing new to offer, so it buys no further
# fold: the loop stops on the first repetition rather than chasing a base the
# folder cannot reach. Empty until a base-moved refusal has been recorded.
TIP_FOLDED=""
# When the FIRST base-moved refusal of this run landed, as `date +%s`. Empty until
# one has: it is both the clock `FOLD_AGAIN_WAIT` is measured against and how
# `merge_pr` knows, on entry, that it is not the first PUT — the call that
# follows a fold-again waits for GitHub's mergeability before it asks again.
FOLD_AGAIN_SINCE=""
# How many fold attempts this run has started — the loop is unbounded, so this
# counts as high as the folds go. Every attempt after the first lands its
# disposition AFTER the PR was opened, which is what makes the body PATCH
# necessary.
FOLD_ATTEMPTS=0
# Set by `phase_refresher` around its own evidence commits: those are made in a
# background subshell beside a running engine, where `fail` would write a
# `failed` page and notify while the run is still perfectly alive. Soft means a
# refused push gives up and leaves the commit LOCAL for the next push to carry.
EVIDENCE_PUSH_SOFT=""
ERROR=""

# --- seams -------------------------------------------------------------------

fleet_curl()       { curl "$@"; }
fleet_git()        { git "$@"; }
fleet_npm()        { npm "$@"; }
fleet_systemd_run(){ systemd-run "$@"; }
fleet_systemctl()  { systemctl "$@"; }

log() {
  local line
  line="$(date -u +%Y-%m-%dT%H:%M:%SZ) $*"
  mkdir -p "$FLEET_HOME"
  printf '%s\n' "$line" >>"$BOOT_LOG"
  printf '%s\n' "$line" >&2
}

# --- tiny JSON helpers -------------------------------------------------------
#
# No jq. Stock exeuntu ships it, but every value read here is one flat string
# field of a small document, and a sed match keeps this script runnable on any
# box (and its exam free of a jq stub).

# An ABSENT field is an answer, never an error: `pr` is null until the run
# publishes, and a grep that found nothing must not take down a `set -e` script.
json_field() { # $1 = field name; document on stdin -> the FIRST match, or ''
  { grep -o "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" || true; } | head -n 1 |
    sed 's/.*:[[:space:]]*"\(.*\)"$/\1/'
}

# A newline becomes `\n`, never nothing: `error` carries the engine's last
# lines, and deleting the breaks would run twenty stack frames into one word.
json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/	/\\t/g' |
    awk 'BEGIN { ORS = "" } { print (NR > 1 ? "\\n" : "") $0 }'
}

# The engine's own last words, for the `error` cell of the status page.
engine_tail() {
  [ -f "$ENGINE_LOG" ] || return 0
  tail -n 20 "$ENGINE_LOG" | tail -c 4000
}

now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# --- the projection of the event log -----------------------------------------
#
# WHAT EACH TASK IS DOING, read off the engine's own `events.jsonl` and nothing
# else. The log is the record; this is a projection of it, never a writer, and
# it invents no event kind — every rule below names a kind the engine already
# writes (`fleet/run-worker.mjs`, `fleet/run-engine.mjs`, `fleet/run-waves.mjs`).
#
# ONE READER, in `python3` with the paths in argv, in `residual_read`'s shape: a
# per-task cell cannot be built by a `sed` that answers the FIRST match, and the
# ids live inside a worker label and inside two arrays. An absent, unparsable or
# oddly-shaped log answers the empty projection rather than failing a `set -e`
# script — a page is owed at every write, including the writes that happen
# before the clone, when there is no run directory at all.
#
# THREE MODES, ONE WALK. `all` is the `project` verb's object, `tasks` is the
# page's cell and `sub` is the page's sub-phase; a second parser for any of them
# would be a second answer to the same question.
project_read() { # $1 = all|tasks|sub, $2 = events.jsonl, $3 = args.json or ''
  python3 -c '
import json, re, sys

MODE, EVENTS, ARGS = sys.argv[1], sys.argv[2], sys.argv[3]

# The three kinds a proof run is written under. `lastProof` is the last of them
# for the task, whatever its exit: a red proof is what a reader most wants.
PROOF = ("driver:proof-run", "driver:check-run", "driver:exam-run")

# The worker labels that BELONG TO A TASK. `reconcile:wave<n>:<attempt>` and
# `integration` are labels of work no single task owns — they match none of
# these, so they name no task, and they still count for the sub-phase.
EXAM = re.compile(r"^exam:([^:]+)$")
IMPL = re.compile(r"^impl:([^:]+)$")
REVIEW = re.compile(r"^review:([^:]+):")
FIX = re.compile(r"^fix:([^:]+):")
STATE_OF = ((EXAM, "examining"), (IMPL, "implementing"),
            (REVIEW, "reviewing"), (FIX, "fixing"))


def owner(label):
    """The task id a worker label names, or None."""
    for rx, _ in STATE_OF:
        found = rx.match(label)
        if found:
            return found.group(1)
    return None


def listed(doc, key):
    got = doc.get(key)
    return got if isinstance(got, list) else []


def named(doc):
    """Every task id one event names, through its `task` field or `tasks` list."""
    out = []
    one = doc.get("task")
    if one is not None and not isinstance(one, (dict, list)):
        out.append(str(one))
    for other in listed(doc, "tasks"):
        if not isinstance(other, (dict, list)):
            out.append(str(other))
    return out


# IN `id` ORDER, and a STABLE sort: an id is a ULID, so lexical order is time
# order however the lines were appended, and two events that carry the same id
# keep the order the file gave them.
rows = []
try:
    with open(EVENTS, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                doc = json.loads(line)
            except Exception:
                continue
            if isinstance(doc, dict):
                rows.append((str(doc.get("id") or ""), doc))
except Exception:
    rows = []
rows.sort(key=lambda row: row[0])
events = [doc for _, doc in rows]

# The plan the launcher wrote beside the log, when there is one: it is the only
# place a task that has not been started yet is named at all.
waves = {}
if ARGS:
    try:
        with open(ARGS, encoding="utf-8") as fh:
            plan = json.load(fh)
    except Exception:
        plan = {}
    if isinstance(plan, dict):
        for n, wave in enumerate(listed(plan, "waves")):
            if not isinstance(wave, list):
                continue
            for item in wave:
                tid = item.get("id") if isinstance(item, dict) else item
                if tid is not None and not isinstance(tid, (dict, list)):
                    waves.setdefault(str(tid), n + 1)

ids = set(waves)
for doc in events:
    if doc.get("kind") in ("worker:start", "worker:end"):
        tid = owner(str(doc.get("label") or ""))
        if tid:
            ids.add(tid)
    ids.update(named(doc))

state = dict.fromkeys(ids, "queued")
wave = dict(waves)
proof, park = {}, {}
# Every `worker:start`, and the positions each label was closed at: a role is
# the last start of the task that no later end of the SAME label answered.
opens, closes = [], {}

for at, doc in enumerate(events):
    kind = doc.get("kind")
    label = str(doc.get("label") or "")
    tid = owner(label)
    if kind == "worker:start":
        opens.append((at, label, tid))
        for rx, reached in STATE_OF:
            if rx.match(label) and tid:
                state[tid] = reached
    elif kind == "worker:end":
        closes.setdefault(label, []).append(at)
        if tid and IMPL.match(label) and doc.get("status") == "BLOCKED":
            state[tid] = "failed"
    elif kind in PROOF:
        for tid in named(doc):
            if tid in state:
                state[tid] = "proving"
                proof[tid] = {"cmd": doc.get("cmd"), "exit": doc.get("exit"),
                              "ts": doc.get("ts")}
    elif kind in ("driver:wave-adopted", "driver:wave-blocked"):
        blocked = kind == "driver:wave-blocked"
        for tid in [str(t) for t in listed(doc, "tasks")
                    if not isinstance(t, (dict, list))]:
            state[tid] = "failed" if blocked else "folded"
            if blocked:
                park[tid] = doc.get("detail")
            if tid not in waves:
                wave[tid] = doc.get("wave")


def open_at(at, label):
    """True when no `worker:end` of `label` came after the start at `at`."""
    return not any(shut > at for shut in closes.get(label, ()))


def role_of(tid):
    for at, label, owns in reversed(opens):
        if owns == tid:
            return label if open_at(at, label) else None
    return None


# The sub-phase: the label of the most recent worker still running, else the
# kind of the last event when the log has moved past its last `engine:phase`.
sub = None
for at, label, _ in reversed(opens):
    if open_at(at, label):
        sub = label
        break
if sub is None and events:
    last = len(events) - 1
    phase_at = max([at for at, doc in enumerate(events)
                    if doc.get("kind") == "engine:phase"] or [-1])
    if phase_at < last:
        sub = str(events[last].get("kind") or "") or None


def key(tid):
    return (0, int(tid), "") if tid.isdigit() else (1, 0, tid)


cells = {}
for tid in sorted(ids, key=key):
    cells[tid] = {"wave": wave.get(tid), "state": state[tid], "role": role_of(tid),
                  "lastProof": proof.get(tid), "park": park.get(tid)}

if MODE == "sub":
    out = (sub or "") + "\n"
elif MODE == "tasks":
    out = json.dumps(cells, separators=(",", ":")) + "\n"
else:
    out = json.dumps({"sub": sub, "tasks": cells}, separators=(",", ":")) + "\n"
sys.stdout.write(out)
' "$1" "$2" "${3:-}" 2>/dev/null || return 1
}

# The projection of THIS run, for the page: the run directory holds both the log
# and the plan the launcher wrote beside it. Before the clone `RUN_ID` is empty
# and neither path exists, which is the empty projection and not an error.
status_tasks() {
  local dir
  dir="$(run_dir_path)"
  project_read tasks "$dir/events.jsonl" "$dir/args.json"
}

# --- status page -------------------------------------------------------------
#
# One writer, written atomically, and every write is also a log line — which is
# what makes the ORDER of states an observable fact rather than a screenshot of
# the last one. `vm` names this incarnation: the run id is durable, the VM name
# is one copy of the golden that carried it.

write_status() { # $1 = state, $2 = phase (optional, defaults to the current one)
  STATE="$1"
  if [ "$#" -ge 2 ]; then PHASE="$2"; fi
  mkdir -p "$WWW_DIR"
  [ -n "$STARTED_AT" ] || STARTED_AT="$(now_iso)"
  local pr_cell="null" author_cell="null" merged_cell="null" err_cell="null" tmp
  [ -n "$PR_URL" ] && pr_cell="\"$(json_escape "$PR_URL")\""
  [ -n "$PR_AUTHOR" ] && author_cell="\"$(json_escape "$PR_AUTHOR")\""
  # `merged` is a cell on EVERY page, null until the sandbox has merged: a
  # reader of the evidence branch can tell a PR that went in from one left open
  # without opening GitHub.
  [ -n "$MERGED_SHA" ] && merged_cell="\"$(json_escape "$MERGED_SHA")\""
  [ -n "$ERROR" ] && err_cell="\"$(json_escape "$ERROR")\""
  # THE LAST CELL ON THE PAGE, always, and never anywhere else: `json_field`
  # answers the FIRST `"name": "value"` match in the file, so a task cell's own
  # `"state":"folded"` would be read as the page's state the moment it sat above
  # it. Written at EVERY write, so a reader of the record sees what each task
  # was doing at that commit and not only what the run was.
  local tasks_cell
  tasks_cell="$(status_tasks || true)"
  [ -n "$tasks_cell" ] || tasks_cell="{}"
  tmp="$STATUS_FILE.tmp.$$"
  cat >"$tmp" <<EOF
{"run":"$(json_escape "$RUN_N")","state":"$(json_escape "$STATE")","phase":"$(json_escape "$PHASE")","pr":$pr_cell,"prAuthor":$author_cell,"merged":$merged_cell,"branch":"$(json_escape "$BRANCH")","vm":"$(json_escape "$VM_NAME")","startedAt":"$STARTED_AT","updatedAt":"$(now_iso)","error":$err_cell,"tasks":$tasks_cell}
EOF
  mv "$tmp" "$STATUS_FILE"
  log "status: state=$STATE phase=$PHASE"
}

read_status_field() { # $1 = field; reads the live status page if there is one
  [ -f "$STATUS_FILE" ] || return 0
  json_field "$1" <"$STATUS_FILE"
}

notify() { # $1 = title, $2 = message
  log "notify: $1 — $2"
  fleet_curl -fsS -X POST -H 'content-type: application/json' \
    -d "{\"title\":\"$(json_escape "$1")\",\"message\":\"$(json_escape "$2")\"}" \
    "$NOTIFY_URL" >/dev/null 2>&1 || log "notify: post failed (continuing)"
}

fail() { # $1 = error text
  ERROR="$1"
  write_status failed
  # Every failure path after the clone leaves its account on the evidence
  # branch, not only on a status page the janitor is about to delete with the
  # VM. A failure BEFORE the clone has no branch to write to — its record is
  # this page and the notify below. `FAILING` is what keeps `push_evidence`'s
  # own failure from recursing back in here.
  if [ -z "${FAILING:-}" ] && [ -n "$RUN_N" ] && is_clone "$EVIDENCE_DIR"; then
    FAILING=1
    collect_evidence || true
    push_evidence "$RUN_ID: failed — $1" || true
  fi
  notify "run-${RUN_N:-?} failed" "$1"
  log "FAILED: $1"
  exit 1
}

# --- the status page's own server --------------------------------------------
#
# Its own transient service, not this script's child: a child dies with the
# unit that started it, and the page going dark the moment the run ends is
# exactly what the janitor cannot work with. `Restart=on-failure` is the whole
# supervision it needs. exe.dev proxies port 8000 at https://<vm>.exe.xyz/.

start_status_server() {
  mkdir -p "$WWW_DIR"
  case "$(fleet_systemctl --user is-active fleet-status.service 2>/dev/null || true)" in
    active*) log "status server: fleet-status.service already active"; return 0 ;;
  esac
  # Not fatal: the record of a run is its evidence commits, and a box whose
  # page cannot be served still owes those.
  if fleet_systemd_run --user --unit=fleet-status -p Restart=on-failure -- \
      busybox httpd -f -p 8000 -h "$WWW_DIR" >>"$BOOT_LOG" 2>&1; then
    log "status server: fleet-status.service serving $WWW_DIR on 8000"
  else
    log "status server: systemd-run fleet-status failed (continuing without a served page)"
  fi
}

# --- polling -----------------------------------------------------------------
#
# Bounded by BOTH a wall clock and an attempt count: with a zero interval (the
# exam's) the clock never advances, and a loop that can only be stopped by its
# own success condition is a hang, not a poll.

poll_attempts() { # $1 = timeout seconds -> attempts
  local step="$POLL_SECONDS"
  [ "$step" -gt 0 ] 2>/dev/null || step=1
  echo $(( $1 / step + 1 ))
}

# --- the assignment ----------------------------------------------------------

read_identity() {
  VM_NAME="$(fleet_curl -fsS "$REFLECTION_URL/" 2>/dev/null | json_field name || true)"
  VM_EMAIL="$(fleet_curl -fsS "$REFLECTION_URL/email" 2>/dev/null | json_field email || true)"
  log "reflection: name=${VM_NAME:-<unknown>}"
}

# The bootstrap hands the comment over in FLEET_ASSIGNMENT. Started by hand
# instead, this reads it ONCE — no waiting: the launcher writes the comment
# before anything starts this script, so an empty one is a launcher bug.
read_assignment() {
  if [ -n "${FLEET_ASSIGNMENT:-}" ]; then
    printf '%s\n' "$FLEET_ASSIGNMENT"
    return 0
  fi
  fleet_curl -fsS "$REFLECTION_URL/comment" 2>/dev/null | json_field comment || true
}

is_sha()    { case "$1" in *[!0-9a-f]* | "") return 1 ;; esac; [ "${#1}" -eq 40 ]; }
# The same two EREs `grep -qE` carried, read by bash itself: a BUILTIN writer
# (`printf`) dies with its subshell on SIGPIPE before any `|| true` can run, so
# a pipeline here has no guard available — and a test needs no pipeline at all.
is_target() { [[ $1 =~ ^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ ]]; }
is_run_n()  { [[ $1 =~ ^[A-Za-z0-9][A-Za-z0-9-]*$ ]]; }

parse_assignment() { # $1 = the comment line
  local tok key val
  for tok in $1; do
    key="${tok%%=*}"
    val="${tok#*=}"
    case "$key" in
      run)     RUN_N="$val" ;;
      plan)    PLAN_SHA="$val" ;;
      target)  TARGET_REPO="$val" ;;
      base)    BASE_SHA="$val" ;;
      engine)  ENGINE_SHA="$val" ;;
      overlap) OVERLAP="$val" ;;
      tier)    TIER="$val" ;;
      effort)  EFFORT="$val" ;;
      hold)    HOLD="$val" ;;
      *) fail "assignment: unknown key '$key' in comment" ;;
    esac
  done
  is_run_n "$RUN_N"     || fail "assignment: bad run id '$RUN_N'"
  is_sha "$PLAN_SHA"    || fail "assignment: plan is not a 40-hex sha ('$PLAN_SHA')"
  is_target "$TARGET_REPO" || fail "assignment: target is not owner/repo ('$TARGET_REPO')"
  is_sha "$BASE_SHA"    || fail "assignment: base is not a 40-hex sha ('$BASE_SHA')"
  is_sha "$ENGINE_SHA"  || fail "assignment: engine is not a 40-hex sha ('$ENGINE_SHA')"
  case "$OVERLAP" in ''|fold|serialize) : ;; *) fail "assignment: bad overlap '$OVERLAP'" ;; esac
  case "$TIER" in ''|standard|mostCapable) : ;; *) fail "assignment: bad tier '$TIER'" ;; esac
  case "$EFFORT" in ''|low|medium|high) : ;; *) fail "assignment: bad effort '$EFFORT'" ;; esac
  # One value, `1`. `hold=0` and `hold=yes` are refused rather than read as
  # falsey: a launcher that meant to hold a run and mistyped the value would
  # otherwise get a merged PR out of the typo.
  case "$HOLD" in ''|1) : ;; *) fail "assignment: bad hold '$HOLD'" ;; esac

  RUN_ID="run-$RUN_N"
  BRANCH="ultra/integration-$RUN_ID"
  PLAN_BRANCH="ultra/plan-$RUN_ID"
  EVIDENCE_BRANCH="ultra/evidence-$RUN_ID"
  EVIDENCE_PATH=".ultrapowers/runs/$RUN_N"
  PLAN_FILE="$PLANS_DIR/$RUN_ID.md"
  ENGINE_REPO_DIR="$FLEET_HOME/engines/$ENGINE_SHA"
  log "assignment: $RUN_ID plan=$PLAN_SHA target=$TARGET_REPO base=$BASE_SHA engine=$ENGINE_SHA overlap=${OVERLAP:-<default>} tier=${TIER:-<default>} effort=${EFFORT:-<default>} hold=${HOLD:-<default>}"
}

# --- clones ------------------------------------------------------------------

is_clone() { [ -e "$1/.git" ]; }

clone_target() {
  if is_clone "$TARGET_DIR"; then
    log "target: clone already present"
  else
    local out
    if out="$(fleet_git clone "https://$GITHUB_INT_HOST/$TARGET_REPO.git" "$TARGET_DIR" 2>&1)"; then
      log "target: cloned through $GITHUB_INT_HOST"
    else
      printf '%s\n' "$out" >>"$BOOT_LOG"
      # The edge knows no integration for this target: it may still be a PUBLIC
      # repo, which needs no credential to READ. Anything but a not-found is a
      # real failure and is not papered over with a second attempt.
      case "$out" in
        *404*|*"not found"*|*"Not Found"*|*"Repository not found"*)
          log "target: $GITHUB_INT_HOST says not found — trying public github.com"
          fleet_git clone "https://github.com/$TARGET_REPO.git" "$TARGET_DIR" \
            || fail "clone: target $TARGET_REPO (neither $GITHUB_INT_HOST nor github.com)"
          # The push at the end goes through the edge, because the attached
          # integration is what makes it work. So origin is the int URL whichever
          # host answered the read.
          fleet_git -C "$TARGET_DIR" remote set-url origin "https://$GITHUB_INT_HOST/$TARGET_REPO.git" \
            || fail "target: could not point origin at $GITHUB_INT_HOST"
          ;;
        *) fail "clone: target $TARGET_REPO" ;;
      esac
    fi
  fi
  # Left AT BASE. `ultra/integration-<runId>` is the engine's to create.
  fleet_git -C "$TARGET_DIR" checkout "$BASE_SHA" || fail "checkout: target at $BASE_SHA"
}

# --- the plan ----------------------------------------------------------------
#
# The plan travels on the TARGET, on a branch the launcher pushed before this VM
# existed. What is fetched is checked against the assignment's `plan=` BEFORE a
# model can read a word of it: a plan branch someone else moved is a different
# plan, and running it would be running unsigned instructions. The blob is
# written out whole — `git show` into the file, not through a command
# substitution, because a plan is bytes and `$(…)` eats its last newline.
prepare_plan() {
  local landed
  fleet_git -C "$TARGET_DIR" fetch origin "refs/heads/$PLAN_BRANCH" \
    || fail "plan: cannot fetch $PLAN_BRANCH from $TARGET_REPO"
  landed="$(fleet_git -C "$TARGET_DIR" rev-parse FETCH_HEAD 2>/dev/null || true)"
  if [ "$landed" != "$PLAN_SHA" ]; then
    fail "plan: $PLAN_BRANCH is at '${landed:-<nothing>}', not the plan=$PLAN_SHA this run was assigned"
  fi
  mkdir -p "$PLANS_DIR"
  fleet_git -C "$TARGET_DIR" show "$PLAN_SHA:$PLAN_BLOB_PATH" >"$PLAN_FILE" \
    || fail "plan: $PLAN_SHA carries no $PLAN_BLOB_PATH"
  log "plan: $PLAN_BRANCH at $PLAN_SHA -> $PLAN_FILE"
  # Measured on the first live launch of this shape (smoke run-72, 2026-09-04):
  # the launcher pushed the record and the engine refused the plan for lacking
  # it, because only plan.md was written out. The record is optional on the
  # branch and mandatory beside the plan when it exists.
  if fleet_git -C "$TARGET_DIR" cat-file -e "$PLAN_SHA:$VERDICTS_BLOB_PATH" 2>/dev/null; then
    fleet_git -C "$TARGET_DIR" show "$PLAN_SHA:$VERDICTS_BLOB_PATH" >"${PLAN_FILE%.md}.gate-verdicts.json" \
      || fail "plan: $PLAN_SHA carries $VERDICTS_BLOB_PATH but it could not be read"
    log "plan: verdicts -> ${PLAN_FILE%.md}.gate-verdicts.json"
  else
    log "plan: $PLAN_SHA carries no $VERDICTS_BLOB_PATH (a legacy-grammar plan)"
  fi
  # THE THIRD READ OF THAT SHAPE, and the one thing that decides whether this
  # run has a hub at all: the record names the project the engine holds its run
  # state in. Absent is an answer — the run proceeds without kata, makes no
  # kata request, and hands the engine no `--kata`.
  if fleet_git -C "$TARGET_DIR" cat-file -e "$PLAN_SHA:$KATA_BLOB_PATH" 2>/dev/null; then
    KATA_FILE="${PLAN_FILE%.md}.kata.json"
    fleet_git -C "$TARGET_DIR" show "$PLAN_SHA:$KATA_BLOB_PATH" >"$KATA_FILE" \
      || fail "plan: $PLAN_SHA carries $KATA_BLOB_PATH but it could not be read"
    log "plan: kata -> $KATA_FILE"
  else
    KATA_FILE=""
    log "plan: $PLAN_SHA carries no $KATA_BLOB_PATH — the run proceeds without kata"
  fi
}

# --- the hub, asked once -----------------------------------------------------
#
# ONE REQUEST, BEFORE THE ENGINE, and only for a run that has a kata record.
# The engine holds this run's state in the hub from its first wave on, so a hub
# this box cannot reach is not a degradation to discover task by task — it is a
# run that cannot be held, and the operator is owed the reason at boot rather
# than a wave of workers whose every write was refused.
#
# THE RETRIES ARE THE POINT (Shelley's review). A single try turns one hub
# hiccup — a `systemctl restart`, the two-second `Restart=on-failure` window —
# into every sandbox of a wave parking at once, which is the one failure mode
# worse than the one this guards. `--retry-connrefused` is what makes a refused
# connection retryable at all; curl otherwise treats it as final.
#
# NO BEARER RIDES THIS REQUEST. The hub's exe.dev auth proxy injects the peer
# key at the edge, and the Host the daemon sees is the hub's own — which is what
# kata's `public_origin` check needs. This box holds no kata token to leak.
kata_ping() {
  local code=0
  [ -n "$KATA_FILE" ] || return 0
  fleet_curl -fsS --max-time 10 --retry 3 --retry-delay 2 --retry-connrefused \
    "$KATA_URL/api/v1/ping" >/dev/null 2>&1 || code=$?
  if [ "$code" = 0 ]; then
    log "kata: $KATA_URL answered its ping"
    return 0
  fi
  # The `ahead = 0` park's shape exactly: the page, the record, the tags, the
  # notify, and exit 0 — no engine unit, no PR. A run that never started is
  # parked, not failed.
  ERROR="parked: kata unreachable at $KATA_URL (curl exit $code)"
  write_status parked "kata unreachable"
  collect_evidence
  push_evidence "$RUN_ID: parked — kata unreachable"
  record_tags
  notify "run-$RUN_N parked" "$TARGET_REPO — $ERROR"
  exit 0
}

# --- the evidence worktree ---------------------------------------------------
#
# One worktree of the target clone, detached, built once. A first attempt
# parents the evidence branch on the PLAN COMMIT — so the branch that carries
# the receipts out is rooted in the plan that came in. A re-entry finds the
# branch already on the remote and continues it at FETCH_HEAD instead, which is
# what keeps an earlier attempt's commits.
prepare_evidence() {
  local at
  if is_clone "$EVIDENCE_DIR"; then
    log "evidence: worktree already present at $EVIDENCE_DIR"
    return 0
  fi
  if fleet_git -C "$TARGET_DIR" fetch origin "refs/heads/$EVIDENCE_BRANCH" 2>/dev/null; then
    at=FETCH_HEAD
    log "evidence: $EVIDENCE_BRANCH is already on the remote — continuing it"
  else
    at="$PLAN_SHA"
    log "evidence: no $EVIDENCE_BRANCH yet — parenting it on the plan commit"
  fi
  fleet_git -C "$TARGET_DIR" worktree add --detach "$EVIDENCE_DIR" "$at" \
    || fail "evidence: worktree add $EVIDENCE_DIR at $at"
}

# The engine is the bootstrap's clone at `engine=` — this script is running
# out of it. It is never cloned, fetched or checked out here, and never
# re-exec'd: that was run-68.
check_engine() {
  [ -f "$ENGINE_REPO_DIR/fleet/run-main.mjs" ] \
    || fail "engine: $ENGINE_REPO_DIR has no fleet/run-main.mjs (the bootstrap clones the engine; this script never does)"
  # fleet/package.json may declare no dependencies (it does since the lift), in
  # which case npm creates no node_modules and there is nothing to install.
  if [ ! -d "$ENGINE_REPO_DIR/fleet/node_modules" ] \
    && grep -Eq '"(dependencies|devDependencies)"[[:space:]]*:[[:space:]]*\{[[:space:]]*"' "$ENGINE_REPO_DIR/fleet/package.json"; then
    if [ -f "$ENGINE_REPO_DIR/fleet/package-lock.json" ]; then
      log "engine: fleet/node_modules missing — npm ci"
      ( cd "$ENGINE_REPO_DIR/fleet" && fleet_npm ci --no-audit --no-fund ) || fail "npm ci: engine deps"
    else
      log "engine: fleet/node_modules missing and no lockfile — npm install"
      ( cd "$ENGINE_REPO_DIR/fleet" && fleet_npm install --no-audit --no-fund ) || fail "npm install: engine deps"
    fi
  fi
  log "engine: $ENGINE_REPO_DIR"
}

# --- integrations ------------------------------------------------------------
#
# One read of Reflection's `/integrations`, once, before any clone. Each GitHub
# integration publishes its repository inside its `help` string
# (`git clone https://github.int.exe.xyz/<owner>/<repo>.git`), so the box can
# tell whether two of them name one repo — the case exe.dev's edge, which
# routes by repo path, resolves by an undocumented tie-break. Measured
# 2026-09-03: that is how a push went out under the wrong credential. A
# duplicate is a refusal at second zero, not a nondeterministic auth failure
# forty minutes later. No jq: one help string per line, then the first
# `github.int.exe.xyz/…git` inside each.

integrations_body() { fleet_curl -fsS "$REFLECTION_URL/integrations" 2>/dev/null || true; }

duplicate_repos() { # body on stdin -> one duplicated repo path per line
  grep -oE '"help"[[:space:]]*:[[:space:]]*"[^"]*"' |
    sed -n 's/.*\(github\.int\.exe\.xyz\/[^"[:space:]]*\.git\).*/\1/p' |
    sort | uniq -d
}

preflight_integrations() {
  local body dupes
  body="$(integrations_body)"
  if [ -z "$body" ]; then
    log "integrations: Reflection /integrations answered nothing — no duplicate check possible"
    return 0
  fi
  dupes="$(printf '%s' "$body" | duplicate_repos | tr '\n' ' ')"
  if [ -n "$dupes" ]; then
    fail "integrations: two github integrations on this VM name one repository: ${dupes% }— detach one; the edge picks between them by no documented rule"
  fi
  log "integrations: no two github integrations name one repository"
}

# --- the engine --------------------------------------------------------------

run_dir_path() { printf '%s/.claude/ultrapowers/run-%s' "$TARGET_DIR" "$RUN_ID"; }

gate_receipt_path() {
  # The run directory is the only receipt. The engine's own gate writes it there,
  # and `collect_evidence` copies it onto the evidence branch — that copy is what
  # survives as a git object. A receipt anywhere else in the target tree is a
  # fossil of some older run, and reading one parks this run on a stale verdict.
  local p
  p="$(run_dir_path)/gate-receipt.json"
  [ -f "$p" ] && printf '%s\n' "$p"
  return 0
}

approve_receipt_path() {
  # The two-move rule's second move, written by `run-main.mjs` beside the gate
  # receipt in the run directory once `ultra_gate.py --approve` has succeeded.
  # The run dir is per run, so an approve receipt found here is this run's; the
  # stamp inside it is the engine's business, not this script's.
  local p
  p="$(run_dir_path)/approve-receipt.json"
  [ -f "$p" ] && printf '%s\n' "$p"
  return 0
}

last_phase() {
  local f
  f="$(run_dir_path)/events.jsonl"
  [ -f "$f" ] || return 0
  grep '"kind":"engine:phase"' "$f" 2>/dev/null | tail -n 1 |
    sed -n 's/.*"phase":"\([^"]*\)".*/\1/p'
}

# THE EVIDENCE BRANCH KEEPS UP WITH THE LOG, made through the same
# `collect_evidence`/`push_evidence` pair a state transition makes. The gate is
# `FLEET_COMMIT_EVENTS` new lines OR `FLEET_COMMIT_SECONDS` seconds since the
# last commit, never the phase: one commit per relayed `engine:phase` (#723)
# meant a wave that writes its phase once and then works for an hour left the
# record an hour behind the page, which is what Shelley measured on fleet-r84
# and fleet-r87. The page is still rewritten EVERY poll (`updatedAt` is the
# heartbeat a watcher reads); a tick that saw no new line never commits,
# whatever the clock says, so an idle run costs the branch nothing.
#
# The commit runs under `EVIDENCE_LOCK` so `run_engine`'s kill cannot land
# inside it, and under `EVIDENCE_PUSH_SOFT` so a refused push leaves the commit
# local instead of ending the run: this is a background subshell, and a `fail`
# reached in here would write a `failed` page and notify for a run whose engine
# is still working. The counters move only once the commit was actually made,
# so a window the lock cost us this poll is committed on the next one.
commit_phase_evidence() { # $1 = the phase just relayed to the page
  evidence_lock || return 1
  EVIDENCE_PUSH_SOFT=1
  collect_evidence || true
  push_evidence "$RUN_ID: $1" || true
  EVIDENCE_PUSH_SOFT=""
  evidence_unlock
  return 0
}

# THE LIVE LOG, beside the live page: a `cp` into `$WWW_DIR` and a `mv` over the
# served name, so the rename is atomic on the one filesystem and a browser that
# asked mid-copy reads a whole file rather than half of one. The temp name
# carries this shell's pid because the refresher is a subshell of a script that
# can be started again on the same box.
serve_events() { # $1 = the run directory's events.jsonl
  local tmp
  [ -f "$1" ] || return 0
  mkdir -p "$WWW_DIR"
  tmp="$WWW_DIR/events.jsonl.tmp.$$"
  cp "$1" "$tmp" 2>/dev/null || { rm -f "$tmp"; return 0; }
  mv "$tmp" "$WWW_DIR/events.jsonl" 2>/dev/null || rm -f "$tmp"
  return 0
}

# THE LINE COUNT AND THE CLOCK ARE READ BEFORE THE PAGE IS WRITTEN, and the
# commit is decided after it: the page a tick writes is the page that tick may
# commit, and a line appended while this tick was writing belongs to the next
# one. The clock is `date +%s` and nothing longer — whole seconds, so a window
# may be met with up to one real second less, and no reader of this measures
# wall time.
phase_refresher() {
  local f p s page lines now last_lines=0 last_at
  f="$(run_dir_path)/events.jsonl"
  last_at="$(date +%s)"
  while :; do
    sleep "$STATUS_INTERVAL"
    serve_events "$f"
    lines=0
    if [ -f "$f" ]; then
      lines="$({ wc -l <"$f" 2>/dev/null || true; } | tr -dc '0-9')"
      [ -n "$lines" ] || lines=0
    fi
    now="$(date +%s)"
    p="$(last_phase || true)"
    if [ -n "$p" ]; then
      # The sub-phase: what the run is doing INSIDE the phase, which is the
      # whole difference between a page that says `Wave 1` for an hour and one
      # that names the worker the wave is waiting on.
      s="$(project_read sub "$f" "$(run_dir_path)/args.json" || true)"
      page="$p"
      [ -n "$s" ] && page="$p · $s"
      write_status running "$page"
    fi
    if [ "$lines" -gt "$last_lines" ] &&
       { [ "$(( lines - last_lines ))" -ge "$COMMIT_EVENTS" ] ||
         [ "$(( now - last_at ))" -ge "$COMMIT_SECONDS" ]; }; then
      if commit_phase_evidence "${page:-$STATE}"; then
        last_lines="$lines"
        last_at="$now"
      fi
    fi
  done
}

# The subscription check, and the receipt of what ran. Both reads happen here,
# from `run_engine`, AFTER the `running` page is committed and pushed and
# BEFORE the engine unit is started — so a box that is not on the subscription
# ends the run `failed` with its account on the evidence branch, and no engine
# ever spends a credit against the wrong account. NO oauth_token IS A FAILURE,
# not a warning: a `claude` that cannot answer, or answers with something else,
# is a box that would bill somewhere other than the subscription this fleet
# rides. The version is read beside it, once, and written where
# `collect_evidence` picks it up, so every later transition carries the receipt
# of the engine binary this run actually ran on.
log_auth_status() {
  local out version
  out="$(env ANTHROPIC_BASE_URL="$ANTHROPIC_PROXY_URL" CLAUDE_CODE_OAUTH_TOKEN=placeholder \
    claude auth status 2>&1 || true)"
  log "claude auth status: $(printf '%s' "$out" | tr '\n' ' ')"
  case "$out" in
    *api_key*) fail "claude auth status reports api_key — that bills exe.dev credits, refusing to run" ;;
  esac
  case "$out" in
    *oauth_token*) : ;;
    *) fail "claude auth status shows no oauth_token — this box is not on the claude-max subscription, refusing to run" ;;
  esac
  version="$(env ANTHROPIC_BASE_URL="$ANTHROPIC_PROXY_URL" CLAUDE_CODE_OAUTH_TOKEN=placeholder \
    claude --version 2>&1 || true)"
  log "claude version: $(printf '%s' "$version" | tr '\n' ' ')"
  printf '%s\n' "$version" >"$CLAUDE_VERSION_FILE"
}

# --- the bearer probe --------------------------------------------------------
#
# ONE REQUEST, BEFORE THE WAVE. `claude auth status` proves the box is holding
# an oauth_token; it does not prove that token still works. A revoked bearer
# (run-100) or an integration the VM lost (run-95) is found today by the first
# worker to be refused — after the exams and the implementers have been
# launched and their tokens spent. This asks the cheapest question there is,
# once, and parks the run at boot when the answer is a refusal.
#
# WHY `/api/oauth/usage`: the edge injects its own bearer on every request to
# the proxy and an injected header REPLACES the client's same-named one
# (measured 2026-09-03, memory `exe-http-proxy-header-semantics`), so the
# placeholder below is swapped for the real token and the answer is about that
# token and not about this script. The endpoint costs no tokens — it is the one
# `fleet/claude-token.mjs usage` already reads.
#
# TWO REFUSALS, TOLD APART BY THE BODY'S SHAPE, because they send an operator to
# two different places:
#
#   * the BEARER itself — 401/403 with a JSON body carrying `"type":"error"`;
#     the token is dead or the account is not permitted, and the fix is a
#     refresh. The message is the document's own, verbatim.
#   * the EDGE — a 403 whose body is exe.dev's plain-text
#     `integration not found or not attached to this VM (trace: <32 hex>)`,
#     byte-identical for an integration that was detached and one that never
#     existed. The trace id is what exe.dev support resolves, so the whole line
#     rides into the cell.
#
# ANYTHING ELSE IS INCONCLUSIVE AND PROCEEDS. A probe that manufactured a park
# out of a flake — curl that could not connect, a 500 from the proxy — would
# cost more runs than it saved, and a run whose credential really is dead is
# still stopped by the engine's own `CREDENTIAL_STATUSES` row at its first
# worker. The probe's job is to make the common case cheap, not to be the only
# guard.
bearer_probe() {
  local answer code body trimmed compact class="" message="" edge_line
  # `await_branch_visible`'s shape: no `-f`, the status riding as the answer's
  # last line, so a refusal is an ANSWER to be classified rather than an error
  # that takes down a `set -e` script. `--max-time` bounds a proxy that hangs:
  # a boot must not wait on this longer than it would take to find out the hard
  # way.
  answer="$(fleet_curl -sS --max-time 20 \
    -H 'authorization: Bearer placeholder' \
    "$ANTHROPIC_PROXY_URL/api/oauth/usage" -w '\n%{http_code}' 2>/dev/null || true)"
  code="$(printf '%s' "$answer" | tail -n 1)"
  body="$(printf '%s' "$answer" | sed '$d')"

  if [ "$code" = 200 ]; then
    log "bearer probe: alive"
    return 0
  fi
  case "$code" in
    401|403) : ;;
    *) log "bearer probe: inconclusive (${code:-no answer})"; return 0 ;;
  esac

  # A JSON error document: the first non-space byte is `{` and the document
  # says so. `json_field message` answers the FIRST `"message": "…"` in it,
  # which in this body is `error.message`.
  trimmed="$(printf '%s' "$body" | sed -e 's/^[[:space:]]*//')"
  compact="$(printf '%s' "$body" | tr -d ' \t\n')"
  case "$trimmed" in
    '{'*)
      case "$compact" in
        *'"type":"error"'*)
          class=bearer
          message="$(printf '%s' "$body" | json_field message)"
          [ -n "$message" ] || message="no message" ;;
      esac ;;
  esac

  # The edge's own refusal, matched on the sentence it is, with the trace id
  # kept verbatim. The `grep` is guarded exactly as `json_field`'s is: a match
  # that found nothing is an answer, and the `head` below closes early over it.
  if [ -z "$class" ] && [ "$code" = 403 ]; then
    edge_line="$(printf '%s' "$body" | { grep -Eo 'integration not found or not attached to this VM \(trace: [0-9a-f]{32}\)' || true; } | head -n 1)"
    if [ -n "$edge_line" ]; then
      class=edge
      message="$edge_line"
    fi
  fi

  # A 401/403 of some third shape is still the bearer being refused — the class
  # a reader can act on — with as much of the body as a status cell can carry.
  if [ -z "$class" ]; then
    class=bearer
    message="$(printf '%s' "$body" | tr '\n' ' ' | cut -c1-200)"
    [ -n "$message" ] || message="no message"
  fi

  # The park, in `do_boot`'s nothing-to-publish shape exactly: the page, the
  # evidence commit and its push, both record tags, one notify, exit 0. The run
  # never started an engine, so there is nothing to wait for and nothing to
  # publish — what it leaves is the record of why.
  ERROR="parked: credential $class $code — $message"
  log "bearer probe: refused — $ERROR"
  write_status parked "credential"
  collect_evidence
  push_evidence "$RUN_ID: parked — credential"
  record_tags
  notify "run-$RUN_N parked" "$TARGET_REPO — $ERROR"
  exit 0
}

# A transient SERVICE, not a scope: `--wait` hands back the engine's exit code
# and is refused for a scope, `--collect` unloads the unit when it stops so the
# is-active check below reads `inactive` rather than a lingering `failed`, and
# the memory cap bounds the engine alone — ssh, this script and the page keep
# their headroom. A service inherits neither cwd nor environment from here, so
# the cwd is a property and the child's variables ride in its own argv.
run_engine() {
  local code=0 refresher="" knobs=() kata=()
  # The three optional knobs as ARRAY elements: `${VAR:+--flag "$VAR"}` splits
  # on whitespace, and an argv this script builds must never depend on a
  # value's shape to stay one word.
  # The kata pair is one of them, and it rides DIRECTLY AFTER `--repo`: the
  # engine's run state lives in the hub named by that file, and a run whose plan
  # commit carried none is handed no `--kata` at all rather than an empty one.
  [ -n "$KATA_FILE" ] && kata+=(--kata "$KATA_FILE")
  [ -n "$TIER" ] && knobs+=(--tier "$TIER")
  [ -n "$OVERLAP" ] && knobs+=(--overlap "$OVERLAP")
  [ -n "$EFFORT" ] && knobs+=(--implementer-effort "$EFFORT")
  :
  log_auth_status
  # AFTER the token is proven present and BEFORE anything is started: the whole
  # value of this probe is that it happens while nothing has been spent.
  bearer_probe

  # The renderer address, when this box has one. An `if` and not a trailing
  # `&& .`: a bare `&&` as a function's last command makes the function's exit
  # status the test's, and a fleet with no such file would fail the boot under
  # `set -e`. The argv entry below is spelled `${TINYAPP_RENDER_URL:-}` for the
  # same reason — `set -u` kills a boot that reads an unset name.
  if [ -r "$FLEET_RENDER_ENV" ]; then
    . "$FLEET_RENDER_ENV"
    log "render: sourced $FLEET_RENDER_ENV"
  fi

  set +e
  # Its stdio redirected for the same reason: killing this loop leaves its
  # in-flight `sleep` behind for up to one interval, and a stray sleep holding
  # this script's stdout would make the run look unfinished to a reader.
  phase_refresher >/dev/null 2>>"$BOOT_LOG" &
  refresher=$!
  fleet_systemd_run --user "--unit=fleet-engine-$RUN_N" --pipe --wait --collect \
    -p MemoryMax=40G -p MemorySwapMax=0 -p "WorkingDirectory=$TARGET_DIR" -- \
    env -u CLAUDE_CONFIG_DIR \
      "ANTHROPIC_BASE_URL=$ANTHROPIC_PROXY_URL" \
      "CLAUDE_CODE_OAUTH_TOKEN=placeholder" \
      "ULTRAPOWERS_FLEET_RUN=$RUN_ID" \
      "TINYAPP_RENDER_URL=${TINYAPP_RENDER_URL:-}" \
      node "$ENGINE_REPO_DIR/fleet/run-main.mjs" \
      "$PLAN_FILE" "$RUN_ID" --repo "$TARGET_DIR" \
      ${kata[@]+"${kata[@]}"} \
      ${knobs[@]+"${knobs[@]}"} \
    2>&1 | tee -a "$ENGINE_LOG" >>"$BOOT_LOG"
  # The ENGINE's status, not `tee`'s — a pipeline's exit code is its last
  # command's, and reading it would report every failed run as a success.
  code=${PIPESTATUS[0]}
  # BETWEEN COMMITS, never inside one. The refresher holds `EVIDENCE_LOCK` for
  # the whole of a phase commit, so taking it here is the whole of what makes
  # this kill safe: an interrupted `pull --rebase` in the evidence worktree
  # would be the `publishing` commit's problem, and it never happens.
  evidence_lock || log "evidence: lock still held — killing the refresher anyway"
  kill "$refresher" 2>/dev/null
  wait "$refresher" 2>/dev/null
  evidence_unlock
  set -e

  printf '%s\n' "$code" >"$ENGINE_DONE_MARKER"
  log "engine: exited $code (output in $ENGINE_LOG)"
  return 0
}

engine_exit_code() {
  if [ -f "$ENGINE_DONE_MARKER" ]; then cat "$ENGINE_DONE_MARKER"; else echo 0; fi
}

engine_already_ran() {
  [ -f "$ENGINE_DONE_MARKER" ] && return 0
  [ -n "$(gate_receipt_path)" ] && return 0
  return 1
}

# `publishing` and `parked` are claims that no model is running. They are made
# only after systemd says so — this check IS Amendment 10 made mechanical: the
# push and the PR happen after the engine service is inactive, never beside it.
await_engine_inactive() { # $1 = unit name, without the `.service` suffix
  local unit="$1" attempts n=0 out
  attempts="$(poll_attempts "$ENGINE_STOP_TIMEOUT")"
  while [ "$n" -lt "$attempts" ]; do
    out="$(fleet_systemctl --user is-active "$unit.service" 2>&1 || true)"
    case "$out" in
      *inactive*|*failed*|*unknown*|*"not found"*|"")
        log "engine: $unit.service is ${out:-gone} — no model is running"
        return 0 ;;
    esac
    n=$(( n + 1 ))
    sleep "$POLL_SECONDS"
  done
  return 1
}

# --- evidence ----------------------------------------------------------------

# The lock both writers of the evidence worktree take around their git work.
# `mkdir` and not a flag file: creating a directory is the one test-and-set
# every filesystem does atomically, so two processes never both believe they
# hold it. Waiting is bounded — see `EVIDENCE_LOCK_TRIES`.
evidence_lock() {
  local n=0
  while ! mkdir "$EVIDENCE_LOCK" 2>/dev/null; do
    n=$(( n + 1 ))
    if [ "$n" -ge "$EVIDENCE_LOCK_TRIES" ]; then return 1; fi
    sleep 0.1
  done
  return 0
}

evidence_unlock() { rmdir "$EVIDENCE_LOCK" 2>/dev/null || true; }

# THE HUB'S RECORD, BESIDE THE ENGINE'S. The issues and the event log of the
# run's kata project, one JSON object per line with `kind` first, written at
# every transition so the branch carries the hub's account of the run even
# after the project itself is archived.
#
# PAGED FROM ZERO EVERY TIME, because this runs at every transition and each
# export is a whole file: the walk starts at `after_id=0` and follows each
# answer's `next_after_id` until an answer's `events` is empty. Nothing here
# remembers a cursor between exports.
#
# TEMPORARY NAME, THEN A MOVE, and a fetch that fails leaves the previous file
# exactly as it was: a half-written record on the branch would be worse than
# last transition's whole one, and the hub being briefly unreachable is not a
# reason to lose what was already exported.
#
# The project id is read with `python3` and never with `json_field`: it is an
# integer nested under `project`, and `json_field` answers the first
# `"name": "value"` string match in the document — which here would be some
# other field entirely.
kata_export() {
  local dest project tmpdir tmp code page=0 answer count next pages=()
  # The first endpoint's last segment, named once instead of written inline:
  # the retired-name check in `fleet/tests/test_sandbox_boot_residuals.mjs`
  # forbids that bare slash-prefixed token anywhere in this file, and what it
  # retired was the GitHub filing this boot no longer does — a different
  # endpoint on a different host. The URL curl is handed is unchanged.
  local open="issues"
  [ -n "$KATA_FILE" ] && [ -f "$KATA_FILE" ] || return 0
  dest="$EVIDENCE_DIR/$EVIDENCE_PATH"
  project="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["project"]["id"])' \
    "$KATA_FILE" 2>/dev/null || true)"
  if [ -z "$project" ]; then
    log "kata: $KATA_FILE names no project.id — nothing to export"
    return 0
  fi
  mkdir -p "$dest"
  # Inside the destination, so the `mv` below is a rename on one filesystem,
  # and named for this shell — the refresher that also commits the record is a
  # subshell of a script that can be started again on the same box.
  tmpdir="$dest/.kata-export.$$"
  rm -rf "$tmpdir"
  mkdir -p "$tmpdir"
  code=0
  fleet_curl -fsS --max-time 30 \
    "$KATA_URL/api/v1/projects/$project/$open?limit=1000" -o "$tmpdir/$open.json" || code=$?
  if [ "$code" != 0 ]; then
    rm -rf "$tmpdir"
    log "kata: export failed (curl exit $code) — previous $KATA_EXPORT_FILE kept"
    return 0
  fi
  next=0
  while :; do
    page=$(( page + 1 ))
    code=0
    fleet_curl -fsS --max-time 30 \
      "$KATA_URL/api/v1/projects/$project/events?after_id=$next&limit=1000" \
      -o "$tmpdir/events-$page.json" || code=$?
    if [ "$code" != 0 ]; then
      rm -rf "$tmpdir"
      log "kata: export failed (curl exit $code) — previous $KATA_EXPORT_FILE kept"
      return 0
    fi
    # `<count> <next_after_id>` off the page itself. An unreadable answer is
    # counted as empty, which ends the walk with what the earlier pages held.
    answer="$(kata_page_head "$tmpdir/events-$page.json")"
    count="${answer%% *}"
    next="${answer##* }"
    case "$count" in ''|*[!0-9]*) count=0 ;; esac
    case "$next" in ''|*[!0-9]*) next=0 ;; esac
    # AN EMPTY PAGE ENDS THE WALK and contributes no line — it is the answer
    # that says the log is exhausted, not a page of it.
    [ "$count" = 0 ] && break
    pages+=("$tmpdir/events-$page.json")
  done
  tmp="$tmpdir/$KATA_EXPORT_FILE"
  code=0
  kata_assemble "$tmpdir/$open.json" ${pages[@]+"${pages[@]}"} >"$tmp" || code=$?
  if [ "$code" != 0 ]; then
    rm -rf "$tmpdir"
    log "kata: export failed (the hub's answer did not read) — previous $KATA_EXPORT_FILE kept"
    return 0
  fi
  mv "$tmp" "$dest/$KATA_EXPORT_FILE"
  rm -rf "$tmpdir"
}

# One page's `<count of events> <next_after_id>`, or `0 0` for an answer that
# does not read as one.
kata_page_head() { # $1 = a page of the events endpoint
  python3 -c '
import json, sys
try:
    with open(sys.argv[1], encoding="utf-8") as fh:
        doc = json.load(fh)
except Exception:
    print("0 0")
    raise SystemExit(0)
rows = doc.get("events") if isinstance(doc, dict) else doc
rows = rows if isinstance(rows, list) else []
after = doc.get("next_after_id") if isinstance(doc, dict) else 0
print("%d %d" % (len(rows), after if isinstance(after, int) else 0))
' "$1" 2>/dev/null || printf '0 0\n'
}

# The record itself: every issue, then every event, `kind` first and the
# object's own fields spread after it, one compact line each.
kata_assemble() { # $1 = the issues answer; $2.. = the event pages, in order
  python3 -c '
import json, sys

def rows(path, key):
    with open(path, encoding="utf-8") as fh:
        doc = json.load(fh)
    got = doc.get(key) if isinstance(doc, dict) else doc
    return got if isinstance(got, list) else []

out = []
for row in rows(sys.argv[1], "issues"):
    out.append({"kind": "issue", **row})
for page in sys.argv[2:]:
    for row in rows(page, "events"):
        out.append({"kind": "event", **row})
for row in out:
    print(json.dumps(row, separators=(",", ":"), ensure_ascii=False))
' "$@"
}

# --- the run issue's close ---------------------------------------------------
#
# THE RUN'S OWN ISSUE CLOSES WITH THE RUN (#937). The engine closes each TASK's
# issue at adoption and owns nothing else; the run issue the launcher filed is
# the sandbox's, and until this write it stayed `open` on the hub after the PR
# had merged (run-112). ONE WRITE, at the terminal transition, and BEFORE that
# transition's export: the close is an `issue.closed` event of the run's
# project, and the `collect_evidence` right after it carries it out in
# `kata.jsonl` on the tag like every other write.
#
# THE REASON IS THE DISPOSITION. `done` when the run ended `done`, with the
# pull request as `{"type":"pr","url"}` evidence and the squash commit as
# `{"type":"commit","sha"}` when the sandbox merged it; `wontfix` — which kata
# refuses evidence on — when the run parked or failed, carrying the page's own
# `error`. A `done` message has to read on its own (kata wants 40 characters or
# more, run-111): it is the plan's H1 and the merge sha.
#
# NON-FATAL, THE SAME WAY THE ENGINE'S WRITES ARE (#934): a close the hub
# refuses, or a hub that has gone dark since the ping, is one
# `kata:write-failed` event (`what` `close`, the run's `uid`, the curl exit in
# `detail`) on the record, and the run publishes exactly as it would have. The
# idempotency key is the run's own — `run-<N>:run:close` — so a re-entered boot
# that closes again is the same close and not a second one. The actor is
# `sandbox:run-<N>`: the launcher writes as `launch`, the engine as
# `engine:run-<N>`, and the record should say which of the three closed it.
#
# The endpoint's collection segment is spelled through `$open`, as the export's
# is, for the reason given there.
kata_close_run() { # $1 = done|wontfix, $2 = message
  local reason="$1" message="$2" ids project uid body code
  local open="issues"
  [ -n "$KATA_FILE" ] && [ -f "$KATA_FILE" ] || return 0
  [ -z "$KATA_RUN_CLOSED" ] || return 0
  KATA_RUN_CLOSED=1
  ids="$(python3 -c '
import json, sys
doc = json.load(open(sys.argv[1], encoding="utf-8"))
print("%s %s" % (doc["project"]["id"], doc["run"]["uid"]))
' "$KATA_FILE" 2>/dev/null || true)"
  project="${ids%% *}"
  uid="${ids##* }"
  if [ -z "$project" ] || [ -z "$uid" ] || [ "$ids" = "$project" ]; then
    log "kata: $KATA_FILE names no project.id and run.uid — the run issue is not closed"
    return 0
  fi
  # The body, built where a string is a string: the message carries the plan's
  # H1 verbatim, and `wontfix` carries no evidence because kata refuses any.
  body="$(KATA_ACTOR="sandbox:$RUN_ID" KATA_REASON="$reason" KATA_MESSAGE="$message" \
    KATA_PR_URL="$PR_URL" KATA_MERGED_SHA="$MERGED_SHA" python3 -c '
import json, os
reason = os.environ["KATA_REASON"]
evidence = []
if reason == "done":
    if os.environ.get("KATA_PR_URL"):
        evidence.append({"type": "pr", "url": os.environ["KATA_PR_URL"]})
    if os.environ.get("KATA_MERGED_SHA"):
        evidence.append({"type": "commit", "sha": os.environ["KATA_MERGED_SHA"]})
body = {"actor": os.environ["KATA_ACTOR"], "reason": reason,
        "message": os.environ["KATA_MESSAGE"], "evidence": evidence,
        "retry_protocol": "close-v1"}
print(json.dumps(body, separators=(",", ":"), ensure_ascii=False))
')"
  code=0
  fleet_curl -fsS --max-time 30 -X POST -H 'content-type: application/json' \
    -H "Idempotency-Key: $RUN_ID:run:close" -d "$body" \
    "$KATA_URL/api/v1/projects/$project/$open/$uid/actions/close" >/dev/null 2>&1 || code=$?
  if [ "$code" = 0 ]; then
    log "kata: run issue $uid closed $reason"
    return 0
  fi
  log "kata: run issue close ($reason) refused — curl exit $code, recorded, continuing"
  append_event kata:write-failed what=s:close "uid=s:$uid" \
    "detail=s:run issue close ($reason) answered curl exit $code"
}

# The first line of the page's `error`, for a close message: a failed run's
# error carries the engine's last lines and the message wants the sentence.
error_head() { { printf '%s' "$ERROR" || true; } | head -n 1; }

collect_evidence() {
  local dest receipt approve run_dir f rel rows
  dest="$EVIDENCE_DIR/$EVIDENCE_PATH"
  mkdir -p "$dest"
  receipt="$(gate_receipt_path)"
  [ -n "$receipt" ] && cp "$receipt" "$dest/gate-receipt.json"
  # The two-move rule's second move rides beside the verdict it overrode:
  # without it the branch shows a greened NEEDS_ACK run and no sign of what
  # greened it.
  approve="$(approve_receipt_path)"
  [ -n "$approve" ] && cp "$approve" "$dest/approve-receipt.json"
  run_dir="$(run_dir_path)"
  # `standing-approval.json` is the pre-authorization record the engine writes
  # beside the receipts. Every name here is copied WHEN THE ENGINE WROTE IT — a
  # run that needed no approval, or that died before the gate ran, commits none.
  for f in report.json events.jsonl receipt.json standing-approval.json; do
    [ -f "$run_dir/$f" ] && cp "$run_dir/$f" "$dest/$f"
  done
  # The HUB's record, beside the engine's own log. A run with no kata record
  # exports nothing and writes no file.
  kata_export
  # The engine's per-worker transcripts — the reduced records ultralearn's
  # readers slice, and the only trace of what a worker actually did that
  # outlives the box. Copied FILE BY FILE, never `cp -R` of the directory: this
  # function runs at every `write_status` transition and once more at `fail`, so
  # a directory copy onto a destination that already holds `transcripts/` nests
  # a second one inside the first. A run whose engine wrote none commits none.
  if [ -d "$run_dir/transcripts" ]; then
    mkdir -p "$dest/transcripts"
    cp "$run_dir/transcripts/"*.jsonl "$dest/transcripts/" 2>/dev/null || true
  fi
  # The state exams' own records — `task-<id>/<stem>-<pass>/<file>`, a tree of
  # arbitrary depth rather than one flat directory, so the copy WALKS THE
  # REGULAR FILES and rebuilds each one's relative path under the destination.
  # Never `cp -R` of the directory, for the reason the transcripts give: this
  # function runs again at every later transition, and a directory copy onto a
  # destination that already holds `state-exams/` nests a second one inside the
  # first. A run whose engine wrote none commits none — nothing here creates
  # `$dest/state-exams` until there is a file to put in it. Every copy in the
  # walk is tolerant (#859): the loop body runs under `set -euo pipefail` in
  # the pipeline's subshell, so one artifact an exam left unreadable would
  # otherwise end the walk, the commit and the transition with it — and the
  # record is evidence, never control flow. The file that could not be copied
  # is named in the log and the rest of the tree still lands.
  if [ -d "$run_dir/state-exams" ]; then
    find "$run_dir/state-exams" -type f -print | while IFS= read -r f; do
      rel="${f#"$run_dir/state-exams/"}"
      mkdir -p "$dest/state-exams/$(dirname "$rel")" 2>/dev/null || true
      cp "$f" "$dest/state-exams/$rel" 2>/dev/null \
        || log "evidence: state-exams/$rel could not be copied — skipped"
    done
  fi
  # The engine's combined output rides along: it is the only evidence a run that
  # died before writing a receipt produces at all.
  [ -f "$ENGINE_LOG" ] && cp "$ENGINE_LOG" "$dest/engine.log"
  # The receipt of the engine binary: written once, before the engine started,
  # so every transition from there on carries it.
  [ -f "$CLAUDE_VERSION_FILE" ] && cp "$CLAUDE_VERSION_FILE" "$dest/claude-version.txt"
  # The residual ledger, written HERE and not at publish: a PR is closed by its
  # merge and the checklist in its body closes with it, so the same items go
  # onto the record, where nothing closes them. Written from the two copies
  # just made — so every transition after the engine wrote them carries it, and
  # a parked run that opens no PR still commits it.
  #
  # NO ITEM, NO FILE — an absent ledger is a run that left nothing, not a run
  # that was never read — and a file an earlier transition wrote is APPENDED
  # TO, never rewritten (#883): the ledger is the union of every transition's
  # rows — the existing lines first, in their order, then only the new lines
  # the file does not already carry, compared whole. A row an earlier report
  # carried and a later one does not — a task the engine re-ran, a report a
  # repair round shrank — stays on the record, and re-reading the same record
  # adds nothing. Built in a sibling file and moved over, so the file is never
  # read as its own pattern list while it is being written.
  rows="$(residual_rows || true)"
  if [ -n "$rows" ]; then
    if [ -s "$dest/$RESIDUALS_FILE" ]; then
      {
        cat "$dest/$RESIDUALS_FILE"
        printf '%s\n' "$rows" | grep -vxF -f "$dest/$RESIDUALS_FILE" || true
      } >"$dest/$RESIDUALS_FILE.tmp"
      mv "$dest/$RESIDUALS_FILE.tmp" "$dest/$RESIDUALS_FILE"
    else
      printf '%s\n' "$rows" >"$dest/$RESIDUALS_FILE"
    fi
  fi
  cp "$STATUS_FILE" "$dest/status.json" 2>/dev/null || true
  log "evidence: $(ls "$dest" | tr '\n' ' ')"
}

# ONE COMMIT PER TRANSITION and one per relayed phase (#723), every one of them
# made and pushed from the worktree — the run directory is the only path ever
# staged, so nothing the engine left under `.claude/` can ride along by accident.
#
# `EVIDENCE_PUSH_SOFT` is the phase commits' mode: fewer rebases before giving
# up, and giving up means LEAVING THE COMMIT LOCAL rather than failing the run.
# The commit is already made either way — the next push carries it — and a
# phase that could not be published while the engine works is not a run that
# failed. Every transition still pushes the hard way: five refusals there are a
# branch this box cannot write, which is a failure with nothing left to say.
push_evidence() { # $1 = commit subject
  local n=0 limit=5
  if [ -n "$EVIDENCE_PUSH_SOFT" ]; then limit=3; fi
  mkdir -p "$EVIDENCE_DIR/$EVIDENCE_PATH"
  if ! fleet_git -C "$EVIDENCE_DIR" add -- "$EVIDENCE_PATH"; then
    if [ -n "$EVIDENCE_PUSH_SOFT" ]; then
      log "evidence: add $EVIDENCE_PATH failed — left for the next commit"
      return 0
    fi
    fail "evidence: add $EVIDENCE_PATH"
  fi
  ensure_git_identity
  if ! fleet_git -C "$EVIDENCE_DIR" commit -m "$1"; then
    log "evidence: nothing to commit"
  fi
  while :; do
    if fleet_git -C "$EVIDENCE_DIR" push origin "HEAD:refs/heads/$EVIDENCE_BRANCH"; then
      log "evidence: pushed to $EVIDENCE_BRANCH"
      return 0
    fi
    n=$(( n + 1 ))
    if [ "$n" -ge "$limit" ]; then
      if [ -n "$EVIDENCE_PUSH_SOFT" ]; then
        log "evidence: push rejected $n times — the commit stays local"
        return 0
      fi
      # `FAILING` here and not only in `fail`: this IS the failing push, and a
      # `fail` that tried to push its own account would spend five more.
      FAILING=1
      fail "evidence: push to $EVIDENCE_BRANCH rejected 5 times"
    fi
    log "evidence: push rejected — rebasing (attempt $n)"
    fleet_git -C "$EVIDENCE_DIR" pull --rebase origin "$EVIDENCE_BRANCH" || true
  done
}

ensure_git_identity() {
  # The golden bakes an identity. A golden that did not still commits — the
  # author line is cosmetic here, since the PUSH is attributed by the integration
  # (`--act-as-user`), not by the commit.
  if [ -z "$(fleet_git -C "$EVIDENCE_DIR" config user.email 2>/dev/null || true)" ]; then
    fleet_git -C "$EVIDENCE_DIR" config user.email "${VM_EMAIL:-fleet@exe.dev}" || true
    fleet_git -C "$EVIDENCE_DIR" config user.name "${VM_NAME:-fleet-$RUN_ID}" || true
  fi
}

gate_verdict() {
  local receipt
  receipt="$(gate_receipt_path)"
  [ -n "$receipt" ] || return 0
  json_field verdict <"$receipt"
}

# The paths of the gate receipt's `suite.unattributed` — the tests that went red
# on the integrated tree with no task to charge the failure to. The gate records
# them beside its verdict, and a run can be PASS and carry them: the verdict is
# about the work the plan named, and an unattributed red is a failure nobody's
# patch explains. Such a run publishes a READY PR and does not merge it.
#
# ONE READER, in a JSON parser and not a line matcher, for `fold_receipt`'s
# reasons: an absent, unparsable or oddly-shaped receipt answers empty rather
# than failing a `set -e` script, and a receipt from before this key existed —
# no `suite`, or a `suite` without `unattributed` — answers empty too, so a run
# whose gate wrote the older shape merges exactly as it always did.
#
#   `list`   (default) one path per line
#   `joined` the same paths on one line, `, `-separated — the event's `detail`
#   `first`  the first path alone — the note's and the card's
gate_unattributed() { # $1 = list | joined | first
  local receipt
  receipt="$(gate_receipt_path)"
  [ -n "$receipt" ] || return 0
  python3 -c '
import json, sys
path, query = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else "list")
try:
    doc = json.load(open(path))
except Exception:
    sys.exit(0)
suite = doc.get("suite") if isinstance(doc, dict) else None
paths = suite.get("unattributed") if isinstance(suite, dict) else None
if not isinstance(paths, list):
    sys.exit(0)
paths = [p for p in paths if isinstance(p, str) and p]
if not paths:
    sys.exit(0)
if query == "joined":
    print(", ".join(paths))
elif query == "first":
    print(paths[0])
else:
    for p in paths:
        print(p)
' "$receipt" "${1:-list}"
}

# --- the publish fold --------------------------------------------------------
#
# run-32 task 4 (#715). Between the engine and the push sits one more model:
# the folder, which rebases this run's branch onto the base as it is NOW and
# runs the suite on the result. It runs as its own transient unit, under the
# same edge-injected envelope as the engine and with no token anywhere in its
# argv, and it reports through ONE file — `publish-fold/receipt.json` in the
# evidence worktree, which is how every receipt it writes rides the evidence
# commit without `collect_evidence` learning a new name.
#
# What this script does with that file is the whole of its side: it pushes the
# head the folder left (with a lease, once an earlier attempt pushed one), it
# renders what happened into the PR body, and it HOLDS the merge whenever the
# fold did not end clean. A red suite after a clean fold holds the PR with the
# failure in its body.

fold_dir() { printf '%s/%s/publish-fold\n' "$EVIDENCE_DIR" "$EVIDENCE_PATH"; }

# ONE READER for the receipt, so every question about it is asked of a JSON
# parser and an absent, unparsable or oddly-shaped file answers empty rather
# than failing a `set -e` script. `$1` is the query:
#   `field <attempt|''> <name>` — one value; the top-level document when the
#                                 attempt is empty, '' when there is no such key
#   `top`     — the highest attempt carrying a `disposition`
#   `pushed`  — the highest attempt carrying a `pushedHead`
#   `highest` — the highest attempt with a row at all
fold_receipt() {
  local f
  f="$(fold_dir)/receipt.json"
  [ -f "$f" ] || return 0
  python3 -c '
import json, sys
path, query, rest = sys.argv[1], sys.argv[2], sys.argv[3:]
try:
    doc = json.load(open(path))
    if not isinstance(doc, dict):
        raise ValueError("not an object")
except Exception:
    sys.exit(0)
attempts = doc.get("attempts")
if not isinstance(attempts, dict):
    attempts = {}
def keys(pred):
    out = []
    for k, row in attempts.items():
        if str(k).isdigit() and isinstance(row, dict) and pred(row):
            out.append(int(k))
    return sorted(out)
if query == "field":
    who, name = rest[0], rest[1]
    row = attempts.get(who) if who else doc
    if isinstance(row, dict) and row.get(name) is not None:
        print(row[name])
elif query == "top":
    ks = keys(lambda r: r.get("disposition"))
    if ks: print(ks[-1])
elif query == "pushed":
    ks = keys(lambda r: r.get("pushedHead"))
    if ks: print(ks[-1])
elif query == "highest":
    ks = keys(lambda r: True)
    if ks: print(ks[-1])
' "$f" "$@"
}

fold_field() { fold_receipt field "$1" "$2"; }

# ONE WRITER, and it writes `receipt.json.tmp` then renames — the folder and
# this script both hold the file, and a reader that caught a half-written
# receipt would read a run's disposition wrong. `$2` seeds `engineHead` when
# the file is absent or unparsable; the rest are name/value pairs merged into
# attempt `$1`'s row, leaving every other key the folder wrote in place.
fold_receipt_set() { # $1 = attempt, $2 = engineHead seed, then name value …
  local dir
  dir="$(fold_dir)"
  mkdir -p "$dir"
  python3 -c '
import json, os, sys
path, attempt, seed, pairs = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4:]
try:
    doc = json.load(open(path))
    if not isinstance(doc, dict):
        raise ValueError("not an object")
except Exception:
    doc = {"engineHead": seed, "attempts": {}}
if not isinstance(doc.get("attempts"), dict):
    doc["attempts"] = {}
row = doc["attempts"].get(attempt)
if not isinstance(row, dict):
    row = {}
for i in range(0, len(pairs) - 1, 2):
    row[pairs[i]] = pairs[i + 1]
doc["attempts"][attempt] = row
tmp = path + ".tmp"
with open(tmp, "w") as fh:
    json.dump(doc, fh, indent=2)
    fh.write("\n")
os.replace(tmp, path)
' "$dir/receipt.json" "$@"
}

# The sha this attempt has to put back when the folder died mid-fold. Attempt 1
# restores the head the ENGINE left, which the folder records in `engine-head`
# before it touches anything — and which this script writes itself when the
# folder died before writing it, since a rewind with no floor is worse than a
# rewind to where the branch already is. Every fold-again restores the attempt
# BEFORE it: attempt N's floor is attempt N−1's candidate, the folded head that
# was pushed — which is the floor `publish-fold.mjs` folds onto on its own side.
fold_restore() { # $1 = attempt
  local dir head prior
  dir="$(fold_dir)"
  if [ "$1" -gt 1 ] 2>/dev/null; then
    prior=$(( $1 - 1 ))
    head="$(fold_field "$prior" candidate)"
    [ -n "$head" ] && { printf '%s\n' "$head"; return 0; }
  fi
  if [ ! -f "$dir/engine-head" ]; then
    mkdir -p "$dir"
    fleet_git -C "$TARGET_DIR" rev-parse "$BRANCH" >"$dir/engine-head" 2>/dev/null || true
  fi
  head="$(head -n 1 "$dir/engine-head" 2>/dev/null || true)"
  printf '%s\n' "$head"
}

# The disposition of attempt `$1`, as a sentence — the vocabulary is the
# folder's (`folded`, `nothing to join`, `tip unmoved`, `suite red`,
# `conflict parked`, `cannot fold`), and only the last two carry a detail.
fold_phrase() { # $1 = attempt
  local d detail
  d="$(fold_field "$1" disposition)"
  case "$d" in
    "")
      printf 'no disposition recorded\n' ;;
    "conflict parked")
      detail="$(fold_field "$1" path)"
      printf 'conflict parked on %s\n' "${detail:-<unknown path>}" ;;
    "cannot fold")
      detail="$(fold_field "$1" reason)"
      printf 'cannot fold: %s\n' "${detail:-<no reason>}" ;;
    *)
      printf '%s\n' "$d" ;;
  esac
}

# What the fold leaves the merge — the hold, or nothing. `folded`, `nothing to
# join` and `tip unmoved` are not holds: the first two are a fold that ended
# clean, and the third is answered by `the fold moved nothing`, which `do_boot`'s
# loop writes itself on a `tip unmoved` disposition.
fold_hold_note() {
  local a
  a="$(fold_receipt top)"
  [ -n "$a" ] || return 0
  case "$(fold_field "$a" disposition)" in
    "suite red"|"conflict parked"|"cannot fold")
      printf 'left open: publish fold — %s\n' "$(fold_phrase "$a")" ;;
  esac
}

# ONE ATTEMPT of the fold. The bracket is `run_engine`'s, and only its: a
# transient service, `--wait` for the code, `${PIPESTATUS[0]}` inside
# `set +e`/`set -e` because `set -euo pipefail` would otherwise kill `do_boot`
# on a folder that exits non-zero. Two things beside it are deliberately
# ABSENT. No `phase_refresher`: it rewrites the page from `engine:phase` events
# and would erase the deadman's `parked` the moment it wrote one. No
# `ENGINE_DONE_MARKER` write: that file is the ENGINE's exit code, and
# `engine_exit_code` would read the folder's on re-entry as an engine failure.
publish_fold() { # $1 = attempt
  local attempt="$1" dir code=0 page restore last reason
  dir="$(fold_dir)"
  # Before the bracket, because `tee -a` needs the directory to exist — and
  # because every receipt the folder writes lands here, inside the evidence
  # worktree, where `push_evidence` stages it without a list change.
  mkdir -p "$dir"
  FOLD_ATTEMPTS="$attempt"

  set +e
  fleet_systemd_run --user "--unit=fleet-fold-$RUN_N-$attempt" --pipe --wait --collect \
    -p MemoryMax=40G -p MemorySwapMax=0 -p "WorkingDirectory=$TARGET_DIR" -- \
    env -u CLAUDE_CONFIG_DIR \
      "ANTHROPIC_BASE_URL=$ANTHROPIC_PROXY_URL" \
      "CLAUDE_CODE_OAUTH_TOKEN=placeholder" \
      "ULTRAPOWERS_FLEET_RUN=$RUN_ID" \
      node "$ENGINE_REPO_DIR/fleet/publish-fold.mjs" \
      --repo "$TARGET_DIR" --base "$BASE_SHA" --branch "$BRANCH" \
      --run "$RUN_N" --run-dir "$(run_dir_path)" \
      --evidence-dir "$EVIDENCE_DIR/$EVIDENCE_PATH" --attempt "$attempt" \
    2>&1 | tee -a "$dir/publish-fold-$attempt.log" >>"$BOOT_LOG"
  code=${PIPESTATUS[0]}
  set -e
  log "fold: attempt $attempt exited $code"
  await_engine_inactive "fleet-fold-$RUN_N-$attempt" \
    || fail "fold: fleet-fold-$RUN_N-$attempt.service still active after ${ENGINE_STOP_TIMEOUT}s"

  # THE PAGE FIRST, then the exit code. A unit the deadman stopped exits
  # non-zero exactly like a folder that crashed, and the two want opposite
  # things: the crash rewinds the branch and goes on to the push, the deadman
  # stops here. The page is what tells them apart, because the deadman wrote
  # `parked` while the unit was still running.
  page="$(read_status_field state)"
  if [ "$page" = "parked" ]; then
    log "fold: the page reads parked — the deadman stopped attempt $attempt"
    # A half-written receipt is the folder's, not evidence: it dies with it.
    rm -f "$dir/receipt.json.tmp"
    collect_evidence
    push_evidence "$RUN_ID: parked — deadman"
    record_tags
    exit 0
  fi

  # A folder that wrote its disposition and THEN died keeps its row: what it
  # decided is what happened, whatever the exit code says afterwards.
  if [ "$code" != "0" ] && [ -z "$(fold_field "$attempt" disposition)" ]; then
    restore="$(fold_restore "$attempt")"
    if [ -n "$restore" ]; then
      fleet_git -C "$TARGET_DIR" update-ref "refs/heads/$BRANCH" "$restore" \
        || log "fold: update-ref $BRANCH $restore was refused"
    fi
    last="$(tail -n 1 "$dir/publish-fold-$attempt.log" 2>/dev/null || true)"
    reason="exit $code: $last"
    fold_receipt_set "$attempt" "$restore" \
      disposition "cannot fold" reason "$reason" candidate "$restore"
    log "fold: attempt $attempt recorded no disposition — cannot fold ($reason)"
  fi

  FOLD_HOLD="$(fold_hold_note)"
  [ -z "$FOLD_HOLD" ] || log "fold: $FOLD_HOLD"
  return 0
}

# The push of the run's own branch, which the fold moved. A plain push while no
# attempt has pushed anything, and a LEASE on the last head this script pushed
# once one has — the fold rebases, so the second push is not a fast-forward,
# and `--force` would overwrite whatever else reached the branch meanwhile
# while `--force-with-lease` refuses and this run parks instead.
push_head() {
  local attempt lease

  # THE EXAMS, OFF THE BRANCH AND ONTO THE RECORD, before anything of this
  # branch reaches the remote. The run's exams ride the branch so the fold's
  # suite runs them, and the operator who opens the pull request must not be
  # shown them: they are this run's measurement of its own work, not a change to
  # the target. So the strip sits HERE and not beside the fold — every push of
  # `$BRANCH` goes through this function, and attempt N's fold floors on attempt
  # N-1's candidate, which is the head BEFORE that attempt's strip, so the exams
  # come back with every re-fold and are taken off again here. It runs before
  # `await_branch_visible` reads `BRANCH_HEAD`, so the head recorded as
  # `pushedHead` — and therefore the lease every later attempt pushes under, read
  # for any N from `fold_receipt pushed` / `fold_field <attempt> pushedHead` — is
  # the strip commit the remote actually holds. A strip that fails stops the run: the
  # alternative is publishing the exams.
  bash "$ENGINE_REPO_DIR/fleet/strip-exams.sh" \
    "$TARGET_DIR" "$BRANCH" "$RUN_ID" "$EVIDENCE_DIR/$EVIDENCE_PATH" \
    >>"$BOOT_LOG" 2>&1 \
    || fail "publish: strip-exams on $BRANCH"

  attempt="$(fold_receipt pushed)"
  if [ -n "$attempt" ]; then
    lease="$(fold_field "$attempt" pushedHead)"
    log "fold: pushing $BRANCH over attempt $attempt's head $lease, under a lease"
    fleet_git -C "$TARGET_DIR" push "--force-with-lease=$BRANCH:$lease" origin "$BRANCH" \
      || fail "publish: push $BRANCH refused — the lease on $lease did not hold"
  else
    fleet_git -C "$TARGET_DIR" push origin "$BRANCH" || fail "publish: push $BRANCH"
  fi
  await_branch_visible
  # What was pushed, recorded where the next attempt's lease will read it.
  if [ -n "$BRANCH_HEAD" ]; then
    attempt="$(fold_receipt highest)"
    [ -n "$attempt" ] || attempt="${FOLD_ATTEMPTS:-1}"
    fold_receipt_set "$attempt" "$BRANCH_HEAD" pushedHead "$BRANCH_HEAD"
  fi
}

# --- publish -----------------------------------------------------------------

plan_title() {
  [ -f "$PLAN_FILE" ] || return 0
  # `head -n 1` closes the pipe on a plan with a second `# ` line, and an
  # EXTERNAL writer takes SIGPIPE for it — guarded exactly as `json_field` is.
  { sed -n 's/^# \(.*\)$/\1/p' "$PLAN_FILE" || true; } | head -n 1
}

# The issues this run's PR closes, one `Closes #<digits>` line each, in the
# order the plan names them.
#
# Exactly one line of the plan is read: the first line beginning `**Closes:**`
# that follows the `**Goal:**` line and precedes the first `### ` heading —
# the header block ultrawrite writes, and nothing else. Never a regex over the
# whole body: the Goal line cites decisions as well as tickets (run-18's Goal
# named #653 and #655 beside its two tickets), a prose line may cite an issue
# in passing, and a task body under a `### ` heading may name any number at
# all. A plan with no such line closes nothing.
plan_closes() {
  [ -f "$PLAN_FILE" ] || return 0
  awk '
    /^### / { exit }
    goal && /^\*\*Closes:\*\*/ { line = $0; exit }
    /^\*\*Goal:\*\*/ { goal = 1 }
    END {
      while (match(line, /#[0-9]+/)) {
        printf "Closes %s\n", substr(line, RSTART, RLENGTH)
        line = substr(line, RSTART + RLENGTH)
      }
    }
  ' "$PLAN_FILE"
}

# What the run finished WITHOUT: one `- [ ] ` checklist line per residual, or
# nothing at all. The PR body is the run's index, so the things a reader must
# still do belong in it — a deferral the sandbox could not execute against the
# target, a critic finding that did not block, a reviewer note a merged task
# carried anyway. Nothing that FAILED is here: a blocking finding held the gate
# and a failed task's notes are its blocking findings, so both are already the
# verdict's business, and a `deferred:runtime` ack is the engine's own re-run,
# not a person's errand.
#
# The two documents are the ones `collect_evidence` already copied into the
# evidence directory — the same `$dest` `render_card` reads the receipt from,
# never the run directory, so the card and the checklist quote one record.
#
# ONE READER, in `python3` with the paths in argv, as `fold_receipt` reads its
# receipt: `json_field` answers the first match only and cannot walk an array,
# and the acks live one level down at `.gateCheck.acks[]`. An absent,
# unparsable or oddly-shaped document answers empty rather than failing a
# `set -e` script — a run whose engine died before its report still renders a
# card.
#
# Every item is ONE line: a newline inside a detail becomes a space, or the
# checklist would grow lines no reader could tick.
#
# TWO RENDERINGS, ONE READER. The same items go out twice — as the card's
# `- [ ] <name> — <text>` checklist, which a merge closes with the PR, and as
# `residuals.jsonl` on the evidence branch, which nothing closes. A second
# parser of the same two documents would be a second answer to the same
# question, so the mode is an argument and the walk above it is shared.
residual_read() { # $1 = `checklist` | `rows`
  local dest
  dest="$EVIDENCE_DIR/$EVIDENCE_PATH"
  # The em dash is written `—` and the lines go out as UTF-8 bytes: this
  # runs under whatever locale the unit inherited, and a `C` one would other-
  # wise refuse to read the detail it is quoting.
  python3 -c '
import json, re, sys

DASH = " — "

MODE, RECEIPT, REPORT, RUN_ID, BASE_SHA = sys.argv[1:6]

# The evidence a residual points at, when its text names one: the first
# whitespace-delimited token carrying a `/` that reads as a repo-relative path
# with an extension, its trailing `:<digits>` — when it has one — the line. A
# text that names no such token points at nothing, which is `null` and not the
# empty string.
PATH_TOKEN = re.compile(r"^(?:[\w.-]+/)+[\w.-]+\.[A-Za-z0-9]+(?::(\d+))?$")

# A reviewer piece that says the reviewer could not check the thing is not a
# nit: it is an unverified claim, and the difference is what a reader triages
# on.
UNVERIFIED = ("cannot verify", "could not verify")

def load(path):
    try:
        with open(path, encoding="utf-8") as fh:
            doc = json.load(fh)
    except Exception:
        return {}
    return doc if isinstance(doc, dict) else {}

def listing(doc, key):
    got = doc.get(key)
    return got if isinstance(got, list) else []

def flat(value):
    text = value if isinstance(value, str) else ""
    return text.replace("\r\n", " ").replace("\n", " ").replace("\r", " ")

def evidence(text):
    """`(file, line)` for the first path token in `text`, else `(None, None)`."""
    for token in text.split():
        if "/" not in token:
            continue
        found = PATH_TOKEN.match(token)
        if not found:
            continue
        at = found.group(1)
        return (token[: -(len(at) + 1)], int(at)) if at else (token, None)
    return None, None

# One tuple per residual: the checklist name, the one-line text, the kind a
# triager sorts on, and the task it belongs to (`None` for the items no single
# task owns).
items = []

# Every ack whose type is exactly `deferred:external`, its detail whole: the
# structural-false-green sentence included, since that sentence is the reason
# the item needs a person rather than another run.
receipt = load(RECEIPT)
check = receipt.get("gateCheck")
for ack in listing(check if isinstance(check, dict) else {}, "acks"):
    if isinstance(ack, dict) and ack.get("type") == "deferred:external":
        items.append(("deferred:external", flat(ack.get("detail")), "deferred", None))

report = load(REPORT)
# Minor findings from the critic. A blocking one never reaches a green run.
for finding in listing(report, "completenessFindings"):
    if isinstance(finding, dict) and finding.get("severity") == "minor":
        items.append(("critic", flat(finding.get("detail")), "structural", None))

# Every `; `-separated piece of the notes of every merged task: minor findings
# from the reviewers, then the plan-defect and concern entries. A task that is
# not done was not merged, and its notes are its blocking findings.
for row in listing(report, "tasks"):
    if not isinstance(row, dict) or row.get("status") != "done":
        continue
    task = str(row.get("task"))
    for piece in flat(row.get("notes")).split("; "):
        if piece:
            low = piece.lower()
            kind = "unverified" if any(p in low for p in UNVERIFIED) else "nit"
            items.append(("task " + task + " reviewer", piece, kind, task))

if MODE == "rows":
    # Keys sorted, so a row is one shape however it was built, and one object
    # per line: the ledger is read by `while read`, not by a JSON parser.
    out = ""
    for name, text, kind, task in items:
        where, at = evidence(text)
        out += json.dumps({
            "file": where,
            "kind": kind,
            "line": at,
            "run": RUN_ID,
            "sha": BASE_SHA,
            "task": task,
            "text": text,
        }, sort_keys=True) + "\n"
else:
    out = "".join("- [ ] " + name + DASH + text + "\n" for name, text, _, _ in items)
sys.stdout.buffer.write(out.encode("utf-8"))
' "$1" "$dest/gate-receipt.json" "$dest/report.json" "$RUN_ID" "$BASE_SHA"
}

# The card's checklist, and the record's ledger.
residual_items() { residual_read checklist; }
residual_rows() { residual_read rows; }

# The receipt as the `### Checks` fence shows it: the document the engine wrote,
# byte for byte, except that a `gateCheck.acks` array is dropped.
#
# The acks are the checklist now. A card that also dumped them inside the fence
# would carry, beside a list a reader is meant to work, a second copy holding
# the ones that are NOT on it — a `deferred:runtime` ack is the engine's own
# re-run, and reading it beside seven boxes to tick is reading it as an eighth.
# Nothing is lost: `### Evidence` links the receipt whole, on the branch.
#
# A receipt this cannot parse, or one with no acks — the shape every run before
# this had — is printed byte for byte, so the fence of a card with no acks is
# the fence it always was.
receipt_fence() { # $1 = the receipt file
  python3 -c '
import json, sys

raw = open(sys.argv[1], "rb").read()

def verbatim():
    sys.stdout.buffer.write(raw)
    sys.exit(0)

try:
    doc = json.loads(raw.decode("utf-8"))
except Exception:
    verbatim()
if not isinstance(doc, dict):
    verbatim()
check = doc.get("gateCheck")
if not isinstance(check, dict) or not isinstance(check.get("acks"), list):
    verbatim()
doc["gateCheck"] = dict((k, v) for k, v in check.items() if k != "acks")
sys.stdout.buffer.write((json.dumps(doc) + "\n").encode("utf-8"))
' "$1" || cat "$1"
}

# The failing test's own block of a suite file, printed to stdout.
#
# A fixed-length tail is the wrong excerpt: a suite whose failing leg is early
# and whose diagnostics are long puts the one line a reader needs above the
# window, and the reader is shown a run is held without being told by what. So
# the block is found by its markers instead of by its length:
#
#   start — the first line matching /^(___+ .+ ___+$|FAILED |FAIL[: ]|not ok |AssertionError)/
#   end   — the line before the first LATER line matching
#           /^(___+ .+ ___+$|===+ |(not )?ok [0-9])/, or the file's last line
#   fallback — a file with no start line is printed whole
#
# The same rule, literal for literal, is `fleet/failing-block.mjs`'s: the two
# must agree line for line on the same file. POSIX awk only — the sandbox is
# Ubuntu's mawk and the boot sims run on BSD awk — so no `{n,m}` intervals, no
# `\d`, and no gawk-only functions. `node` is never called here: on the sandbox
# `node` is argv to `systemd-run` and nothing else.
failing_block() { # $1 = the suite file
  awk '
    { line[NR] = $0 }
    !start && /^(___+ .+ ___+$|FAILED |FAIL[: ]|not ok |AssertionError)/ { start = NR; next }
    start && !stop && /^(___+ .+ ___+$|===+ |(not )?ok [0-9])/ { stop = NR - 1 }
    END {
      if (!start) { start = 1; stop = NR }
      if (!stop) stop = NR
      for (i = start; i <= stop; i++) print line[i]
    }
  ' "$1"
}

# The fold's section of the PR body, or nothing at all. It is the reader's only
# account of what happened between the engine's commit and the head this PR
# carries, so it appears whenever that account is not "it just folded": on any
# disposition but a clean `folded` or `nothing to join`, on a `folded` that had
# to dispatch a resolver, on a run that needed a second attempt, and on a merge
# this script left open. A green run that folded with nothing to resolve says
# nothing, because there is nothing a reader would do with it.
fold_section() {
  local a d n highest suite render=""
  a="$(fold_receipt top)"
  d=""
  [ -n "$a" ] && d="$(fold_field "$a" disposition)"
  case "$d" in
    ""|folded|"nothing to join") : ;;
    *) render=1 ;;
  esac
  if [ "$d" = "folded" ]; then
    case "$(fold_field "$a" resolversDispatched)" in
      ""|0) : ;;
      *) render=1 ;;
    esac
  fi
  highest="$(fold_receipt highest)"
  [ -n "$highest" ] && [ "$highest" != "1" ] && render=1
  case "$MERGE_NOTE" in "left open:"*) render=1 ;; esac
  [ -n "$render" ] || return 0

  printf '## Publish fold\n\n'
  n=1
  while [ -n "$highest" ] && [ "$n" -le "$highest" ]; do
    if [ -n "$(fold_field "$n" disposition)$(fold_field "$n" candidate)$(fold_field "$n" tip)" ]; then
      printf -- '- attempt %s: %s\n' "$n" "$(fold_phrase "$n")"
    fi
    n=$(( n + 1 ))
  done
  case "$MERGE_NOTE" in "left open:"*) printf -- '- merge: %s\n' "$MERGE_NOTE" ;; esac
  printf '\n'
  # The suite the fold ran on the folded head is the whole of a `suite red`:
  # without the failing test's own block the section says a run is held and not
  # by what. The whole file stays on the evidence branch either way; this is
  # only what the reader is shown.
  suite="$(fold_dir)/suite-$a.txt"
  if [ "$d" = "suite red" ] && [ -f "$suite" ]; then
    printf '```\n'
    failing_block "$suite"
    printf '```\n\n'
  fi
  printf 'https://github.com/%s/tree/ultra/evidence/%s/%s/publish-fold/receipt.json\n\n' \
    "$TARGET_REPO" "$RUN_ID" "$EVIDENCE_PATH"
  return 0
}

# The section a run held on an unattributed red carries, and nothing else does.
#
# The gate greened the work the plan named and the suite still went red on a
# path no task owns, so the PR is READY and unmerged, and the person who reads
# it is being asked for exactly one judgment: is that red this run's doing? The
# section carries the three things that judgment needs and no fourth —
#
#   the failing test's own block, cut from the report's `tests.output`, so the
#   reader is told BY WHAT the run is held and not merely that it is;
#   the merge command, pinned to this head, for the reader who decides it is
#   not; and the one line naming the path to fix for the reader who decides it
#   is.
#
# `failing_block` takes a PATH and the output is a JSON string, so it goes to a
# temp file first. A report that is absent, unparsable or carries no output
# leaves the fence out and the other two lines in: the merge command and the
# path are what the reader acts on, and neither needs the excerpt to be legible.
held_section() {
  local first out tmp head number
  case "$MERGE_NOTE" in "left open: suite red"*) : ;; *) return 0 ;; esac
  first="$(gate_unattributed first)"
  printf '## Held\n\n'
  # Beside the boot's own log, never inside the evidence worktree: `### Evidence`
  # lists that directory, and a scratch file there would be a name in the card.
  tmp="$FLEET_HOME/.fleet-held-block.txt"
  out="$EVIDENCE_DIR/$EVIDENCE_PATH/report.json"
  if [ -f "$out" ] && python3 -c '
import json, sys
try:
    doc = json.load(open(sys.argv[1]))
except Exception:
    sys.exit(1)
tests = doc.get("tests") if isinstance(doc, dict) else None
text = tests.get("output") if isinstance(tests, dict) else None
if not isinstance(text, str) or not text.strip():
    sys.exit(1)
open(sys.argv[2], "w").write(text if text.endswith("\n") else text + "\n")
' "$out" "$tmp" 2>/dev/null; then
    printf '```\n'
    failing_block "$tmp"
    printf '```\n\n'
  fi
  rm -f "$tmp"
  number="$(pr_number)"
  head="$BRANCH_HEAD"
  [ -n "$head" ] || head="$(fleet_git -C "$TARGET_DIR" rev-parse "$BRANCH" 2>/dev/null || true)"
  printf '```\n'
  printf 'gh pr merge %s --squash --match-head-commit %s\n' "$number" "$head"
  printf '```\n\n'
  printf 'Fix: %s went red on the fold of %s\n\n' "$first" "$RUN_ID"
  return 0
}

# WHAT A PERSON READS FIRST, above the record and before any sha.
#
# The card used to open on `## fleet run-N — gate-green` and a table of hashes:
# a reviewer's index, and nothing a person could act on without opening it. So
# the four things a reader of a fleet PR actually came for go above it, in the
# order they are asked —
#
#   the summary the OPERATOR signed with the plan, verbatim, because what a
#   reader meets should be what a person wrote;
#   the answer: merged, ready, held, or parked, one line;
#   the Claim that plan was approved against; and
#   one row per task saying what was promised and how it was proved.
#
# Then `Residuals: <n> from review` — the count, and only the items a person
# must act on themselves. Everything else the run knows is folded into the
# `<details>` record below.
#
# ONE READER, in `python3` with the paths in argv, exactly as `residual_read`
# is written: the plan and the report are the two documents every part of this
# is read out of, `json` is the only parser, and a document that is absent,
# unparsable or oddly shaped answers `—` rather than taking down a `set -e`
# script. Nothing here is narrated: every cell comes off the plan, the report
# or the status page.
#
# The residual checklist arrives on stdin — `residual_read` is the one reader
# of the residuals and this is its second rendering, not a second parse.
card_head() { # $1 = outcome, $2 = the residual checklist; stdin is not read
  local dest merged
  dest="$EVIDENCE_DIR/$EVIDENCE_PATH"
  # The page is written from `MERGED_SHA`, and `do_boot` loads that cell back
  # off the page on a re-entry — so the variable is the page's value or fresher,
  # and a body patched after the merge says `**Merged**` on the first render.
  merged="$MERGED_SHA"
  [ -n "$merged" ] || merged="$(read_status_field merged)"
  printf '%s' "$2" | python3 -c '
import json, re, sys

PLAN, REPORT, OUTCOME, MERGED, ERROR, NOTE = sys.argv[1:7]

EM = "—"
DASH = " — "
NO_SUMMARY = "_No summary was signed with this plan._"
HELD = "left open: "

# The provenance tag a Claim closes with: the plan-level pair `compile_plan.py`
# spells in `PLAN_CLAIM_PROVENANCE_RE`, and the `(derived)` a task Claim takes
# when it descends from the plan-level one. Stripped, because the tag is how
# the sentence was signed and not part of what it says.
TAG = re.compile(r"\s*\((?:elicited|derived|quoted from #[0-9]+)\)\s*$", re.I)
TASK_HEAD = re.compile(r"^### Task ([^:]+):")


def plan_lines():
    try:
        with open(PLAN, encoding="utf-8", errors="replace") as fh:
            return fh.read().split("\n")
    except Exception:
        return []


def load(path):
    try:
        with open(path, encoding="utf-8") as fh:
            doc = json.load(fh)
    except Exception:
        return {}
    return doc if isinstance(doc, dict) else {}


def listing(doc, key):
    got = doc.get(key)
    return got if isinstance(got, list) else []


LINES = plan_lines()
# The header is everything above the first task heading, the same bound
# `plan_closes` reads its one `**Closes:**` line within.
HEADER = []
for line in LINES:
    if line.startswith("### "):
        break
    HEADER.append(line)


def header_value(label):
    """One bold header value, wrapped lines joined on a single space.

    The value runs to the next blank line, the next bold marker or the end of
    the header — `_plan_header_value` in `compile_plan.py`, which is what makes
    a summary that wraps in the plan ONE line on the card."""
    got = None
    for line in HEADER:
        text = line.strip()
        if got is None:
            if text.startswith(label):
                got = [text[len(label):].strip()]
            continue
        if not text or text.startswith("**"):
            break
        got.append(text)
    return re.sub(r"\s+", " ", " ".join(got)).strip() if got is not None else ""


def task_claims():
    """`(id, claim)` per `### Task <id>:` heading, in plan order.

    ONE line, never the wrap `header_value` allows: the `Machine:` restatement
    sits directly under a task Claim and is not part of the sentence."""
    out = []
    heading = None
    claim = ""
    for line in LINES:
        found = TASK_HEAD.match(line)
        if found:
            if heading is not None:
                out.append((heading, claim))
            heading, claim = found.group(1).strip(), ""
            continue
        if heading is None or claim:
            continue
        text = line.strip()
        if text.startswith("**Claim:**"):
            claim = TAG.sub("", text[len("**Claim:**"):].strip()).strip()
    if heading is not None:
        out.append((heading, claim))
    return out


report = load(REPORT)

rows = {}
for row in listing(report, "tasks"):
    if isinstance(row, dict) and row.get("task") is not None:
        rows.setdefault(str(row.get("task")), row)

# The wave of a task is the index of the list holding its id, 1-based — the
# same number a `waveMerges` row carries.
wave_of = {}
for n, wave in enumerate(listing(report, "waves"), 1):
    if isinstance(wave, list):
        for task in wave:
            wave_of.setdefault(str(task), n)

merges = {}
for row in listing(report, "waveMerges"):
    if isinstance(row, dict):
        merges.setdefault(row.get("wave"), row)

probes = {}
for run in listing(report, "integratedRuns"):
    if isinstance(run, dict):
        got = probes.setdefault(str(run.get("task")), [0, 0])
        got[1] += 1
        if run.get("exit") == 0:
            got[0] += 1


def exam_cell(row):
    exam = row.get("exam")
    if exam is None:
        return "none"
    if exam == "green-at-base":
        return "green at BASE"
    if exam == "blocked":
        return "blocked"
    if exam == "red":
        status = row.get("status")
        if status == "done":
            return "red at BASE → green"
        if status == "failed":
            return "red at BASE, task failed"
        return "red at BASE"
    return str(exam)


def probes_cell(task):
    got = probes.get(task)
    return "%d/%d" % (got[0], got[1]) if got else EM


def mutant_cell(row):
    exams = row.get("stateExams")
    if not isinstance(exams, list) or not exams:
        return EM
    killed = [e.get("mutant_killed") for e in exams if isinstance(e, dict)]
    if any(k is False for k in killed) or len(killed) != len(exams):
        return "SURVIVED"
    return "killed" if all(k is True for k in killed) else EM


def suite_cell(task):
    row = merges.get(wave_of.get(task))
    suite = row.get("suite") if isinstance(row, dict) else None
    if not isinstance(suite, dict):
        return EM
    if suite.get("passed") is True:
        return "green"
    if suite.get("passed") is False:
        loose = suite.get("unattributed")
        return "red, unattributed" if isinstance(loose, list) and loose else "red"
    return EM


# THE ANSWER LINE. Right at the time it is rendered, and no later: a run that
# merges after its only POST keeps the body that POST carried, and that body
# said `**Merge-ready**`, which is what it was.
if MERGED:
    answer = "**Merged** " + MERGED
elif OUTCOME != "gate-green":
    answer = ("**Parked:** " + ERROR).rstrip()
elif NOTE.startswith(HELD):
    answer = "**Held:** " + NOTE[len(HELD):]
else:
    answer = "**Merge-ready**"

out = [header_value("**Summary:**") or NO_SUMMARY, "", answer, "",
       ("> " + TAG.sub("", header_value("**Claim:**")).strip()).rstrip(), "",
       "| task | claim | exam | probes | mutant | suite |",
       "|---|---|---|---|---|---|"]
for task, claim in task_claims():
    row = rows.get(task)
    cells = [task, claim or EM]
    cells += [exam_cell(row), probes_cell(task), mutant_cell(row), suite_cell(task)] \
        if row is not None else [EM, EM, EM, EM]
    out.append("| " + " | ".join(cells) + " |")

# THE RESIDUALS, as a count and then as an errand list. Every checklist item is
# counted; only the ones nobody else will do are printed here — an external
# deferral the sandbox could not execute, and the notes of a task the plan
# itself had to answer for. A reviewer nit is in the record, not above it.
items = [line[len("- [ ] "):] for line in sys.stdin.read().split("\n")
         if line.startswith("- [ ] ")]
actors = set(task for task, row in rows.items() if row.get("actor") == "plan")
out += ["", "Residuals: %d from review" % len(items) if items else "Residuals: none"]
errands = []
for item in items:
    name = item.split(DASH, 1)[0]
    owner = re.match(r"^task (\S+) reviewer$", name)
    if name == "deferred:external" or (owner and owner.group(1) in actors):
        errands.append("- " + item)
if errands:
    out += [""] + errands
out.append("")
sys.stdout.buffer.write(("\n".join(out) + "\n").encode("utf-8"))
' "$PLAN_FILE" "$dest/report.json" "$1" "$merged" "$(read_status_field error)" "$MERGE_NOTE"
}

render_card() { # $1 = outcome; prints the body file's path
  local body dest verdict receipt residuals
  dest="$EVIDENCE_DIR/$EVIDENCE_PATH"
  mkdir -p "$dest"
  body="$dest/pr-body.md"
  verdict="$(gate_verdict)"
  receipt="$dest/gate-receipt.json"
  # Read before the block, so a reader that cannot answer takes down neither
  # the card nor a `set -e` script. A run with no residuals gets NO section at
  # all — no heading, no blank line — and its card is the card it always was.
  residuals="$(residual_items || true)"
  {
    # What a person reads, and then the record they can unfold. A blank line
    # after `<summary>` or GitHub renders the markdown inside it as one blob.
    card_head "$1" "$residuals"
    printf '<details><summary>Record</summary>\n\n'
    printf '## fleet %s — %s\n\n' "$RUN_ID" "$1"
    printf '| | |\n|---|---|\n'
    printf '| verdict | `%s` |\n' "${verdict:-<no gate receipt>}"
    printf '| target | `%s` at `%s` |\n' "$TARGET_REPO" "$BASE_SHA"
    printf '| engine | `%s` |\n' "$ENGINE_SHA"
    printf '| plan | `%s` at `%s` |\n' "$PLAN_BLOB_PATH" "$PLAN_SHA"
    printf '| branch | `%s` |\n' "$BRANCH"
    printf '| vm | `%s` |\n\n' "${VM_NAME:-<unknown>}"
    printf '### Checks\n\n'
    if [ -f "$receipt" ]; then
      printf '```json\n'
      receipt_fence "$receipt"
      printf '\n```\n\n'
    else
      printf 'No gate receipt was produced.\n\n'
    fi
    # What happened between the engine's commit and the head this PR carries,
    # when anything did — above the evidence listing, because a reader who is
    # about to be told the merge is held wants the reason first.
    fold_section
    # And, when the gate's own suite went red on a path no task owns, what the
    # reader is being asked to decide about it.
    held_section
    # Both records, on the target, spelled as a browser can follow them: the
    # receipts this run wrote, and the plan it was given. The tags, not the
    # branches — a branch moves on, a tag is where this run's reader lands.
    printf '### Evidence\n\n'
    printf 'https://github.com/%s/tree/ultra/evidence/%s/%s/\n\n' "$TARGET_REPO" "$RUN_ID" "$EVIDENCE_PATH"
    printf '%s\n\n' "$(ls "$dest" | sed 's/^/- /')"
    printf '### Plan\n\n'
    printf 'https://github.com/%s/blob/ultra/plan/%s/%s\n' "$TARGET_REPO" "$RUN_ID" "$PLAN_BLOB_PATH"
    # What the run left for a person, under the plan it was given and above the
    # issues it closes: a reader who is about to close #660 sees first what
    # closing it does not finish.
    if [ -n "$residuals" ]; then
      printf '\n### Residuals\n\n%s\n' "$residuals"
    fi
    # The record closes AFTER the checklist and BEFORE the issues: the `Closes`
    # lines are the body's last lines, and a `</details>` between `### Plan`'s
    # link and `### Residuals` would land inside a section a reader slices.
    printf '\n</details>\n\n'
    # Last of all, so the self-merge closes what the plan named.
    plan_closes
  } >"$body"
  printf '%s\n' "$body"
}

# The target's default branch, read from the clone: `origin/HEAD` is what the
# remote advertised at clone time, whichever host answered. A PR against a
# guessed `main` on a `master` repository would be refused by GitHub, or worse,
# accepted against the wrong branch — so an unreadable HEAD is a failure.
default_branch() {
  local ref
  ref="$(fleet_git -C "$TARGET_DIR" symbolic-ref refs/remotes/origin/HEAD 2>/dev/null || true)"
  case "$ref" in
    refs/remotes/origin/?*) printf '%s\n' "${ref#refs/remotes/origin/}" ;;
    *) return 1 ;;
  esac
}

# GitHub opens a PR the instant it is asked, but the `pull_request` workflow
# run is triggered off the branch as GitHub's own index sees it — and a PR
# opened within a second of its push (2026-09-03, #595) got no CI run at all
# and needed a close/reopen. So between the push and the POST, ask the branches
# endpoint for the pushed head and go on once the edge answers 200 with that
# sha. A timeout is logged and the POST is made anyway: a PR without CI is one
# the operator can re-trigger by hand; no PR is nothing to re-trigger.
await_branch_visible() {
  local head attempts n=0 t0 answer code sha
  BRANCH_HEAD="$(fleet_git -C "$TARGET_DIR" rev-parse "$BRANCH" 2>/dev/null || true)"
  head="$BRANCH_HEAD"
  attempts="$(poll_attempts "$PUBLISH_BRANCH_WAIT")"
  t0="$(date +%s)"
  while [ "$n" -lt "$attempts" ]; do
    # No `-f`: a 404 is an answer (not indexed yet), told from a 200 by the
    # status code riding as the last line. First match wins in `json_field`,
    # and the branch document's own `commit.sha` comes before the nested ones.
    answer="$(fleet_curl -sS "https://$GITHUB_INT_HOST/api/v3/repos/$TARGET_REPO/branches/$BRANCH" \
      -w '\n%{http_code}' 2>/dev/null || true)"
    code="$(printf '%s' "$answer" | tail -n 1)"
    sha="$(printf '%s' "$answer" | sed '$d' | json_field sha)"
    if [ "$code" = 200 ] && [ -n "$head" ] && [ "$sha" = "$head" ]; then
      log "publish: branch $BRANCH visible at the edge as $head after $(( $(date +%s) - t0 ))s"
      return 0
    fi
    n=$(( n + 1 ))
    sleep "$POLL_SECONDS"
  done
  log "publish: branch $BRANCH not yet visible at the edge as ${head:-<unknown>} after ${PUBLISH_BRANCH_WAIT}s — opening the PR anyway; its CI run may need a re-trigger"
  return 0
}

# --- the publish record ------------------------------------------------------
#
# The publish decisions used to survive only as prose: a `log` line that dies
# with the box and a phase sentence on the `done` page. They are events too,
# now, in the run's own `events.jsonl` — so a held run, a merged run and a
# merge that failed are three different records a reader can tell apart
# without parsing English.
#
# The shape is `makeEventLog`'s (`fleet/run-waves.mjs`), because this file is
# the ENGINE'S log and the boot only ever appends to it: the event's own fields
# first, then `id`, then `ts`. Nothing already in the file is read, rewritten or
# reordered.
#
# THE ID IS THE SORT KEY. `fleet_events.read_events` orders a log by `id` as a
# STRING and never by `ts`, so a line whose id is not the engine's ULID shape
# sorts wherever its bytes happen to fall. So this mints the same shape: ten
# characters of the millisecond clock in Crockford base 32, most significant
# first, four of a sequence, twelve random. The clamp is the engine's too — a
# `now` at or behind the last one keeps the timestamp and bumps the sequence —
# so the boot's own lines strictly ascend even under a clock that steps
# backwards, and the millisecond prefix puts every one of them after the
# engine's.
#
# `python3` writes the line. `json_escape` escapes for a string cell and is not
# an encoder, and neither `node` nor `gh` is a tool this script calls.
EVENT_LAST_TS=0
EVENT_SEQ=0
append_event() { # $1 = kind, then `<name>=<tag>:<value>` — s string, i int, b bool, n null
  local out
  out="$(EVENT_FILE="$(run_dir_path)/events.jsonl" \
    EVENT_LAST_TS="$EVENT_LAST_TS" EVENT_SEQ="$EVENT_SEQ" python3 -c '
import json, os, secrets, sys, time
B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
def b32(n, width):
    out = ""
    for _ in range(width):
        out = B32[n % 32] + out
        n //= 32
    return out
event = {"kind": sys.argv[1]}
for arg in sys.argv[2:]:
    name, _, rest = arg.partition("=")
    tag, _, value = rest.partition(":")
    if tag == "n":
        event[name] = None
    elif tag == "b":
        event[name] = value == "true"
    elif tag == "i":
        try:
            event[name] = int(value)
        except ValueError:
            event[name] = value
    else:
        event[name] = value
last = int(os.environ["EVENT_LAST_TS"] or 0)
seq = int(os.environ["EVENT_SEQ"] or 0)
ts = int(time.time() * 1000)
if ts <= last:
    ts, seq = last, seq + 1
else:
    seq = 0
event["id"] = b32(ts, 10) + b32(seq, 4) + "".join(secrets.choice(B32) for _ in range(12))
event["ts"] = ts
path = os.environ["EVENT_FILE"]
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "a", encoding="utf-8") as fh:
    fh.write(json.dumps(event, separators=(",", ":"), ensure_ascii=False) + "\n")
sys.stdout.write("%d %d\n" % (ts, seq))
' "$@")" || out=""
  # The record is a record, not a gate: a run whose event log could not be
  # written still publishes and still merges, and says here that it could not.
  case "$out" in
    [0-9]*' '[0-9]*)
      EVENT_LAST_TS="${out%% *}"
      EVENT_SEQ="${out##* }" ;;
    *)
      log "event: could not append $1 to $(run_dir_path)/events.jsonl" ;;
  esac
  return 0
}

# The PR is opened over GitHub's REST API through the edge, not with `gh`. `gh`
# decides for itself which token to present, and the aggregate host proxies
# only `/repos/<owner>/<repo>/…` — `/user`, which `gh` likes to ask first,
# answers 403 from the edge. One POST, one JSON answer, nothing to negotiate.
# The push that used to open this function is `push_head`, which `do_boot` calls
# before it: the fold moved the branch, so what is pushed and how (plain, or
# under a lease) is the fold's business, and what is left here is the POST.
publish() { # $1 = outcome (gate-green|parked)
  local body title heading base draft payload answer code reply
  body="$(render_card "$1")"
  heading="$(plan_title)"
  [ -n "$heading" ] || heading="$RUN_ID"
  title="fleet $RUN_ID: $heading"
  base="$(default_branch)" || fail "publish: cannot read the target's default branch from refs/remotes/origin/HEAD"
  # A parked run still gets its PR — as a DRAFT. What the gate withheld is the
  # claim that it is ready to merge; the operator's act is the merge button.
  if [ "$1" = "gate-green" ]; then draft=false; else draft=true; fi
  payload="{\"title\":\"$(json_escape "$title")\",\"head\":\"$(json_escape "$BRANCH")\",\"base\":\"$(json_escape "$base")\",\"body\":\"$(json_escape "$(cat "$body")")\",\"draft\":$draft}"
  # The status code rides as the last line of the answer, so a non-2xx is told
  # apart from a 201 without a second request or a headers file.
  answer="$(fleet_curl -sS -X POST "https://$GITHUB_INT_HOST/api/v3/repos/$TARGET_REPO/pulls" \
    -H 'content-type: application/json' -d "$payload" -w '\n%{http_code}')" \
    || fail "publish: POST /repos/$TARGET_REPO/pulls did not complete: $(printf '%s' "$answer" | tail -c 2000)"
  code="$(printf '%s' "$answer" | tail -n 1)"
  reply="$(printf '%s' "$answer" | sed '$d')"
  case "$code" in
    2[0-9][0-9]) : ;;
    *) fail "publish: POST /repos/$TARGET_REPO/pulls answered $code: $(printf '%s' "$reply" | tail -c 2000)" ;;
  esac
  # First match wins in `json_field`, and GitHub's PR document puts its own
  # `html_url` and the `user` object (the author) ahead of the head/base
  # repositories that carry the same field names.
  PR_URL="$(printf '%s' "$reply" | json_field html_url)"
  PR_AUTHOR="$(printf '%s' "$reply" | json_field login)"
  [ -n "$PR_URL" ] || fail "publish: POST /repos/$TARGET_REPO/pulls answered $code with no html_url: $(printf '%s' "$reply" | tail -c 2000)"
  log "publish: $PR_URL (base $base, draft $draft)"
  log "publish: author ${PR_AUTHOR:-<unknown>}"
  # The PR's own record, appended after the answer that made it real: the URL
  # and the number GitHub gave back, and the `draft` this POST asked for — so a
  # reader of the log can tell a parked run's draft from a ready PR without the
  # page. A run that opens no PR reaches none of this and records none of it.
  append_event publish:pr "url=s:$PR_URL" "number=i:$(pr_number)" "draft=b:$draft"
}

# A disposition that lands AFTER the PR was opened — every fold-again's, and
# the note a PR whose last PUT was still refused earns — reaches the reader only
# if the body is rewritten, so it is: ONE PATCH with the re-rendered card,
# carrying every attempt, sent after the last merge of the run, never before.
patch_pr_body() { # $1 = outcome
  local number body answer code
  [ -n "$PR_URL" ] || return 0
  number="$(pr_number)"
  [ -n "$number" ] || { log "publish: no PR number in $PR_URL — the body stands"; return 0; }
  body="$(render_card "$1")"
  answer="$(fleet_curl -sS -X PATCH "https://$GITHUB_INT_HOST/api/v3/repos/$TARGET_REPO/pulls/$number" \
    -H 'content-type: application/json' \
    -d "{\"body\":\"$(json_escape "$(cat "$body")")\"}" -w '\n%{http_code}' 2>/dev/null || true)"
  code="$(printf '%s' "$answer" | tail -n 1)"
  log "publish: PATCH /repos/$TARGET_REPO/pulls/$number answered ${code:-<no answer>}"
  return 0
}

# --- merge -------------------------------------------------------------------
#
# A ready PR is the sandbox's own to finish, and the run's OWN GATE is what
# finishes it. The gate ran the target's suite on the tree the fold produced,
# and that is the same suite the target's CI would run on the same tree — so
# asking GitHub to run it again and waiting half an hour for the answer bought
# a second opinion of a measurement this run already holds. The sandbox asks
# for none: it merges once its own gate is green and the default branch's tip
# is still the one it folded onto.
#
# TWO CONDITIONS, and both are read on this box. The gate's verdict is
# `do_boot`'s `gate-green`, which is what calls this function at all. The join
# is the tip: the fold recorded the tip it rebased onto, and a merge is only
# ever the claim that THAT tip is still the base's. When it is not, nothing is
# PUT — the answer to a base that moved is another fold, not another ask.
#
# `hold=1` in the assignment is how a launch keeps the merge button for a
# human, and a gate receipt carrying an unattributed red is how the run itself
# does: the PR is ready, the card says what went red, and the merge waits.
#
# Same edge, same `fleet_curl`, no `gh` — for the reasons `publish` gives.

# The PR number is the tail of the URL GitHub answered the POST with (`…/pull/<n>`).
pr_number() { printf '%s' "${PR_URL##*/}"; }

# The live tip of the target's default branch, fetched before it is read: the
# clone's `refs/remotes/origin/<default>` is as old as the last fetch, and the
# last fetch was the fold's. Empty when the default branch cannot be read or
# the fetch and the rev-parse leave nothing — a comparison that cannot be made
# is not a refusal, and the PUT goes out as it always did.
live_tip() {
  local base
  base="$(default_branch)" || return 0
  fleet_git -C "$TARGET_DIR" fetch origin "$base" >/dev/null 2>&1 || true
  fleet_git -C "$TARGET_DIR" rev-parse "refs/remotes/origin/$base" 2>/dev/null || true
}

# The tip the last fold rebased onto, as the folder recorded it per attempt.
folded_tip() { fold_field "$(fold_receipt top)" tip; }

# Whether GitHub has an opinion about this PR's mergeability yet. `mergeable`
# is null while the index recomputes it after a push, and a merge PUT made in
# that window is the 405 this poll exists to avoid. A timeout PUTs anyway: a
# refusal is an answer this script records, and never asking is not.
await_mergeable() { # $1 = PR number
  local attempts n=0 answer code doc
  attempts="$(poll_attempts "$MERGE_CHECK_WAIT")"
  while [ "$n" -lt "$attempts" ]; do
    answer="$(fleet_curl -sS "https://$GITHUB_INT_HOST/api/v3/repos/$TARGET_REPO/pulls/$1" \
      -w '\n%{http_code}' 2>/dev/null || true)"
    code="$(printf '%s' "$answer" | tail -n 1)"
    doc="$(printf '%s' "$answer" | sed '$d')"
    case "$code" in
      2[0-9][0-9])
        if [ "$(printf '%s' "$doc" | mergeable_field)" = answered ]; then
          log "merge: GitHub has recomputed the mergeability of $PR_URL"
          return 0
        fi ;;
    esac
    n=$(( n + 1 ))
    sleep "$POLL_SECONDS"
  done
  log "merge: GitHub still has no mergeability for $PR_URL after ${MERGE_CHECK_WAIT}s — asking anyway"
  return 0
}

mergeable_field() { # the PR document on stdin -> `answered` | `null`
  python3 -c '
import json, sys
try:
    doc = json.load(sys.stdin)
except Exception:
    doc = {}
value = doc.get("mergeable") if isinstance(doc, dict) else None
print("null" if value is None else "answered")
'
}

merge_pr() {
  local head number answer code body lower payload heading message
  local unattributed tip folded
  MERGE_NOTE=""
  # Raised again only by this call's own refusal: `do_boot` loops while it is
  # set, so a stale 1 would fold the run forever.
  FOLD_AGAIN=""
  # Nothing to merge without a PR, and a re-entry that already recorded a merge
  # sha has one behind it — the same record that makes `publish` idempotent.
  [ -n "$PR_URL" ] || return 0
  if [ -n "$MERGED_SHA" ]; then
    log "merge: $PR_URL is already recorded as merged $MERGED_SHA"
    MERGE_NOTE="merged $MERGED_SHA"
    return 0
  fi
  if [ "$HOLD" = "1" ]; then
    log "merge: hold=1 — leaving $PR_URL open"
    MERGE_NOTE="left open: hold=1"
    # A hold's `why` is the phase's own text after `left open: `, so a reader of
    # either record matches the other word for word.
    append_event publish:hold "why=s:hold=1"
    return 0
  fi
  # THE RUN'S OWN HOLD. The gate greened the work the plan named and the suite
  # still went red on a path no task owns: the verdict is PASS, so the PR is
  # READY — what is withheld is not the claim that the work is done but the
  # claim that this box may finish it. A person decides whether that red is
  # this run's doing, and `render_card`'s `## Held` section is what they decide
  # from. No tip is read and no PUT is issued.
  #
  # `hold=1` is tested first, so an operator's hold keeps its own note whatever
  # the gate left; this one is tested before the fold's, because a red the gate
  # could charge to nobody is the older fact and the one with a path to name.
  unattributed="$(gate_unattributed first)"
  if [ -n "$unattributed" ]; then
    log "merge: the gate's suite went red on $unattributed with no task to charge it to — leaving $PR_URL open"
    MERGE_NOTE="left open: suite red, unattributed: $unattributed"
    # A merge that did not happen is a `publish:merge` with a null `sha`:
    # `left` names the class of the refusal and `detail` the account of it, so
    # a reader counts the classes without parsing the account. Here the account
    # is every unattributed path, not only the one the note carries.
    append_event publish:merge sha=n: "left=s:held" \
      "detail=s:$(gate_unattributed joined)"
    return 0
  fi
  # A fold that did not end clean is a hold, and exactly the same hold as
  # `hold=1`: no tip is read (it is the base of a head this run will not merge)
  # and no PUT is issued.
  if [ -n "$FOLD_HOLD" ]; then
    log "merge: $FOLD_HOLD"
    MERGE_NOTE="$FOLD_HOLD"
    append_event publish:hold "why=s:${FOLD_HOLD#left open: }"
    return 0
  fi
  # The head `await_branch_visible` already read — the sha the PR was opened on,
  # and the sha the PUT is pinned to. A re-entry that published earlier has no
  # such read behind it and makes its own.
  head="$BRANCH_HEAD"
  [ -n "$head" ] || head="$(fleet_git -C "$TARGET_DIR" rev-parse "$BRANCH" 2>/dev/null || true)"
  number="$(pr_number)"
  # The served page while the merge runs. No evidence commit goes with it: the
  # transitions this run publishes are still `running`, `publishing`, `done`.
  write_status publishing "$PR_URL — merging"

  # THE JOIN IS THE WHOLE CHECK. The fold rebased this head onto a tip and
  # recorded which one; the gate then greened the suite on the result. That
  # measurement is worth exactly as much as the tip it was made on is still the
  # base's, so the tip is read again here, live, and compared. Equal: the run
  # merges on its own evidence. Different: the base moved between the fold and
  # now, this run has measured nothing about the tree the merge would make, and
  # the answer is another fold rather than another ask — no PUT is issued.
  #
  # A comparison that cannot be made is not a refusal: a receipt with no `tip`
  # (a folder that died before it recorded one, an unparsable receipt) or a
  # default branch this box cannot read leaves both sides empty and the PUT
  # goes out as it always did.
  tip="$(live_tip)"
  folded="$(folded_tip)"
  if [ -n "$tip" ] && [ -n "$folded" ] && [ "$tip" != "$folded" ]; then
    log "merge: the base moved under $PR_URL — tip $folded → $tip"
    MERGE_NOTE="left open: base moved"
    # One `publish:merge` per decision, `sha` null because no PUT was made:
    # `left` names the class of the refusal and `detail` the account of it, so
    # a reader counts the classes without parsing the account.
    append_event publish:merge sha=n: "left=s:base moved" "detail=s:tip $folded → $tip"
    # HOW MANY TIMES IS A CLOCK, NOT A COUNT — the rule the 405 arm below
    # states, and the same clock, because this is the same refusal reached one
    # request earlier. Two things end the folding: `FOLD_AGAIN_WAIT` seconds
    # since the first base-moved refusal of the run, and a re-fold that came
    # back on the tip it already offered, which is a folder that cannot reach
    # the base and will not reach it on a third try either.
    if [ "$folded" = "$TIP_FOLDED" ]; then
      log "merge: the fold came back on $folded again — leaving $PR_URL open"
    elif [ -n "$FOLD_AGAIN_SINCE" ] &&
         [ "$(( $(date +%s) - FOLD_AGAIN_SINCE ))" -ge "$FOLD_AGAIN_WAIT" ]; then
      log "merge: the base kept moving for ${FOLD_AGAIN_WAIT}s — leaving $PR_URL open"
    else
      [ -n "$FOLD_AGAIN_SINCE" ] || FOLD_AGAIN_SINCE="$(date +%s)"
      TIP_FOLDED="$folded"
      FOLD_AGAIN=1
      log "merge: folding again onto $tip"
    fi
    return 0
  fi
  log "merge: the gate is green and $folded is still the base's tip — merging $PR_URL"

  # EVERY CALL AFTER A FOLD-AGAIN waits for GitHub before it asks again. A 405
  # whose body says the PR is not mergeable — or that the base branch was
  # modified, or that a required status check is expected — is an index that
  # has not caught up with the head just pushed: `mergeable` reads null while
  # GitHub recomputes it, and a PUT made in that window is refused for a reason
  # that is gone a moment later. The first call makes no such read — nothing
  # has moved under it, and nothing has folded again since.
  if [ -n "$FOLD_AGAIN_SINCE" ]; then await_mergeable "$number"; fi

  # The plan's H1 as the commit title, because the fold commits under it are
  # titled from the same line; `sha` pins the merge to the head the gate greened,
  # so a push that landed since is refused rather than merged unmeasured. The
  # BODY carries the two coordinates that make a squashed
  # commit on the base traceable back to the run and the plan that produced it —
  # the branches are transient, the tags outlive them, and `git log` on the base
  # is where a reader starts.
  heading="$(plan_title)"
  [ -n "$heading" ] || heading="$RUN_ID"
  message="Fleet-Run: $RUN_N
Plan-Tag: ultra/plan/$RUN_ID"
  payload="{\"merge_method\":\"squash\",\"commit_title\":\"$(json_escape "$heading")\",\"commit_message\":\"$(json_escape "$message")\",\"sha\":\"$(json_escape "$head")\"}"
  answer="$(fleet_curl -sS -X PUT "https://$GITHUB_INT_HOST/api/v3/repos/$TARGET_REPO/pulls/$number/merge" \
    -H 'content-type: application/json' -d "$payload" -w '\n%{http_code}' 2>/dev/null || true)"
  code="$(printf '%s' "$answer" | tail -n 1)"
  body="$(printf '%s' "$answer" | sed '$d')"
  case "$code" in
    2[0-9][0-9]) : ;;
    *)
      # ONE PUT PER FOLD. GitHub refuses a merge for reasons that do not change
      # on a retry — a protected base, a conflict, a review it wants — and each
      # blind retry is another chance to merge something a human meant to look
      # at. The exceptions are the refusals that say so in the answer: a 405
      # whose message reads `not mergeable`, `base branch was modified` or
      # `required status check` is the base having moved under the PUT — the
      # first is GitHub's own word for it, and the other two are what a base
      # under strict-mode protection says when the tip it required has moved
      # on. The answer to any of the three is not another PUT but another FOLD.
      # `do_boot` runs it; this function only raises the signal, because every
      # path here returns 0 under `set -e` and a return code could not carry it.
      #
      # HOW MANY TIMES IS A CLOCK, NOT A COUNT. A base that moved twice is a
      # base that may move a third time, and a run that still folds cleanly and
      # still greens its suite on the joined tree has lost nothing by trying
      # again. What it can lose is the day, so the first base-moved 405 always
      # earns its fold and every later one earns another only while fewer than
      # `FOLD_AGAIN_WAIT` seconds have passed since that first one.
      if [ "$code" = 405 ]; then
        # GitHub capitalises these messages as sentences and `case` in POSIX sh
        # is case-sensitive, so the body is lowercased once and the three arms
        # are one `case` over lowercase patterns.
        lower="$(printf '%s' "$body" | tr '[:upper:]' '[:lower:]')"
        case "$lower" in
          *"not mergeable"*|*"base branch was modified"*|*"required status check"*)
            if [ -z "$FOLD_AGAIN_SINCE" ]; then
              FOLD_AGAIN_SINCE="$(date +%s)"
            elif [ "$(( $(date +%s) - FOLD_AGAIN_SINCE ))" -ge "$FOLD_AGAIN_WAIT" ]; then
              log "merge: PUT answered 405 after ${FOLD_AGAIN_WAIT}s of folding again — leaving $PR_URL open"
              MERGE_NOTE="left open: merge PUT answered 405 after ${FOLD_AGAIN_WAIT}s of folding again"
              append_event publish:merge sha=n: "left=s:refused" \
                "detail=s:merge PUT answered 405 after ${FOLD_AGAIN_WAIT}s of folding again"
              return 0
            fi
            log "merge: PUT answered 405 — GitHub does not call $PR_URL mergeable; folding again"
            FOLD_AGAIN=1
            MERGE_NOTE="left open: merge PUT answered 405"
            # Every refusal is a record of its own: one `publish:merge` line per
            # PUT, in order, is what a merge that folded again looks like, and
            # the LAST of them is what became of the PR.
            append_event publish:merge sha=n: "left=s:refused" \
              "detail=s:merge PUT answered 405"
            return 0 ;;
        esac
      fi
      log "merge: PUT answered $code — leaving $PR_URL open"
      MERGE_NOTE="left open: merge PUT answered $code"
      append_event publish:merge sha=n: "left=s:refused" \
        "detail=s:merge PUT answered $code"
      return 0 ;;
  esac
  MERGED_SHA="$(printf '%s' "$body" | json_field sha)"
  log "merge: merged $PR_URL as ${MERGED_SHA:-<no sha>}"
  MERGE_NOTE="merged ${MERGED_SHA:-<no sha>}"
  # The merge that happened: a `sha` and nothing else — no `left`, no `detail`,
  # so the one record that needs no reading to classify carries no excuse.
  append_event publish:merge "sha=s:${MERGED_SHA:-<no sha>}"
}

# --- the record ---------------------------------------------------------------
#
# THE RUN'S DURABLE RECORD IS TWO TAGS, and the two branches under them are
# transient (#624, decided 2026-09-05). `ultra/plan/run-<N>` marks the plan
# commit the assignment signed, `ultra/evidence/run-<N>` marks the evidence
# worktree's HEAD — which is the commit carrying the run's `done`/`parked`
# page, so this runs AFTER the last `push_evidence` and never before it. The
# launcher reads the tags for N and the harvester reads by tag; nothing needs
# the branches once the tags are on the remote, so both are deleted here in one
# push. `ultra/integration-run-<N>` is not this function's business: it goes
# with the merge (delete-on-merge), and a held or draft PR keeps its head.
#
# A LIGHTWEIGHT TAG NEEDS NO LOCAL TAG OBJECT: `<sha>:refs/tags/<name>` creates
# it on the remote, and the evidence worktree shares the clone's object store,
# so `HEAD:refs/tags/…` from there works the same way. The proof that a tag
# EXISTS is the remote's own listing and nothing else — `cat-file -e` and
# `fetch <sha>` are both satisfied locally without the server ever being asked.
#
# A tag that does not verify is not a failed run. The record still exists on
# the branches, which is exactly why they are only deleted after the listing
# agrees; the sweep will retry it. So every unhappy path logs one `record:` line
# saying what was kept and returns 0, leaving the run's state and exit code
# alone.
record_tags() {
  local plan_tag evidence_tag head listing listed_plan listed_evidence
  plan_tag="refs/tags/ultra/plan/$RUN_ID"
  evidence_tag="refs/tags/ultra/evidence/$RUN_ID"
  head="$(fleet_git -C "$EVIDENCE_DIR" rev-parse HEAD 2>/dev/null || true)"
  if [ -z "$head" ]; then
    log "record: the evidence worktree has no HEAD to tag — both branches kept for the sweep"
    return 0
  fi
  if ! fleet_git -C "$TARGET_DIR" push origin "$PLAN_SHA:$plan_tag"; then
    log "record: pushing $plan_tag at $PLAN_SHA was rejected — both branches kept for the sweep"
    return 0
  fi
  if ! fleet_git -C "$EVIDENCE_DIR" push origin "HEAD:$evidence_tag"; then
    log "record: pushing $evidence_tag at $head was rejected — both branches kept for the sweep"
    return 0
  fi
  # One listing, naming both tags, from the clone that owns `origin`.
  listing="$(fleet_git -C "$TARGET_DIR" ls-remote --tags origin "$plan_tag" "$evidence_tag" 2>/dev/null || true)"
  # No `exit` in either `awk`: the writer is a BUILTIN, which dies with its
  # subshell on SIGPIPE, so the reader must consume the whole listing —
  # `ls-remote` lists a ref once, so the output is the same either way.
  listed_plan="$(printf '%s\n' "$listing" | awk -v ref="$plan_tag" '$2 == ref { print $1 }')"
  listed_evidence="$(printf '%s\n' "$listing" | awk -v ref="$evidence_tag" '$2 == ref { print $1 }')"
  # BOTH tags, each at its OWN sha. A listing missing one of them, or showing
  # one at a commit this run did not put there, is not the record it claims.
  if [ "$listed_plan" != "$PLAN_SHA" ] || [ "$listed_evidence" != "$head" ]; then
    log "record: origin lists $plan_tag at '${listed_plan:-<nothing>}' and $evidence_tag at '${listed_evidence:-<nothing>}', not $PLAN_SHA and $head — $PLAN_BRANCH and $EVIDENCE_BRANCH kept for the sweep"
    return 0
  fi
  if ! fleet_git -C "$TARGET_DIR" push origin --delete \
      "refs/heads/$PLAN_BRANCH" "refs/heads/$EVIDENCE_BRANCH"; then
    log "record: the tags are on origin but deleting $PLAN_BRANCH and $EVIDENCE_BRANCH was rejected — both kept for the sweep"
    return 0
  fi
  log "record: $plan_tag at $PLAN_SHA and $evidence_tag at $head — $PLAN_BRANCH and $EVIDENCE_BRANCH deleted"
}

# --- the two entry points ----------------------------------------------------

do_boot() {
  # Both carried forward from the page a previous attempt left: `startedAt` is
  # the run's clock, and `pr` is the record that makes publishing idempotent —
  # re-reading them here is what stops the first `write_status` of a re-entry
  # from erasing them.
  STARTED_AT="$(read_status_field startedAt)"
  PR_URL="$(read_status_field pr)"
  PR_AUTHOR="$(read_status_field prAuthor)"
  MERGED_SHA="$(read_status_field merged)"
  VM_NAME="$(read_status_field vm)"
  start_status_server
  # RE-ENTRY, GUARD 1. A page that already reached a terminal state with the
  # engine's marker present is finished, whatever it finished as: the engine is
  # not re-runnable (it has spent its money and left its branch), and a `done`
  # run has a PR a second pass would duplicate. Exit 0 and leave it for the
  # janitor.
  local prior
  prior="$(read_status_field state)"
  case "$prior" in
    done|parked|failed)
      if [ "$prior" = "done" ] || [ -f "$ENGINE_DONE_MARKER" ]; then
        log "boot: this run is already $prior — leaving it for the janitor"
        exit 0
      fi ;;
  esac
  write_status booting "reading the assignment"
  read_identity

  local comment
  comment="$(read_assignment)"
  case "$comment" in
    run=*) : ;;
    *) fail "assignment: no run= comment (FLEET_ASSIGNMENT unset and Reflection /comment empty)" ;;
  esac
  parse_assignment "$comment"
  write_status booting "assignment read"
  # Before any clone: a VM carrying two github integrations for one repo has
  # no defined credential for the push, and nothing later can repair that.
  preflight_integrations

  # The target is the only clone. The plan comes off its own plan branch and is
  # checked against `plan=` before anything reads it; the evidence worktree is
  # built next, and deliberately — from here on, `fail` can record what happened
  # on the evidence branch instead of only on a status page that dies with the
  # VM.
  clone_target
  prepare_plan
  prepare_evidence
  # AFTER the evidence worktree and BEFORE the engine's deps: the park this can
  # make needs a branch to write its reason onto, and nothing beyond it is worth
  # installing for a run that cannot be held.
  kata_ping
  check_engine

  if engine_already_ran; then
    log "engine: already finished (marker or gate receipt present) — not re-running"
  else
    # The `running` page is a commit of its own, made and pushed BEFORE the
    # engine unit exists: a run whose box dies mid-model still has a branch
    # saying it started, and when it started.
    write_status running "engine starting"
    collect_evidence
    push_evidence "$RUN_ID: running"
    run_engine
  fi

  local code outcome verdict approval approved_how ahead
  code="$(engine_exit_code)"
  collect_evidence

  if [ "$code" = "1" ] && [ -n "$(gate_receipt_path)" ]; then
    # run-main exits 1 on `gate-blocked` — the receipt is its terminal artifact
    # and the verdict below reads it. A verdict is a parked run, not a failed one.
    log "engine: exited $code with a gate receipt — a verdict, not a crash"
    code=0
  fi

  if [ "$code" != "0" ]; then
    # The page goes to `failed` BEFORE the push, because the copy of it that
    # lands in the evidence branch's `.ultrapowers/runs/<N>/status.json` is what the janitor and the
    # operator read — a pushed page still saying `running` would be a lie with
    # a reader.
    # The engine's own last words, in the cell a reader actually opens. Without
    # them "engine exited 1" is the whole account of the run.
    ERROR="engine exited $code
$(engine_tail)"
    write_status failed "engine exit $code"
    kata_close_run wontfix "$(plan_title) — $(error_head)"
    collect_evidence
    push_evidence "$RUN_ID: failed (engine exit $code)"
    notify "run-$RUN_N failed" "$TARGET_REPO — engine exited $code"
    exit 1
  fi

  # PASS greens the run on its own. A verdict short of PASS still greens it when
  # the engine's gate approved the run anyway — the two-move rule — and the
  # approve receipt beside the gate receipt is that approval. Throwing it away
  # here would publish a draft the gate had already signed off.
  # `approved_how` is the same account in the cell an operator opens: the log
  # line dies with the box, the status page rides the evidence branch.
  verdict="$(gate_verdict)"
  approval=""
  approved_how=""
  if [ "$verdict" = "PASS" ]; then
    outcome="gate-green"
    approved_how="verdict=PASS"
  elif [ -n "$(approve_receipt_path)" ]; then
    outcome="gate-green"
    approved_how="approved by the two-move rule"
    approval=", $approved_how"
  else
    outcome="parked"
    # HERE, and not after the publish: the card's answer line reads the page's
    # `error`, and a parked run whose PR is the only place a person looks needs
    # that sentence on the page BEFORE the body quoting it is rendered. The
    # value is the one the terminal `parked` write carries either way.
    ERROR="parked: gate verdict ${verdict:-none}"
  fi
  log "outcome: $outcome (verdict=${verdict:-none}$approval)"
  await_engine_inactive "fleet-engine-$RUN_N" \
    || fail "engine: fleet-engine-$RUN_N.service still active after ${ENGINE_STOP_TIMEOUT}s"

  # run-69: a parked run whose every task was blocked has a branch equal to
  # BASE, and GitHub refuses a PR with no commits. Nothing to publish is a
  # parked outcome with its evidence committed — no push, no PR. A branch git
  # cannot count is likewise nothing to push.
  # `^base branch` rather than `base..branch`: the branch stays its own argv
  # word, so a reader of the git log can see which ref was counted.
  ahead="$(fleet_git -C "$TARGET_DIR" rev-list --count "^$BASE_SHA" "$BRANCH" 2>/dev/null || echo 0)"
  if [ "$ahead" = "0" ]; then
    ERROR="parked: $BRANCH has no commits ahead of base (verdict ${verdict:-none})"
    write_status parked "nothing to publish"
    kata_close_run wontfix "$(plan_title) — $(error_head)"
    collect_evidence
    push_evidence "$RUN_ID: parked — nothing ahead of base"
    # A parked run's record is worth as much as a green one's: the evidence
    # branch just took its last commit, so the tags go on it here too.
    record_tags
    notify "run-$RUN_N parked" "$TARGET_REPO — nothing ahead of base"
    exit 0
  fi

  # THE PUBLISH FOLD, attempt 1. Every outcome with commits ahead of base folds
  # — a parked run's draft is read by a human who wants it rebased on the base
  # as it is now no less than a green one's. The page says so first: the phase
  # is a change inside the `running` state the engine's own commit already made,
  # which is why no evidence commit goes with it. A re-entry that skipped the
  # engine is not in that state and does not claim to be.
  if [ "$STATE" = "running" ]; then write_status running "publish fold"; fi
  publish_fold 1

  # The receipts are committed BEFORE the push, so a publish that dies leaves
  # its verdict on the evidence branch and not only on this box.
  write_status publishing "$outcome — pushing $BRANCH"
  collect_evidence
  push_evidence "$RUN_ID: $outcome receipts"

  # The head the fold left, pushed as the fold's own receipt says to push it.
  push_head

  # RE-ENTRY, GUARD 2. The PR is the one step here that is not idempotent by
  # construction, so it is made idempotent by its own record: a status page that
  # already names a PR (read at the top of this function) is the proof that this
  # run published.
  if [ -n "$PR_URL" ]; then
    log "publish: $PR_URL already recorded — not opening a second PR"
  else
    publish "$outcome"
  fi

  # A ready PR is finished here: the run's own gate decided it, and a parked
  # run's draft is left for the operator either way.
  MERGE_NOTE=""
  if [ "$outcome" = "gate-green" ]; then
    merge_pr
  fi

  # FOLDING AGAIN, for as long as the clock and the folds allow. The base moved
  # under the head this run pushed — read off the tip before the PUT, or told by
  # a 405 after it — so the answer is another fold onto the base as it is now, a
  # leased push of what it produces and one more PUT. The base can move again
  # while that runs, and the answer to that is the same answer — so this is a
  # loop, and the only thing in this script that is one. `merge_pr` bounds it:
  # it raises `FOLD_AGAIN` only inside `FOLD_AGAIN_WAIT` of the run's first
  # base-moved refusal and only while the folder is still reaching a new tip,
  # and an unclean fold takes the loop out through `FOLD_HOLD` without a PUT at
  # all. An attempt that moved nothing has no new head to offer and no PUT to
  # make.
  local fold_tail="" attempt=1
  while [ "$FOLD_AGAIN" = "1" ]; do
    attempt=$(( attempt + 1 ))
    write_status running "publish fold (attempt $attempt)"
    collect_evidence
    push_evidence "$RUN_ID: publish fold (attempt $attempt)"
    publish_fold "$attempt"
    if [ "$(fold_field "$attempt" disposition)" = "tip unmoved" ]; then
      log "fold: attempt $attempt moved the tip nowhere — there is nothing new to merge"
      MERGE_NOTE="left open: merge PUT answered 405 and the fold moved nothing"
      # The one refusal `merge_pr` never gets to record, because this branch
      # makes it without re-entering: the note is the same and so is the event,
      # so the last `publish:merge` line is what became of the PR here too.
      append_event publish:merge sha=n: "left=s:refused" \
        "detail=s:merge PUT answered 405 and the fold moved nothing"
      write_status publishing "$PR_URL — the fold moved nothing"
      collect_evidence
      push_evidence "$RUN_ID: publish fold (attempt $attempt) — tip unmoved"
      break
    fi
    push_head
    write_status publishing "$PR_URL — merging the folded head"
    collect_evidence
    push_evidence "$RUN_ID: publish fold (attempt $attempt) receipts"
    merge_pr
  done
  # A DISPOSITION THE FIRST CARD COULD NOT CARRY is rewritten into the body —
  # ONE PATCH, after the last merge of the run and never before. Two of them
  # land after the POST: what the folds after the first decided, and the `##
  # Held` section of a run held on an unattributed red, which quotes the PR's
  # own number and head and so cannot exist until the PR does.
  local repatch=""
  [ "$attempt" -gt 1 ] && repatch=1
  case "$MERGE_NOTE" in "left open: suite red"*) repatch=1 ;; esac
  [ -n "$repatch" ] && patch_pr_body "$outcome"
  if [ "$attempt" -gt 1 ]; then
    if [ -n "$(fold_receipt top)" ]; then
      fold_tail=" — publish fold: $(fold_phrase "$(fold_receipt top)")"
    fi
  fi

  if [ "$outcome" = "gate-green" ]; then
    # The PR first, then WHAT greened it — a reader of the branch can tell a
    # PASS from a NEEDS_ACK the two-move rule signed off without opening the
    # gate receipt — and last what became of it at the merge button.
    write_status done "$PR_URL — $approved_how$fold_tail${MERGE_NOTE:+ — $MERGE_NOTE}"
    # The run issue on the hub, closed the way the page just was: `done`, with
    # the merge sha when the sandbox merged and the PR left open when it did not.
    if [ -n "$MERGED_SHA" ]; then
      kata_close_run done "$(plan_title) — merged $MERGED_SHA"
    else
      kata_close_run done "$(plan_title) — $PR_URL ${MERGE_NOTE:-left open}"
    fi
  else
    # `ERROR` was set with the outcome, above, so the card could quote it.
    write_status parked "$PR_URL$fold_tail"
    kata_close_run wontfix "$(plan_title) — $(error_head)"
  fi
  collect_evidence
  push_evidence "$RUN_ID: $outcome — $PR_URL"
  # The last evidence commit is on the remote: the two tags mark it and the
  # plan commit, and the two branches under them go.
  record_tags
  notify "run-$RUN_N $STATE" "$TARGET_REPO — $PR_URL"
}

# By hand, for a run that is neither finished nor progressing: park the page
# and stop the engine's service. Nothing on the golden arms this — the
# `claude-max` attachment expires with its `--for`, and the janitor reads
# the evidence branch — so it is a tool for an operator on the box, not a timer.
do_deadman() {
  RUN_N="$(read_status_field run)"
  [ -n "$RUN_N" ] && RUN_ID="run-$RUN_N" && BRANCH="ultra/integration-$RUN_ID"
  :
  STARTED_AT="$(read_status_field startedAt)"
  VM_NAME="$(read_status_field vm)"
  local state phase_now folds=2
  state="$(read_status_field state)"
  case "$state" in
    done|parked|failed)
      log "deadman: already $state — nothing to do"
      exit 0 ;;
  esac
  # WHICH FOLD UNITS TO STOP, read off the page BEFORE this function overwrites
  # it. A run folds again for as long as `FOLD_AGAIN_WAIT` allows, so the units
  # are not a fixed pair: the phase a fold writes is `publish fold (attempt <n>)`
  # and that `<n>` is the highest unit this run can have started. Two is the
  # floor, so a page caught between attempts still names both.
  phase_now="$(read_status_field phase)"
  case "$phase_now" in
    "publish fold (attempt "*")")
      folds="${phase_now#publish fold (attempt }"
      folds="${folds%)}" ;;
  esac
  [ "$folds" -ge 2 ] 2>/dev/null || folds=2
  # A run parked during the publish fold already has its PR: the page this one
  # overwrites carries it, and a `parked` page that dropped those three cells
  # would tell the janitor and the operator that a PR which exists does not.
  PR_URL="$(read_status_field pr)"
  PR_AUTHOR="$(read_status_field prAuthor)"
  MERGED_SHA="$(read_status_field merged)"
  ERROR="deadman: parked by hand without done"
  write_status parked "deadman"
  notify "run-${RUN_N:-?} parked" "$ERROR"
  # Every model this run may have running, not only the engine's: the folder
  # runs as its own unit, and a deadman that stopped the engine and left a
  # folder rebasing would leave a model working under a `parked` page.
  if [ -n "$RUN_N" ]; then
    local unit units n=1
    units="fleet-engine-$RUN_N"
    while [ "$n" -le "$folds" ]; do
      units="$units fleet-fold-$RUN_N-$n"
      n=$(( n + 1 ))
    done
    for unit in $units; do
      case "$(fleet_systemctl --user is-active "$unit.service" 2>&1 || true)" in
        active*) fleet_systemctl --user stop "$unit.service" || true ;;
      esac
    done
  fi
  exit 0
}

# The event log as a run's watcher reads it: one JSON object on one line, the
# open worker and a cell per task. A READER and nothing else — it starts no
# unit, touches no branch and writes no page, which is what lets a person, the
# page's own writer and a later tool all ask the same question of the same file
# and get the same answer. The preamble above is side-effect free (`deadman`
# already relies on it), so this verb is safe to run on a live box.
do_project() { # $1 = events.jsonl, $2 = args.json (optional)
  [ "$#" -ge 1 ] || {
    printf 'usage: sandbox-boot.sh project <events.jsonl> [<args.json>]\n' >&2
    exit 2
  }
  project_read all "$1" "${2:-}" || printf '{"sub":null,"tasks":{}}\n'
  exit 0
}

MODE="${1:-boot}"
case "$MODE" in
  boot)    do_boot ;;
  deadman) do_deadman ;;
  project) shift; do_project "$@" ;;
  *) printf 'usage: sandbox-boot.sh [boot|deadman|project <events.jsonl> [<args.json>]]\n' >&2
     exit 2 ;;
esac
