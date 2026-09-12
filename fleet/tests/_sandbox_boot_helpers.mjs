// fleet/tests/_sandbox_boot_helpers.mjs — the shared rig for the
// `fleet/sandbox-boot.sh` exam, which runs as two processes:
// `test_sandbox_boot.mjs` (the green path and the evidence branch) and
// `test_sandbox_boot_edges.mjs` (everything else). Underscore-prefixed so the
// bridge's `test_*.mjs` glob does not collect it as an exam of its own.
//
// The script's whole job is ORDER: which external call happens before which
// state is claimed. So every stub appends one line to the SAME log the script
// writes its own state lines to (`$FLEET_HOME/fleet-boot.log`), and the
// ordering assertions read index comparisons in that one stream. Each stub
// additionally writes a tab-separated argv line to its own log, which is where
// the literal-argv assertions read.
//
// No network, no systemd, no real `claude`: `FLEET_BIN_DIR` is prepended to
// PATH and `FLEET_HOME` relocates every path the script touches. The engine is
// where the bootstrap would have put it — `$FLEET_HOME/engines/<sha>` — and
// the assignment arrives the way the bootstrap hands it over, in
// `FLEET_ASSIGNMENT`.
//
// `tmpRoot` and `caseNo` are this module's own state: `makeHome` numbers its
// homes under one temp root and `runTests` removes it when the process is done.

import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { simEnv } from './_helpers.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const SCRIPT = path.join(HERE, '..', 'sandbox-boot.sh')

// ── the run's literals ───────────────────────────────────────────────────────

export const PLAN_SHA = 'a1'.repeat(20)
export const BASE_SHA = 'b2'.repeat(20)
export const ENGINE_SHA = 'c3'.repeat(20)
/** The pushed head of the integration branch — what `git rev-parse <branch>`
 *  answers and what the edge's branches endpoint has to report before the PR
 *  POST. */
export const HEAD_SHA = 'd4'.repeat(20)
/** Some other commit, for the run where the plan branch does not carry `plan=`. */
export const OTHER_SHA = 'e5'.repeat(20)
export const TARGET = 'popmechanic/smoke'
export const VM_NAME = 'fleet-r7-2609032215-a1b2'
export const PR_URL = 'https://github.com/popmechanic/smoke/pull/1'
export const PR_AUTHOR = 'popmechanic'
/** The follow-up issue GitHub answers the `POST …/issues` with. */
export const FOLLOWUP_URL = 'https://github.com/popmechanic/smoke/issues/9'
/** The squash commit GitHub answers a merge PUT with. */
export const MERGE_SHA = 'f6'.repeat(20)

// The three branches of #598, all on the target.
export const PLAN_BRANCH = 'ultra/plan-run-7'
export const EVIDENCE_BRANCH = 'ultra/evidence-run-7'
export const INTEGRATION_BRANCH = 'ultra/integration-run-7'
/** Where the evidence lives inside the evidence worktree. */
export const RUN_PATH = '.ultrapowers/runs/7'
/** The run directory inside the target clone — where the engine writes its
 *  `events.jsonl` and where the boot script appends its publish record. */
export const RUN_DIR_PATH = '.claude/ultrapowers/run-run-7'
/** The engine's id alphabet, Crockford base 32 (`fleet/run-waves.mjs`). */
export const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
/** The engine stub's one event id, in the shape the real `ulid()` mints: ten
 *  characters of the millisecond clock — here a `ts` of 1 — then a sequence and
 *  randomness, which the stub spends on zeros so the line is a literal. An id
 *  of `x` would sort ABOVE every real ULID (lowercase is past `Z`), and the
 *  readers order by id, so the stub would invert the production order. */
export const ENGINE_EVENT_ID = '0000000001' + '0'.repeat(16)
/** The one line the engine stub leaves in `events.jsonl`, newline included. */
export const ENGINE_EVENT_LINE =
  `{"kind":"engine:phase","phase":"gate","id":"${ENGINE_EVENT_ID}","ts":1}\n`
/** The plan's path inside the plan commit's tree. */
export const PLAN_PATH = '.ultrapowers/plan.md'
/** The run's kata record inside that same commit, when the launcher made one. */
export const KATA_PATH = '.ultrapowers/kata.json'
/** The hub's address the boot script defaults to — the literal a case reads back
 *  off the ping's argv. `FLEET_KATA_URL` overrides it; nothing in `bootEnv`
 *  does, so a boot that asks the hub anything asks it here. */
export const KATA_URL = 'https://kata.int.exe.xyz'

// M3's two links, spelled the way the PR body has to spell them: the two tags
// the run creates at publish, never the branches those tags were cut from.
export const EVIDENCE_LINK = `https://github.com/${TARGET}/tree/ultra/evidence/run-7/${RUN_PATH}/`
export const PLAN_LINK = `https://github.com/${TARGET}/blob/ultra/plan/run-7/${PLAN_PATH}`
export const PLAN_ROW = `| plan | \`${PLAN_PATH}\` at \`${PLAN_SHA}\` |`

// ── the publish fold's literals (run-32 task 4, #715) ────────────────────────
//
// The folder is a SIBLING task's program. This rig never runs it: the
// `fleet-fold-*` unit is answered by the `systemd-run` stub, which writes what
// the folder would have written — `engine-head`, `publish-fold/receipt.json`,
// a suite file — and exits the code the case asked for. Everything below is
// what that stub writes by default, named so a case can assert on it.

/** The head the folder records as the engine's before it touches the branch.
 *  Equal to what the `git` stub answers `rev-parse <branch>` with, because the
 *  folder reads it the same way — and so the boot script's own fallback, when
 *  the folder died before writing `engine-head`, lands on the same sha. */
export const FOLD_ENGINE_HEAD = HEAD_SHA
/** The folded head attempt 1 leaves on the branch — NOT the engine's, so a
 *  case can tell a rewind from a fold. */
export const FOLD_CANDIDATE = 'a7'.repeat(20)
/** The folded head attempt 2 leaves. */
export const FOLD_CANDIDATE_2 = 'b8'.repeat(20)
/** The head `rev-parse` answers once attempt 2 has run, when a case sets
 *  `STUB_HEAD_SHA_2` — the second push's. */
export const HEAD_SHA_2 = FOLD_CANDIDATE_2
/** The one line the fold stub prints, which is therefore the last line of
 *  `publish-fold/publish-fold-<attempt>.log`. */
export const FOLD_STUB_LINE = 'fold stub speaking'
/** What the stub writes to `publish-fold/suite-<attempt>.txt` on `suite red`:
 *  twenty-eight TAP-shaped lines whose failing leg is the SECOND, buried under
 *  twenty-six diagnostic lines. A fixed-length tail of this file cannot carry
 *  the `not ok 2` line, so the excerpt the PR body quotes has to be the
 *  failing test's own block. */
export const FOLD_SUITE_TEXT = [
  'ok 1 - join',
  'not ok 2 - the recorded text names the failing leg',
  ...Array.from({ length: 24 }, (_, i) => `  diagnostic line ${i + 1}`),
  '  ...',
  '# fail 1',
].join('\n')
/** Its last line — the one the PR body has to carry. */
export const FOLD_SUITE_LAST = '# fail 1'
/** Where the fold's receipts live inside the evidence worktree. */
export const FOLD_PATH = `${RUN_PATH}/publish-fold`
/** The link the `## Publish fold` section points a reader at. */
export const FOLD_RECEIPT_LINK = `${EVIDENCE_LINK}publish-fold/receipt.json`

/**
 * M4's forbidden names, assembled rather than written, because the same
 * prohibition covers this exam's own files: no source under `fleet/` may
 * carry them.
 */
export const RETIRED_NAMES = ['fleet' + '-runs', 'FLEET' + '_RUNS', 'fleet' + 'Runs']

/** What GitHub answers a POST /pulls with, in its own field order: the PR's
 *  `html_url` and its `user` (the author) come before the head/base
 *  repositories, which carry the same field names for other things. */
export const PR_JSON = JSON.stringify({
  url: 'https://api.github.com/repos/popmechanic/smoke/pulls/1',
  id: 1,
  node_id: 'PR_x',
  html_url: PR_URL,
  diff_url: `${PR_URL}.diff`,
  number: 1,
  state: 'open',
  user: { login: PR_AUTHOR, id: 2, html_url: 'https://github.com/popmechanic' },
  head: { ref: INTEGRATION_BRANCH, user: { login: 'not-the-author' }, repo: { html_url: 'https://github.com/popmechanic/smoke' } },
  base: { ref: 'main', user: { login: 'not-the-author-either' } }
})
export const PLAN_H1 = 'Smoke: the fleet proves itself'
/** The plan-level Claim of the stub plan, as the card quotes it — the `(elicited)`
 *  tag stripped. */
export const PLAN_CLAIM = 'I open one PR and read what the fleet promised and proved.'
/** The `**Summary:**` paragraph the operator signed, as the card quotes it. */
export const PLAN_SUMMARY =
  'This is the fleet proving itself on a smoke target. It exists so a person can'
  + ' read one pull request instead of a run directory. It benefits them by putting'
  + ' the answer above the record.'
