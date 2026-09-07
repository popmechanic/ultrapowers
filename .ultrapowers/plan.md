# Boot pipelines survive SIGPIPE

**Grammar:** claims-v1

**Claim:** No boot pipeline can take the script down by SIGPIPE (elicited)

**Goal:** #738. The Claim above is the first clause of that issue's desired-state sentence,
confirmed by the operator on 2026-09-07. run-36's gate suite failed exactly one test: under
`pytest tests/ -n auto` the boot sim's parked-publish scenario exited 141 (128 + SIGPIPE) right
after `evidence: pushed to ultra/evidence-run-7`, while the same sims passed four times
sequentially. `fleet/sandbox-boot.sh` runs `set -euo pipefail`, so any pipeline whose reader exits
before its writer is done — `| head -n 1`, `| grep -q`, an `awk` that `exit`s — turns the writer's
SIGPIPE into the script's own exit the moment the writer has more to say than the pipe holds or
the reader is scheduled first. After this run no pipeline in the boot script has an early-closing
reader fed by an unguarded or builtin writer — an external writer is wrapped `{ … || true; }`, a
builtin writer's pipeline is replaced by a bash test or by a reader that consumes to EOF — a
census in the exam names any line that still does, and a sim leg drives the parked publish path
under two writers that must overrun their readers and shows the boot still exits 0, still opens
the draft PR, still pushes the `parked` page and still reads its tags.
**Closes:** #738

**Tech Stack:** bash (`fleet/sandbox-boot.sh`) + Node 22 ESM sims (`fleet/tests/*.mjs`, the shared
rig `fleet/tests/_sandbox_boot_helpers.mjs` stubbing `curl`/`git`/`gh`/`systemd-run`/`systemctl`
through a PATH shim); the suite is `python3 -m pytest` from the repo root, which bridges every
`fleet/tests/test_*.mjs` through `tests/test_fleet_suite.py`.

**Parallelization rationale:** one task, width 1. The three writer shapes, the two stub knobs
that overrun them and the exam that falsifies both are one contract over two files and one
exam file; no log line changes, so `fleet/CONTRACT.md` is untouched and a second task would
own nothing. No chain.

## Global Constraints

- Check: `bash -n fleet/sandbox-boot.sh`
- Check: `bash -c 'comm -23 <(git show $ULTRA_BASE:fleet/sandbox-boot.sh | grep -oE "^[a-z_]+\(\)" | sort -u) <(grep -oE "^[a-z_]+\(\)" fleet/sandbox-boot.sh | sort -u) | { ! grep .; }'`
- Check: `! grep -nE "trap .*PIPE|set \+o pipefail" fleet/sandbox-boot.sh`
- The boot script keeps `set -euo pipefail` for its whole length: no function defined at BASE is
  removed, SIGPIPE is never ignored or trapped, and a pipeline guard sits on an EXTERNAL WRITER
  (`{ writer || true; } | reader`), never on the reader or on the whole pipeline — a reader's own
  non-zero status still reaches the caller, so every refusal the script makes today is still made.
- A concurrent run edits `collect_evidence` and the evidence file list in the same script and
  extends other boot sims; this plan's edits to `fleet/sandbox-boot.sh` are the four functions
  named in Task 1's Context and nothing in `collect_evidence`, and its edits to the rig are the
  two `git`-stub cases named there.

**Acceptance:** suite — the committed suite is the verification.


