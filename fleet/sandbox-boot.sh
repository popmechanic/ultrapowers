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
# From here: clone fleet-runs and the target through exe.dev's edge-injected
# GitHub integrations, run the engine as a transient user SERVICE with the
# Anthropic pair in the ENGINE'S CHILD ENV ONLY, serve the status page from a
# service of its own, commit receipts to `fleet-runs` at every transition, and —
# only when the branch has something to publish — wait for the operator's write
# grant, push, and open the PR.
#
# No orchestrator, no control VM, no token on this box, and no waiting for an
# assignment: the launcher writes the comment and attaches the grants BEFORE it
# starts the unit. Amendment 10 holds: every git and gh command below is this
# script's, never a model's, and the publish window opens only after systemd
# says the engine service is inactive.
#
# IDEMPOTENCE IS A REQUIREMENT, not a nicety: this script can be started again
# on the same box, and re-entering must not re-clone a clone that exists and
# must never re-run an engine that finished — the engine spends real
# subscription money and leaves a branch. The markers are the clones
# themselves, `$FLEET_HOME/.fleet-engine-done`, and the status page.
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
FLEET_RUNS_DIR="$FLEET_HOME/fleet-runs"
TARGET_DIR="$FLEET_HOME/target"
ENGINE_DONE_MARKER="$FLEET_HOME/.fleet-engine-done"
# Set once the assignment is parsed: the bootstrap's content-addressed clone.
ENGINE_REPO_DIR=""

# The literals. They are the contract; nothing here is configurable in
# production because every one of them is also a name somewhere else.
REFLECTION_URL="https://reflection.int.exe.xyz"
NOTIFY_URL="https://notify.int.exe.xyz/"
GITHUB_INT_HOST="github.int.exe.xyz"
FLEET_RUNS_REPO="popmechanic/fleet-runs"
ANTHROPIC_PROXY_URL="https://claude-max.int.exe.xyz"
FLEET_RUNS_BRANCH="${FLEET_RUNS_BRANCH:-main}"

# Poll cadences. The defaults are the contract's; the tests set them to 0 so the
# whole state machine runs in a second.
POLL_SECONDS="${FLEET_POLL_SECONDS:-2}"
STATUS_INTERVAL="${FLEET_STATUS_INTERVAL:-30}"
WRITE_GRANT_TIMEOUT="${FLEET_WRITE_GRANT_TIMEOUT:-86400}"   # 24 h
ENGINE_STOP_TIMEOUT="${FLEET_ENGINE_STOP_TIMEOUT:-300}"     # 5 min for the service to go inactive

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
BRANCH=""
VM_NAME=""
VM_EMAIL=""
STARTED_AT=""
STATE=""
PHASE=""
PR_URL=""
ERROR=""

# --- seams -------------------------------------------------------------------

fleet_curl()       { curl "$@"; }
fleet_git()        { git "$@"; }
fleet_gh()         { GH_HOST="$GITHUB_INT_HOST" gh "$@"; }
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
  local pr_cell="null" err_cell="null" tmp
  [ -n "$PR_URL" ] && pr_cell="\"$(json_escape "$PR_URL")\""
  [ -n "$ERROR" ] && err_cell="\"$(json_escape "$ERROR")\""
  :
  tmp="$STATUS_FILE.tmp.$$"
  cat >"$tmp" <<EOF
{"run":"$(json_escape "$RUN_N")","state":"$(json_escape "$STATE")","phase":"$(json_escape "$PHASE")","pr":$pr_cell,"branch":"$(json_escape "$BRANCH")","vm":"$(json_escape "$VM_NAME")","startedAt":"$STARTED_AT","updatedAt":"$(now_iso)","error":$err_cell}
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
  # Every failure path leaves its account in `fleet-runs`, not only on a status
  # page the janitor is about to delete with the VM. `FAILING` is what keeps
  # `push_evidence`'s own failure from recursing back in here.
  if [ -z "${FAILING:-}" ] && [ -n "$RUN_N" ] && is_clone "$FLEET_RUNS_DIR"; then
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
  # Not fatal: the record of a run is its fleet-runs commits, and a box whose
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
is_target() { printf '%s' "$1" | grep -qE '^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$'; }
is_run_n()  { printf '%s' "$1" | grep -qE '^[A-Za-z0-9][A-Za-z0-9-]*$'; }

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

  RUN_ID="run-$RUN_N"
  BRANCH="ultra/integration-$RUN_ID"
  ENGINE_REPO_DIR="$FLEET_HOME/engines/$ENGINE_SHA"
  log "assignment: $RUN_ID plan=$PLAN_SHA target=$TARGET_REPO base=$BASE_SHA engine=$ENGINE_SHA overlap=${OVERLAP:-<default>} tier=${TIER:-<default>}"
}