/** The one task of the stub plan, and its Claim with the `(derived)` tag stripped. */
export const PLAN_TASK_ID = '1'
export const PLAN_TASK_CLAIM = 'The smoke target grows the one file the plan names.'
/**
 * The stub plan in THREE pieces, because `STUB_PLAN_EXTRA` is read two ways:
 *
 *   - an extra that signs NO `**Claim:**` of its own is a HEADER BLOCK, and
 *     goes between `PLAN_HEAD` and `PLAN_TASKS` — `plan_closes` stops reading
 *     at the first `### ` heading, so a case that adds a `**Closes:**` line
 *     adds it above the task the card's table is built from;
 *   - an extra that DOES sign a `**Claim:**` is a WHOLE PLAN: it follows
 *     `PLAN_STEM` — the `# <H1>` and `body` lines — and replaces the stub's
 *     signed header and its task, so a case that writes its own Claim,
 *     Summary and `### Task` headings reads none of this fixture's.
 */
export const PLAN_STEM = `# ${PLAN_H1}\n\nbody\n`
export const PLAN_HEAD = PLAN_STEM
  + `**Claim:** ${PLAN_CLAIM} (elicited)\n`
  + `**Summary:** ${PLAN_SUMMARY}\n\n`
export const PLAN_TASKS =
  `### Task ${PLAN_TASK_ID}: The smoke target grows a file\n\n`
  + `**Claim:** ${PLAN_TASK_CLAIM} (derived)\n`
  + 'Machine: M1. The file is present at the head this run pushed.\n'
/** Exactly what `git show <plan>:.ultrapowers/plan.md` hands back. */
export const PLAN_BYTES = `${PLAN_HEAD}${PLAN_TASKS}`

/**
 * The `report.json` the engine stub writes when no case asks for another —
 * ONE wave, ONE task, and one of each record the card's task table reads, so
 * the green boot every sim memoizes renders a whole row rather than six
 * dashes. `STUB_REPORT` replaces it; an EMPTY `STUB_REPORT` removes the file.
 */
export const DEFAULT_REPORT = '{"stamp":"run-7"'
  + ',"waves":[["1"]]'
  + ',"tasks":[{"task":"1","status":"done","exam":"red","reviewVerdict":"approve"'
  + ',"stateExams":[{"exam":"state","mutant_killed":true}]}]'
  + ',"integratedRuns":[{"task":"1","cmd":"node fleet/tests/test_smoke.mjs","exit":0,"stdout":"ok"}]'
  + ',"waveMerges":[{"wave":1,"status":"MERGED","suite":{"passed":true,"output":"ok"}}]}'
export const ASSIGNMENT =
  `run=7 plan=${PLAN_SHA} target=${TARGET} base=${BASE_SHA} engine=${ENGINE_SHA} ` +
  'overlap=fold tier=mostCapable'

// ── stub bin dir ─────────────────────────────────────────────────────────────

