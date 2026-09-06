# The fleet contract (v3, 2026-09-04 — the target owns the record). Every builder reads this first.

Design record: `docs/superpowers/specs/2026-09-03-fleet-on-the-grain.md`, whose `## Counsel 2` section
(Sol + Opus on the papercuts of runs 65–69) is the authority for the sandbox internals below, and
issues #597/#598 for the shape of a launch. Where v2 of this file (git history) and this text
disagree, this text wins. The engine (`run-main.mjs`, `run-engine.mjs`, `run-worker.mjs`,
`run-waves.mjs`, `confine-hook.mjs`, `fitness.mjs`, `roles/`) is untouched.

## The shape in one paragraph
A run is a number N per target. The launcher validates its arguments, reads the account pool from
`billing plan --json`, computes N from the target's own `ultra/*-run-*` branches and its
`ultra/{plan,evidence}/run-<N>` tags, refreshes the Claude
bearer, and pushes the plan as ONE commit on `base=` to `ultra/plan-run-N` (that commit's tree is base
plus `.ultrapowers/plan.md`, plus `.ultrapowers/gate-verdicts.json` when the plan has one). Then it
issues ONE lobby verb — `new` — which creates a fresh VM and runs the generated setup script on it.
The setup script installs the toolchain, an immutable bootstrap and the run's unit, then starts
`fleet-run@<N>.service`. The bootstrap reads the assignment from the VM comment once, clones the
engine at `engine=` into a content-addressed directory, and execs that checkout's
`fleet/sandbox-boot.sh`. The boot script clones the target at `base=`, runs the engine as a transient
user service with a memory cap, serves a status page, commits its evidence to the TARGET repository on
`ultra/evidence-run-N` at every transition, and — only when there is something to publish — pushes
`ultra/integration-run-N` and opens the PR over GitHub's REST API through the edge. The PR is the human
gate: the target's one integration rides the VM for the run's whole life, and there is no grant step.
There is no image to keep fresh, no state repository, no orchestrator, no control VM, and no token on
any VM. The branches are the working surface and go at publish; what a run leaves on the repository it
was about is two tags, `ultra/plan/run-<N>` and `ultra/evidence/run-<N>`.

## Literals
- **Run id:** `N` = 1 + max N over the target's `ultra/{plan,integration,evidence}-run-<N>` branches
  and over its `ultra/{plan,evidence}/run-<N>` tags — the branches are transient and the tags are the
  record, so a run number is read from both shapes and never from one (`--run N` overrides).
  `RUN_ID=run-N`.
