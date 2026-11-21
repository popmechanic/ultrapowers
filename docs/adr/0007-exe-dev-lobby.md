# 0007. Talking to exe.dev

Status: accepted (2026-11-21)  
Governs: `fleet/lobby.mjs`, `fleet/tests/probe_exe_facts.mjs`

Recovered from the code comments removed by `/delete-comment` on 2026-11-21: each entry is a
decision the code cannot show on its own. Symbols are named; line numbers are not.

## Assignment comment

- **fleet/lobby.mjs isFullSha** — The VM assignment comment's `base=` and `engine=` carry full 40-character shas only (fleet/lobby.mjs `isFullSha`). An abbreviated sha could resolve to different objects in two clones, so abbreviations are refused rather than resolved.
- **fleet/lobby.mjs COMMENT_MAX_BYTES** — exe.dev's VM `comment` field has a hard ceiling of 200 bytes, so the assignment comment must fit in it (fleet/lobby.mjs `COMMENT_MAX_BYTES`).
- **fleet/lobby.mjs COMMENT_KEYS** — The assignment comment has seven keys in contract order: run, plan, target, base, engine, kind, hold (fleet/lobby.mjs `COMMENT_KEYS`). The launcher always writes `kind=flock`, because an older boot reads a missing `kind=` as the retired factory; `hold` is optional, and a comment read back may lack `kind=` when an older launcher wrote it.
- **fleet/lobby.mjs buildComment** — fleet/lobby.mjs `buildComment` emits one line of space-separated `key=value` in contract order, with optional keys omitted. It performs no escaping: every value must already be validated by the caller, so nothing can introduce a quote or space into the single-quoted `--comment` in the exe.dev ssh string.

## Lobby exec seam

- **fleet/lobby.mjs exec seam** — The laptop CLIs share one exec seam in fleet/lobby.mjs: `exec(cmd, argv, options)` wraps execFile, resolves `{code, stdout, stderr}` and never rejects, and never builds a local shell string. A secret reaches a child only on stdin via `options.input`, never in argv. Because exe.dev's lobby parses the remote half of `ssh exe.dev "..."` as a shell string, every interpolated value is validated first (`isSafeTarget`, `isFullSha`, `isRunNumber`, `isVmName`) and the assignment comment is built only from validated parts. The module uses only `node:` specifiers and no npm deps because it runs from the installed plugin cache.
- **fleet/lobby.mjs isSafeTarget** — fleet/lobby.mjs `isSafeTarget` accepts only `owner/repo` with exactly one slash and halves that start and end with a letter or digit, because a target is interpolated into the exe.dev ssh remote string, which the lobby parses as a shell line. `..` and dot-led halves are refused.
- **fleet/lobby.mjs defaultExec** — fleet/lobby.mjs `defaultExec` writes `options.input` to the child's stdin and then ends the stream, because a child that reads stdin to EOF (`cat`, `gh pr create --body-file -`) otherwise never exits and the promise never settles. Without `input`, stdin is left as execFile opened it.
- **fleet/lobby.mjs lobby** — fleet/lobby.mjs `lobby` runs `ssh exe.dev "<remote>"` with the remote half as one argv element. A non-zero exit throws a `LobbyError` carrying all output verbatim, because exe.dev documents no error envelope to parse. A verb fed a secret receives it on stdin so it never appears in an argv visible to `ps`.

## Exe dev facts probe

- **fleet/tests/probe_exe_facts.mjs** — exe.dev exposes no version verb, header or changelog (Shelley, 2026-09-23), so fleet/tests/probe_exe_facts.mjs re-measures the fleet's lobby behaviours against the live lobby and stamps each line with the sha256 of help all --json. It is deliberately not named test_*.mjs so the pytest bridge never spends a real VM; it refuses to run beside a live fleet-r* VM, removes its throwaway VMs and reports any left behind (exit 2).
- **FACTS** — The twelve ids in fleet/tests/probe_exe_facts.mjs FACTS are the shared key with fleet/CONTRACT.md's exe.dev facts (measured) list, row for row. Facts are logged in FACTS order, but rm-reserves-name is read last, after the cleanup frees the name.
- **probeExeFacts** — fleet/tests/probe_exe_facts.mjs issues each verb as exec('ssh', [EXE_HOST, '<verb line>']) directly rather than through fleet/lobby.mjs lobby(), because several facts need the exact stdout/stderr split and exit code that a caught LobbyError does not keep.

