# 0004. The sandbox boot and its evidence

Status: accepted (2026-11-21)  
Governs: `evals/readings/boot_clock.py`, `factory/boot.sh`, `factory/preflight.mjs`

Recovered from the code comments removed by `/delete-comment` on 2026-11-21: each entry is a
decision the code cannot show on its own. Symbols are named; line numbers are not.

## Sandbox boot

- **factory/boot.sh** — factory/boot.sh is the sandbox side of a run: it clones the target, reads the plan from live/<slug>/run-<N> of the operator's evidence repository, runs the Flock engine as a transient user service, publishes, and always leaves one tag <slug>/run-<N>. The only ref it writes to the target is ultra/integration-run-<N>. Every external program goes through a fleet_* wrapper and every path hangs off $FLEET_HOME, so the boot exam can drive it against stubs.
- **factory/boot.sh FLEET_COMMIT_SECONDS** — The run record on the evidence live branch is what fleet/run-read.mjs watches, so factory/boot.sh relays events every FLEET_COMMIT_SECONDS, 10 s by default since 2026-11-13. A reader is then at most one tick behind; it was 60 s while an issue hub carried the live view.
- **factory/boot.sh FLEET_RUN_MAX_SECONDS** — A run has one clock: factory/boot.sh sets RuntimeMaxSec=FLEET_RUN_MAX_SECONDS (14400 s, four hours) on the engine's systemd unit, and whatever landed by then is published as a draft. No builder carries a time cap of its own.
- **factory/boot.sh XDG_RUNTIME_DIR** — `systemd-run --user` needs a session bus address; a process started from the run unit inherits one but an ssh session does not. factory/boot.sh therefore defaults XDG_RUNTIME_DIR and DBUS_SESSION_BUS_ADDRESS to /run/user/<uid>.
- **factory/boot.sh stamp_ms** — Boot log stamps are UTC to the millisecond. factory/boot.sh stamp_ms uses bash 5's $EPOCHREALTIME on the VM and falls back to one python3 call, because macOS /bin/bash 3.2, which the boot sims run, has no $EPOCHREALTIME.
- **factory/boot.sh json_field** — factory/boot.sh reads JSON without jq: every value it needs is one flat string field of a small document, so json_field greps the field and an absent field yields empty output rather than an error. The VM needs no jq dependency.
- **factory/boot.sh prepare** — factory/boot.sh prepare runs the target and evidence clones as parallel background subshells. Each subshell's fail() writes its message to a file and exits only itself; the parent turns those files into one boot fail() that logs the single FAILED: line, naming both reasons, the target's first, when both clones fail. EXIT traps expand the file path when set, because under bash 3.2 a function local is gone when the trap runs.
- **factory/boot.sh prepare** — factory/boot.sh leaves the target clone checked out at BASE and shallow-clones only the run's live branch of the evidence repository; on a fresh clone that branch's tip must equal the assignment's plan= sha before any model reads the plan. The two clones run side by side as background subshells whose failures are reported by the parent.
- **factory/boot.sh prepare PLAN_JSON** — factory/boot.sh runs plan_parse.py once per run, from the engine checkout, into PLAN_JSON. The engine, the catch-up, the PR body and the publish probe all read that one file, so they cannot disagree about the plan.
- **factory/boot.sh run_engine** — factory/boot.sh runs the engine as a transient systemd user SERVICE, not a scope: --wait hands back the exit code and --collect unloads the unit. While it runs the boot relays events every FLEET_COMMIT_SECONDS and checks for exit every second.
- **factory/boot.sh run_engine** — factory/boot.sh polls for the engine's exit every second and relays events only every FLEET_COMMIT_SECONDS. A single sleep for both left publish waiting up to a whole tick after the engine exited (13 to 58 s on flock-baseline runs 4 to 6, 2026-09-26).
- **factory/boot.sh died** — factory/boot.sh died runs from the run unit's systemd ExecStopPost=: a boot killed before its record ended leaves a failed record with the unit's journal and its tag, and a record that already ended is left alone. It always exits 0, even after a fail inside parse_assignment, because a stop hook's exit code only muddies the unit's state.

## Readings tools

- **evals/readings/boot_clock.py GIT_ENV** — evals/readings/boot_clock.py runs unattended, so every git call sets GIT_TERMINAL_PROMPT=0 and an ssh BatchMode with a connect timeout, and every call carries a timeout. The reading never waits on a credential prompt or an ssh host-key question.
- **evals/readings/boot_clock.py when** — Python's datetime.fromisoformat before 3.11 accepts only 3 or 6 fractional-second digits, so evals/readings/boot_clock.py when() pads or cuts the fraction to six digits before parsing. VM log stamps of any sub-second resolution then parse on older interpreters.
- **evals/readings/boot_clock.py main** — evals/readings/boot_clock.py fetches run tags blobless (--filter=blob:none), so it configures the fetch URL as a promisor remote with partialclonefilter blob:none. Git then loads the skipped blobs on demand when `git show` reads events.jsonl and logs.
- **evals/readings/boot_clock.py main** — evals/readings/boot_clock.py reaches the evidence remote once with ls-remote before reading any run. An unreachable remote exits non-zero with one line naming it, so it is never reported as n=0 with every run skipped.
- **evals/readings/boot_clock.py main** — `git ls-remote --exit-code` exits 2 when the remote was reached but has no matching ref, so evals/readings/boot_clock.py treats exit codes 0 and 2 as reachable. A record repository with no HEAD still counts as reachable.

