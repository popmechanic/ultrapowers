# The evidence page per phase

**Grammar:** claims-v1

**Claim:** The boot script commits the page to the evidence branch on every `engine:phase` event it already relays to the live page (wave N, integration review, gate), not only on `running → publishing → done`. (elicited)

**Goal:** #723 — observed across runs 30–33 (2026-09-06): `.ultrapowers/runs/<N>/status.json` on
the evidence branch read `{"state":"running","phase":"engine starting"}` from the first
transition until `publishing` (2 h 9 min for run-32) while the VM's live page walked `Wave 1`,
`Wave 2`, `Integration Review`, because evidence commits ride state transitions only. After this
run the record advances with the run: one commit per relayed phase, made through the same
`collect_evidence` + `push_evidence` pair and the same `pull --rebase` discipline as the
transition commits, idempotent across polls of an unchanged phase, and never fatal to the run.
**Closes:** #723

**Tech Stack:** bash (`fleet/sandbox-boot.sh`, run under `set -euo pipefail`); Node 22 ESM sims
(`fleet/tests/test_sandbox_boot*.mjs` over the shared rig `fleet/tests/_sandbox_boot_helpers.mjs`,
which stubs `git`, `gh`, `curl`, `systemd-run`, `systemctl` and `claude` through a PATH shim — no
network, no systemd). The suite is `python3 -m pytest` from the repo root, which bridges every
`fleet/tests/test_*.mjs` through `tests/test_fleet_suite.py` (sentinel `ALL TESTS PASSED`, 120 s
per file).

**Exam command:** node {paths}

**Parallelization rationale:** wave 1 is one task, width 1. The phase commit is one contract —
the refresher's commit, its idempotence, its non-fatality, and the sentence in
`fleet/CONTRACT.md` that declares it — read by one sim file over one rig. The contract sentence is
not split off as a task of its own because the contract is the authority for every literal the
boot script emits: a tree where the authority and the script disagree is not a legal intermediate
state, so the sentence lands in the same patch as the behaviour it declares. There is no second
contract to run beside it.

## Global Constraints

- Check: `git diff --quiet $ULTRA_BASE -- fleet/run-engine.mjs fleet/run-waves.mjs fleet/run-main.mjs fleet/publish-fold.mjs fleet/launch.mjs`
- The engine's event log is read, never changed (the Check above is the whole of that rule):
  the boot script keeps relaying the last `engine:phase` line of `<run dir>/events.jsonl`, and
  the engine keeps emitting it exactly as it does at BASE.
- `status.json`'s shape is unchanged — the same eleven cells, the same bytes served at
  `/status.json` and committed under `.ultrapowers/runs/<N>/`.
- No token in any argv; every git command is the script's, made from the evidence worktree, and
  nothing outside `.ultrapowers/runs/<N>/` is ever staged.

**Acceptance:** suite — the committed suite is the verification.

