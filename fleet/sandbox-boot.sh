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
# assignment: the launcher writes the comment and attaches the integrations
# BEFORE it starts the unit. Amendment 10 holds: every git command and every
# GitHub call below is this script's, never a model's, and the push happens
# only after systemd says the engine service is inactive.
#
# THREE BRANCHES, all on the TARGET repository and none of them anywhere else
# (#598): `ultra/plan-run-<N>` carries `.ultrapowers/plan.md` in — the launcher
# pushed it before this VM existed, so the plan this box runs is the one the
# assignment's `plan=` signed; `ultra/integration-run-<N>` is the engine's own,
# and the PR head; `ultra/evidence-run-<N>` is this script's — one commit per
# transition, parented on the plan commit, never merged, linked from the PR
# body. Nothing under `.claude/` is ever committed: that directory is the
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
# Set once the assignment is parsed: the bootstrap's content-addressed clone.
ENGINE_REPO_DIR=""

# The literals. They are the contract; nothing here is configurable in
# production because every one of them is also a name somewhere else.
REFLECTION_URL="https://reflection.int.exe.xyz"
NOTIFY_URL="https://notify.int.exe.xyz/"
GITHUB_INT_HOST="github.int.exe.xyz"
ANTHROPIC_PROXY_URL="https://claude-max.int.exe.xyz"
# The plan's path inside the plan commit's tree, and the run's directory inside
# the evidence commit's. Both are `.ultrapowers/`, never `.claude/`.
PLAN_BLOB_PATH=".ultrapowers/plan.md"
# The gate's verdict record, when the launcher had one to push. The compiler
# refuses a claims-v1 plan without its record beside it (spec §4.5), under the
# name `<plan-stem>.gate-verdicts.json` — so it lands next to the plan under
# that name, and a plan branch without one is a legacy-grammar plan, not a fault.
VERDICTS_BLOB_PATH=".ultrapowers/gate-verdicts.json"

# Poll cadences. The defaults are the contract's; the tests set them to 0 so the
# whole state machine runs in a second.
POLL_SECONDS="${FLEET_POLL_SECONDS:-2}"
STATUS_INTERVAL="${FLEET_STATUS_INTERVAL:-30}"
ENGINE_STOP_TIMEOUT="${FLEET_ENGINE_STOP_TIMEOUT:-300}"     # 5 min for the service to go inactive
PUBLISH_BRANCH_WAIT="${PUBLISH_BRANCH_WAIT:-60}"             # for the pushed branch to show at the edge

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
# The other two of #598's three branches, and the paths that hang off them.
PLAN_BRANCH=""
EVIDENCE_BRANCH=""
EVIDENCE_PATH=""
PLAN_FILE=""
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
  local pr_cell="null" author_cell="null" err_cell="null" tmp
  [ -n "$PR_URL" ] && pr_cell="\"$(json_escape "$PR_URL")\""
  [ -n "$PR_AUTHOR" ] && author_cell="\"$(json_escape "$PR_AUTHOR")\""
  [ -n "$ERROR" ] && err_cell="\"$(json_escape "$ERROR")\""
  :
  tmp="$STATUS_FILE.tmp.$$"
  cat >"$tmp" <<EOF
{"run":"$(json_escape "$RUN_N")","state":"$(json_escape "$STATE")","phase":"$(json_escape "$PHASE")","pr":$pr_cell,"prAuthor":$author_cell,"branch":"$(json_escape "$BRANCH")","vm":"$(json_escape "$VM_NAME")","startedAt":"$STARTED_AT","updatedAt":"$(now_iso)","error":$err_cell}
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
  PLAN_BRANCH="ultra/plan-$RUN_ID"
  EVIDENCE_BRANCH="ultra/evidence-$RUN_ID"
  EVIDENCE_PATH=".ultrapowers/runs/$RUN_N"
  PLAN_FILE="$PLANS_DIR/$RUN_ID.md"
  ENGINE_REPO_DIR="$FLEET_HOME/engines/$ENGINE_SHA"
  log "assignment: $RUN_ID plan=$PLAN_SHA target=$TARGET_REPO base=$BASE_SHA engine=$ENGINE_SHA overlap=${OVERLAP:-<default>} tier=${TIER:-<default>}"
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
  # The contract's path first. The engine's own gate writes the receipt into its
  # run dir; the copy under `fleet-receipts/` is what survives as a git object.
  local a b
  a="$TARGET_DIR/fleet-receipts/$RUN_ID/gate-receipt.json"
  b="$(run_dir_path)/gate-receipt.json"
  if [ -f "$a" ]; then printf '%s\n' "$a"; elif [ -f "$b" ]; then printf '%s\n' "$b"; fi
}

