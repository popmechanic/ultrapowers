# The fleet contract (v2, 2026-09-03 — after Counsel 2). Every builder reads this first.

Design record: `docs/superpowers/specs/2026-09-03-fleet-on-the-grain.md`, whose `## Counsel 2` section
(Sol + Opus on the papercuts of runs 65–69) is the authority for everything below. Where v1 of this
file (git history) and this text disagree, this text wins. The engine (`run-main.mjs`, `run-engine.mjs`,
`run-worker.mjs`, `run-waves.mjs`, `confine-hook.mjs`, `fitness.mjs`, `roles/`) is untouched.

## The shape in one paragraph
A run is a number N. Its plan is `plans/run-N.md` in `popmechanic/fleet-runs`, committed by the launcher
before any VM exists. The launcher `cp`s the golden to a fresh, never-reused VM name, attaches the run's
integrations to THAT VM, writes the assignment as the VM comment (the record), waits for ssh, and STARTS
the run over ssh: `systemctl --user start fleet-run@<N>.service`. The golden carries only an immutable
bootstrap, which reads the assignment once, clones the engine at `engine=` into a content-addressed
directory, and execs the checkout's `fleet/sandbox-boot.sh`. The boot script runs the engine as a
transient user SERVICE with a memory cap, serves a status page from its own transient service, commits
receipts and `status.json` to fleet-runs at every transition, and — only when there is something to
publish — pushes and opens the PR over GitHub's REST API through the edge. The PR is the human gate:
the target's one integration is attached at launch for the run's whole life, and there is no grant
step. The janitor reads fleet-runs, never a VM. No orchestrator, no control VM, no token on any VM.

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
  `integrations attach gh-<owner>-<repo> vm:<vm> --for 6h` (a refusal, before the plan is committed,
  when `integrations list --json` has no such object — the fix named is `node fleet/target.mjs
  <owner>/<repo>`; a public target would still clone from github.com but could not push or open its
  PR, so it is not launched) → `comment <vm> '<assignment>'` → wait until `ssh <ssh_dest> true` succeeds
  (retry ≤120 s) → `ssh <ssh_dest> 'XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user start fleet-run@<N>.service'`
  — no `--no-block`: the unit is `Type=exec`, so `start` returns once the bootstrap has execve'd and
  non-zero when it could not; that exit status is the launch ack, and a non-zero one is a launch
  failure printed verbatim. Start AFTER attach: the boot never races an attachment.
- **Golden contents (golden-setup.sh):** node, bun, npm, xdist, `busybox`, `gh`, the immutable
  `/home/exedev/fleet-bootstrap.sh` (a copy of `fleet/fleet-bootstrap.sh`, mode 755), the user unit
  TEMPLATE `~/.config/systemd/user/fleet-run@.service` (a copy of `fleet/fleet-run@.service`:
  `Description=ultrapowers run %i`, `After=network-online.target`, `Type=exec`, `RemainAfterExit=yes`,
  `RuntimeMaxSec=6h`, `ExecStart=/home/exedev/fleet-bootstrap.sh %i`, no `[Install]`, no `KillMode`, no
  `Restart`; installed and daemon-reloaded but never enabled — the launcher starts the instance
  `fleet-run@<N>.service`), `loginctl enable-linger exedev`, stamp `/home/exedev/.fleet-golden` = sha256 of
  `fleet/golden-setup.sh` written LAST. No `/home/exedev/repo`, no engine pre-clone, no `ANTHROPIC_*`.
  Why a template of `Type=exec` and not a oneshot (Counsel 3, measured on exeuntu, systemd 255): a
  oneshot has `TimeoutStartUSec=infinity`, ignores `RuntimeMaxSec=`, and finished reads `inactive/dead`
  — indistinguishable from never started. `systemctl --user show fleet-run@<N>.service -p ActiveState
  -p SubState -p Result -p ExecMainStatus` now reads: `active/exited` + `success` = done;
  `failed` + `ExecMainStatus=N` = crashed with exit N; `failed` + `Result=timeout` = over the 6 h budget;
  `inactive/dead` = never launched.
