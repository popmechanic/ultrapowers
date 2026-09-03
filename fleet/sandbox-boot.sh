#!/usr/bin/env bash
#
# fleet/sandbox-boot.sh — the whole sandbox side of a run.
#
# The golden boots INERT. This script is the run's only driver: it reads its own
# name and its assignment from Reflection, clones what the run needs straight
# from GitHub through exe.dev's edge-injected integrations, runs the engine under
# a systemd scope with the Anthropic credentials in the ENGINE'S CHILD ENV ONLY,
# serves its own status page, commits receipts to `fleet-runs`, waits for the
# operator's write grant, pushes the run branch and opens its own PR.
#
# There is no orchestrator, no control VM and no ssh into this box. The one-way
# trust boundary is the VM `comment`: the tag-scoped key can WRITE it, this
# script can only READ it. The comment is the assignment AND the start signal.
#
# Amendment 10 holds: every git and gh command below is run by this script, never
# by an agent prompt, and the publish window opens only after the engine's scope
# is empty.
#
# IDEMPOTENCE IS A REQUIREMENT, not a nicety: the unit is `Restart=on-failure`,
# so every failure path here is also a re-entry point. Re-entering must not
# re-clone a clone that exists and must never re-run an engine that finished —
# the engine spends real subscription money and leaves a branch. The two markers
# are the clones themselves and `$FLEET_HOME/.fleet-engine-done`.
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
HTTPD_PID_FILE="$WWW_DIR/.httpd.pid"
BOOT_LOG="$FLEET_HOME/fleet-boot.log"
FLEET_RUNS_DIR="$FLEET_HOME/fleet-runs"
TARGET_DIR="$FLEET_HOME/target"
ENGINE_REPO_DIR="$FLEET_HOME/repo"
ENGINE_DONE_MARKER="$FLEET_HOME/.fleet-engine-done"

# The literals. They are the contract; nothing here is configurable in
# production because every one of them is also a name somewhere else.
REFLECTION_URL="https://reflection.int.exe.xyz"
NOTIFY_URL="https://notify.int.exe.xyz/"
GITHUB_INT_HOST="github.int.exe.xyz"
FLEET_RUNS_REPO="popmechanic/fleet-runs"
ENGINE_REPO_URL="https://github.com/popmechanic/ultrapowers.git"
ANTHROPIC_PROXY_URL="https://claude-max.int.exe.xyz"
FLEET_RUNS_BRANCH="${FLEET_RUNS_BRANCH:-main}"

# Poll cadences. The defaults are the contract's; the tests set them to 0 so the
# whole state machine runs in a second.
POLL_SECONDS="${FLEET_POLL_SECONDS:-2}"
STATUS_INTERVAL="${FLEET_STATUS_INTERVAL:-30}"
ASSIGNMENT_TIMEOUT="${FLEET_ASSIGNMENT_TIMEOUT:-21600}"   # 6 h — the deadman's window
CLAUDE_GRANT_TIMEOUT="${FLEET_CLAUDE_GRANT_TIMEOUT:-600}" # 10 min
WRITE_GRANT_TIMEOUT="${FLEET_WRITE_GRANT_TIMEOUT:-86400}" # 24 h
SCOPE_TIMEOUT="${FLEET_SCOPE_TIMEOUT:-300}"               # 5 min for the scope to go inactive

# Run identity, filled by `parse_assignment`. `RUN_N` is the bare number (the
# `runs/<N>/` path and the VM name's tail); `RUN_ID` is `run-<N>` (the engine's
# runId, its run dir and its branch).
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
fleet_busybox()    { busybox "$@"; }
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

json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/	/\\t/g' | tr -d '\n'
}

now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# --- status page -------------------------------------------------------------
#
# One writer, written atomically, and every write is also a log line — which is
# what makes the ORDER of states an observable fact rather than a screenshot of
# the last one.

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
{"run":"$(json_escape "$RUN_N")","state":"$(json_escape "$STATE")","phase":"$(json_escape "$PHASE")","pr":$pr_cell,"branch":"$(json_escape "$BRANCH")","startedAt":"$STARTED_AT","updatedAt":"$(now_iso)","error":$err_cell}
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
  notify "run-${RUN_N:-?} failed" "$1"
  log "FAILED: $1"
  exit 1
}

