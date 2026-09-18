#!/bin/bash
# factory/boot.sh — the sandbox side of a factory run, and the run unit's own
# process: it clones the target, takes the plan off `ultra/plan-run-<N>`, proves the
# credential, runs `factory/engine.mjs` as a transient user service, keeps the record
# on `ultra/evidence-run-<N>` while that engine works, then pushes the integration
# branch, opens the PR and leaves the two tags. No status server, no kata ping, no
# merge, no fold-again, no card: git is the record. Every external program goes
# through a `fleet_*` wrapper and every path hangs off `$FLEET_HOME` (so the exam
# drives this against stubs), and no absolute interpreter path appears below.
set -euo pipefail
FLEET_HOME="${FLEET_HOME:-/home/exedev}"
REFLECTION_URL="${REFLECTION_URL:-https://reflection.int.exe.xyz}"
ANTHROPIC_PROXY_URL="${ANTHROPIC_PROXY_URL:-https://claude-max.int.exe.xyz}"
TYPESAFE_PROXY_URL="${TYPESAFE_PROXY_URL:-https://typesafe.int.exe.xyz}"
GITHUB_INT_HOST="${GITHUB_INT_HOST:-github.int.exe.xyz}"
PLAN_BLOB_PATH=".ultrapowers/plan.md"
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
ERROR=""; VM_NAME=""; STARTED_AT=""; EVIDENCE_READY=""
fleet_curl()        { curl "$@"; }
fleet_git()         { git "$@"; }
fleet_npm()         { npm "$@"; }
fleet_systemd_run() { systemd-run "$@"; }
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
# Backslash, quote, tab, and newline as `\n` and never as nothing — `error` carries a reply body.
json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' |
    awk 'BEGIN { ORS = "" } { gsub(/\t/, "\\\\t"); print (NR > 1 ? "\\n" : "") $0 }'
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
# `tier`, `effort` and `hold` are accepted for the launcher's sake and acted on by nobody.
parse_assignment() { # $1 = the comment line
  local tok key val
  for tok in $1; do
    key="${tok%%=*}"; val="${tok#*=}"
    case "$key" in
      run) RUN_N="$val" ;; plan) PLAN_SHA="$val" ;; target) TARGET_REPO="$val" ;;
      base) BASE_SHA="$val" ;; engine) ENGINE_SHA="$val" ;; tier|effort|hold) : ;;
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
ensure_git_identity() {
  [ -n "$(fleet_git -C "$EVIDENCE_DIR" config user.email 2>/dev/null || true)" ] && return 0
  fleet_git -C "$EVIDENCE_DIR" config user.email "fleet@exe.dev" || true
  fleet_git -C "$EVIDENCE_DIR" config user.name "${VM_NAME:-fleet}" || true
}
# The projection of the engine's event log: `rows` is the PR body's table, `tasks` the status page's last cell.
ev_project() { # $1 = rows|tasks
  local f="$RUN_DIR/events.jsonl"; [ -f "$f" ] || { [ "$1" = tasks ] && printf '{}'; return 0; }
  awk -v mode="$1" '
    # A quoted value is taken WITH its JSON escapes still in it: the engine writes park reasons that
    # quote the exam, a `\"` read as the end of the string truncates one, and taken whole it goes
    # straight back out — no re-escaping, because what came off a JSON document is already escaped.
    function g(s, f,   r) { if (!match(s, "\"" f "\"[ \t]*:[ \t]*")) return ""
      r = substr(s, RSTART + RLENGTH)
      if (substr(r, 1, 1) != "\"") { sub(/[ \t]*[,}].*/, "", r); return r }
      match(r, /^"([^"\\]|\\.)*"/); return substr(r, 2, RLENGTH - 2) }
    function note(t, s, p) { if (!(t in st)) o[++n] = t; st[t] = s; pk[t] = p }
    /"kind"[ \t]*:[ \t]*"landing"/ { if (mode == "rows") printf "| %s | %s | %s | %s |\n", g($0, "task"), g($0, "k"), g($0, "examExit"), g($0, "candidateSha"); else note(g($0, "task"), "folded", "null") }
    /"kind"[ \t]*:[ \t]*"parked"/ { if (mode == "tasks") note(g($0, "task"), "failed", "\"" g($0, "reason") "\"") }
    END { if (mode != "tasks") exit
      printf "{"
      for (i = 1; i <= n; i++) printf "%s\"%s\":{\"wave\":null,\"state\":\"%s\",\"role\":null,\"lastProof\":null,\"park\":%s,\"attention\":null,\"blockedBy\":null}", (i > 1 ? "," : ""), o[i], st[o[i]], pk[o[i]]
      printf "}" }
  ' "$f"
}
# One writer, thirteen cells, written atomically. `startedAt` is the run's clock
# and is set once; every write stamps `updatedAt`.
write_status() { # $1 = state, $2 = phase (optional)
  local pr=null author=null vm=null err=null tasks tmp
  STATE="$1"; if [ "$#" -ge 2 ]; then PHASE="$2"; fi
  [ -n "$STARTED_AT" ] || STARTED_AT="$(now_iso)"
  [ -n "$PR_URL" ] && pr="\"$(json_escape "$PR_URL")\""; [ -n "$PR_AUTHOR" ] && author="\"$(json_escape "$PR_AUTHOR")\""
  [ -n "$VM_NAME" ] && vm="\"$(json_escape "$VM_NAME")\""; [ -n "$ERROR" ] && err="\"$(json_escape "$ERROR")\""
  tasks="$(ev_project tasks)"; [ -n "$tasks" ] || tasks="{}"
  mkdir -p "$EVIDENCE_DIR/$EVIDENCE_REL"; tmp="$STATUS_FILE.tmp.$$"
  printf '{"run":"%s","state":"%s","phase":"%s","pr":%s,"prAuthor":%s,"merged":null,"disclosures":null,"branch":"%s","vm":%s,"startedAt":"%s","updatedAt":"%s","error":%s,"tasks":%s}\n' \
    "$(json_escape "$RUN_N")" "$(json_escape "$STATE")" "$(json_escape "$PHASE")" "$pr" "$author" "$(json_escape "$BRANCH")" "$vm" "$STARTED_AT" "$(now_iso)" "$err" "$tasks" >"$tmp"
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
  local pid
  mkdir -p "$RUN_DIR"; rm -f "$DONE_MARKER"
  ( set +e
    fleet_systemd_run --user "--unit=fleet-engine-$RUN_N" --pipe --wait --collect \
      -p MemoryMax=40G -p MemorySwapMax=0 -p LimitNOFILE=524288 -p "RuntimeMaxSec=$FLEET_RUN_MAX_SECONDS" -p "WorkingDirectory=$TARGET_DIR" -- \
      env -u CLAUDE_CONFIG_DIR "ANTHROPIC_BASE_URL=$ANTHROPIC_PROXY_URL" \
        "TYPESAFE_BASE_URL=$TYPESAFE_PROXY_URL" CLAUDE_CODE_OAUTH_TOKEN=placeholder \
        "ULTRAPOWERS_FLEET_RUN=$RUN_ID" node "$ENGINE_REPO_DIR/factory/engine.mjs" \
        --plan "$PLAN_FILE" --target "$TARGET_DIR" --base "$BASE_SHA" --run-dir "$RUN_DIR" >>"$ENGINE_LOG" 2>&1
    printf '%s\n' "$?" >"$DONE_MARKER" ) &
  pid=$!
  while [ ! -f "$DONE_MARKER" ]; do sleep "$FLEET_COMMIT_SECONDS"; tick_events; done
  wait "$pid" 2>/dev/null || true
  log "engine: exited $(cat "$DONE_MARKER") (output in $ENGINE_LOG)"
}
plan_title()   { { sed -n 's/^# \(.*\)$/\1/p' "$PLAN_FILE" || true; } | head -n 1; }
plan_summary() { # the text after `**Summary:** ` to its blank line, verbatim
  awk '/^\*\*Summary:\*\*/ { s = 1; l = $0; sub(/^\*\*Summary:\*\*[ ]?/, "", l); print l; next }
       s && /^[[:space:]]*$/ { exit } s { print }' "$PLAN_FILE"
}
# Exactly one line of the plan is read: the first `**Closes:**` after `**Goal:**` and before the first `### `.
# Never a regex over the whole body — a Goal line cites decisions, and a task body may name any number at all.
plan_closes() {
  awk '/^### / { exit }
       goal && /^\*\*Closes:\*\*/ { line = $0; exit }
       /^\*\*Goal:\*\*/ { goal = 1 }
       END { while (match(line, /#[0-9]+/)) { printf "Closes %s\n", substr(line, RSTART, RLENGTH); line = substr(line, RSTART + RLENGTH) } }' "$PLAN_FILE"
}
pr_body() { plan_summary; printf '\n'; ev_project rows; printf '\n'; plan_closes; }
# The target's default branch as the remote advertised it: a PR against a guessed `main` on a `master` repo is refused, or worse taken.
default_branch() {
  local ref; ref="$(fleet_git -C "$TARGET_DIR" symbolic-ref refs/remotes/origin/HEAD 2>/dev/null || true)"
  case "$ref" in refs/remotes/origin/?*) printf '%s\n' "${ref#refs/remotes/origin/}" ;; *) return 1 ;; esac
}
# One POST, one JSON answer, nothing to negotiate. The edge injects the GitHub credential on the way through, so no
# `authorization` header is sent; the status rides as the answer's last line, so a non-2xx is told from a 201 without a
# second request; `html_url` and `login` are read as the FIRST match because GitHub's PR document puts its own ahead of
# the head and base repositories'. A run the engine did not finish green still gets its PR — as a DRAFT: what is
# withheld is the claim that it is ready, and the merge is the operator's act.
publish() { # $1 = the engine's exit code
  local base title draft body payload answer code reply state number
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
  printf '{"kind":"publish:pr","url":"%s","number":%s,"draft":%s}\n' "$(json_escape "$PR_URL")" "${number:-null}" "$draft" >>"$EVIDENCE_DIR/$EVIDENCE_REL/events.jsonl"
  if [ "$1" = 0 ]; then state=done; else state=parked; fi
  write_status "$state" "the pull request is open"; evidence_commit "$RUN_ID: $state"
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
boot() {
  local comment code head; comment="$(read_assignment)"
  [ -n "$comment" ] || fail "assignment: no comment in FLEET_ASSIGNMENT or at $REFLECTION_URL/comment"
  parse_assignment "$comment"
  VM_NAME="$(fleet_curl -fsS "$REFLECTION_URL/" 2>/dev/null | json_field name || true)"; prepare
  write_status running "the engine is starting"; evidence_commit "$RUN_ID: running"
  engine_deps; auth_status; bearer_probe; run_engine
  code="$(cat "$DONE_MARKER")"; collect_evidence
  # What decides the outcome is what landed, not how the engine ended: nothing ahead of base is a park when the
  # engine was green and a failure otherwise; anything ahead of base is a pull request — a draft unless the engine
  # was green — whatever ended the engine, the run's deadline included.
  head="$(fleet_git -C "$TARGET_DIR" rev-parse HEAD 2>/dev/null || true)"
  if [ "$head" = "$BASE_SHA" ]; then
    [ "$code" = 0 ] || fail "engine exit $code" "$code"
    write_status parked "nothing ahead of base"; evidence_commit "$RUN_ID: parked"; record_tags; exit 0; fi
  publish "$code"; exit 0
}
case "${1:-}" in boot) boot ;; *) printf 'usage: boot.sh boot\n' >&2; exit 2 ;; esac