# --- clones ------------------------------------------------------------------

is_clone() { [ -e "$1/.git" ]; }

# FIRST, and before anything else can fail: this clone is where a failure gets
# RECORDED. run-65 died at the engine's deps with `runs/65/` never created, so
# the only account of it was a status page on a VM the janitor was about to
# delete.
prepare_fleet_runs() {
  if is_clone "$FLEET_RUNS_DIR"; then
    log "fleet-runs: clone already present"
  else
    fleet_git clone "https://$GITHUB_INT_HOST/$FLEET_RUNS_REPO.git" "$FLEET_RUNS_DIR" \
      || fail "clone: fleet-runs"
  fi
  fleet_git -C "$FLEET_RUNS_DIR" fetch origin || fail "fetch: fleet-runs"

  # RE-ENTRY. A previous attempt committed `runs/<N>/` on top of the plan commit
  # and pushed it, so HEAD has moved and the tree may be dirty; checking the plan
  # sha out over that is how run-66's restart died. HEAD only has to CONTAIN the
  # plan commit — the plan file itself is pinned by the path-scoped checkout
  # below, and that file is the only thing this clone is READ for.
  if fleet_git -C "$FLEET_RUNS_DIR" merge-base --is-ancestor "$PLAN_SHA" HEAD; then
    log "fleet-runs: HEAD already contains $PLAN_SHA"
  elif fleet_git -C "$FLEET_RUNS_DIR" checkout --detach "$PLAN_SHA"; then
    log "fleet-runs: detached at $PLAN_SHA"
  else
    fleet_git -C "$FLEET_RUNS_DIR" checkout --force --detach "$PLAN_SHA" \
      || fail "checkout: fleet-runs at $PLAN_SHA"
  fi

  # `--force` for the PLANS PATH ONLY: the engine runs the plan that was signed
  # at `plan=`, whatever else this clone carries. Nothing ever checks out over
  # `runs/<N>/` — those files are rewritten from the target clone on every pass,
  # so a re-entry can never lose an attempt's evidence to a checkout.
  fleet_git -C "$FLEET_RUNS_DIR" checkout --force "$PLAN_SHA" -- plans \
    || fail "checkout: fleet-runs plans at $PLAN_SHA"
}

clone_target() {
  if is_clone "$TARGET_DIR"; then
    log "target: clone already present"
  else
    local out
    if out="$(fleet_git clone "https://$GITHUB_INT_HOST/$TARGET_REPO.git" "$TARGET_DIR" 2>&1)"; then
      log "target: cloned through $GITHUB_INT_HOST"
    else
      printf '%s\n' "$out" >>"$BOOT_LOG"
      # No `-ro` integration for this target: it may still be a PUBLIC repo, and
      # a public repo needs no grant to READ. Anything but a not-found is a real
      # failure and must not be papered over with a second attempt.
      case "$out" in
        *404*|*"not found"*|*"Not Found"*|*"Repository not found"*)
          log "target: $GITHUB_INT_HOST says not found — trying public github.com"
          fleet_git clone "https://github.com/$TARGET_REPO.git" "$TARGET_DIR" \
            || fail "clone: target $TARGET_REPO (neither $GITHUB_INT_HOST nor github.com)"
          # The push at the end goes through the edge, because the `-rw` grant is
          # what makes it work. So origin is the int URL whichever host answered
          # the read.
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
# Shape-agnostic: `/integrations` is matched on the integration NAME bounded by
# non-name characters, so a list of strings and a list of objects both read the
# same and `…-ro` can never satisfy a test for `…-rw`.