export const STUBS = {
  // Reflection, notify, and the GitHub edge's PR endpoint. `$1..` carries the
  // URL as the only https:// word; a POST carries its payload after `-d`. The
  // PR answer is the body, then the status code on its own line — the shape
  // `-w '\\n%{http_code}'` makes real curl print.
  curl: `
argv "curl" "$@"
url=""; payload=""; prev=""; method=GET; out=""
for a in "$@"; do
  # \`http://\` as well as \`https://\`: the kata hub is reached over plain http
  # inside the fleet's network, and a dispatcher that only saw https URLs would
  # answer every kata request with UNKNOWN.
  case "$a" in https://*|http://*) url="$a" ;; esac
  [ "$prev" = "-d" ] && payload="$a"
  [ "$prev" = "-X" ] && method="$a"
  # \`-o <file>\`: the kata export asks for each page in a file rather than on
  # stdout, so the arms that answer it have to honour the flag the way curl
  # does. \`emit\` below is what does it.
  [ "$prev" = "-o" ] && out="$a"
  prev="$a"
done
# One answer, to the file the caller named or to stdout when it named none.
emit() { if [ -n "$out" ]; then printf '%s\\n' "$1" >"$out"; else printf '%s\\n' "$1"; fi; }
bump() {
  f="$FLEET_HOME/stub/$1"; n=0
  [ -f "$f" ] && n=$(cat "$f")
  n=$((n + 1)); echo "$n" >"$f"; echo "$n"
}
case "$url" in
  *reflection.int.exe.xyz/)
    say "curl name"; printf '{"name":"%s"}\\n' "$STUB_VM_NAME" ;;
  */email)
    say "curl email"; printf '{"email":"op@example.com"}\\n' ;;
  */comment)
    n=$(bump comment); say "curl comment $n"
    printf '{"comment":"%s"}\\n' "$STUB_COMMENT" ;;
  */integrations)
    n=$(bump integrations); say "curl integrations $n"
    # Reflection's shape: each github integration names its repository inside
    # its help string. The notes integration names its own TWICE in one string,
    # which is one integration, not a duplicate. STUB_DUPE adds a second
    # integration naming the TARGET — the fault the preflight exists to refuse.
    dupe=""
    [ -n "\${STUB_DUPE:-}" ] && dupe=',{"type":"github","name":"t-popmechanic-smoke-rw","help":"git clone https://github.int.exe.xyz/popmechanic/smoke.git"}'
    printf '{"integrations":[{"type":"http-proxy","name":"claude-max","help":"ANTHROPIC_BASE_URL=https://claude-max.int.exe.xyz"},{"type":"github","name":"notes","help":"git clone https://github.int.exe.xyz/popmechanic/notes.git or push to https://github.int.exe.xyz/popmechanic/notes.git"},{"type":"github","name":"gh-popmechanic-smoke","help":"git clone https://github.int.exe.xyz/popmechanic/smoke.git"}%s]}\\n' "$dupe" ;;
  *github.int.exe.xyz/api/v3/repos/*/branches/*)
    # GitHub's index catching up with the push: 404 for the first
    # STUB_BRANCH_404 reads (forever under STUB_BRANCH_NEVER), then the branch
    # document — its own \`commit.sha\` first, the nested tree sha after it.
    n=$(bump branches); say "curl branches $n"
    # Once the second fold has run, the branch carries the head the git stub
    # now answers \`rev-parse\` with — otherwise this read would never agree
    # with the boot's and the second publish would time out.
    head="$STUB_HEAD_SHA"
    [ -f "$FLEET_HOME/stub/fold-2" ] && head="\${STUB_HEAD_SHA_2:-$STUB_HEAD_SHA}"
    if [ -n "\${STUB_BRANCH_NEVER:-}" ] || [ "$n" -le "\${STUB_BRANCH_404:-0}" ]; then
      printf '{"message":"Branch not found"}\\n404\\n'
    else
      printf '{"name":"ultra/integration-run-7","commit":{"sha":"%s","commit":{"tree":{"sha":"%s"}}}}\\n200\\n' "$head" "\${STUB_TREE_SHA:-tree}"
    fi ;;
  *github.int.exe.xyz/api/v3/repos/*/pulls)
    say "curl pr create"; printf '%s\\n' "$payload" >>"$FLEET_HOME/pr.log"
    printf '%s\\n%s\\n' "$STUB_PR_BODY" "\${STUB_PR_CODE:-201}" ;;
  *github.int.exe.xyz/api/v3/repos/*/pulls/*/merge)
    # The say line is EXACTLY \`curl pr merge\`, with the count kept in the
    # counter file: a sim reads this line by equality to find the PUT in the
    # stream. STUB_MERGE_CODE is a LIST, and it answers PUT n with its n-th
    # entry whenever it HAS an n-th entry: "405 405 405 200" is a base that moved
    # three times and then let the merge through — a run that folds again three
    # times and merges on its fourth PUT. STUB_MERGE_CODE_2 / STUB_MERGE_MESSAGE_2
    # answer PUT n >= 2 only when the list runs out before n, and default to 200,
    # so a one-entry list plus a _2 knob answers exactly what it always did and a
    # refusal knob for the first PUT still never leaks into the second.
    n=$(bump merge)
    say "curl pr merge"; printf '%s\\n' "$payload" >>"$FLEET_HOME/merge.log"
    code=""; i=0
    for c in \${STUB_MERGE_CODE:-200}; do i=$((i + 1)); [ "$i" -le "$n" ] && code="$c"; done
    [ -n "$code" ] || code=200
    msg="\${STUB_MERGE_MESSAGE:-Pull Request successfully merged}"
    if [ "$n" -ge 2 ] && [ "$i" -lt "$n" ]; then
      code="\${STUB_MERGE_CODE_2:-200}"
      msg="\${STUB_MERGE_MESSAGE_2:-$msg}"
    fi
    printf '{"sha":"%s","merged":true,"message":"%s"}\\n%s\\n' "$STUB_MERGE_SHA" "$msg" "$code" ;;
  *github.int.exe.xyz/api/v3/repos/*/pulls/*)
    # The PR document itself: read (GET) for its \`mergeable\`, which GitHub
    # answers null while it recomputes after a push, and rewritten (PATCH) when
    # a disposition lands after the POST. STUB_MERGEABLE_NULL is how many reads
    # answer null before the answer arrives.
    if [ "$method" = PATCH ]; then
      say "curl pr patch"; printf '%s\\n' "$payload" >>"$FLEET_HOME/patch.log"
      printf '%s\\n%s\\n' "$STUB_PR_BODY" "\${STUB_PATCH_CODE:-200}"
    else
      n=$(bump mergeable); say "curl pr read $n"
      m=true
      [ "$n" -le "\${STUB_MERGEABLE_NULL:-0}" ] && m=null
      printf '{"number":1,"state":"open","mergeable":%s,"html_url":"%s"}\\n%s\\n' \\
        "$m" "${PR_URL}" "\${STUB_PR_READ_CODE:-200}"
    fi ;;
  *github.int.exe.xyz/api/v3/repos/*/issues/[0-9]*)
    # One ticket's document, for the labels the follow-up issue inherits. The
    # arm sits ABOVE the collection arm because \`/issues/660\` matches both.
    # STUB_ISSUE_LABELS is the array the document carries as \`labels\` — the
    # default \`[]\` is a ticket carrying none — and STUB_ISSUE_READ_CODE is how
    # a case answers a ticket the reader cannot see.
    num="\${url##*/}"; say "curl issue read $num"
    printf '{"number":%s,"labels":%s}\\n%s\\n' \\
      "$num" "\${STUB_ISSUE_LABELS:-[]}" "\${STUB_ISSUE_READ_CODE:-200}" ;;
  *github.int.exe.xyz/api/v3/repos/*/issues)
    # The follow-up issue's POST, logged the way the PR's is: the payload to
    # \`issues.log\`, one line per call, and GitHub's answer with the status code
    # riding as its last line. STUB_ISSUE_CODE is how a case refuses it.
    say "curl issue create"; printf '%s\\n' "$payload" >>"$FLEET_HOME/issues.log"
    printf '{"html_url":"%s","number":9}\\n%s\\n' \\
      "${FOLLOWUP_URL}" "\${STUB_ISSUE_CODE:-201}" ;;
  *notify.int.exe.xyz*)
    say "curl notify"; printf '%s\\n' "$payload" >>"$FLEET_HOME/notify.log"; printf 'ok\\n' ;;
  *claude-max.int.exe.xyz/api/oauth/usage)
    # THE BEARER PROBE, answered by \`STUB_BEARER\` — the one knob every boot sim
    # shares, because the probe runs on the way to the engine in ALL of them.
    # UNSET or empty is the live bearer (the usage document, then 200); the
    # named rows are the two refusals the boot script must tell apart, plus the
    # two answers it must refuse to classify. The body and the status ride as
    # two lines, the shape \`-w '\\n%{http_code}'\` makes real curl print.
    say "curl bearer"
    case "\${STUB_BEARER:-}" in
      revoked)
        printf '{"type":"error","error":{"type":"authentication_error","message":"OAuth access token has been revoked"}}\\n401\\n' ;;
      forbidden)
        printf '{"type":"error","error":{"type":"permission_error","message":"This account is not permitted"}}\\n403\\n' ;;
      edge)
        printf 'integration not found or not attached to this VM (trace: 53af9083708deefaa364aa37e112695d)\\n403\\n' ;;
      down)
        exit 7 ;;
      500)
        printf 'upstream error\\n500\\n' ;;
      *)
        printf '{"five_hour":{"utilization":1,"resets_at":"x"},"seven_day":{"utilization":1,"resets_at":"x"}}\\n200\\n' ;;
    esac ;;
  *kata.int.exe.xyz/api/v1/ping)
    # THE HUB, ASKED ONCE, before the engine. STUB_KATA_PING_EXIT is the curl
    # exit a case wants the boot to see — the daemon that is not there.
    say "curl kata ping"
    emit '{"ok":true,"service":"kata","version":"0.17.2"}'
    exit \${STUB_KATA_PING_EXIT:-0} ;;
  *kata.int.exe.xyz/api/v1/projects/*/issues*)
    # The export's first request. STUB_KATA_ISSUES is the answer;
    # STUB_KATA_ISSUES_EXIT is the curl exit it fails with FROM ITS
    # STUB_KATA_ISSUES_EXIT_FROM-th call on (default the second), because
    # \`collect_evidence\` exports at every transition and a case that asks what a
    # failed export does to an already-written record needs the first one to
    # have succeeded. \`STUB_KATA_ISSUES_EXIT_FROM=1\` fails every call.
    n=$(bump kata-issues)
    say "curl kata issues"
    issues="\${STUB_KATA_ISSUES:-}"
    [ -n "$issues" ] || issues='{"issues":[]}'
    emit "$issues"
    [ "$n" -ge "\${STUB_KATA_ISSUES_EXIT_FROM:-2}" ] && exit \${STUB_KATA_ISSUES_EXIT:-0}
    exit 0 ;;
  *kata.int.exe.xyz/api/v1/projects/*/events*)
    # STATELESS, AND KEYED ON THE URL: \`after_id=0\` is answered with
    # STUB_KATA_EVENTS and every other cursor with the empty page at the cursor
    # it was asked about. Each export pages from zero on its own, so a boot that
    # follows \`next_after_id\` makes exactly two calls per export and one that
    # ignores it, re-asks \`after_id=0\` or never stops makes a different count.
    after="\${url##*after_id=}"; after="\${after%%'&'*}"
    say "curl kata events $after"
    # The \`&\` is QUOTED in both the pattern and the trim above: \`/bin/sh\` is
    # dash here, and a bare \`&\` inside a case pattern is a syntax error there.
    case "$url" in
      *'after_id=0&'*)
        events="\${STUB_KATA_EVENTS:-}"
        [ -n "$events" ] || events='{"events":[],"next_after_id":0,"reset_required":false}'
        emit "$events" ;;
      *)
        emit "{\\"events\\":[],\\"next_after_id\\":$after,\\"reset_required\\":false}" ;;
    esac
    exit \${STUB_KATA_EVENTS_EXIT:-0} ;;
  *) say "curl UNKNOWN $url"; exit 22 ;;
esac
`,
  // Records argv; makes the directories a real clone (and a real worktree)
  // would, and answers the four reads the boot script makes of the target:
  // FETCH_HEAD after the plan fetch, the plan blob, the branch head, and the
  // count of commits ahead of base.
  git: `
argv "git" "$@"
say "git $*"
dir=""; verb=""; a1=""; a2=""
if [ "$1" = "-C" ]; then dir="$2"; verb="$3"; a1="$4"; a2="$5"
else verb="$1"; a1="$2"; a2="$3"; fi
case "$verb" in
  clone)
    mkdir -p "$a2/.git"
    case "\${STUB_CLONE_404:-}" in
      "$a1") printf 'remote: Repository not found.\\nfatal: 404\\n' >&2; rm -rf "$a2"; exit 128 ;;
    esac
    case "\${STUB_CLONE_FAIL:-}" in
      "$a1") printf 'fatal: boom\\n' >&2; rm -rf "$a2"; exit 128 ;;
    esac ;;
  config)
    # No baked identity, so the script sets one. Both the read and the write
    # answer the same way; the script tolerates a failed write.
    [ "$a1" = "user.email" ] && exit 1 ;;
  fetch)
    # The plan branch is always there. The evidence branch is there only on a
    # RE-ENTRY, which is what STUB_EVIDENCE_FETCH_OK stands for.
    case "$a2" in
      *evidence-run-7) [ -n "\${STUB_EVIDENCE_FETCH_OK:-}" ] || exit 1 ;;
    esac ;;
  rev-parse)
    # What the plan fetch actually landed. The default is the assignment's
    # plan sha — i.e. the launcher and the VM agree.
    case "$a1" in
      FETCH_HEAD) printf '%s\\n' "\${STUB_FETCH_HEAD:-$STUB_PLAN_SHA}" ;;
      refs/remotes/origin/*)
        # THE DEFAULT BRANCH'S TIP, as the merge reads it before its PUT. The
        # default is the tip the fold stub records on every attempt
        # (\`attempts.<n>.tip\`), so a run that folded onto this base finds it
        # still there and merges. STUB_TIP is a base that moved under the run.
        printf '%s\\n' "\${STUB_TIP:-\${STUB_FOLD_ENGINE_HEAD:-$STUB_HEAD_SHA}}" ;;
      *)
        # The fold moves the branch, so a case that wants the second attempt's
        # head to differ sets STUB_HEAD_SHA_2; by default nothing moves and
        # every read answers the same sha it always did.
        if [ -f "$FLEET_HOME/stub/fold-2" ]; then printf '%s\\n' "\${STUB_HEAD_SHA_2:-$STUB_HEAD_SHA}"
        else printf '%s\\n' "$STUB_HEAD_SHA"; fi ;;
    esac
    exit 0 ;;
  rev-list) if [ -n "\${STUB_NO_COMMITS:-}" ]; then echo 0; else echo 3; fi; exit 0 ;;
  ls-remote)
    # The REMOTE's own listing of the two record tags, in ls-remote's shape:
    # \`<sha><tab><ref>\`. The default is the record the run just pushed — the
    # plan tag at the plan sha, the evidence tag at the worktree's HEAD.
    # STUB_TAG_PLAN_SHA / STUB_TAG_EVIDENCE_SHA move one of them to some other
    # commit; STUB_TAGS_MISSING is a remote that lists neither.
    case "$*" in
      *--tags*)
        [ -n "\${STUB_TAGS_MISSING:-}" ] && exit 0
        printf '%s\\trefs/tags/ultra/plan/run-7\\n' "\${STUB_TAG_PLAN_SHA:-$STUB_PLAN_SHA}"
        printf '%s\\trefs/tags/ultra/evidence/run-7\\n' "\${STUB_TAG_EVIDENCE_SHA:-$STUB_HEAD_SHA}"
        # A listing longer than any pipe holds, for the case that asks whether
        # the boot's reader of it survives a writer still writing. \`cat\` is
        # external, and the boot reads this answer whole, so neither end here
        # can take SIGPIPE.
        [ -f "$FLEET_HOME/stub/ls-remote-extra" ] && cat "$FLEET_HOME/stub/ls-remote-extra" ;;
    esac
    exit 0 ;;
  symbolic-ref)
    # What the remote advertised as HEAD at clone time; \`none\` is a remote
    # that advertised nothing.
    [ "\${STUB_HEAD_REF:-}" = none ] && exit 1
    printf '%s\\n' "\${STUB_HEAD_REF:-refs/remotes/origin/main}"; exit 0 ;;
  show)
    case "$a1" in
      *:.ultrapowers/plan.md)
        # The plan text, and — only when a case asks for one — the header
        # lines that case needs added to it. This is the ONLY way plan text
        # reaches the boot, so a reader of any other source sees none of it.
        #
        # A header-block extra goes BETWEEN the header and the tasks, where a
        # plan header line belongs: \`plan_closes\` stops at the first \`### \`
        # heading, so a \`**Closes:**\` line appended after the task would be
        # read by nothing. An extra that signs a \`**Claim:**\` of its own is a
        # WHOLE PLAN instead: it follows the \`# <H1>\` and \`body\` lines and
        # replaces the stub's signed header and its task, so the case reads its
        # own Claim, Summary and \`### Task\` headings and none of the stub's.
        case "\${STUB_PLAN_EXTRA:-}" in
          *'**Claim:**'*)
            printf '%s' "$STUB_PLAN_STEM"
            printf '%s\\n' "$STUB_PLAN_EXTRA" ;;
          '')
            printf '%s%s' "$STUB_PLAN_HEAD" "$STUB_PLAN_TASKS" ;;
          *)
            printf '%s' "$STUB_PLAN_HEAD"
            printf '%s\\n' "$STUB_PLAN_EXTRA"
            printf '%s' "$STUB_PLAN_TASKS" ;;
        esac
        # Linux refuses an environment string past 128 KiB, so plan text big
        # enough to outrun a pipe plus a reader's first read comes from a FILE
        # beside the stub's counters, not from STUB_PLAN_EXTRA.
        [ -f "$FLEET_HOME/stub/plan-extra" ] && cat "$FLEET_HOME/stub/plan-extra"
        exit 0 ;;
      *:.ultrapowers/gate-verdicts.json) printf '{"tasks":{"1":{"verdict":"pass"}},"tally":{"tasks":1}}\\n'; exit 0 ;;
      *:.ultrapowers/kata.json)
        # STUB_KATA_JSON VERBATIM, no trailing newline of the stub's own: the
        # landed \`run-7.kata.json\` has to be byte-equal to what the plan commit
        # carried, so this prints the bytes the case gave and nothing else.
        printf '%s' "$STUB_KATA_JSON"; exit 0 ;;
    esac
    exit 0 ;;
  cat-file)
    # \`cat-file -e <plan>:.ultrapowers/kata.json\`: the record is on the branch
    # only when the case gave one, which is what makes every sim that asks for
    # no kata take the boot's "proceeds without kata" branch.
    case "$a2" in
      *:.ultrapowers/kata.json) [ -n "\${STUB_KATA_JSON:-}" ] || exit 1; exit 0 ;;
    esac
    # \`cat-file -e <plan>:.ultrapowers/gate-verdicts.json\`: the record is on the
    # branch unless the case says otherwise.
    [ -n "\${STUB_NO_VERDICTS:-}" ] && exit 1
    exit 0 ;;
  worktree)
    # \`worktree add\` is answered by creating the directory. The first
    # non-flag word after \`add\` is the path.
    wt=""; seen=""
    for a in "$@"; do
      if [ -n "$seen" ]; then
        case "$a" in -*) ;; *) wt="$a"; break ;; esac
      fi
      [ "$a" = "add" ] && seen=1
    done
    if [ -n "$wt" ]; then
      mkdir -p "$wt"
      [ -e "$wt/.git" ] || printf 'gitdir: %s\\n' "$wt" >"$wt/.git"
    fi ;;
  commit)
    # A commit is the moment the evidence becomes readable off the box, so
    # snapshot the status page exactly as it is committed.
    snap="$dir/.ultrapowers/runs/7/status.json"
    [ -f "$snap" ] && cat "$snap" >>"$FLEET_HOME/commits.log"
    # And the names the run directory carried AT THAT MOMENT, one line per
    # commit, \`ls\` order and space-separated. The snapshot above says what the
    # page held; this says what the tree held — so a file written after the
    # last commit, which never reaches the branch, is a name no line carries.
    ls "$dir/.ultrapowers/runs/7" 2>/dev/null | tr '\\n' ' ' >>"$FLEET_HOME/trees.log"
    printf '\\n' >>"$FLEET_HOME/trees.log" ;;
  push)
    case "$*" in
      *evidence-run-7*)
        [ -n "\${STUB_EVIDENCE_PUSH_FAIL:-}" ] && exit 1
        # Refused only WHILE THE ENGINE UNIT IS ALIVE (#723): the phase pushes
        # the refresher makes beside it are refused, the \`running\` push before
        # it and every push after it are accepted — so a case can ask what a
        # refused phase push does to a run without failing the run before the
        # engine ever starts.
        if [ -n "\${STUB_EVIDENCE_PUSH_FAIL_WHILE_ENGINE:-}" ] && [ -e "$FLEET_HOME/stub/engine-alive" ]; then
          printf 'error: failed to push some refs\\n' >&2; exit 1
        fi ;;
      # A refused push of the run's own branch. STUB_INTEGRATION_PUSH_FAIL
      # refuses every one of them; STUB_LEASE_FAIL refuses only the LEASED
      # push, which is the remote having moved under the head this run pushed.
      *integration-run-7*)
        [ -n "\${STUB_INTEGRATION_PUSH_FAIL:-}" ] && {
          printf 'error: failed to push some refs\\n' >&2; exit 1
        }
        case "$*" in
          *--force-with-lease*)
            [ -n "\${STUB_LEASE_FAIL:-}" ] && {
              printf 'stale info: refusing to update ultra/integration-run-7\\n' >&2; exit 1
            } ;;
        esac ;;
    esac ;;
esac
exit 0
`,
  // Never called: the PR is one REST POST through curl. A CALL line from gh
  // is a finding.
  gh: `say "gh DIRECT $*"; exit 0`,
  // Two transient services. The status server is started and forgotten; the
  // engine is run to completion. The engine stub records its own environment —
  // which is the BOOT SCRIPT'S, because the child's two Anthropic variables
  // ride in this stub's argv (an \`env\` prefix), not in its environment.
  'systemd-run': `
argv "systemd-run" "$@"
unit=""
for a in "$@"; do case "$a" in --unit=*) unit="\${a#--unit=}" ;; esac; done
case "$unit" in
  fleet-status) say "systemd-run status"; exit 0 ;;
  fleet-fold-*)
    # THE FOLDER'S UNIT, and it comes first: every other unit here is the
    # engine, so a fold unit that fell through would be answered as one. The
    # folder itself belongs to a sibling task and is never run — this writes
    # what it would have left in the evidence worktree and exits.
    attempt="\${unit##*-}"
    fold="$FLEET_HOME/evidence/.ultrapowers/runs/7/publish-fold"
    # The boot script mkdir's this before the unit starts, because its \`tee\`
    # needs it; a case reads this line to prove it did.
    [ -d "$fold" ] && say "fold dir present $attempt"
    # The line NAMES ITS UNIT: a sim finds a fold's start in the stream by the
    # unit name, which is how it orders the page write, the unit and its await.
    say "systemd-run fold $unit"
    # Its OWN env file, never systemd-run.env: that one is the engine's, and a
    # case reads it to prove the engine ran under an envelope with no token.
    env >"$FLEET_HOME/fold.env"
    mkdir -p "$fold" "$FLEET_HOME/stub"
    # THE CLOCK ADVANCES HERE (#808), once per fold unit and nowhere else: a
    # fold is the only thing this rig runs that takes real time on the box, so
    # it is the only place a case may charge time for. The \`date\` stub reads
    # this file, and STUB_CLOCK_STEP defaults to 0 — every case that does not
    # ask for a clock keeps the real one.
    clock=0
    [ -f "$FLEET_HOME/stub/clock" ] && clock="$(cat "$FLEET_HOME/stub/clock")"
    case "$clock" in ''|*[!0-9]*) clock=0 ;; esac
    step="\${STUB_CLOCK_STEP:-0}"
    case "$step" in ''|*[!0-9]*) step=0 ;; esac
    printf '%s\\n' "$(( clock + step ))" >"$FLEET_HOME/stub/clock"
    [ "$attempt" = 2 ] && : >"$FLEET_HOME/stub/fold-2"
    if [ -z "\${STUB_FOLD_NO_HEAD:-}\${STUB_FOLD_NO_ENGINE_HEAD:-}" ]; then
      printf '%s\\n' "\${STUB_FOLD_ENGINE_HEAD:-$STUB_HEAD_SHA}" >"$fold/engine-head"
    fi
    if [ "$attempt" = 2 ]; then
      code="\${STUB_FOLD_CODE_2:-0}"
      dis="\${STUB_FOLD_DISPOSITION_2:-\${STUB_FOLD_DISPOSITION:-folded}}"
      cand="\${STUB_FOLD_CANDIDATE_2:-}"
      row=1
      [ "$code" != 0 ] && [ -z "\${STUB_FOLD_DISPOSITION_2:-}" ] && row=""
    else
      code="\${STUB_FOLD_CODE:-0}"
      dis="\${STUB_FOLD_DISPOSITION:-folded}"
      cand="\${STUB_FOLD_CANDIDATE:-}"
      row=1
      # A folder that died wrote no disposition, UNLESS the case says it wrote
      # one and then died — which is the other half of that rule.
      [ "$code" != 0 ] && [ -z "\${STUB_FOLD_DISPOSITION:-}" ] && row=""
    fi
    if [ -n "\${STUB_FOLD_BAD_RECEIPT:-}\${STUB_FOLD_RECEIPT_BAD:-}" ]; then
      printf '{not json\\n' >"$fold/receipt.json"
    elif [ -n "$row" ]; then
      FOLD_N="$attempt" FOLD_DIS="$dis" FOLD_CAND="$cand" \\
        FOLD_PATH="\${STUB_FOLD_PATH:-}" FOLD_REASON="\${STUB_FOLD_REASON:-}" \\
        FOLD_RESOLVERS="\${STUB_FOLD_RESOLVERS:-0}" \\
        FOLD_JOINED="\${STUB_FOLD_PATHS_JOINED:-0}" \\
        FOLD_HEAD="\${STUB_FOLD_ENGINE_HEAD:-$STUB_HEAD_SHA}" \\
        python3 - "$fold/receipt.json" <<'PY'
import json, os, sys
path = sys.argv[1]
try:
    doc = json.load(open(path))
    if not isinstance(doc, dict):
        raise ValueError("not an object")
except Exception:
    doc = {}
doc.setdefault("engineHead", os.environ["FOLD_HEAD"])
if not isinstance(doc.get("attempts"), dict):
    doc["attempts"] = {}
n = os.environ["FOLD_N"]
row = doc["attempts"].get(n) or {}
row["tip"] = os.environ["FOLD_HEAD"]
row["disposition"] = os.environ["FOLD_DIS"]
row["resolversDispatched"] = int(os.environ["FOLD_RESOLVERS"] or 0)
row["pathsJoined"] = int(os.environ["FOLD_JOINED"] or 0)
if os.environ["FOLD_CAND"]:
    row["candidate"] = os.environ["FOLD_CAND"]
if os.environ["FOLD_PATH"]:
    row["path"] = os.environ["FOLD_PATH"]
if os.environ["FOLD_REASON"]:
    row["reason"] = os.environ["FOLD_REASON"]
doc["attempts"][n] = row
tmp = path + ".tmp"
with open(tmp, "w") as fh:
    json.dump(doc, fh, indent=2)
    fh.write("\\n")
os.replace(tmp, path)
PY
    fi
    [ "$dis" = "suite red" ] && printf '%s\\n' "\${STUB_FOLD_SUITE:-}" >"$fold/suite-$attempt.txt"
    if [ -n "\${STUB_FOLD_PARK:-}" ]; then
      # THE DEADMAN, as it is seen from inside the unit: the page goes to
      # \`parked\` while the fold is still running, and the unit is stopped —
      # which from the boot script's side is a non-zero exit with a parked page
      # in front of it.
      mkdir -p "$FLEET_HOME/www"
      printf '{"run":"7","state":"parked","phase":"deadman","pr":null,"prAuthor":null,"merged":null,"branch":"ultra/integration-run-7","vm":"%s","startedAt":"2026-09-06T00:00:00Z","updatedAt":"2026-09-06T00:00:01Z","error":"deadman: parked by hand without done"}\\n' \\
        "$STUB_VM_NAME" >"$FLEET_HOME/www/status.json"
      # The page only — NO \`status:\` line in the boot log. That log is the boot
      # script's own voice, and a sim reads it to prove the script wrote nothing
      # after the deadman's page; a line forged here would read as its writing.
      printf '%s\\n' "$STUB_FOLD_LINE"
      exit "\${STUB_FOLD_PARK_CODE:-143}"
    fi
    # One line on stdout: the boot script tees it into
    # publish-fold-<attempt>.log, where it is the last line a crash row quotes.
    printf '%s\\n' "$STUB_FOLD_LINE"
    exit "$code" ;;
esac
env >"$FLEET_HOME/systemd-run.env"
say "systemd-run engine"
run_dir="$FLEET_HOME/target/.claude/ultrapowers/run-run-7"
mkdir -p "$run_dir" "$FLEET_HOME/stub"
# THE ENGINE'S LIFE, AS A FILE. The \`git\` stub refuses evidence pushes while it
# exists (STUB_EVIDENCE_PUSH_FAIL_WHILE_ENGINE), which is the only way to refuse
# the pushes the refresher makes BESIDE this unit without also refusing the
# \`running\` push that comes before it and the \`publishing\` one that comes after.
: >"$FLEET_HOME/stub/engine-alive"
# The phases this engine reaches, as \`engine:phase\` lines. UNSET is the one
# \`gate\` line this stub has always written; SET BUT EMPTY is an engine that
# reaches no phase at all; otherwise a \`|\`-separated list, written in order.
#
# After each entry the stub WAITS for the boot script to relay it — for
# \`$FLEET_HOME/www/status.json\` to carry that phase — before writing the next.
# That handshake is what makes every listed phase a RELAYED phase, so the exam
# counts commits instead of racing the refresher's interval.
if [ -z "\${STUB_ENGINE_PHASES+set}" ]; then
  printf '%s\n' '${ENGINE_EVENT_LINE.trimEnd()}' >"$run_dir/events.jsonl"
else
  : >"$run_dir/events.jsonl"
  rest="$STUB_ENGINE_PHASES"; i=0
  while [ -n "$rest" ]; do
    case "$rest" in
      *"|"*) p="\${rest%%|*}"; rest="\${rest#*|}" ;;
      *) p="$rest"; rest="" ;;
    esac
    i=$((i + 1))
    printf '{"kind":"engine:phase","phase":"%s","id":"x","ts":%s}\n' "$p" "$i" >>"$run_dir/events.jsonl"
    n=0
    until grep -q "\\"phase\\":\\"$p\\"" "$FLEET_HOME/www/status.json" 2>/dev/null; do
      n=$((n + 1))
      if [ "$n" -ge 200 ]; then
        say "systemd-run engine: phase $p never reached the page"
        rm -f "$FLEET_HOME/stub/engine-alive"
        exit 3
      fi
      sleep 0.1
    done
  done
fi
# The engine talks on stdout and stderr, and a run that dies before its gate
# leaves nothing else behind.
printf 'run-main: preflight\\n'
printf 'run-main: knob-validate-failed\\n' >&2
if [ -z "\${STUB_NO_RECEIPT:-}" ]; then
  # The two records the boot script reads back out of the evidence copy, each
  # replaceable whole by a knob: UNSET is the one-field default this stub has
  # always written, SET is that value and one newline.
  if [ -n "\${STUB_GATE_RECEIPT+set}" ]; then
    printf '%s\\n' "$STUB_GATE_RECEIPT" >"$run_dir/gate-receipt.json"
  else
    printf '{"verdict":"%s"}\\n' "$STUB_VERDICT" >"$run_dir/gate-receipt.json"
  fi
  # An EMPTY \`STUB_REPORT\` means NO REPORT AT ALL — not an empty file: an
  # engine that died between its receipt and its report leaves the path absent,
  # and that is the case a reader of the report has to survive.
  if [ -n "\${STUB_REPORT+set}" ]; then
    if [ -n "$STUB_REPORT" ]; then
      printf '%s\\n' "$STUB_REPORT" >"$run_dir/report.json"
    fi
  else
    printf '%s\\n' '${DEFAULT_REPORT}' >"$run_dir/report.json"
  fi
  printf '{"argsFile":"x"}\\n' >"$run_dir/receipt.json"
fi
[ -n "\${STUB_ENGINE_SLEEP:-}" ] && sleep "$STUB_ENGINE_SLEEP"
# AN ENGINE THE SIM ENDS, not the clock: with STUB_ENGINE_HOLD set the unit
# stays alive — and the boot script's refresher keeps ticking beside it — until
# the case writes \`$FLEET_HOME/stub/engine-release\`. That is what lets a leg
# append its own lines to the run dir's events.jsonl, move the stub clock, read
# the page and the commits, and only then let the run finish \`publishing →
# done\` like every other green one. The cap is two minutes of 0.05s polls: a
# sim that forgets to release leaves a red run, never a wedged suite.
if [ -n "\${STUB_ENGINE_HOLD:-}" ]; then
  held=0
  until [ -f "$FLEET_HOME/stub/engine-release" ]; do
    held=$((held + 1))
    if [ "$held" -ge 2400 ]; then
      say "systemd-run engine: engine-release never arrived"
      rm -f "$FLEET_HOME/stub/engine-alive"
      exit 3
    fi
    sleep 0.05
  done
fi
# Removed IMMEDIATELY before the exit: from here on the unit is done and every
# evidence push is accepted again.
rm -f "$FLEET_HOME/stub/engine-alive"
exit \${STUB_ENGINE_CODE:-0}
`,
  // THE CLOCK (#808), and the only stub that lies — about exactly one reading.
  // `FLEET_BIN_DIR` is prefixed to PATH by the boot script, so this file is what
  // every `date` call resolves to: the boot's `now_iso` and `log` stamps, the
  // elapsed-seconds arithmetic of its poll loops, and the prelude's own `say`.
  //
  // `+%s` — the argv `merge_pr` measures the fold-again window with — answers
  // the REAL epoch plus the integer in `$FLEET_HOME/stub/clock`, which is 0
  // when the file is absent and which the `systemd-run` stub advances by
  // `STUB_CLOCK_STEP` once per fold unit. So a case sets a window of an hour
  // and outlasts it in three forks, and the seconds the boot reports are the
  // seconds it measured — never a number this rig wrote.
  //
  // Every OTHER argv goes to `/bin/date` unchanged, by ABSOLUTE PATH: both
  // `date` and `command -v date` find THIS file, so anything else is the stub
  // calling itself. And it says nothing — no `say`, no `argv` — because `say`
  // stamps its line with a `date` call, which would recurse through the one log
  // the ordering assertions read.
  date: `
off=0
if [ -f "\${FLEET_HOME:-}/stub/clock" ]; then off="$(cat "$FLEET_HOME/stub/clock")"; fi
case "$off" in ''|*[!0-9]*) off=0 ;; esac
case "$*" in
  "+%s") printf '%s\\n' "$(( $(/bin/date +%s) + off ))"; exit 0 ;;
esac
exec /bin/date "$@"
`,
  systemctl: `
argv "systemctl" "$@"
say "systemctl $2 $3"
if [ "$2" = "is-active" ]; then
  case "$3" in
    fleet-status.service) printf '%s\\n' "\${STUB_STATUS_ACTIVE:-inactive}" ;;
    fleet-engine-*) printf '%s\\n' "\${STUB_ENGINE_ACTIVE:-inactive}" ;;
    fleet-fold-*) printf '%s\\n' "\${STUB_FOLD_ACTIVE:-inactive}" ;;
    *) printf 'inactive\\n' ;;
  esac
fi
exit 0
`,
  npm: `
argv "npm" "$@"
say "npm $1 in $PWD"
exit 0
`,
  // Both reads the boot script makes of the engine binary, recorded in an argv
  // log of its own so a case can count them. `STUB_AUTH` UNSET is the green
  // box (`oauth_token`); set to a word it is that word; SET BUT EMPTY is the
  // `claude` that answers nothing at all, which is a box with no oauth_token
  // just as surely as one that names another method.
  claude: `
argv "claude" "$@"
say "claude $*"
case "$1" in
  --version)
    printf '%s\\n' "\${STUB_CLAUDE_VERSION:-2.1.250 (Claude Code)}"
    exit 0 ;;
esac
[ -z "\${STUB_AUTH-oauth_token}" ] && exit 0
printf 'authMethod: %s\\napiProvider: firstParty\\n' "\${STUB_AUTH-oauth_token}"
exit 0
`,
  // Never called directly by the boot script: busybox and node are argv to
  // systemd-run, loginctl is the image's, and nothing on this box reaches
  // another one. A CALL line from any of them is a finding.
  busybox: `say "busybox DIRECT $*"; exit 0`,
  node: `say "node DIRECT $*"; exit 0`,
  loginctl: `say "loginctl DIRECT $*"; exit 0`,
  ssh: `say "ssh DIRECT $*"; exit 0`,
}

