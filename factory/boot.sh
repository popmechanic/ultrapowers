#!/bin/bash
# factory/boot.sh — the sandbox side of a factory run, and the run unit's own
# process: it clones the target, takes the plan off `ultra/plan-run-<N>`, proves the
# credential, runs `factory/engine.mjs` as a transient user service, keeps the record
# on `ultra/evidence-run-<N>` while that engine works, then pushes the integration
# branch, opens the PR and leaves the two tags. It also stands up its own kata spoke
# before the engine starts (when the plan commit carries one) and leaves it when the
# run ends. No status server, no merge, no fold-again, no card: git is the record
# for everything but that spoke. Every external program goes
# through a `fleet_*` wrapper and every path hangs off `$FLEET_HOME` (so the exam
# drives this against stubs), and no absolute interpreter path appears below.
set -euo pipefail
FLEET_HOME="${FLEET_HOME:-/home/exedev}"
REFLECTION_URL="${REFLECTION_URL:-https://reflection.int.exe.xyz}"
ANTHROPIC_PROXY_URL="${ANTHROPIC_PROXY_URL:-https://claude-max.int.exe.xyz}"
TYPESAFE_PROXY_URL="${TYPESAFE_PROXY_URL:-https://typesafe.int.exe.xyz}"
GITHUB_INT_HOST="${GITHUB_INT_HOST:-github.int.exe.xyz}"
PLAN_BLOB_PATH=".ultrapowers/plan.md"
KATA_BLOB_PATH=".ultrapowers/kata.json"
KATA_VERSION="0.18.0"
KATA_RELEASE_BASE="https://github.com/kenn-io/kata/releases/download/v$KATA_VERSION/"
KATA_ASSET="kata_${KATA_VERSION}_linux_amd64.tar.gz"
KATA_HUB_URL="https://kata-sync.int.exe.xyz"
# The helper administers through the host where the edge injects the hub's bearer; the spoke syncs through the other.
KATA_ADMIN_URL="https://kata.int.exe.xyz"
KATA_URL="http://127.0.0.1:7777"
FLEET_KATA_WAIT_SECONDS="${FLEET_KATA_WAIT_SECONDS:-120}"
FLEET_COMMIT_SECONDS="${FLEET_COMMIT_SECONDS:-60}"
# The run's one clock: systemd ends the engine unit at this many seconds (the old lease's four hours), and
# whatever landed by then is published as a draft. No worker carries a cap of its own.
FLEET_RUN_MAX_SECONDS="${FLEET_RUN_MAX_SECONDS:-14400}"
# `systemd-run --user` needs a bus address: the run unit inherits one, ssh does not.
XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"; DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"
export XDG_RUNTIME_DIR DBUS_SESSION_BUS_ADDRESS
TARGET_DIR="$FLEET_HOME/target"; EVIDENCE_DIR="$FLEET_HOME/evidence"
RUN_DIR="$FLEET_HOME/run"; ENGINE_LOG="$FLEET_HOME/engine.log"
BOOT_LOG="$FLEET_HOME/fleet-boot.log"; DONE_MARKER="$FLEET_HOME/.fleet-engine-done"
RUN_N=""; PLAN_SHA=""; TARGET_REPO=""; BASE_SHA=""; ENGINE_SHA=""; RUN_ID=""
BRANCH=""; PLAN_BRANCH=""; EVIDENCE_BRANCH=""; EVIDENCE_REL=""; PLAN_FILE=""
ENGINE_REPO_DIR=""; STATUS_FILE=""; STATE=""; PHASE=""; PR_URL=""; PR_AUTHOR=""
ERROR=""; VM_NAME=""; STARTED_AT=""; EVIDENCE_READY=""; HOLD_FLAG=0
BOARD_BOUND=""; BOARD_UNIT=""; BOARD_PROJECT_ID=""; BOARD_PROJECT_NAME=""; BOARD_KATA_JSON=""
# Self-merge state: MERGED_SHA is the merge commit once a PUT succeeds (else empty, which
# `write_status` renders as `null`); MERGE_PHASE is the reason `maybe_self_merge` parked,
# read only when MERGED_SHA stayed empty. SELF_MERGE_* are the read of `publish.self_merge`.
MERGED_SHA=""; MERGE_PHASE=""; SELF_MERGE_ENABLED=0; SELF_MERGE_MAX_REFOLDS=3; SELF_MERGE_WAIT_SECONDS=120
fleet_curl()        { curl "$@"; }
fleet_git()         { git "$@"; }
fleet_npm()         { npm "$@"; }
fleet_systemd_run() { systemd-run "$@"; }
fleet_systemctl()   { systemctl "$@"; }
fleet_python3()     { python3 "$@"; }
fleet_node()        { node "$@"; }
# KATA_SERVER rides every call the boot itself makes: the daemon it is talking
# to is always the one it just started, on localhost.
fleet_kata() { env "KATA_SERVER=$KATA_URL" kata "$@"; }
# The token is the literal `placeholder`: the edge injects the real bearer, and no argv here carries a credential.
fleet_claude() { env ANTHROPIC_BASE_URL="$ANTHROPIC_PROXY_URL" CLAUDE_CODE_OAUTH_TOKEN=placeholder claude "$@"; }
log() {
  local line; line="$(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; mkdir -p "$FLEET_HOME"
  printf '%s\n' "$line" >>"$BOOT_LOG"; printf '%s\n' "$line" >&2
}
now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }
# No jq: every value read is one flat field of a small document, and an ABSENT field
# is an answer rather than an error. Both take the field in $1, the document on stdin.
json_field() { { grep -o "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" || true; } | head -n 1 | sed 's/.*:[[:space:]]*"\(.*\)"$/\1/'; }
json_int()   { { grep -o "\"$1\"[[:space:]]*:[[:space:]]*-\?[0-9]\+" || true; } | head -n 1 | sed 's/.*[:[:space:]]//'; }
# The one reader for both ids the launcher's kata.json record carries: parsed
# as JSON (never grepped — `fleet/launch.mjs` writes the record pretty-printed,
# `"run": {` and its closing `}` on different lines, which no line-based
# pattern can match), through `fleet_python3` with the standard library alone,
# the same door `read_self_merge_policy` already uses for `factory/policy.json`.
# $1 = the file. Prints `<project id> <run uid>` and exits 0 on success; prints
# nothing and exits 1 when the file is missing, is not JSON, or lacks either
# `project.id` (an integer) or `run.uid` (a non-empty string).
kata_ids() {
  fleet_python3 -c '
import json, sys
try:
    with open(sys.argv[1]) as f:
        doc = json.load(f)
    project_id = doc["project"]["id"]
    run_uid = doc["run"]["uid"]
    if not isinstance(project_id, int) or isinstance(project_id, bool):
        raise SystemExit(1)
    if not isinstance(run_uid, str) or not run_uid:
        raise SystemExit(1)
    print(project_id, run_uid)
except Exception:
    raise SystemExit(1)
' "$1" 2>/dev/null
}
# The run's task issues, one `<task id> <uid>` line each in task-id order, from the same record. Exit 1 and
# nothing on stdout when the file is missing, is not JSON, or names no task with a uid.
kata_task_uids() {
  fleet_python3 -c '
import json, sys
try:
    with open(sys.argv[1]) as f:
        tasks = json.load(f)["tasks"]
    rows = [(k, v["uid"]) for k, v in tasks.items() if isinstance(v.get("uid"), str) and v["uid"]]
    if not rows:
        raise SystemExit(1)
    def order(row):
        return (0, int(row[0]), "") if row[0].isdigit() else (1, 0, row[0])
    for k, uid in sorted(rows, key=order):
        print(k, uid)
except Exception:
    raise SystemExit(1)
' "$1" 2>/dev/null
}
# Backslash, quote, tab, and newline as `\n` and never as nothing — `error` carries a reply body.
json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' |
    awk 'BEGIN { ORS = "" } { gsub(/\t/, "\\\\t"); print (NR > 1 ? "\\n" : "") $0 }'
}
# The one writer for every end-of-run row (#1167): one JSON object, one line, appended to
# `<file>` (created if it does not exist). $1 = file, $2 = kind, then any number of
# `key=value` pairs, each written in argument order — `factory/record.mjs row` renders the
# line, `ts` included. Also reachable as `boot.sh event-row <file> <kind> [key=value ...]`
# so the writer is examinable without running a boot.
event_row() {
  local file="$1"; shift
  mkdir -p "$(dirname "$file")" 2>/dev/null || true
  fleet_node "$ENGINE_REPO_DIR/factory/record.mjs" row "$@" >>"$file"
}
# The failure account: the page, one evidence commit, one push, out — once there is an evidence branch to write to.
fail() { # $1 = message, $2 = exit code (default 1)
  ERROR="$1"; log "FAILED: $1"
  if [ -n "${EVIDENCE_READY:-}" ] && [ -z "${FAILING:-}" ]; then
    FAILING=1; collect_evidence; write_status failed "$PHASE"; evidence_commit "$RUN_ID: failed"; fi
  exit "${2:-1}"
}
read_assignment() { if [ -n "${FLEET_ASSIGNMENT:-}" ]; then printf '%s\n' "$FLEET_ASSIGNMENT"; else fleet_curl -fsS "$REFLECTION_URL/comment" 2>/dev/null | json_field comment || true; fi; }
is_sha()    { case "$1" in *[!0-9a-f]* | "") return 1 ;; esac; [ "${#1}" -eq 40 ]; }
is_target() { [[ $1 =~ ^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ ]]; }
# `hold` is recorded: `hold=1` is the signal that keeps `publish` from ever sending a merge.
parse_assignment() { # $1 = the comment line
  local tok key val
  for tok in $1; do
    key="${tok%%=*}"; val="${tok#*=}"
    case "$key" in
      run) RUN_N="$val" ;; plan) PLAN_SHA="$val" ;; target) TARGET_REPO="$val" ;;
      base) BASE_SHA="$val" ;; engine) ENGINE_SHA="$val" ;;
      hold) [ "$val" = 1 ] && HOLD_FLAG=1 ;;
      *) fail "assignment: unknown key '$key' in comment" ;; esac
  done
  [ -n "$RUN_N" ]          || fail "assignment: no run id in comment"
  is_sha "$PLAN_SHA"       || fail "assignment: plan is not a 40-hex sha ('$PLAN_SHA')"
  is_target "$TARGET_REPO" || fail "assignment: target is not owner/repo ('$TARGET_REPO')"
  is_sha "$BASE_SHA"       || fail "assignment: base is not a 40-hex sha ('$BASE_SHA')"
  is_sha "$ENGINE_SHA"     || fail "assignment: engine is not a 40-hex sha ('$ENGINE_SHA')"
  RUN_ID="run-$RUN_N"; BRANCH="ultra/integration-$RUN_ID"; PLAN_BRANCH="ultra/plan-$RUN_ID"
  EVIDENCE_BRANCH="ultra/evidence-$RUN_ID"; EVIDENCE_REL=".ultrapowers/runs/$RUN_N"
  PLAN_FILE="$FLEET_HOME/plans/$RUN_ID.md"; ENGINE_REPO_DIR="$FLEET_HOME/engines/$ENGINE_SHA"
  STATUS_FILE="$EVIDENCE_DIR/$EVIDENCE_REL/status.json"
  log "assignment: $RUN_ID target=$TARGET_REPO base=$BASE_SHA engine=$ENGINE_SHA"
}
# The clone is left AT BASE — the integration branch is the engine's to create. The plan is
# checked against the assignment's `plan=` BEFORE a model reads a word of it (a plan branch
# someone else moved is unsigned instructions) and written out whole, because `$(…)` eats its
# last newline. The evidence branch is a DETACHED WORKTREE OF THE TARGET CLONE, so the receipts
# commit onto the target and nowhere else: on the plan commit, or on what a retry left behind.
prepare() {
  local landed at
  [ -e "$TARGET_DIR/.git" ] || fleet_git clone "https://$GITHUB_INT_HOST/$TARGET_REPO.git" "$TARGET_DIR" || fail "clone: target $TARGET_REPO through $GITHUB_INT_HOST"
  fleet_git -C "$TARGET_DIR" checkout "$BASE_SHA" || fail "checkout: target at $BASE_SHA"
  fleet_git -C "$TARGET_DIR" fetch origin "refs/heads/$PLAN_BRANCH" || fail "plan: cannot fetch $PLAN_BRANCH from $TARGET_REPO"
  landed="$(fleet_git -C "$TARGET_DIR" rev-parse FETCH_HEAD 2>/dev/null || true)"
  [ "$landed" = "$PLAN_SHA" ] || fail "plan: $PLAN_BRANCH is at '${landed:-<nothing>}', not the plan=$PLAN_SHA this run was assigned"
  mkdir -p "$FLEET_HOME/plans"; fleet_git -C "$TARGET_DIR" show "$PLAN_SHA:$PLAN_BLOB_PATH" >"$PLAN_FILE" || fail "plan: $PLAN_SHA carries no $PLAN_BLOB_PATH"
  log "plan: $PLAN_BRANCH at $PLAN_SHA -> $PLAN_FILE"
  v="${PLAN_FILE%.md}.gate-verdicts.json"; fleet_git -C "$TARGET_DIR" show "$PLAN_SHA:.ultrapowers/gate-verdicts.json" >"$v" 2>/dev/null || { rm -f "$v"; log "plan: no gate-verdicts.json at $PLAN_SHA (run-188 died without it)"; }
  [ -e "$EVIDENCE_DIR/.git" ] && { EVIDENCE_READY=1; return 0; }
  if fleet_git -C "$TARGET_DIR" fetch origin "refs/heads/$EVIDENCE_BRANCH" 2>/dev/null; then at=FETCH_HEAD; else at="$PLAN_SHA"; fi
  fleet_git -C "$TARGET_DIR" worktree add --detach "$EVIDENCE_DIR" "$at" || fail "evidence: worktree add $EVIDENCE_DIR at $at"
  EVIDENCE_READY=1; log "evidence: worktree at $at"
}
ensure_git_identity() { # $1 = the dir to configure (default: $EVIDENCE_DIR)
  local dir="${1:-$EVIDENCE_DIR}"
  [ -n "$(fleet_git -C "$dir" config user.email 2>/dev/null || true)" ] && return 0
  fleet_git -C "$dir" config user.email "fleet@exe.dev" || true
  fleet_git -C "$dir" config user.name "${VM_NAME:-fleet}" || true
}
# One writer, thirteen cells, written atomically through `factory/record.mjs status`.
# `startedAt` is the run's clock and is set once; every write stamps `updatedAt`.
write_status() { # $1 = state, $2 = phase (optional)
  local tmp
  STATE="$1"; if [ "$#" -ge 2 ]; then PHASE="$2"; fi
  [ -n "$STARTED_AT" ] || STARTED_AT="$(now_iso)"
  mkdir -p "$EVIDENCE_DIR/$EVIDENCE_REL"; tmp="$STATUS_FILE.tmp.$$"
  fleet_node "$ENGINE_REPO_DIR/factory/record.mjs" status \
    run="$RUN_N" state="$STATE" phase="$PHASE" pr="$PR_URL" prAuthor="$PR_AUTHOR" \
    merged="$MERGED_SHA" branch="$BRANCH" vm="$VM_NAME" startedAt="$STARTED_AT" error="$ERROR" \
    --events "$RUN_DIR/events.jsonl" >"$tmp"
  mv "$tmp" "$STATUS_FILE"; log "status: state=$STATE phase=$PHASE"
}
# The named files the engine left, copied beside the page. Never `git add -A`: the
# engine's clones live under the run directory and none of them is evidence.
collect_evidence() {
  mkdir -p "$EVIDENCE_DIR/$EVIDENCE_REL"
  [ -f "$RUN_DIR/events.jsonl" ] && cp "$RUN_DIR/events.jsonl" "$EVIDENCE_DIR/$EVIDENCE_REL/events.jsonl"
  [ -f "$ENGINE_LOG" ] && cp "$ENGINE_LOG" "$EVIDENCE_DIR/$EVIDENCE_REL/engine.log"
  return 0
}
evidence_commit() { # $1 = commit subject
  local p n=0 paths=()
  for p in status.json events.jsonl engine.log; do if [ -f "$EVIDENCE_DIR/$EVIDENCE_REL/$p" ]; then paths+=("$EVIDENCE_REL/$p"); fi; done
  [ -d "$EVIDENCE_DIR/$EVIDENCE_REL/exams" ] && paths+=("$EVIDENCE_REL/exams")
  [ "${#paths[@]}" -gt 0 ] || return 0
  ensure_git_identity; fleet_git -C "$EVIDENCE_DIR" add -- "${paths[@]}" || log "evidence: add refused"
  fleet_git -C "$EVIDENCE_DIR" commit -m "$1" || log "evidence: nothing to commit"
  while :; do
    if fleet_git -C "$EVIDENCE_DIR" push origin "HEAD:refs/heads/$EVIDENCE_BRANCH"; then return 0; fi
    n=$(( n + 1 )); if [ "$n" -ge 5 ]; then log "evidence: push rejected $n times — the commit stays local"; return 0; fi
    fleet_git -C "$EVIDENCE_DIR" pull --rebase origin "$EVIDENCE_BRANCH" || true
  done
}
# One tick of the relay: copy only when the bytes differ, through a temporary name in the destination directory.
tick_events() {
  local src="$RUN_DIR/events.jsonl" dst="$EVIDENCE_DIR/$EVIDENCE_REL/events.jsonl"
  [ -f "$src" ] || return 0
  if [ -f "$dst" ] && [ "$(cat "$src")" = "$(cat "$dst")" ]; then return 0; fi
  mkdir -p "$EVIDENCE_DIR/$EVIDENCE_REL"; cp "$src" "$dst.tmp.$$"; mv "$dst.tmp.$$" "$dst"
  evidence_commit "$RUN_ID: events"
}
# NO oauth_token IS A FAILURE, not a warning: `api_key` bills exe.dev credits, and a box answering neither is off the subscription.
auth_status() {
  local out; out="$(fleet_claude auth status 2>&1 || true)"
  log "claude auth status: $(printf '%s' "$out" | tr '\n' ' ')"
  case "$out" in *api_key*) fail "claude auth status reports api_key — that bills exe.dev credits, refusing to run" ;; esac
  case "$out" in *oauth_token*) : ;;
    *) fail "claude auth status shows no oauth_token — this box is not on the claude-max subscription, refusing to run" ;; esac
}
# ONE request, before anything is spent: `auth status` proves a token is held, not that it still works. Two
# answers stop the run and every other answer proceeds, because a probe that manufactured a park out of a flake
# would cost more runs than it saved, and a dead credential is caught again at the first worker. 401/403 +
# `oauth_scope_insufficient` is a `claude setup-token` bearer that serves inference without `user:profile`
# (measured 2026-09-17) — scoped, not dead. A `"type":"error"` document is the BEARER (fix: refresh); the edge's
# plain-text `integration not found …` is the EDGE (fix: exe.dev support with the trace), so that line rides whole.
bearer_probe() {
  local answer code body
  answer="$(fleet_curl -sS --max-time 20 -H 'authorization: Bearer placeholder' "$ANTHROPIC_PROXY_URL/api/oauth/usage" -w '\n%{http_code}' 2>/dev/null || true)"
  code="$(printf '%s' "$answer" | tail -n 1)"; body="$(printf '%s' "$answer" | sed '$d')"
  if [ "$code" = 200 ]; then log "bearer probe: alive"; return 0; fi
  case "$code" in 401|403) : ;; *) log "bearer probe: inconclusive"; return 0 ;; esac
  case "$body" in *oauth_scope_insufficient*) log "bearer probe: inconclusive (scope)"; return 0 ;; esac
  case "$(printf '%s' "$body" | tr -d ' \t\n')" in
    *'"type":"error"'*) fail "bearer probe: the credential was refused ($code) — $(printf '%s' "$body" | json_field message)" ;; esac
  case "$body" in
    'integration not found'*) fail "bearer probe: the edge refused ($code) — $(printf '%s' "$body" | tr '\n' ' ')" ;; esac
  log "bearer probe: inconclusive"
}
# The readiness heuristic: a binding for OUR project (spoke_project or hub_project
# naming it) whose status reads approved or bound. The shape of `federation status
# --json` is Kata's to define; this only ever tests the words the Machine clause
# itself uses, never the document around them.
board_status_ready() { # $1 = the raw `federation status --json` document
  # Kata 0.18 prints no `status` cell: a bound spoke reads `"role":"spoke"` with `"provider_status":"ready"`
  # (run-194's own document, 2026-09-18); an unbound one reads `standalone` and `pending` (run-193's).
  case "$1" in *"$BOARD_PROJECT_NAME"*) : ;; *) return 1 ;; esac
  case "$1" in *'"role":"spoke"'*|*'"role": "spoke"'*) : ;; *) return 1 ;; esac
  case "$1" in *'"provider_status":"ready"'*|*'"provider_status": "ready"'*) return 0 ;; esac
  return 1
}
# One sandbox, one spoke: brought up before the engine so its three flags are ready
# for `run_engine`, joined to the hub through config alone (Kata's own credential
# provider mints and holds the token — this writes no `token`/`token_env`/`actor`
# anywhere). Anything that does not land — no kata.json on the plan commit, a
# release that does not verify, a wait that runs out — is one `board:` log line and
# BOARD_BOUND stays empty, which is `run_engine`'s whole signal.
# The run's first task issue, answered by the spoke: the sign that the first pull has landed. A kata.json
# that names no task reads as present — there is nothing to wait for.
board_issue_present() {
  local uid
  uid="$(fleet_python3 -c 'import json,sys
tasks = (json.load(open(sys.argv[1])).get("tasks") or {})
print(next(iter(tasks.values()), {}).get("uid", ""))' "$BOARD_KATA_JSON" 2>/dev/null || true)"
  [ -n "$uid" ] || return 0
  fleet_curl -fsS -o /dev/null --max-time 5 "$KATA_URL/api/v1/issues/$uid" 2>/dev/null
}
board_up() {
  local blob project_name project_id work start_ts now_ts out local_id
  BOARD_UNIT="fleet-kata-$RUN_N"
  blob="$(fleet_git -C "$TARGET_DIR" show "$PLAN_SHA:$KATA_BLOB_PATH" 2>/dev/null || true)"
  [ -n "$blob" ] || { log "board: no $KATA_BLOB_PATH at $PLAN_SHA — the run proceeds without a spoke"; return 0; }
  mkdir -p "$FLEET_HOME/plans"; BOARD_KATA_JSON="$FLEET_HOME/plans/$RUN_ID.kata.json"
  printf '%s' "$blob" >"$BOARD_KATA_JSON"
  project_name="$(json_field name <"$BOARD_KATA_JSON")"; project_id="$(json_int id <"$BOARD_KATA_JSON")"
  if [ -z "$project_name" ] || [ -z "$project_id" ]; then
    log "board: $KATA_BLOB_PATH at $PLAN_SHA carries no project.name/project.id — proceeding without a spoke"; return 0; fi
  BOARD_PROJECT_NAME="$project_name"; BOARD_PROJECT_ID="$project_id"
  work="$(mktemp -d)" || { log "board: mktemp failed — proceeding without a spoke"; return 0; }
  if ! ( cd "$work" &&
      fleet_curl -fsSL -o SHA256SUMS "${KATA_RELEASE_BASE}SHA256SUMS" &&
      fleet_curl -fsSL -o "$KATA_ASSET" "${KATA_RELEASE_BASE}${KATA_ASSET}" &&
      grep " $KATA_ASSET\$" SHA256SUMS | sha256sum -c - &&
      bin_rel="$(tar -tzf "$KATA_ASSET" | grep -E '(^|/)kata$' | head -n 1)" &&
      tar -xzf "$KATA_ASSET" &&
      mkdir -p "$FLEET_HOME/.local/bin" &&
      install -m 0755 "$bin_rel" "$FLEET_HOME/.local/bin/kata" )
  then log "board: installing kata $KATA_VERSION failed — proceeding without a spoke"; return 0; fi
  PATH="$FLEET_HOME/.local/bin:$PATH"
  # The one kata on a sandbox (#1190): nothing system-wide sits behind this PATH entry.
  command -v kata >/dev/null 2>&1 || { log "board: kata $KATA_VERSION installed but not on PATH — proceeding without a spoke"; return 0; }
  log "board: kata $KATA_VERSION installed at $(command -v kata)"
  # A person's kata on this sandbox (Shelley, 2026-09-21): the spoke's home and its daemon already
  # named, at an absolute path so a non-login `ssh <vm> ~/.local/bin/fleet-kata …` finds it. Never the run's failure.
  { printf '#!/bin/sh\nexec env "KATA_HOME=%s" "KATA_SERVER=%s" "%s" "$@"\n' \
      "$FLEET_HOME/kata" "$KATA_URL" "$FLEET_HOME/.local/bin/kata" >"$FLEET_HOME/.local/bin/fleet-kata" &&
    chmod 0755 "$FLEET_HOME/.local/bin/fleet-kata"; } || log "board: could not write fleet-kata — hand diagnostics need KATA_HOME and KATA_SERVER set by hand"
  mkdir -p "$FLEET_HOME/kata/helper"
  cat >"$FLEET_HOME/kata/config.toml" <<EOF
listen = "127.0.0.1:7777"

[[daemon]]
name = "hub"
url = "$KATA_HUB_URL"

[[federation.project]]
hub = "hub"
spoke_project = "$project_name"
hub_project = "$project_name"
intent = "collaborate"
credential_provider = ["node", "$ENGINE_REPO_DIR/factory/kata-credential.mjs", "--kata-json", "$BOARD_KATA_JSON", "--admin-url", "$KATA_ADMIN_URL", "--state-dir", "$FLEET_HOME/kata/helper"]
EOF
  # `systemd-run --user` resolves only the FIRST word (`env`) against the caller's
  # PATH; `env` then resolves `kata` itself, against whatever PATH the unit lands
  # with — the user manager's own, NOT this shell's just-updated one. Forwarding
  # PATH explicitly (rather than trusting the manager to have heard of
  # $FLEET_HOME/.local/bin) is what makes `kata` findable inside the unit at all.
  if ! fleet_systemd_run --user "--unit=$BOARD_UNIT" -p "WorkingDirectory=$FLEET_HOME/kata" -- \
      env "KATA_HOME=$FLEET_HOME/kata" "PATH=$PATH" kata daemon start --foreground
  then log "board: systemd-run could not start $BOARD_UNIT — proceeding without a spoke"; return 0; fi
  start_ts="$(date +%s)"
  while :; do
    out="$(fleet_kata federation status --json 2>/dev/null || true)"
    if board_status_ready "$out"; then
      # The spoke numbers its own projects: the engine writes to the LOCAL id the status names, never the hub's
      # (run-195: every comment answered `404 project_not_found` on the hub's 31 where the spoke's was 2).
      local_id="$(printf '%s' "$out" | json_int project_id)"; [ -n "$local_id" ] && BOARD_PROJECT_ID="$local_id"
      # Bound is not yet pulled: the spoke's first pull lands some seconds after the binding, and an engine
      # started in that gap reads `404 issue_not_found` for its own tasks (run-196, every task at minute zero).
      # So the wait also covers the run's first task issue arriving on the spoke.
      if board_issue_present; then
        BOARD_BOUND=1; log "kata federation status: $project_name is bound as local project $BOARD_PROJECT_ID, and the run's issues have arrived"; return 0; fi
    fi
    now_ts="$(date +%s)"
    if [ "$((now_ts - start_ts))" -ge "$FLEET_KATA_WAIT_SECONDS" ]; then
      log "board: $project_name was not bound with the run's issues pulled within ${FLEET_KATA_WAIT_SECONDS}s — federation status said: $out"
      return 0
    fi
    sleep 1
  done
}
# The teardown side: a bound spoke leaves the hub and its unit stops. A `leave` that
# fails is logged and nothing else — the run's own state and exit code were decided
# before this ran, and stay decided (CLAUDE.md: hub writes are never the run's failure).
board_down() {
  local out rc=0
  [ -n "$BOARD_BOUND" ] || return 0
  # `--yes` and a closed stdin: under the run unit there is no TTY, and kata answers `no TTY: pass --yes to
  # proceed noninteractively` (exit 6) without it — every factory run through run-198 left its enrollment
  # live on the hub that way (#1176; measured on run-36's sandbox 2026-09-21, where `--yes` left and revoked).
  if ! out="$(fleet_kata federation leave "$BOARD_PROJECT_NAME" --yes </dev/null 2>&1)"
  then rc=$?; log "board: kata federation leave $BOARD_PROJECT_NAME failed — leaving the unit for the box to reap — $(printf '%s' "$out" | head -n 1 | cut -c1-300)"; fi
  event_row "$EVIDENCE_DIR/$EVIDENCE_REL/events.jsonl" board:leave rc="$rc" || true
  fleet_systemctl --user stop "$BOARD_UNIT" >/dev/null 2>&1 || true
  BOARD_BOUND=""
  return 0
}
engine_deps() {
  [ -d "$ENGINE_REPO_DIR/fleet/node_modules" ] && return 0
  if [ -f "$ENGINE_REPO_DIR/fleet/package-lock.json" ]
  then ( cd "$ENGINE_REPO_DIR/fleet" && fleet_npm ci --no-audit --no-fund ) || fail "npm ci: engine deps"
  else ( cd "$ENGINE_REPO_DIR/fleet" && fleet_npm install --no-audit --no-fund ) || fail "npm install: engine deps"; fi
}
# A transient SERVICE, not a scope: `--wait` hands back the exit code, `--collect` unloads the unit, and the
# memory cap bounds the engine alone. A service inherits neither cwd nor environment, so the cwd is a property
# and the child's variables ride in its own argv. While it runs, the boot relays events every FLEET_COMMIT_SECONDS.
run_engine() {
  local pid board_args=()
  [ -n "$BOARD_BOUND" ] && board_args=(--kata-url "$KATA_URL" --kata-project "$BOARD_PROJECT_ID" --kata-json "$BOARD_KATA_JSON" --kata-actor "engine:$RUN_ID")
  mkdir -p "$RUN_DIR"; rm -f "$DONE_MARKER"
  ( set +e
    fleet_systemd_run --user "--unit=fleet-engine-$RUN_N" --pipe --wait --collect \
      -p MemoryMax=40G -p MemorySwapMax=0 -p LimitNOFILE=524288 -p "RuntimeMaxSec=$FLEET_RUN_MAX_SECONDS" -p "WorkingDirectory=$TARGET_DIR" -- \
      env -u CLAUDE_CONFIG_DIR "ANTHROPIC_BASE_URL=$ANTHROPIC_PROXY_URL" \
        "TYPESAFE_BASE_URL=$TYPESAFE_PROXY_URL" CLAUDE_CODE_OAUTH_TOKEN=placeholder \
        "ULTRAPOWERS_FLEET_RUN=$RUN_ID" node "$ENGINE_REPO_DIR/factory/engine.mjs" \
        --plan "$PLAN_FILE" --target "$TARGET_DIR" --base "$BASE_SHA" --run-dir "$RUN_DIR" \
        ${board_args[@]+"${board_args[@]}"} >>"$ENGINE_LOG" 2>&1
    printf '%s\n' "$?" >"$DONE_MARKER" ) &
  pid=$!
  while [ ! -f "$DONE_MARKER" ]; do sleep "$FLEET_COMMIT_SECONDS"; tick_events; done
  wait "$pid" 2>/dev/null || true
  log "engine: exited $(cat "$DONE_MARKER") (output in $ENGINE_LOG)"
}
plan_title()   { { sed -n 's/^# \(.*\)$/\1/p' "$PLAN_FILE" || true; } | head -n 1; }
# The pull request body: the plan's summary paragraph, the landing rows off the run's
# own event log, and its closes line — rendered whole by `factory/record.mjs pr-body`.
pr_body() { fleet_node "$ENGINE_REPO_DIR/factory/record.mjs" pr-body "$PLAN_FILE" --events "$RUN_DIR/events.jsonl"; }
# The target's default branch as the remote advertised it: a PR against a guessed `main` on a `master` repo is refused, or worse taken.
default_branch() {
  local ref; ref="$(fleet_git -C "$TARGET_DIR" symbolic-ref refs/remotes/origin/HEAD 2>/dev/null || true)"
  case "$ref" in refs/remotes/origin/?*) printf '%s\n' "${ref#refs/remotes/origin/}" ;; *) return 1 ;; esac
}
# `publish.self_merge` off `factory/policy.json` in the ENGINE checkout — not the target's.
# A missing file, a missing `enabled` cell, or a read that fails in any way reads as
# disabled: self-merge is opt-in, never a default a broken read falls into.
read_self_merge_policy() {
  local out
  out="$(fleet_node "$ENGINE_REPO_DIR/factory/record.mjs" policy "$ENGINE_REPO_DIR/factory/policy.json" 2>/dev/null)" || out="0 3 120"
  set -- $out
  SELF_MERGE_ENABLED="${1:-0}"; SELF_MERGE_MAX_REFOLDS="${2:-3}"; SELF_MERGE_WAIT_SECONDS="${3:-120}"
}
# M2: on a moved default branch, hand the target to the sibling re-fold entry and, once it
# says every exam ran green there (exit 0), force-push the target's new HEAD over the run's
# own branch. A fetch of $BRANCH first gives `--force-with-lease` a lease to check against —
# this clone only ever pushed that branch, so without it there is no local tracking ref to
# lease on. Any other exit (3 red, 4 conflict, or anything else) leaves the target untouched
# and sets MERGE_PHASE, naming the re-fold's own reason when it gave one.
refold_onto() { # $1 = the base the run's work stood on, $2 = the moved tip
  local base="$1" onto="$2" line rc=0 reason
  line="$(env -u CLAUDE_CONFIG_DIR "ANTHROPIC_BASE_URL=$ANTHROPIC_PROXY_URL" \
      "TYPESAFE_BASE_URL=$TYPESAFE_PROXY_URL" CLAUDE_CODE_OAUTH_TOKEN=placeholder \
      "ULTRAPOWERS_FLEET_RUN=$RUN_ID" node "$ENGINE_REPO_DIR/factory/engine.mjs" --refold \
      --plan "$PLAN_FILE" --target "$TARGET_DIR" --base "$base" --onto "$onto" \
      --run-dir "$RUN_DIR" --exams-dir "$EVIDENCE_DIR/$EVIDENCE_REL/exams" | tail -n 1)" || rc=$?
  if [ "$rc" -ne 0 ]; then
    reason="$(printf '%s' "$line" | json_field reason)"
    MERGE_PHASE="merge: re-fold refused (${reason:-exit $rc})"
    log "merge: re-fold onto $onto exited $rc — $MERGE_PHASE"
    event_row "$EVIDENCE_DIR/$EVIDENCE_REL/events.jsonl" refold ok=false reason="$MERGE_PHASE" || true
    return 1
  fi
  fleet_git -C "$TARGET_DIR" fetch origin "refs/heads/$BRANCH" 2>/dev/null || true
  if ! fleet_git -C "$TARGET_DIR" push --force-with-lease origin "HEAD:refs/heads/$BRANCH"; then
    MERGE_PHASE="merge: force-with-lease push of the re-folded head was refused"
    log "merge: $MERGE_PHASE"
    event_row "$EVIDENCE_DIR/$EVIDENCE_REL/events.jsonl" refold ok=false reason="$MERGE_PHASE" || true
    return 1
  fi
  log "merge: re-folded onto $onto and pushed $BRANCH"
  event_row "$EVIDENCE_DIR/$EVIDENCE_REL/events.jsonl" refold ok=true || true
  return 0
}
# M3: GitHub answers `mergeable: null` for a few seconds after a push while it recomputes.
# Poll `GET /pulls/<n>` until that stops, bounded by `mergeable_wait_seconds`.
wait_mergeable() { # $1 = the pull request number
  local number="$1" start now answer code reply mergeable
  start="$(date +%s)"
  while :; do
    answer="$(fleet_curl -sS "https://$GITHUB_INT_HOST/api/v3/repos/$TARGET_REPO/pulls/$number" -w '\n%{http_code}' 2>/dev/null || true)"
    code="$(printf '%s' "$answer" | tail -n 1)"; reply="$(printf '%s' "$answer" | sed '$d')"
    if [ "$code" = 200 ]; then
      mergeable="$(printf '%s' "$reply" | grep -o '"mergeable"[[:space:]]*:[[:space:]]*[a-zA-Z]*' | head -n 1 | sed 's/.*://')"
      [ -n "$mergeable" ] && [ "$mergeable" != null ] && return 0
    fi
    now="$(date +%s)"
    [ "$((now - start))" -ge "$SELF_MERGE_WAIT_SECONDS" ] && return 1
    sleep 1
  done
}
# M3: the merge itself — squash, titled off the plan's own first heading, the SHA this
# clone actually pushed. No `authorization` header: the edge injects the credential.
send_merge() { # $1 = the pull request number; sets MERGE_HTTP_CODE, MERGE_REPLY
  local number="$1" head_sha title payload answer
  head_sha="$(fleet_git -C "$TARGET_DIR" rev-parse HEAD)"
  title="fleet $RUN_ID: $(plan_title) (#$number)"
  payload="{\"merge_method\":\"squash\",\"commit_title\":\"$(json_escape "$title")\",\"sha\":\"$(json_escape "$head_sha")\"}"
  answer="$(fleet_curl -sS -X PUT "https://$GITHUB_INT_HOST/api/v3/repos/$TARGET_REPO/pulls/$number/merge" \
      -H 'content-type: application/json' -d "$payload" -w '\n%{http_code}' 2>/dev/null || true)"
  MERGE_HTTP_CODE="$(printf '%s' "$answer" | tail -n 1)"
  MERGE_REPLY="$(printf '%s' "$answer" | sed '$d')"
}
# M1–M4: the gate was already checked by the caller (green, unheld, enabled). Before every
# send, and again after every 405/409 refusal, re-fetch the default branch and re-fold onto
# it if it moved (M2); wait out a `null` mergeable (M3); then PUT the merge. A 405/409
# repeats, up to `max_refolds` merge requests in all; anything else parks immediately.
maybe_self_merge() { # $1 = the pull request number, $2 = the PR's base branch name
  local number="$1" base_branch="$2" attempts=0 cur_base="$BASE_SHA" tip
  read_self_merge_policy
  [ "$SELF_MERGE_ENABLED" = 1 ] || return 0
  while [ "$attempts" -lt "$SELF_MERGE_MAX_REFOLDS" ]; do
    if fleet_git -C "$TARGET_DIR" fetch origin "refs/heads/$base_branch" 2>/dev/null; then
      tip="$(fleet_git -C "$TARGET_DIR" rev-parse FETCH_HEAD 2>/dev/null || true)"
    else
      tip=""
    fi
    if [ -n "$tip" ] && [ "$tip" != "$cur_base" ]; then
      refold_onto "$cur_base" "$tip" || return 0
      cur_base="$tip"
    fi
    if ! wait_mergeable "$number"; then
      MERGE_PHASE="merge: mergeable wait timed out"; return 0
    fi
    attempts=$(( attempts + 1 ))
    send_merge "$number"
    event_row "$EVIDENCE_DIR/$EVIDENCE_REL/events.jsonl" merge code="${MERGE_HTTP_CODE:-null}" || true
    case "$MERGE_HTTP_CODE" in
      2[0-9][0-9])
        MERGED_SHA="$(printf '%s' "$MERGE_REPLY" | json_field sha)"
        [ -n "$MERGED_SHA" ] || MERGED_SHA="$(fleet_git -C "$TARGET_DIR" rev-parse HEAD)"
        log "merge: PUT /pulls/$number/merge answered $MERGE_HTTP_CODE — merged as $MERGED_SHA"
        return 0 ;;
      405|409)
        log "merge: PUT /pulls/$number/merge answered $MERGE_HTTP_CODE — re-folding and trying again" ;;
      *)
        MERGE_PHASE="merge: PUT /pulls/$number/merge answered ${MERGE_HTTP_CODE:-<none>}"
        log "merge: $MERGE_PHASE"
        return 0 ;;
    esac
  done
  MERGE_PHASE="merge: refused after $SELF_MERGE_MAX_REFOLDS refold attempt(s)"
  log "merge: $MERGE_PHASE"
}
# One POST, one JSON answer, nothing to negotiate. The edge injects the GitHub credential on the way through, so no
# `authorization` header is sent; the status rides as the answer's last line, so a non-2xx is told from a 201 without a
# second request; `html_url` and `login` are read as the FIRST match because GitHub's PR document puts its own ahead of
# the head and base repositories'. A run the engine did not finish green still gets its PR — as a DRAFT: what is
# withheld is the claim that it is ready, and the merge is the operator's act.
# The plan's own listing of the exams it chose not to keep in the pull request:
# every path it names that is a regular file under $TARGET_DIR is copied to the
# evidence tree and removed from the target's working copy, in one commit. A
# listing that errors, prints nothing, or names no such file is a no-op — logged
# once as `exams:` — and the run proceeds exactly as it would without this step.
strip_exams() {
  local listing rc=0 rel dest removed=0
  listing="$(fleet_python3 "$ENGINE_REPO_DIR/skills/ultrapowers/scripts/plan_parse.py" --unguarded "$PLAN_FILE")" || rc=$?
  if [ "$rc" -ne 0 ]; then
    log "exams: plan_parse --unguarded exited $rc — nothing stripped"; return 0; fi
  if [ -z "$listing" ]; then
    log "exams: plan_parse --unguarded printed nothing — nothing stripped"; return 0; fi
  while IFS= read -r rel; do
    [ -n "$rel" ] || continue
    if [ -f "$TARGET_DIR/$rel" ]; then
      dest="$EVIDENCE_DIR/$EVIDENCE_REL/exams/$rel"
      mkdir -p "$(dirname "$dest")"; cp "$TARGET_DIR/$rel" "$dest"
      fleet_git -C "$TARGET_DIR" rm -- "$rel" || fail "exams: git rm $rel in target"
      removed=$((removed + 1))
    fi
  done <<<"$listing"
  if [ "$removed" -eq 0 ]; then
    log "exams: plan_parse --unguarded named no path that is a file under the target"; return 0; fi
  ensure_git_identity "$TARGET_DIR"
  fleet_git -C "$TARGET_DIR" commit -m "$RUN_ID: exams to evidence" || fail "exams: commit in target"
}
publish() { # $1 = the engine's exit code
  local base title draft body payload answer code reply state number phase_text
  local was_bound audit_args audit_line
  strip_exams
  fleet_git -C "$TARGET_DIR" push origin "HEAD:refs/heads/$BRANCH" || fail "publish: pushing $BRANCH was rejected"
  write_status publishing "opening the pull request"; evidence_commit "$RUN_ID: publishing"
  base="$(default_branch)" || fail "publish: cannot read the target's default branch from refs/remotes/origin/HEAD"
  title="fleet $RUN_ID: $(plan_title)"; body="$(pr_body)"
  if [ "$1" = 0 ]; then draft=false; else draft=true; fi
  payload="{\"title\":\"$(json_escape "$title")\",\"head\":\"$(json_escape "$BRANCH")\",\"base\":\"$(json_escape "$base")\",\"body\":\"$(json_escape "$body")\",\"draft\":$draft}"
  answer="$(fleet_curl -sS -X POST "https://$GITHUB_INT_HOST/api/v3/repos/$TARGET_REPO/pulls" -H 'content-type: application/json' -d "$payload" -w '\n%{http_code}' 2>/dev/null || true)"
  code="$(printf '%s' "$answer" | tail -n 1)"; reply="$(printf '%s' "$answer" | sed '$d')"
  case "$code" in 2[0-9][0-9]) : ;; *) log "publish: POST /repos/$TARGET_REPO/pulls answered ${code:-<nothing>}"; fail "${reply:0:2000}" ;; esac
  PR_URL="$(printf '%s' "$reply" | json_field html_url)"; PR_AUTHOR="$(printf '%s' "$reply" | json_field login)"
  number="$(printf '%s' "$reply" | json_int number)"
  log "publish: $PR_URL (base $base, draft $draft, author ${PR_AUTHOR:-<unknown>})"
  event_row "$EVIDENCE_DIR/$EVIDENCE_REL/events.jsonl" publish:pr url="$PR_URL" number="${number:-null}" draft="$draft"
  if [ "$1" = 0 ]; then state=done; else state=parked; fi
  # M1: only a green, unheld run even asks whether self-merge is on. A held or non-green
  # run — or one with no PR number to act on — publishes exactly as before: no merge request.
  MERGED_SHA=""; MERGE_PHASE=""
  if [ "$1" = 0 ] && [ "$HOLD_FLAG" != 1 ] && [ -n "$number" ]; then
    maybe_self_merge "$number" "$base"
  fi
  if [ -n "$MERGED_SHA" ]; then
    phase_text="the pull request was merged"
  elif [ -n "$MERGE_PHASE" ]; then
    phase_text="$MERGE_PHASE"; state=parked
  else
    phase_text="the pull request is open"
  fi
  write_status "$state" "$phase_text"; evidence_commit "$RUN_ID: $state"
  # M5: the hub close (with the merge commit riding its evidence, once there is one) before
  # the tags — `record_tags` is what a reader takes as "this run is fully recorded". Whether
  # the board was bound is read BEFORE `close_run`, because `close_run` calls `board_down`
  # itself, which clears `BOARD_BOUND`.
  was_bound="$BOARD_BOUND"
  close_run "$state"
  audit_args=(); [ -n "$was_bound" ] && audit_args=(--bound)
  audit_line="$(fleet_node "$ENGINE_REPO_DIR/factory/audit.mjs" "$EVIDENCE_DIR/$EVIDENCE_REL/events.jsonl" "$state" ${audit_args[@]+"${audit_args[@]}"} 2>/dev/null)" || true
  [ -n "${audit_line:-}" ] && printf '%s\n' "$audit_line" >>"$EVIDENCE_DIR/$EVIDENCE_REL/events.jsonl"
  evidence_commit "$RUN_ID: audit"
  record_tags
}
# What a run leaves behind is the two tags; the branches are only where it worked. A tag that does not verify is not a
# failed run — the record still exists on the branches, which is why they are deleted only once the listing agrees.
# Every unhappy path logs one `record:` line and returns 0.
record_tags() {
  local pt="refs/tags/ultra/plan/$RUN_ID" et="refs/tags/ultra/evidence/$RUN_ID" head listing lp le
  head="$(fleet_git -C "$EVIDENCE_DIR" rev-parse HEAD 2>/dev/null || true)"
  [ -n "$head" ] || { log "record: the evidence worktree has no HEAD to tag — both branches kept"; return 0; }
  fleet_git -C "$TARGET_DIR" push origin "$PLAN_SHA:$pt" || { log "record: pushing $pt at $PLAN_SHA was rejected — both branches kept"; return 0; }
  fleet_git -C "$EVIDENCE_DIR" push origin "HEAD:$et" || { log "record: pushing $et at $head was rejected — both branches kept"; return 0; }
  listing="$(fleet_git -C "$TARGET_DIR" ls-remote --tags origin "$pt" "$et" 2>/dev/null || true)"
  lp="$(printf '%s\n' "$listing" | awk -v r="$pt" '$2 == r { print $1 }')"
  le="$(printf '%s\n' "$listing" | awk -v r="$et" '$2 == r { print $1 }')"
  if [ "$lp" != "$PLAN_SHA" ] || [ "$le" != "$head" ]; then
    log "record: origin lists $pt at '${lp:-<nothing>}' and $et at '${le:-<nothing>}', not $PLAN_SHA and $head — $PLAN_BRANCH and $EVIDENCE_BRANCH kept"
    return 0; fi
  fleet_git -C "$TARGET_DIR" push origin --delete "refs/heads/$PLAN_BRANCH" "refs/heads/$EVIDENCE_BRANCH" || { log "record: the tags are on origin but the delete was rejected — both branches kept"; return 0; }
  log "record: $pt at $PLAN_SHA and $et at $head — both branches deleted"
}
# The run issue's close: one POST, after the pull request is open, sent only when
# the run ends done and the plan commit left a kata.json this boot can still read
# a project.id and run.uid out of — a parked or failed run stays open for a
# person, and a hub that refuses the close (or cannot be reached at all) costs the
# run nothing beyond one board: log line (CLAUDE.md: hub writes are never the
# run's failure) — the run's own state and exit code were decided already, and
# stay decided. No `authorization` header: the admin host is where the exe.dev
# edge injects the hub's bearer, and this holds no credential of its own.
# One close, logged whatever the hub answers. $1 = project id, $2 = issue uid, $3 = message, $4 = idempotency
# key, $5 = what it is for the log line, $6 = the evidence entries. Returns 0 on a 2xx and 1 otherwise; never fatal.
close_issue() {
  local payload url answer rc=0 code reply
  payload="{\"actor\":\"sandbox:$RUN_ID\",\"reason\":\"done\",\"message\":\"$(json_escape "$3")\",\"evidence\":[$6],\"retry_protocol\":\"close-v1\"}"
  url="$KATA_ADMIN_URL/api/v1/projects/$1/issues/$2/actions/close"
  answer="$(fleet_curl -sS -X POST "$url" -H 'content-type: application/json' -H "Idempotency-Key: $4" -d "$payload" -w '\n%{http_code}' 2>/dev/null)" || rc=$?
  code="$(printf '%s' "$answer" | tail -n 1)"
  if [ "$rc" -eq 0 ]; then
    case "$code" in 2[0-9][0-9])
      log "board: close answered $code ($5)"
      event_row "$EVIDENCE_DIR/$EVIDENCE_REL/events.jsonl" board:close what="$5" code="$code" || true
      return 0 ;;
    esac
  fi
  reply="$(printf '%s' "$answer" | sed '$d')"
  log "board: closing the $5 issue failed (exit $rc, http ${code:-<none>}) — $(printf '%s' "$reply" | tr '\n' ' ' | cut -c1-500)"
  event_row "$EVIDENCE_DIR/$EVIDENCE_REL/events.jsonl" board:close what="$5" code="${code:-null}" || true
  return 1
}
close_run() { # $1 = the run's final state (done|parked)
  local kata_json ids project_id run_uid message evidence task_id task_uid
  [ "$1" = done ] || return 0
  kata_json="$FLEET_HOME/plans/$RUN_ID.kata.json"
  if [ ! -f "$kata_json" ]; then
    log "board: close skipped — no $kata_json to read"
    event_row "$EVIDENCE_DIR/$EVIDENCE_REL/events.jsonl" board:close what=run code=null skipped="no kata.json to read" || true
    return 0
  fi
  ids="$(kata_ids "$kata_json")" || ids=""
  project_id="$(printf '%s' "$ids" | awk '{ print $1 }')"
  run_uid="$(printf '%s' "$ids" | awk '{ print $2 }')"
  if [ -z "$project_id" ] || [ -z "$run_uid" ]; then
    log "board: close skipped — $kata_json carries no readable project.id/run.uid"
    event_row "$EVIDENCE_DIR/$EVIDENCE_REL/events.jsonl" board:close what=run code=null skipped="no readable project.id/run.uid" || true
    return 0
  fi
  # M5: a merged run's close carries the merge commit beside the pull request entry.
  evidence="{\"type\":\"pr\",\"url\":\"$(json_escape "$PR_URL")\"}"
  [ -n "$MERGED_SHA" ] && evidence="$evidence,{\"type\":\"commit\",\"sha\":\"$(json_escape "$MERGED_SHA")\"}"
  # The spoke leaves first: the three closes measured to work (runs 36, 197 and 37, by hand, 2026-09-21) were
  # sent after `leave`, and a hub-side close under a bound spoke has never been read. `board_down` is idempotent.
  board_down
  # The task issues before the run's: the hub refuses a parent with open children — `409
  # parent_has_open_children` — and nothing else in the factory closes a task issue. A `done` run adopted
  # every task, so every one of them closes `done` on the run's own evidence.
  while read -r task_id task_uid; do
    [ -n "$task_uid" ] || continue
    close_issue "$project_id" "$task_uid" "$RUN_ID task $task_id done: adopted green in the run's pull request — $PR_URL" \
      "$RUN_ID:task:$task_id:close" "task $task_id" "$evidence" || true
  done <<EOF_TASKS
$(kata_task_uids "$kata_json" || true)
EOF_TASKS
  message="$RUN_ID done: $(plan_title) — $PR_URL"
  close_issue "$project_id" "$run_uid" "$message" "$RUN_ID:run:close" "run" "$evidence" || true
}
boot() {
  local comment code head; comment="$(read_assignment)"
  [ -n "$comment" ] || fail "assignment: no comment in FLEET_ASSIGNMENT or at $REFLECTION_URL/comment"
  parse_assignment "$comment"
  VM_NAME="$(fleet_curl -fsS "$REFLECTION_URL/" 2>/dev/null | json_field name || true)"; prepare
  write_status running "the engine is starting"; evidence_commit "$RUN_ID: running"
  engine_deps; auth_status; bearer_probe; board_up; run_engine
  code="$(cat "$DONE_MARKER")"; collect_evidence
  # What decides the outcome is what landed, not how the engine ended: nothing ahead of base is a park when the
  # engine was green and a failure otherwise; anything ahead of base is a pull request — a draft unless the engine
  # was green — whatever ended the engine, the run's deadline included. Either way, a bound spoke leaves once the
  # outcome is settled: after the pull request is opened, or here when there was never anything to publish.
  head="$(fleet_git -C "$TARGET_DIR" rev-parse HEAD 2>/dev/null || true)"
  if [ "$head" = "$BASE_SHA" ]; then
    if [ "$code" != 0 ]; then board_down; fail "engine exit $code" "$code"; fi
    write_status parked "nothing ahead of base"; evidence_commit "$RUN_ID: parked"; record_tags; board_down; exit 0; fi
  publish "$code"; board_down; exit 0
}
case "${1:-}" in
  boot) boot ;;
  kata-ids) kata_ids "${2:-}" ;;
  kata-task-uids) kata_task_uids "${2:-}" ;;
  event-row) shift; event_row "$@" ;;
  *) printf 'usage: boot.sh boot\n' >&2; exit 2 ;;
esac