- **Bootstrap (`fleet/fleet-bootstrap.sh`, ≤40 lines, bash, `set -euo pipefail`):** read the comment once
  → when `$1` (the unit's `%i`) is given, it and the comment's `run=` agree or the run fails → parse
  `engine=` (40 hex or fail) → `dst=/home/exedev/engines/<sha>`; if absent, clone
  `https://github.com/popmechanic/ultrapowers.git` to `$dst.tmp`, `git checkout -q <sha>`, `mv` →
  `exec "$dst/fleet/sandbox-boot.sh" boot` with `FLEET_ASSIGNMENT='<comment>'` in its env. It never writes
  anywhere but `/home/exedev/engines/` and `/home/exedev/fleet-boot.log`. It is never overwritten by a run.
  The assignment comes from Reflection, never from `$1`.
- **Boot script (`fleet/sandbox-boot.sh`), invoked by the bootstrap:** takes the assignment from
  `FLEET_ASSIGNMENT` (one Reflection read as fallback; no polling loop). Paths: engine
  `/home/exedev/engines/<sha>` (`ENGINE_REPO_DIR`), target `/home/exedev/target` (clone at `base=` through
  `https://github.int.exe.xyz/<owner>/<repo>.git`, public fallback `https://github.com/...`), fleet-runs
  `/home/exedev/fleet-runs`, status `/home/exedev/www/status.json` + `engine.log`, boot log
  `/home/exedev/fleet-boot.log`. Engine deps: `npm ci` (or `npm install` without a lockfile) in
  `fleet/` ONLY when `fleet/package.json` declares dependencies.
  - preflight, right after the assignment is parsed and before any clone: ONE read of Reflection
    `/integrations`; every github integration's repository is read out of its `help` string
    (`github.int.exe.xyz/<owner>/<repo>.git`), and a repository named by two integrations is `failed`
    with the duplicates in `error` — the edge routes by repo path and documents no tie-break between
    them. Nothing reads `/integrations` again.
  - status server: `systemd-run --user --unit=fleet-status -p Restart=on-failure -- busybox httpd -f -p 8000 -h /home/exedev/www`
    (skip when the unit is already active). exe.dev proxies port 8000 at `https://<vm>.exe.xyz/`.
  - engine: `systemd-run --user --unit=fleet-engine-<N> --pipe --wait --collect -p MemoryMax=40G -p MemorySwapMax=0 --
    env -u CLAUDE_CONFIG_DIR ANTHROPIC_BASE_URL=https://claude-max.int.exe.xyz CLAUDE_CODE_OAUTH_TOKEN=placeholder
    ULTRAPOWERS_FLEET_RUN=run-N node <engine>/fleet/run-main.mjs /home/exedev/fleet-runs/plans/run-N.md run-N --repo /home/exedev/target [--tier …] [--overlap …]`,
    cwd `/home/exedev/target`, stdout+stderr teed to `/home/exedev/www/engine.log`; the exit code is the
    service's (`--wait`). `claude auth status` must show `oauth_token` — logged before the engine starts.
    No `--scope`, no `KillMode=process`, no re-exec, no self-hash.
  - after the engine: exit 1 WITH a gate receipt is a verdict (parked), not a failure. `ahead = git rev-list
    --count <base>..ultra/integration-run-N`; `ahead == 0` → state `parked`, evidence committed, NO push,
    NO PR. Otherwise `publishing` (written only after `systemctl --user is-active
    fleet-engine-<N>.service` is inactive; receipts committed BEFORE the push) → `git push origin
    ultra/integration-run-N` → one REST call, never `gh`: `curl -sS -X POST
    https://github.int.exe.xyz/api/v3/repos/<owner>/<repo>/pulls -H 'content-type: application/json'
    -d <json>` with `title` (`fleet run-N: <plan h1>`), `head` = `ultra/integration-run-N`, `base` = the
    target's default branch read from the clone (`git symbolic-ref refs/remotes/origin/HEAD`; unreadable
    is `failed`, never a guess), `body` = the rendered card, `draft` = true unless the verdict is PASS.
    `.html_url` is recorded as `pr` and `.user.login` as `prAuthor`, both logged; a non-2xx answer is
    `failed` with the body quoted → `done` (PASS) or `parked`. `gh auth status` and `gh api user` are
    meaningless through the edge — the aggregate host proxies `/repos/<owner>/<repo>/…` only, and
    `/user` answers 403 from the edge itself — so nothing asks them; `gh` stays on the golden, unused
    by a run.
  - re-entry is idempotent: a page already `done`/`parked`/`failed` with the engine marker present exits 0;
    a recorded `pr` is never opened twice; clones present are not re-cloned; `runs/<N>/` is never checked
    out over. A failure at ANY step commits and pushes a `failed` page before exiting (pre-clone included).