export const PRELUDE = `#!/bin/sh
say() { printf '%s CALL %s\\n' "$(date -u +%H:%M:%SZ)" "$1" >>"$FLEET_HOME/fleet-boot.log"; }
argv() { name="$1"; shift; { for a in "$name" "$@"; do printf '%s\\t' "$a"; done; printf '\\n'; } >>"$FLEET_HOME/$name.log"; }
`

// ── harness ──────────────────────────────────────────────────────────────────

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-boot-'))
let caseNo = 0

/**
 * The environment for a child that belongs to no case — `bash -n` over the
 * script, a reader run against the repository. Nothing of the box reaches it.
 */
export const ENV = simEnv()

/**
 * The environment for a stub called directly, WITHOUT a boot: the case's own
 * stub dir first on `PATH`, `FLEET_HOME` its home, `env` last so a caller can
 * override any of it. The stubs answer out of that home.
 */
export const stubEnv = (ctx, env) => ({ ...simEnv({ bin: ctx.bin, home: ctx.home }), ...env })

/**
 * The renderer address file a boot reads, INSIDE the case's own home.
 *
 * The boot script falls back to a path on the box when `FLEET_RENDER_ENV` names
 * nothing, and on a sandbox whose setup installed one that file is readable —
 * so a sim that planted nothing would still source the host's renderer and its
 * engine argv would carry a live URL. The rig therefore always names a path of
 * its own: `<home>/render.env`, which `makeHome` does NOT create, so the
 * default is a path that does not exist until a sim writes it there.
 */
