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
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
/** The squash commit GitHub answers a merge PUT with. */
export const MERGE_SHA = 'f6'.repeat(20)

// The three branches of #598, all on the target.
export const PLAN_BRANCH = 'ultra/plan-run-7'
export const EVIDENCE_BRANCH = 'ultra/evidence-run-7'
export const INTEGRATION_BRANCH = 'ultra/integration-run-7'
/** Where the evidence lives inside the evidence worktree. */
export const RUN_PATH = '.ultrapowers/runs/7'
/** The plan's path inside the plan commit's tree. */
export const PLAN_PATH = '.ultrapowers/plan.md'

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
/** What the stub writes to `publish-fold/suite-<attempt>.txt` on `suite red`. */
export const FOLD_SUITE_TEXT = 'FAIL fleet/tests/test_fold.py::test_join\n1 failed, 12 passed in 3.10s'
/** Its last line — the one the PR body has to carry. */
export const FOLD_SUITE_LAST = '1 failed, 12 passed in 3.10s'
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
/** Exactly what `git show <plan>:.ultrapowers/plan.md` hands back. */
export const PLAN_BYTES = `# ${PLAN_H1}\n\nbody\n`
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
url=""; payload=""; prev=""; method=GET
for a in "$@"; do
  case "$a" in https://*) url="$a" ;; esac
  [ "$prev" = "-d" ] && payload="$a"
  [ "$prev" = "-X" ] && method="$a"
  prev="$a"
done
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
  *github.int.exe.xyz/api/v3/repos/*/commits/*/check-runs)
    # The PR head's check runs. The default is one completed, successful run —
    # so the green path merges. STUB_CHECKS_PENDING answers that many reads with
    # a run still going first (\`"conclusion": null\`, unquoted, the way GitHub
    # writes it); STUB_CHECKS replaces the body wholesale, which is how a case
    # answers a failure, several runs at once, or no run at all.
    n=$(bump checks); say "curl check-runs $n"
    body='{"total_count":1,"check_runs":[{"name":"test","status":"completed","conclusion":"success"}]}'
    if [ "$n" -le "\${STUB_CHECKS_PENDING:-0}" ]; then
      body='{"total_count":1,"check_runs":[{"name":"test","status":"in_progress","conclusion":null}]}'
    fi
    [ -n "\${STUB_CHECKS:-}" ] && body="$STUB_CHECKS"
    printf '%s\\n%s\\n' "$body" "\${STUB_CHECKS_CODE:-200}" ;;
  *github.int.exe.xyz/api/v3/repos/*/pulls/*/merge)
    # The say line is EXACTLY \`curl pr merge\`, with the count kept in the
    # counter file: a sim reads this line by equality to find the PUT in the
    # stream. STUB_MERGE_CODE answers the FIRST PUT (or, as a list in order,
    # "405 200", every PUT); STUB_MERGE_CODE_2 answers the SECOND and defaults
    # to 200 — the retry a 405 buys is the one that merges unless a case says
    # otherwise, so a refusal knob for the first PUT never leaks into the second.
    n=$(bump merge)
    say "curl pr merge"; printf '%s\\n' "$payload" >>"$FLEET_HOME/merge.log"
    code=""; i=0
    for c in \${STUB_MERGE_CODE:-200}; do i=$((i + 1)); [ "$i" -le "$n" ] && code="$c"; done
    [ -n "$code" ] || code=200
    msg="\${STUB_MERGE_MESSAGE:-Pull Request successfully merged}"
    if [ "$n" -ge 2 ]; then
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
  *notify.int.exe.xyz*)
    say "curl notify"; printf '%s\\n' "$payload" >>"$FLEET_HOME/notify.log"; printf 'ok\\n' ;;
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
        printf '%s\\trefs/tags/ultra/evidence/run-7\\n' "\${STUB_TAG_EVIDENCE_SHA:-$STUB_HEAD_SHA}" ;;
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
        # lines that case needs appended to it. This is the ONLY way plan text
        # reaches the boot, so a reader of any other source sees none of it.
        printf '# %s\\n\\nbody\\n' "$STUB_PLAN_H1"
        if [ -n "\${STUB_PLAN_EXTRA:-}" ]; then printf '%s\\n' "$STUB_PLAN_EXTRA"; fi
        exit 0 ;;
      *:.ultrapowers/gate-verdicts.json) printf '{"tasks":{"1":{"verdict":"pass"}},"tally":{"tasks":1}}\\n'; exit 0 ;;
    esac
    exit 0 ;;
  cat-file)
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
    [ -f "$snap" ] && cat "$snap" >>"$FLEET_HOME/commits.log" ;;
  push)
    case "$*" in
      *evidence-run-7*) [ -n "\${STUB_EVIDENCE_PUSH_FAIL:-}" ] && exit 1 ;;
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
mkdir -p "$run_dir"
printf '{"kind":"engine:phase","phase":"gate","id":"x","ts":1}\\n' >"$run_dir/events.jsonl"
# The engine talks on stdout and stderr, and a run that dies before its gate
# leaves nothing else behind.
printf 'run-main: preflight\\n'
printf 'run-main: knob-validate-failed\\n' >&2
if [ -z "\${STUB_NO_RECEIPT:-}" ]; then
  printf '{"verdict":"%s"}\\n' "$STUB_VERDICT" >"$run_dir/gate-receipt.json"
  printf '{"stamp":"run-7"}\\n' >"$run_dir/report.json"
  printf '{"argsFile":"x"}\\n' >"$run_dir/receipt.json"
fi
[ -n "\${STUB_ENGINE_SLEEP:-}" ] && sleep "$STUB_ENGINE_SLEEP"
exit \${STUB_ENGINE_CODE:-0}
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
  fs.writeFileSync(path.join(engine, 'package.json'), packageJson)
  if (nodeModules) fs.mkdirSync(path.join(engine, 'node_modules'))
  return { home, bin }
}

export function boot(ctx, args = ['boot'], env = {}) {
  return spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: ctx.home,
      FLEET_HOME: ctx.home,
      FLEET_BIN_DIR: ctx.bin,
      FLEET_POLL_SECONDS: '0',
      FLEET_STATUS_INTERVAL: '30',
      FLEET_ASSIGNMENT: ASSIGNMENT,
      // In the boot script's OWN environment, to prove the child's `env -u`
      // removes it and that the two Anthropic variables are never here.
      CLAUDE_CONFIG_DIR: '/should/be/unset/in/the/child',
      STUB_VM_NAME: VM_NAME,
      STUB_COMMENT: ASSIGNMENT,
      STUB_VERDICT: 'PASS',
      STUB_PR_BODY: PR_JSON,
      STUB_PLAN_H1: PLAN_H1,
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
    },
    timeout: 60000,
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
/** How many times the PR head's check runs were read. */
export const checkReads = (ctx) => stream(ctx).filter((l) => l.startsWith('CALL curl check-runs')).length
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

// ── the runner ───────────────────────────────────────────────────────────────

/**
 * Run `tests` — `[name, fn]` pairs — in order, printing one `ok (<ms> ms) —
 * <name>` line per passing case. Removes the temp root, then prints
 * `ALL TESTS PASSED`, or the failure count and `FAILED` with exit 1.
 */
export function runTests(tests) {
  let failures = 0
  for (const [name, fn] of tests) {
    const started = Date.now()
    try {
      fn()
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
