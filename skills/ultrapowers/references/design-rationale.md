# Design rationale — the ultrapowers operator procedure

Maintainer rationale for the ultrapowers operator procedure. The operator
SKILL.md states WHAT to run; this file records WHY each guard exists. Load it
when changing the engine, the gate, or the scripts — not during routine runs.

---

## § Step 1 — Self-host skew

When the working directory is the ultrapowers repository, the installed plugin
cache may lag `main` — launching the stale cache means the self-test exercises
the wrong engine ([ae56a1205e971b82]). On `SKEW`, install the repo engine into
`.claude/workflows/` before launch so the run exercises the current repo code,
not the stale cached copy: copy
`$(git rev-parse --show-toplevel)/skills/ultrapowers/harnesses/waves.js` to
`.claude/workflows/waves.js`. This overwrite is safe — Step 4a already treats the
installed file as ephemeral and overwrites it each run. The preflight only
applies when self-hosting (the repo root matches the plugin root's parent tree).
In ordinary project use the cache is the correct engine; skip it.

---

## § Step 4 — Determinism guard and the read/write boundary

> **Determinism guard:** never trigger the run with the `ultracode` keyword or by
> asking for "a workflow" in prose — that opt-in makes Claude **author a new
> script at runtime**, which is exactly the nondeterminism this skill exists to
> remove. The only sanctioned launch is the saved workflow installed at Step 4a.
> If it cannot be launched, diagnose with the Step 4a½ preflight before falling
> back — a freshly installed-this-session copy that the engine cannot yet see is a
> stale registry (cured by a new session), **not** the engine drift that Step 6
> exists for.

ultrapowers runs two kinds of phase, and they have different rules:

- **Write-side phases** — anything that creates branches, edits files, merges,
  or otherwise mutates a repository — MUST be executed by a registry harness
  (a `skills/ultrapowers/harnesses/<name>.harness.json` whose `writeSide` is
  true), launched by its `meta.name`. Never author or improvise a write-side
  harness at runtime.
- **Read-only phases** — discovery, triage, research, scoring — MAY be
  improvised at runtime as dynamic workflows, and an improvised workflow MUST
  stay read-only.

This is policy enforced by prompts and review, not a sandbox; the hard
guarantee is that nothing improvised ever holds the merge keys. The
determinism guard restated: never launch write-side work via the `ultracode`
keyword or a prose "make me a workflow" request — that authors a new script at
runtime, which is exactly the nondeterminism the registry exists to remove.

---

## § Step 4a — Saved-workflow registry snapshot

Saved workflows (`.claude/workflows/*.js`) are the documented deterministic
launch surface: they run **by name** with `args`, instead of relying on ad-hoc
script delivery. Plugins cannot ship saved workflows, so the copies must be
installed into the project.

The plugin's **SessionStart hook** (`hooks/session_start.sh`) does this install
at the start of *every* session — that is the load-bearing install, because the
engine snapshots its saved-workflow registry **once, at session start**. A copy
that lands on disk before that snapshot is registered this session; a copy
written *during* the session (the manual Step-4a install) is only registered
**next** session. This is exactly why a fresh checkout's first `/ultrapowers`
could fail with `Workflow "ultrapowers-probe" not found` even though Step 4a had
just copied the file: the project `.claude/workflows/` is gitignored and starts
empty, so at the registry snapshot only the plugin-shipped workflows existed. The
hook closes that window for normal use; the manual install remains an idempotent
safety net (hooks disabled, a non-hook surface, a hand-installed skill).

The installed filename is immaterial because the engine resolves saved workflows
by the script's `meta.name`, not the filename. Run the copy unconditionally — it
is byte-for-byte the committed script, so overwriting keeps any stale copy in
sync with the installed plugin version. Never edit the copy. (The workflow is
named `ultrapowers-run`, not `ultrapowers`, so the engine's auto-registered
`/<meta.name>` command cannot shadow the `/ultrapowers` skill — see
`docs/bugs/2026-06-15-ultrapowers-command-collision.md`.)

---

## § Step 4a½ — Args-probe payload-drop history

Launch the saved workflow `ultrapowers-probe` with a representative payload to
verify that the by-name launch delivers args faithfully — a tiny `ping`-only
probe can pass while a real-sized payload is silently dropped
([fb8635c59d4fea1c]). The probe echoes back the waves count and first task id so
a by-name launch's arg delivery is confirmed, not just `ping`; an
`echoWaves`/`echoFirstId` mismatch is a payload round-trip failure ([fb8635c5])
that routes to the sequential fallback, **not** a launch of the real workflow
with an arg-delivery failure confirmed. The three failure modes have different
cures: a **not-found** probe is a stale registry snapshot (cured by a new
session, not the sequential fallback); a probe that **launches but `ok` is not
true / errors mid-run** is genuine engine drift (Step 6); an **echo mismatch** is
the payload round-trip failure above (Step 6).

---

## § Step 5 — Checkout drift (#29 / #32) and the critic-wrong-tree class

The workflow's setup agent checks out the integration branch in the session
repository and nothing switches it back. Skipping the restore (or using a bare
`git checkout <baseBranch>`) makes every `git log`/`git merge` at this gate
silently target the integration branch, so the work *looks* prematurely merged
when it is not. A misbehaving review role cannot police itself and the engine has
no shell, so the clean-tree / head-match / gitVerified checks live at the gate,
where the main session does have one (now mechanized in `gate_check.py`, whose
exit code is the authority and which emits each literal):

- `git status --porcelain` MUST be empty. A non-empty result means a role wrote
  outside the worktree discipline (as in #32) — that work is unreviewed by
  construction. Surface it as BLOCKED; never silently `git reset` it away
  (silently moving trees is the very behavior #29 punished).
- The integration branch HEAD MUST equal the report's last merge headSha. A
  mismatch means the tree on disk is not the one the run produced (checkout
  drift, #29).
- The report's `gitVerified` MUST be true — the completeness critic confirmed,
  via its own `git rev-parse HEAD`, that it reviewed the recorded merge HEAD. A
  false `gitVerified` means the completeness review is unverified.

**Schema-degrade crash guard ([cbf0d886651f723c]).** Before indexing
`waveMerges[last].headSha`, `gate_check.py` checks that `waveMerges` is present,
non-empty, and that its last entry has a `headSha`. A budget-exhausted run (no
waves merged before the budget hit) or a SKIPPED-only run may produce an empty or
absent `waveMerges`; reading `waveMerges[last].headSha` there would crash. The
guard turns that crash into a deterministic gate refusal —
"merge-sha guard unavailable — result lacks waveMerges[last].headSha".

---

## § Step 5 — Why sealed exams are administered at the gate (#36)

For a `sealed` disposition the workflow reports `status: PENDING_GATE` — the
workflow could not administer the exam: it has no shell, and **relaying the
runner's JSON through a model corrupts it** (#36, the deleted RELAY path). So the
exam is administered deterministically, in the gate session, by
`run_acceptance.sh`, whose exit code is the authority; the emitted JSON is
rendered verbatim as a receipt, never a narrative the model retypes. The runner
creates its own detached worktree of the branch, so it is agnostic to the current
checkout. A non-zero exit carries a descriptive `status` (`assertion` vs
`collection` red, `EXAM_BOOTSTRAP_ERROR`, `SEAL_BROKEN`, `SEAL_MISSING`, runner
`ERROR`); an operator override of a red/broken/missing exam is recorded as a
waiver-with-reason.

---

## § Dependency inference — the mixed-B-2 eval war story

Eval run mixed-B-2 (2026-06-13): a task spec said "returns a `schema.User`" while
declaring `Depends-on: none`, was waved parallel to the schema task, and its
failure cascade-blocked the rest of the diamond. That is the motivating failure
behind the compiler's **prose-reference edge**
(`references/dependency-analysis.md`) — an undeclared dependency expressed only in
prose is serialized instead of cascading at runtime — and behind the **Salvage**
path, which pulls a failed/blocked branch's already-correct work in rather than
reimplementing it. The same run motivated the FILES and SIBLING-FILES scope rules
baked into the implementer/reviewer prompts (`references/reviewer-prompts.md`):
the implementer's final commit deleted a sibling-owned file its task never named,
and the reviewer treated it as an ordinary judgment call.

---

## § Step 3 — Acceptance vouching (why the rubric needs no code-reading)

The sealed-exam vouching rubric asks the operator to compare the exam's
plain-English coverage summary against **their own** spec, never the test code:
the operator cannot see the sealed test and does not need to. An honest
implementation could fail an exam that invented checks the spec never asked for,
so the second rubric question (invented anything?) is as load-bearing as the
first (everything covered?). If the operator cannot vouch, the remedy is to
re-seal (the ultraplan sealing step) or waive explicitly — never rubber-stamp a
summary that does not match the spec.

**2026-07-03 field evidence (foreign engine run, engine 0.0.30).** A 7-task
production run confirmed the attention-moving thesis directly: the operator's
only involvement was the planning decisions, vouching for the sealed exam's
coverage at launch, and one physical-world check no tooling could reach
(confirming an email landed in a personal inbox). Everything from launch to
the pre-merge gate ran unattended, and the operator's unrelated
work-in-progress came back byte-for-byte intact.