export const renderEnvPath = (ctx) => path.join(ctx.home, 'render.env')

export function makeHome({ packageJson = '{"name":"fleet"}', nodeModules = true } = {}) {
  caseNo += 1
  const home = path.join(tmpRoot, `home-${caseNo}`)
  const bin = path.join(home, 'bin')
  fs.mkdirSync(path.join(home, 'stub'), { recursive: true })
  fs.mkdirSync(bin, { recursive: true })
  for (const [name, body] of Object.entries(STUBS)) {
    const file = path.join(bin, name)
    fs.writeFileSync(file, PRELUDE + body)
    fs.chmodSync(file, 0o755)
  }
  // The bootstrap's clone, at the sha the assignment names.
  const engine = path.join(home, 'engines', ENGINE_SHA, 'fleet')
  fs.mkdirSync(engine, { recursive: true })
  fs.writeFileSync(path.join(engine, 'run-main.mjs'), '')
  // The folder's entrypoint sits beside the engine's in the same checkout —
  // never executed here (the `fleet-fold-*` unit is answered by the
  // `systemd-run` stub), present so the path the boot script names is real.
  fs.writeFileSync(path.join(engine, 'publish-fold.mjs'), '')
  // The strip the boot script runs before every push of the run's branch, in
  // the same checkout. A STUB, and a talking one: it appends its argv to the
  // one stream in the `say` shape every other stub uses, so a sim reads its
  // position against the fold's unit and the push, and exits 0. What the real
  // `fleet/strip-exams.sh` does to a branch is proven against real git
  // repositories in `fleet/tests/test_strip_exams.mjs`.
  fs.writeFileSync(
    path.join(engine, 'strip-exams.sh'),
    PRELUDE + 'say "strip-exams $*"\nexit 0\n',
  )
  fs.writeFileSync(path.join(engine, 'package.json'), packageJson)
  if (nodeModules) fs.mkdirSync(path.join(engine, 'node_modules'))
  return { home, bin }
}

