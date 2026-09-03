# The fleet contract (v2, 2026-09-03 — after Counsel 2). Every builder reads this first.

Design record: `docs/superpowers/specs/2026-09-03-fleet-on-the-grain.md`, whose `## Counsel 2` section
(Sol + Opus on the papercuts of runs 65–69) is the authority for everything below. Where v1 of this
file (git history) and this text disagree, this text wins. The engine (`run-main.mjs`, `run-engine.mjs`,
`run-worker.mjs`, `run-waves.mjs`, `confine-hook.mjs`, `fitness.mjs`, `roles/`) is untouched.

## The shape in one paragraph
A run is a number N. Its plan is `plans/run-N.md` in `popmechanic/fleet-runs`, committed by the launcher
before any VM exists. The launcher `cp`s the golden to a fresh, never-reused VM name, attaches the run's
integrations to THAT VM, writes the assignment as the VM comment (the record), waits for ssh, and STARTS
the run over ssh: `systemctl --user --no-block start fleet-run.service`. The golden carries only an immutable
bootstrap, which reads the assignment once, clones the engine at `engine=` into a content-addressed
directory, and execs the checkout's `fleet/sandbox-boot.sh`. The boot script runs the engine as a
transient user SERVICE with a memory cap, serves a status page from its own transient service, commits
receipts and `status.json` to fleet-runs at every transition, and — only when there is something to
publish — waits for the write grant, pushes and opens the PR. The janitor and the grant tool read
fleet-runs, never a VM. No orchestrator, no control VM, no token on any VM.

