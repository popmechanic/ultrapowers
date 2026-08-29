# Design rationale — the ultrapowers operator procedure

Maintainer rationale for the ultrapowers operator procedure. The operator
SKILL.md states WHAT to run; this file records WHY each guard exists. Load it
when changing the engine, the gate, or the scripts — not during routine runs.

---

## § Step 4 — Determinism guard and the read/write boundary

> **Determinism guard:** never trigger the run with the `ultracode` keyword or by
> asking for "a workflow" in prose — that opt-in makes Claude **author a new
> script at runtime**, which is exactly the nondeterminism this skill exists to
> remove. The only sanctioned launch is the saved workflow installed at Step 4a.
> If it cannot be launched, the run fails (no receipt → red) — never a
> fallback, never an improvised script.

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
written *during* the session (`ultra_run.py`'s `install` stage) is only registered
**next** session. This is exactly why a fresh checkout's first `/ultrapowers`
could fail with `Workflow "ultrapowers-run" not found` even though the install stage
had just copied the file: the project `.claude/workflows/` is gitignored and starts
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

## § Step 5 — Verdict independence from checkout position (#84)

The workflow's setup agent checks out the integration branch in a **dedicated
worktree**, never in the session repository. The verdict is then independent of
the session checkout's position on both of the legs that could otherwise read
it. The integrity checks below derive from ref-resolved `HEAD` — the report's
recorded merge sha and the completeness critic's own `git rev-parse HEAD`, both
verified mechanically — not from where the session happens to sit. And
acceptance is administered in a **fresh detached worktree** of the branch
(`run_acceptance.sh --suite-gate` does this), so the other
place the checkout position could bite is closed too. Neither leg alone
establishes position-independence: head-match without the detached suite-gate
would still run the tests in whatever tree the operator left behind.

So the engine never moves the operator's checkout, and (as of #84) no longer
moves it *back* either. That asymmetry is intentional — not restoring is the
safe direction — because a restore is not a free undo: it acts on whatever
checkout it finds, including one the operator deliberately moved. The 0.0.35
field incident is exactly that case, and it is the argument. The restore did not
fail; it **succeeded**, and in succeeding it wiped an operator's uncommitted
edit — the only data destruction in the ledger's history caused by the engine
itself. With the verdict already position-independent, restoring buys the checks
nothing and risks destroying work the operator meant to keep.

The gate mechanizes three integrity checks (now in `gate_check.py`, whose exit
code is the authority and which emits each literal):

- `git status --porcelain` MUST be empty. A non-empty result means a role wrote
  outside the worktree discipline — that work is unreviewed by construction.
  Surface it as BLOCKED; never silently reset it away.
- The integration branch HEAD MUST equal the report's last merge headSha. A
  mismatch means the tree on disk is not the one the run produced.
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

## § Dependency inference — the mixed-B-2 eval war story

Eval run mixed-B-2 (2026-06-13): a task spec said "returns a `schema.User`" while
declaring `Depends-on: none`, was waved parallel to the schema task, and its
failure cascade-blocked the rest of the diamond. A prose-only reference like that is no longer inferred: the prose-reference tier
that once serialized it was deleted in Phase 2 (0.2.17), so the guard is authoring —
declare the `**Interfaces:**` `Consumes`/`Produces` pair or the `**Depends-on:**`
marker (`references/dependency-analysis.md`), and the compiler's loud
`undeclared-dependency` finding catches a declared-but-unlinked pair at the Step-3
render. The same run motivated the FILES and SIBLING-FILES scope rules
carried by the implementer/reviewer role prompts (`fleet/roles/*.md` since 0.3.0):
the implementer's final commit deleted a sibling-owned file its task never named,
and the reviewer treated it as an ordinary judgment call.