- **VM name:** `fleet-r<N>-<yymmddHHMM>-<4 hex>` (e.g. `fleet-r70-2609032215-a1b2`). exe.dev reserves deleted
  names forever, so a name is one incarnation and is never derived from N alone. Lookup by pattern:
  `ssh exe.dev "ls 'fleet-r<N>-*' --json"`; the whole fleet: `ls 'fleet-r*' --json`. Read `.vms[]` ONLY
  (`.shared_vms` are other people's). Contractual row fields: `vm_name`, `ssh_dest`, `ssh_host`, `status`.
  `comment`, `tags`, `created_at` are undocumented: read them as optional, never crash on their absence,
  never decide from `created_at`. Use `ssh_dest` for ssh/scp, never `<vm_name>.exe.xyz`.
- **The three branches on the target** — where a run works, not what it leaves; each one is deleted
  when the thing it carried has landed (nothing else the fleet writes lives anywhere else):
  - `ultra/plan-run-<N>` — one commit on `base=`; tree = base + `.ultrapowers/plan.md`
    [+ `.ultrapowers/gate-verdicts.json`]. Written by the launcher, before any VM exists.
  - `ultra/evidence-run-<N>` — the run's record under `.ultrapowers/runs/<N>/`: `status.json`,
    `receipt.json`, `gate-receipt.json`, `report.json`, `events.jsonl`, `engine.log`,
    `claude-version.txt` (the boot's `claude --version` line, written before the engine starts), plus
    `approve-receipt.json` and `standing-approval.json`, present when the engine wrote them.
    `transcripts/<sessionId>.jsonl` — one per worker session, the reduced record ultralearn's
    readers slice — is there on the same terms, present when the engine wrote them.
    Committed from a detached worktree at every transition; append-only paths, `pull --rebase` and
    retry on non-fast-forward.
  - `ultra/integration-run-<N>` — the work. Pushed only when it is ahead of `base=`; the PR's head.
    It goes with the merge (delete-on-merge); a `hold=1` run's stays while its PR is open.
- **The two tags** — a run's record, and the only refs that outlive it. At publish the sandbox tags
  the plan commit `ultra/plan/run-<N>` and the final evidence commit `ultra/evidence/run-<N>`, and the
  branches `ultra/plan-run-<N>` and `ultra/evidence-run-<N>` are deleted in the same step, after both
  tags are verified against the remote with `git ls-remote --tags`. A tag that does not verify keeps
  both branches; a run that ends `failed` keeps them for the one-time sweep
  (`node fleet/retire.mjs --target <owner>/<repo>`, for the runs already on a target). The record is
  read by tag: `.ultrapowers/runs/<N>/status.json?ref=ultra/evidence/run-<N>` and
  `.ultrapowers/plan.md?ref=ultra/plan/run-<N>`.
- **Comment** (≤200 bytes, one line, space-separated `key=value`, this order, nothing else):
  `run=<N> plan=<40-hex> target=<owner>/<repo> base=<40-hex> engine=<40-hex>` then
  optional `overlap=fold|serialize`, `tier=standard|mostCapable`, `effort=low|medium|high`, `hold=1`.
  `plan=` is the tip of `ultra/plan-run-<N>` on the target; `hold=1` keeps the pull request open for a
  person — the sandbox publishes it and does not merge it. Written once by `new --comment`; the sandbox
  reads it ONCE from `https://reflection.int.exe.xyz/comment` (`{"comment": "..."}`) and fails the run
  if it is absent or malformed. Nobody rewrites it.
- **Launch order (launcher):** validate `--target`/`--base`/plan → read the pool
  (`ssh exe.dev "billing plan --json"`) and refuse a run larger than it → run the janitor
  (`fleet/janitor.mjs`, the reap) → `git ls-remote` the target's
  `ultra/*-run-*` branches and `ultra/{plan,evidence}/run-*` tags for N → refuse when `integrations list --json` has no `gh-<owner>-<repo>` (the fix
  named is `node fleet/target.mjs <owner>/<repo>`; a public target would still clone from github.com
  but could not push or open its PR, so it is not launched) → `node fleet/claude-token.mjs refresh` →
  push `ultra/plan-run-N` → ONE verb:

  ```
  ssh exe.dev "new --name fleet-r<N>-<yymmddHHMM>-<4 hex> --tag fleet --comment '<assignment>' \
    --integration claude-max,gh-<owner>-<repo> --cpu <cpu> --memory <memory> \
    --setup-script /dev/stdin --json"
  ```

  with the generated setup script on the verb's stdin. `--integration` carries the run's two
  credentials at creation, so nothing is attached afterwards and the boot never races an attachment.
  There is no separate `attach`, no ssh-readiness wait and no explicit start: the setup script starts
  the unit as its last act.
- **Setup script (generated by `fleet/setup-script.mjs`, ≤10 KiB, bash, `set -euo pipefail`):** exe.dev
  runs it ONCE, as `exedev`, on first boot. It contains no secret and no `ANTHROPIC` string. Its duties,
  in order:
  1. write `/home/exedev/www/status.json` with `state: "booting"` and serve it (`busybox httpd -f -p 8000
     -h /home/exedev/www` under `systemd-run --user --unit=fleet-status`), so a launch is readable
     before the engine exists;
  2. install the toolchain: node 24.20.0, bun 1.4.0, and `python3-pytest` + `python3-pytest-xdist`
     from apt;
  3. install the bootstrap at `/usr/local/lib/fleet/bootstrap.sh`, mode 0555, owned by root — outside
     `/home/exedev` and unwritable by the run;
  4. install the user unit TEMPLATE `~/.config/systemd/user/fleet-run@.service`
     (`Description=ultrapowers run %i`, `After=network-online.target`, `Type=exec`,
     `RemainAfterExit=yes`, `RuntimeMaxSec=6h`, `ExecStart=/usr/local/lib/fleet/bootstrap.sh %i`, no
     `[Install]`, no `KillMode`, no `Restart`);
  5. write `~/.claude/settings.json`, exactly
     `{"env":{"CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS":"0"},"permissions":{"defaultMode":"bypassPermissions"}}`,
     and a git identity for `exedev` (`user.name fleet`, `user.email fleet@exe.dev`). No `ANTHROPIC_*`
     anywhere in the script: the proxy variables are the engine service's argv (boot script, below),
     and the bearer itself never leaves the edge;
  6. wait for the user bus (`${FLEET_USER_BUS:-/run/user/$(id -u)/bus}`, at most 60 s) to appear
     before any `systemctl --user` call — the image lingers `exedev` by a marker file, so the script
     never calls `loginctl`;
  7. `systemctl --user daemon-reload`, then `systemctl --user start fleet-run@<N>.service`.

  `<N>` is baked into the script the launcher generates, so the script passes `bash -n` for every run
  number. Why a template of `Type=exec` and not a oneshot (Counsel 3, measured on exeuntu, systemd 255):
  a oneshot has `TimeoutStartUSec=infinity`, ignores `RuntimeMaxSec=`, and finished reads
  `inactive/dead` — indistinguishable from never started.
  `systemctl --user show fleet-run@<N>.service -p ActiveState -p SubState -p Result -p ExecMainStatus`
  reads: `active/exited` + `success` = done; `failed` + `ExecMainStatus=N` = crashed with exit N;
  `failed` + `Result=timeout` = over the 6 h budget; `inactive/dead` = never launched.
- **Bootstrap (`fleet/fleet-bootstrap.sh`, installed as `/usr/local/lib/fleet/bootstrap.sh`, ≤40 lines,
  bash, `set -euo pipefail`):** read the comment once → when `$1` (the unit's `%i`) is given, it and the
  comment's `run=` agree or the run fails → parse `engine=` (40 hex or fail) →
  `dst=/home/exedev/engines/<sha>`; if absent, clone `https://github.com/popmechanic/ultrapowers.git`
  to `$dst.tmp`, `git checkout -q <sha>`, `mv` → `exec "$dst/fleet/sandbox-boot.sh" boot` with
  `FLEET_ASSIGNMENT='<comment>'` in its env. It never writes anywhere but `/home/exedev/engines/` and
  `/home/exedev/fleet-boot.log`. It is never overwritten by a run. The assignment comes from
  Reflection, never from `$1`.
- **Boot script (`fleet/sandbox-boot.sh`), invoked by the bootstrap:** takes the assignment from
  `FLEET_ASSIGNMENT` (one Reflection read as fallback; no polling loop). Paths: engine
  `/home/exedev/engines/<sha>` (`ENGINE_REPO_DIR`), target `/home/exedev/target` (clone at `base=`
  through `https://github.int.exe.xyz/<owner>/<repo>.git`, public fallback `https://github.com/...`),
  evidence worktree `/home/exedev/evidence`, status `/home/exedev/www/status.json` + `engine.log`, boot
  log `/home/exedev/fleet-boot.log`. Engine deps: `npm ci` (or `npm install` without a lockfile) in
  `fleet/` ONLY when `fleet/package.json` declares dependencies.
  - preflight, right after the assignment is parsed and before any clone: ONE read of Reflection
    `/integrations`; every github integration's repository is read out of its `help` string
    (`github.int.exe.xyz/<owner>/<repo>.git`), and a repository named by two integrations is `failed`
    with the duplicates in `error` — the edge routes by repo path and documents no tie-break between
    them. Nothing reads `/integrations` again.
  - the plan: `git fetch origin ultra/plan-run-<N>` in the target clone, and its tip must equal the
    assignment's `plan=` or the run is `failed` — the plan a run executes is the plan the launcher
    signed. `.ultrapowers/plan.md` is read out of that commit into `/home/exedev/plans/run-N.md`,
    which is the path the engine's argv carries.
  - status server: `systemd-run --user --unit=fleet-status -p Restart=on-failure -- busybox httpd -f -p 8000 -h /home/exedev/www`
    (skip when the unit is already active). exe.dev proxies port 8000 at `https://<vm>.exe.xyz/`.
  - engine: `systemd-run --user --unit=fleet-engine-<N> --pipe --wait --collect -p MemoryMax=40G -p MemorySwapMax=0 --
    env -u CLAUDE_CONFIG_DIR ANTHROPIC_BASE_URL=https://claude-max.int.exe.xyz CLAUDE_CODE_OAUTH_TOKEN=placeholder
    ULTRAPOWERS_FLEET_RUN=run-N node <engine>/fleet/run-main.mjs /home/exedev/plans/run-N.md run-N --repo /home/exedev/target [--tier …] [--overlap …]`,
    cwd `/home/exedev/target`, stdout+stderr teed to `/home/exedev/www/engine.log`; the exit code is the
    service's (`--wait`). `claude auth status` must show `oauth_token` — logged before the engine starts.
    No `--scope`, no `KillMode=process`, no re-exec, no self-hash.
  - after the engine: exit 1 WITH a gate receipt is a verdict (parked), not a failure. `ahead = git rev-list
    --count <base>..ultra/integration-run-N`; `ahead == 0` → state `parked`, evidence committed, NO push,
    NO PR. Otherwise `publishing` (written only after `systemctl --user is-active
    fleet-engine-<N>.service` is inactive; evidence committed BEFORE the push) → `git push origin
    ultra/integration-run-N` → one REST call, never `gh`: `curl -sS -X POST
    https://github.int.exe.xyz/api/v3/repos/<owner>/<repo>/pulls -H 'content-type: application/json'
    -d <json>` with `title` (`fleet run-N: <plan h1>`), `head` = `ultra/integration-run-N`, `base` = the
    target's default branch read from the clone (`git symbolic-ref refs/remotes/origin/HEAD`; unreadable
    is `failed`, never a guess), `body` = the rendered card,
    `draft` = true unless the verdict is PASS or `approve-receipt.json` is present beside the gate
    receipt (the two-move rule already approved this run).
    The body links the plan blob (`blob/ultra/plan/run-<N>/.ultrapowers/plan.md`) and the
    evidence tree (`tree/ultra/evidence/run-<N>/.ultrapowers/runs/<N>/`), so the PR is the whole
    index of the run.
    `.html_url` is recorded as `pr` and `.user.login` as `prAuthor`, both logged; a non-2xx answer is
    `failed` with the body quoted → `done` (PASS) or `parked`. `gh auth status` and `gh api user` are
    meaningless through the edge — the aggregate host proxies `/repos/<owner>/<repo>/…` only, and
    `/user` answers 403 from the edge itself — so nothing asks them.
  - re-entry is idempotent: a page already `done`/`parked`/`failed` with the engine marker present exits 0;
    a recorded `pr` is never opened twice; clones present are not re-cloned; `.ultrapowers/runs/<N>/` is
    never checked out over. A failure at ANY step commits and pushes a `failed` page before exiting
    (pre-clone included).
  - merge: after a gate-green publish the script polls `GET /repos/<owner>/<repo>/commits/<head>/check-runs`
    every 2 s and, when every listed run is completed with `success`, `neutral` or `skipped`, issues one
    `PUT /repos/<owner>/<repo>/pulls/<n>/merge` (`merge_method` squash, `commit_title` the plan's H1, `sha`
    the head) and records the answer's `sha` as `merged`; an answer with no runs waits
    `MERGE_CHECKS_GRACE` (120 s) and is then merged as having nothing to wait for; a failed run, 30
    minutes (`MERGE_CHECK_WAIT`) of pending, or a refused PUT leaves the PR open with `merged` null;
    `hold=1` in the assignment skips all of it.
  - record: after the last evidence push of a `done` or `parked` run, tag the plan commit `ultra/plan/run-<N>` and the evidence head `ultra/evidence/run-<N>`, verify both with `git ls-remote --tags` against the remote, then delete the branches `ultra/plan-run-<N>` and `ultra/evidence-run-<N>` in the same step.
    A run that ends `failed` keeps its branches for the sweep, and a tag that does not verify keeps
    both branches and logs `record: … kept` — the record step never leaves a run with neither a tag
    nor a branch.
- **status.json:** `{"run":"<N>","state":"booting|running|publishing|done|parked|failed","phase":"<text>","pr":"<url or null>","prAuthor":"<GitHub login or null>","merged":"<40-hex or null>","branch":"ultra/integration-run-<N>","vm":"<vm_name>","startedAt":"<iso>","updatedAt":"<iso>","error":"<string or null>"}`
  — the SAME bytes are served at `/status.json` and committed to
  `.ultrapowers/runs/<N>/status.json` on `ultra/evidence-run-<N>` at every transition.
- **Publish:** the sandbox's own act, at the end of the boot script above — there is no grant tool and no
  operator step between the gate and the PR.
  The PR is ready on PASS or on the two-move rule's approval, a draft otherwise; a ready PR the
  sandbox merges itself once its checks are green, unless the assignment carries `hold=1`, and a
  draft is the operator's to merge or close. Between the push and the POST the script polls
  `GET /repos/<owner>/<repo>/branches/<branch>` every 2 s until it reports the pushed head (at most
  `PUBLISH_BRANCH_WAIT` s, default 60), because a PR opened before GitHub has indexed its branch gets no
  `pull_request` CI run (#595); on timeout the PR is opened anyway and the log says so. NO GitHub
  integration is attached to `tag:fleet`, ever.
- **Integration naming:** ONE GitHub integration per target, `gh-<owner>-<repo>` (slashes → `-`),
  `--act-as-user`, not readonly, created attached to nothing by `node fleet/target.mjs <owner>/<repo>`;
  `new --integration claude-max,gh-<owner>-<repo>` binds both to the run's VM at creation. Never two
  GitHub integrations naming one repo on a VM — the sandbox refuses to boot into that (preflight above).
- **Doctor (`fleet/doctor.mjs`) — five rows, this order, `ROW_IDS`:**
  | id | what it reads | green when |
  |---|---|---|
  | `exe-dev` | `ssh exe.dev whoami` | the alias answers with a username |
  | `capacity` | `ssh exe.dev "billing plan --json"` against `~/.ultrapowers/fleet.json` | both are read and reported: the account's pool, and the size one run asks. The row is a report, not an arithmetic — allocation is over-committable, so it divides nothing and refuses nothing |
  | `claude` | `integrations list --json` + `node fleet/claude-token.mjs status` | `claude-max` exists, carries a bearer, and rides no tag; the keychain's refresh token is a warning, not a failure |
  | `github` | `ssh exe.dev "integrations setup github --list"` | at least one GitHub account is linked |
  | `integrations` | `integrations list --json` | no GitHub object rides `tag:fleet`; with `--target <owner>/<repo>`, `gh-<owner>-<repo>` exists and is attached to nothing |

  The doctor imports only `node:`-prefixed specifiers and no other fleet module, and every row id is a
  `## ` heading in `skills/ultrapowers/references/first-run.md`.
- **Janitor (`fleet/janitor.mjs`):** `ls 'fleet-r*' --json` → for each row, parse the VM's `comment` for
  `run=` and `target=` → read `.ultrapowers/runs/<N>/status.json` on that target with `gh api`
  (`gh api repos/<owner>/<repo>/contents/…?ref=…`) → `rm <vm> --json` for a run in
  `done|parked|failed` whose `updatedAt` is older than 1 h. It reads the page at
  the evidence tag `ultra/evidence/run-<N>` first, and at the branch `ultra/evidence-run-<N>`
  only while the run is in flight or its sweep is pending; a run with no page at either ref is aged
  from the plan tag `ultra/plan/run-<N>`'s commit and then the plan branch `ultra/plan-run-<N>`, and
  the ref it read is named in the line it prints. A VM whose run has had
  no status update in 6 h is notified once. No ssh into any VM, no `created_at`, no clone. Run by
  `fleet/launch.mjs` before every launch and by hand after a sleep; nothing schedules it, and the janitor merges nothing — the sandbox merges its own PR.
- **Laptop config `~/.ultrapowers/fleet.json`** — exactly two keys, both optional, an unknown key
  ignored and a missing file meaning the defaults:

  ```json
  {
    "cpu": "8",
    "memory": "16GB"
  }
  ```

  `memory` is `<int>GB` or `<int>G`; a bare number or a fractional `1.5GB` is unreadable.
- **Logs without an env var:** `ssh <ssh_dest> 'journalctl _SYSTEMD_USER_UNIT=fleet-run@<N>.service --no-pager -n 200'`
  reads the run unit's journal by field match, so it needs no `XDG_RUNTIME_DIR` and no `--user`. The
  setup script's own output is `~/fleet-setup.log` on the VM.
- **Lobby errors:** every lobby call captures stdout+stderr; on non-zero exit the tool prints ALL of it
  verbatim (`exe.dev <verb> failed (exit N):\n<output>`) — no envelope is documented.
- **Naming for exe.dev verbs:** every lobby verb, every `git` and every `gh` command runs through the
  module's `exec` seam so tests stub them; every value interpolated into a lobby string passes
  `isSafeTarget`, `isFullSha`, `isRunNumber` or `isVmName` first. Never a `--cmds` lobby key on any VM.
- **Facts (measured 2026-09-03, Shelley's rig + our probes):** (1) exe.dev's GitHub edge routes each
  request BY REPO PATH and serves a cached installation token for ~30–60 s after an integration is
  edited or attached — which is why the run's integration rides the VM from creation and is never
  swapped in at publish time; (2) two GitHub integrations naming the same repo attached to one VM have
  no documented tie-break; (3) the aggregate host proxies only `/repos/OWNER/REPO/...`
  (`/user` → edge 403), so `gh auth status`/`gh api user` can never work through it and are not
  health checks.

## Rules
- Amendment 10: models never run git; every git command and every GitHub call is a script's.
- No secret on any VM and none in any argv. The Claude bearer reaches the edge on stdin only.
- Scripts pass `bash -n`; tests: pytest under `tests/`, node `.mjs` under `fleet/tests/` (sentinel `ALL
  TESTS PASSED`, <120 s, no network, stub `curl`/`git`/`gh`/`ssh`/`systemd-run`/`systemctl` via a PATH shim).
  Test behaviour, not sentences; no test pins a sentence of a document.
- Prefer deleting to adapting. A file named for what it does.
