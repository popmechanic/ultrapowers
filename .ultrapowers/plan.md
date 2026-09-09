# The boot sim reads no renderer file the host installed (#833)

**Grammar:** claims-v1

**Claim:** A boot sim never reads a renderer file the host installed, and a sim that wants one writes its own. (elicited)

**Goal:** Close #833. Since 0.3.23 every launch whose `~/.ultrapowers/fleet.json` carries `render`
installs a real `/etc/fleet/render.env` on the sandbox, and `fleet/sandbox-boot.sh` sources
`${FLEET_RENDER_ENV:-/etc/fleet/render.env}` whenever that file is readable — so the boot sims,
whose rig (`fleet/tests/_sandbox_boot_helpers.mjs`) never sets `FLEET_RENDER_ENV`, read the
host's renderer on a plugin-target sandbox and assert an argv entry of `TINYAPP_RENDER_URL=`
against a real address. The suite was red at BASE on runs 73/74/75 for exactly this, invisible
on the laptop and in CI where no such file exists. After this plan the rig hands every boot a
`FLEET_RENDER_ENV` of its own — a path under the sim's temp `FLEET_HOME` that does not exist
unless the sim writes it — so a boot sim reads nothing the host installed, and a sim that wants a
renderer writes that file itself. Two choices were made in place of an operator question, each
the least machinery: (1) the rig's default is `<FLEET_HOME>/render.env`, not created by
`makeHome`, and a sim that wants one writes exactly that path — the state-exams sim's planted
boot already writes that path, so it keeps working whether or not it also passes
`FLEET_RENDER_ENV` explicitly; (2) the new legs live in a new guarded exam,
`fleet/tests/test_sandbox_boot_render_env.mjs`, named for the rig's render-env surface, rather
than in `test_sandbox_boot_state_exams.mjs`, because that sim is one of this task's own writes
(its bare-boot leg's `!fs.existsSync('/etc/fleet/render.env')` precondition is the other half of
the leak and goes) and an exam must be disjoint from the task's writes.
**Closes:** #833

**Tech Stack:** Node ESM sims under `fleet/tests/` (`node fleet/tests/test_*.mjs`, sentinel `ALL
TESTS PASSED`), bridged into pytest by `tests/test_fleet_suite.py`; bash (`fleet/sandbox-boot.sh`
under `set -euo pipefail`). No network, no systemd — the rig stubs every external call.