### Task 1: One evidence commit per relayed phase

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/sandbox-boot.sh`
- Modify: `fleet/tests/_sandbox_boot_helpers.mjs`
- Modify: `fleet/CONTRACT.md`
- Test: `fleet/tests/test_sandbox_boot.mjs`

**Claim:** The boot script commits the page to the evidence branch on every `engine:phase` event it already relays to the live page (wave N, integration review, gate), not only on `running → publishing → done`. (quoted from #723)
Machine: M1. While the engine unit runs, each time `phase_refresher` relays a phase value the
page did not carry before — writing the live page as state `running` with that phase — the boot
script makes one evidence commit through the same `collect_evidence` then `push_evidence` pair
as a state transition (`git -C <evidence worktree> add -- .ultrapowers/runs/<N>`, `commit`,
`push origin HEAD:refs/heads/ultra/evidence-run-<N>`, `pull --rebase` on a refused push), so for
a stub engine that emits `Wave 1`, `Wave 2`, `Integration Review`, `gate` in that order,
`commitStates(ctx)` is exactly `['running', 'running', 'running', 'running', 'running',
'publishing', 'done']` and `commitPhases(ctx)` begins `['engine starting', 'Wave 1', 'Wave 2',
'Integration Review', 'gate']`, every one of those phase commits logged after the engine unit's
`systemd-run` line and before the script's `engine: exited` line; and every phase relayed
between those two lines appears exactly once among the committed pages' phases.
M2. A phase the page already carries produces no further commit: with `FLEET_STATUS_INTERVAL=1`
and a stub engine that writes one `engine:phase` line (`gate`) and stays alive four seconds,
the refresher writes the live page at least twice more with phase `gate` (the page is still
rewritten every poll — its `updatedAt` is the heartbeat) while exactly one committed page
carries phase `gate`, so `commitStates(ctx)` is exactly `['running', 'running', 'publishing',
'done']`.
M3. No phase, no commit, and the transitions keep their place: a stub engine that writes no
`engine:phase` line at all and stays alive three seconds under `FLEET_STATUS_INTERVAL=1`
leaves `commitStates(ctx)` exactly `['running', 'publishing', 'done']`; and in every case the
`publishing` and `done` commits follow the last phase commit, `evidenceDisciplineProblem(gitLog(ctx),
evidenceDir(ctx))` is `null` over the whole git log, and no `status: state=running` page is
written after `engine: exited` except the fold's own `publish fold` page.
M4. A refused phase push does not end the run: with every push of `ultra/evidence-run-<N>`
refused while the engine unit is alive and accepted before and after it, the refresher keeps
relaying every later phase to the live page and keeps committing (the commits are local until a
push lands), the run ends with `status.json` state `done`, `states(ctx)` never contains
`failed`, no notify titled `run-7 failed` is sent, the boot log carries no `FAILED:` line, and
the first accepted evidence push after the engine exits is the `publishing` transition's, so
`commitStates(ctx)` is the M1 sequence.
M5. `fleet/CONTRACT.md` declares the phase commits: its `**status.json:**` bullet under §Literals
says the same bytes are committed to `.ultrapowers/runs/<N>/status.json` on
`ultra/evidence-run-<N>` at every transition **and at every `engine:phase` the boot script relays
to the page while the engine runs**, and the `ultra/evidence-run-<N>` bullet's "Committed from a
detached worktree at every transition" sentence names the phase commits the same way — both
lines contain the literal `engine:phase`.

**Authorized-by:** #723 (desired state, 2026-09-06); `fleet/CONTRACT.md` §Literals (the
`ultra/evidence-run-<N>` bullet and the `**status.json:**` bullet — "at every transition");
doctrine "One merge, one writer" in `CLAUDE.md` (run STATE has one writer per run — the sandbox —
and its record is git, committed at every transition, `pull --rebase` on a non-fast-forward).

**Interfaces:**
- Consumes: none
- Produces: `commitPhases(ctx) -> string[]`
- Produces: `relayedPhases(ctx) -> string[]`

**Context:** BASE is `00fb22436c9fad7f6e37de3f11f73f709675ad35`. The facts below were read off
that tree; every line number is approximate and the names are exact.

*How the record is written at BASE.* `write_status()` (`fleet/sandbox-boot.sh` ~234) writes
`status.json` atomically (tmp + `mv`) and logs one `status: state=<s> phase=<p>` line; it commits
nothing. Every evidence commit is an explicit pair in `do_boot()` — `collect_evidence` (~678:
copies the run directory's receipts, `events.jsonl`, `engine.log`, `claude-version.txt` and the
page file by file into `$EVIDENCE_DIR/$EVIDENCE_PATH`) then `push_evidence "<subject>"` (~719:
`git -C $EVIDENCE_DIR add -- $EVIDENCE_PATH`, `ensure_git_identity`, `git commit -m` whose failure
is logged as `evidence: nothing to commit`, then a push loop: `git push origin
HEAD:refs/heads/$EVIDENCE_BRANCH`, on refusal `evidence: push rejected — rebasing (attempt n)` and
`git pull --rebase origin $EVIDENCE_BRANCH`, and on the fifth refusal `FAILING=1` and
`fail "evidence: push to … rejected 5 times"`). The pairs sit at `running "engine starting"`
(~1573, BEFORE `run_engine`), at `failed`, `parked`, `publishing`, `done`, and at the fold's
attempt 2. `fail` (~268) writes a `failed` page, commits it, sends the `run-<N> failed` notify,
logs `FAILED: …` and exits 1. `STATE` and `PHASE` are shell globals.

*The refresher at BASE.* `last_phase()` (~557) prints the phase of the LAST
`"kind":"engine:phase"` line of `<run dir>/events.jsonl`, where `<run dir>` is
`$TARGET_DIR/.claude/ultrapowers/run-<RUN_ID>`; `phase_refresher()` (~565) loops `sleep
"$STATUS_INTERVAL"` then `write_status running "$p"` whenever `last_phase` is non-empty — every
poll, changed or not. `STATUS_INTERVAL` is `${FLEET_STATUS_INTERVAL:-30}` (seconds; the rig
passes `30` by default and a case overrides it, as the green-path case at
`test_sandbox_boot.mjs` ~47 does with `1`). `run_engine()` (~605) starts it as
`phase_refresher >/dev/null 2>>"$BOOT_LOG" &`, runs the engine unit through `systemd-run --wait`,
then `kill "$refresher"` and `wait "$refresher"` — so the refresher is a **background subshell**:
its `STATE`/`PHASE` assignments never reach the foreground, a `fail` reached inside it exits only
the subshell (after writing a `failed` page and notifying, which is exactly what M4 forbids), and
the kill can land while it is mid-commit. Because the refresher reads only the last line, a phase
that lives shorter than one interval is never relayed to the page, and the claim quantifies over
relayed phases, not over lines of `events.jsonl`. `publish_fold()` (~925) deliberately runs with
no refresher (the comment at ~921 and the merge sim's case `no phase_refresher runs beside the
fold unit`, `test_sandbox_boot_merge.mjs` ~863, which counts exactly one `running` page after
`engine: exited`), so a refresher that outlives `run_engine` fails that case. The foreground
makes no evidence commit while the engine unit runs, so the refresher is the only committer in
that window; the two writers meet only at the kill, and a commit interrupted there — a half-made
`pull --rebase` in the evidence worktree — would break the `publishing` commit that follows.
The kill must therefore land between commits, never inside one (a trap that finishes the
in-flight cycle, a lock the foreground waits on, or a flag the loop checks — the implementer's
choice; M3's discipline predicate and the `publishing`/`done` tail are what pin the result).

*What the engine emits.* `fleet/run-waves.mjs` ~481 appends `{ kind: 'engine:phase', phase }` to
`events.jsonl`; `fleet/run-engine.mjs` calls it with `Setup`, `waveLabel(w)` (`Wave 1`, `Wave 2`,
…), `Depth-1 Leg` and `Integration Review`. The gate is the engine's last act and the stub's
phase literal for it is `gate`; the exam uses the engine's own spellings for the waves and the
review, and `gate` for the last, so the committed phases read like a live run's.

*The rig at BASE.* `_sandbox_boot_helpers.mjs`: the `systemd-run` stub's engine branch (~461)
writes ONE line, `{"kind":"engine:phase","phase":"gate","id":"x","ts":1}`, to
`$FLEET_HOME/target/.claude/ultrapowers/run-run-7/events.jsonl` at its start, writes the receipts
unless `STUB_NO_RECEIPT`, sleeps `STUB_ENGINE_SLEEP` seconds when set, and exits
`STUB_ENGINE_CODE`. The `git` stub's `commit` branch (~331) appends the evidence worktree's
`.ultrapowers/runs/7/status.json` to `$FLEET_HOME/commits.log` — so `committed(ctx)` is the page
AS COMMITTED, and `commitStates(ctx)` (~617) its `state` cells. Its `push` branch refuses every
push of `evidence-run-7` when `STUB_EVIDENCE_PUSH_FAIL` is set — that refuses the `running`
transition's push too and fails the run before the engine, which is why M4 needs a knob scoped
to the engine's life. `states(ctx)` is the consecutive-deduplicated `state=` sequence of the boot
log; `stream(ctx)` is the log with timestamps stripped; `indexOf`/`lastIndexOf` find a line;
`notifies(ctx)` parses `notify.log`; `evidenceDisciplineProblem(git, evidence)` (~701) returns
`null` only when every evidence push runs in the worktree with an `add` and a `commit` since the
previous push and the first evidence push precedes the first integration push; `gitLog(ctx)` and
`evidenceDir(ctx)` feed it. `green()` boots once per process with the rig defaults (interval
`30`, no engine sleep), so the refresher never polls in it and its pins — `['running',
'publishing', 'done']` at `test_sandbox_boot.mjs` ~634 and the same shape in
`test_sandbox_boot_edges.mjs` ~82, `test_sandbox_boot_record.mjs` ~287,
`test_sandbox_boot_selfmerge.mjs` ~293 and `test_sandbox_boot_merge.mjs` ~494/~1232 — are
unchanged by this task and stay as they are; only the green-path case at ~47 polls (interval
`1`, sleep `2`, the stub's one `gate` line), and it asserts `states(ctx)` and a
`status: state=running phase=gate` line, neither of which this task changes.

*The rig this task adds, as literals every leg reads.* Three knobs on the stubs and two readers
in the helpers:
- `STUB_ENGINE_PHASES` — unset: the stub's existing single `gate` line; set but empty: no
  `engine:phase` line at all; otherwise a `|`-separated list, each entry appended to
  `events.jsonl` as `{"kind":"engine:phase","phase":"<p>","id":"x","ts":<i>}` in order. Before
  appending the next entry the stub waits until `$FLEET_HOME/www/status.json` contains
  `"phase":"<p>"` (a 0.1-second poll, giving up after 20 seconds and exiting 3) — the handshake
  that makes every listed phase a relayed one, so the exam's counts are exact rather than
  timing-dependent; after the last entry the stub sleeps `STUB_ENGINE_SLEEP` as today.
- `STUB_EVIDENCE_PUSH_FAIL_WHILE_ENGINE` — the `git` stub refuses a push of `evidence-run-7`
  while `$FLEET_HOME/stub/engine-alive` exists; the engine stub creates that file first and
  removes it immediately before exiting, so the `running` push before the unit and every push
  after it are accepted.
- `commitPhases(ctx)` — `committed(ctx).map((c) => c.phase)`, the `phase` cell of each committed
  page in commit order.
- `relayedPhases(ctx)` — the consecutive-deduplicated `phase=` values of the
  `status: state=running phase=…` lines of `stream(ctx)` that sit after the `CALL systemd-run
  engine` line and before the `engine: exited` line, i.e. what the refresher relayed to the page
  while the unit was alive (`engine starting` is written before the unit and is not among them).

*Rule 5 — the live half of the issue's proof, not a leg.* The issue also asks that "a run's
evidence branch history shows one commit per wave"; that is read off a live run after this
lands, never from a sandbox: `git log --format='%s' origin/ultra/evidence-run-<N>` (while the
branch exists) or `git log --format='%s' ultra/evidence/run-<N>` (after the record is tagged)
should list one subject per relayed phase between `run-<N>: running` and the `publishing`
commit. `fleet/RUNBOOK.md` and `skills/ultrapowers/SKILL.md` say the page is committed "at
every transition"; that stays true and neither is touched — only the contract, the authority,
names the phase commits (M5). `tests/test_docs_agree_with_code.py` pins the contract's unit,
engine-directory, VM-name and two-tags literals, none of which M5's sentences touch.

**Proof:**
- Test: `fleet/tests/test_sandbox_boot.mjs`
- Legs, under a comment naming this task (`#723 — one evidence commit per relayed phase`):
  (a) a boot with `FLEET_STATUS_INTERVAL: '1'`, `STUB_ENGINE_PHASES: 'Wave 1|Wave 2|Integration
  Review|gate'`, `STUB_ENGINE_SLEEP: '3'` exits 0 and `commitStates(ctx)` deep-equals
  `['running', 'running', 'running', 'running', 'running', 'publishing', 'done']` while
  `commitPhases(ctx).slice(0, 5)` deep-equals `['engine starting', 'Wave 1', 'Wave 2',
  'Integration Review', 'gate']` [M1];
  (b) in that same boot, every entry of `relayedPhases(ctx)` occurs exactly once in
  `commitPhases(ctx)`, `relayedPhases(ctx)` deep-equals the four listed phases, and the index of
  every evidence-worktree `commit` line whose committed page carries one of those four phases
  lies after `indexOf(ctx, 'CALL systemd-run engine')` and before the `engine: exited` line [M1];
  (c) a boot with `FLEET_STATUS_INTERVAL: '1'`, `STUB_ENGINE_SLEEP: '4'` and `STUB_ENGINE_PHASES`
  unset has at least three `status: state=running phase=gate` lines in `stream(ctx)`, exactly
  one committed page with phase `gate`, and `commitStates(ctx)` deep-equal to `['running',
  'running', 'publishing', 'done']` — a second `gate` commit fails it [M2];
  (d) a boot with `FLEET_STATUS_INTERVAL: '1'`, `STUB_ENGINE_SLEEP: '3'` and `STUB_ENGINE_PHASES:
  ''` has `commitStates(ctx)` deep-equal to `['running', 'publishing', 'done']` and
  `relayedPhases(ctx)` deep-equal to `[]` — a commit made on a poll tick with no phase fails it
  [M3];
  (e) in the boot of (a): `commitStates(ctx).slice(-2)` deep-equals `['publishing', 'done']`,
  `evidenceDisciplineProblem(gitLog(ctx), evidenceDir(ctx))` is `null`, and the
  `status: state=running` lines after `lastIndexOf(ctx, 'engine: exited')` are exactly one, whose
  phase is `publish fold` [M3];
  (f) a boot with the environment of (a) plus `STUB_EVIDENCE_PUSH_FAIL_WHILE_ENGINE: '1'` exits 0
  with `statusOf(ctx).state === 'done'`, `states(ctx)` not containing `failed`,
  `notifies(ctx).map((n) => n.title)` not containing `run-7 failed`, no line of `stream(ctx)`
  starting `FAILED:`, `relayedPhases(ctx)` deep-equal to the four phases, `commitStates(ctx)`
  deep-equal to the sequence of (a), at least one `evidence: push rejected — rebasing` line and at
  least one `git -C <evidence worktree> pull --rebase` argv between the engine's `systemd-run`
  line and `engine: exited`, and the first accepted evidence push after `engine: exited` being the
  push whose committed page is the `publishing` one — a run that ends `failed`, a refresher that
  stops relaying after a refusal, or a `failed` notify each fails it [M4];
  (g) the existing case `one evidence commit per transition: running, publishing, done` at
  ~634 still pins `['running', 'publishing', 'done']` on `green()`, unchanged — the pin the
  sibling sims share is the same shape, so it stands in this file as the transition-only
  control [M3];
  (h) the three `Run:` commands below exit 0: the first finds `engine:phase` inside the
  contract's `**status.json:**` bullet, the second finds it inside the `ultra/evidence-run-<N>`
  bullet (the span from that bullet to the `ultra/integration-run-<N>` one), and the third is the
  docs-pin suite still green over the edited contract — a contract that names the phase commits
  in only one of the two bullets, or neither, fails it [M5].
- Run: sed -n '/^- \*\*status\.json:\*\*/,/^- \*\*Publish:\*\*/p' fleet/CONTRACT.md | tr '\n' ' ' | grep -q 'engine:phase'
- Run: sed -n '/ultra\/evidence-run-<N>. — the run/,/ultra\/integration-run-<N>. — the work/p' fleet/CONTRACT.md | tr '\n' ' ' | grep -q 'engine:phase'
- Run: python3 -m pytest tests/test_docs_agree_with_code.py -q -p no:cacheprovider

**Stale-if:**
- issue-closed: #723
- path-absent: `fleet/sandbox-boot.sh`
- path-absent: `fleet/tests/_sandbox_boot_helpers.mjs`