/**
 * The environment a boot runs under, `env` last so a case can override any of
 * it. One object, read by both the blocking `boot` and the promised
 * `bootAsync`, so the two start the script exactly alike.
 */
const bootEnv = (ctx, env) => ({
      ...simEnv({ bin: ctx.bin, home: ctx.home }),
      FLEET_BIN_DIR: ctx.bin,
      FLEET_POLL_SECONDS: '0',
      FLEET_STATUS_INTERVAL: '30',
      FLEET_ASSIGNMENT: ASSIGNMENT,
      // The renderer address the boot reads, pinned into the case's own home so
      // no sim can reach the one the box's setup installed. A case that wants a
      // renderer writes the file at `renderEnvPath(ctx)`; one that wants none
      // writes nothing and the boot sources nothing.
      FLEET_RENDER_ENV: renderEnvPath(ctx),
      // In the boot script's OWN environment, to prove the child's `env -u`
      // removes it and that the two Anthropic variables are never here.
      CLAUDE_CONFIG_DIR: '/should/be/unset/in/the/child',
      STUB_VM_NAME: VM_NAME,
      STUB_COMMENT: ASSIGNMENT,
      STUB_VERDICT: 'PASS',
      STUB_PR_BODY: PR_JSON,
      STUB_PLAN_STEM: PLAN_STEM,
      STUB_PLAN_HEAD: PLAN_HEAD,
      STUB_PLAN_TASKS: PLAN_TASKS,
      STUB_PLAN_SHA: PLAN_SHA,
      STUB_HEAD_SHA: HEAD_SHA,
      STUB_MERGE_SHA: MERGE_SHA,
      // The fold stub's defaults: a clean fold that moves the branch to a head
      // of its own, one line of output, and the suite text a `suite red` case
      // gets without asking for one.
      STUB_FOLD_CANDIDATE: FOLD_CANDIDATE,
      STUB_FOLD_CANDIDATE_2: FOLD_CANDIDATE_2,
      STUB_FOLD_LINE: FOLD_STUB_LINE,
      STUB_FOLD_SUITE: FOLD_SUITE_TEXT,
      ...env,
})