### Task 1: Every early-closing reader has a writer that cannot be killed under it

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/sandbox-boot.sh`
- Modify: `fleet/tests/_sandbox_boot_helpers.mjs`
- Test: `fleet/tests/test_sandbox_boot_edges.mjs`

**Claim:** No boot pipeline can take the script down by SIGPIPE: every `| head`/`| tail`/`grep -q` reader in `fleet/sandbox-boot.sh` either reads its whole input or has its upstream guarded (`{ cmd || true; }`), and a sim leg drives the parked publish path under an injected EPIPE (a stub reader that closes after one line) and shows the boot still exits 0 and still pushes evidence. (quoted from #738)
Machine: M1. Tokenising `fleet/sandbox-boot.sh` — every line whose first non-blank character is
not `#`, a line ending in `|` joined with the next, each line split at every `|` that is not part
of `||` — every reader segment whose command word is `head`, or `grep` with a `q`, `m` or `l` in a
flag cluster, or `awk` whose text contains the word `exit`, or `sed` whose text carries a bare
`q` command, has as the segment before it a brace group ending `|| true; }` whose first command
word is neither `printf` nor `echo` (a bash builtin dies with its subshell before `|| true` can
run, so a guarded builtin is no guard); the census that says so names none in the edited
script, and the same census, run over an inline fixture holding BASE's five offending lines
verbatim — `is_target` and `is_run_n` (`printf '%s' "$1" | grep -qE …`), `plan_title`
(`sed -n 's/^# \(.*\)$/\1/p' "$PLAN_FILE" | head -n 1`) and the two
`printf '%s\n' "$listing" | awk … { print $1; exit }` substitutions of `record_tags` — beside
`json_field`'s guarded `{ grep -o … || true; } | head -n 1 |` line and a
`{ printf '%s' "$1" || true; } | grep -qE …` line, names exactly those five and the
builtin-guarded sixth and not the `json_field` line; a reader in the set `tail`, `tr`, `sort`, `uniq`, `tee`, `python3`,
`json_field`, `duplicate_repos`, `mergeable_field`, `sed` without `q`, `awk` without `exit`, or
`grep` without those flags consumes to EOF and is never named. M2. One boot of the rig with
`STUB_VERDICT=NEEDS_ACK`, a file `$FLEET_HOME/stub/plan-extra` of at least 1 MiB of lines each
beginning `# `, and a file `$FLEET_HOME/stub/ls-remote-extra` of at least 1 MiB of lines each
`<40-hex>\trefs/tags/other-<i>` — each more than any pipe holds plus any reader's first read, so
`plan_title`'s `sed` and `record_tags`'s writer must both write after a reader that exits on its
first line has gone — exits 0, walks the states `booting`, `running`, `publishing`, `parked`,
records exactly one POST `/pulls` whose payload has `"draft":true` and
`"title":"fleet run-7: Smoke: the fleet proves itself"` (the plan's H1, not an injected line),
commits the evidence after that POST so the committed status snapshots end with a `parked` page
whose `pr` is the PR URL, and logs the exact line `record: refs/tags/ultra/plan/run-7 at
<PLAN_SHA> and refs/tags/ultra/evidence/run-7 at <HEAD_SHA> — ultra/plan-run-7 and
ultra/evidence-run-7 deleted` — both tag shas read out of a listing a million bytes long. M3. An
assignment whose `target=` value has no `/`, and an assignment whose `run=` value begins `-`,
each still fail before any clone: the boot exits non-zero, the page's `error` starts
`assignment: target is not owner/repo` and `assignment: bad run id` respectively, and `git.log`
is empty. M4. The rig's `git` stub appends the bytes of `$FLEET_HOME/stub/plan-extra` to its
answer for `show <sha>:.ultrapowers/plan.md` after `STUB_PLAN_EXTRA`, and the bytes of
`$FLEET_HOME/stub/ls-remote-extra` to its `ls-remote --tags` listing after the two tag lines,
each only when that file exists; with neither file the two answers are byte-for-byte what they
were — `# <STUB_PLAN_H1>\n\nbody\n` and the plan-tag line then the evidence-tag line.

**Authorized-by:** #738

**Interfaces:**
- Consumes: `none`
- Produces: `none`

**Context:** THE MECHANISM, three shapes, one per writer kind, each verified on the rig before
this plan was written. (1) An EXTERNAL writer keeps its pipeline and gains the brace guard:
`plan_title` (BASE line 1105) becomes `{ sed -n 's/^# \(.*\)$/\1/p' "$PLAN_FILE" || true; } | head -n 1`
— `json_field` (227, `{ grep -o … || true; } | head -n 1 | sed …`) is the model already in the
script. (2) A BUILTIN writer whose reader is a test loses the pipeline: `is_target` (359) becomes
`[[ $1 =~ ^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ ]]` and `is_run_n` (360) becomes
`[[ $1 =~ ^[A-Za-z0-9][A-Za-z0-9-]*$ ]]` — the same two EREs, unquoted inside `[[ =~ ]]` (bash
3.2 and 5 both read them so), which agree with the `grep -qE` forms on `popmechanic/smoke`,
`a/b/c`, `/b`, `a/`, `""`, `a b/c`, `7`, `run-7`, `-7`, `7 8`, `ab_c`; the script is
`#!/usr/bin/env bash` and `is_sha` beside them is already a `case` test, not a pipeline. (3) A
BUILTIN writer whose reader is a filter keeps the pipeline and the reader reads to EOF:
`record_tags` (1695–1696) becomes `$(printf '%s\n' "$listing" | awk -v ref="$plan_tag" '$2 == ref { print $1 }')`
(and the same for `$evidence_tag`) — the `exit` goes; `ls-remote` lists a ref once, so the
output is unchanged. MEASURED on the rig at BASE `9cd8190` (`fleet/sandbox-boot.sh` blob
`83806db630ce3b61aade00e8e5f74e2984478837`): `{ printf '%s\n' "$big" || true; } | head -n 1`
under `pipefail` exits 141 — the builtin's subshell IS the process the signal kills, so `|| true`
never runs — where `{ seq 1 60000 || true; } | head -n 1` exits 0, and
`printf … | awk '… { print; exit }'` exits 141 where the same `awk` without `exit` exits 0; the
boot of M2 at BASE exits 141 three ways — with only `plan-extra` it stops at `publishing` with no
POST (the issue's exact shape: page `publishing`, phase `parked — pushing
ultra/integration-run-7`, committed snapshots `running`, `publishing`); with only
`ls-remote-extra` it opens the draft PR, commits `parked` and dies in `record_tags` before the
`record:` line; with both it dies at `plan_title` — and with the three shapes in place the same
boot exits 0 and logs the `record: … deleted` line of M2. Every other pipeline in the script has
a reader that consumes to EOF (`tail -n 1`, `tail -c 4000`, `sed '$d'`, `tr`, `sort | uniq -d`,
`tee`, `python3 -c` on stdin, `json_escape`'s `awk` with no `exit`) and stays as it is;
`head -n 1 "$dir/engine-head"` (968) and the `awk` in `plan_closes` read files, not pipes.
WHY FILES, NOT ENV, FOR THE INJECTION: the existing `STUB_PLAN_EXTRA` rides the stub's
environment, and Linux refuses to exec a process carrying one environment string over 128 KiB
(`MAX_ARG_STRLEN`), so a string big enough to be deterministic — past a 64 KiB pipe plus a
reader's first read block, which `head` takes in `BUFSIZ` and `awk` may take in a 64 KiB block —
cannot ride the environment on the sandbox at all; a 1.2 MB `STUB_PLAN_EXTRA` failed to spawn
on the rig. So the two knobs are FILES beside the stub's own counters: `makeHome` already creates
`$FLEET_HOME/stub/` (the `bump` counters and `fold-2` live there), the sim writes the two files
with `fs.writeFileSync(path.join(ctx.home, 'stub', 'plan-extra'), …)` before `boot()`, and the
`git` stub's two cases in `STUBS.git` gain one line each — `show *:.ultrapowers/plan.md`:
`[ -f "$FLEET_HOME/stub/plan-extra" ] && cat "$FLEET_HOME/stub/plan-extra"` after the
`STUB_PLAN_EXTRA` line and before its `exit 0`; `ls-remote`: `[ -f "$FLEET_HOME/stub/ls-remote-extra" ] && cat "$FLEET_HOME/stub/ls-remote-extra"`
after the evidence-tag `printf` (inside the same `;;` arm, after the `STUB_TAGS_MISSING` exit) —
`cat` is external and both answers are read whole (into `$PLAN_FILE`, and by `$( )`), so the
stubs themselves cannot take SIGPIPE. The stub source is a JS template literal: a `$` that the
stub must see is written `\$` there, exactly as `\${STUB_PLAN_EXTRA:-}` is on the neighbouring
line, and `"$FLEET_HOME"` is fine as it is because `FLEET_HOME` is not a JS binding in that
scope — copy the neighbouring lines' escaping. Rig literals for the legs: `PLAN_H1` is
`'Smoke: the fleet proves itself'`, `PLAN_SHA` is `'a1'.repeat(20)`, `HEAD_SHA` is
`'d4'.repeat(20)`, `PR_URL` is the helpers' constant; the POST payload is read back by
`prPosts(ctx)` (parsed) and `readLog(ctx, 'pr.log')` (bytes); committed snapshots by
`committed(ctx)`/`commitStates(ctx)`; the log stream by `stream(ctx)`; the stub binaries sit in
`ctx.bin` and answer with `FLEET_HOME=ctx.home` in their environment, so a leg may spawn
`path.join(ctx.bin, 'git')` directly (as `test_sandbox_boot_merge.mjs` spawns the `systemctl`
stub) to read an answer without a boot. THE EXAM FILE is `fleet/tests/test_sandbox_boot_edges.mjs`,
the edge-case half of the boot exam (sections 3–10 at BASE); the new legs go at its end, before
`runTests(tests)`, under one section comment naming this task
(`// ── 11. boot pipelines survive SIGPIPE (Task 1) …`), importing what it needs from the
helpers it already imports from — no new `test_<noun>.mjs`. The census of M1 is a test in that
file that reads `SCRIPT`'s source (as the file's section 3 already does); it prints every
segment it names in its assertion message. HARD CONSTRAINT on the exam: the committed sim never
compares the tree to BASE, never reads `ULTRA_BASE`, and embeds no commit sha or blob sha — the
BASE facts above are for the reader of this plan, and "names exactly five at BASE" in M1 is
established by the census's algorithm being the one described, which leg (a) states, not by a
BASE comparison in the suite. The refusals of M3 are `parse_assignment`'s
`is_run_n "$RUN_N" || fail "assignment: bad run id '$RUN_N'"` and
`is_target "$TARGET_REPO" || fail "assignment: target is not owner/repo ('$TARGET_REPO')"`,
reached from `FLEET_ASSIGNMENT` before `clone_target`; the rig's `ASSIGNMENT` carries `run=7`
and `target=popmechanic/smoke`, so a leg passes `FLEET_ASSIGNMENT` with one token replaced
(`target=smoke`, `run=-7`) and reads `statusOf(ctx).error` and `readLog(ctx, 'git.log')`.
`tests/test_fleet_suite.py` runs every `fleet/tests/test_*.mjs` under `-n auto` with a 300 s hang
cap per file, and `test_sandbox_boot_merge.mjs` leg (j) re-runs this file inside itself, so
every boot here is paid twice per suite — the exam is the one full boot of M2, the two refusal
boots of M3 (which end before any clone) and no others; M4 spawns the stub, not the boot.

**Proof:**
- Test: `fleet/tests/test_sandbox_boot_edges.mjs`
- Legs: (a) a census test reads `SCRIPT`'s source, drops full-line comments, joins a line ending
  in `|` with its successor, splits each line at every `|` not part of `||`, and for every
  reader segment whose command word is `head`, `grep` with `q`/`m`/`l` in a flag cluster, `awk`
  containing the word `exit`, or `sed` with a bare `q` command, asserts the preceding segment
  ends `|| true; }` and its brace group's first command word is not `printf` or `echo` —
  failing with every offending segment in its message, so a `sed | head -n 1` with no guard, a
  `{ printf … || true; } | grep -q`, or an `awk … exit` fed by `printf` is named, while
  `json_field`'s `{ grep -o … || true; } | head -n 1 | sed …` and every `tail`/`tr`/`sort`/
  `uniq`/`tee`/`python3` reader pass; and the census is a function the same test first runs
  over an inline fixture string of seven lines — BASE's five offending lines verbatim,
  `json_field`'s `{ grep -o "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" || true; } | head -n 1 |`
  joined with its `sed` successor, and `{ printf '%s' "$1" || true; } | grep -qE '^x$'` —
  asserting it returns exactly six findings, the five and the builtin-guarded line, and none
  for the `json_field` line, so a tokenizer that misses `grep -qE`, an `awk … exit` inside
  `$( )`, or a builtin behind `|| true; }` fails here before it is trusted on `SCRIPT` [M1]; (b) a boot with `STUB_VERDICT: 'NEEDS_ACK'` after
  writing `$FLEET_HOME/stub/plan-extra` (80000 lines `# line <i>`) and `$FLEET_HOME/stub/ls-remote-extra` (16000 lines
  `${'e5'.repeat(20)}\trefs/tags/other-<i>`) under `ctx.home` has `r.status` exactly 0,
  `states(ctx)` deep-equal to `['booting', 'running', 'publishing', 'parked']`,
  `prPosts(ctx).length` 1 with `prPosts(ctx)[0].draft === true` and
  `prPosts(ctx)[0].title === 'fleet run-7: Smoke: the fleet proves itself'`,
  `statusOf(ctx).pr === PR_URL`, `commitStates(ctx)` ending in `'parked'` with that snapshot's
  `pr` equal to `PR_URL`, and `stream(ctx)` containing exactly
  `` `record: refs/tags/ultra/plan/run-7 at ${PLAN_SHA} and refs/tags/ultra/evidence/run-7 at ${HEAD_SHA} — ultra/plan-run-7 and ultra/evidence-run-7 deleted` `` —
  a boot whose `sed` dies stops at `publishing` with no POST, and one whose listing writer dies
  ends 141 with no `record:` line [M2]; (c) a boot whose `FLEET_ASSIGNMENT` has `target=smoke`
  in place of `target=popmechanic/smoke` has `r.status` not 0, `statusOf(ctx).error` matching
  `/^assignment: target is not owner\/repo/` and `readLog(ctx, 'git.log')` equal to `''`, and a
  boot whose `FLEET_ASSIGNMENT` has `run=-7` in place of `run=7` has `r.status` not 0,
  `statusOf(ctx).error` matching `/^assignment: bad run id/` and `readLog(ctx, 'git.log')` equal
  to `''` — a rewrite that accepted what `grep -qE` refused would clone [M3]; (d) spawning
  `path.join(ctx.bin, 'git')` with `FLEET_HOME: ctx.home` and `STUB_PLAN_H1: PLAN_H1` for
  `['show', 'x:.ultrapowers/plan.md']` answers exactly `` `# ${PLAN_H1}\n\nbody\n` `` with no
  `$FLEET_HOME/stub/plan-extra` present and that string followed by the file's bytes once it is written, and
  for `['ls-remote', '--tags', 'origin', 'refs/tags/ultra/plan/run-7', 'refs/tags/ultra/evidence/run-7']`
  with `STUB_PLAN_SHA: PLAN_SHA` and `STUB_HEAD_SHA: HEAD_SHA` answers exactly the plan-tag line
  then the evidence-tag line with no `$FLEET_HOME/stub/ls-remote-extra` present and those two lines
  followed by the file's bytes once it is written [M4].

**Stale-if:**
- path-absent: `fleet/sandbox-boot.sh`
- path-absent: `fleet/tests/_sandbox_boot_helpers.mjs`
- path-absent: `fleet/tests/test_sandbox_boot_edges.mjs`
- issue-closed: #738