## Evidence repository

- **fleet/lobby.mjs evidenceRepoFor** — The evidence repository is the operator's setting: the `evidence` key (`owner/repo`) in `~/.ultrapowers/fleet.json`, overridable per launch with `--evidence-repo` (fleet/lobby.mjs `evidenceRepoFor`). It is never derived from the target and has no default, so a launch without one cannot silently write its record somewhere unintended.
- **fleet/lobby.mjs runFolderFor/liveBranchFor/runTagFor** — A run's record in the evidence repository is keyed by the target's slug (`owner-repo`, collision-free across owners): its folder is `runs/<slug>/<N>`, the branch it writes while running is `live/<slug>/run-<N>`, and the tag that outlives it is `<slug>/run-<N>` (fleet/lobby.mjs `runFolderFor`, `liveBranchFor`, `runTagFor`).

## Exe dev lobby readers

- **fleet/lobby.mjs listVms** — fleet/lobby.mjs `listVms` reads only the `.vms[]` rows of `ssh exe.dev "ls '<pattern>' --json"`; `.shared_vms[]` are other people's machines, and reading every array is how run-69 counted a shared VM as fleet. The pattern is matched server-side. `vm_name`, `ssh_dest`, `ssh_host`, `status` are documented fields; `comment` and `tags` are undocumented and read as optional (null when absent).
- **fleet/lobby.mjs readPlanCapacity** — fleet/lobby.mjs `readPlanCapacity` reads four fields (`max_cpus`, `max_memory_gb`, `tier`, `plan`) from `ssh exe.dev "billing plan --json"`, a flat object of about a dozen keys (measured 2026-09-04), and ignores the rest so a new upstream key is not a failure. A payload without a numeric `max_cpus` is a `LobbyError` carrying the whole output.

## Run identity

- **fleet/lobby.mjs vmNameFor** — A run's durable identity is its number N, carried in the assignment comment and in the evidence repository's live branch and tag. Its VM is named `fleet-r<N>-<yymmddHHMM>-<4 hex>` (fleet/lobby.mjs `vmNameFor`), minted fresh on each launch, because the VM name only says where the run is executing this time; exe.dev does not reserve deleted names, but the name is still never derived from N alone.
- **fleet/lobby.mjs highestRunInEvidence** — The next run number comes from the highest run a target has in the evidence repository: one `git ls-remote` over its live branches and tags (fleet/lobby.mjs `highestRunInEvidence`). A non-zero listing is a refusal, never treated as zero, so a transient failure can never make a launch reuse an existing run number.

## Fleet cli exit codes

- **fleet/lobby.mjs Refusal** — Fleet laptop CLIs distinguish a refusal (fleet/lobby.mjs `Refusal`, exit 2, one line naming why, and for the launcher nothing on exe.dev mutated) from a failure (`LobbyError`, exit 1, a lobby verb that ran and answered non-zero with its whole output).

## Github integration

- **fleet/lobby.mjs githubIntegrationFor** — Each target has exactly one exe.dev GitHub integration, named `gh-<owner>-<repo>` (fleet/lobby.mjs `githubIntegrationFor`), act-as-user, writable, attached to `tag:fleet`. Naming it after the repository makes a duplicate visible in a plain `integrations list`. Two integrations covering one repo on one VM is a fault the sandbox refuses to boot into, because the GitHub edge routes by repo path and documents no tie-break (measured 2026-09-03).

## Run refs

- **fleet/lobby.mjs integrationBranchFor** — A run pushes exactly one branch to the target, `ultra/integration-run-<N>` (fleet/lobby.mjs `integrationBranchFor`), holding the work it integrated. It is transient: GitHub's delete-on-merge removes it, and the janitor deletes closed-unmerged ones; the run's durable record lives in the evidence repository instead.