/**
 * The trailing `script` argument of both runners (#808): which file `bash` is
 * handed, defaulting to the script under test. The boot script has no `$0` or
 * `BASH_SOURCE` self-reference, so a COPY of it — under `ctx.home`, with a line
 * cut out — runs identically, which is how a sim shows a leg going red against
 * the mutant that lost the behaviour it asserts. Nothing else about the run
 * changes: same argv after the script, same environment, same stubs.
 */
export function boot(ctx, args = ['boot'], env = {}, script = SCRIPT) {
  return spawnSync('bash', [script, ...args], {
    encoding: 'utf8',
    env: bootEnv(ctx, env),
    timeout: 60000,
  })
}

/**
 * `boot` as a promise: the same command, the same environment and a result of
 * the same shape (`status`, `signal`, `stdout`, `stderr`), without holding the
 * process while the script runs.
 *
 * Every scenario of a boot exam is independent of every other — its own
 * `home`, its own stub counters, its own logs — so a sim with many of them can
 * start them all and wait once. That is the difference between forty-seven
 * boots one after another and forty-seven at once, and it is the only reason
 * this exists: `boot` above is unchanged and still the way a synchronous case
 * runs the script.
 *
 * The promise resolves on ANY exit — a non-zero status is the leg's to assert
 * on, exactly as `boot`'s is — and rejects only when the child could not be
 * started at all.
 *
 * `script` is `boot`'s, and means the same thing here.
 */
export function bootAsync(ctx, args = ['boot'], env = {}, script = SCRIPT) {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', [script, ...args], {
      env: bootEnv(ctx, env),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (status, signal) => resolve({ status, signal, stdout, stderr }))
  })
}

export const readLog = (ctx, name) => {
  const f = path.join(ctx.home, name)
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''
}
export const lines = (text) => text.split('\n').filter(Boolean)
export const argvLines = (ctx, tool) =>
  lines(readLog(ctx, `${tool}.log`)).map((l) => l.split('\t').filter((s) => s !== ''))
export const stream = (ctx) => lines(readLog(ctx, 'fleet-boot.log')).map((l) => l.replace(/^\S+ /, ''))
export const statusOf = (ctx) => JSON.parse(fs.readFileSync(path.join(ctx.home, 'www', 'status.json'), 'utf8'))
export const states = (ctx) => {
  const out = []
  for (const l of stream(ctx)) {
    const m = /^status: state=(\S+)/.exec(l)
    if (m && out[out.length - 1] !== m[1]) out.push(m[1])
  }
  return out
}
export const indexOf = (ctx, needle) => stream(ctx).findIndex((l) => l.includes(needle))
export const lastIndexOf = (ctx, needle) => {
  const s = stream(ctx)
  for (let i = s.length - 1; i >= 0; i -= 1) if (s[i].includes(needle)) return i
  return -1
}
export const notifies = (ctx) => lines(readLog(ctx, 'notify.log')).map((l) => JSON.parse(l))
/** The status page as it stood at each evidence commit, oldest first. */
export const committed = (ctx) => lines(readLog(ctx, 'commits.log')).map((l) => JSON.parse(l))
export const commitStates = (ctx) => committed(ctx).map((c) => c.state)
/** The `phase` cell of each committed page, in commit order — the branch's own
 *  account of what the run was doing at every commit it made (#723). */
export const commitPhases = (ctx) => committed(ctx).map((c) => c.phase)
/** The run directory's names at each evidence commit, oldest first — one line
 *  per commit, space-separated in `ls` order. `[]` when the run made none. */
export const trees = (ctx) => lines(readLog(ctx, 'trees.log'))
/**
 * What the refresher relayed to the LIVE PAGE while the engine unit was alive:
 * the consecutive-deduplicated phases of the `status: state=running phase=…`
 * lines between the engine's `systemd-run` line and `engine: exited`. The
 * `engine starting` page is written before the unit and is therefore not one of
 * them, and the deduplication is what makes this the list of phases the page
 * did not carry before — the same list the evidence branch owes one commit each.
 */
export const relayedPhases = (ctx) => {
  const s = stream(ctx)
  const from = s.findIndex((l) => l.includes('CALL systemd-run engine'))
  const out = []
  if (from < 0) return out
  let to = s.findIndex((l) => l.includes('engine: exited'))
  if (to < 0) to = s.length
  for (let i = from + 1; i < to; i += 1) {
    const m = /^status: state=running phase=(.*)$/.exec(s[i])
    if (m && out[out.length - 1] !== m[1]) out.push(m[1])
  }
  return out
}
export const unitsRun = (ctx) => argvLines(ctx, 'systemd-run').map((a) => a.find((s) => s.startsWith('--unit='))?.slice(7))
export const engineRuns = (ctx) => unitsRun(ctx).filter((u) => u === 'fleet-engine-7').length
export const directCalls = (ctx) => stream(ctx).filter((l) => l.includes(' DIRECT '))
/** Every POST /pulls the script made, as its parsed JSON payload. */
export const prPosts = (ctx) => lines(readLog(ctx, 'pr.log')).map((l) => JSON.parse(l))
/** The curl argv of the PR POST, or undefined. */
export const prArgv = (ctx) => argvLines(ctx, 'curl').find((a) => a.some((s) => s.endsWith('/pulls')))
/** Every merge PUT the script made, as its parsed JSON payload. */
export const mergePuts = (ctx) => lines(readLog(ctx, 'merge.log')).map((l) => JSON.parse(l))
/** The curl argv of the merge PUT, or undefined. */
export const mergeArgv = (ctx) => argvLines(ctx, 'curl').find((a) => a.some((s) => s.endsWith('/merge')))
/** How many requests this run made whose URL names a head's check runs.
 *
 *  Counted over the RECORDED CURL ARGV rather than over a stub arm, because
 *  there is no longer an arm to count: the merge does not ask GitHub what it
 *  thinks of the head, so a request like this would fall through to the curl
 *  stub's `UNKNOWN` and exit 22. This says zero on the merge path, and it is a
 *  real reading of what went out rather than a stub that was never wired.
 *  `checkReads` is the older name, kept so a sim written against it still
 *  counts the same thing. */
export const checkRunRequests = (ctx) =>
  argvLines(ctx, 'curl').filter((a) => a.some((s) => s.includes('check-runs'))).length
export const checkReads = checkRunRequests
/** How many times Reflection's /integrations was read. */
export const integrationsReads = (ctx) => stream(ctx).filter((l) => l.startsWith('CALL curl integrations')).length

// ── reading the publish fold ─────────────────────────────────────────────────

/** The fold's directory inside the evidence worktree. */
export const foldDir = (ctx) => path.join(ctx.home, 'evidence', FOLD_PATH)
/** One of the fold's files, or '' when the run wrote none. */
export const foldFile = (ctx, name) => {
  const f = path.join(foldDir(ctx), name)
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''
}
/** The fold receipt as this run left it, or null when there is none. */
export const foldReceipt = (ctx) => {
  const raw = foldFile(ctx, 'receipt.json')
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}
/** One attempt's row, `{}` when the receipt names none. */
export const foldAttempt = (ctx, attempt = 1) => (foldReceipt(ctx)?.attempts || {})[String(attempt)] || {}
/** Every `fleet-fold-*` unit this run started, in order. */
export const foldUnits = (ctx) => unitsRun(ctx).filter((u) => u && u.startsWith('fleet-fold-'))
/** The `systemd-run` argv of one fold attempt, or undefined. */
export const foldArgv = (ctx, attempt = 1) =>
  argvLines(ctx, 'systemd-run').find((a) => a.includes(`--unit=fleet-fold-7-${attempt}`))