integrations_body() { fleet_curl -fsS "$REFLECTION_URL/integrations" 2>/dev/null || true; }

has_integration() { # $1 = body, $2 = name
  printf '%s' "$1" | grep -qE "(^|[^A-Za-z0-9_-])$2([^A-Za-z0-9_-]|\$)"
}

target_grant_name() { # $1 = ro|rw
  printf 't-%s-%s' "$(printf '%s' "$TARGET_REPO" | tr '/' '-')" "$1"
}

# READINESS IS THE `-rw` GRANT, AND ONLY THAT. The grant tool detaches `-ro`
# before it attaches `-rw`, but whether `-ro` is still listed is the grant
# tool's business — waiting for anything but `-rw` to appear is a way to wait
# forever.
await_write_grant() {
  local attempts n=0 body rw
  rw="$(target_grant_name rw)"
  attempts="$(poll_attempts "$WRITE_GRANT_TIMEOUT")"
  while [ "$n" -lt "$attempts" ]; do
    body="$(integrations_body)"
    if has_integration "$body" "$rw"; then
      log "integrations: $rw attached"
      return 0
    fi
    n=$(( n + 1 ))
    sleep "$POLL_SECONDS"
  done
  return 1
}

# --- the engine --------------------------------------------------------------

run_dir_path() { printf '%s/.claude/ultrapowers/run-%s' "$TARGET_DIR" "$RUN_ID"; }

gate_receipt_path() {
  # The contract's path first. The engine's own gate writes the receipt into its
  # run dir; the copy under `fleet-receipts/` is what survives as a git object.
  local a b
  a="$TARGET_DIR/fleet-receipts/$RUN_ID/gate-receipt.json"
  b="$(run_dir_path)/gate-receipt.json"
  if [ -f "$a" ]; then printf '%s\n' "$a"; elif [ -f "$b" ]; then printf '%s\n' "$b"; fi
}

last_phase() {
  local f
  f="$(run_dir_path)/events.jsonl"
  [ -f "$f" ] || return 0
  grep '"kind":"engine:phase"' "$f" 2>/dev/null | tail -n 1 |
    sed -n 's/.*"phase":"\([^"]*\)".*/\1/p'
}

phase_refresher() {
  local p
  while :; do
    sleep "$STATUS_INTERVAL"
    p="$(last_phase || true)"
    [ -n "$p" ] && write_status running "$p"
  done
}

log_auth_status() {
  local out
  out="$(env ANTHROPIC_BASE_URL="$ANTHROPIC_PROXY_URL" CLAUDE_CODE_OAUTH_TOKEN=placeholder \
    claude auth status 2>&1 || true)"
  log "claude auth status: $(printf '%s' "$out" | tr '\n' ' ')"
  case "$out" in
    *api_key*) fail "claude auth status reports api_key — that bills exe.dev credits, refusing to run" ;;
  esac
  case "$out" in
    *oauth_token*) : ;;
    *) log "claude auth status: no oauth_token line (claude may not be installed) — continuing" ;;
  esac
}