# --- the status page's own server --------------------------------------------
#
# `-f` (foreground) plus `&` so the process is this script's child and dies with
# the run — the unit that starts this script must therefore outlive it or use
# KillMode=process if the janitor is to read `done` off the page.

start_httpd() {
  mkdir -p "$WWW_DIR"
  if [ -f "$HTTPD_PID_FILE" ] && kill -0 "$(cat "$HTTPD_PID_FILE" 2>/dev/null)" 2>/dev/null; then
    log "httpd: already running"
    return 0
  fi
  # Its own stdio, not this script's: a background job that keeps the inherited
  # pipes open outlives every reader of them.
  fleet_busybox httpd -f -p 8000 -h "$WWW_DIR" >/dev/null 2>>"$BOOT_LOG" &
  printf '%s\n' "$!" >"$HTTPD_PID_FILE"
  log "httpd: started on 8000 serving $WWW_DIR"
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

await_comment() {
  local attempts n=0 comment=""
  attempts="$(poll_attempts "$ASSIGNMENT_TIMEOUT")"
  while [ "$n" -lt "$attempts" ]; do
    comment="$(fleet_curl -fsS "$REFLECTION_URL/comment" 2>/dev/null | json_field comment || true)"
    case "$comment" in
      run=*) printf '%s\n' "$comment"; return 0 ;;
    esac
    n=$(( n + 1 ))
    sleep "$POLL_SECONDS"
  done
  return 1
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

  # A comment written to the wrong VM would run the wrong plan on the wrong
  # target and open a PR nobody asked for. Only checked when this box carries a
  # fleet name at all — a spike VM may be called anything.
  case "$VM_NAME" in
    fleet-run-*)
      [ "$VM_NAME" = "fleet-$RUN_ID" ] || fail "assignment: comment says $RUN_ID but this VM is $VM_NAME"
      ;;
  esac
  log "assignment: $RUN_ID plan=$PLAN_SHA target=$TARGET_REPO base=$BASE_SHA engine=$ENGINE_SHA overlap=${OVERLAP:-<default>} tier=${TIER:-<default>}"
}

# --- clones ------------------------------------------------------------------

is_clone() { [ -e "$1/.git" ]; }