- **status.json:** `{"run":"<N>","state":"booting|running|publishing|done|parked|failed","phase":"<text>","pr":"<url or null>","prAuthor":"<GitHub login or null>","branch":"ultra/integration-run-<N>","vm":"<vm_name>","startedAt":"<iso>","updatedAt":"<iso>","error":"<string or null>"}`
  — the SAME bytes are served at `/status.json` and committed to `fleet-runs/runs/<N>/status.json` at every
  transition (plus `receipt.json`, `gate-receipt.json`, `report.json`, `events.jsonl`, `engine.log`).
  Append-only paths; `pull --rebase` and retry on non-fast-forward.
- **Publish:** the sandbox's own act, at the end of the boot script above — there is no grant tool and no
  operator step between the gate and the PR. The human gate is the PR: ready on PASS, a draft
  otherwise; the operator merges or closes it. Between the push and the POST the script polls
  `GET /repos/<owner>/<repo>/branches/<branch>` every 2 s until it reports the pushed head (at most
  `PUBLISH_BRANCH_WAIT` s, default 60), because a PR opened before GitHub has indexed its branch gets no
  `pull_request` CI run (#595); on timeout the PR is opened anyway and the log says so. NO GitHub
  integration is attached to `tag:fleet` except `fleet-runs`.
- **Integration naming:** ONE GitHub integration per target, `gh-<owner>-<repo>` (slashes → `-`),
  `--act-as-user`, not readonly, created attached to nothing by `node fleet/target.mjs <owner>/<repo>`;
  the launcher attaches it per VM `--for 6h`. Never two GitHub integrations naming one repo on a VM —
  the sandbox refuses to boot into that (preflight above). `fleet/doctor.mjs`'s integrations row:
  `claude-max` exists and is on no tag; no GitHub integration but `fleet-runs` is on `tag:fleet`; with
  `--target`, `gh-<owner>-<repo>` exists.
- **Facts (measured 2026-09-03, Shelley's rig + our probes):** (1) exe.dev's GitHub edge routes each
  request BY REPO PATH and serves a cached installation token for ~30–60 s after an integration is
  edited or attached — a `gh pr create` 20 s after `attach` produced a bot-authored PR, which is why
  the run's integration is attached at launch and never swapped in at publish time; (2) two GitHub
  integrations naming the same repo attached to one VM have no documented tie-break — the retired
  `-ro`/`-rw` pair was exactly that; (3) the aggregate host proxies only `/repos/OWNER/REPO/...`
  (`/user` → edge 403), so `gh auth status`/`gh api user` can never work through it and are not
  health checks.
- **Logs without an env var:** `ssh <ssh_dest> 'journalctl _SYSTEMD_USER_UNIT=fleet-run@<N>.service --no-pager -n 200'`
  reads the run unit's journal by field match, so it needs no `XDG_RUNTIME_DIR` and no `--user`.
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
- Amendment 10: models never run git; every git command and every GitHub call is a script's.
- No secret on any VM. `--for` on every attachment.
- Scripts pass `bash -n`; tests: pytest under `tests/`, node `.mjs` under `fleet/tests/` (sentinel `ALL
  TESTS PASSED`, <120 s, no network, stub `curl`/`git`/`gh`/`ssh`/`systemd-run`/`systemctl` via a PATH shim).
  Test behaviour, not sentences; no test pins a sentence of a document.
- Prefer deleting to adapting. A file named for what it does.
