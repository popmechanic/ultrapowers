#!/bin/bash
# factory/boot.sh — the sandbox side of a factory run: clones the target, takes the
# plan off `ultra/plan-run-<N>`, proves the credential through `factory/preflight.mjs`,
# runs `factory/engine.mjs` as a transient user service while keeping the record on
# `ultra/evidence-run-<N>`, then publishes, merges and tags. Every external program
# goes through a `fleet_*` wrapper and every path hangs off `$FLEET_HOME`, so the exam
# drives this against stubs.
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
# KATA_SERVER rides every call the boot itself makes: the daemon it is talking to is always the one it just started, on localhost.
fleet_kata() { env "KATA_SERVER=$KATA_URL" kata "$@"; }
log() {
  local line; line="$(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; mkdir -p "$FLEET_HOME"
  printf '%s\n' "$line" >>"$BOOT_LOG"; printf '%s\n' "$line" >&2
}
now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }
# Milliseconds since the epoch. `date +%N` is GNU-only (macOS prints a literal
# `3N`), and python3 is on every fleet VM and on the laptop bridge's PATH.
now_ms() { fleet_python3 -c 'import time; print(int(time.time() * 1000))'; }
# `bounded_run <seconds> <command>`: the command under `bash -lc`, killed after
# the budget, exit 124 then — the shape coreutils' `timeout` has, without the
# binary, which macOS lacks and the bridge's PATH never carries (hotfix on
# run-230, 2026-09-23: the publish sim died on `timeout: command not found`).
bounded_run() {
  local secs="$1" cmd="$2" pid watchdog rc
  bash -lc "$cmd" & pid=$!
  ( sleep "$secs"; kill "$pid" 2>/dev/null ) & watchdog=$!
  wait "$pid" 2>/dev/null; rc=$?
  kill "$watchdog" 2>/dev/null; wait "$watchdog" 2>/dev/null || true
  if [ "$rc" -eq 143 ] || [ "$rc" -eq 137 ]; then rc=124; fi
  return "$rc"
}
# No jq: every value read is one flat field of a small document, and an ABSENT field is an answer, not an error; both take the field in $1, the document on stdin.
json_field() { { grep -o "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" || true; } | head -n 1 | sed 's/.*:[[:space:]]*"\(.*\)"$/\1/'; }
json_int()   { { grep -o "\"$1\"[[:space:]]*:[[:space:]]*-\?[0-9]\+" || true; } | head -n 1 | sed 's/.*[:[:space:]]//'; }
# The one writer for every end-of-run row (#1167): one JSON object, one line, appended to
# `<file>` (created if it does not exist). $1 = file, $2 = kind, then any number of
# `key=value` pairs, each written in argument order — `factory/record.mjs row` renders the
# line, `ts` included.
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
# The clone is left AT BASE, the plan checked against the assignment's `plan=` before a model reads a word of it, and the evidence branch a DETACHED WORKTREE OF THE TARGET CLONE so its receipts land on the target and nowhere else.
prepare() {
  local landed at
  [ -e "$TARGET_DIR/.git" ] || fleet_git clone "https://$GITHUB_INT_HOST/$TARGET_REPO.git" "$TARGET_DIR" || fail "clone: target $TARGET_REPO through $GITHUB_INT_HOST"
  fleet_git -C "$TARGET_DIR" checkout "$BASE_SHA" || fail "checkout: target at $BASE_SHA"
  fleet_git -C "$TARGET_DIR" fetch origin "refs/heads/$PLAN_BRANCH" || fail "plan: cannot fetch $PLAN_BRANCH from $TARGET_REPO"
  landed="$(fleet_git -C "$TARGET_DIR" rev-parse FETCH_HEAD 2>/dev/null || true)"
  [ "$landed" = "$PLAN_SHA" ] || fail "plan: $PLAN_BRANCH is at '${landed:-<nothing>}', not the plan=$PLAN_SHA this run was assigned"
  mkdir -p "$FLEET_HOME/plans"; fleet_git -C "$TARGET_DIR" show "$PLAN_SHA:$PLAN_BLOB_PATH" >"$PLAN_FILE" || fail "plan: $PLAN_SHA carries no $PLAN_BLOB_PATH"
  log "plan: $PLAN_BRANCH at $PLAN_SHA -> $PLAN_FILE"
  [ -e "$EVIDENCE_DIR/.git" ] && { EVIDENCE_READY=1; return 0; }
  if fleet_git -C "$TARGET_DIR" fetch origin "refs/heads/$EVIDENCE_BRANCH" 2>/dev/null; then at=FETCH_HEAD; else at="$PLAN_SHA"; fi
  fleet_git -C "$TARGET_DIR" worktree add --detach "$EVIDENCE_DIR" "$at" || fail "evidence: worktree add $EVIDENCE_DIR at $at"
  EVIDENCE_READY=1; log "evidence: worktree at $at"
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
# The named files the engine left, copied beside the page — never `git add -A`, since the engine's clones live under the run directory and none of them is evidence.
collect_evidence() {
  mkdir -p "$EVIDENCE_DIR/$EVIDENCE_REL"
  [ -f "$RUN_DIR/events.jsonl" ] && cp "$RUN_DIR/events.jsonl" "$EVIDENCE_DIR/$EVIDENCE_REL/events.jsonl"
  [ -f "$ENGINE_LOG" ] && cp "$ENGINE_LOG" "$EVIDENCE_DIR/$EVIDENCE_REL/engine.log"
  return 0
}
evidence_commit() { # $1 = commit subject
  local p n=0 paths=()
  for p in status.json events.jsonl engine.log publish.json publish-deploy.log publish-verify.log publish-rollback.log; do
    if [ -f "$EVIDENCE_DIR/$EVIDENCE_REL/$p" ]; then paths+=("$EVIDENCE_REL/$p"); fi
  done
  [ "${#paths[@]}" -gt 0 ] || return 0
  # `-f`: the evidence worktree is a worktree of the TARGET, whose own
  # `.gitignore` may ignore `*.log` — tinyapp-fixture's does, and run-38 and
  # run-39 tagged no engine.log and no publish-deploy.log (2026-09-24). The
  # record is the run's, not the target's, so its files are added whatever
  # the target ignores.
  fleet_git -C "$EVIDENCE_DIR" add -f -- "${paths[@]}" || log "evidence: add refused"
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
# The credential probe lives in `factory/preflight.mjs` now: it classifies (one printed line), this
# only decides — `api_key`/`no_oauth` bill exe.dev credits or mean the box is off the claude-max
# subscription, `bearer_dead`/`edge_refused` name a credential or edge that refused, and `alive` and
# `inconclusive` both proceed (a probe that parked a run on a flake would cost more than it saved).
preflight() {
  local line
  line="$(fleet_node "$ENGINE_REPO_DIR/factory/preflight.mjs" --proxy "$ANTHROPIC_PROXY_URL")"
  log "preflight: $line"
  case "$line" in
    api_key*) fail "claude auth status reports api_key — that bills exe.dev credits, refusing to run" ;;
    no_oauth*) fail "claude auth status shows no oauth_token — this box is not on the claude-max subscription, refusing to run" ;;
    bearer_dead*) fail "bearer probe: the credential was refused — ${line#bearer_dead }" ;;
    edge_refused*) fail "bearer probe: the edge refused — ${line#edge_refused }" ;;
    alive*|inconclusive*) : ;;
  esac
}
# One sandbox, one spoke: installs kata, then hands the rest — the spoke's config, the
# bound-wait — to `board.mjs`, the one module that talks to Kata; every miss along the
# way is one `board:` log line and a return 0 with BOARD_BOUND left empty, which is
# `run_engine`'s whole signal.
board_up() {
  local blob kata_bin out local_id
  BOARD_UNIT="fleet-kata-$RUN_N"
  blob="$(fleet_git -C "$TARGET_DIR" show "$PLAN_SHA:$KATA_BLOB_PATH" 2>/dev/null || true)"
  [ -n "$blob" ] || { log "board: no $KATA_BLOB_PATH at $PLAN_SHA — the run proceeds without a spoke"; return 0; }
  mkdir -p "$FLEET_HOME/plans"; BOARD_KATA_JSON="$FLEET_HOME/plans/$RUN_ID.kata.json"
  printf '%s' "$blob" >"$BOARD_KATA_JSON"
  if ! kata_bin="$(fleet_node "$ENGINE_REPO_DIR/factory/board.mjs" install --version "$KATA_VERSION" --release-base "$KATA_RELEASE_BASE" --home "$FLEET_HOME")"
  then log "board: installing kata $KATA_VERSION failed — proceeding without a spoke"; return 0; fi
  PATH="$(dirname "$kata_bin"):$PATH"
  # The one kata on a sandbox (#1190): nothing system-wide sits behind this PATH entry.
  command -v kata >/dev/null 2>&1 || { log "board: kata $KATA_VERSION installed but not on PATH — proceeding without a spoke"; return 0; }
  log "board: kata $KATA_VERSION installed at $(command -v kata)"
  if ! out="$(fleet_node "$ENGINE_REPO_DIR/factory/board.mjs" spoke-config --kata-json "$BOARD_KATA_JSON" --engine-dir "$ENGINE_REPO_DIR" --home "$FLEET_HOME" 2>&1)"
  then log "board: spoke-config failed — proceeding without a spoke — $(printf '%s' "$out" | tr '\n' ' ' | cut -c1-300)"; return 0; fi
  BOARD_PROJECT_NAME="$(printf '%s' "$out" | awk '{ print $1 }')"; BOARD_PROJECT_ID="$(printf '%s' "$out" | awk '{ print $2 }')"
  if ! fleet_systemd_run --user "--unit=$BOARD_UNIT" -p "WorkingDirectory=$FLEET_HOME/kata" -- \
      env "KATA_HOME=$FLEET_HOME/kata" "PATH=$PATH" kata daemon start --foreground
  then log "board: systemd-run could not start $BOARD_UNIT — proceeding without a spoke"; return 0; fi
  if ! local_id="$(fleet_node "$ENGINE_REPO_DIR/factory/board.mjs" wait --project "$BOARD_PROJECT_NAME" --kata-json "$BOARD_KATA_JSON" --kata-url "$KATA_URL" --seconds "$FLEET_KATA_WAIT_SECONDS")"
  then log "board: $BOARD_PROJECT_NAME was not bound with the run's issues pulled within ${FLEET_KATA_WAIT_SECONDS}s"; return 0; fi
  BOARD_BOUND=1
  [ -n "$local_id" ] && BOARD_PROJECT_ID="$local_id"
  log "kata federation status: $BOARD_PROJECT_NAME is bound as local project $BOARD_PROJECT_ID, and the run's issues have arrived"
}
# The teardown side: a bound spoke leaves the hub and its unit stops; a `leave` that fails is logged and nothing else, since the run's own state and exit code were already decided.
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
# A transient SERVICE, not a scope: `--wait` hands back the exit code and `--collect` unloads the unit; while it runs, the boot relays events every FLEET_COMMIT_SECONDS.
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
# M2: on a moved default branch, hand the target to the sibling re-fold entry and, once it says every exam ran green there, force-push the target's new HEAD over the run's own branch — any other exit leaves the target untouched and sets MERGE_PHASE.
refold_onto() { # $1 = the base the run's work stood on, $2 = the moved tip
  local base="$1" onto="$2" line rc=0 reason
  line="$(env -u CLAUDE_CONFIG_DIR "ANTHROPIC_BASE_URL=$ANTHROPIC_PROXY_URL" \
      "TYPESAFE_BASE_URL=$TYPESAFE_PROXY_URL" CLAUDE_CODE_OAUTH_TOKEN=placeholder \
      "ULTRAPOWERS_FLEET_RUN=$RUN_ID" node "$ENGINE_REPO_DIR/factory/engine.mjs" --refold \
      --plan "$PLAN_FILE" --target "$TARGET_DIR" --base "$base" --onto "$onto" \
      --run-dir "$RUN_DIR" | tail -n 1)" || rc=$?
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
# M1–M4: the gate was already checked by the caller (green, unheld, enabled). Before every send, and again after
# every 405/409 refusal, re-fetch the default branch and re-fold onto it if it moved (M2); wait out a `null`
# mergeable, GitHub's answer for a few seconds after a push while it recomputes (M3); then PUT the squash merge,
# titled off the plan's own first heading, the SHA this clone actually pushed (no `authorization` header — the
# edge injects the credential). A 405/409 repeats, up to `max_refolds` merge requests in all; anything else parks.
maybe_self_merge() { # $1 = the pull request number, $2 = the PR's base branch name
  local number="$1" base_branch="$2" attempts=0 cur_base="$BASE_SHA" tip
  local start now answer code reply mergeable head_sha title payload merge_code merge_reply
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
    mergeable=""; start="$(date +%s)"
    while :; do
      answer="$(fleet_curl -sS "https://$GITHUB_INT_HOST/api/v3/repos/$TARGET_REPO/pulls/$number" -w '\n%{http_code}' 2>/dev/null || true)"
      code="$(printf '%s' "$answer" | tail -n 1)"; reply="$(printf '%s' "$answer" | sed '$d')"
      if [ "$code" = 200 ]; then
        mergeable="$(printf '%s' "$reply" | grep -o '"mergeable"[[:space:]]*:[[:space:]]*[a-zA-Z]*' | head -n 1 | sed 's/.*://')"
        [ -n "$mergeable" ] && [ "$mergeable" != null ] && break
        mergeable=""
      fi
      now="$(date +%s)"
      if [ "$((now - start))" -ge "$SELF_MERGE_WAIT_SECONDS" ]; then
        MERGE_PHASE="merge: mergeable wait timed out"; return 0
      fi
      sleep 1
    done
    attempts=$(( attempts + 1 ))
    head_sha="$(fleet_git -C "$TARGET_DIR" rev-parse HEAD)"
    title="fleet $RUN_ID: $(plan_title) (#$number)"
    payload="$(fleet_node "$ENGINE_REPO_DIR/factory/record.mjs" merge-payload title="$title" sha="$head_sha")"
    answer="$(fleet_curl -sS -X PUT "https://$GITHUB_INT_HOST/api/v3/repos/$TARGET_REPO/pulls/$number/merge" \
        -H 'content-type: application/json' -d "$payload" -w '\n%{http_code}' 2>/dev/null || true)"
    merge_code="$(printf '%s' "$answer" | tail -n 1)"; merge_reply="$(printf '%s' "$answer" | sed '$d')"
    event_row "$EVIDENCE_DIR/$EVIDENCE_REL/events.jsonl" merge code="${merge_code:-null}" || true
    case "$merge_code" in
      2[0-9][0-9])
        MERGED_SHA="$(printf '%s' "$merge_reply" | json_field sha)"
        [ -n "$MERGED_SHA" ] || MERGED_SHA="$(fleet_git -C "$TARGET_DIR" rev-parse HEAD)"
        log "merge: PUT /pulls/$number/merge answered $merge_code — merged as $MERGED_SHA"
        return 0 ;;
      405|409)
        log "merge: PUT /pulls/$number/merge answered $merge_code — re-folding and trying again" ;;
      *)
        MERGE_PHASE="merge: PUT /pulls/$number/merge answered ${merge_code:-<none>}"
        log "merge: $MERGE_PHASE"
        return 0 ;;
    esac
  done
  MERGE_PHASE="merge: refused after $SELF_MERGE_MAX_REFOLDS refold attempt(s)"
  log "merge: $MERGE_PHASE"
}
# #835: the deploy the self-merge earned, read live, rolled back once on red. Only
# called once MERGED_SHA is non-empty. PUBLISH_PHASE stays empty — the caller keeps
# the plain "the pull request was merged" phase — when the plan named no
# `**Publish:**` line or `publish.probe.enabled` is off; either way that is never a
# failure of the run. The plan's publish object is `plan_parse.py`'s own, read once
# here (never grepped off the plan text) and its three commands handed to
# `record.mjs publish-cmds`, one per line, an absent command an empty line.
PUBLISH_PHASE=""
run_publish_probe() {
  PUBLISH_PHASE=""
  local parsed cmds deploy_cmd verify_cmd rollback_cmd policy_out enabled timeout_seconds
  parsed="$(fleet_python3 "$ENGINE_REPO_DIR/skills/ultrapowers/scripts/plan_parse.py" "$PLAN_FILE" 2>/dev/null)" || parsed=""
  [ -n "$parsed" ] || return 0
  cmds="$(printf '%s' "$parsed" | fleet_node "$ENGINE_REPO_DIR/factory/record.mjs" publish-cmds)" || return 0
  deploy_cmd="$(printf '%s\n' "$cmds" | sed -n '1p')"
  verify_cmd="$(printf '%s\n' "$cmds" | sed -n '2p')"
  rollback_cmd="$(printf '%s\n' "$cmds" | sed -n '3p')"
  [ -n "$deploy_cmd" ] || return 0
  policy_out="$(fleet_node "$ENGINE_REPO_DIR/factory/record.mjs" publish-policy "$ENGINE_REPO_DIR/factory/policy.json" 2>/dev/null)" || policy_out="0 600"
  set -- $policy_out
  enabled="${1:-0}"; timeout_seconds="${2:-600}"
  [ "$enabled" = 1 ] || return 0

  local pub_dir="$EVIDENCE_DIR/$EVIDENCE_REL"
  mkdir -p "$pub_dir" "$RUN_DIR"
  local deploy_raw="$RUN_DIR/.publish-deploy-raw.log" deploy_log="$pub_dir/publish-deploy.log"
  local verify_raw="$RUN_DIR/.publish-verify-raw.log" verify_log="$pub_dir/publish-verify.log"
  local rollback_raw="$RUN_DIR/.publish-rollback-raw.log" rollback_log="$pub_dir/publish-rollback.log"
  local start_ms end_ms deploy_exit deploy_ms verify_exit verify_ms rollback_exit url json_args

  start_ms="$(now_ms)"
  if (cd "$TARGET_DIR" && CLOUDFLARE_API_BASE_URL="https://cloudflare.int.exe.xyz/client/v4" CLOUDFLARE_API_TOKEN="placeholder" \
      bounded_run "$timeout_seconds" "$deploy_cmd") >"$deploy_raw" 2>&1
  then deploy_exit=0; else deploy_exit=$?; fi
  end_ms="$(now_ms)"; deploy_ms=$(( end_ms - start_ms ))
  url="$(grep -oE 'https://[A-Za-z0-9.-]*\.workers\.dev' "$deploy_raw" | head -n 1 || true)"
  tail -c 4000 "$deploy_raw" >"$deploy_log"; rm -f "$deploy_raw"
  event_row "$EVIDENCE_DIR/$EVIDENCE_REL/events.jsonl" publish:deploy cmd="$deploy_cmd" exit="$deploy_exit" ms="$deploy_ms" url="${url:-null}"

  if [ "$deploy_exit" != 0 ] || [ -z "$url" ]; then
    json_args=(url="${url:-null}" published=false deployCmd="$deploy_cmd" deployExit="$deploy_exit" deployMs="$deploy_ms")
    fleet_node "$ENGINE_REPO_DIR/factory/record.mjs" publish-json "${json_args[@]}" >"$pub_dir/publish.json"
    PUBLISH_PHASE="the pull request was merged; the deploy failed"
    return 0
  fi

  start_ms="$(now_ms)"
  if (cd "$TARGET_DIR" && CLOUDFLARE_API_BASE_URL="https://cloudflare.int.exe.xyz/client/v4" CLOUDFLARE_API_TOKEN="placeholder" \
      ULTRA_PUBLISH_URL="$url" bounded_run "$timeout_seconds" "$verify_cmd") >"$verify_raw" 2>&1
  then verify_exit=0; else verify_exit=$?; fi
  end_ms="$(now_ms)"; verify_ms=$(( end_ms - start_ms ))
  tail -c 4000 "$verify_raw" >"$verify_log"; rm -f "$verify_raw"
  event_row "$EVIDENCE_DIR/$EVIDENCE_REL/events.jsonl" publish:verify cmd="$verify_cmd" exit="$verify_exit" ms="$verify_ms" url="$url"

  if [ "$verify_exit" = 0 ]; then
    json_args=(url="$url" published=true deployCmd="$deploy_cmd" deployExit="$deploy_exit" deployMs="$deploy_ms" \
      verifyCmd="$verify_cmd" verifyExit="$verify_exit" verifyMs="$verify_ms")
    fleet_node "$ENGINE_REPO_DIR/factory/record.mjs" publish-json "${json_args[@]}" >"$pub_dir/publish.json"
    PUBLISH_PHASE="the pull request was merged and the app is published"
    return 0
  fi

  if [ -z "$rollback_cmd" ]; then
    json_args=(url="$url" published=false deployCmd="$deploy_cmd" deployExit="$deploy_exit" deployMs="$deploy_ms" \
      verifyCmd="$verify_cmd" verifyExit="$verify_exit" verifyMs="$verify_ms")
    fleet_node "$ENGINE_REPO_DIR/factory/record.mjs" publish-json "${json_args[@]}" >"$pub_dir/publish.json"
    PUBLISH_PHASE="the pull request was merged; the live check was red and no rollback was named"
    return 0
  fi

  if (cd "$TARGET_DIR" && CLOUDFLARE_API_BASE_URL="https://cloudflare.int.exe.xyz/client/v4" CLOUDFLARE_API_TOKEN="placeholder" \
      bounded_run "$timeout_seconds" "$rollback_cmd") >"$rollback_raw" 2>&1
  then rollback_exit=0; else rollback_exit=$?; fi
  tail -c 4000 "$rollback_raw" >"$rollback_log"; rm -f "$rollback_raw"
  event_row "$EVIDENCE_DIR/$EVIDENCE_REL/events.jsonl" publish:rollback cmd="$rollback_cmd" exit="$rollback_exit"

  json_args=(url="$url" published=false deployCmd="$deploy_cmd" deployExit="$deploy_exit" deployMs="$deploy_ms" \
    verifyCmd="$verify_cmd" verifyExit="$verify_exit" verifyMs="$verify_ms" \
    rollbackCmd="$rollback_cmd" rollbackExit="$rollback_exit")
  fleet_node "$ENGINE_REPO_DIR/factory/record.mjs" publish-json "${json_args[@]}" >"$pub_dir/publish.json"
  PUBLISH_PHASE="the pull request was merged; the live check was red and the deploy was rolled back"
}
# One POST, one JSON answer: the status rides as the answer's last line, and a run the engine did not finish green still gets its PR — as a DRAFT, since the merge is the operator's act.
publish() { # $1 = the engine's exit code
  local base title draft body payload answer code reply state number phase_text
  local was_bound audit_args audit_line
  fleet_git -C "$TARGET_DIR" push origin "HEAD:refs/heads/$BRANCH" || fail "publish: pushing $BRANCH was rejected"
  write_status publishing "opening the pull request"; evidence_commit "$RUN_ID: publishing"
  base="$(default_branch)" || fail "publish: cannot read the target's default branch from refs/remotes/origin/HEAD"
  title="fleet $RUN_ID: $(plan_title)"; body="$(pr_body)"
  if [ "$1" = 0 ]; then draft=false; else draft=true; fi
  payload="$(fleet_node "$ENGINE_REPO_DIR/factory/record.mjs" pr-payload title="$title" head="$BRANCH" base="$base" body="$body" draft="$draft")"
  answer="$(fleet_curl -sS -X POST "https://$GITHUB_INT_HOST/api/v3/repos/$TARGET_REPO/pulls" -H 'content-type: application/json' -d "$payload" -w '\n%{http_code}' 2>/dev/null || true)"
  code="$(printf '%s' "$answer" | tail -n 1)"; reply="$(printf '%s' "$answer" | sed '$d')"
  case "$code" in 2[0-9][0-9]) : ;; *) log "publish: POST /repos/$TARGET_REPO/pulls answered ${code:-<nothing>}"; fail "${reply:0:2000}" ;; esac
  PR_URL="$(printf '%s' "$reply" | json_field html_url)"; PR_AUTHOR="$(printf '%s' "$reply" | json_field login)"
  number="$(printf '%s' "$reply" | json_int number)"
  log "publish: $PR_URL (base $base, draft $draft, author ${PR_AUTHOR:-<unknown>})"
  event_row "$EVIDENCE_DIR/$EVIDENCE_REL/events.jsonl" publish:pr url="$PR_URL" number="${number:-null}" draft="$draft"
  if [ "$1" = 0 ]; then state=done; else state=parked; fi
  MERGED_SHA=""; MERGE_PHASE=""
  if [ "$1" = 0 ] && [ "$HOLD_FLAG" != 1 ] && [ -n "$number" ]; then
    maybe_self_merge "$number" "$base"
  fi
  if [ -n "$MERGED_SHA" ]; then
    phase_text="the pull request was merged"
    run_publish_probe
    [ -n "$PUBLISH_PHASE" ] && phase_text="$PUBLISH_PHASE"
  elif [ -n "$MERGE_PHASE" ]; then
    phase_text="$MERGE_PHASE"; state=parked
  else
    phase_text="the pull request is open"
  fi
  write_status "$state" "$phase_text"; evidence_commit "$RUN_ID: $state"
  was_bound="$BOARD_BOUND"
  close_run "$state"
  audit_args=(); [ -n "$was_bound" ] && audit_args=(--bound)
  audit_line="$(fleet_node "$ENGINE_REPO_DIR/factory/audit.mjs" "$EVIDENCE_DIR/$EVIDENCE_REL/events.jsonl" "$state" ${audit_args[@]+"${audit_args[@]}"} 2>/dev/null)" || true
  [ -n "${audit_line:-}" ] && printf '%s\n' "$audit_line" >>"$EVIDENCE_DIR/$EVIDENCE_REL/events.jsonl"
  evidence_commit "$RUN_ID: audit"
  record_tags
}
# What a run leaves behind is the two tags; the branches are only where it worked, deleted only once the listing agrees — every unhappy path logs one `record:` line and returns 0.
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
# The run's close: the spoke leaves first — the three closes measured to work (runs
# 36, 197 and 37, by hand, 2026-09-21) were sent after `leave`, and `board_down` is
# idempotent — then `board.mjs close-run` itself, the one module that talks to Kata
# and never fails a run (CLAUDE.md).
close_run() { # $1 = the run's final state (done|parked)
  local args
  [ "$1" = done ] || return 0
  board_down
  args=(--kata-json "$FLEET_HOME/plans/$RUN_ID.kata.json" --run "$RUN_ID" --pr "$PR_URL" \
    --admin-url "$KATA_ADMIN_URL" --events "$EVIDENCE_DIR/$EVIDENCE_REL/events.jsonl" --title "$(plan_title)")
  [ -n "$MERGED_SHA" ] && args+=(--merged "$MERGED_SHA")
  fleet_node "$ENGINE_REPO_DIR/factory/board.mjs" close-run "${args[@]}" || true
}
# The one entry point: nothing ahead of base is a park (a failure if the engine wasn't green), anything ahead is a publish — either way a bound spoke leaves once the outcome is settled.
boot() {
  local comment code head; comment="$(read_assignment)"
  [ -n "$comment" ] || fail "assignment: no comment in FLEET_ASSIGNMENT or at $REFLECTION_URL/comment"
  parse_assignment "$comment"
  VM_NAME="$(fleet_curl -fsS "$REFLECTION_URL/" 2>/dev/null | json_field name || true)"; prepare
  write_status running "the engine is starting"; evidence_commit "$RUN_ID: running"
  engine_deps; preflight; board_up; run_engine
  code="$(cat "$DONE_MARKER")"; collect_evidence
  head="$(fleet_git -C "$TARGET_DIR" rev-parse HEAD 2>/dev/null || true)"
  if [ "$head" = "$BASE_SHA" ]; then
    if [ "$code" != 0 ]; then board_down; fail "engine exit $code" "$code"; fi
    write_status parked "nothing ahead of base"; evidence_commit "$RUN_ID: parked"; record_tags; board_down; exit 0; fi
  publish "$code"; board_down; exit 0
}
case "${1:-}" in
  boot) boot ;;
  *) printf 'usage: boot.sh boot\n' >&2; exit 2 ;;
esac