## Run record

- **factory/boot.sh prepare plan.json** — factory/boot.sh copies the run's plan parse into runs/<slug>/<N>/plan.json in the evidence record, so a reader sees exactly what the engine read.
- **factory/boot.sh write_status** — The run's status.json has one writer, factory/boot.sh write_status, which renders twelve cells through `factory/record.mjs status` into a temp file and renames it into place. startedAt is the run's clock and is set once; every write stamps updatedAt.
- **factory/boot.sh collect_evidence** — factory/boot.sh copies a fixed list of named engine files into the evidence folder and never uses `git add -A`, because the engine's working clones live under the run directory and none of them is evidence.
- **factory/boot.sh evidence_commit** — factory/boot.sh adds the run's named record files with `git add -f`, whatever a .gitignore says. Runs 38 and 39 (2026-09-24) tagged no engine.log and no publish-deploy.log because an ignored *.log pattern dropped them.
- **factory/boot.sh record_tags** — A run leaves one tag <slug>/run-<N> in the evidence repository; the live branch is only its workspace. factory/boot.sh record_tags deletes the live branch only after ls-remote lists the tag at the evidence HEAD, and every unhappy path logs one record: line and returns 0.

## Run outcome

- **factory/boot.sh boot** — After the engine exits, factory/boot.sh compares the target HEAD with the base: nothing ahead of base ends the run as done when the engine exited 0 (every proof already held at base) and as failed otherwise; anything ahead goes to publish.
- **factory/boot.sh boot** — A run whose main moved while it ran ends on the main it moved to and writes that sha to $RUN_DIR/base. factory/boot.sh adopts it as BASE_SHA, so nothing-ahead-of-base and the publish catch-up are judged against the moved main.
- **factory/boot.sh boot** — When the engine exits 0 on a snapshot equal to the base, every proof already held there; factory/boot.sh finishes the run as done with 'nothing to build' and publishes nothing.

## Run assignment protocol

- **factory/boot.sh parse_assignment** — The run assignment comment carries key=value tokens (run, plan, target, base, engine, kind, hold). factory/boot.sh records hold=1 as HOLD_FLAG and passes it to factory/publish.mjs, which then never sends a merge.
- **factory/boot.sh read_evidence_repo** — The operator's evidence repository is one owner/repo line in $FLEET_HOME/fleet-evidence-repo, written by the first-boot setup script. factory/boot.sh never derives it from the target, and refuses the run when the file is absent or malformed.

## Boot credential probe

- **factory/preflight.mjs classify / factory/boot.sh preflight** — factory/preflight.mjs runs claude auth status and, only when that is not decisive, one GET <proxy>/api/oauth/usage, then prints exactly one classification line (alive, api_key, no_oauth, inconclusive, bearer_dead <code> <message>, edge_refused <code> <line>). It decides nothing: factory/boot.sh reads the line and turns api_key, no_oauth, bearer_dead and edge_refused into a refusal and alive or inconclusive into proceed. classify is pure and exported so an exam can drive it.

## Claude code version floor

- **factory/boot.sh claude_current CLAUDE_FLOOR** — The exe.dev image bakes whatever Claude Code release was current at build time (2.1.258 and 2.1.267 seen on 2026-10-01), so factory/boot.sh runs `exeuntu update claude` before the preflight, refuses below CLAUDE_FLOOR 2.1.287 (the first release with mods), and pins it with DISABLE_AUTOUPDATER. exeuntu update fetches without a credential and swaps the binary only after its checksum agrees, so a failed update leaves the old binary and the floor refuses the run (Shelley, fleet-counsel, 2026-10-01).

## Credential preflight

- **factory/boot.sh preflight** — factory/preflight.mjs classifies the Claude credential in one printed line and factory/boot.sh only decides: api_key or no_oauth refuse (they bill exe.dev credits or leave the claude-max subscription), bearer_dead and edge_refused refuse naming what refused, and alive or inconclusive proceed. A probe that parked a run on a flake would cost more than it saves.

## Fleet edge credentials

- **factory/preflight.mjs usageProbe** — On a fleet VM the Claude credential is injected by the exe.dev edge, so factory/preflight.mjs usageProbe sends the literal bearer 'placeholder' to <proxy>/api/oauth/usage and never holds a real token. The probe is bounded at 20 s and answers {} on any failure so the boot reads it as inconclusive rather than crashing.

## Publish sequence

- **factory/boot.sh publish** — Publishing runs in plain sequence after the engine, never inside it: factory/boot.sh calls factory/publish.mjs, which opens the PR (a draft unless the engine finished green), self-merges under publish.self_merge with catch-up to a moved main, and runs the deploy. publish.mjs prints state, phase, PR url, PR author and merge sha one per line, which factory/boot.sh reads by line number, or a refusal it fails on.