# A transient SERVICE, not a scope: `--wait` hands back the engine's exit code
# and is refused for a scope, `--collect` unloads the unit when it stops so the
# is-active check below reads `inactive` rather than a lingering `failed`, and
# the memory cap bounds the engine alone — ssh, this script and the page keep
# their headroom. A service inherits neither cwd nor environment from here, so
# the cwd is a property and the child's variables ride in its own argv.
run_engine() {
  local code=0 refresher="" knobs=()
  # The two optional knobs as ARRAY elements: `${VAR:+--flag "$VAR"}` splits on
  # whitespace, and an argv this script builds must never depend on a value's
  # shape to stay one word.
  [ -n "$TIER" ] && knobs+=(--tier "$TIER")
  [ -n "$OVERLAP" ] && knobs+=(--overlap "$OVERLAP")
  :
  write_status running "engine starting"
  log_auth_status

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
      node "$ENGINE_REPO_DIR/fleet/run-main.mjs" \
      "$FLEET_RUNS_DIR/plans/$RUN_ID.md" "$RUN_ID" --repo "$TARGET_DIR" \
      ${knobs[@]+"${knobs[@]}"} \
    2>&1 | tee -a "$ENGINE_LOG" >>"$BOOT_LOG"
  # The ENGINE's status, not `tee`'s — a pipeline's exit code is its last
  # command's, and reading it would report every failed run as a success.
  code=${PIPESTATUS[0]}
  kill "$refresher" 2>/dev/null
  wait "$refresher" 2>/dev/null
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

# `awaiting-grant` and `parked` are claims that no model is running. They are
# made only after systemd says so — this check IS Amendment 10 made mechanical.
await_engine_inactive() {
  local attempts n=0 out
  attempts="$(poll_attempts "$ENGINE_STOP_TIMEOUT")"
  while [ "$n" -lt "$attempts" ]; do
    out="$(fleet_systemctl --user is-active "fleet-engine-$RUN_N.service" 2>&1 || true)"
    case "$out" in
      *inactive*|*failed*|*unknown*|*"not found"*|"")
        log "engine: fleet-engine-$RUN_N.service is ${out:-gone} — no model is running"
        return 0 ;;
    esac
    n=$(( n + 1 ))
    sleep "$POLL_SECONDS"
  done
  return 1
}

# --- evidence ----------------------------------------------------------------

collect_evidence() {
  local dest receipt run_dir f
  dest="$FLEET_RUNS_DIR/runs/$RUN_N"
  mkdir -p "$dest"
  receipt="$(gate_receipt_path)"
  [ -n "$receipt" ] && cp "$receipt" "$dest/gate-receipt.json"
  :
  run_dir="$(run_dir_path)"
  for f in report.json events.jsonl receipt.json; do
    [ -f "$run_dir/$f" ] && cp "$run_dir/$f" "$dest/$f"
  done
  # The engine's combined output rides along: it is the only evidence a run that
  # died before writing a receipt produces at all.
  [ -f "$ENGINE_LOG" ] && cp "$ENGINE_LOG" "$dest/engine.log"
  :
  cp "$STATUS_FILE" "$dest/status.json" 2>/dev/null || true
  log "evidence: $(ls "$dest" | tr '\n' ' ')"
}

push_evidence() { # $1 = commit subject
  local n=0
  mkdir -p "$FLEET_RUNS_DIR/runs/$RUN_N"
  fleet_git -C "$FLEET_RUNS_DIR" add -- "runs/$RUN_N" || fail "fleet-runs: add"
  ensure_git_identity
  if ! fleet_git -C "$FLEET_RUNS_DIR" commit -m "$1"; then
    log "fleet-runs: nothing to commit"
  fi
  while :; do
    if fleet_git -C "$FLEET_RUNS_DIR" push origin "HEAD:$FLEET_RUNS_BRANCH"; then
      log "fleet-runs: pushed"
      return 0
    fi
    n=$(( n + 1 ))
    if [ "$n" -ge 5 ]; then fail "fleet-runs: push rejected 5 times"; fi
    log "fleet-runs: push rejected — rebasing (attempt $n)"
    fleet_git -C "$FLEET_RUNS_DIR" pull --rebase origin "$FLEET_RUNS_BRANCH" || true
  done
}

ensure_git_identity() {
  # The golden bakes an identity. A golden that did not still commits — the
  # author line is cosmetic here, since the PUSH is attributed by the integration
  # (`--act-as-user`), not by the commit.
  if [ -z "$(fleet_git -C "$FLEET_RUNS_DIR" config user.email 2>/dev/null || true)" ]; then
    fleet_git -C "$FLEET_RUNS_DIR" config user.email "${VM_EMAIL:-fleet@exe.dev}" || true
    fleet_git -C "$FLEET_RUNS_DIR" config user.name "${VM_NAME:-fleet-$RUN_ID}" || true
  fi
}

gate_verdict() {
  local receipt
  receipt="$(gate_receipt_path)"
  [ -n "$receipt" ] || return 0
  json_field verdict <"$receipt"
}

# --- publish -----------------------------------------------------------------

