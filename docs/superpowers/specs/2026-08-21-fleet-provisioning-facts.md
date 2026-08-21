# Fleet provisioning facts — established on live exe.dev VMs (#179)

**Status: FACT SHEET — pre-decision facts for The Width Program (#174),
established 2026-08-21 on a live probe VM (`proto-179-probe`, created,
measured, cloned, and deleted the same session).** Every fact below was
observed directly over SSH or read from exe.dev's own docs
(https://exe.dev/docs.md); nothing is inferred from marketing copy.

## 1. The key measurement: vCPUs vs the Workflow concurrency formula

- A stock VM presents **`nproc` = 2** (verified on the probe; matches
  `allocated_cpus: 2` on every existing VM on the account).
- The engine requests a flat `CONCURRENCY = 16` (waves.js:1926); the Workflow
  **runtime** clamps at min(16, CPUs−2). At nproc=2 that is **0 — a stock VM
  cannot run a parallel wave at all.** A width-w wave needs **w+2 vCPUs**
  (width 4 → 6 vCPUs; width 8 → 10; the full 16 → 18).
- `resize --cpu` is **hard-capped at 2** on the current plan:
  `{"error":"--cpu cannot exceed 2 — run `billing capacity` to upgrade"}`.
- The cap is the plan, and it is a **shared pool**: Individual Plan (Small),
  $20/mo — "**2 vCPUs · 8 GB memory shared across your VMs**" (up to 50 VMs,
  100 GB pooled disk, 200 GB/mo transfer). The ~20 VMs already on the account
  all draw from that same 2-vCPU pool.
- **Consequence (the blocking fact): no fleet width exists until the plan is
  upgraded.** `billing capacity` (interactive terminal only — an operator
  action) is the upgrade path; per-VM vCPU ceilings on larger plans are
  unknown until one exists. Tier sizing keys off target wave width via w+2.

### Addendum (same day): blocker DISCHARGED — plan upgraded to XLarge

- Operator upgraded to **Individual Plan (XLarge), $160/mo: 16 vCPUs · 64 GB
  shared across VMs**, 800 GB pooled disk (transfer unchanged at 200 GB/mo).
- Re-probed live: `new --cpu=8 --memory=16GB` → **`nproc: 8`**, 16 GB
  presented (probe `proto-179-cpu8`, deleted). A `--cpu=16` VM also creates
  (pool max; probe deleted unbooted). Requested vCPUs present 1:1 to nproc.
- **Fleet arithmetic on the 16-vCPU pool:** an 8-vCPU runner gives
  min(16, 8−2) = **6 concurrent agents** (width-6 waves); a 16-vCPU runner
  gives 14 but consumes the whole pool. Practical shape: 2-vCPU orchestrator
  + 6–8-vCPU runners; **~2 pool-saturating concurrent runs**, which matches
  the ~2–3 runs the subscription token window supports anyway. Allocation is
  oversubscription-tolerant (the account's ~20 idle 2-vCPU VMs coexist), so
  idle VMs don't consume the pool — busy ones contend.

## 2. Image / snapshot flow

- VMs boot from **OCI container images** (`--image`, default
  `boldsoftware/exeuntu`, whose Dockerfile is open source; private registries
  supported via `--registry-auth`; OCI labels like `exe.dev/install-shelley`
  and `exe.dev/login-user` tune platform behavior).
- **`cp <vm>` clones a VM in ~0.7s** (returns `state: "starting"`; SSH-able
  seconds later) **preserving full disk state** — verified: a repo cloned
  into `/tmp` on the source appeared intact on the copy. `cp` accepts
  `--cpu/--memory/--disk` overrides but **no `--env`**.
- `new` additionally supports `--env KEY=VALUE` (repeatable), a first-boot
  `--setup-script` (10 KiB max), `--tag`, `--pool` (team pools), `--prompt`
  (Shelley).
- **Validated provisioning flow:** golden VM (exeuntu + node + warmed repo +
  plugin, maintained by hand or custom image) → `cp` per run (~instant) →
  SSH-deliver the run assignment + store token → run. One run per sandbox
  per the charter.

## 3. Claude Code in the sandbox

- **Preinstalled on exeuntu**: `/usr/local/bin/claude`, v2.1.237 at probe
  time — alongside `codex`, `pi`, `shelley`, `go`, `uv`. It is a standalone
  binary: **node is NOT on the image** (git 2.43 and python3 are). The
  TinyBase orchestrator/ws pieces need node installed via setup-script or a
  custom image.
- Repo clone from GitHub (public): **1.1s for ultrapowers (21 MB)**. A
  GitHub integration exists for private-repo access.

## 4. API-billing auth — solved platform-side, zero secrets on the VM

- The **LLM integration** vaults provider keys: configure with
  `printf '%s' "$KEY" | ssh exe.dev integrations edit llm --anthropic=byok
  --anthropic-key=-` (key read from stdin, never shell history). Attached
  VMs call `https://llm.int.exe.xyz`; **the VM cannot read the key** — the
  edge injects it. New accounts get a default `llm` integration attached
  `auto:all` (verified reachable from the probe with no credentials).
- **Proven end-to-end on the probe:**

  ```
  ANTHROPIC_BASE_URL=https://llm.int.exe.xyz \
  ANTHROPIC_API_KEY=exe-gateway \
  claude -p "reply with exactly: OK" --model claude-haiku-4-5-20251001
  → OK
  ```

  Claude Code requires *some* `ANTHROPIC_API_KEY` to start; a dummy value
  satisfies it and the integration substitutes the real credential at the
  edge. **This supersedes baking keys into images or loopback-minting the
  LLM credential ourselves** — the no-API-key-on-the-VM property comes free.
  (Repo code still never touches the `anthropic` SDK or a key — this is
  session auth, which the no-API-key rule does not bind.)

## 5. Store/fleet credential minting (the charter's opaque tokens)

- The charter's orchestrator-minted short-TTL store tokens are delivered by
  **SSH file-write at claim time** (after `cp`, before the run starts) —
  `cp` has no `--env`, and baking into the golden image is forbidden
  (snapshot-clone shares a credential across holders — the pre-discovered
  rotation-replay trap).
- Native platform alternatives exist and are candidates, not commitments:
  **Token-Mint Integrations** (vaulted durable credential → ~1h short-lived
  token via `POST <name>.int.exe.xyz`; catalog services only today) and
  **VM-to-VM integration** (edge-injected key for VM→VM HTTPS) — the latter
  could carry sandbox→orchestrator store auth if the ws-server rides the
  HTTPS proxy.

## 6. Odds and ends for #182 (dashboard) and ops

- `ssh exe.dev stat <vm> --json --range=24h|7d|30d` returns vCPU, disk, IO,
  and network metrics per VM — a ready-made fleet-dashboard data source.
- Regions: lax, pdx (`set-region`). Every VM gets `https://<vm>.exe.xyz`
  with automatic TLS (the orchestrator ws-server can ride it).
- `rm` takes multiple VM names, no force flag needed:
  `ssh exe.dev "rm a b --json"`.
- Lobby commands must be sent as ONE quoted argument in non-interactive use:
  `ssh exe.dev "new --name=x --json"` (unquoted multi-word forms fail with
  "no subcommands").