## Literals
- **Run id:** `N` = 1 + max N over `fleet-runs/plans/run-*.md` (`--run N` overrides). `RUN_ID=run-N`.
- **VM name:** `fleet-r<N>-<yymmddHHMM>-<4 hex>` (e.g. `fleet-r70-2609032215-a1b2`). exe.dev reserves deleted
  names forever, so a name is one incarnation and is never derived from N alone. Lookup by pattern:
  `ssh exe.dev "ls 'fleet-r<N>-*' --json"`; the whole fleet: `ls 'fleet-r*' --json`. Read `.vms[]` ONLY
  (`.shared_vms` are other people's). Contractual row fields: `vm_name`, `ssh_dest`, `ssh_host`, `status`.
  `comment`, `tags`, `created_at` are undocumented: read them as optional, never crash on their absence,
  never decide from `created_at`. Use `ssh_dest` for ssh/scp, never `<vm_name>.exe.xyz`.
- **Golden:** `fleet-golden` (config `golden`), tag `fleet`; `cp <golden> <vm> --copy-tags --json`.
- **Comment** (≤200 bytes, one line, space-separated `key=value`, this order, nothing else):
  `run=<N> plan=<40-hex sha in fleet-runs> target=<owner>/<repo> base=<40-hex> engine=<40-hex>` then
  optional `overlap=fold|serialize`, `tier=standard|mostCapable`. Written once by the launcher; the
  sandbox reads it ONCE from `https://reflection.int.exe.xyz/comment` (`{"comment": "..."}`) and fails
  the run if it is absent or malformed. Nobody rewrites it.
- **Launch order (launcher):** commit plan → `cp` → `integrations attach claude-max vm:<vm> --for 6h` →
  `integrations attach t-<owner>-<repo>-ro vm:<vm> --for 6h` (skip when the target is public and no
  `-ro` integration exists) → `comment <vm> '<assignment>'` → wait until `ssh <ssh_dest> true` succeeds
  (retry ≤120 s) → `ssh <ssh_dest> 'XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user --no-block start fleet-run.service'`.
  Start AFTER attach: the boot never races the grant.
- **Golden contents (golden-setup.sh):** node, bun, npm, xdist, `busybox`, `gh`, the immutable
  `/home/exedev/fleet-bootstrap.sh` (a copy of `fleet/fleet-bootstrap.sh`, mode 755), the user unit
  `~/.config/systemd/user/fleet-run.service` (a copy of `fleet/fleet-run.service`, `Type=oneshot`,
  `ExecStart=/home/exedev/fleet-bootstrap.sh`, installed and daemon-reloaded but NOT enabled — the
  launcher starts it), `loginctl enable-linger exedev`, stamp `/home/exedev/.fleet-golden` = sha256 of
  `fleet/golden-setup.sh` written LAST. No `/home/exedev/repo`, no engine pre-clone, no `ANTHROPIC_*`.
- **Bootstrap (`fleet/fleet-bootstrap.sh`, ≤40 lines, bash, `set -euo pipefail`):** read the comment once
  → parse `engine=` (40 hex or fail) → `dst=/home/exedev/engines/<sha>`; if absent, clone
  `https://github.com/popmechanic/ultrapowers.git` to `$dst.tmp`, `git checkout -q <sha>`, `mv` →
  `exec "$dst/fleet/sandbox-boot.sh" boot` with `FLEET_ASSIGNMENT='<comment>'` in its env. It never writes
  anywhere but `/home/exedev/engines/` and `/home/exedev/fleet-boot.log`. It is never overwritten by a run.
- **Boot script (`fleet/sandbox-boot.sh`), invoked by the bootstrap:** takes the assignment from
  `FLEET_ASSIGNMENT` (one Reflection read as fallback; no polling loop). Paths: engine
  `/home/exedev/engines/<sha>` (`ENGINE_REPO_DIR`), target `/home/exedev/target` (clone at `base=` through
  `https://github.int.exe.xyz/<owner>/<repo>.git`, public fallback `https://github.com/...`), fleet-runs
  `/home/exedev/fleet-runs`, status `/home/exedev/www/status.json` + `engine.log`, boot log
  `/home/exedev/fleet-boot.log`. Engine deps: `npm ci` (or `npm install` without a lockfile) in
  `fleet/` ONLY when `fleet/package.json` declares dependencies.
  - status server: `systemd-run --user --unit=fleet-status -p Restart=on-failure -- busybox httpd -f -p 8000 -h /home/exedev/www`
    (skip when the unit is already active). exe.dev proxies port 8000 at `https://<vm>.exe.xyz/`.
  - engine: `systemd-run --user --unit=fleet-engine-<N> --pipe --wait --collect -p MemoryMax=40G -p MemorySwapMax=0 --
    env -u CLAUDE_CONFIG_DIR ANTHROPIC_BASE_URL=https://claude-max.int.exe.xyz CLAUDE_CODE_OAUTH_TOKEN=placeholder
    ULTRAPOWERS_FLEET_RUN=run-N node <engine>/fleet/run-main.mjs /home/exedev/fleet-runs/plans/run-N.md run-N --repo /home/exedev/target [--tier …] [--overlap …]`,
    cwd `/home/exedev/target`, stdout+stderr teed to `/home/exedev/www/engine.log`; the exit code is the
    service's (`--wait`). `claude auth status` must show `oauth_token` — logged before the engine starts.
    No `--scope`, no `KillMode=process`, no re-exec, no self-hash.
  - after the engine: exit 1 WITH a gate receipt is a verdict (parked), not a failure. `ahead = git rev-list
    --count <base>..ultra/integration-run-N`; `ahead == 0` → state `parked`, evidence committed, NO grant
    wait, NO push, NO PR. Otherwise `awaiting-grant` (written only after `systemctl --user is-active
    fleet-engine-<N>.service` is inactive) → poll Reflection `/integrations` for `t-<owner>-<repo>-rw`
    (≤ `WRITE_GRANT_TIMEOUT`) → `git push origin ultra/integration-run-N` → `GH_HOST=github.int.exe.xyz gh pr
    create --repo <owner>/<repo> --head ultra/integration-run-N --title … --body-file …` (`--draft` unless the
    verdict is PASS) → `done` (PASS) or `parked`. `gh auth status` is NOT a health check (the token is at the
    edge); `gh repo view <owner>/<repo> --json nameWithOwner` is.
  - re-entry is idempotent: a page already `done`/`parked`/`failed` with the engine marker present exits 0;
    a recorded `pr` is never opened twice; clones present are not re-cloned; `runs/<N>/` is never checked
    out over. A failure at ANY step commits and pushes a `failed` page before exiting (pre-clone included).
- **status.json:** `{"run":"<N>","state":"booting|running|awaiting-grant|publishing|done|parked|failed","phase":"<text>","pr":"<url or null>","branch":"ultra/integration-run-<N>","vm":"<vm_name>","startedAt":"<iso>","updatedAt":"<iso>","error":"<string or null>"}`
  — the SAME bytes are served at `/status.json` and committed to `fleet-runs/runs/<N>/status.json` at every
  transition (plus `receipt.json`, `gate-receipt.json`, `report.json`, `events.jsonl`, `engine.log`).
  Append-only paths; `pull --rebase` and retry on non-fast-forward.
- **Grant (`fleet/grant.mjs <N>`):** `git pull` fleet-runs → require `runs/<N>/status.json` state
  `awaiting-grant` (`--live` reads `https://<vm>.exe.xyz/status.json` with the VM token instead) → find
  the VM by `ls 'fleet-r<N>-*' --json` → `integrations detach t-<owner>-<repo>-ro vm:<vm>` (ignore "not
  attached") → `integrations attach t-<owner>-<repo>-rw vm:<vm> --for 15m`. `-ro` and `-rw` are never
  attached to one VM at once; NO GitHub integration is attached to `tag:fleet` except `fleet-runs`.
- **Janitor (`fleet/janitor.mjs`):** `git pull` fleet-runs; for each `runs/<N>/status.json` in
  `done|parked|failed` with `updatedAt` older than 1 h → `ls 'fleet-r<N>-*' --json` → `rm <vm> --json` for
  each row. For each `ls 'fleet-r*' --json` row whose N has no status update in 6 h → notify once
  (`https://notify.int.exe.xyz/` is a VM-side endpoint; from the laptop the janitor prints it). No ssh into
  any VM, no `created_at`.
- **Lobby errors:** every lobby call captures stdout+stderr; on non-zero exit the tool prints ALL of it
  verbatim (`exe.dev <verb> failed (exit N):\n<output>`) — no envelope is documented.
- **Laptop config `~/.ultrapowers/fleet.json`:** `{"golden":"fleet-golden","fleetRuns":"~/.ultrapowers/fleet-runs","vmTokenPath":"~/.ultrapowers/vm-token"}`.
- **Naming for exe.dev verbs:** through the `exec` seam so tests stub them; `isSafeSha`/`isSafeTarget`
  validate anything interpolated. Never a `--cmds` lobby key on any VM.

## Rules
- Amendment 10: models never run git; every git/gh command is a script's.
- No secret on any VM. `--for` on every attachment.
- Scripts pass `bash -n`; tests: pytest under `tests/`, node `.mjs` under `fleet/tests/` (sentinel `ALL
  TESTS PASSED`, <120 s, no network, stub `curl`/`git`/`gh`/`ssh`/`systemd-run`/`systemctl` via a PATH shim).
  Test behaviour, not sentences; no test pins a sentence of a document.
- Prefer deleting to adapting. A file named for what it does.