// ── reading the run's event log ──────────────────────────────────────────────
//
// ONE file, two copies: the engine writes `events.jsonl` in the run directory
// and the boot script appends its publish record there; `collect_evidence`
// copies it onto the evidence branch at every transition. Both are read here,
// so a sim can compare them and none has to spell either path itself.

/** The run directory the engine and the boot script share. */
export const runDir = (ctx) => path.join(ctx.home, 'target', RUN_DIR_PATH)
/** The run directory's event log, or ''. */
export const eventsRaw = (ctx) => {
  const f = path.join(runDir(ctx), 'events.jsonl')
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''
}
/** The evidence branch's copy of it, or ''. */
export const evidenceEventsRaw = (ctx) => {
  const f = path.join(ctx.home, 'evidence', RUN_PATH, 'events.jsonl')
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''
}
/** Both files as paths, for a byte-for-byte comparison. */
export const eventsFile = (ctx) => path.join(runDir(ctx), 'events.jsonl')
export const evidenceEventsFile = (ctx) => path.join(ctx.home, 'evidence', RUN_PATH, 'events.jsonl')
/** Every record in the run dir's log, IN FILE ORDER — never sorted, because
 *  file order is what a reader of an append-only log has to be able to trust. */
export const events = (ctx) => lines(eventsRaw(ctx)).map((l) => JSON.parse(l))
/** The evidence copy's records, in file order. */
export const evidenceEvents = (ctx) => lines(evidenceEventsRaw(ctx)).map((l) => JSON.parse(l))
/** Only what the boot script appended: the publish record. */
export const publishEvents = (ctx) => events(ctx).filter((e) => String(e.kind).startsWith('publish:'))
/** Every event of one kind, in file order. */
export const eventsOfKind = (ctx, kind) => events(ctx).filter((e) => e.kind === kind)
/** The millisecond clock an id carries — its first ten characters read as
 *  Crockford base 32, most significant first (the engine's `b32(ts, 10)`). */
export const ulidTs = (id) =>
  [...String(id).slice(0, 10)].reduce((n, c) => n * 32 + B32.indexOf(c), 0)

/** The PR body PATCHes the script sent, as parsed payloads. */
export const patches = (ctx) => lines(readLog(ctx, 'patch.log')).map((l) => JSON.parse(l))
/** How many times the PR document was read for its `mergeable`. */
export const mergeableReads = (ctx) => stream(ctx).filter((l) => l.startsWith('CALL curl pr read')).length
/** Every `git update-ref` the script made. */
export const updateRefs = (ctx) => gitLog(ctx).filter((a) => verbOf(a) === 'update-ref')
/** Every push that carried a lease, and the lease each one asserted. */
export const leasePushes = (ctx) =>
  gitLog(ctx).filter((a) => a.some((s) => s.startsWith('--force-with-lease=')))
export const leaseOf = (a) => a.find((s) => s.startsWith('--force-with-lease='))?.slice(19)

// ── reading the hub's record ─────────────────────────────────────────────────
//
// Two files and one stream. `run-7.kata.json` is what the boot read off the
// plan commit — the path the engine's `--kata` pair carries — and `kata.jsonl`
// on the evidence branch is what the export wrote back. The kata URLs are read
// off the recorded curl argv, so a leg can count an export's pages and see
// which cursors it followed.

/** Where the boot lands the plan commit's `.ultrapowers/kata.json`. */
export const kataPlanFile = (ctx) => path.join(ctx.home, 'plans', 'run-7.kata.json')
/** Its bytes as the boot wrote them, or '' when the run landed none. */
export const kataPlanRaw = (ctx) => {
  const f = kataPlanFile(ctx)
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''
}
/** The evidence branch's `kata.jsonl`, or '' when the run exported none. */
export const kataJsonlFile = (ctx) => path.join(ctx.home, 'evidence', RUN_PATH, 'kata.jsonl')
export const kataJsonlRaw = (ctx) => {
  const f = kataJsonlFile(ctx)
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''
}
/** Its lines, in file order — every issue, then the event log. */
export const kataJsonl = (ctx) => lines(kataJsonlRaw(ctx))
/** Every kata URL this run asked for, in order. */
export const kataUrls = (ctx) =>
  argvLines(ctx, 'curl')
    .map((a) => a.find((s) => s.startsWith(KATA_URL)))
    .filter(Boolean)

// ── reading the git log ──────────────────────────────────────────────────────

/** The subcommand, whether or not the call carried `-C <dir>`. */
export const verbOf = (a) => (a[1] === '-C' ? a[3] : a[1])
/** The `-C` directory, or '' when the call carried none. */
export const dirOf = (a) => (a[1] === '-C' ? a[2] : '')
export const gitLog = (ctx) => argvLines(ctx, 'git')
export const evidenceDir = (ctx) => `${ctx.home}/evidence`
export const targetDir = (ctx) => `${ctx.home}/target`

export const isEvidencePush = (a) =>
  verbOf(a) === 'push' && a.some((s) => s === `HEAD:refs/heads/${EVIDENCE_BRANCH}`)
export const isIntegrationPush = (a) =>
  verbOf(a) === 'push' && a.some((s) => s === INTEGRATION_BRANCH) && !isEvidencePush(a)
/** Every path word a `git add` carried, `--` aside. */
export const addArguments = (git) =>
  git
    .filter((a) => verbOf(a) === 'add')
    .flatMap((a) => a.slice(a.indexOf('add') + 1))
    .filter((s) => s !== '--')

/**
 * M2's discipline, as one predicate over the git log, so that leg (d) can show
 * it rejecting a log it must reject. Returns the first problem, or null.
 *
 *  - every push of the evidence branch is made with `-C <home>/evidence`,
 *  - and is preceded by an `add` and a `commit` in that same worktree since
 *    the previous evidence push (one commit per transition),
 *  - and the FIRST evidence push comes before the integration branch's push.
 */
export function evidenceDisciplineProblem(git, evidence) {
  let addSincePush = false
  let commitSincePush = false
  let firstEvidencePush = -1
  let firstIntegrationPush = -1
  for (let i = 0; i < git.length; i += 1) {
    const a = git[i]
    const here = dirOf(a) === evidence
    const verb = verbOf(a)
    if (here && verb === 'add') addSincePush = true
    if (here && verb === 'commit') commitSincePush = true
    if (isEvidencePush(a)) {
      if (!here) return `evidence push ${i} runs in '${dirOf(a)}', not the evidence worktree`
      if (!addSincePush) return `evidence push ${i} has no '-C ${evidence} add' since the previous push`
      if (!commitSincePush) return `evidence push ${i} has no '-C ${evidence} commit' since the previous push`
      if (firstEvidencePush < 0) firstEvidencePush = i
      addSincePush = false
      commitSincePush = false
    }
    if (isIntegrationPush(a) && firstIntegrationPush < 0) firstIntegrationPush = i
  }
  if (firstEvidencePush < 0) return 'no evidence push at all'
  if (firstIntegrationPush >= 0 && firstIntegrationPush < firstEvidencePush) {
    return `the integration push (${firstIntegrationPush}) precedes the first evidence push (${firstEvidencePush})`
  }
  return null
}

// One green run per process, read by every assertion that only reads. A boot
// is ~40 forks of stub shell; running it eight times to ask eight questions of
// the same run is the difference between an exam that fits its budget and one
// that does not.
let GREEN = null
export const green = () => {
  if (!GREEN) {
    GREEN = makeHome()
    const r = boot(GREEN)
    assert.equal(r.status, 0, r.stdout + r.stderr)
  }
  return GREEN
}

// The same one green run, for a sim whose legs run their boots side by side.
// What is memoised is the PROMISE and not its result: a dozen legs asking for
// the green context while the boot is still in flight all join the one boot,
// where a memo of the result would have started a dozen.
let GREEN_ASYNC = null
export const greenAsync = () => {
  if (!GREEN_ASYNC) {
    const ctx = makeHome()
    GREEN_ASYNC = bootAsync(ctx).then((r) => {
      assert.equal(r.status, 0, r.stdout + r.stderr)
      return ctx
    })
  }
  return GREEN_ASYNC
}

// ── the runner ───────────────────────────────────────────────────────────────

/**
 * Run `tests` — `[name, fn]` pairs — in order, printing one `ok (<ms> ms) —
 * <name>` line per passing case. Removes the temp root, then prints
 * `ALL TESTS PASSED`, or the failure count and `FAILED` with exit 1.
 *
 * A case may return a promise, which is awaited before the next one starts; a
 * case that returns nothing runs to completion inside its own turn, exactly as
 * it always has. The registration order is the running order either way.
 */
export async function runTests(tests) {
  let failures = 0
  for (const [name, fn] of tests) {
    const started = Date.now()
    try {
      await fn()
      console.log(`ok (${Date.now() - started} ms) — ${name}`)
    } catch (error) {
      failures += 1
      console.log(`FAIL — ${name}`)
      console.log(String(error && error.stack ? error.stack : error))
    }
  }
  fs.rmSync(tmpRoot, { recursive: true, force: true })
  if (failures) {
    console.log(`${failures} FAILED`)
    process.exit(1)
  }
  console.log('ALL TESTS PASSED')
}