plan_title() {
  local plan
  plan="$FLEET_RUNS_DIR/plans/$RUN_ID.md"
  [ -f "$plan" ] || return 0
  sed -n 's/^# \(.*\)$/\1/p' "$plan" | head -n 1
}

render_card() { # $1 = outcome; prints the body file's path
  local body dest verdict receipt
  dest="$FLEET_RUNS_DIR/runs/$RUN_N"
  mkdir -p "$dest"
  body="$dest/pr-body.md"
  verdict="$(gate_verdict)"
  receipt="$dest/gate-receipt.json"
  {
    printf '## fleet %s — %s\n\n' "$RUN_ID" "$1"
    printf '| | |\n|---|---|\n'
    printf '| verdict | `%s` |\n' "${verdict:-<no gate receipt>}"
    printf '| target | `%s` at `%s` |\n' "$TARGET_REPO" "$BASE_SHA"
    printf '| engine | `%s` |\n' "$ENGINE_SHA"
    printf '| plan | `%s` at `%s` |\n' "plans/$RUN_ID.md" "$PLAN_SHA"
    printf '| branch | `%s` |\n' "$BRANCH"
    printf '| vm | `%s` |\n\n' "${VM_NAME:-<unknown>}"
    printf '### Checks\n\n'
    if [ -f "$receipt" ]; then
      printf '```json\n'
      cat "$receipt"
      printf '\n```\n\n'
    else
      printf 'No gate receipt was produced.\n\n'
    fi
    printf '### Evidence\n\n'
    printf 'https://github.com/%s/tree/%s/runs/%s/\n\n' "$FLEET_RUNS_REPO" "$FLEET_RUNS_BRANCH" "$RUN_N"
    printf '%s\n' "$(ls "$dest" | sed 's/^/- /')"
  } >"$body"
  printf '%s\n' "$body"
}

publish() { # $1 = outcome (gate-green|parked)
  local body title heading out draft=()
  write_status publishing "pushing $BRANCH"
  fleet_git -C "$TARGET_DIR" push origin "$BRANCH" || fail "publish: push $BRANCH"
  body="$(render_card "$1")"
  heading="$(plan_title)"
  [ -n "$heading" ] || heading="$RUN_ID"
  title="fleet $RUN_ID: $heading"
  # A parked run still gets its PR — as a DRAFT. The operator granted the write;
  # what the gate withheld is the claim that it is ready to merge.
  [ "$1" = "gate-green" ] || draft=(--draft)
  out="$(fleet_gh pr create --repo "$TARGET_REPO" \
    --head "$BRANCH" --title "$title" --body-file "$body" ${draft[@]+"${draft[@]}"})" \
    || fail "publish: gh pr create"
  PR_URL="$(printf '%s' "$out" | grep -oE 'https://[^ ]+' | tail -n 1 || true)"
  [ -n "$PR_URL" ] || PR_URL="$(printf '%s' "$out" | tail -n 1)"
  log "publish: $PR_URL"
}

# --- the two entry points ----------------------------------------------------

