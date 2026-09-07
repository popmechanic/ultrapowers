# The acceptance log on the record

**Grammar:** claims-v1

**Claim:** The gate's acceptance run writes its full stdout+stderr to `<run dir>/acceptance.log` and `collect_evidence` copies it beside `gate-receipt.json` (the receipt keeps its 4000-char tail as the summary); the boot sim's evidence pin lists the file. (elicited)

**Goal:** #739 — observed 2026-09-07, run-36: `gate-receipt.json`'s `acceptance.output` holds the
last 4000 characters of the gate's pytest run, `engine.log` on the evidence branch was 15 lines,
and the suite's full output existed nowhere in the record, so a nested sim failure could not be
named without re-running the suite. After this run the record carries the whole of it: the
driver hands the frozen gate a suite command that tees its own stdout+stderr into
`<run dir>/acceptance.log` with the suite's exit status preserved, and the boot script commits
that file beside `gate-receipt.json` on `ultra/evidence-run-<N>`. The gate scripts are not
touched — the receipt's 4000-char tail stays exactly what it is, as the summary.
**Closes:** #739

**Tech Stack:** Node 22 ESM (`fleet/run-main.mjs`, the deterministic driver; sims in
`fleet/tests/test_run_main*.mjs`); bash (`fleet/sandbox-boot.sh`, run under `set -euo pipefail`;
sims in `fleet/tests/test_sandbox_boot*.mjs` over the shared rig
`fleet/tests/_sandbox_boot_helpers.mjs`, which stubs `git`, `gh`, `curl`, `systemd-run`,
`systemctl` and `claude` through a PATH shim — no network, no systemd). The suite is
`python3 -m pytest` from the repo root, which bridges every `fleet/tests/test_*.mjs` through
`tests/test_fleet_suite.py` (sentinel `ALL TESTS PASSED`, 300 s per file).

**Exam command:** node {paths}

**Parallelization rationale:** one wave, width 2. Task 1 (the driver writes the log) and Task 2
(the boot script commits it) share one literal — the path `<run dir>/acceptance.log`, where
`<run dir>` is `<git toplevel>/.claude/ultrapowers/run-<stamp>` on both sides — and nothing
else: Task 2 copies a file when it is present, exactly as it copies `standing-approval.json`,
so it needs Task 1's file format (a plain byte stream) and never Task 1's runtime behaviour.
The literal sits in both Contexts and coordinates them; no chain is drawn. The Files blocks are
disjoint (`fleet/run-main.mjs` + `fleet/tests/test_run_main.mjs` against `fleet/sandbox-boot.sh`
+ `fleet/CONTRACT.md` + `fleet/tests/test_sandbox_boot_approval_evidence.mjs`).

## Global Constraints

- Check: `bash -n fleet/sandbox-boot.sh`
- Check: `git diff --quiet $ULTRA_BASE -- skills/ultrapowers/scripts/ultra_gate.py skills/ultrapowers/scripts/gate_check.py skills/ultrapowers/scripts/run_acceptance.sh`
- The verification periphery is frozen (the second Check above is the whole of that rule):
  `ultra_gate.py`, `gate_check.py` and `run_acceptance.sh` keep every byte they have at BASE, so
  `gate-receipt.json`'s `acceptance.output` keeps its 4000-char tail and the full output lives
  only in `<run dir>/acceptance.log`. The log is captured by the non-frozen layers — the driver
  that stamps the command the gate reads, and the boot script that copies the run directory.
- The suite's output still reaches the gate's own capture: the wrapper tees, it never
  redirects, so what `run_acceptance.sh` sees on stdout is what it saw at BASE.
- No committed sim compares the tree to BASE, reads `ULTRA_BASE`, or embeds a commit sha
  (that shape parked run-35); every new leg reads files the sim itself wrote or the rig's
  fixtures.
- No token in any argv; every git command of the boot script is made from the evidence
  worktree, and nothing outside `.ultrapowers/runs/<N>/` is ever staged.