clone_fleet_runs() {
  if is_clone "$FLEET_RUNS_DIR"; then
    log "fleet-runs: clone already present"
  else
    fleet_git clone "https://$GITHUB_INT_HOST/$FLEET_RUNS_REPO.git" "$FLEET_RUNS_DIR" \
      || fail "clone: fleet-runs"
  fi
  fleet_git -C "$FLEET_RUNS_DIR" checkout "$PLAN_SHA" || fail "checkout: fleet-runs at $PLAN_SHA"
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

checkout_engine() {
  if ! is_clone "$ENGINE_REPO_DIR"; then
    # The golden pre-clones it; a golden that did not is still recoverable.
    fleet_git clone "$ENGINE_REPO_URL" "$ENGINE_REPO_DIR" || fail "clone: engine"
  fi
  fleet_git -C "$ENGINE_REPO_DIR" fetch origin "$ENGINE_SHA" || fail "fetch: engine $ENGINE_SHA"
  fleet_git -C "$ENGINE_REPO_DIR" checkout "$ENGINE_SHA" || fail "checkout: engine $ENGINE_SHA"
  # The golden's copy of this script is what systemd started; the engine sha
  # the comment names may carry a newer one. Re-exec from the checkout so a
  # boot-script fix needs no golden rebuild.
  if [ -n "${FLEET_BOOT_REEXEC:-}" ]; then
    :
  elif [ -f "$ENGINE_REPO_DIR/fleet/sandbox-boot.sh" ] && ! cmp -s "$0" "$ENGINE_REPO_DIR/fleet/sandbox-boot.sh"; then
    log "engine: boot script differs at $ENGINE_SHA — re-exec from the checkout"
    FLEET_BOOT_REEXEC=1 exec bash "$ENGINE_REPO_DIR/fleet/sandbox-boot.sh" "$@"
  fi
  # fleet/package.json may declare no dependencies (it does since the lift), in
  # which case npm creates no node_modules and there is nothing to install.
  if [ ! -d "$ENGINE_REPO_DIR/fleet/node_modules" ] && grep -Eq '"(dependencies|devDependencies)"[[:space:]]*:[[:space:]]*\{[[:space:]]*"' "$ENGINE_REPO_DIR/fleet/package.json"; then
    log "engine: fleet/node_modules missing — npm ci (npm install if there is no lockfile)"
    ( cd "$ENGINE_REPO_DIR/fleet" && { fleet_npm ci || fleet_npm install; } ) || fail "npm install: engine deps"
  fi
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

await_claude_grant() {
  local attempts n=0 body
  attempts="$(poll_attempts "$CLAUDE_GRANT_TIMEOUT")"
  while [ "$n" -lt "$attempts" ]; do
    body="$(integrations_body)"
    if has_integration "$body" "claude-max"; then
      log "integrations: claude-max attached"
      return 0
    fi
    n=$(( n + 1 ))
    sleep "$POLL_SECONDS"
  done
  return 1
}

# READINESS IS THE `-rw` GRANT, AND ONLY THAT. The design says never to overlap
# a read-only and a writable grant for one repo, and the operator's approval does
# detach what it can — but the `-ro` integration rides `tag:fleet`, and a tag
# attachment cannot be detached from a single VM. So a `-ro` still listed here is
# the TAG's, not this VM's, and waiting for it to disappear would wait forever.
await_write_grant() {
  local attempts n=0 body ro rw
  ro="$(target_grant_name ro)"
  rw="$(target_grant_name rw)"
  attempts="$(poll_attempts "$WRITE_GRANT_TIMEOUT")"
  while [ "$n" -lt "$attempts" ]; do
    body="$(integrations_body)"
    if has_integration "$body" "$rw"; then
      if has_integration "$body" "$ro"; then
        log "integrations: $rw attached ($ro still listed — the tag's, not this VM's)"
      else
        log "integrations: $rw attached, $ro detached"
      fi
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

run_engine() {
  local code=0 refresher="" knobs=()
  # The two optional knobs as ARRAY elements: `${VAR:+--flag "$VAR"}` splits on
  # whitespace, and an argv this script builds must never depend on a value's
  # shape to stay one word.
  [ -n "$OVERLAP" ] && knobs+=(--overlap "$OVERLAP")
  [ -n "$TIER" ] && knobs+=(--tier "$TIER")
  :
  write_status running "engine starting"
  log_auth_status

  set +e
  # Same reason as httpd's redirect, plus one of its own: killing this loop
  # leaves its in-flight `sleep` behind for up to one interval, and a stray
  # sleep holding this script's stdout would make the run look unfinished to
  # whoever is reading it.
  phase_refresher >/dev/null 2>>"$BOOT_LOG" &
  refresher=$!
  (
    cd "$TARGET_DIR" || exit 1
    fleet_systemd_run --user --scope "--unit=fleet-engine-$RUN_N" \
      -p MemoryMax=40G -p MemorySwapMax=0 --wait --collect \
      env -u CLAUDE_CONFIG_DIR \
        "ANTHROPIC_BASE_URL=$ANTHROPIC_PROXY_URL" \
        "CLAUDE_CODE_OAUTH_TOKEN=placeholder" \
        "ULTRAPOWERS_FLEET_RUN=$RUN_ID" \
        node "$ENGINE_REPO_DIR/fleet/run-main.mjs" \
        "$FLEET_RUNS_DIR/plans/$RUN_ID.md" "$RUN_ID" --repo "$TARGET_DIR" \
        ${knobs[@]+"${knobs[@]}"}
  )
  code=$?
  kill "$refresher" 2>/dev/null
  wait "$refresher" 2>/dev/null
  set -e

  printf '%s\n' "$code" >"$ENGINE_DONE_MARKER"
  log "engine: exited $code"
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

await_scope_inactive() {
  local attempts n=0 out
  attempts="$(poll_attempts "$SCOPE_TIMEOUT")"
  while [ "$n" -lt "$attempts" ]; do
    out="$(fleet_systemctl --user is-active "fleet-engine-$RUN_N.scope" 2>&1 || true)"
    case "$out" in
      *inactive*|*failed*|*unknown*|*"not found"*|"")
        log "scope: fleet-engine-$RUN_N.scope is $out — no model is running"
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
    printf '| branch | `%s` |\n\n' "$BRANCH"
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
  start_httpd
  # RE-ENTRY, GUARD 1. `Restart=on-failure` means every exit below is also a
  # start. A run that already reached `done` has a PR; re-running it would open
  # a second one.
  if [ "$(read_status_field state)" = "done" ]; then
    log "boot: this run is already done — nothing to do"
    exit 0
  fi
  write_status booting "reading the assignment"
  read_identity

  local comment
  comment="$(await_comment)" || fail "assignment: no run= comment within ${ASSIGNMENT_TIMEOUT}s"
  parse_assignment "$comment"
  write_status booting "assignment read"

  clone_fleet_runs
  clone_target
  checkout_engine
  await_claude_grant || fail "integrations: claude-max not attached within ${CLAUDE_GRANT_TIMEOUT}s"

  if engine_already_ran; then
    log "engine: already finished (marker or gate receipt present) — not re-running"
  else
    run_engine
  fi

  local code outcome
  code="$(engine_exit_code)"
  collect_evidence

  if [ "$code" != "0" ]; then
    # The page goes to `failed` BEFORE the push, because the copy of it that
    # lands in `fleet-runs/runs/<N>/status.json` is what the grant tool reads —
    # a pushed page still saying `running` would be a lie with a reader.
    ERROR="engine exited $code"
    write_status failed "engine exit $code"
    collect_evidence
    push_evidence "$RUN_ID: failed (engine exit $code)"
    notify "run-$RUN_N failed" "$TARGET_REPO — engine exited $code"
    exit 1
  fi

  if [ "$(gate_verdict)" = "PASS" ]; then outcome="gate-green"; else outcome="parked"; fi
  log "outcome: $outcome (verdict=$(gate_verdict))"

  # `awaiting-grant` is a claim that no model is running. It is written only
  # after systemd says so — the empty-scope check IS Amendment 10 made
  # mechanical, and writing the state first would make the page lie.
  await_scope_inactive || fail "scope: fleet-engine-$RUN_N.scope still active after ${SCOPE_TIMEOUT}s"
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
    # Non-zero so the unit restarts and resumes at the grant wait: the engine
    # marker and the gate receipt make that re-entry a resumption, not a re-run.
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
    ERROR="parked: gate verdict $(gate_verdict)"
    write_status parked "$PR_URL"
  fi
  collect_evidence
  push_evidence "$RUN_ID: $outcome — $PR_URL"
  notify "run-$RUN_N $STATE" "$TARGET_REPO — $PR_URL"
}

do_deadman() {
  RUN_N="$(read_status_field run)"
  [ -n "$RUN_N" ] && RUN_ID="run-$RUN_N" && BRANCH="ultra/integration-$RUN_ID"
  :
  STARTED_AT="$(read_status_field startedAt)"
  local state
  state="$(read_status_field state)"
  if [ "$state" = "done" ]; then
    log "deadman: already done — nothing to do"
    exit 0
  fi
  ERROR="deadman: 6h without done"
  write_status parked "deadman"
  notify "run-${RUN_N:-?} parked" "deadman: 6h without done"
  if [ -n "$RUN_N" ]; then
    case "$(fleet_systemctl --user is-active "fleet-engine-$RUN_N.scope" 2>&1 || true)" in
      active*) fleet_systemctl --user stop "fleet-engine-$RUN_N.scope" || true ;;
    esac
  fi
  exit 0
}

case "${1:-boot}" in
  boot)    do_boot ;;
  deadman) do_deadman ;;
  *) printf 'usage: sandbox-boot.sh [boot|deadman]\n' >&2; exit 2 ;;
esac
