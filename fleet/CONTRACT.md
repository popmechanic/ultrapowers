# The fleet contract (v4, 2026-09-29 — the evidence repository owns the record). Every builder reads this first.

Design record: `docs/superpowers/specs/2026-09-03-fleet-on-the-grain.md`, whose `## Counsel 2` section
(Sol + Opus on the papercuts of runs 65–69) is the authority for the sandbox internals below, and
issues #597/#598 for the shape of a launch. Where v2 of this file (git history) and this text
disagree, this text wins; v4 (#1395, the operator's picks and ruling of 2026-09-29) moved the plan
and the record off the target into the operator's evidence repository. This contract is the launcher's and the fleet VM's; the engine itself is
the Flock (`factory/flock/`), the one engine since the factory's retirement (map #1292 rule 8), and
its own literals are not restated here. The wave engine this file described in detail
until 2026-09-21 (cut two) is gone; `fleet/RUNBOOK.md` names the rollback.

## The shape in one paragraph
A run is a number N per target, and its plan and record live in the operator's EVIDENCE REPOSITORY,
never on the target. That repository is the operator's own setting — the key `"evidence"` (value
`<owner>/<repo>`; the operator's is `popmechanic/fleet-evidence`, private) in
`~/.ultrapowers/fleet.json`, overridden per launch by `--evidence-repo <owner>/<repo>` — and is never
derived from the target; a launch with neither is refused, naming the key and `node fleet/doctor.mjs`.
Because the record always goes to the operator's repository, a foreign target (someone else's
repository) and another user's fleet both work: a `facebook/react` run lands in
`runs/facebook-react/<N>/` of the operator's repository. A run's folder is
`runs/<owner>-<repo>/<N>/` (the target's owner and repo): the plan files `plan.md`, `kata.json` and
`gate-verdicts.json`, and every record file — `status.json`, `events.jsonl`, `engine.log`,
`fleet-boot.log`, `fleet-setup.log`, `summary.json`, the engine files and the publish files. The launcher validates its arguments, reads
the account pool from `billing plan --json`, computes N from the evidence repository's
`live/<owner>-<repo>/run-*` branches and `<owner>-<repo>/run-*` tags, refreshes the Claude bearer, and
pushes the plan as ONE parentless commit in the evidence repository — its tree that folder with the
plan files, its message naming the target and the base sha — to `live/<owner>-<repo>/run-<N>`. Then it
issues ONE lobby verb — `new` — which creates a fresh VM and runs the generated setup script on it.
The setup script writes the evidence repository to `$HOME/fleet-evidence-repo`, installs the
toolchain, an immutable bootstrap and the run's unit, then starts `fleet-run@<N>.service`. The
bootstrap reads the assignment from the VM comment once, clones the engine at `engine=` into a
content-addressed directory, and execs that checkout's `factory/boot.sh`. The boot script clones the
target at `base=`, fetches only the live branch of the evidence repository, shallow, runs the engine
as a transient user service with a memory cap, commits the record to the live branch every 60 s and
at each transition — no status page; git is the record — and, only when there is something to publish
and the default branch moved underneath it, catches the run up to the target's tip inline
(`factory/flock/catchup.mjs`) before the PR, then pushes `ultra/integration-run-N` to the target and
opens the PR over GitHub's REST API through the edge. At the end of every run (done, parked and
failed) it cuts one tag `<owner>-<repo>/run-<N>` on the live branch's last commit, verifies it with
`git ls-remote --tags`, and deletes the live branch. A `done` run whose PR merged, not held, and
whose tag verified then asks `https://reaper.int.exe.xyz/reap` once with `{run, target}`, and the hub
removes the calling VM only when the run issue is closed `done` (#1470); the janitor still reaps what
never asks. The PR is the human gate: the target's
integration and the evidence repository's ride the VM for the run's whole life, and there is no
grant step. There is no image to keep fresh, no orchestrator, no control VM, and no token on any VM.
The product repository receives only `ultra/integration-run-<N>`; what a run leaves is one tag in the
evidence repository.

## Literals
- **Run id:** `N` = 1 + max N over the evidence repository's `live/<owner>-<repo>/run-<N>` branches
  and its `<owner>-<repo>/run-<N>` tags (`<owner>-<repo>` the target's) — the branches are transient
  and the tags are the record, so a run number is read from both shapes and never from one.
  A refused plan push re-reads
  the highest run and retries with the next N, up to three pushes in all, so the push and not the
  read is what reserves N. `RUN_ID=run-N`.
- **VM name:** `fleet-r<N>-<yymmddHHMM>-<4 hex>` (e.g. `fleet-r70-2609032215-a1b2`). exe.dev does not reserve
  deleted names, but a name is still one incarnation, never derived from N alone: the run number
  is the identity. Lookup by pattern:
  `ssh exe.dev "ls 'fleet-r<N>-*' --json"`; the whole fleet: `ls 'fleet-r*' --json`. Read `.vms[]` ONLY
  (`.shared_vms` are other people's). Contractual row fields: `vm_name`, `ssh_dest`, `ssh_host`, `status`.
  `comment`, `tags`, `created_at` are undocumented: read them as optional, never crash on their absence,
  never decide from `created_at`. Use `ssh_dest` for ssh/scp, never `<vm_name>.exe.xyz`.
- **The two branches** — where a run works, not what it leaves; each one is deleted when the thing it
  carried has landed (nothing else the fleet writes lives anywhere else):
  - `live/<owner>-<repo>/run-<N>` in the evidence repository — the plan commit, then the record on
    top of it. The plan commit is parentless; its tree is `runs/<owner>-<repo>/<N>/` holding
    `plan.md` [+ `gate-verdicts.json`] + `kata.json` (the run's record on the hub —
    `{"url":"https://kata.int.exe.xyz","project":{id,uid,name},"run":{uid,revision},"tasks":{"<id>":{uid,short_id,revision}}}`,
    keys in that order, each `revision` the one the launcher's post-link `getIssue` of that issue
    answered and each task's `short_id` the one its `createIssue` answered — that is what a worker's
    `KATA_REF=<project>#<short_id>` is built from, so a create answer without one is a refusal and no
    record; `JSON.stringify(…, null, 2)` plus a trailing newline), its message naming the target and
    the base sha. Written by the launcher, before any VM exists.
    On top of it the sandbox commits the run's record into the same folder: `status.json`,
    `events.jsonl` and `engine.log`, committed at every state transition and, while the engine
    runs, on the first tick that finds `events.jsonl` changed since the last commit, at most
    `FLEET_COMMIT_SECONDS` seconds apart (default 60) — so the branch is never far behind the
    live run, and a tick that saw no change commits nothing however long it has been.
    **This bullet described the wave engine's own record here in detail through 2026-09-21** —
    `report.json`'s per-run schema, the `driver:wave-adopted`/`driver:wave-blocked`/
    `driver:finding` event kinds, the seven kinds of receipt, the `FACTS:` block, `frontier/`,
    `state-exams/`, `residuals.jsonl`, `kata.jsonl`'s per-event hub export and the fold-again
    receipts directory — and it left with that engine at cut two; what the current engine writes
    to this branch beyond the three files above is not yet described in this contract.
    **A Flock run adds seven files beside them** (with `summary.json` and the
    publish files), so its record says what went wrong and not only that it did:
    - `board.json` — the board as it stood at the end: every task with its state and owner, and
      the beliefs.
    - `weave-ops.digest.jsonl` — every merge the weave made, one operation per line, with each
      `content` replaced by `content_sha1` and `content_bytes`, so file texts are fingerprints.
    - `snapshots.jsonl` — one row per tested snapshot: its hash, time, the paths changed or
      deleted against base (each changed text with its sha1 and bytes), `from` (the previous
      row's `snap`, or `base` for the first row) and `patch`, a unified diff against `from` that
      `git apply` accepts; applying the rows' patches in order onto base rebuilds each tested
      snapshot, and no file text is copied whole. The patches total at most 524288 bytes; a row
      whose patch did not fit carries `patch: null` and `truncated: true`.
    - `red-checks.json` — every check red at the last tested snapshot: its task, clause, command,
      exit, output tail and the checker's own result when there is one, at most 65536 bytes.
    - `past.json` — the previous run's items the builders were briefed with: `{run, items}`, at
      most 10 items of at most 300 characters each. Written only when the previous run on the
      target did not end `done`. The previous run is the one with the highest
      `<owner>-<repo>/run-<M>` tag below this run's number in the evidence repository; the boot
      extracts its folder into a directory the engine reads (`--past-dir`), and a failed read
      writes no `past.json` and never affects the run.
    - `provenance.json` — the whole account of the run's changed lines: `hunks`, the changed
      lines by task (`path`, `lines`, `task`), and the exceptions only (`contested`, `lost`,
      `ordered`, `foreign`). (The coverage pass that added `unproven` was retired unread, #1442.)
      The PR body's
      `### Provenance` line counts it: a hunk whose `task` joins several with `|` (lines two tasks
      wrote identically) counts each of its tasks once.
    Not kept: the whole snapshots, the raw weave log (whose `content` is the files' full texts) and
    `checks/`. (History: the retired factory engine wrote none of these seven.)
  - `ultra/integration-run-<N>` on the target — the work, and the only ref the product repository
    ever receives. Pushed only when it is ahead of `base=`; the PR's head.
    It has three fates, decided by the pull request with the highest `number` on that head:
    a merged one goes with the merge (delete-on-merge), a `hold=1` run's stays while its PR is open,
    and the retire sweep deletes one whose pull request is closed and not merged.
- **The one tag** — a run's record, and the only ref that outlives it. At the end of every run
  (done, parked and failed) the sandbox cuts one tag `<owner>-<repo>/run-<N>` in the evidence
  repository on the live branch's last commit, verifies it against the remote with
  `git ls-remote --tags`, and only then deletes `live/<owner>-<repo>/run-<N>`; a tag that does not
  verify keeps the branch. The plan commit is an ancestor of that tag, so one tag carries both the
  plan and the record. The record is read by tag:
  `runs/<owner>-<repo>/<N>/status.json?ref=<owner>-<repo>/run-<N>` and
  `runs/<owner>-<repo>/<N>/plan.md?ref=<owner>-<repo>/run-<N>`, and at
  `?ref=live/<owner>-<repo>/run-<N>` while the run is live. No engine reads `gate-verdicts.json`; the
  laptop's authoring census (`skills/ultrawrite/scripts/authoring_census.py --fetch`) reads it off the
  run tag (runs 269–271 were launched without it, 2026-09-29). The evidence repository's `main` holds
  a one-time hand archive under `archive/`; no tool writes to `main`, and runs live only under
  `runs/`, on `live/*` branches and on the run tags. The janitor deletes an
  `ultra/integration-run-<N>` whose pull request is closed and not merged (`--target
  <owner>/<repo>` for a target no fleet VM names).
- **Migration (retired, #1450):** every past target's `ultra/*` runs were copied into the
  evidence repository (12 targets, 369 runs, 0 missing, read 2026-09-30); the one-time tool and the
  launcher's unmigrated-target refusal are gone. The old refs stay on the targets, untouched.
- **Comment** (≤200 bytes, one line, space-separated `key=value`, this order, nothing else):
  `run=<N> plan=<40-hex> target=<owner>/<repo> base=<40-hex> engine=<40-hex>` then
  optional `kind=flock` then optional `hold=1`. The boot always runs the Flock
  (`factory/flock/engine.mjs`): `kind=flock` or no `kind=` boots it, and `kind=factory` (the retired
  engine) fails the run at the assignment; `fleet/launch.mjs` always writes `kind=flock` and refuses `--kind`.
  `plan=` is the plan commit — the tip of `live/<owner>-<repo>/run-<N>` in the evidence repository
  when the launcher pushed it (the comment carries no `evidence=`; the VM learns the repository from
  the setup script); `hold=1` keeps the pull request open for a
  person — the sandbox publishes it and does not merge it. Written once by `new --comment`; the sandbox
  reads it ONCE from `https://reflection.int.exe.xyz/comment` (`{"comment": "..."}`) and fails the run
  if it is absent or malformed. Nobody rewrites it.
- **Proof environment:** one variable, set by the engine and by nothing else. A plan's `Check:`
  lines run at every fold check with `ULTRA_BASE` set to the run's base sha — never the anchor,
  never a candidate's own base — and it rides no other line. A run's proof is the plan's `Run:`
  probes and `Check:` lines only: a task is measured by its `Run:` probes, run in the candidate's
  own clone, and by the plan's `Check:` lines on the folded tree; the Flock selects no other tests
  (probes-only, operator, 2026-09-27) — no file is written for it anywhere on the fleet. A task's `Run:` probes run with the
  engine's own environment and nothing added: no `ULTRA_BASE` (that rides `Check:` lines and
  nothing else), no `ULTRA_TASK`, no `ULTRA_RUN_DIR`, no `ULTRA_EXAM_PASS`. Those three, the
  numbered exam passes, the pre-review pass, the review rounds and `reviewOnStateExams` (#836) were
  the wave engine's and left at cut two (2026-09-21); a probe that wants a base to compare against
  carries a frozen literal (ultrawrite §Proof), and a comparison against BASE is a `Check:`. The
  peer exam role, its files and their
  evidence copy left the engine at cut three (2026-09-22); `--engine d412149a` runs the engine from
  before it.
- **State handshake:** left with the factory at cut three (2026-09-22); nothing reads it. Its
  shape is #812 (4a63b4ef); map #998 dropped it on 2026-09-30, and #1419 (the Flock's beliefs) is
  where a reached state would return.
- **Launch order (launcher):** read the evidence repository (`--evidence-repo`, else `fleet.json`'s
  `"evidence"`) and refuse a launch with neither, naming the key and `node fleet/doctor.mjs` →
  validate `--target`/`--base`/plan — a `--base` that is not an ancestor
  of the target's default branch is refused (the publish fold would have nothing to fold onto), and so
  is a shallow launch clone, whose history cannot answer that question → the `--base` check
  and the parse both run files fetched at `engine=` — `skills/ultrapowers/scripts/plan_check.py` and
  the `plan_parse.py` it imports, the sandbox's own parser (beside its other fact lines,
  `plan_check.py` prints one `SHARED fact:` line per path two or more tasks list — a fact, never a
  refusal),
  at that sha, `git show` from the laptop's plugin checkout, else `gh api` from popmechanic/ultrapowers,
  into a temp directory — and a launch whose two files cannot be fetched is refused before any push;
  the launch line carries `compiler=<sha>` → read every command word of every task's `Run:`
  probes and of the plan's `Check:` lines against `SANDBOX_TOOLCHAIN` in `fleet/toolchain.mjs` (the
  image's tools plus the delta `fleet/setup-script.mjs` installs: node, bun, celld, pytest) and
  refuse a word outside it, one line per word — `launch: task <id>: probe runner '<word>' is not
  in the sandbox toolchain — <line>`, `check` where a task id would be — before anything is
  pushed (#645) → read the pool
  (`ssh exe.dev "billing plan --json"`) and refuse a run larger than it → run the janitor
  (`fleet/janitor.mjs`, the reap) → refuse a plan that is already live on the target (#1036): the
  plan text's git blob sha — the `<plan sha>` of the kata `Idempotency-Key` below — is compared with
  the `runs/<owner>-<repo>/<N>/plan.md` blob on `live/<owner>-<repo>/run-<N>` in the evidence
  repository, for every running `fleet-r*` VM whose comment names this target and whose record
  (hub, else evidence) does not say the run ended; a
  match is a `Refusal` naming `run-<N>`, the VM and `--again`, the one flag that launches it again on
  purpose, and a run whose record says it ended never refuses, however recently → `git ls-remote` the
  evidence repository's `live/<owner>-<repo>/run-*` branches and `<owner>-<repo>/run-*` tags for N
  → refuse when `integrations list --json`
  has no `gh-<owner>-<repo>` for the target or none for the evidence repository (the fix named is
  `node fleet/target.mjs <owner>/<repo>` for whichever is missing; a public target would still clone
  from github.com but could not push or open its PR, so it is not launched) →
  `node fleet/claude-token.mjs refresh` →
  read the account's usage windows (`node fleet/claude-token.mjs usage --json --account <account>
  --no-rotate`) and refuse a reading at or past 95% of either window, naming the account and the
  reset time, before any push (#1114); under the wall, the launch line carries
  `usage: <account> 7d <n>% resets <iso>; 5h <n>% resets <iso>` →
  kata: the run filed on the hub, for each push attempt's N and before that attempt's plan commit is
  built — `plan_parse.py <plan>` (the launch's second call; the old compiler's per-task `factsheet`
  left with it at cut B, 2026-09-21 — nothing in the factory read it), one project `<owner>-<repo>` (slashes in the
  target become `-`) — one project per target and not one per run, so a name the hub already holds
  answers the existing project and this run files into it; every kata behaviour this paragraph
  leans on is one reading of `node fleet/tests/probe_kata_facts.mjs` and one row of this
  contract's `Kata facts (measured)` list — one run issue (`run-N: <plan H1>`, body
  the plan's `**Claim:**` line, metadata `{run, target, base, closes, plan, "work.branch"}` — `closes` the numbers of the
  `**Closes:**` line, `[]` when absent; `plan` the plan text's blob sha; `work.branch`
  `ultra/integration-run-<N>` (#1391) — created with `force_new: true`, because the hub scores a
  title against the project's open issues and a replayed plan's run issue differs from the earlier
  run's only by N; the task creates carry no such field), one issue per task in wave order created under an
  `Idempotency-Key` `<target>:<plan sha>:task-<id>` (`<plan sha>` the plan text's git blob sha) whose
  create body is the same on every launch of that plan text — `task <id>: <title>`, empty body,
  metadata `{task, plan}`, no links, since kata fingerprints the key with those fields — and then
  read back, its metadata patched `{run, wave}` under that read's revision and the run
  issue set as its `parent` with `replace: true`; one `blocks` link per `dag_edges` entry created ON
  the task that blocks, then one `getIssue` per task and one for the run, whose revisions are what
  `kata.json` records; a refused push that bumps N closes the run-N issue with reason
  `wontfix` and files again for N+1, where the same keys answer the same task issues — nothing on the
  hub is destroyed. The hub is reached from the laptop as `ssh <hub> curl …
  localhost:8000/api/v1/…` — the host is the `KATA_URL` of `~/.ultrapowers/kata-hub.env`, the bearer
  is sourced from `/etc/kata/kata.env` ON the hub and never rides a laptop argv; an absent env file
  is refused before any command (`node fleet/kata-hub.mjs` builds the hub), a `ping` that fails —
  asked right after the `integrations list --json` read — is refused before any push, and a hub call
  that fails after it is a launch failure before any push and before `new` →
  push the parentless plan commit to `live/<owner>-<repo>/run-<N>` in the evidence repository → ONE
  verb:

  ```
  ssh exe.dev "new --name fleet-r<N>-<yymmddHHMM>-<4 hex> --tag fleet --comment '<assignment>' \
    --cpu <cpu> --memory <memory> --setup-script /dev/stdin --json"
  ```

  with the generated setup script on the verb's stdin, under a `# fleet: width=<W>`
  header line the
  launcher stamps on it — W is not an assignment key (`COMMENT_KEYS` spells six and
  `parse_assignment` fails the boot on a seventh), so that header is a record only: the old wave
  engine read the same W back off its own compile (`args.json`) as its dispatch bound, falling back
  to 12 when the compile answered no waves, and that reading left with it at cut two (2026-09-21).
  `<cpu>` and `<memory>` are the PLAN's size,
  not the fleet's: the launcher parses the plan once before this verb (`plan_parse.py <plan>`,
  the one payload the sizing and the kata filing both read), takes
  W — the task count of the widest `launch_waves` entry —
  and asks for `min(cpu, 2 + ceil(W / 3))` vCPU and
  `min(memory, 2 + W)GB`, where the `cpu`/`memory` pair of `~/.ultrapowers/fleet.json` (or
  `FLEET_DEFAULTS`) is the CEILING; `--cpu` or `--memory` on the launch line wins outright, and
  either number is refused when `billing plan --json` cannot seat it. The browser term the old
  state exams added to memory left with them (cut three, 2026-09-22; a return is owed on #1248).
  The verb carries NO `--integration`, and the launcher refuses its own line
  before issuing it should the flag ever reappear. The run's credentials reach the VM by TAG instead:
  each integration a run needs — `claude-max`, the target's `gh-<owner>-<repo>` and the evidence
  repository's `gh-<owner>-<repo>` — is attached to `tag:fleet` (at creation with `--attach tag:fleet`,
  or later with `integrations attach <name> tag:fleet`), so `--tag fleet` on `new` is the grant and
  nothing is attached per VM at all. (exe.dev tried an attachment-policy model on 2026-09-11 and
  rolled it back the same afternoon; `integrations` has no `policy` verb, #1434.) exe.dev documents no
  order between the grant taking effect and the setup script starting, so the script waits — bounded,
  thirty reads two seconds apart — until Reflection's `/integrations` lists `claude-max` before it
  starts the unit. And `cp` of a fleet VM copies its tags by default, so a copy inherits every
  credential and the janitor's reap — a forensic copy is taken with tag copying off.
  There is no separate `attach`, no ssh-readiness wait and no explicit start: the setup script starts
  the unit as its last act.
- **Setup script (generated by `fleet/setup-script.mjs`, ≤10 KiB, bash, `set -euo pipefail`):** exe.dev
  runs it ONCE, as `exedev`, on first boot. It contains no secret and no `ANTHROPIC` string. Its duties,
  in order:
  1. wait, bounded, for the user bus (`systemctl --user` has no address before `user@.service` is
     up);
  2. install the toolchain: node 24.20.0, bun 1.4.2 — and no kata: a sandbox runs none, the engine
     writing the hub directly (#1390) —
     celld 0.5.0 (the one `.gz` asset from
     `github.com/denoland/celld`, verified with `sha256sum -c` against the digest the plugin records
     beside bun's version — `CELLD_SHA256` in `fleet/setup-script.mjs`, since the release carries no
     sums file and `gh attestation verify` needs a token the sandbox does not hold — then decompressed
     and installed at `/usr/local/bin/celld` mode 0755, never through the vendor's installer script
     and never under `/usr/local/lib/fleet`), and pytest by the image's `uv pip install --system --break-system-packages`, pinned to
     `pytest==7.4.4` and `pytest-xdist==3.4.0` with their dependencies `pluggy==1.4.0`,
     `packaging==24.0`, `iniconfig==1.1.1` and `execnet==2.0.0` — exactly the versions noble's
     packages shipped; uv is a package manager and queries PyPI, but with all six pinned it
     resolves nothing fresh. The node, bun and celld fetch-and-verify jobs run at once,
     each its own background job waited on by its own pid, so any failure still stops the script;
     each step is preceded by a `stamp` line (UTC to the millisecond, `setup: <step>`) in
     `$HOME/fleet-setup.log`, and a last `stamp done` follows the unit start;
  3. install the bootstrap at `/usr/local/lib/fleet/bootstrap.sh`, mode 0555, owned by root — outside
     `/home/exedev` and unwritable by the run;
  4. install the user unit TEMPLATE `~/.config/systemd/user/fleet-run@.service`
     (`Description=ultrapowers run %i`, `After=network-online.target`, `Type=exec`,
     `RemainAfterExit=yes`, `RuntimeMaxSec=6h`, `LimitNOFILE=524288` — a shell under the unit
     otherwise inherits soft 1024, which is what bites Chromium, bun and pytest, while the image's
     hard limit for a service is 524288 — `ExecStart=/usr/local/lib/fleet/bootstrap.sh %i`,
     `ExecStopPost=/usr/local/lib/fleet/bootstrap.sh %i died`, no `[Install]`, no `KillMode`, no
     `Restart`). The stop-post is how the VM writes its own death (#1445): systemd runs it when the
     unit stops — after a non-zero exit, a kill or the `RuntimeMaxSec` timeout — with
     `SERVICE_RESULT`, `EXIT_CODE` and `EXIT_STATUS` set, and it reaches `boot.sh died` through the
     bootstrap; after a clean exit the unit stays `active (exited)` and the stop-post runs only when
     the VM goes down, where `died` finds a finished record and writes nothing;
  5. write `~/.claude/settings.json`, exactly
     `{"env":{"CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS":"0"},"permissions":{"defaultMode":"bypassPermissions"}}`,
     and a git identity for `exedev` (`user.name fleet`, `user.email fleet@exe.dev`). No `ANTHROPIC_*`
     anywhere in the script: the proxy variables are the engine service's argv (boot script, below),
     and the bearer itself never leaves the edge;
  6. write the evidence repository's `<owner>/<repo>` to `$HOME/fleet-evidence-repo` — the one way
     the VM learns it (the assignment comment carries no `evidence=`);
  7. wait for the user bus (`${FLEET_USER_BUS:-/run/user/$(id -u)/bus}`, at most 60 s) to appear
     before any `systemctl --user` call — the image lingers `exedev` by a marker file, so the script
     never calls `loginctl`;
  8. `systemctl --user daemon-reload`, then `systemctl --user start fleet-run@<N>.service`.

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
  to `$dst.tmp`, `git checkout -q <sha>`, `mv` → `exec "$dst/factory/boot.sh" boot` with
  `FLEET_ASSIGNMENT='<comment>'` in its env. It never writes anywhere but `/home/exedev/engines/` and
  `/home/exedev/fleet-boot.log`. It is never overwritten by a run. The assignment comes from
  Reflection, never from `$1`. An optional `$2` is the mode: absent is `boot`, as above; `died` is
  the unit's `ExecStopPost=`, the VM writing its own death (#1445) — the comment is read as in
  `boot`, an absent `engines/<sha>` logs `died: no engine at <sha> — nothing to write` and exits 0
  (never a clone at stop time), and otherwise it `exec`s `"$dst/factory/boot.sh" died` with
  `FLEET_ASSIGNMENT` set exactly as `boot` does. In `died` mode every refusal that `boot` exits 1 on
  exits 0 after its log line.
- **Boot script (`factory/boot.sh`), invoked by the bootstrap:** reads the evidence repository from
  `$HOME/fleet-evidence-repo` and fails the run without it, clones the target at `base=`, fetches
  only `live/<owner>-<repo>/run-<N>` of the evidence repository, shallow, through the same edge host
  (`https://$GITHUB_INT_HOST/<evidence repo>.git`), extracts the previous run's folder for the
  engine's `--past-dir`, runs the engine as one transient unit, commits the record to the live
  branch every 60 s and at each transition (see above), cuts and verifies the run tag and deletes
  the live branch at the end of every run, and — only when there is something to publish — opens the pull request
  and, gated by `factory/policy.json`'s `publish.self_merge`, merges it. When the target's tip moved
  underneath the run, the boot catches the run up to the new main inline by running
  `node factory/flock/catchup.mjs --plan <plan> --target <target> --base <run base> --onto <moved tip>
  --run-dir <dir>`, whose last stdout line is JSON: `{"refolded": true, "head", "onto"}` (exit 0) or
  `{"refolded": false, "reason": "conflict" | "red", "onto"}` (exit 1). It joins the run's work onto
  the new main through the weave keeper (`factory/flock/weave.py`) and re-runs the plan's setup,
  every task's probes and the run-wide check with `ULTRA_BASE` set to the new main; on exit 0 the
  boot force-pushes the new head over the run's branch, and on a conflict or a red check it leaves
  the run's own commit alone, so the boot opens a draft. The catch-up runs under the same
  environment as the engine unit — the same `env -u CLAUDE_CONFIG_DIR …` prefix, so anything it
  asks reaches the proxy and the edge-injected bearer (run-207, 2026-09-21, n=1 run). The engine
  unit itself:
  - engine: `systemd-run --user --unit=fleet-engine-<N> --pipe --wait --collect -p MemoryMax=40G -p MemorySwapMax=0 -p LimitNOFILE=524288 -p RuntimeMaxSec=<seconds> -p WorkingDirectory=<target>
    -- env -u CLAUDE_CONFIG_DIR ANTHROPIC_BASE_URL=<proxy> CLAUDE_CODE_OAUTH_TOKEN=placeholder
    TYPESAFE_BASE_URL=https://typesafe.int.exe.xyz ULTRAPOWERS_FLEET_RUN=<run id> node
    <engine>/factory/flock/engine.mjs --plan <plan> --target <target> --base <sha> --run-dir <dir>`,
    stdout+stderr teed to `engine.log`.
    cwd `<target>` — the same working directory the unit's own `WorkingDirectory=` sets.
  **This bullet spelled out the wave engine's own boot script here in detail through 2026-09-21** —
  the kata ping and reuse-driven relaunch, the five declared worker roles and their confinement,
  the worker API-layer error classes, the fold-before-publish transient unit and its six
  dispositions, the fold-again wall-clock and the tag-and-branch record step — and all of it left
  with that engine at cut two; what `factory/boot.sh` itself does at this level of detail is not
  yet written down here.
- **Kata record (engine):** When a run carries a kata record, a worker's env names the hub it talks
  to as `KATA_SERVER` (the record's own `url`, or the fallback `https://kata.int.exe.xyz` when it
  names none), the placeholder bearer the edge replaces on the way out as
  `KATA_AUTH_TOKEN=edge-injects-the-bearer` (no real token is ever written to disk or argv), the
  label the run spells its events with as `KATA_AUTHOR=<label>@<run id>`, and — for a label whose
  task the record knows — that task's issue as `KATA_REF=<project>#<short id>`; a label naming no
  task (`integration`, a reconcile worker) carries the first three and no `KATA_REF`. The same
  worker's issue is stamped by two hooks on its session: `kata attention-hook start` and
  `kata attention-hook end`, exiting 0 doing nothing when the worker carries no `KATA_REF`.
- **Kata record (Flock, the `kata:mirror` row):** the Flock mirrors only when the boot passes
  `--kata-url`, `--kata-json` and `--kata-actor` (the boot does exactly when
  `$FLEET_HOME/plans/<run>.kata.json` exists); it posts to the hub at `https://kata.int.exe.xyz`,
  reading the project id from that record. Each board move becomes one comment on its task's issue, posted after the move has
  completed: `claimed by <agent>`, `<agent> released: <why>` (the engine's own release reason,
  e.g. `A released: gave up`), `parked: <why>` (a task parked at its release cap, e.g.
  `parked: A released: gave up`), `reopened: <why>` and `done by <agent>` (a
  release made on the way to a reopen posts only the `reopened:` body). Every attempted post is
  one `kata:mirror` event row in `events.jsonl` naming the task, the body, `key` (the
  `Idempotency-Key` sent), `ok` (true only when the hub answered with a comment uid),
  `comment_uid` and `created_at`; the key is `<run uid>:task:<id>:<n>` (`n` counting that task's
  posts from 1) or `<run uid>:run:<n>` on the run issue, `<run uid>` being the record's `run.uid`. A
  task the record names no issue for posts nothing and its row says it was skipped. Posts are
  fire-and-forget: none is awaited, so a slow, failing or absent Kata never delays or fails the
  run — a failed post is that row and nothing else. One task's posts go out one after another,
  in board order; each gives up after 10 seconds, and at exit the engine gives posts still queued
  or in flight at most 3 seconds, then leaves without them. Before this (radio-station run-1,
  2026-09-28, n=1 run) the Flock posted nothing and the board showed only the launcher's filing
  and the boot's closes.
- **Beliefs (Flock, the `belief` row):** a builder's belief is the tuple
  `{by, claim, confidence, about, task}` — `about` is one of `task`, `app` or `engine` (whom the
  belief is for: the task's builders, the app's operator, or the engine's maintainers), and the
  claim is at most 300 characters. Every belief posted is kept as one `belief` row in
  `events.jsonl`, whatever its confidence or `about`. An `engine` belief whose confidence is at or
  over `flock.surface.min_confidence` (policy, 0.8) is also posted to Kata, while the run is still
  going, as the comment `engine belief (<confidence>) from <builder>: <claim>` on its task's issue,
  or on the run issue when the belief names no task the record knows; it goes out as the mirror's
  posts do (fire-and-forget, a `kata:mirror` row) and shows in `--follow`.
- **Scope (Flock, the `scope:outside` and `driver:amendment` rows, #1333):** the Flock's edge
  refuses to settle on a snapshot that changes a path outside every task's Files when no builder
  wrote that change; each such path is one `scope:outside` row in `events.jsonl` and the snapshot
  does not settle. A builder's own change to a path outside every task's Files is let through and
  recorded as a `driver:amendment` row naming the builder and the path. The switch is
  `flock.scope` in `factory/policy.json` (`mode = enforce`); `flock.scope.mode = record` is the
  rollback — the rows are still written and nothing is refused. Before this (run-247, #1322) a
  green run merged a corrupted file no task listed.
- **Stall (Flock, the `stall:no-progress` row, #1334):** a Flock run whose best-green count has not
  risen for `flock.stall.minutes` (20), with at least one builder session ended since it last rose
  (one long session is never cut off), and whose queued snapshots are all tested, writes one
  `stall:no-progress` row in `events.jsonl` and ends as a draft, alerting, instead of running to its
  clock. The window opens when the builders start, not before setup. The stop interrupts every live
  session, starts no new one, and counts none of them as a give-back. Every stall row is named
  `stall:<kind>`. `--stall-minutes <n>` is an engine flag for a hand run (the launcher and boot do
  not pass it; a fleet run reads the cell), and a value that is not a number of minutes, 0 or more,
  refuses with exit 2. The cell is
  `flock.stall` in `factory/policy.json`; `flock.stall.minutes = 0` is the rollback — no limit, the
  run ends only at its clock. Before this (runs 247, 251–255 and radio-station run-1, 2026-09-26..28,
  n=7) the longest wait for a rise in the green count was 2.0 min, while run-252 ran 229.7 min
  after its last rise.
- **Jev (2026-09-16, the `jev:` seam):** one event kind rides the run's own event log exactly as
  a `driver:` row does — `jev:step` (the step read for a plan clause, one row per clause asked;
  `factory/record.mjs` reads the latest row per clause) — each one a `POST /v1/systemone` against
  the typesafe host, asked only over a reachable TypeSafe edge; a failed call is one log line and
  no row.
    Receipts (2026-09-16): the same POST carries a `state` object out and an `answers` object back;
  neither is persisted anywhere this engine reads again.
- **status.json:** `{"run":"<N>","state":"booting|running|publishing|done|parked|failed","phase":"<text>","pr":"<url or null>","prAuthor":"<GitHub login or null>","merged":"<40-hex or null>","branch":"ultra/integration-run-<N>","vm":"<vm_name>","startedAt":"<iso>","updatedAt":"<iso>","error":"<string or null>","tasks":{"<id>":{"state":"folded|failed","park":"<detail or null>"}}}`
  — committed to
  `runs/<owner>-<repo>/<N>/status.json` on `live/<owner>-<repo>/run-<N>` in the evidence repository
  at every transition **and, while
  the engine runs, on the first tick that finds `events.jsonl` changed since the last commit, at
  most once every `FLEET_COMMIT_SECONDS` seconds (default 60)**. A tick that saw no change is a
  heartbeat (`updatedAt` moves) and earns no commit.
  `"tasks":` is the LAST cell on the page — a reader answers the FIRST `"state"` in the file, so a
  task's own `folded` must never sit above the run's — and it is a projection of `events.jsonl` and
  nothing else: one key per task a `landing` or `parked` row names, in the order it first appears,
  each carrying its `state` — `folded` for a `landing` row, `failed` for a `parked` row, a later row
  for the same task overwriting — and its `park`, the `reason` its `parked` row carried, else `null`.
  The same projection runs inside `factory/record.mjs` (`status`), called by `write_status` each
  time it writes the page, rather than as a separate invocation over a log file.
  `phase` names the SUB-STEP while the engine runs: the run's last phase event alone when no worker
  is open, and `<phase> · <sub>` — that phase, a space, `·`, a space, and either the label of the
  most recent worker still running or the kind of the last event — otherwise. That last event is the
  run's OWN PROGRESS and not the bookkeeping written to the same log: the projection SKIPS the kinds
  that are not progress — `kata:*`, `transcript:*`, `engine:log` and `capture:*`, and `resolver:reply`
  with them — and the kind it takes is the last `driver:*`/`worker:*` one the log has written since
  that phase event, so a phase followed only by bookkeeping reads as that phase alone.
  The `state` cell is a sequence, not a set: a run that published reads
  `booting → running → publishing → done`, and a run whose merge PUT answered a base-moved 405 folds
  again — ONE `running → publishing` PAIR PER FOLD, the `running` carrying that fold's own phase
  `publish fold (attempt <n>)`. So a run folded once more reads
  `running → publishing → running → publishing → done`, one folded three times more carries three
  such pairs before its `done`, and the count is whatever the folds allowed under the refold bound
  `publish.self_merge.max_refolds` in `factory/policy.json` — never a fixed number. `parked` and `failed` are terminal wherever they are reached.
- **Publish:** the pull request is one `POST /repos/<target>/pulls` with title
  `fleet run-<N>: <plan H1>`, head `ultra/integration-run-<N>`, base the target's default branch,
  `draft` true unless the engine exited 0, and no `authorization` header — the edge injects the
  credential. Its body is the plan's `**Summary:**` paragraph, a blank line, the receipt — a
  `### Receipt` table with one `| task | probe | proves | exit |` row per `Run:` line of the plan,
  the exit read from the `edge` row of the last `settled` snapshot (the last `edge` row when
  nothing settled), then `Run-wide checks: exit <n>` and `**Evidence:** <the run tag's folder>` —
  `https://github.com/<evidence repo>/tree/<owner>-<repo>/run-<N>/runs/<owner>-<repo>/<N>` — a blank line, and one `Closes #<n>` line per number on the plan's `**Closes:**`
  line, all rendered by `factory/record.mjs pr-body`. A run with no `edge` row carries only the
  evidence line. The `publish:pr` row it leaves —
  `{ts, kind, url, number, draft}` — is written through the same writer as every other
  end-of-run row (`event_row`, over `factory/record.mjs row`).
- **Publish probe (#835, `run_publish_probe` in `factory/boot.sh`, called from `publish()` once
  `MERGED_SHA` is non-empty, before `write_status`):** the plan's `**Publish:**`/`**Verify:**`/
  `**Rollback:**` header lines are read once through `skills/ultrapowers/scripts/plan_parse.py`
  (never grepped off the plan text) and handed, one per line, to `factory/record.mjs publish-cmds`;
  a plan naming no `**Publish:**` line, or `factory/policy.json`'s `publish.probe.enabled` false
  (read by `factory/record.mjs publish-policy`, which prints `"<0 or 1> <timeout_seconds>"`), leaves
  the run's `phase` at the plain `"the pull request was merged"` and writes no `publish:*` row and
  no `publish.json`. Otherwise:
  1. **Deploy** — `bash -lc "<deploy cmd>"`, cwd `<target>`, under `timeout <publish.probe.
     timeout_seconds>` (policy default 600), env carrying `CLOUDFLARE_API_BASE_URL=https://
     cloudflare.int.exe.xyz/client/v4` and `CLOUDFLARE_API_TOKEN=placeholder`. Its combined
     stdout+stderr is grepped for the first `https://[A-Za-z0-9.-]*.workers.dev` url; a
     `publish:deploy{cmd, exit, ms, url}` row is written (`url` is `null` when none matched). Exit
     non-zero, or no url matched, writes `publish.json` (`url` null, `published` false, `verify`
     null, `rollback` null) and sets `phase` to `"the pull request was merged; the deploy failed"`;
     the verify and rollback steps never run.
  2. **Verify** — the same `bash -lc "<verify cmd>"` shape, plus `ULTRA_PUBLISH_URL=<the deployed
     url>` in its env (the deploy step never gets this var). A `publish:verify{cmd, exit, ms, url}`
     row is written. Exit 0 writes `publish.json` (`published` true, `rollback` null) and sets
     `phase` to `"the pull request was merged and the app is published"`.
  3. **Rollback** — only on a red verify, and only when the plan named a `**Rollback:**` line: the
     same `bash -lc` shape (no extra env), a `publish:rollback{cmd, exit}` row, `publish.json`
     (`published` false, `rollback` the rollback's `{cmd, exit}`) and `phase` set to `"the pull
     request was merged; the live check was red and the deploy was rolled back"`. A red verify with
     no `**Rollback:**` line skips this step and sets `phase` to `"the pull request was merged; the
     live check was red and no rollback was named"` instead, `publish.json`'s `rollback` staying
     `null`. Every case's `publish.json` is rendered whole by `factory/record.mjs publish-json`,
     never hand-built shell JSON.
  Every step's raw combined stdout+stderr is truncated to its last 4000 bytes and written beside
  `publish.json` in the evidence directory as `publish-deploy.log`/`publish-verify.log`/
  `publish-rollback.log` — none of it is ever embedded in an event row. `evidence_commit`'s fixed
  file list grew the four new names (`publish.json` and the three logs) alongside
  `status.json`/`events.jsonl`/`engine.log`.
- **Integration naming:** ONE GitHub integration per repository — each target, and the evidence
  repository (the operator's is `gh-popmechanic-fleet-evidence`) — `gh-<owner>-<repo>` (slashes → `-`),
  `--act-as-user`, not readonly, attached to `tag:fleet` by `node fleet/target.mjs <owner>/<repo>`
  (`integrations add github … --attach tag:fleet`; an object that already exists and is not on
  `tag:fleet` in the listing is attached with `integrations attach <name> tag:fleet`). `claude-max`
  carries the same attachment. Every one of them reaches a run's VM by that tag and by nothing
  else: no `--integration` on `new`, no per-VM grant.
  Never two GitHub integrations naming one repo on a VM — the sandbox refuses to boot into that
  (preflight above); two targets' objects on one VM name two repos, which the edge routes apart.
  Every object reaches a fleet VM by its own `tag:fleet` attachment — including the hub's `kata`
  **http-proxy**, the hub's `reaper` peer (#1470) and Jev's `typesafe` **http-proxy**
  (`https://typesafe.int.exe.xyz`, the engine's `TYPESAFE_BASE_URL`). The one exception is
  `lobby-rm`, the `rm`-only lobby key, which is attached to `vm:kata-hub` and never to the tag.
- **Doctor (`fleet/doctor.mjs`) — ten rows, this order, `ROW_IDS`:**
  | id | what it reads | green when |
  |---|---|---|
  | `exe-dev` | `ssh exe.dev whoami` | the alias answers with a username |
  | `capacity` | `ssh exe.dev "billing plan --json"` against `~/.ultrapowers/fleet.json` | both are read and reported: the account's pool, and the size one run asks. The row is a report, not an arithmetic — allocation is over-committable, so it divides nothing and refuses nothing |
  | `claude` | `integrations list --json` + `node fleet/claude-token.mjs status` | `claude-max` exists and carries a bearer; the keychain's refresh token is a warning, not a failure |
  | `accounts` | `node fleet/claude-token.mjs accounts --json` against `fleet.json`'s `account` | the keychain holds an account; the row names each entry with its expiry, and a config account the keychain does not hold is the red |
  | `github` | `ssh exe.dev "integrations setup github --list"` | at least one GitHub account is linked |
  | `integrations` | `integrations list --json` for `claude-max` and `gh-<owner>-<repo>` (with `--target`) | with `--target <owner>/<repo>`, `gh-<owner>-<repo>` exists; every one of those objects is attached to `tag:fleet` — the red names the first that is not and `integrations attach <name> tag:fleet` |
  | `evidence` | `fleet.json`'s `"evidence"` + `gh repo view <owner>/<repo>` + `integrations list --json` | the one-time setup, three checks in order, the red naming the first that fails and its fix: the key is set (`"evidence": "<owner>/<repo>"`); the repository exists (`gh repo create <owner>/<repo> --private`); its integration `gh-<owner>-<repo>` exists on `tag:fleet` (`node fleet/target.mjs <owner>/<repo>`) |
  | `verb-drift` | `help <verb>` for every verb in `fleet/exe-verbs.json` | the record is readable; a flag that appeared or vanished is a finding in a green row, and only an unreadable record is red |
  | `kata` | `integrations list --json` + `ssh exe.dev "ls kata-hub --json"` | the `kata` http-proxy exists, carries a bearer and is attached to `tag:fleet`, and `.vms[]` has a `kata-hub` row; the red says which is absent, and names `node fleet/kata-hub.mjs` — or, for a missing attachment, `integrations attach kata tag:fleet` |
  | `cloudflare` | `integrations list --json` | green when the object is absent (only a plan with a `**Publish:**` line needs it) or attached to `tag:fleet`; red for a present object that is not, naming `integrations attach cloudflare tag:fleet` |

  The doctor imports only `node:`-prefixed specifiers and no other fleet module, and every row id is a
  `## ` heading in `skills/ultrapowers/references/first-run.md`.
- **Janitor (`fleet/janitor.mjs`):** `ls 'fleet-r*' --json` → for each row, parse the VM's `comment` for
  `run=` and `target=` → ask the hub for the run's state (#938): once per pass, on the first row that
  needs it, `GET /api/v1/projects?limit=1000`, matched on `name` against the target's one project
  `<owner>-<repo>` (kata addresses a project by integer `id`; a name in the path is a 400),
  then `GET /api/v1/projects/<id>/issues?limit=1000` — one page holding every run of that target —
  in which the run issue is the one whose
  `metadata.run` is N — that run issue `closed`, or one still `open` whose metadata carries a
  `work.state` of `done|parked|failed`, is a finished run:
  a closed run issue's `closed_reason` (`done`|`wontfix`) is the state and its `closed_at` the age,
  a marked open one's `work.state` is the state and its `updated_at` the age (kata stores the dotted
  key flat, so it is read as `metadata["work.state"]` and never as `metadata.work.state`), and a
  parked run — whose issue stays open for the operator to read — is reaped an hour on like any
  other (the factory boot, `factory/boot.sh` through `board.mjs mark-run`, is the writer of that
  `work.state` key when a run parks or fails, with `work.attention` `needs-human`, and it labels the
  run's task issues `needs-review`, leaving them open, #1391); an `open` issue with no such key is a run in flight, aged from `updated_at` →
  `rm <vm> --json` for a finished run older than 1 h. The hub is reached exactly as the launcher
  reaches it, `fleet/kata-client.mjs`'s `sshTransport`: `ssh <KATA_URL host>` running `curl` against
  `localhost:8000`, the bearer sourced from `/etc/kata/kata.env` ON the hub, the laptop's argv
  carrying the literal `$KATA_AUTH_TOKEN` and never a token; `KATA_URL` is
  `~/.ultrapowers/kata-hub.env`'s, and `fleet/launch.mjs` hands the janitor the client it already
  built. A hub that cannot be read — the env file absent, ssh or curl failing, an answer that is not
  one — darkens the pass at the first error: no further hub request is made, every row from there
  is read from the evidence repository (taken from the `"evidence"` setting; with the key unset the
  janitor reads no evidence and keeps reaping by the hub alone), `runs/<owner>-<repo>/<N>/status.json`
  with `gh api` (`gh api repos/<evidence repo>/contents/…?ref=…`) at the run tag
  `<owner>-<repo>/run-<N>` first and at the branch `live/<owner>-<repo>/run-<N>` only when the tag
  answered no envelope — the page's
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
  `failed`, both `gh api -X PUT` on the live branch in the evidence repository when it has a page, and, for a row the hub
  answered, one `POST …/issues/<run uid>/metadata` patching the run issue's three keys, `work.state`
  `failed`, `work.attention` `needs-human` and `work.attention_msg` the death's own line, under
  `Idempotency-Key janitor:run-<N>:death` — the run issue left open and never a `wontfix` close, a
  close carrying a verified outcome and a death being a run nobody has read yet — and reaped an hour
  later by the ordinary rule, off the `work.state` the death itself wrote. The VM writes its own
  death through the unit's `ExecStopPost=` → `boot.sh died` (#1445); the janitor's death write
  remains the backstop for a VM whose stop-post never ran, to be retired after n=5 runs of
  VM-written deaths. No
  `created_at`, no clone, no `git`. Run by `fleet/launch.mjs` before every launch and by hand after
  a sleep; nothing schedules it, and the janitor merges nothing — the sandbox merges its own PR.
  The janitor's close-out, the census and the launcher's duplicate check likewise read runs only
  from the evidence repository, taking it from the same setting; none of them reads a target's
  refs. On a target the janitor's one write is the DELETE of an `ultra/integration-run-<N>` whose
  highest-numbered pull request (`pulls?state=all&per_page=100&head=<owner>:ultra/integration-run-<N>`, every page) is
  closed with `merged_at` null; an open, merged or absent one keeps the branch.
- **Kata hub (`fleet/kata-hub.mjs`):** ONE persistent VM named `kata-hub`, `--cpu 1 --memory 2GB
  --disk 20GB`, comment `kata hub — persistent service, do not reap`, and NO tag — the janitor's
  `fleet-r*` never lists it, and the comment is the second lock. Its port is pinned by
  `share port kata-hub 8000`. One integration fronts it: `kata`, an `http-proxy --peer` created with
  `--target <https_url> --bearer - --comment 'kata issue daemon on kata-hub' --attach tag:fleet`,
  where `<https_url>` is read off the `kata-hub` row of `ls kata-hub --json` and never guessed from
  the VM name; a missing attachment is repaired with `integrations attach kata tag:fleet`.
  A sandbox reaches it at `https://kata.int.exe.xyz` and holds no token — the edge injects the
  bearer, and the `peer-kata` key `--peer` generates is server-side and is never pruned. The laptop
  reaches it as `ssh <ssh_dest>` + `curl` against `localhost:8000`, sourcing the token from
  `/etc/kata/kata.env` on the hub so no bearer ever rides an argv on the laptop. On the hub:
  `/etc/kata/kata.env` (`root:exedev`, 0640, `KATA_AUTH_TOKEN`, `KATA_TRUST_PRIVATE_NETWORK=1`,
  `KATA_HOME=/var/lib/kata`, `PORT=8000`) delivered over ssh after first boot and never in the setup
  script; `fleet/kata.service` at `/etc/systemd/system/kata.service`; `/var/lib/kata` as `KATA_HOME`
  with `config.toml` carrying `[web] public_origin`; the binary from
  `https://github.com/kenn-io/kata/releases/download/v0.18.0/kata_0.18.0_linux_amd64.tar.gz`
  (`fleet/kata-hub-setup.sh`),
  checked against that release's `SHA256SUMS`; and `/var/lib/kata/.setup-done`, the flag the setup
  script writes last and the laptop polls for. On the laptop: `~/.ultrapowers/kata-hub.env`, mode
  0600, exactly `KATA_URL` and `KATA_TOKEN`, written only after the daemon answers `active`.
- **Kata facts (measured):** every kata behaviour the fleet leans on, read once and written down
  here rather than restated from memory — the readings `node fleet/tests/probe_kata_facts.mjs`
  takes against the hub, one row per probe fact in the probe's own order, then the two rows no
  probe can reach. The rows below are stamped v0.17.2 and have not been re-read on 0.18.0, the
  version the hub and the spokes now run. It is re-read after every `kata upgrade` and before any plan touching
  `fleet/kata-client.mjs`; a reading that moves is one edited row, and a document or an issue
  comment cites the row instead of repeating what it says.
  - ping-version — `GET /api/v1/ping` answers a `version` and needs no bearer (v0.17.2, 2026-09-15; this plan).
  - project-find-or-create — a create whose name the hub already holds answers 200 with `created: false` (v0.17.2, 2026-09-14; #978).
  - project-by-id-only — a project NAME in an issue path is 400; every issue route takes the project id (v0.17.2, 2026-09-14; CONTRACT's janitor paragraph).
  - create-replay — the same `Idempotency-Key` with the same fields answers 200, the same uid and the ORIGINAL revision (v0.17.2, 2026-09-14; #978, #993).
  - create-fingerprint-metadata — the same key with other metadata is 409 `idempotency_mismatch`, naming the prior uid: the key is fingerprinted with the body (v0.17.2, 2026-09-14; #978, #993).
  - create-duplicate-scorer — the same title with no key is 409 `duplicate_candidates` and `force_new: true` bypasses it, scored 0.93 (v0.17.2, 2026-09-15; #993's comment — #978's 2026-09-14 table read `200, a second issue` for that case; settled 2026-09-15 by the probe's first hand run: 409 with `force_new: true` 200, the earlier reading kept as history).
  - link-blocks-idempotent — the same `blocks` link created twice answers 200 with the same `link.id` (v0.17.2, 2026-09-14; #978).
  - link-parent-replace — a second `parent` is 409 `parent_already_set`, and `replace: true` swaps it (v0.17.2, 2026-09-14; #978, #993).
  - link-types — the types are exactly `parent`, `blocks` and `related`; `blocked_by` is 400 (v0.17.2, 2026-09-14; #979).
  - metadata-merge-if-match — a patch merges per key under `If-Match: "rev-N"`, and a stale revision is 412 `revision_conflict` (v0.17.2, 2026-09-14; #978, CONTRACT's 412 sentence).
  - metadata-dotted-flat — `work.state` is stored as the flat key `metadata["work.state"]`, never a nested object (v0.17.2, 2026-09-13; #810's Phase A comment, CONTRACT's janitor paragraph).
  - claim-if-unowned — a claim on an owned issue is 409 `already_claimed` carrying `data.current_owner` (v0.17.2, 2026-09-14; #979).
  - unassign-key — `expect_owner` is 400 unexpected property; the OpenAPI names `expected_owner` (v0.17.2, 2026-09-15; #979, #993, the OpenAPI read 2026-09-15).
  - close-evidence-required — a `done` close whose `evidence` is empty is 400 `evidence required for reason=done`; the accepted entry types are `commit`, `pr`, `test`, `reviewed-paths` and `external`, and the engine's task closes, the boot's run close and the probe each send at least one (v0.17.2, 2026-09-15; #1023, #1026).
  - close-message-40 — a `done` close needs a message of 40 characters or more (v0.17.2, 2026-09-11; run-111, CLAUDE.md's kata seams, CONTRACT's close paragraph).
  - close-retry-protocol — a close under an `Idempotency-Key` also needs `retry_protocol: "close-v1"` (v0.17.2, 2026-09-14; recorded only as a comment in `fleet/kata-client.mjs`).
  - close-superseded-evidence — a `superseded-by` close is 400 for the evidence keys `ref`, `value` and `issue`; the accepted key is undocumented (v0.17.2, 2026-09-14; #978).
  - ready-unowned — `/ready` exists, `?unowned=true` filters it, and `?owner=` is ignored (v0.17.2, 2026-09-14; #978, #979).
  - next-no-endpoint — `GET /projects/<id>/next` is 404; there is no next endpoint on the API (v0.17.2, 2026-09-14; #979, #993; settled 2026-09-15 by the probe's first hand run, `/next` 404).
  - labels-merge — adding a label twice leaves one label (v0.17.2, 2026-09-14; recorded only as a comment in `fleet/kata-client.mjs`).
  - events-issue-uid — every event carries an `issue_uid` except `project.created`, which has none (v0.17.2, 2026-09-14; #978).
  - issue-links-shape — an issue's links read `links: [{id, type, from: {uid, short_id, …}, to: {…}}]` (v0.17.2, 2026-09-14; #979).
  - archive-actor-required — `DELETE /api/v1/projects/<id>` with no `actor` query parameter is 400 `actor: required query parameter is missing`; the query is validated before any state check (v0.17.2, 2026-09-15; #1023, #1026).
  - purge-ladder — a purge is 412 `confirm_required` without `X-Kata-Confirm: PURGE <name>` and 409 `project_not_archived` before `DELETE /projects/<id>?actor=<name>`, and the archive itself, carrying `?actor=`, refuses `project_has_open_issues` (v0.17.2, 2026-09-14; #978, #993 — the launcher's old bump purge had never once succeeded live).
  - events-page — `GET /projects/<id>/events?after_id=N&limit=K` answers `{reset_required, events, next_after_id}`, `next_after_id` being the last event's `event_id`: a `limit` of 2 answered 100 events, so the limit is no bound and the cursor is the whole of the walk, and an empty `events` is its end. A comment event is `type` `issue.commented` with `issue_uid`, `actor` (`impl:3@run-170`) and `payload: {comment_uid, author, body, created_at}` (v0.17.2, 2026-09-17; #1095).
  - cli-next-unowned — hand, read by a person and not the probe: #979 read the CLI's `next` as having no `--unowned`, and `kata next --help` on the hub lists one — both readings stand (v0.17.2, 2026-09-15; #979).
  - int-hosts-https — hand, read by a person and not the probe and readable only from a VM: every `*.int.exe.xyz` host is https, http 301s, and a followed 301 turns a POST into a GET (v0.17.2, 2026-09-11; run-110, CLAUDE.md's kata seams).
- **exe.dev facts (measured):** every exe.dev lobby behaviour the fleet leans on, read once and
  written down here rather than restated from memory — the readings `node fleet/tests/probe_exe_facts.mjs`
  takes against the lobby, one row per probe fact in the probe's own order, stamped with the digest
  of `help all --json` because exe.dev exposes no version marker (Shelley, 2026-09-23). It is
  re-read after any verb-drift finding and before any plan touching `fleet/launch.mjs` or
  `fleet/lobby.mjs`; a reading that moves is one edited row, and a document or an issue comment
  cites the row instead of repeating what it says.
  - help-all-digest — `help all --json` is JSON with a `commands` array, and its sha256 is the only version marker exe.dev exposes (lobby 92465a0aa5e0141b, 2026-09-23; first read 2026-09-23, Shelley cKAZXHW).
  - ls-json-shape — `ls --json` is `{shared_vms, vms}`; read `.vms[]` only; rows carry `vm_name`, `ssh_dest`, `ssh_host`, `status` (lobby 92465a0aa5e0141b, 2026-09-23; first read 2026-09-03, Traps).
  - billing-plan-json — `billing plan --json` carries `max_cpus`, `max_memory_gb`, `tier` and `plan`, the pool the launcher sizes against (lobby 92465a0aa5e0141b, 2026-09-23; first read 2026-09-05, RUNBOOK §Capacity).
  - help-verb-flags — `help <verb>` prints an `Options:` block one flag per line, the set the doctor's verb-drift row diffs (lobby 92465a0aa5e0141b, 2026-09-23; first read 2026-09-05, fleet/doctor.mjs).
  - error-on-stdout — a lobby error comes back on stdout with exit 1 and no envelope (lobby 92465a0aa5e0141b, 2026-09-23; first read 2026-09-03, Traps).
  - new-no-positionals — `new` takes no positionals; a spaced `--comment` travels inside one ssh argument with its quotes intact; `--memory` under 2 GB is refused with `--memory must be at least 2 GB` (a 1 GB throwaway parked the probe's first hand run) (lobby 92465a0aa5e0141b, 2026-09-23; first read 2026-09-12, the ultraviz deploy, Traps).
  - comment-200-bytes — the VM comment holds 200 bytes (lobby 92465a0aa5e0141b, 2026-09-23; first read 2026-09-04, Traps, `COMMENT_MAX_BYTES`).
  - share-port-single — `share port` sets the VM's single `proxy_port` and a second call replaces it (lobby 92465a0aa5e0141b, 2026-09-23; first read 2026-09-12, Traps).
  - tag-add-remove — `tag` adds and `tag -d` removes a tag; `tag -d` of an attached tag detaches that integration at once, not re-measured by the probe (lobby 92465a0aa5e0141b, 2026-09-23; first read 2026-09-04, Traps).
  - cp-copies-tags — `cp` copies tags by default and `--copy-tags=false` makes a copy with none (lobby 92465a0aa5e0141b, 2026-09-23; first read 2026-09-04, Traps).
  - rm-reserves-name — a `new` with a just-deleted name succeeds — the name is not reserved (lobby 92465a0aa5e0141b, 2026-09-23 and 2026-09-29, n=2; the 2026-09-04 Trap read "reserved for good", and both probe hand runs read the opposite). The practice stands regardless: the run number is the identity and a VM name is one incarnation, never reused.
  - refused-verbs — `new --integration` is refused since 2026-09-11 (lobby 92465a0aa5e0141b, 2026-09-23; first read 2026-09-11, Traps, #1036). `integrations attach` is live: `integrations attach reaper tag:fleet` answered `reaper is already attached via tag:fleet`, and `help integrations` lists `attach`/`detach` and no `policy` (2026-09-30, n=1, #1434).
- **SDK and edge-auth facts (measured 2026-09-17, one hand-stood `--tag fleet` box):** the readings
  the Agent SDK worker layer rests on, taken on `jev-probe-09172119` (node 24.20.0, SDK 0.3.274,
  image CLI 2.1.272) under the boot's own engine env, one row per probe. A reading that moves is one
  edited row; a document or an issue comment cites the row instead of repeating it.
  - sdk-through-the-edge — `query()` with `settingSources: []` and
    `outputFormat: {type:'json_schema'}` answers through the edge bearer under
    `ANTHROPIC_BASE_URL=https://claude-max.int.exe.xyz`, `CLAUDE_CODE_OAUTH_TOKEN=placeholder`,
    `env -u CLAUDE_CONFIG_DIR`: `apiKeySource: none`, structured output honoured, 3.0 s wall, and
    `system/init.capabilities` advertises `interrupt_receipt_v1`, `interrupt_cancel_queued_v1`,
    `msg_lifecycle_v1` (2026-09-17; #1131 probe 1).
  - env-only-auth — the same query answers with `ANTHROPIC_AUTH_TOKEN=placeholder` and NO
    `CLAUDE_CODE_OAUTH_TOKEN`, and the control with neither variable set fails fast
    (`Not logged in · Please run /login`, `terminal_reason: api_error`, 0.5 s). Env-only auth is
    therefore real and not the edge answering regardless, so the four-flag `--bare` substitute the
    old engine's worker `buildArgs` carried was retirable (2026-09-17; #1131 probe 2, the 2026-08-28
    `--bare` blocker settled).
  - setup-token-infers-but-fails-the-bearer-probe — a `claude setup-token` one-year token installed
    as `claude-max`'s bearer SERVES INFERENCE (same query, structured output, 2.1 s) and passes the
    boot's first gate (`claude auth status` → `authMethod: oauth_token`, `apiProvider: firstParty`),
    but `GET /api/oauth/usage` through the proxy is 403 `oauth_scope_insufficient`, required scope
    `user:profile`, with a `"type":"error"` body — exactly the shape `factory/preflight.mjs`
    classifies as a dead credential, so it would PARK EVERY RUN at boot. The token is
    inference-scoped by construction. Retiring the four-hour refresh and the revocation trap of
    runs 92/100/103 therefore costs one change to the bearer probe, not zero (2026-09-17; #1131
    probe 3).
  - doctor-reads-the-comment-not-the-token — with the setup-token installed, all eight
    `node fleet/doctor.mjs` rows stayed ok and the accounts row named the drift itself
    (`edge carries setup-token-probe-2026-09-17; fleet.json names marcus.e-gmail.com`): the doctor
    reads `--comment account=<name>`, never the bearer (2026-09-17; #1131 probe 3).
  - refresh-without-force-does-not-rotate — `node fleet/claude-token.mjs refresh --account <name>`
    with an unexpired record reinstalls the CACHED access token at the edge and mints nothing, so it
    is the safe way to restore the bearer; only `--force` rotates and revokes. `--account` is
    required when the keychain account is not `ultrapowers`, or the refresh reports no refresh token
    (2026-09-17; #1131 probe 3's rollback).
  - fanout-no-429 — trivial structured haiku queries, all succeeding, no rate limit at any width
    read: 1 wide 3.0 s; 10 wide 6.2 s wall, per-query median 4.4 s, 10/10, zero 429; 30 wide 13.9 s
    wall, per-query median 10.7 s, zero 429. Latency stretches roughly linearly past 10, so the
    bound on width is throughput and not a 429 (n = 41 queries, 2026-09-17; #1131 probe 4).
  - maxturns-1-loses-to-thinking — three of the 30-wide queries ended `error_max_turns` /
    `terminal_reason: max_turns` after spending ~370 thinking tokens without emitting the structured
    answer. `maxTurns: 1` with `outputFormat` is not safe on a thinking model; it is a worker-shape
    defect and reads as a rate limit if only the failure count is looked at (n = 3 of 30,
    2026-09-17; #1131 probe 4).
  - sdk-cost-is-not-a-cost-sensor — `result.total_cost_usd` under the edge proxy reported $0.0468
    for a haiku turn of 10 input / 165 output with ~20k cache-read and ~2.6k cache-creation tokens,
    roughly 8× a hand price of the same usage. The token counts in `result.usage` are the readable
    quantity; the dollar figure is an estimate the subscription path does not make true
    (2026-09-17; #1131 probe 1).
- **Laptop config `~/.ultrapowers/fleet.json`** — `cpu`, `memory`, `account` and `evidence`, every
  one of them optional to the file, an unknown key ignored and a missing file meaning the defaults:

  ```json
  {
    "cpu": "8",
    "memory": "16GB",
    "account": "<name>",
    "evidence": "<owner>/<repo>"
  }
  ```

  `memory` is `<int>GB` or `<int>G`; a bare number or a fractional `1.5GB` is unreadable. `account`
  is the keychain account the `accounts` row expects. `"evidence"` is the evidence repository
  (the operator's `popmechanic/fleet-evidence`); `--evidence-repo` overrides it per launch, and a
  launch with neither is refused. A key outside those four is a key nothing reads: the `capacity`
  row is red and names it.
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
  edited — which is why the run's integration reaches the VM by a standing tag attachment from creation and
  is never swapped in at publish time; (2) two GitHub integrations naming the same repo attached to one VM have
  no documented tie-break; (3) the aggregate host proxies only `/repos/OWNER/REPO/...`
  (`/user` → edge 403), so `gh auth status`/`gh api user` can never work through it and are not
  health checks.

## Rules
- Amendment 10: models never run git; every git command and every GitHub call is a script's.
- No secret on any VM and none in any argv. The Claude bearer reaches the edge on stdin only.
- Scripts pass `bash -n`; tests: pytest under `tests/`, node `.mjs` under `fleet/tests/` (sentinel `ALL
  TESTS PASSED`, 300 s per file, no network, stub `curl`/`git`/`gh`/`ssh`/`systemd-run`/`systemctl` via a PATH shim).
  Test behaviour, not sentences; no test pins a sentence of a document.
- Prefer deleting to adapting. A file named for what it does.