**Acceptance:** suite — the committed suite is the verification.

### Task 1: The driver tees the gate's acceptance run into the run directory

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/run-main.mjs`
- Test: `fleet/tests/test_run_main.mjs`

**Claim:** The gate's acceptance run writes its full stdout+stderr to `<run dir>/acceptance.log` (quoted from #739)
Machine: M1. Before `ultra_gate.py` is invoked in gate mode (the exec carrying --stamp and
--result, never the --approve one), the driver rewrites `<run dir>/receipt.json` — the file
`ultra_gate.py` reads its `testCmd` from — so that `testCmd` is
`acceptanceWrap(<the testCmd ultra_run.py stamped>, <run dir>)`, which is the string
`set -o pipefail; { <testCmd>; } 2>&1 | tee '<run dir>/acceptance.log'`, and `acceptanceLog` is
the absolute path `<run dir>/acceptance.log`, where the run dir is the directory of the
receipt's argsFile (path.dirname of it); every other key the receipt carried (ok, baseBranch,
argsFile, testCmdSource, …) is unchanged in value, and the `ultra_gate.py` stub of the sim,
reading `receipt.json` at the moment it is called, sees exactly that.
M2. The wrapper reaches the gate through the receipt and no reader before it: after runMain
returns, `<run dir>/args.json`'s `testCmd` — the engine's command (`run-engine.mjs` reads
`args.testCmd`) — is byte-identical to what `ultra_run.py` wrote, the receipt as read by the
--validate-knobs step (before the gate) still carries the unwrapped command, and no exec argv
of the whole flow (preflight, --validate-knobs, finalize_report.py, either `ultra_gate.py`
call) contains the substring `acceptance.log`.
M3. Evaluated exactly the way the frozen run_acceptance.sh evaluates its --run string in
suite-gate mode (a real invocation of that script, in a throwaway git repository, which evals
the command inside a detached worktree under `set -uo pipefail`), `acceptanceWrap(cmd, runDir)`
writes the suite's complete stdout+stderr to `<run dir>/acceptance.log` and preserves the
suite's exit status: for a cmd that prints an opening marker, then at least 10000 bytes on
stdout and at least 10000 bytes on stderr, then a closing marker, and exits 0, the script exits
0 with passed true in its JSON, `<run dir>/acceptance.log` is exactly the bytes the command
emitted (the opening marker on its first line, the closing marker on its last, byte length
equal to what was emitted), while the script's emitted JSON output field is at most 8000
characters long, contains the closing marker (what tee forwards on stdout is what the script
captured) and does not contain the opening marker; for the same cmd exiting 3, the
script exits 1 with exitCode 3 and the log is again complete; for the same cmd exiting 5, the
script's JSON carries exitCode 5 (the frozen no-tests guard still fires — the pipeline did not
launder the code to tee's 0).

**Authorized-by:** #739 (desired state, 2026-09-07); `CLAUDE.md` §Conventions — "The
verification periphery is FROZEN (0.1.0)": `gate_check.py`, `ultra_gate.py`,
`run_acceptance.sh` change only for an eval-measured regression, so the capture is the driver's.

**Interfaces:**
- Consumes: none
- Produces: `acceptanceWrap(testCmd: string, runDir: string) -> string`

**Context:** BASE is `9cd8190ffb5e68b1de0eb9eac44b116ab0631d28`. The facts below were read off
that tree; line numbers are approximate, names exact.

*The seam, and why it is where it is.* The gate's acceptance run is `ultra_gate.py` (frozen):
it reads `run_receipt = json.loads((run_dir / "receipt.json").read_text())` where `run_dir` is
`<git toplevel>/.claude/ultrapowers/run-<stamp>` (~line 64 and ~113), takes
`test_cmd = run_receipt.get("testCmd")` (~131) and hands it verbatim as `--run` to
`run_acceptance.sh --suite-gate` (~136–139), then keeps
`"output": (r.stdout + r.stderr)[-4000:]` (~143). `run_acceptance.sh` (frozen) runs under
`set -uo pipefail` (line 11), cuts a detached worktree at the integration branch, and evaluates
the command as `OUT="$( (cd "$EXAM_WT" && eval "$SG_RUN") 2>&1 )"; CODE=$?` (~166); its `emit`
keeps `tail -c 8000` (~40) and prints one JSON object (`status`, `passed`, `exitCode`,
`output`). So the string in `receipt.json`'s `testCmd` IS the gate's acceptance run, and the
only non-frozen writer of that string is this driver: `ultra_run.py` stamps it at preflight
(`receipt.update({... "testCmd": test_cmd, "testCmdSource": test_src})`, ~603), and
`run-main.mjs` derives `runDir = path.dirname(argsFilePath)` from that receipt (~517), rewrites
`args.json` in place at step 2 (`fs.writeFileSync(argsFilePath, …)`, ~527), and invokes the
gate at step 6 (`exec(py, [ultra_gate.py, '--stamp', stamp, '--result', resultPath])`, ~656).
The rewrite of `receipt.json` belongs between those two points — the one spot in the flow where
the run dir is known and the gate has not yet read the file. `ultra_gate.py --approve` (~68–80)
runs no suite (it checks the branch out and prints a receipt), so the log is written once per
run, by the gate.

*The wrapper's properties, each one load-bearing.* `set -o pipefail` — the pipeline's status is
the suite's, not `tee`'s 0 (the evaluating shell already has it on; the wrapper says it anyway
so the literal is self-contained). `{ <testCmd>; }` — a command with `&&` or `;` in it
(`bunx tsc --noEmit && bun test`) is grouped before the redirection, so the whole of it is
captured and the group's status is the suite's. `2>&1 | tee '<path>'` — both streams reach the
file AND the pipe's stdout, which is what `run_acceptance.sh` captures into `$OUT`, so the
receipt's tail is unchanged in content; `tee` reads to EOF, so there is no SIGPIPE. The path is
single-quoted and absolute: the eval runs with cwd = the exam worktree under `mktemp -d`, never
the run dir. A toplevel containing a single quote is out of scope (the run dir is
`<toplevel>/.claude/ultrapowers/run-<stamp>` and `parseArgs` refuses a stamp with a space).

*Scope: the receipt only.* The engine reads `args.testCmd` (`run-engine.mjs` ~748, `throw` on
absence at ~810) for the baseline, the proof runs and the integrated suite; `publish-fold.mjs`
reads `args.json` too (~547, ~572). Neither reads `receipt.json`. The wrapper therefore goes
into `receipt.json`'s `testCmd` and nowhere else — `args.json` keeps the plain command, and the
argv the driver passes `ultra_run.py` (`--test-cmd <knob>`) is the operator's knob, unwrapped.
Keep `testCmdSource` as stamped; add `acceptanceLog` so a reader of the evidence branch's
`receipt.json` sees where the full output went without parsing the command.

*The shared literal.* `<run dir>/acceptance.log` — on the driver, `path.join(runDir,
'acceptance.log')`; on the sandbox the same directory is
`$TARGET_DIR/.claude/ultrapowers/run-$RUN_ID` (`run_dir_path()` in `fleet/sandbox-boot.sh`
~552), which is where `collect_evidence` will look for it. The name is `acceptance.log`, lower
case, beside `gate-receipt.json`.

*The exam file.* `fleet/tests/test_run_main.mjs` is the runMain flow's exam: `makeExecStub`
(~286) plays `ultra_run.py` (writes `args.json` and `receipt.json` with `testCmd: 'true'` and
prints the receipt), `finalize_report.py`, and both `ultra_gate.py` modes (gate mode writes
`gate-receipt.json`; `--approve` prints a receipt), while `git` runs for real, and every
`runMain` case passes `{ exec, log, runEngineFn, makeAgent }`. Add the new legs under a comment
naming this task; the `ultra_gate.py` gate-mode branch of the stub is where leg (a) reads
`receipt.json` back (a snapshot taken inside the stub at call time, kept on the returned object
beside `calls`). Leg (c) needs no stub: `run_acceptance.sh` is at
`<engine>/skills/ultrapowers/scripts/run_acceptance.sh` (resolve from `import.meta.url`), and a
throwaway repository is one `git init` + one commit with a branch name to pass as `--branch`
(pass `--base` too or accept the script's stderr warning about the disarmed harness guard — the
script exits by the suite's code either way). The 10000-byte streams are the point: both frozen
tails (8000 in the script's JSON, 4000 in the gate receipt) are shorter than either stream, so a
log that held only the tail cannot pass. Every path the legs read is under the sim's own
`mkdtemp`; no leg reads `ULTRA_BASE`, compares to BASE, or embeds a sha. The file must still end
by printing `ALL TESTS PASSED`.

**Proof:**
- Test: `fleet/tests/test_run_main.mjs`
- Legs: (a) driving `runMain` over the exec stub, the snapshot the `ultra_gate.py` gate-mode
  stub takes of `<run dir>/receipt.json` at call time has `testCmd` exactly
  `acceptanceWrap('true', runDir)` — the literal
  `set -o pipefail; { true; } 2>&1 | tee '<runDir>/acceptance.log'` with `runDir` the absolute
  `path.dirname` of the receipt's `argsFile` — and `acceptanceLog` exactly
  `path.join(runDir, 'acceptance.log')`, and its `ok`, `baseBranch`, `argsFile` and
  `testCmdSource` are the values the `ultra_run.py` stub wrote [M1]; (b) after the same
  `runMain` returns, `<run dir>/args.json`'s `testCmd` is exactly `true`, the `--approve` exec's
  argv and every other recorded `exec` argv contain no element with the substring
  `acceptance.log`, and a snapshot of `receipt.json` taken by the `ultra_run.py --validate-knobs`
  stub (before the gate) still has `testCmd` exactly `true` — the rewrite happens after every
  other reader and before the gate [M2]; (c) in a throwaway git repository with one commit, a
  `cmd` that prints `BEGIN-<nonce>` as its first line, at least 10000 bytes to stdout and at
  least 10000 bytes to stderr, then `END-<nonce>` as its last line, is passed through
  `acceptanceWrap(cmd, runDir)` as the `--run` of a real
  `bash <engine>/skills/ultrapowers/scripts/run_acceptance.sh --suite-gate --branch <branch>`
  invocation: the script exits 0, its stdout parses as JSON with `passed === true`,
  `<runDir>/acceptance.log` exists with byte length equal to the bytes the command emitted,
  begins with `BEGIN-<nonce>` and ends with `END-<nonce>`, while the JSON's `output` is at most
  8000 characters, contains `END-<nonce>` and does not contain `BEGIN-<nonce>` [M3]; (d) the same command exiting 3
  makes the script exit 1 with `exitCode === 3` and `passed === false`, and the log is again
  complete (both markers, full length); the same command exiting 5 yields `exitCode === 5` in
  the JSON — the exit status crossed the pipe [M3].

**Stale-if:**
- path-absent: `fleet/run-main.mjs`
- path-absent: `fleet/tests/test_run_main.mjs`
- path-absent: `skills/ultrapowers/scripts/run_acceptance.sh`
- issue-closed: #739

### Task 2: The boot script commits the acceptance log beside the gate receipt

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/sandbox-boot.sh`
- Modify: `fleet/CONTRACT.md`
- Test: `fleet/tests/test_sandbox_boot_approval_evidence.mjs`

