#!/bin/bash
# factory/boot.sh — the sandbox side of a factory run: clones the target, takes the
# plan off `live/<slug>/run-<N>` of the operator's evidence repository (named in
# `$FLEET_HOME/fleet-evidence-repo`), proves the credential through `factory/preflight.mjs`,
# runs the Flock (`factory/flock/engine.mjs`) as a transient user service while keeping the record in
# `runs/<slug>/<N>/` on that live branch, then publishes and merges, and however the run ends
# leaves one tag `<slug>/run-<N>` there. Nothing but `ultra/integration-run-<N>` is written to the
# target. Every external program goes through a `fleet_*` wrapper and every path hangs off
# `$FLEET_HOME`, so the exam drives this against stubs.
set -euo pipefail
FLEET_HOME="${FLEET_HOME:-/home/exedev}"
REFLECTION_URL="${REFLECTION_URL:-https://reflection.int.exe.xyz}"
ANTHROPIC_PROXY_URL="${ANTHROPIC_PROXY_URL:-https://claude-max.int.exe.xyz}"
TYPESAFE_PROXY_URL="${TYPESAFE_PROXY_URL:-https://typesafe.int.exe.xyz}"
GITHUB_INT_HOST="${GITHUB_INT_HOST:-github.int.exe.xyz}"
# The hub, through the host where the edge injects its bearer: the engine writes the board there, and `board.mjs` closes the run there.
KATA_ADMIN_URL="https://kata.int.exe.xyz"
# The hub's reaper: a merged run whose tag verified asks it, once, to remove this VM (#1470).
REAPER_URL="https://reaper.int.exe.xyz"
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
BRANCH=""; SLUG=""; LIVE_BRANCH=""; EVIDENCE_REPO=""; EVIDENCE_REL=""; PLAN_FILE=""; PLAN_JSON=""; PAST_DIR=""
ENGINE_REPO_DIR=""; STATUS_FILE=""; STATE=""; PHASE=""; PR_URL=""; PR_AUTHOR=""
ERROR=""; VM_NAME=""; STARTED_AT=""; EVIDENCE_READY=""; HOLD_FLAG=0
# RECORDED is 1 once `record_tags` saw the run's tag listed at the pushed head, else empty.
RECORDED=""
# MERGED_SHA is the merge commit `factory/publish.mjs` reported (else empty, which `write_status` renders as `null`).
MERGED_SHA=""
fleet_curl()        { curl "$@"; }
fleet_git()         { git "$@"; }
fleet_npm()         { npm "$@"; }
fleet_systemd_run() { systemd-run "$@"; }
fleet_systemctl()   { systemctl "$@"; }
fleet_python3()     { python3 "$@"; }
fleet_node()        { node "$@"; }
fleet_journalctl()  { journalctl "$@"; }
fleet_sudo()        { sudo -n "$@"; }
# The boot log's stamp, UTC to the millisecond: bash 5's `$EPOCHREALTIME` where it is set
# (the VM), else one python3 call — macOS's /bin/bash 3.2, which the boot sims run, has none.
stamp_ms() {
  if [ -n "${EPOCHREALTIME:-}" ]; then
    local t="${EPOCHREALTIME/,/.}" d; TZ=UTC printf -v d '%(%Y-%m-%dT%H:%M:%S)T' "${t%.*}"
    t="${t#*.}000"; printf '%s.%sZ\n' "$d" "${t:0:3}"
  else python3 -c 'import datetime as d; print(d.datetime.now(d.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:23] + "Z")'; fi
}
log() {
  local line; line="$(stamp_ms) $*"; mkdir -p "$FLEET_HOME"
  printf '%s\n' "$line" >>"$BOOT_LOG"; printf '%s\n' "$line" >&2
}
now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }
# No jq: every value read is one flat field of a small document, and an ABSENT field is an answer, not an error; the field in $1, the document on stdin.
json_field() { { grep -o "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" || true; } | head -n 1 | sed 's/.*:[[:space:]]*"\(.*\)"$/\1/'; }
# The failure account: the page, one evidence commit, one push, the run's tag, out — once there is an evidence clone to write from.
fail() { # $1 = message, $2 = exit code (default 1)
  ERROR="$1"
  # A clone subshell in `prepare` leaves its message to the parent, whose own `fail` logs the one `FAILED:` line.
  [ -n "${PREPARE_CLONE:-}" ] || log "FAILED: $1"
  if [ -n "${EVIDENCE_READY:-}" ] && [ -z "${FAILING:-}" ]; then
    # The hub hears the failure too (#1288): `work.state=failed` on the run issue, so the janitor reaps the VM by its ordinary rule.
    # Marked before the last commit, so the record holds the `board:mark` row (#1392).
    FAILING=1; collect_evidence; write_status failed "$PHASE"; mark_run failed "$ERROR"; evidence_commit "$RUN_ID: failed"; record_tags; fi
  exit "${2:-1}"
}
# `board.mjs mark-run`: `work.state=<state>` on the run issue, which the janitor reaps (#1288), with `work.attention`
# raised on the message and every task labelled needs-review (#1391); it never fails the run.
mark_run() { # $1 = parked|failed, $2 = what the operator reads
  fleet_node "${ENGINE_REPO_DIR:-}/factory/board.mjs" mark-run --kata-json "${FLEET_HOME:-}/plans/${RUN_ID:-}.kata.json" --run "${RUN_ID:-}" --state "$1" \
    --message "${2:-$1}" --evidence "https://github.com/${EVIDENCE_REPO:-}/tree/${SLUG:-}/${RUN_ID:-}/${EVIDENCE_REL:-}" \
    --admin-url "${KATA_ADMIN_URL:-}" --events "${EVIDENCE_DIR:-}/${EVIDENCE_REL:-}/events.jsonl" || true
}
read_assignment() { if [ -n "${FLEET_ASSIGNMENT:-}" ]; then printf '%s\n' "$FLEET_ASSIGNMENT"; else fleet_curl -fsS "$REFLECTION_URL/comment" 2>/dev/null | json_field comment || true; fi; }
is_sha()    { case "$1" in *[!0-9a-f]* | "") return 1 ;; esac; [ "${#1}" -eq 40 ]; }
is_target() { [[ $1 =~ ^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ ]]; }
# `hold` is recorded: `hold=1` is the signal that keeps `publish` from ever sending a merge.
parse_assignment() { # $1 = the comment line
  local tok key val
  ENGINE_KIND=flock
  for tok in $1; do
    key="${tok%%=*}"; val="${tok#*=}"
    case "$key" in
      run) RUN_N="$val" ;; plan) PLAN_SHA="$val" ;; target) TARGET_REPO="$val" ;;
      base) BASE_SHA="$val" ;; engine) ENGINE_SHA="$val" ;;
      kind) case "$val" in flock) ENGINE_KIND="$val" ;;
              factory) fail "assignment: kind=factory is refused: the factory was retired, the Flock is the one engine" ;;
              *) fail "assignment: kind is not flock ('$val')" ;; esac ;;
      hold) [ "$val" = 1 ] && HOLD_FLAG=1 ;;
      *) fail "assignment: unknown key '$key' in comment" ;; esac
  done
  [ -n "$RUN_N" ]          || fail "assignment: no run id in comment"
  is_sha "$PLAN_SHA"       || fail "assignment: plan is not a 40-hex sha ('$PLAN_SHA')"
  is_target "$TARGET_REPO" || fail "assignment: target is not owner/repo ('$TARGET_REPO')"
  is_sha "$BASE_SHA"       || fail "assignment: base is not a 40-hex sha ('$BASE_SHA')"
  is_sha "$ENGINE_SHA"     || fail "assignment: engine is not a 40-hex sha ('$ENGINE_SHA')"
  RUN_ID="run-$RUN_N"; BRANCH="ultra/integration-$RUN_ID"; SLUG="${TARGET_REPO/\//-}"
  LIVE_BRANCH="live/$SLUG/$RUN_ID"; EVIDENCE_REL="runs/$SLUG/$RUN_N"
  PLAN_FILE="$FLEET_HOME/plans/$RUN_ID.md"; PLAN_JSON="$FLEET_HOME/plans/$RUN_ID.plan.json"; ENGINE_REPO_DIR="$FLEET_HOME/engines/$ENGINE_SHA"
  STATUS_FILE="$EVIDENCE_DIR/$EVIDENCE_REL/status.json"
  log "assignment: $RUN_ID target=$TARGET_REPO base=$BASE_SHA engine=$ENGINE_SHA kind=$ENGINE_KIND"
  read_evidence_repo
}
# The operator's evidence repository, one `<owner>/<repo>` line the first-boot setup script wrote; never derived from the target.
read_evidence_repo() {
  local file="$FLEET_HOME/fleet-evidence-repo"
  EVIDENCE_REPO="$({ head -n 1 "$file" 2>/dev/null || true; } | tr -d '[:space:]')"
  is_target "$EVIDENCE_REPO" || fail "evidence: $file is absent or not one owner/repo line ('$EVIDENCE_REPO') — the first-boot setup script writes it"
  log "evidence: $EVIDENCE_REPO (from $file)"
}
# The clone is left AT BASE; the evidence repository is a shallow clone of the run's live branch alone, whose tip on a fresh clone must be the assignment's `plan=` before a model reads a word of the plan.
# The two clones are independent and run side by side: each is a background subshell whose `fail` logs its own message and
# exits only that subshell, leaving the message in a file the parent turns into the boot's own `fail` once `wait` reports it.
# Each trap has its file's path expanded when it is set: under bash 3.2 (macOS) a function's local is gone when an EXIT trap runs.
prepare() {
  local tpid epid err="$FLEET_HOME/.prepare-error"
  mkdir -p "$FLEET_HOME"; rm -f "$err.target" "$err.evidence"
  (
    PREPARE_CLONE=1
    trap '[ -z "$ERROR" ] || printf "%s" "$ERROR" >"'"$err.target"'"' EXIT
    [ -e "$TARGET_DIR/.git" ] || fleet_git clone "https://$GITHUB_INT_HOST/$TARGET_REPO.git" "$TARGET_DIR" || fail "clone: target $TARGET_REPO through $GITHUB_INT_HOST"
    fleet_git -C "$TARGET_DIR" checkout "$BASE_SHA" || fail "checkout: target at $BASE_SHA"
  ) & tpid=$!
  (
    local landed; PREPARE_CLONE=1
    trap '[ -z "$ERROR" ] || printf "%s" "$ERROR" >"'"$err.evidence"'"' EXIT
    if [ ! -e "$EVIDENCE_DIR/.git" ]; then
      fleet_git clone --depth=1 --single-branch --branch "$LIVE_BRANCH" "https://$GITHUB_INT_HOST/$EVIDENCE_REPO.git" "$EVIDENCE_DIR" \
        || fail "plan: cannot clone $LIVE_BRANCH of $EVIDENCE_REPO through $GITHUB_INT_HOST"
      landed="$(fleet_git -C "$EVIDENCE_DIR" rev-parse HEAD 2>/dev/null || true)"
      [ "$landed" = "$PLAN_SHA" ] || fail "plan: $LIVE_BRANCH of $EVIDENCE_REPO is at '${landed:-<nothing>}', not the plan=$PLAN_SHA this run was assigned"
    fi
  ) & epid=$!
  # When both clones failed, the one `fail` names both reasons, the target's first.
  wait "$tpid" || { local terr eerr=""; terr="$(cat "$err.target" 2>/dev/null || true)"
    wait "$epid" || eerr="$(cat "$err.evidence" 2>/dev/null || true)"
    fail "${terr:-clone: target $TARGET_REPO through $GITHUB_INT_HOST}${eerr:+; $eerr}"; }
  wait "$epid" || { ERROR="$(cat "$err.evidence" 2>/dev/null || true)"; fail "${ERROR:-plan: cannot clone $LIVE_BRANCH of $EVIDENCE_REPO through $GITHUB_INT_HOST}"; }
  mkdir -p "$FLEET_HOME/plans"; fleet_git -C "$EVIDENCE_DIR" show "$PLAN_SHA:$EVIDENCE_REL/plan.md" >"$PLAN_FILE" || fail "plan: $PLAN_SHA carries no $EVIDENCE_REL/plan.md"
  EVIDENCE_READY=1; log "plan: $LIVE_BRANCH of $EVIDENCE_REPO at $PLAN_SHA -> $PLAN_FILE"
  # The run's one parse (#1449): the engine, the catch-up, the PR body and the publish probe all read this file.
  fleet_python3 "$ENGINE_REPO_DIR/skills/ultrapowers/scripts/plan_parse.py" "$PLAN_FILE" >"$PLAN_JSON" \
    || fail "plan: plan_parse.py refused $PLAN_FILE"
  # ... and it is the record's too, so a reader sees exactly what the engine read (#1486).
  mkdir -p "$EVIDENCE_DIR/$EVIDENCE_REL"; cp "$PLAN_JSON" "$EVIDENCE_DIR/$EVIDENCE_REL/plan.json"
}
# The previous run's record, for the engine: the highest `<slug>/run-<M>` tag below this run, its run folder
# extracted to `$FLEET_HOME/past/<M>`. Any miss is one `past:` log line and no `--past-dir`.
find_past() {
  local listing ref m best=""
  listing="$(fleet_git -C "$EVIDENCE_DIR" ls-remote --tags origin "refs/tags/$SLUG/run-*" 2>/dev/null)" \
    || { log "past: cannot list $SLUG/run-* tags in $EVIDENCE_REPO — the engine starts with no past"; return 0; }
  while read -r _ ref; do
    m="${ref#refs/tags/$SLUG/run-}"
    case "$m" in *[!0-9]* | "") continue ;; esac
    [ "$m" -lt "$RUN_N" ] 2>/dev/null || continue
    if [ -z "$best" ] || [ "$m" -gt "$best" ]; then best="$m"; fi
  done <<<"$listing"
  [ -n "$best" ] || { log "past: no $SLUG/run-* tag below $RUN_N in $EVIDENCE_REPO — the engine starts with no past"; return 0; }
  fleet_git -C "$EVIDENCE_DIR" fetch --depth=1 origin "refs/tags/$SLUG/run-$best" 2>/dev/null \
    || { log "past: cannot fetch $SLUG/run-$best from $EVIDENCE_REPO — the engine starts with no past"; return 0; }
  rm -rf "$FLEET_HOME/past/$best"; mkdir -p "$FLEET_HOME/past/$best"
  if ! fleet_git -C "$EVIDENCE_DIR" archive --format=tar "FETCH_HEAD:runs/$SLUG/$best" | tar -x -C "$FLEET_HOME/past/$best"
  then log "past: $SLUG/run-$best carries no runs/$SLUG/$best/ — the engine starts with no past"; return 0; fi
  PAST_DIR="$FLEET_HOME/past/$best"; log "past: $SLUG/run-$best -> $PAST_DIR"
}
# One writer, twelve cells, written atomically through `factory/record.mjs status`.
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
# The engine's own evidence files, named once: collect_evidence copies them and evidence_commit adds them.
ENGINE_EVIDENCE=(board.json weave-ops.digest.jsonl snapshots.jsonl red-checks.json past.json provenance.json checks-digest.json)
# The named files the engine left, copied beside the page — never `git add -A`, since the engine's clones live under the run directory and none of them is evidence.
collect_evidence() {
  mkdir -p "$EVIDENCE_DIR/$EVIDENCE_REL"
  [ -f "$RUN_DIR/events.jsonl" ] && cp "$RUN_DIR/events.jsonl" "$EVIDENCE_DIR/$EVIDENCE_REL/events.jsonl"
  [ -f "$ENGINE_LOG" ] && cp "$ENGINE_LOG" "$EVIDENCE_DIR/$EVIDENCE_REL/engine.log"
  [ -f "$RUN_DIR/summary.json" ] && cp "$RUN_DIR/summary.json" "$EVIDENCE_DIR/$EVIDENCE_REL/summary.json"
  local f
  for f in fleet-boot.log fleet-setup.log; do
    [ -f "$FLEET_HOME/$f" ] && cp "$FLEET_HOME/$f" "$EVIDENCE_DIR/$EVIDENCE_REL/$f"
  done
  for f in "${ENGINE_EVIDENCE[@]}"; do
    [ -f "$RUN_DIR/$f" ] && cp "$RUN_DIR/$f" "$EVIDENCE_DIR/$EVIDENCE_REL/$f"
  done
  return 0
}
evidence_commit() { # $1 = commit subject
  local p n=0 paths=()
  # The two logs as they stand now, so a line logged after the engine exits reaches this commit.
  mkdir -p "$EVIDENCE_DIR/$EVIDENCE_REL"
  for p in fleet-boot.log fleet-setup.log; do
    if [ -f "$FLEET_HOME/$p" ]; then cp "$FLEET_HOME/$p" "$EVIDENCE_DIR/$EVIDENCE_REL/$p"; fi
  done
  for p in status.json plan.json events.jsonl engine.log journal.txt fleet-boot.log fleet-setup.log summary.json publish.json publish-deploy.log publish-verify.log publish-rollback.log "${ENGINE_EVIDENCE[@]}"; do
    if [ -f "$EVIDENCE_DIR/$EVIDENCE_REL/$p" ]; then paths+=("$EVIDENCE_REL/$p"); fi
  done
  [ "${#paths[@]}" -gt 0 ] || return 0
  # `-f`: whatever a `.gitignore` says — the target's once ignored `*.log`, and
  # run-38 and run-39 tagged no engine.log and no publish-deploy.log
  # (2026-09-24) — the run's named files are its record and are added.
  fleet_git -C "$EVIDENCE_DIR" add -f -- "${paths[@]}" || log "evidence: add refused"
  fleet_git -C "$EVIDENCE_DIR" commit -m "$1" || log "evidence: nothing to commit"
  while :; do
    if fleet_git -C "$EVIDENCE_DIR" push origin "HEAD:refs/heads/$LIVE_BRANCH"; then return 0; fi
    n=$(( n + 1 )); if [ "$n" -ge 5 ]; then log "evidence: push rejected $n times — the commit stays local"; return 0; fi
    fleet_git -C "$EVIDENCE_DIR" pull --rebase origin "$LIVE_BRANCH" || true
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
# The run's hub record: the plan commit's `kata.json`, written where `run_engine`, `close_run`,
# `mark-run` and the failure path read it; a plan commit without one writes nothing, and the
# run proceeds with no board.
kata_record() {
  local blob
  blob="$(fleet_git -C "$EVIDENCE_DIR" show "$PLAN_SHA:$EVIDENCE_REL/kata.json" 2>/dev/null || true)"
  [ -n "$blob" ] || { log "board: no $EVIDENCE_REL/kata.json at $PLAN_SHA — the run proceeds without a board"; return 0; }
  mkdir -p "$FLEET_HOME/plans"; printf '%s' "$blob" >"$FLEET_HOME/plans/$RUN_ID.kata.json"
  log "board: the hub record is at $FLEET_HOME/plans/$RUN_ID.kata.json"
}
engine_deps() {
  [ -d "$ENGINE_REPO_DIR/factory/node_modules" ] && return 0
  if [ -f "$ENGINE_REPO_DIR/factory/package-lock.json" ]
  then log "deps: npm ci"; ( cd "$ENGINE_REPO_DIR/factory" && fleet_npm ci --no-audit --no-fund ) || fail "npm ci: engine deps"
  else log "deps: npm install"; ( cd "$ENGINE_REPO_DIR/factory" && fleet_npm install --no-audit --no-fund ) || fail "npm install: engine deps"; fi
  log "deps: npm returned"
}
# Claude Code: the image bakes whatever release was current when it was built (2.1.258 and
# 2.1.267 measured on 2026-10-01), so the boot takes the newest release before the preflight, then
# holds it to a floor — 2.1.287 is the first with mods — and pins it for the run. `exeuntu update`
# fetches from Anthropic's public release site with no credential and swaps the binary only after
# its checksum agrees, so a failed update leaves the old one in place (Shelley, fleet-counsel,
# 2026-10-01); the floor is what then refuses the run.
CLAUDE_FLOOR="2.1.287"
claude_current() {
  log "claude: updating to the newest release"
  fleet_sudo exeuntu update claude || log "claude: the update failed; checking the installed release"
  local v; v="$(claude --version 2>/dev/null | cut -d' ' -f1)"
  log "claude: $v"
  [ "$(printf '%s\n%s\n' "$CLAUDE_FLOOR" "$v" | sort -V | head -1)" = "$CLAUDE_FLOOR" ] \
    || fail "claude ${v:-unknown} is below the floor $CLAUDE_FLOOR"
  export DISABLE_AUTOUPDATER=1
}
# A transient SERVICE, not a scope: `--wait` hands back the exit code and `--collect` unloads the unit; while it runs, the boot relays events every FLEET_COMMIT_SECONDS and looks for its exit every second.
run_engine() {
  local pid board_args=() past_args=() engine_entry="factory/flock/engine.mjs" kata_json="$FLEET_HOME/plans/$RUN_ID.kata.json"
  [ -f "$kata_json" ] && board_args=(--kata-url "$KATA_ADMIN_URL" --kata-json "$kata_json" --kata-actor "engine:$RUN_ID")
  [ -n "$PAST_DIR" ] && past_args=(--past-dir "$PAST_DIR")
  mkdir -p "$RUN_DIR"; rm -f "$DONE_MARKER"
  ( set +e
    fleet_systemd_run --user "--unit=fleet-engine-$RUN_N" --pipe --wait --collect \
      -p MemoryMax=40G -p MemorySwapMax=0 -p LimitNOFILE=524288 -p "RuntimeMaxSec=$FLEET_RUN_MAX_SECONDS" -p "WorkingDirectory=$TARGET_DIR" -- \
      env -u CLAUDE_CONFIG_DIR "ANTHROPIC_BASE_URL=$ANTHROPIC_PROXY_URL" \
        "TYPESAFE_BASE_URL=$TYPESAFE_PROXY_URL" CLAUDE_CODE_OAUTH_TOKEN=placeholder \
        "ULTRAPOWERS_FLEET_RUN=$RUN_ID" node "$ENGINE_REPO_DIR/$engine_entry" \
        --plan "$PLAN_FILE" --plan-json "$PLAN_JSON" --target "$TARGET_DIR" --base "$BASE_SHA" --run-dir "$RUN_DIR" \
        ${board_args[@]+"${board_args[@]}"} ${past_args[@]+"${past_args[@]}"} >>"$ENGINE_LOG" 2>&1
    printf '%s\n' "$?" >"$DONE_MARKER" ) &
  pid=$!
  # The exit is looked for every second and the events relayed every FLEET_COMMIT_SECONDS: one
  # sleep for both left publish waiting up to a whole tick after the engine had exited (runs 4–6
  # on flock-baseline, 13–58 s, 2026-09-26).
  local waited=0
  while [ ! -f "$DONE_MARKER" ]; do
    sleep 1; waited=$((waited + 1))
    if [ "$waited" -ge "$FLEET_COMMIT_SECONDS" ]; then waited=0; tick_events; fi
  done
  wait "$pid" 2>/dev/null || true
  log "engine: exited $(cat "$DONE_MARKER") (output in $ENGINE_LOG)"
}
plan_title()   { { sed -n 's/^# \(.*\)$/\1/p' "$PLAN_FILE" || true; } | head -n 1; }
# The publish, in plain sequence after the engine (#1441): `factory/publish.mjs` opens the pull
# request (a draft when the engine did not finish green), self-merges it under `publish.self_merge`
# (catching the run up to a moved main), and runs the deploy the merge earned. It prints the run's
# state, phase, PR url, PR author and merge sha one per line, or a refusal this fails on.
publish() { # $1 = the engine's exit code
  local out rc=0 state phase_text audit_args audit_line
  fleet_git -C "$TARGET_DIR" push origin "HEAD:refs/heads/$BRANCH" || fail "publish: pushing $BRANCH was rejected"
  write_status publishing "opening the pull request"; evidence_commit "$RUN_ID: publishing"
  out="$(fleet_node "$ENGINE_REPO_DIR/factory/publish.mjs" --engine-exit "$1" --hold "$HOLD_FLAG" --run-id "$RUN_ID" \
    --target-repo "$TARGET_REPO" --target-dir "$TARGET_DIR" --branch "$BRANCH" --base-sha "$BASE_SHA" \
    --plan "$PLAN_FILE" --plan-json "$PLAN_JSON" --run-dir "$RUN_DIR" --evidence-dir "$EVIDENCE_DIR/$EVIDENCE_REL" \
    --evidence-url "https://github.com/$EVIDENCE_REPO/tree/$SLUG/$RUN_ID/$EVIDENCE_REL" --github-host "$GITHUB_INT_HOST" \
    --anthropic-url "$ANTHROPIC_PROXY_URL" --typesafe-url "$TYPESAFE_PROXY_URL" --log "$BOOT_LOG")" || rc=$?
  [ "$rc" = 0 ] || fail "${out:-publish: publish.mjs exited $rc}"
  state="$(sed -n 1p <<<"$out")"; phase_text="$(sed -n 2p <<<"$out")"
  PR_URL="$(sed -n 3p <<<"$out")"; PR_AUTHOR="$(sed -n 4p <<<"$out")"; MERGED_SHA="$(sed -n 5p <<<"$out")"
  write_status "$state" "$phase_text"; evidence_commit "$RUN_ID: $state"
  close_run "$state" "$phase_text"
  audit_args=(); [ -f "$FLEET_HOME/plans/$RUN_ID.kata.json" ] && audit_args=(--bound)
  audit_line="$(fleet_node "$ENGINE_REPO_DIR/factory/audit.mjs" "$EVIDENCE_DIR/$EVIDENCE_REL/events.jsonl" "$state" ${audit_args[@]+"${audit_args[@]}"} 2>/dev/null)" || true
  [ -n "${audit_line:-}" ] && printf '%s\n' "$audit_line" >>"$EVIDENCE_DIR/$EVIDENCE_REL/events.jsonl"
  evidence_commit "$RUN_ID: audit"
  record_tags
  # The boot's last act, which never fails the run: the hub answers before it removes (#1470).
  if [ "$state" = done ] && [ -n "$MERGED_SHA" ] && [ "$HOLD_FLAG" != 1 ] && [ "$RECORDED" = 1 ]; then
    fleet_curl -m 5 -sS -X POST "$REAPER_URL/reap" -H 'content-type: application/json' -d "{\"run\":$RUN_N,\"target\":\"$TARGET_REPO\"}" -o /dev/null || true
    log "reap: asked the hub to remove this VM"
  fi
}
# What a run leaves behind is its one tag in the evidence repository; the live branch is only where it worked, deleted only once the listing agrees — every unhappy path logs one `record:` line and returns 0.
record_tags() {
  local tag="refs/tags/$SLUG/$RUN_ID" head listed
  head="$(fleet_git -C "$EVIDENCE_DIR" rev-parse HEAD 2>/dev/null || true)"
  [ -n "$head" ] || { log "record: the evidence clone has no HEAD to tag — $LIVE_BRANCH kept"; return 0; }
  fleet_git -C "$EVIDENCE_DIR" push origin "HEAD:$tag" || { log "record: pushing $tag at $head was rejected — $LIVE_BRANCH kept"; return 0; }
  listed="$(fleet_git -C "$EVIDENCE_DIR" ls-remote --tags origin "$tag" 2>/dev/null | awk -v r="$tag" '$2 == r { print $1 }' || true)"
  [ "$listed" = "$head" ] || { log "record: $EVIDENCE_REPO lists $tag at '${listed:-<nothing>}', not $head — $LIVE_BRANCH kept"; return 0; }
  RECORDED=1
  fleet_git -C "$EVIDENCE_DIR" push origin --delete "refs/heads/$LIVE_BRANCH" || { log "record: $tag is on $EVIDENCE_REPO but deleting $LIVE_BRANCH was rejected"; return 0; }
  log "record: $tag at $head in $EVIDENCE_REPO — $LIVE_BRANCH deleted"
}
# The run's close: `board.mjs close-run`, the one module that talks to Kata and never
# fails a run (CLAUDE.md). A parked run is not closed but marked: `mark-run` writes
# `work.state=parked` on the run issue, which the janitor reaps (#1288).
close_run() { # $1 = the run's final state (done|parked), $2 = its phase
  local args
  if [ "$1" != done ]; then mark_run parked "${2:-}"; return 0; fi
  args=(--kata-json "$FLEET_HOME/plans/$RUN_ID.kata.json" --run "$RUN_ID" --pr "$PR_URL" \
    --admin-url "$KATA_ADMIN_URL" --events "$EVIDENCE_DIR/$EVIDENCE_REL/events.jsonl" --title "$(plan_title)")
  [ -n "$MERGED_SHA" ] && args+=(--merged "$MERGED_SHA")
  fleet_node "$ENGINE_REPO_DIR/factory/board.mjs" close-run "${args[@]}" || true
}
# The one entry point: nothing ahead of base is done (a failure if the engine wasn't green), anything ahead is a publish.
boot() {
  local comment code head; comment="$(read_assignment)"
  [ -n "$comment" ] || fail "assignment: no comment in FLEET_ASSIGNMENT or at $REFLECTION_URL/comment"
  parse_assignment "$comment"
  VM_NAME="$(fleet_curl -fsS "$REFLECTION_URL/" 2>/dev/null | json_field name || true)"; prepare; find_past
  write_status running "the engine is starting"; evidence_commit "$RUN_ID: running"
  engine_deps; claude_current; preflight; kata_record; run_engine
  code="$(cat "$DONE_MARKER")"; collect_evidence
  head="$(fleet_git -C "$TARGET_DIR" rev-parse HEAD 2>/dev/null || true)"
  if [ "$head" = "$BASE_SHA" ]; then
    if [ "$code" != 0 ]; then fail "engine exit $code" "$code"; fi
    # exit 0 at the base: the engine settled green on a snapshot equal to the base, so every proof
    # already held there; nothing to publish, and the run is done, closed with the base as evidence
    MERGED_SHA="$BASE_SHA"; write_status done "nothing to build: every proof already passes at the base"
    close_run done "nothing to build"; evidence_commit "$RUN_ID: done, nothing to build"
    record_tags; exit 0; fi
  publish "$code"; exit 0
}
# systemd's `ExecStopPost=` of the run unit: a boot that was killed (or died) before its record ended
# leaves a failed record, with the unit's journal, and its tag; a record that already ended is left alone.
# Always exits 0 — even a `fail` inside `parse_assignment` — since a stop hook's exit only muddies the unit.
died() {
  local state how
  trap 'exit 0' EXIT
  how="unit ${SERVICE_RESULT:-unknown} (${EXIT_CODE:-unknown} ${EXIT_STATUS:-unknown})"
  parse_assignment "${FLEET_ASSIGNMENT:-}"
  if [ ! -e "$EVIDENCE_DIR/.git" ] || [ ! -f "$STATUS_FILE" ]; then
    ERROR="$how while the record said nothing"; log "died: $ERROR"; mark_run failed "$ERROR"; exit 0
  fi
  state="$(json_field state <"$STATUS_FILE")"
  case "$state" in done|parked|failed) log "died: the record already says $state"; exit 0 ;; esac
  STARTED_AT="$(json_field startedAt <"$STATUS_FILE")"; PHASE="$(json_field phase <"$STATUS_FILE")"
  VM_NAME="$(json_field vm <"$STATUS_FILE")"; PR_URL="$(json_field pr <"$STATUS_FILE")"
  PR_AUTHOR="$(json_field prAuthor <"$STATUS_FILE")"; MERGED_SHA="$(json_field merged <"$STATUS_FILE")"
  ERROR="$how while the record said $state"; log "died: $ERROR"
  mkdir -p "$EVIDENCE_DIR/$EVIDENCE_REL"
  fleet_journalctl --user -u "fleet-run@$RUN_N.service" --no-pager -n 200 >"$EVIDENCE_DIR/$EVIDENCE_REL/journal.txt" 2>&1 || true
  EVIDENCE_READY=1; FAILING=1; collect_evidence; write_status failed "$PHASE"; mark_run failed "$ERROR"
  evidence_commit "$RUN_ID: died"; record_tags
  exit 0
}
case "${1:-}" in
  boot) boot ;;
  died) died ;;
  *) printf 'usage: boot.sh boot|died\n' >&2; exit 2 ;;
esac
