# Fix prompt: `/ultrapowers <plan>` launches the raw engine and dies on `args` JSON parse

## Hand this to a fresh coding agent

> **Bug.** In the `ultrapowers` plugin, invoking `/ultrapowers <plan-path>` does **not** run the
> `ultrapowers:ultrapowers` skill (the documented entry point that compiles the plan into waves).
> Instead it launches the engine workflow directly and fails:
>
> ```
> Error: ultrapowers: args was a string but not valid JSON:
> JSON Parse error: Unexpected identifier "docs"   (waves.js / workflow.js)
> ```
>
> **Root cause — slash-command name collision.** The engine workflow
> `skills/ultrapowers/harnesses/waves.js` declares `meta.name: 'ultrapowers'`. The SessionStart hook
> (`hooks/session_start.sh`) copies it into `.claude/workflows/` every session, where the Workflow
> engine auto-registers it as a `/ultrapowers` slash command. That auto-command shadows the
> `ultrapowers:ultrapowers` skill that owns the same `/ultrapowers` name. So `/ultrapowers <plan>`
> resolves to the workflow stub `Workflow({ name: "ultrapowers", args: "<plan-path>" })`, which feeds
> the bare plan-path string into the engine; `waves.js` expects a compiled `args.waves` object and
> `JSON.parse("docs/...")` throws. The skill — which is what turns the plan path into
> `{ waves, wavesPath, edges, acceptance, ... }` via `compile_plan.py` — never runs.
>
> The probe workflow (`meta.name: 'ultrapowers-probe'`) never collides because its name is distinct.
> The engine workflow must follow the same convention.
>
> **Fix (primary): rename the engine workflow so it cannot occupy the `/ultrapowers` command.**
> Rename the WORKFLOW name only (`ultrapowers` → `ultrapowers-run`). Do **not** touch the plugin
> name, the skill name, the `ultra/` branch prefix, directory names, or any other use of the word
> "ultrapowers" — only the saved-workflow `meta.name` and every place that launches/resolves the
> workflow *by that name*. Update these in lockstep:
>
> 1. `skills/ultrapowers/harnesses/waves.js` — `meta.name: 'ultrapowers'` → `'ultrapowers-run'`.
> 2. `skills/ultrapowers/harnesses/waves.harness.json` — `"name": "ultrapowers"` → `"ultrapowers-run"`.
> 3. `skills/ultrapowers/SKILL.md` — every instruction that launches the workflow by name:
>    - Step 4b: "Launch the saved workflow by name `ultrapowers`" and "`meta.name` (`ultrapowers`)";
>      update the literal `Workflow({ name: 'ultrapowers', ... })` the orchestrator is told to call.
>    - Salvage / Redirect (Step 5): "relaunch ... by `meta.name` `ultrapowers`".
>    - Any other "launch ... `ultrapowers`" referring to the workflow (NOT the skill/plugin).
> 4. `skills/ultrapowers/references/workflow-template.md` — "launches by `meta.name` `ultrapowers`".
> 5. Tests (these currently PIN the colliding name and will fail until updated — that is expected):
>    - `tests/test_harness_registry.py`: `{"ultrapowers", "ultrapowers-probe"} <= names` →
>      `{"ultrapowers-run", "ultrapowers-probe"}`.
>    - `tests/test_orchestrator_markers.py` `test_orchestrator_launches_by_meta_name`:
>      `assert "name: 'ultrapowers'" in workflow` → `"name: 'ultrapowers-run'"`; fix its comment
>      (it claims launching as `ultrapowers-run` fails — that was only because meta.name didn't match;
>      with this rename, `ultrapowers-run` is now the correct, working name).
>    - `tests/test_session_hook.py`: derives the name from the manifest, so it should pass once (1)+(2)
>      agree — verify, don't assume.
>
> **Fix (regression guard): add a test that forbids the collision from coming back.** Assert that no
> registered write-side harness (`*.harness.json` with `writeSide: true`) has `meta.name == "ultrapowers"`,
> because that exact name shadows the `/ultrapowers` skill command. Put it in
> `tests/test_harness_registry.py`.
>
> **Fix (defense in depth, optional): make the engine fail loudly with a redirect.** In `waves.js`,
> where `args` is a string that fails `JSON.parse`, detect a plain plan path (contains `/` or ends in
> `.md`) and throw: *"ultrapowers: launched with a raw plan path. Run the `/ultrapowers` skill
> (ultrapowers:ultrapowers), which compiles the plan into waves; do not launch the engine workflow
> directly."* If you change `waves.js` prompt/body content, re-bake per
> `references/workflow-template.md` and keep `tests/test_no_prompt_drift.py` green. (A header-only
> `meta.name` change does not require a re-bake.)
>
> **Verify.**
> 1. `python3 -m pytest -q` — full suite green.
> 2. `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers` → `skill ok`.
> 3. Confirm the SessionStart hook installs the renamed file:
>    `bash hooks/session_start.sh` with `CLAUDE_PROJECT_DIR=$(mktemp -d)`, then check the copied
>    `.claude/workflows/waves.js` has `name: 'ultrapowers-run'`.
> 4. **Manual, in a NEW session** (the command registry is snapshotted at session start, so the old
>    `/ultrapowers` workflow command persists until you restart): type `/ultrapowers <plan-path>` and
>    confirm it now loads the `ultrapowers:ultrapowers` SKILL (compile → render wave plan → launch),
>    NOT the `Run the "ultrapowers" workflow. ... Invoke: Workflow({...})` stub. If bare `/ultrapowers`
>    no longer resolves to the skill at all, the skill's command exposure needs a separate look —
>    report that rather than re-adding the colliding workflow name.
>
> **Do not** "fix" this by making `waves.js` parse a plan path itself — the workflow has no
> filesystem/shell access and cannot run `compile_plan.py`; plan compilation belongs to the skill.