do_boot() {
  # Both carried forward from the page a previous attempt left: `startedAt` is
  # the run's clock, and `pr` is the record that makes publishing idempotent —
  # re-reading them here is what stops the first `write_status` of a re-entry
  # from erasing them.
  STARTED_AT="$(read_status_field startedAt)"
  PR_URL="$(read_status_field pr)"
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

  # FIRST of the clones, and deliberately: from here on, `fail` can record what
  # happened in `fleet-runs` instead of only on a status page that dies with
  # the VM.
  prepare_fleet_runs
  clone_target
  check_engine

  if engine_already_ran; then
    log "engine: already finished (marker or gate receipt present) — not re-running"
  else
    run_engine
  fi

  local code outcome verdict ahead
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
    # lands in `fleet-runs/runs/<N>/status.json` is what the grant tool reads —
    # a pushed page still saying `running` would be a lie with a reader.
    # The engine's own last words, in the cell a reader actually opens. Without
    # them "engine exited 1" is the whole account of the run.
    ERROR="engine exited $code
$(engine_tail)"
    write_status failed "engine exit $code"
    collect_evidence
    push_evidence "$RUN_ID: failed (engine exit $code)"
    notify "run-$RUN_N failed" "$TARGET_REPO — engine exited $code"
    exit 1
  fi

  verdict="$(gate_verdict)"
  if [ "$verdict" = "PASS" ]; then outcome="gate-green"; else outcome="parked"; fi
  log "outcome: $outcome (verdict=${verdict:-none})"
  await_engine_inactive || fail "engine: fleet-engine-$RUN_N.service still active after ${ENGINE_STOP_TIMEOUT}s"

  # run-69: a parked run whose every task was blocked has a branch equal to
  # BASE, and GitHub refuses a PR with no commits. Nothing to publish is a
  # parked outcome with its evidence committed — and no grant to wait for, no
  # push, no PR, so the operator is never asked to approve an empty write. A
  # branch git cannot count is likewise nothing to push.
  ahead="$(fleet_git -C "$TARGET_DIR" rev-list --count "$BASE_SHA..$BRANCH" 2>/dev/null || echo 0)"
  if [ "$ahead" = "0" ]; then
    ERROR="parked: $BRANCH has no commits ahead of base (verdict ${verdict:-none})"
    write_status parked "nothing to publish"
    collect_evidence
    push_evidence "$RUN_ID: parked — nothing ahead of base"
    notify "run-$RUN_N parked" "$TARGET_REPO — nothing ahead of base"
    exit 0
  fi

  write_status awaiting-grant "$outcome"
  collect_evidence
  push_evidence "$RUN_ID: $outcome receipts"
  notify "run-$RUN_N $outcome" "$TARGET_REPO — awaiting write grant"

  if ! await_write_grant; then
    ERROR="grant: no $(target_grant_name rw) within ${WRITE_GRANT_TIMEOUT}s"
    write_status parked "awaiting write grant"
    collect_evidence
    push_evidence "$RUN_ID: parked — no write grant"
    notify "run-$RUN_N parked" "$TARGET_REPO — $ERROR"
    exit 1
  fi

  # RE-ENTRY, GUARD 2. The PR is the one step here that is not idempotent by
  # construction, so it is made idempotent by its own record: a status page that
  # already names a PR (read at the top of this function) is the proof that this
  # run published.
  if [ -n "$PR_URL" ]; then
    log "publish: $PR_URL already recorded — not opening a second PR"
  else
    publish "$outcome"
  fi

  if [ "$outcome" = "gate-green" ]; then
    write_status done "$PR_URL"
  else
    ERROR="parked: gate verdict ${verdict:-none}"
    write_status parked "$PR_URL"
  fi
  collect_evidence
  push_evidence "$RUN_ID: $outcome — $PR_URL"
  notify "run-$RUN_N $STATE" "$TARGET_REPO — $PR_URL"
}

# By hand, for a run that is neither finished nor progressing: park the page
# and stop the engine's service. Nothing on the golden arms this — the
# `claude-max` attachment expires with its `--for`, and the janitor reads
# fleet-runs — so it is a tool for an operator on the box, not a timer.
do_deadman() {
  RUN_N="$(read_status_field run)"
  [ -n "$RUN_N" ] && RUN_ID="run-$RUN_N" && BRANCH="ultra/integration-$RUN_ID"
  :
  STARTED_AT="$(read_status_field startedAt)"
  VM_NAME="$(read_status_field vm)"
  local state
  state="$(read_status_field state)"
  case "$state" in
    done|parked|failed)
      log "deadman: already $state — nothing to do"
      exit 0 ;;
  esac
  ERROR="deadman: parked by hand without done"
  write_status parked "deadman"
  notify "run-${RUN_N:-?} parked" "$ERROR"
  if [ -n "$RUN_N" ]; then
    case "$(fleet_systemctl --user is-active "fleet-engine-$RUN_N.service" 2>&1 || true)" in
      active*) fleet_systemctl --user stop "fleet-engine-$RUN_N.service" || true ;;
    esac
  fi
  exit 0
}

MODE="${1:-boot}"
case "$MODE" in
  boot)    do_boot ;;
  deadman) do_deadman ;;
  *) printf 'usage: sandbox-boot.sh [boot|deadman]\n' >&2; exit 2 ;;
esac