**Spec:** none — the issue is the spec (#833 §Desired state).

**Parallelization rationale:** one wave of width 1. One rig (`_sandbox_boot_helpers.mjs`) and
one sim carrying the old precondition are the whole change; splitting the exam from the rig edit
would only put a `Consumes:` wait between two edits of one seam.

## Global Constraints

- The boot script `fleet/sandbox-boot.sh` is not edited: the fix is in the sims' rig, not the
  production path (`FLEET_RENDER_ENV="${FLEET_RENDER_ENV:-/etc/fleet/render.env}"` at BASE
  stays as it is).
- Check: git diff --quiet $ULTRA_BASE -- fleet/sandbox-boot.sh fleet/setup-script.mjs fleet/CONTRACT.md
- No boot sim, and no rig it imports, names the host's renderer path; a sim that wants a
  renderer writes the file under its own temp `FLEET_HOME`.
- Every `fleet/tests/test_*.mjs` sim keeps printing `ALL TESTS PASSED` within the bridge's
  300 s cap (`MJS_TIMEOUT` in `tests/test_fleet_suite.py`), so a new exam adds at most a few
  boots, started concurrently through `bootAsync`, never a serial chain of them.

**Acceptance:** suite — the committed suite is the verification.

### Task 1: The rig owns the renderer path

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `fleet/tests/_sandbox_boot_helpers.mjs`
- Modify: `fleet/tests/test_sandbox_boot_state_exams.mjs`
- Modify: `fleet/tests/test_sandbox_boot.mjs`
- Test: `fleet/tests/test_sandbox_boot_render_env.mjs`

**Claim:** A boot sim never reads a renderer file the host installed, and a sim that wants one writes its own. (elicited)
Machine: M1. A boot started through `boot` or `bootAsync` whose case `env` carries no
`FLEET_RENDER_ENV` runs with `FLEET_RENDER_ENV` equal to `renderEnvPath(ctx)` — the path
`<ctx.home>/render.env` — in the environment the `systemd-run` stub records at
`<ctx.home>/systemd-run.env`, even when the test process's own environment carries
`FLEET_RENDER_ENV` naming a readable file whose one line is
`TINYAPP_RENDER_URL=https://browser-run.int.exe.xyz/client/v4/accounts/abc123/browser-rendering`,
and that boot's `fleet-engine-7` argv carries exactly one entry beginning `TINYAPP_RENDER_URL=`,
equal to `TINYAPP_RENDER_URL=`.
M2. A boot whose sim first writes the one line
`TINYAPP_RENDER_URL=https://browser-run.int.exe.xyz/client/v4/accounts/abc123/browser-rendering`
at `renderEnvPath(ctx)` and passes no `FLEET_RENDER_ENV` in its case `env` has that same line as
the one `TINYAPP_RENDER_URL=`-prefixed entry of its `fleet-engine-7` argv, in the `env` prefix
between `env` and `node`.
M3. No file among `fleet/tests/_sandbox_boot_helpers.mjs` and every
`fleet/tests/test_sandbox_boot*.mjs` (the whole boot-sim family, the guarded exam of this task
included) contains the string `/etc/fleet/render.env`, and each of the boot sims `test_sandbox_boot.mjs`, `test_sandbox_boot_effort.mjs` and
`test_sandbox_boot_state_exams.mjs` prints `ALL TESTS PASSED` under the pytest bridge.

**Authorized-by:** #833 §Desired state; `fleet/CONTRACT.md` §engine unit (the render entry "is
empty when the run carries no render integration")

**Interfaces:**
- Consumes: none
- Produces: `renderEnvPath(ctx: {home: string}) -> string`

**Context:** Facts at BASE `3fb782b6`, read from the files. `fleet/sandbox-boot.sh` line 72 sets
`FLEET_RENDER_ENV="${FLEET_RENDER_ENV:-/etc/fleet/render.env}"` (not exported; it reaches a
child's environment only when the boot was started with it) and lines 699–702 source that file
when it is readable, then line 713 spells the engine unit's entry
`"TINYAPP_RENDER_URL=${TINYAPP_RENDER_URL:-}"`. The rig's `bootEnv` (helpers line 686) builds
the child's environment from scratch — `PATH: process.env.PATH`, `HOME`, `FLEET_HOME`,
`FLEET_BIN_DIR`, the `STUB_*` values, then `...env` last so a case overrides anything — and never
spreads `process.env`, so the test process's own `FLEET_RENDER_ENV` never reaches the script
today either; the leak is the *absence* of the variable, which sends the script to the host's
`/etc/fleet/render.env`. The `systemd-run` stub (helpers line 524) runs `env
>"$FLEET_HOME/systemd-run.env"` before the engine line, so the boot's environment at engine
dispatch is readable from `<ctx.home>/systemd-run.env` — a `FLEET_RENDER_ENV=<path>` line there
is the observation M1 pins, and at BASE that line is absent. `makeHome` (helpers line 650)
creates `<home>/stub`, `<home>/bin` and the engine checkout, and must not create
`<home>/render.env`: the default path is one that does not exist unless a sim writes it.
`test_sandbox_boot_state_exams.mjs` already plants `path.join(ctx.home, 'render.env')` for its
planted boot (line 233) and passes `FLEET_RENDER_ENV: renderEnv` explicitly (line 235), which
stays legal; its bare-boot leg (a) asserts `!fs.existsSync(PROD_RENDER_ENV)` with
`PROD_RENDER_ENV = '/etc/fleet/render.env'` (lines 76, 285–289) — that precondition is the
second half of the leak (it fails on any sandbox carrying the real file) and is removed along
with the constant; legs (a) and (b) keep their current argv assertions. `test_sandbox_boot.mjs`
(line 229) and `test_sandbox_boot_effort.mjs` (line 58) deep-equal the engine argv with the entry
`TINYAPP_RENDER_URL=` and keep that assertion — they pass once the rig pins the path; the one
edit to `test_sandbox_boot.mjs` is its line-228 comment, which spells the host path the M3 sweep
forbids (reword it to say the rig's own path), and `test_sandbox_boot_effort.mjs` is not edited. The live
condition that exposed this: with `render` set in `fleet.json`, `fleet/setup-script.mjs`
`renderEnvStep` installs `TINYAPP_RENDER_URL=https://<integration>.int.exe.xyz/client/v4/accounts/<account>/browser-rendering`
at `/etc/fleet/render.env` on every sandbox (plugin targets included), and runs 73/74/75 parked
`baseline: RED on 3fb782b6` on the bridge case of `test_sandbox_boot_state_exams.mjs` in `tests/test_fleet_suite.py`;
the reading that the baseline is green again on a plugin-target run with `render` set is a live
fact for the PR body, not a `Run:` here. The exam is guarded so it sits at
`fleet/tests/test_sandbox_boot_render_env.mjs` and imports `./_sandbox_boot_helpers.mjs` at
that depth; it starts its boots through `bootAsync` side by side (a boot is ~40 forks of stub
shell) and sets `process.env.FLEET_RENDER_ENV` for leg (a) before calling the rig, then reads
`<ctx.home>/systemd-run.env` and `argvLines(ctx, 'systemd-run')` the way the state-exams sim's
`engineArgv`/`renderEntries` do. The exam must not itself spell the host's renderer path (write
it as a planted temp file's content and the variable name, never the `/etc/fleet` literal), so
the constraint above holds for it too.

**Proof:**
- Test: `fleet/tests/test_sandbox_boot_render_env.mjs`
- Guard: `fleet/tests/test_sandbox_boot_render_env.mjs`
- Legs: (a) with `process.env.FLEET_RENDER_ENV` set to a temp file the exam wrote holding the
  `abc123` line, a `bootAsync(ctx, ['boot'], {})` exits 0, `<ctx.home>/systemd-run.env` has
  exactly one line beginning `FLEET_RENDER_ENV=` and it equals `FLEET_RENDER_ENV=` followed by
  `renderEnvPath(ctx)`, which is `<ctx.home>/render.env`, and the `fleet-engine-7` argv's
  `TINYAPP_RENDER_URL=`-prefixed entries are exactly `['TINYAPP_RENDER_URL=']` [M1]; (a2)
  under that same process environment, a synchronous `boot(ctx, ['boot'], {})` on a second
  home exits 0 and its `<ctx.home>/systemd-run.env` and `fleet-engine-7` argv satisfy the same
  three assertions as the previous leg — the blocking entry point is exercised on its own, not
  inferred from the promised one [M1]; (b) a
  sim that writes the `abc123` line at `renderEnvPath(ctx)` and boots with `{}` gets
  `TINYAPP_RENDER_URL=https://browser-run.int.exe.xyz/client/v4/accounts/abc123/browser-rendering`
  as the one such entry, inside the `env` prefix (after the argv's `env`, before its `node`) —
  an empty `TINYAPP_RENDER_URL=` entry, a second such entry, or the line parked after `node`
  fails it [M2]; (c) the first `Run:` below sweeps the rig and every `test_sandbox_boot*.mjs` in one
  grep and fails on a survivor of the string in any one of them — at BASE it fails on the
  state-exams sim's `PROD_RENDER_ENV` constant [M3];
  (d) for each of `test_sandbox_boot.mjs`, `test_sandbox_boot_effort.mjs` and
  `test_sandbox_boot_state_exams.mjs`, the bridge case passes — the second `Run:` is red if any
  one of them lacks the sentinel [M3].
- Run: ! grep -q '/etc/fleet/render.env' fleet/tests/_sandbox_boot_helpers.mjs fleet/tests/test_sandbox_boot*.mjs
- Run: python3 -m pytest tests/test_fleet_suite.py -k "sandbox_boot" -q
- Run: node fleet/tests/test_sandbox_boot_render_env.mjs | grep -q 'ALL TESTS PASSED'

**Stale-if:**
- issue-closed: #833
- path-absent: `fleet/tests/_sandbox_boot_helpers.mjs`
- path-absent: `fleet/tests/test_sandbox_boot_state_exams.mjs`