## Resolution (2026-06-15)

Fixed by renaming the engine workflow `ultrapowers` → `ultrapowers-run` (the workflow name only;
the plugin name, skill name, and `ultra/` branch prefix are untouched). Lockstep changes:

1. `skills/ultrapowers/harnesses/waves.js` — `meta.name: 'ultrapowers-run'` (+ a comment naming the
   collision), and a defense-in-depth redirect: when `args` is a bare string that is not JSON (a raw
   plan path), the workflow now throws *"run the /ultrapowers skill … do NOT launch the engine
   directly"* instead of the cryptic `Unexpected identifier` parse error.
2. `skills/ultrapowers/harnesses/waves.harness.json` — `"name": "ultrapowers-run"`, version `0.0.9` → `0.0.10`.
3. `skills/ultrapowers/SKILL.md` — Step 4b launch name and Step 5 Redirect relaunch now say `ultrapowers-run`.
4. `skills/ultrapowers/references/workflow-template.md` — install-path line updated.
5. `tests/test_harness_registry.py` — core set updated, **plus** a regression guard
   (`test_no_writeside_harness_shadows_the_ultrapowers_command`) forbidding any write-side harness
   from claiming `meta.name == "ultrapowers"`.
6. `tests/test_orchestrator_markers.py` — `test_orchestrator_launches_by_meta_name` pins
   `name: 'ultrapowers-run'`; stale comment corrected.

Verified: `python3 -m pytest -q` → 326 passed; `validate_skill.py skills/ultrapowers` → `skill ok`;
`session_start.sh` into a temp `CLAUDE_PROJECT_DIR` installs `.claude/workflows/waves.js` with
`name: 'ultrapowers-run'`. `test_session_hook.py` (derives the expected name from the manifest) passes
because (1) and (2) agree. **Step 4 (manual) still pending:** the command registry is snapshotted at
session start, so the old `/ultrapowers` workflow command persists until a NEW session — restart and
confirm `/ultrapowers <plan>` loads the SKILL, not the `Invoke: Workflow({...})` stub.

## Evidence (observed this session)

- `/ultrapowers <plan>` emitted: `Invoke: Workflow({ name: "ultrapowers", args: "docs/.../viewer-offer-dx.md" })`
  whose second line was `meta.description` verbatim — i.e. the auto-generated saved-workflow command.
- Direct launch failed at `workflow.js:14`: `args was a string but not valid JSON ... Unexpected identifier "docs"`.
- Recovery via the skill (`compile_plan.py --emit-launch` → assemble `args.waves` object → launch by name) succeeded.
- `harnesses/probe.js` uses `meta.name: 'ultrapowers-probe'` and never collides — the pattern to copy.