**Claim:** `collect_evidence` copies it beside `gate-receipt.json` (the receipt keeps its 4000-char tail as the summary); the boot sim's evidence pin lists the file. (quoted from #739)
Machine: M1. collect_evidence copies `<run dir>/acceptance.log` — the run dir being
`$TARGET_DIR/.claude/ultrapowers/run-$RUN_ID`, the same directory `gate-receipt.json` is read
from — to `.ultrapowers/runs/<N>/acceptance.log` on the evidence worktree, byte for byte, when
the file is present: for a stub engine that writes a 9000-byte body whose first line is a
distinct opening marker, the collected file is byte-equal to the run directory's, its first
line is that marker, and `gate-receipt.json` sits in the same directory.
M2. A run whose engine wrote no `acceptance.log` commits none: the evidence directory of such a
run holds `gate-receipt.json` and `status.json` and no `acceptance.log`.
M3. `fleet/CONTRACT.md`'s evidence-branch bullet (the one opening with the branch name
ultra/evidence-run-<N> and "the run's record under" `.ultrapowers/runs/<N>/`) names
`acceptance.log` as the gate's acceptance run's full stdout+stderr, present when the engine
wrote it, so the sim's evidenceBullet() slice of that bullet contains the backticked name
`acceptance.log` followed, before any other backticked name, by the words
"full stdout+stderr".