approve_receipt_path() {
  # The two-move rule's second move, written by `run-main.mjs` beside the gate
  # receipt once `ultra_gate.py --approve` has succeeded. The run dir is per run,
  # so an approve receipt found here is this run's; the stamp inside it is the
  # engine's business, not this script's.
  local a b
  a="$TARGET_DIR/fleet-receipts/$RUN_ID/approve-receipt.json"
  b="$(run_dir_path)/approve-receipt.json"
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
      "$PLAN_FILE" "$RUN_ID" --repo "$TARGET_DIR" \
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

# `publishing` and `parked` are claims that no model is running. They are made
# only after systemd says so — this check IS Amendment 10 made mechanical: the
# push and the PR happen after the engine service is inactive, never beside it.
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
  dest="$EVIDENCE_DIR/$EVIDENCE_PATH"
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

# ONE COMMIT PER TRANSITION, and every one of them made and pushed from the
# worktree — the run directory is the only path ever staged, so nothing the
# engine left under `.claude/` can ride along by accident.
push_evidence() { # $1 = commit subject
  local n=0
  mkdir -p "$EVIDENCE_DIR/$EVIDENCE_PATH"
  fleet_git -C "$EVIDENCE_DIR" add -- "$EVIDENCE_PATH" || fail "evidence: add $EVIDENCE_PATH"
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
    if [ "$n" -ge 5 ]; then
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

# --- publish -----------------------------------------------------------------

plan_title() {
  [ -f "$PLAN_FILE" ] || return 0
  sed -n 's/^# \(.*\)$/\1/p' "$PLAN_FILE" | head -n 1
}

render_card() { # $1 = outcome; prints the body file's path
  local body dest verdict receipt
  dest="$EVIDENCE_DIR/$EVIDENCE_PATH"
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
    printf '| plan | `%s` at `%s` |\n' "$PLAN_BLOB_PATH" "$PLAN_SHA"
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
    # Both branches, on the target, spelled as a browser can follow them: the
    # receipts this run wrote, and the plan it was given.
    printf '### Evidence\n\n'
    printf 'https://github.com/%s/tree/%s/%s/\n\n' "$TARGET_REPO" "$EVIDENCE_BRANCH" "$EVIDENCE_PATH"
    printf '%s\n\n' "$(ls "$dest" | sed 's/^/- /')"
    printf '### Plan\n\n'
    printf 'https://github.com/%s/blob/%s/%s\n' "$TARGET_REPO" "$PLAN_BRANCH" "$PLAN_BLOB_PATH"
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
  head="$(fleet_git -C "$TARGET_DIR" rev-parse "$BRANCH" 2>/dev/null || true)"
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

# The PR is opened over GitHub's REST API through the edge, not with `gh`. `gh`
# decides for itself which token to present, and the aggregate host proxies
# only `/repos/<owner>/<repo>/…` — `/user`, which `gh` likes to ask first,
# answers 403 from the edge. One POST, one JSON answer, nothing to negotiate.
publish() { # $1 = outcome (gate-green|parked)
  local body title heading base draft payload answer code reply
  fleet_git -C "$TARGET_DIR" push origin "$BRANCH" || fail "publish: push $BRANCH"
  await_branch_visible
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

  local code outcome verdict approval ahead
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
    collect_evidence
    push_evidence "$RUN_ID: failed (engine exit $code)"
    notify "run-$RUN_N failed" "$TARGET_REPO — engine exited $code"
    exit 1
  fi

  # PASS greens the run on its own. A verdict short of PASS still greens it when
  # the engine's gate approved the run anyway — the two-move rule — and the
  # approve receipt beside the gate receipt is that approval. Throwing it away
  # here would publish a draft the gate had already signed off.
  verdict="$(gate_verdict)"
  approval=""
  if [ "$verdict" = "PASS" ]; then
    outcome="gate-green"
  elif [ -n "$(approve_receipt_path)" ]; then
    outcome="gate-green"
    approval=", approved by the two-move rule"
  else
    outcome="parked"
  fi
  log "outcome: $outcome (verdict=${verdict:-none}$approval)"
  await_engine_inactive || fail "engine: fleet-engine-$RUN_N.service still active after ${ENGINE_STOP_TIMEOUT}s"

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
    collect_evidence
    push_evidence "$RUN_ID: parked — nothing ahead of base"
    notify "run-$RUN_N parked" "$TARGET_REPO — nothing ahead of base"
    exit 0
  fi

  # The receipts are committed BEFORE the push, so a publish that dies leaves
  # its verdict on the evidence branch and not only on this box.
  write_status publishing "$outcome — pushing $BRANCH"
  collect_evidence
  push_evidence "$RUN_ID: $outcome receipts"

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
# the evidence branch — so it is a tool for an operator on the box, not a timer.
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
