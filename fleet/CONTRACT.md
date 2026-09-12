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
`ultra/evidence-run-N` at every transition, and — only when there is something to publish — folds the
target's moved tip into the run's branch in a second transient unit, then pushes
`ultra/integration-run-N` and opens the PR over GitHub's REST API through the edge. The PR is the human
gate: the target's one integration rides the VM for the run's whole life, and there is no grant step.
There is no image to keep fresh, no state repository, no orchestrator, no control VM, and no token on
any VM. The branches are the working surface and go at publish; what a run leaves on the repository it
was about is two tags, `ultra/plan/run-<N>` and `ultra/evidence/run-<N>`.

## Literals
- **Run id:** `N` = 1 + max N over the target's `ultra/{plan,integration,evidence}-run-<N>` branches
  and over its `ultra/{plan,evidence}/run-<N>` tags — the branches are transient and the tags are the
  record, so a run number is read from both shapes and never from one (`--run N` overrides).
  A refused plan push re-reads the highest run and retries with the next N, up to three pushes
  in all, so the push and not the read is what reserves N. `RUN_ID=run-N`.
- **VM name:** `fleet-r<N>-<yymmddHHMM>-<4 hex>` (e.g. `fleet-r70-2609032215-a1b2`). exe.dev reserves deleted
  names forever, so a name is one incarnation and is never derived from N alone. Lookup by pattern:
  `ssh exe.dev "ls 'fleet-r<N>-*' --json"`; the whole fleet: `ls 'fleet-r*' --json`. Read `.vms[]` ONLY
  (`.shared_vms` are other people's). Contractual row fields: `vm_name`, `ssh_dest`, `ssh_host`, `status`.
  `comment`, `tags`, `created_at` are undocumented: read them as optional, never crash on their absence,
  never decide from `created_at`. Use `ssh_dest` for ssh/scp, never `<vm_name>.exe.xyz`.
- **The three branches on the target** — where a run works, not what it leaves; each one is deleted
  when the thing it carried has landed (nothing else the fleet writes lives anywhere else):
  - `ultra/plan-run-<N>` — one commit on `base=`; tree = base + `.ultrapowers/plan.md`
    [+ `.ultrapowers/gate-verdicts.json`] + `.ultrapowers/kata.json` (the run's record on the hub —
    `{"url":"https://kata.int.exe.xyz","project":{id,uid,name},"run":{uid,revision},"tasks":{"<id>":{uid,revision}}}`,
    keys in that order, each `revision` the one the launcher's post-link `getIssue` of that issue
    answered; `JSON.stringify(…, null, 2)` plus a trailing newline). Written by the launcher, before
    any VM exists.
  - `ultra/evidence-run-<N>` — the run's record under `.ultrapowers/runs/<N>/`: `status.json`,
    `receipt.json`, `gate-receipt.json`, `report.json`, `events.jsonl`, `engine.log`,
    `claude-version.txt` (the boot's `claude --version` line, written before the engine starts), plus
    `approve-receipt.json` and `standing-approval.json`, present when the engine wrote them.
    The engine's own wave record is two kinds in that `events.jsonl`, one per wave that folded:
    `driver:wave-adopted` `{wave, tasks, headSha}` — the 1-based wave, the ids it merged in plan
    order, the head it left on the integration branch — and `driver:wave-blocked`
    `{wave, tasks, detail}`, the same wave and ids with the `waveMerges` row's own `detail`.
    The driver's own executions are three more kinds, one per command run: `driver:proof-run`
    `{task, cmd, exit, iter}`, `driver:check-run` `{task, cmd, exit, minor, iter}` and
    `driver:exam-run` `{task, cmd, exit, iter, stdout}` — `stdout` is the exam's combined
    stdout+stderr, last 4,000 characters, the same tail the fix prompt reads (#944), so a parked
    task's red is legible from the tag and the hub. The pre-review pass (`iter: 0`) parks a task
    for the plan (`reviewVerdict: plan-defect`, actor `plan`, no fix round) only on the pair: the
    implementer's `plan-defect:` concern names a Proof leg by its `(x)` label AND says it cannot
    pass (`cannot pass|can't pass|unsatisfiable|no output|for any output`, case-insensitive), and
    the exam is red on the pass AND on the one re-run the driver then makes in the same clone
    and environment — a second `driver:exam-run` at `iter: 0` carrying `rerun: true`. A green
    re-run also carries `flaky: true` and is read as green: the exam's red leaves the pass and
    the task proceeds (to review, or to the ordinary repair round if a `Run:`/`Check:` is still
    red). An ordinary red exam with no such concern is never re-run; it buys the one repair round.
    `transcripts/<sessionId>.jsonl` — one per worker session, the reduced record ultralearn's
    readers slice — is there on the same terms, present when the engine wrote them.
    `state-exams/` — a tree of `task-<id>/<stem>-<pass>/` directories, one per exam run, whose
    contents are the exam's own output copied file by file — is there on the same terms, present
    when the exams wrote it.
    `residuals.jsonl` — one JSON object per residual, present when the run had one, and a union
    across transitions — a row an earlier transition recorded stays when a later report no longer
    carries it, and no row is written twice:
    `{run, task, file, line, kind, text, sha}`, `kind` one of `nit`, `unverified`, `deferred`,
    `structural`. It is the same items the PR body lists, on the record rather than in a page a
    merge closes; append-only, and a run that left nothing writes no file.
    `kata.jsonl` — THE HUB'S OWN RECORD of the run, beside the engine's, present when the plan
    commit carried a `.ultrapowers/kata.json`. Two line kinds, one JSON object per line with `kind`
    first and the object's own fields spread after it: `{"kind":"issue", …}` per issue of the run's
    kata project, then `{"kind":"event", …}` per envelope of its event log. Exported at every
    transition to a temporary name and moved into place, so a fetch that fails leaves the last whole
    export exactly as it was — the hub is archived and the run's state outlives it here. The last
    export carries the run issue's own `issue.closed` (the boot's, `sandbox:run-<N>`, `done` or
    `wontfix` as the page ended — #937) beside the task closes the engine made.
    `exams/` is where publish moves the run's reserved exam directories — `tests/exams/<slug>/`
    and `fleet/tests/exams/<slug>/`, under those same paths, byte for byte — off
    `ultra/integration-run-<N>` and onto the record, so the fold's suite still runs them and the
    pull request's diff never carries one.
    The publish fold writes its own `publish-fold/` receipts directory beside them, holding
    `receipt.json` (the fold's record: `{ engineHead, attempts: { "1": { tip, candidate, pushedHead,
    disposition, reason, path, pathsJoined, resolversDispatched, suite, checks, checkRetries } } }`,
    where `checks` is the candidate checks the fold ran before the suite — one
    `{ check, path, result }` per command, and `{ check, exam, path, result }` for an exam a joined
    path's own task named — and `checkRetries` the number of resolvers a red check
    sent back), `engine-head`, `main.patch`, `run.patch`, `frontier/wave-<attempt>/`,
    `frontier/wave-<attempt>-retried/` (the wave a red check re-folded, kept whole),
    `resolver-brief-<i>-<attempt>.txt`, `resolver-brief-<i>-<attempt>-retry.txt` (the re-brief a red
    check earned), `exam-<attempt>-<n>.txt` (one per exam run, `n` from 1 in the order they ran),
    `suite-<attempt>.txt` and `publish-fold-<attempt>.log`.
    Committed from a detached worktree at every transition **and, while the engine runs, on the
    first refresher poll that has seen either `FLEET_COMMIT_EVENTS` new lines in that
    `events.jsonl` (default 10) or `FLEET_COMMIT_SECONDS` seconds (default 120) since the last
    commit** — so the record is never more than ten events or two minutes behind the live page,
    and a poll that saw no new line commits nothing however long it has been; append-only paths,
    `pull --rebase` and retry on non-fast-forward.
  - `ultra/integration-run-<N>` — the work. Pushed only when it is ahead of `base=`; the PR's head.
    It has three fates, decided by the pull request with the highest `number` on that head:
    a merged one goes with the merge (delete-on-merge), a `hold=1` run's stays while its PR is open,
    and the retire sweep deletes one whose pull request is closed and not merged.
- **The two tags** — a run's record, and the only refs that outlive it. At publish the sandbox tags
  the plan commit `ultra/plan/run-<N>` and the final evidence commit `ultra/evidence/run-<N>`, and the
  branches `ultra/plan-run-<N>` and `ultra/evidence-run-<N>` are deleted in the same step, after both
  tags are verified against the remote with `git ls-remote --tags`. A tag that does not verify keeps
  both branches; a run that ends `failed` keeps them for the one-time sweep
  (`node fleet/retire.mjs --target <owner>/<repo>`, for the runs already on a target). The sweep
  reads each pair's `.ultrapowers/runs/<N>/status.json` on the run's evidence branch before it names
  that run's tags or branches: a run whose `state` is not one of `done`, `parked` or `failed`, or
  whose `ultra/integration-run-<N>` still has an open pull request, is a run in flight and prints
  `run <N>: live (<why>) — skipped` instead — the same line under `--dry-run`. And
  the retire sweep also deletes an `ultra/integration-run-<N>` whose PR is closed and not merged,
  saying so on that run's line. The record is
  read by tag: `.ultrapowers/runs/<N>/status.json?ref=ultra/evidence/run-<N>` and
  `.ultrapowers/plan.md?ref=ultra/plan/run-<N>`. The publish fold attributes a `Fleet-Run: <N>`
  frontier commit to its run's tasks only when `ultra/plan/run-<N>` carries the
  `.ultrapowers/gate-verdicts.json` its plan needs to compile — the record is laid beside the plan as
  `<stem>.gate-verdicts.json`, a legacy-grammar plan needs none, and a claims-v1 tag without its
  record compiles to nothing and its commit is a `no plan` line in the contending block.
- **Comment** (≤200 bytes, one line, space-separated `key=value`, this order, nothing else):
  `run=<N> plan=<40-hex> target=<owner>/<repo> base=<40-hex> engine=<40-hex>` then
  optional `overlap=fold|serialize`, `tier=standard|mostCapable`, `effort=low|medium|high`, `hold=1`.
  `plan=` is the tip of `ultra/plan-run-<N>` on the target; `hold=1` keeps the pull request open for a
  person — the sandbox publishes it and does not merge it. Written once by `new --comment`; the sandbox
  reads it ONCE from `https://reflection.int.exe.xyz/comment` (`{"comment": "..."}`) and fails the run
  if it is absent or malformed. Nobody rewrites it.
- **Exam environment:** the four variables a task's exam reads, set by the driver and by nothing
  else. Every `Run:` and `Check:` command and every exam command runs with `ULTRA_BASE` set to the
  base the tree was cut at. The two exam sites and the per-task `Run:`/`Check:` sites also receive
  `ULTRA_TASK` (the task id), `ULTRA_RUN_DIR` (`<target>/.claude/ultrapowers/run-<N>`, the same
  directory as `FLEET_RUN_DIR`) and `ULTRA_EXAM_PASS`, whose values are
  `base`, `0`, `1`, `2` and `integrated`: `base` at the at-BASE probe, `0` at the pre-review pass,
  `1` or `2` at a review round that re-executes. The integrated `Run:` receives `ULTRA_TASK` and
  `ULTRA_EXAM_PASS=integrated` and no `ULTRA_RUN_DIR` — the run directory is the driver's, not the
  fold's; the integrated `Check:` receives only `ULTRA_BASE`; and the suite receives none of the four.
- **Launch order (launcher):** validate `--target`/`--base`/plan — a `--base` that is not an ancestor
  of the target's default branch is refused (the publish fold would have nothing to fold onto), and so
  is a shallow launch clone, whose history cannot answer that question → read the pool
  (`ssh exe.dev "billing plan --json"`) and refuse a run larger than it → run the janitor
  (`fleet/janitor.mjs`, the reap) → `git ls-remote` the target's
  `ultra/*-run-*` branches and `ultra/{plan,evidence}/run-*` tags for N → refuse when `integrations list --json` has no `gh-<owner>-<repo>` (the fix
  named is `node fleet/target.mjs <owner>/<repo>`; a public target would still clone from github.com
  but could not push or open its PR, so it is not launched) → `node fleet/claude-token.mjs refresh` →
  kata: the run filed on the hub, for each push attempt's N and before that attempt's plan commit is
  built — `compile_plan.py <plan> --stamp run-N --base <base>` (the launch's second compiler call; its
  `launch_waves` entries carry each task's `factsheet`), one project `<owner>-<repo>-run-N` (slashes
  in the target become `-`), one run issue (`run-N: <plan H1>`, body the plan's `**Claim:**` line,
  metadata `{run, target, base, closes}` — `closes` the numbers of the `**Closes:**` line, `[]` when
  absent), one issue per task in wave order (`task <id>: <title>`, metadata `{task, wave, factsheet}`,
  a `parent` link to the run), one `blocks` link per `dag_edges` entry created ON the task that
  blocks, then one `getIssue` per task and one for the run, whose revisions are what
  `.ultrapowers/kata.json` records; a refused push that bumps N purges that project (`run number
  taken`) and files again for N+1. The hub is reached from the laptop as `ssh <hub> curl …
  localhost:8000/api/v1/…` — the host is the `KATA_URL` of `~/.ultrapowers/kata-hub.env`, the bearer
  is sourced from `/etc/kata/kata.env` ON the hub and never rides a laptop argv; an absent env file
  is refused before any command (`node fleet/kata-hub.mjs` builds the hub), a `ping` that fails —
  asked right after the `integrations list --json` read — is refused before any push, and a hub call
  that fails after it is a launch failure before any push and before `new` →
  push `ultra/plan-run-N` → ONE verb:

  ```
  ssh exe.dev "new --name fleet-r<N>-<yymmddHHMM>-<4 hex> --tag fleet --comment '<assignment>' \
    --cpu <cpu> --memory <memory> --setup-script /dev/stdin --json"
  ```

  with the generated setup script on the verb's stdin. The verb carries NO `--integration`: exe.dev
  refuses it since 2026-09-11 (`new --integration cannot safely rewrite a singular attachment
  policy; create the VM first, then use integrations policy get/set with the complete expression`),
  and the launcher refuses its own line before issuing it should the flag ever reappear. The run's
  credentials reach the VM by POLICY instead: each integration a run needs — `claude-max`,
  `gh-<owner>-<repo>`, and the rendering one when the laptop config names it — carries the complete
  attachment policy `tag:fleet` (`integrations policy get <name> --json` → `policy.selector`;
  written once with `integrations policy set <name> 'tag:fleet' --permanent --if-revision=<revision>`,
  or at creation with `--policy 'tag:fleet'`), so `--tag fleet` on `new` is the grant, nothing is
  attached afterwards, and nothing is attached per VM at all. exe.dev documents no order between
  that policy taking effect and the setup script starting, so the script waits — bounded, thirty
  reads two seconds apart — until Reflection's `/integrations` lists `claude-max` before it starts
  the unit. Two consequences: `integrations attach`/`detach` are refused by exe.dev the same day and
  appear in no fleet script; and `cp` of a fleet VM copies its tags by default, so a copy inherits
  every credential and the janitor's reap — a forensic copy is taken with tag copying off.
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
  evidence worktree `/home/exedev/evidence`, boot log `/home/exedev/fleet-boot.log`, served
  `/home/exedev/www/status.json` + `events.jsonl` + `engine.log` — where `events.jsonl` is the run's
  own log, copied over on every refresher poll, so the page and the log are the same facts.
  Engine deps: `npm ci` (or `npm install` without a lockfile) in
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
  - kata writes are never the run's failure: a claim, comment, metadata patch or close the hub
    refuses is one `kata:write-failed` event (`what`, `uid`, `detail`) on the record and the run
    goes on (operator, 2026-09-11 — run-111 died green on a close-message length rule); the
    boot's ping is the one hard kata gate, and a sheet whose revision disagrees at dispatch is the
    one fatal read. A `done` close message carries the task title and the merge sha (kata wants
    ≥40 characters).
  - kata: `.ultrapowers/kata.json` is read out of that same commit the same way, into
    `/home/exedev/plans/run-N.kata.json`. A plan commit that carries none is a run that proceeds
    without kata — no kata request is made and the engine is handed no `--kata`. With the file, and
    directly after the evidence worktree is built, one request and only one:
    `curl -fsS --max-time 10 --retry 3 --retry-delay 2 --retry-connrefused
    https://kata.int.exe.xyz/api/v1/ping`. The retry flags are the contract, not a nicety: a single
    try turns one hub hiccup — a restart, a two-second `Restart=on-failure` window — into every
    sandbox of a wave parking at once, and `--retry-connrefused` is what makes a refused connection
    retryable at all. The request carries no bearer of its own; it passes the hub's exe.dev auth
    proxy only because the peer key is injected at the edge, and the Host the daemon sees is the
    hub's own host, which is what kata's `public_origin` check needs. A non-zero curl exit parks the
    run right there, before any engine: state `parked`, phase `kata unreachable`, `error` exactly
    `parked: kata unreachable at https://kata.int.exe.xyz (curl exit <n>)`, evidence committed and
    pushed under the subject `run-<N>: parked — kata unreachable`, both record tags pushed, a
    `run-<N> parked` notify, exit 0 — no engine unit started and no pull request opened.
    With the file, every `collect_evidence` also exports the hub's record to the `kata.jsonl` the
    evidence bullet declares:
    `GET https://kata.int.exe.xyz/api/v1/projects/<project id>/issues?limit=1000`, then
    `GET …/projects/<project id>/events?after_id=<c>&limit=1000` from `after_id=0`, following each
    answer's `next_after_id` until an answer's `events` is empty. The project id is the file's own
    `project.id`; a fetch that fails logs
    `kata: export failed (curl exit <n>) — previous kata.jsonl kept` and changes nothing.
    With the file, the RUN issue — the file's `run.uid` — is closed by the boot, once, at the
    terminal transition and before that transition's export, so the `issue.closed` rides
    `kata.jsonl` on the tag (#937): `POST …/projects/<project id>/issues/<run uid>/actions/close`
    with `Idempotency-Key: run-<N>:run:close` and the body `{actor: "sandbox:run-<N>", reason,
    message, evidence, retry_protocol: "close-v1"}`. A run whose page ends `done` closes `done`
    with `{type: "pr", url}` and, when the sandbox merged, `{type: "commit", sha: <merge sha>}`
    as evidence, the message the plan's H1 and the merge sha (40+ characters — kata refuses a
    shorter `done`); a run whose page ends `parked` or `failed` closes `wontfix` with no evidence
    and the page's `error`. The task issues are the engine's to close; the boot closes only this
    one, and never at the ping park, where the hub was never reached. A close the hub refuses is
    one `kata:write-failed` event (`what` `close`, `uid`, `detail` naming the curl exit) on the
    record, and the run publishes and merges exactly as it would have.
  - status server: `systemd-run --user --unit=fleet-status -p Restart=on-failure -- busybox httpd -f -p 8000 -h /home/exedev/www`
    (skip when the unit is already active). exe.dev proxies port 8000 at `https://<vm>.exe.xyz/`.
  - engine: `systemd-run --user --unit=fleet-engine-<N> --pipe --wait --collect -p MemoryMax=40G -p MemorySwapMax=0 --
    env -u CLAUDE_CONFIG_DIR ANTHROPIC_BASE_URL=https://claude-max.int.exe.xyz CLAUDE_CODE_OAUTH_TOKEN=placeholder
    ULTRAPOWERS_FLEET_RUN=run-N TINYAPP_RENDER_URL=${TINYAPP_RENDER_URL:-} node <engine>/fleet/run-main.mjs /home/exedev/plans/run-N.md run-N --repo /home/exedev/target [--kata /home/exedev/plans/run-N.kata.json] [--tier …] [--overlap …]`,
    cwd `/home/exedev/target`, stdout+stderr teed to `/home/exedev/www/engine.log`; the exit code is the
    service's (`--wait`). The render entry passes the boot's render address through to the engine and
    is empty when the run carries no render integration — a value, never a bearer.
    `claude auth status` must show `oauth_token` — logged before the engine starts.
    Beside it, once, the bearer probe: one `GET https://claude-max.int.exe.xyz/api/oauth/usage`
    through the proxy carrying `-sS`, `--max-time 20` and the header
    `authorization: Bearer placeholder` (the edge replaces that header with the real token, so the
    answer is about the token and not about the script), with the status riding as the answer's last
    line. A 200 logs `bearer probe: alive` and the unit starts. A 401 or 403 whose body is a JSON
    error document (`"type":"error"`) parks the run right there, before any engine, exam or
    implementer has spent a token: state `parked`, phase `credential`, `error` exactly
    `parked: credential bearer <status> — <the body's error.message>`, evidence committed and pushed,
    both record tags pushed, a `run-<N> parked` notify, exit 0. exe.dev's own plain-text 403 parks
    the same way as `parked: credential edge 403 — integration not found or not attached to this VM
    (trace: <32 hex>)`, the trace id verbatim — that is the id support resolves. Anything else — curl
    non-zero, or a status outside {200, 401, 403} — logs `bearer probe: inconclusive (…)` and starts
    the unit: a probe never manufactures a park out of a flake, and a credential that really is dead
    is still stopped by the engine's own credential row at its first worker.
    No `--scope`, no `KillMode=process`, no re-exec, no self-hash.
  - publish fold: the target's default branch may have moved while the run worked, so before the PR is
    opened the boot script folds that tip into the run's branch — under state `running` with phase
    `publish fold`, after the engine's unit is inactive and before `publishing`, as its own transient
    unit through the same `systemd-run` prefix as the engine's line above, save that the fold unit
    omits the `TINYAPP_RENDER_URL` entry — the fold renders nothing:
    `systemd-run --user --unit=fleet-fold-<N>-<attempt> --pipe --wait --collect -p MemoryMax=40G
    -p MemorySwapMax=0 -- env -u CLAUDE_CONFIG_DIR ANTHROPIC_BASE_URL=https://claude-max.int.exe.xyz
    CLAUDE_CODE_OAUTH_TOKEN=placeholder ULTRAPOWERS_FLEET_RUN=run-N node
    <engine>/fleet/publish-fold.mjs --repo /home/exedev/target --base <base> --branch
    ultra/integration-run-N --run N --run-dir <run dir> --evidence-dir
    /home/exedev/evidence/.ultrapowers/runs/N --attempt <n>`.
    It folds, runs the suite, and pushes the head with `push_head` — a plain push on attempt 1,
    `--force-with-lease=<branch>:<pushedHead>` on every attempt after it. Its disposition is one of `folded`,
    `nothing to join`, `tip unmoved`, `suite red`, `conflict parked` or `cannot fold`, and its receipt is
    `.ultrapowers/runs/<N>/publish-fold/receipt.json`. The candidate checks it runs before the suite
    are reasons under those words and never a seventh: a joined path that fails its parser is
    `cannot fold` with `reason: <path> does not parse`, and a joined path whose own exam — a `- Test:`
    bullet in the Proof of a task whose Files name that path, on either plan — goes red on the
    candidate is `suite red` with `reason: <exam> red on <path>`, and the whole suite is not run.
    A `hold=1` run still folds — only its merge is skipped — and keeps `left open: hold=1`. Amendment 10 holds inside the fold: the only model it may
    dispatch is the read-only `fleet/roles/resolver.md` role answering through `RESOLVER_SCHEMA`, and
    every git command, ref move and push is the script's.
  - after the engine: exit 1 WITH a gate receipt is a verdict (parked), not a failure. `ahead = git rev-list
    --count <base>..ultra/integration-run-N`; `ahead == 0` → state `parked`, evidence committed, NO push,
    NO PR. That parked page names what failed: `error` is exactly
    `parked: <branch> has no commits ahead of base (verdict <verdict>)`, the whole cell.
    Otherwise the publish fold above runs, and then
    `publishing` (written only after `systemctl --user is-active fleet-engine-<N>.service` and `systemctl --user is-active fleet-fold-<N>-<attempt>.service` are inactive;
    evidence committed BEFORE the push, except a fold-again's push, made under `running`, before its `publishing` commit) → the head is on the remote (`push_head`'s `git push origin
    ultra/integration-run-N`) → one REST call, never `gh`: `curl -sS -X POST
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
  - merge: after a gate-green publish the script merges on ITS OWN EVIDENCE and asks the target for
    no opinion of the head. The publish fold rebased the branch onto the default branch's tip and
    recorded which tip in `publish-fold/receipt.json`, and the gate then greened the target's suite
    on the tree that produced; so the merge's one remaining question is whether that tip is still the
    base's. `git fetch origin <default>` then `git rev-parse refs/remotes/origin/<default>`, compared
    to the receipt's `tip`. EQUAL: one
    `PUT /repos/<owner>/<repo>/pulls/<n>/merge` (`merge_method` squash, `commit_title` the plan's H1, `sha`
    the head, and `commit_message` the run's two trailers on two lines — `Fleet-Run: <N>`
    then `Plan-Tag: ultra/plan/run-<N>`), and the answer's `sha` is recorded as `merged`.
    DIFFERENT: no PUT at all — this run has measured nothing about the tree that merge would make —
    and the PR is left open with `left open: base moved`, one `publish:merge` line whose `left` is
    `base moved` and whose `detail` is `tip <old> → <new>`, and another fold. A comparison that
    cannot be made (an unreadable default branch, a receipt with no `tip`) is not a refusal: the PUT
    goes out. `MERGE_CHECK_WAIT` (30 minutes) is the wait on `GET /pulls/<n>` for a non-null
    `mergeable` before a PUT that follows a fold-again, and names no check run.
    The merge folds again for a moved tip, for as long as the fold stays clean and the clock holds:
    the tip read above, or a 405 whose `message` says the pull request is not mergeable,
    or that the base branch was modified, or that a required status check is expected
    (the match ignores case), means the target moved between the fold and the PUT, so the script writes
    `running "publish fold (attempt <n>)"` (an evidence commit),
    re-folds onto the new tip, pushes with the lease, writes `publishing` (an evidence commit),
    reads the tip again on the new head, polls `GET /pulls/<n>` until `mergeable` is
    non-null and PUTs once more — and answers the next such refusal the same way, for as long as the
    base keeps moving. THE BOUND IS A WALL CLOCK, NOT A COUNT: the first base-moved refusal always earns
    its fold, and each one after it earns another only while fewer than `FOLD_AGAIN_WAIT`
    (`FLEET_FOLD_AGAIN_WAIT`, default 3600 s) seconds have passed since that first one — and a re-fold
    that comes back on the tip it already offered buys no further fold, because a folder that cannot
    reach the base will not reach it on a third try. The end of
    that clock leaves the PR open with
    `left open: merge PUT answered 405 after <N>s of folding again`, where `<N>` is `FOLD_AGAIN_WAIT`;
    a fold that moved nothing has no new head to offer and makes no further PUT, leaving the PR open
    with `left open: merge PUT answered 405 and the fold moved nothing`; and a fold that did not end
    clean leaves the `left open: publish fold — <disposition text>` hold it always did.
    Every PUT is one `publish:merge` line, in order, and the LAST of them is what became of the PR.
    Any other non-2xx keeps the one PUT it made.
    `hold=1` in the assignment skips all of it, and so does a gate receipt whose `suite.unattributed`
    is a non-empty list: the PR is ready, no tip is read, no PUT is issued, the note is
    `left open: suite red, unattributed: <first path>`, the `publish:merge` line's `left` is `held`
    and its `detail` the paths joined by `, `, and the card carries the `## Held` section below.
  - record: after the last evidence push of a `done` or `parked` run, tag the plan commit `ultra/plan/run-<N>` and the evidence head `ultra/evidence/run-<N>`, verify both with `git ls-remote --tags` against the remote, then delete the branches `ultra/plan-run-<N>` and `ultra/evidence-run-<N>` in the same step.
    A run that ends `failed` keeps its branches for the sweep, and a tag that does not verify keeps
    both branches and logs `record: … kept` — the record step never leaves a run with neither a tag
    nor a branch.
- **Kata record (engine):** `run-main.mjs --kata <path>` names the run's kata record
  (`{url, project, run, tasks}`), read as JSON **before the run tree is provisioned** — an unreadable
  or malformed file is `kata-unreadable` and the run never starts. With it the engine is handed a
  client built on `httpTransport({url})` — no `Authorization` header, because the edge injects the
  bearer — and the record itself; without it the engine makes no request at all and behaves exactly
  as it does with no hub.
  Per task, once, at the start of its pipeline and before any worker is dispatched: one `getIssue`
  of the recorded uid. A revision unequal to the recorded one ends the run
  (`kata-revision-mismatch`) — the record and the hub disagree about what this run is, and no retry
  can clear that. The answer's `metadata.factsheet` IS the task from then on: its `files`, its
  `proofTests`, its `guards`, and every exam landing the pipeline uses, read from `landing[p]` and
  never computed again. Then `claim` — on the hub before the implementer and examiner exist.
  Every capture of the graded patch (the exam handoff's re-capture, and each fix round's) patches the
  issue's metadata with `touched_files`, the patch's own paths, under the revision the last answer
  carried; a 412 there ends the run as a mismatch does. The hub is the LIVE view of the run
  (#880 reads it), so the record's lines reach it as they happen: every `driver:*` event the
  engine appends, every `worker:start` and `worker:end` envelope (the `meter` included) and every
  `engine:phase` mark is a comment — the event's JSON line verbatim — posted eagerly on one
  serialized chain, each post started the moment the one before it has answered, never two in
  flight, in append order. A `driver:*` line goes on the task's issue when it names one and on the
  run's issue otherwise; a worker envelope goes on the issue of the task its label's second
  colon-segment names (`impl:1`, `exam:1`, `fix:1:0`, `review:1:1:2`) and on the run's issue when
  that segment names no task the record knows (`integration`, `reconcile:wave1:1`); a phase mark
  goes on the run's issue. `transcript:*`, `engine:log`, `capture:*`, `kata:*` and `run:*` lines
  are never posted. The chain is still drained — every pending comment on the hub — before each
  claim, metadata patch and close and before the engine returns. run-main's own `driver:*` lines
  (`driver:stage`, `driver:auth`, `driver:critic-decision`, `driver:ack-decision`,
  `driver:approved`, `driver:fail`) are comments on the run's issue too, on run-main's own chain,
  drained before run-main returns; the record is read before the first stage the log records, so
  the hub's view starts where the record's does.
  Closes: an adopted task is `done` — `adopted in wave <n> (<verdict>)`, evidence the adopted commit
  and the task's test command, under the idempotency key `<runId>:<task>:close`. A task of a wave the
  barrier blocked is `wontfix` (`wave <n> blocked: <detail>`), and so is any task whose row is not
  `done` and that no wave closed (`<status>: <verdict> — <notes>`); `wontfix` carries no evidence.
  A task of a SKIPPED wave, and any task that produced no row, is left open.
- **status.json:** `{"run":"<N>","state":"booting|running|publishing|done|parked|failed","phase":"<text>","pr":"<url or null>","prAuthor":"<GitHub login or null>","merged":"<40-hex or null>","branch":"ultra/integration-run-<N>","vm":"<vm_name>","startedAt":"<iso>","updatedAt":"<iso>","error":"<string or null>","tasks":{"<id>":{"wave":"<n or null>","state":"queued|examining|implementing|proving|reviewing|fixing|folded|failed","role":"<worker label or null>","lastProof":"{cmd, exit, ts} or null","park":"<detail or null>"}}}`
  — the SAME bytes are served at `/status.json` and committed to
  `.ultrapowers/runs/<N>/status.json` on `ultra/evidence-run-<N>` at every transition **and, while
  the engine runs, on the first refresher poll that has seen either `FLEET_COMMIT_EVENTS` new lines
  in the run's `events.jsonl` (default 10) or `FLEET_COMMIT_SECONDS` seconds (default 120) since the
  last commit**. A poll that saw no new line is a heartbeat (`updatedAt` moves, the page is
  rewritten every poll) and earns no commit.
  `"tasks":` is the LAST cell on the page — a reader answers the FIRST `"state"` in the file, so a
  task's own `folded` must never sit above the run's — and it is a projection of `events.jsonl` and
  nothing else: one key per task id the plan's waves or the log names, each carrying the wave it
  belongs to, one of the eight states above, the label of the worker open for it, its last proof run
  (`driver:proof-run`, `driver:check-run` or `driver:exam-run`) and the detail it was parked with.
  The same projection is printed for any log by
  `bash fleet/sandbox-boot.sh project <events.jsonl> [<args.json>]`, which reads and writes nothing.
  `phase` names the SUB-STEP while the engine runs: the run's last phase event alone when no worker
  is open, and `<phase> · <sub>` — that phase, a space, `·`, a space, and either the label of the
  most recent worker still running or the kind of the last event — otherwise.
  The `state` cell is a sequence, not a set: a run that published reads
  `booting → running → publishing → done`, and a run whose merge PUT answered a base-moved 405 folds
  again — ONE `running → publishing` PAIR PER FOLD, the `running` carrying that fold's own phase
  `publish fold (attempt <n>)`. So a run folded once more reads
  `running → publishing → running → publishing → done`, one folded three times more carries three
  such pairs before its `done`, and the count is whatever `FOLD_AGAIN_WAIT` and the folds allowed —
  never a fixed number. `parked` and `failed` are terminal wherever they are reached.
- **Publish:** the sandbox's own act, at the end of the boot script above — there is no grant tool and no
  operator step between the gate and the PR.
  The card is written for a PERSON, and nothing above its folded record is a hash, a JSON fence, a
  file listing or a reviewer's sentence. The body opens with the plan's `**Summary:**` paragraph
  verbatim, its label stripped — `_No summary was signed with this plan._` when the plan signed
  none; then the answer line, exactly one of `**Merged** <sha>` (the status page's `merged` cell),
  `**Merge-ready**`, `**Held:** <text>` (the merge note less its `left open: ` prefix) or
  `**Parked:** <error>` (the status page's `error` cell); then `> ` and the plan's `**Claim:**`
  sentence with its provenance tag stripped; then one table,
  `| task | claim | exam | probes | mutant | suite |`, one row per task in the plan's order, whose
  cells are read off the plan, `report.json`, `gate-receipt.json` and the status page and are never
  narrated at publish time; then `Residuals: <n> from review` — `Residuals: none` at zero — and, as
  `- ` lines, only the items nobody else will do. Everything the run knows beyond that is folded
  into a `<details><summary>Record</summary>` block: the `## fleet <run> — <outcome>` heading, the
  metadata table, `### Checks`, `## Publish fold`, `## Held`, `### Evidence`, `### Plan` and
  `### Residuals`, in that order.
  The PR is ready on PASS or on the two-move rule's approval, a draft otherwise; the
  sandbox merges its own ready PR once its gate is green and the default branch's tip is the one it
  folded onto — it asks the target for no verdict of its own — unless the assignment carries
  `hold=1` or the gate receipt carries an unattributed red, and a draft is the operator's to merge
  or close. Between the push and the POST the script polls
  `GET /repos/<owner>/<repo>/branches/<branch>` every 2 s until it reports the pushed head (at most
  `PUBLISH_BRANCH_WAIT` s, default 60), because a PR opened before GitHub has indexed its branch gets no
  `pull_request` CI run (#595); on timeout the PR is opened anyway and the log says so. NO GitHub
  integration is attached to `tag:fleet`, ever.
  The publish fold is the run's last edit and the record's first section: the body carries a
  `## Publish fold` section before `### Evidence`, and a fold that ends `suite red`, `conflict parked`
  or `cannot fold` opens the PR held — non-draft on a green verdict, merge skipped,
  `left open: publish fold — <disposition text>`. The fold's record is that section, the
  `publish-fold/` receipts directory and the `driver:publish-fold` event; `status.json` gains no cell
  for it.
  Inside the record, after `### Plan`, comes a `### Residuals` checklist — one `- [ ]` line per
  `deferred:external` ack of the gate receipt and per non-blocking reviewer/critic finding of
  `report.json`, each with its evidence sentence — and no section at all when there is none; the
  record closes after it, so the `Closes #<n>` lines are still the body's last lines. The count
  above the record is every one of those items; the `- ` lines above it are the `deferred:external`
  ones and the notes of a task whose report row carries `actor` `plan`, and no other reviewer or
  critic sentence appears above the record at all. The same items are also rows of `residuals.jsonl` on the run's record,
  written with the evidence and not at publish — the checklist closes with the PR that carries it,
  the rows do not — and the sandbox files no issue for them, against this target or any other.
  The publish record is three event kinds, appended to the run's `events.jsonl` beside the engine's
  own and carrying the same `id`/`ts` stamp: `publish:pr` (`url`, `number`, `draft`) once the POST
  answers 2xx; `publish:hold` (`why`, the phase's text after `left open: ` — `hold=1`, or
  `publish fold — <disposition text>`) for a PR left open without asking; and `publish:merge` per
  merge decision — `sha` alone when the PUT merged, else `sha` null with `left` one of
  `held`, `base moved` or `refused` and `detail` the account (the unattributed paths joined by
  `, `, `tip <old> → <new>`, `merge PUT answered <code>`). The LAST `publish:merge`
  line is what became of the PR.
  A run held on an unattributed red also carries a `## Held` section in the card, after
  `## Publish fold` and before `### Evidence`: the failing block cut from `report.json`'s
  `tests.output`, then `gh pr merge <number> --squash --match-head-commit <head>`, then one line
  `Fix: <first path> went red on the fold of run-<N>`. No other run carries it.
- **Integration naming:** ONE GitHub integration per target, `gh-<owner>-<repo>` (slashes → `-`),
  `--act-as-user`, not readonly, created on the policy `tag:fleet` by `node fleet/target.mjs
  <owner>/<repo>` (`integrations add github … --policy 'tag:fleet'`; an object that already exists
  has its policy read and, when the selector is not `tag:fleet`, replaced under the read's
  revision). `claude-max` and the rendering integration carry the same policy — the renderer is
  named by and present only when `fleet.json` carries `render`. Every one of them reaches a run's VM
  by that policy and by nothing else: no `--integration` on `new`, no `attach`, no per-VM grant.
  Never two GitHub integrations naming one repo on a VM — the sandbox refuses to boot into that
  (preflight above); two targets' objects on one VM name two repos, which the edge routes apart.
  The pre-2026-09-11 rule that **no GitHub object rides** `tag:fleet` was superseded by that
  migration: with `attach` refused there is no per-VM grant left to ride, so every object reaches a
  fleet VM by its own `tag:fleet` policy — including the hub's `kata` **http-proxy**, which is
  created with `--policy 'tag:fleet'` like the rest. What the `- **Publish:**` rule still forbids is
  the *attachment*: no GitHub integration is attached to the tag, because nothing is attached at all.
- **Doctor (`fleet/doctor.mjs`) — nine rows, this order, `ROW_IDS`:**
  | id | what it reads | green when |
  |---|---|---|
  | `exe-dev` | `ssh exe.dev whoami` | the alias answers with a username |
  | `capacity` | `ssh exe.dev "billing plan --json"` against `~/.ultrapowers/fleet.json` | both are read and reported: the account's pool, and the size one run asks. The row is a report, not an arithmetic — allocation is over-committable, so it divides nothing and refuses nothing |
  | `claude` | `integrations list --json` + `node fleet/claude-token.mjs status` | `claude-max` exists and carries a bearer; the keychain's refresh token is a warning, not a failure |
  | `accounts` | `node fleet/claude-token.mjs accounts --json` against `fleet.json`'s `account` | the keychain holds an account; the row names each entry with its expiry, and a config account the keychain does not hold is the red |
  | `github` | `ssh exe.dev "integrations setup github --list"` | at least one GitHub account is linked |
  | `integrations` | `integrations list --json` + `integrations policy get <name> --json` for `claude-max`, `gh-<owner>-<repo>` (with `--target`) and `render.integration` (when configured) | with `--target <owner>/<repo>`, `gh-<owner>-<repo>` exists; every one of those objects' `policy.selector` is `tag:fleet` — the red names the first that is not and the get/set two-step that fixes it |
  | `verb-drift` | `help <verb>` for every verb in `fleet/exe-verbs.json` | the record is readable; a flag that appeared or vanished is a finding in a green row, and only an unreadable record is red |
  | `render` | `integrations list --json` against `fleet.json`'s `render` | `not configured` when the file names none; otherwise `render.integration` is a name in the listing |
  | `kata` | `integrations list --json` + `ssh exe.dev "integrations policy get kata --json"` + `ssh exe.dev "ls kata-hub --json"` | the `kata` http-proxy exists and carries a bearer, its `policy.selector` is exactly `tag:fleet` (the listing's `attachments` are never consulted for this row), and `.vms[]` has a `kata-hub` row; the red says which of the four is absent, and names `node fleet/kata-hub.mjs` — or, for a wrong policy, the get/set two-step |

  The doctor imports only `node:`-prefixed specifiers and no other fleet module, and every row id is a
  `## ` heading in `skills/ultrapowers/references/first-run.md`.
- **Janitor (`fleet/janitor.mjs`):** `ls 'fleet-r*' --json` → for each row, parse the VM's `comment` for
  `run=` and `target=` → ask the hub for the run's state (#938): once per pass, on the first row that
  needs it, `GET /api/v1/projects?limit=1000`, matched on `name` against the run's project
  `<owner>-<repo>-run-<N>` (kata addresses a project by integer `id`; a name in the path is a 400),
  then `GET /api/v1/projects/<id>/issues?limit=1000`, in which the run issue is the one whose
  `metadata.run` is N — `status` `closed` is a finished run, its `closed_reason` (`done`|`wontfix`)
  the state and its `closed_at` the age; `open` is a run in flight, aged from `updated_at` →
  `rm <vm> --json` for a finished run older than 1 h. The hub is reached exactly as the launcher
  reaches it, `fleet/kata-client.mjs`'s `sshTransport`: `ssh <KATA_URL host>` running `curl` against
  `localhost:8000`, the bearer sourced from `/etc/kata/kata.env` ON the hub, the laptop's argv
  carrying the literal `$KATA_AUTH_TOKEN` and never a token; `KATA_URL` is
  `~/.ultrapowers/kata-hub.env`'s, and `fleet/launch.mjs` hands the janitor the client it already
  built. A hub that cannot be read — the env file absent, ssh or curl failing, an answer that is not
  one — darkens the pass at the first error: no further hub request is made, every row from there
  is read from the target's evidence, `.ultrapowers/runs/<N>/status.json` with `gh api`
  (`gh api repos/<owner>/<repo>/contents/…?ref=…`) at the evidence tag `ultra/evidence/run-<N>` first
  and at the branch `ultra/evidence-run-<N>` only when the tag answered no envelope — the page's
  `state` (`done|parked|failed` finished, `booting|running|publishing` in flight) and `updatedAt`
  standing in for the issue's — the result carries `hub: {host, dark}`, and the report opens with one
  `hub <host> unreachable` line. A run the hub is up for but holds no project or run issue for is
  read from the evidence the same way, row by row, without darkening the pass; a run with no record
  anywhere is left alone, and no plan-tag or plan-branch read is issued for it. A VM whose `comment`
  carries the substring `do not reap` is never removed: the guard is decided on the raw comment
  before the assignment is parsed, so nothing is read for that row at all, and it is reported as
  `kept` instead. A VM whose run has had no update in 6 h is notified once, the line naming where
  the age was read (`kata:<project>`, or the evidence ref). A run the record says is in flight is
  cross-checked at its unit (`ssh <ssh_dest> "… systemctl --user show fleet-run@<N>.service …"`, the
  one ssh into a fleet VM); a dead unit is written as the death — the journal and the page as
  `failed`, both `gh api -X PUT` on the evidence branch when it has a page, and, for a row the hub
  answered, one `wontfix` close of the run issue under `Idempotency-Key janitor:run-<N>:death` with a
  message of forty characters or more — and reaped an hour later by the ordinary rule. No
  `created_at`, no clone, no `git`. Run by `fleet/launch.mjs` before every launch and by hand after
  a sleep; nothing schedules it, and the janitor merges nothing — the sandbox merges its own PR.
- **Kata hub (`fleet/kata-hub.mjs`):** ONE persistent VM named `kata-hub`, `--cpu 1 --memory 2GB
  --disk 20GB`, comment `kata hub — persistent service, do not reap`, and NO tag — the janitor's
  `fleet-r*` never lists it, and the comment is the second lock. Its port is pinned by
  `share port kata-hub 8000`. One integration fronts it: `kata`, an `http-proxy --peer` created with
  `--target <https_url> --bearer - --comment 'kata issue daemon on kata-hub' --policy 'tag:fleet'`,
  where `<https_url>` is read off the `kata-hub` row of `ls kata-hub --json` and never guessed from
  the VM name; a wrong policy is repaired with `integrations policy get kata --json` then
  `integrations policy set kata 'tag:fleet' --permanent --if-revision=<revision>`, never an attach.
  A sandbox reaches it at `https://kata.int.exe.xyz` and holds no token — the edge injects the
  bearer, and the `peer-kata` key `--peer` generates is server-side and is never pruned. The laptop
  reaches it as `ssh <ssh_dest>` + `curl` against `localhost:8000`, sourcing the token from
  `/etc/kata/kata.env` on the hub so no bearer ever rides an argv on the laptop. On the hub:
  `/etc/kata/kata.env` (`root:exedev`, 0640, `KATA_AUTH_TOKEN`, `KATA_TRUST_PRIVATE_NETWORK=1`,
  `KATA_HOME=/var/lib/kata`, `PORT=8000`) delivered over ssh after first boot and never in the setup
  script; `fleet/kata.service` at `/etc/systemd/system/kata.service`; `/var/lib/kata` as `KATA_HOME`
  with `config.toml` carrying `[web] public_origin`; the binary from
  `https://github.com/kenn-io/kata/releases/download/v0.17.2/kata_0.17.2_linux_amd64.tar.gz`,
  checked against that release's `SHA256SUMS`; and `/var/lib/kata/.setup-done`, the flag the setup
  script writes last and the laptop polls for. On the laptop: `~/.ultrapowers/kata-hub.env`, mode
  0600, exactly `KATA_URL` and `KATA_TOKEN`, written only after the daemon answers `active`.
- **Laptop config `~/.ultrapowers/fleet.json`** — `cpu`, `memory`, `account` and `render` (an object
  of `integration` and `account`), every one of them optional, an unknown key ignored and a missing
  file meaning the defaults:

  ```json
  {
    "cpu": "8",
    "memory": "16GB",
    "account": "<name>",
    "render": { "integration": "browser-run", "account": "<id>" }
  }
  ```

  `memory` is `<int>GB` or `<int>G`; a bare number or a fractional `1.5GB` is unreadable. `account`
  is the keychain account the `accounts` row expects; `render` names the rendering integration the
  `render` row reads and the account its proxy address carries, and its absence is not a red. A
  `render` lacking either non-empty string — `{"integration":"x"}`, an empty slot, a non-object —
  is read as none by the doctor, the launcher and the setup script alike (`renderOf` in
  `fleet/doctor.mjs`, the one reading): the `render` row says `not configured` and no address is
  rendered. A well-formed pair whose strings do not fit the object-name or account-id shape is
  refused by the launcher before anything runs.
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
  edited — which is why the run's integration reaches the VM by a standing policy from creation and
  is never swapped in at publish time; (2) two GitHub integrations naming the same repo attached to one VM have
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