**Authorized-by:** #739 (desired state, 2026-09-07); `fleet/CONTRACT.md` §Literals, the
`ultra/evidence-run-<N>` bullet ("present when the engine wrote them"); doctrine "One merge,
one writer" in `CLAUDE.md` — the run's record is git, committed at every transition.

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** BASE is `9cd8190ffb5e68b1de0eb9eac44b116ab0631d28`. The facts below were read off
that tree; line numbers are approximate, names exact.

*`collect_evidence` at BASE* (`fleet/sandbox-boot.sh` ~749): `dest="$EVIDENCE_DIR/$EVIDENCE_PATH"`
(`EVIDENCE_PATH=".ultrapowers/runs/$RUN_N"`, ~397); copies `gate_receipt_path()` to
`$dest/gate-receipt.json` and `approve_receipt_path()` to `$dest/approve-receipt.json` when
each is non-empty; then `run_dir="$(run_dir_path)"` and a fixed list,
`for f in report.json events.jsonl receipt.json standing-approval.json; do [ -f "$run_dir/$f" ]
&& cp "$run_dir/$f" "$dest/$f"; done` — every name copied WHEN THE ENGINE WROTE IT; then the
`transcripts/*.jsonl` file-by-file copy, `$ENGINE_LOG` → `engine.log`, `claude-version.txt`,
`status.json`, and one `log "evidence: …"` line. `run_dir_path()` (~552) is
`$TARGET_DIR/.claude/ultrapowers/run-$RUN_ID`. The function runs at every `write_status`
transition, at every relayed phase (#723) and once more at `fail`, so the copy has to be
idempotent — a plain `cp` of one file is. The script runs under `set -euo pipefail`.

*The shared literal.* `<run dir>/acceptance.log` — the driver (`fleet/run-main.mjs`) hands the
gate a suite command that tees the whole acceptance run into exactly this path,
`path.join(runDir, 'acceptance.log')` with `runDir` the same `<toplevel>/.claude/ultrapowers/run-<stamp>`
directory, and the gate writes it once per run. The name is `acceptance.log`, lower case,
beside `gate-receipt.json`. This task copies a file when it is present, exactly as
`standing-approval.json` is copied; it does not need the file to exist to be correct, and the
absence case is a leg.

*The contract at BASE* (`fleet/CONTRACT.md` ~44–49): the bullet opens
`` `ultra/evidence-run-<N>` — the run's record under `.ultrapowers/runs/<N>/`: `status.json`, ``
and lists `receipt.json`, `gate-receipt.json`, `report.json`, `events.jsonl`, `engine.log`,
`claude-version.txt`, then `approve-receipt.json` and `standing-approval.json`, "present when
the engine wrote them", then `transcripts/<sessionId>.jsonl` "on the same terms". The sim's
`evidenceBullet()` (`test_sandbox_boot_approval_evidence.mjs` ~330) slices from the line
matching `/ultra\/evidence-run-<N>. — the run/` to the first later line containing
`ultra/integration-run-<N>`, joins the wraps and collapses whitespace — the new name has to
land inside that span, and the M3 test of the approvals (`present when the engine wrote them`,
verbatim) and #702's (`` `transcripts/<sessionId>.jsonl` ``) must keep matching. The contract
is the authority for every literal the boot script emits (`fleet/CONTRACT.md` wins over the
runbook), so the sentence lands in the same patch as the copy.

*The exam file and its rig.* `fleet/tests/test_sandbox_boot_approval_evidence.mjs` is the
evidence-branch exam: `approvalHome()` (~150) splices `APPROVAL_SNIPPET + TRANSCRIPTS_SNIPPET`
into the shared engine stub (`STUBS['systemd-run']` from `_sandbox_boot_helpers.mjs`) at its
last line `exit ${STUB_ENGINE_CODE:-0}`, each snippet writing `$run_dir/<file>` from an env
variable when set; `run(name, env)` boots once per case and memoizes (`bareRun()` = PASS with
neither approval, no transcripts); `runDir(ctx)` is `<home>/target/.claude/ultrapowers/run-run-7`,
`evidenceRunDir(ctx)` is `<evidence worktree>/.ultrapowers/runs/7` (`RUN_PATH`); the legs read
files with `fs.readFileSync` and compare buffers. Extend the same rig under a comment naming
this task: one more snippet (`STUB_ACCEPTANCE_BYTES` → `$run_dir/acceptance.log`, written with
`printf '%s'` like the others), one more memoized case, and legs that reuse `bareRun()` for the
absence case and `evidenceBullet()` for the contract. The rig's helpers file is not modified —
the splice is this exam's own. The body the case writes must be longer than 4000 bytes with a
distinct first line, so a copy that carried only a tail is not "byte for byte". Every path read
is under the rig's `makeHome()`; no leg reads `ULTRA_BASE`, compares to BASE, or embeds a sha.
The file must still end by printing `ALL TESTS PASSED`.

**Proof:**
- Test: `fleet/tests/test_sandbox_boot_approval_evidence.mjs`
- Run: `sed -n '/^collect_evidence()/,/^}/p' fleet/sandbox-boot.sh | grep -c 'acceptance.log'`
- Run: `sed -n '/ultra\/evidence-run-<N>. — the run/,/ultra\/integration-run-<N>/p' fleet/CONTRACT.md | grep -c 'acceptance.log'`
- Legs: (a) a PASS run whose engine stub wrote a 9000-byte `acceptance.log` (first line
  `ACCEPTANCE-BEGIN-<nonce>`, then filler) leaves
  `<evidence worktree>/.ultrapowers/runs/7/acceptance.log` byte-equal to
  `<run dir>/acceptance.log` — same buffer, first line the marker, length 9000 — with
  `gate-receipt.json` present in the same evidence directory [M1]; (b) the `bareRun()` case,
  whose engine wrote no `acceptance.log`, has no `acceptance.log` in its evidence directory
  while `gate-receipt.json` and `status.json` are there [M2]; (c) `evidenceBullet()` — the
  contract's `ultra/evidence-run-<N>` bullet, wraps joined — matches
  `` /`acceptance\.log`[^`]*full stdout\+stderr/ `` (the name, then its description before any
  other backticked name — a bullet that omits the name, or names it with its description
  parked after some other backticked file, does not match), and the second `Run:` above
  prints a count of at least 1 for the same span [M3]; (d) the
  first `Run:` prints a count of at least 1 — the `collect_evidence` function body itself, not
  a comment elsewhere, names the file — and the script parses (`bash -n`, the rig's own first
  test) [M1].

**Stale-if:**
- path-absent: `fleet/sandbox-boot.sh`
- path-absent: `fleet/tests/test_sandbox_boot_approval_evidence.mjs`
- path-absent: `fleet/tests/_sandbox_boot_helpers.mjs`
- issue-closed: #739
