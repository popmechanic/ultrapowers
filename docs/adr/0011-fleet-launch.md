# 0011. Launching a run

Status: accepted (2026-11-21)  
Governs: `fleet/compiler.mjs`, `fleet/fleet-bootstrap.sh`, `fleet/launch.mjs`, `fleet/plan-pins.mjs`, `fleet/setup-script.mjs`, `fleet/target.mjs`, `fleet/tests/_boot_helpers.mjs`, `fleet/tests/_helpers.mjs`, `fleet/tests/_lobby_helpers.mjs`, `fleet/tests/fixtures/hermetic/leaky_sim.mjs`, `fleet/tests/gate_jev_replay_probe.mjs`, `fleet/tests/test_factory_boot.mjs`, `fleet/tests/test_factory_nogit.mjs`, `fleet/tests/test_factory_preflight.mjs`, `fleet/tests/test_factory_publish.mjs`, `fleet/tests/test_flock_objection.mjs`, `fleet/tests/test_flock_pulls.mjs`, `fleet/tests/test_flock_scope.mjs`, `fleet/tests/test_intent_tray.mjs`, `fleet/tests/test_launch_duplicate.mjs`, `fleet/tests/test_launch_plan_path.mjs`, `fleet/tests/test_launch_stories_grammar.mjs`, `fleet/tests/test_sims_are_hermetic.mjs`, `fleet/toolchain.mjs`

Recovered from the code comments removed by `/delete-comment` on 2026-11-21: each entry is a
decision the code cannot show on its own. Symbols are named; line numbers are not.

## Fleet sim hermeticity

- **fleet/tests/_helpers.mjs simEnv** — Every process a fleet sim starts gets its environment from simEnv in fleet/tests/_helpers.mjs: the parent's ULTRA_, TINYAPP_, FLEET_, ANTHROPIC_, CLAUDE_ and GH_ keys are dropped, HOME/TMPDIR/FLEET_HOME point at a sim-owned directory, and PATH carries only the interpreters. Node gives a child exactly the env object passed and resolves commands (and bash -c sub-commands) on env.PATH, which is why interpreters ride that PATH; test_sims_are_hermetic.mjs enforces the rule, and the underscore prefix keeps the helper out of test_fleet_suite.py's test_*.mjs glob.
- **fleet/tests/_helpers.mjs OWNED** — simEnv in fleet/tests/_helpers.mjs mints a fleet-sim-* directory per call when no home is given and records it in OWNED; a process exit handler removes them with synchronous, forced rmSync, because exit handlers get no event loop and a child may already have removed a directory.
- **fleet/tests/_lobby_helpers.mjs makeExec, makeTargetRepo** — The laptop CLIs' sims in fleet/tests/_lobby_helpers.mjs run every command through a recording seam (makeExec): matching rules answer, git passes through for real so plan commits and pushes hit a real local bare origin (makeTargetRepo), and anything else answers empty and green, so no sim ever runs ssh, gh or curl. `ssh exe.dev ...` is a lobby verb and `ssh <ssh_dest> ...` a command on a VM, told apart by the first argument.
- **fleet/tests/_lobby_helpers.mjs vmRow** — vmRow in fleet/tests/_lobby_helpers.mjs gives fixture VMs an ssh_dest of exedev@<name>.ssh.exe.xyz, deliberately not <name>.exe.xyz, so any fleet tool that derives the SSH destination from the VM name instead of reading exe.dev's ls --json row fails its sim.
- **fleet/tests/_lobby_helpers.mjs GIT_HOME, gitEnv** — Every git that fleet/tests/_lobby_helpers.mjs runs uses a HOME the fixture owns (GIT_HOME via simEnv), so the machine's ~/.gitconfig never reaches a repository an exam builds; each repository sets its own identity, and a caller's env is laid over last so it can override.
- **fleet/tests/_lobby_helpers.mjs tempDir** — On macOS /tmp is a symlink and git reports resolved paths, so tempDir and GIT_HOME in fleet/tests/_lobby_helpers.mjs build temp directories under fs.realpathSync(os.tmpdir()) so paths git reports compare equal to those the test built.
- **fleet/tests/_lobby_helpers.mjs COMPILER_FETCH, launchRules** — At a fake engine sha, the launcher's real git show of the compiler fails and the gh api contents call answers instead. In fleet/tests/_lobby_helpers.mjs, COMPILER_FETCH must come before a sim's recordRule in launchRules, because recordRule's empty page would otherwise read as a compiler that could not be fetched and refuse the launch; compilerRule answers every python3 so the fetched body never runs.
- **fleet/tests/fixtures/hermetic/leaky_sim.mjs** — fleet/tests/fixtures/hermetic/leaky_sim.mjs deliberately breaks each hermetic sim rule once (an environment-inheriting spawn, an absolute-path read, a sibling-sim spawn) so test_sims_are_hermetic.mjs can show its static sweep names each offence. It is never collected (its name does not match test_*.mjs) and never executed, and must not be 'fixed'.
- **fleet/tests/test_sims_are_hermetic.mjs** — Every fleet sim must see only what it is handed: fleet/tests/test_sims_are_hermetic.mjs statically scans every fleet/tests/test_*.mjs and _*.mjs (never probe or fixture files) for three offences: a process spawn whose `env` is not derived from `simEnv` (process.env refused; helpers accepted by their body, resolved across sibling imports), an fs read of a literal absolute path outside the checkout and os.tmpdir(), and a spawn of another test_*.mjs or pytest. Identifier resolution goes exactly one level so a mutated copy of a sim's own text under the temp root is not mistaken for a sibling run. Comments are blanked before any rule reads a file, and string contents are blanked only for the structural pass so both passes share offsets.
- **fleet/tests/_helpers.mjs simEnv** — simEnv in fleet/tests/_helpers.mjs mints HOME, FLEET_HOME and TMPDIR under a home that defaults to a fresh directory under os.tmpdir(), and os.tmpdir() itself reads the parent's TMPDIR, so TMPDIR is never planted in the hermeticity tests. The FLEET_HOME a box sets (the leak behind #833) is the key that must never reach a child.
- **fleet/tests/test_sims_are_hermetic.mjs SWEPT** — fleet/tests/test_sims_are_hermetic.mjs pins its reach by asserting the swept file set equals the test_*.mjs and _*.mjs files in the directory, not by a minimum file count. A count floor only records how large the pre-flight was when written and says nothing when a sim is retired; set equality proves every file the rules cover was read.

## Fleet vm setup script

- **renderSetupScript** — exe.dev runs --setup-script once at first boot as exedev with only HOME, USER and PATH set, passwordless sudo -n, the file on stdin and a 10 KiB cap; fleet/setup-script.mjs installs only what the image lacks (node, bun, celld, pytest), drops the bootstrap and unit template, starts the run and deletes itself. The run number is baked into the generated script as a literal, so a VM can never run another run's assignment through a leaked --env.
- **SETUP_SCRIPT_BUDGET_BYTES** — fleet/setup-script.mjs enforces a 9216-byte budget under exe.dev's 10240-byte --setup-script ceiling so a growing bootstrap fails on the laptop before the lobby refuses it.
- **CELLD_SHA256** — fleet/setup-script.mjs pins celld's x86_64 Linux asset by a sha256 literal (read 2026-10-01, matching the release page) that the VM verifies with sha256sum -c at first boot. A literal is used because the release ships no sums file and the attestation check needs a token the sandbox deliberately lacks; it changes only when a human bumps CELLD_VERSION.
- **CELLD_URL** — fleet/setup-script.mjs installs celld straight into /usr/local/bin (root-owned, on PATH for /bin/sh -c, as learned with bun), not through the vendor's installer, whose rollback symlinks are useless on a one-run VM, and never under /usr/local/lib/fleet, the immutable bootstrap's path.
- **EVIDENCE_REPO** — fleet/setup-script.mjs accepts the evidence repository only as <owner>/<repo> matching a strict pattern because it is written inside a single-quoted shell literal in the generated script; anything else could break out of the quoting.
- **renderSetupScript** — fleet/setup-script.mjs's size check fails on the fleet budget first and always names it, adding the platform ceiling only when that is also exceeded, so the error never implies headroom the payload does not have.

## Launch compiler at engine sha

- **fleet/compiler.mjs CHECKER_REL PARSER_REL** — fleet/compiler.mjs resolves plan_check.py and plan_parse.py inside the engine tree at the launch's engine sha, never against the laptop checkout. plan_check.py imports plan_parse.py from its own directory, so both land side by side in one temp directory.
- **fleet/compiler.mjs STORIES_RELS** — For a stories-v1 plan, plan_check.py and plan_parse.py import stories_parse.py, stories_check.py and probe_block.py from their own directory, so fleet/compiler.mjs fetches those three beside them only when the caller passes stories: true. A claims-v1 launch never fetches them.
- **fleet/compiler.mjs fetchCompilerAt** — The launcher once ran the compiler of the installed plugin build while the sandbox ran the engine checkout at engine=, so a plan that compiled on the laptop was refused an hour later (run-26, 2026-09-17). fleet/compiler.mjs fetchCompilerAt therefore reads each file at the engine sha via `git show`, then the GitHub raw contents API, treating a non-zero exit or empty stdout as no answer; when neither answers it refuses, never falling back to the local copy.
- **fleet/compiler.mjs requireCompilerPath** — fleet/compiler.mjs refuses any compile called without a compilerPath before running a subprocess, rather than compiling with whatever copy sits beside it, because a default is how a launch ends up with a compiler the sandbox does not have.
- **fleet/compiler.mjs verifyPlanCompiles** — fleet/compiler.mjs verifyPlanCompiles runs `plan_check.py --base <base>` before any lobby verb, push or ls-remote; a non-zero exit is a refusal carrying the compiler's text verbatim. On a clean check it returns the STALE fact:, GREEN-AT-BASE fact: and AUTHORING fact: lines in printed order so the launch line shows them, since those are advisory and the compile still exits 0.
- **fleet/compiler.mjs compilePlanForRun** — fleet/compiler.mjs compilePlanForRun runs the sandbox's own plan_parse.py, fetched at the engine sha, so the width the laptop sizes the VM from (the most tasks ready at once) is what the engine will read. The stamp only labels the run; the parse output is the same under every run number.

## Assignment comment keys

- **fleet/launch.mjs stampWidth** — The VM assignment comment's keys are enumerated twice, by COMMENT_KEYS in fleet/lobby.mjs and by parse_assignment in factory/boot.sh, which fails the boot on any unknown key; a new key must land in both in one change. So the plan width W is not an assignment key: fleet/launch.mjs stampWidth writes it as a comment line under the setup script's shebang, an inert record for whoever asks why the VM has its size, which the engine never reads.
- **fleet/launch.mjs launchBody result.account** — The keychain account a run signs in with is never part of the VM assignment comment: parse_assignment in factory/boot.sh refuses unknown keys and neither COMMENT_KEYS nor buildComment in fleet/lobby.mjs spells account. fleet/launch.mjs carries it on the launch result and launch line instead.
- **fleet/launch.mjs launchBody result.width / stampWidth** — The plan width W is not an assignment-comment key, because COMMENT_KEYS in fleet/lobby.mjs spells seven keys and parse_assignment in factory/boot.sh fails on an eighth. fleet/launch.mjs records W on the launch result and in the setup script header via stampWidth, where it is a record and not a switch.
- **fleet/launch.mjs renderLaunch** — fleet/launch.mjs renderLaunch prints the run id, VM, assignment comment, reap and again lines, account, usage, token hold, engine and compiler lines, and ends with the compiler's STALE, GREEN-AT-BASE and AUTHORING fact lines, which the operator reads down to. account= is a rendered line and never an assignment key, because the VM's boot kills a run on an unknown key; two launches differing only in --account build byte-identical comments.
- **fleet/launch.mjs KIND** — The Flock is the only engine (map #1292 rule 8), yet fleet/launch.mjs still writes kind=flock (KIND) on every assignment comment: an older engine's factory/boot.sh, reachable through a pinned --engine sha, reads a missing kind= as the retired factory.

## Fleet vm bootstrap

- **fleet/fleet-bootstrap.sh** — fleet/fleet-bootstrap.sh is installed root-owned 0555 at /usr/local/lib/fleet/bootstrap.sh by the first-boot setup script and started by fleet-run@<N>.service with the run number as $1 and, from ExecStopPost=, 'died' as $2. It is never overwritten by a run: run-68 died because the boot script re-exec'd itself from a checkout that replaced it while bash kept reading the old inode. It reads the assignment once, clones the named engine into a content-addressed directory and execs that checkout's factory/boot.sh; boot-script fixes ship as an engine sha, tool changes in the setup script.
- **fleet/fleet-bootstrap.sh** — fleet/fleet-bootstrap.sh runs in mode 'boot' by default and 'died' when invoked from the unit's ExecStopPost=; in died mode every refusal is logged and exits 0, because a stop-post must never fail the stop.
- **fleet/fleet-bootstrap.sh** — fleet/fleet-bootstrap.sh reads the VM comment from reflection once, with no retry, because the launcher writes the comment before starting the unit; an empty or malformed comment is a launcher bug and the run fails at once.
- **fleet/fleet-bootstrap.sh** — In died mode fleet/fleet-bootstrap.sh never clones the engine: with no engine present there is no boot script to write the death, so it exits 0.
- **fleet/fleet-bootstrap.sh** — fleet/fleet-bootstrap.sh clones the engine into <sha>.tmp and renames it last, so a clone that dies halfway is never mistaken for an engine and the next attempt discards it.

## Launch base on main

- **fleet/launch.mjs BASE_OFF_MAIN_FIX** — A launch whose --base is not on the target's default branch is refused (fleet/launch.mjs BASE_OFF_MAIN_FIX). Per decision 5 of #715, parked branch work is not lost and is not taken as a patch or base; the operator re-drives it as a new plan on main, which is procedure rather than a launcher flag.
- **fleet/launch.mjs checkBaseOnDefault** — fleet/launch.mjs checkBaseOnDefault reads the origin's default branch and tip with one ls-remote --symref, fetches that tip, and asks merge-base --is-ancestor. The only ref it writes is the checkout's refs/remotes/origin/<default>; HEAD, local branches and the working tree are left untouched.
- **fleet/launch.mjs checkBaseOnDefault** — In fleet/launch.mjs checkBaseOnDefault a non-zero git fetch is not itself a refusal, since a checkout that already holds the tip needs nothing; the refusal is not having the tip afterward, because then no ancestry answer means anything.
- **fleet/launch.mjs checkBaseOnDefault** — git updates refs/remotes/origin/<default> on fetch only when the fetch names a configured remote whose refspec covers the branch. fleet/launch.mjs checkBaseOnDefault therefore points that ref at the fetched tip with update-ref so the launch's one checkout effect does not depend on remote configuration.
- **fleet/launch.mjs readDefaultBranch** — fleet/launch.mjs readDefaultBranch reads the origin's default branch name and tip from one git ls-remote --symref origin HEAD, pins the name to a branch-shaped pattern because it is reused in later git lines, and refuses on anything unreadable; guessing main is exactly what the base check exists to avoid.

## Plan hash pins

- **fleet/plan-pins.mjs verifyPlanPins** — A git hash-object pin in a plan is a fact about the base, which is chosen at launch, so fleet/plan-pins.mjs checks every pin against the tree at --base before the plan is pushed, using only local git reads; a stale pin costs seconds on the laptop instead of a run. Pins are read only on '- Check:' and '- Run:' bullets by their stripped form, in two shapes: test "$(git hash-object <path>)" = <40-hex> and test "$(<command> | git hash-object --stdin)" = <40-hex>, several per &&-chained line.
- **fleet/plan-pins.mjs PATH_PIN / SLICE_PIN** — fleet/plan-pins.mjs PATH_PIN and SLICE_PIN accept only a sha of exactly 40 hex characters, enforced by {40} plus a negative lookahead, so 39- or 41-hex literals are not pins; a pin the launcher cannot read is ignored rather than guessed at.
- **fleet/plan-pins.mjs SLICE_PIN** — fleet/plan-pins.mjs SLICE_PIN forbids its command capture from spanning the two characters `)"`, which close an earlier pin's substitution on an &&-chained line. Without that boundary a path pin chained before a slice pin is read as one slice pin whose command joins both halves, hashes as the empty blob, and refuses a plan whose pins all match; only that boundary is forbidden so quoted or multi-pipe commands still match.
- **fleet/plan-pins.mjs slicePinSha** — fleet/plan-pins.mjs slicePinSha runs a slice pin's command with /bin/sh -c in the extracted base tree and hashes its stdout with git hash-object --stdin. The shell call bypasses the injected exec seam because it is the plan's own command, not a lobby verb or git read, and must really run for its sha to mean anything.
- **fleet/plan-pins.mjs verifyPlanPins** — fleet/plan-pins.mjs verifyPlanPins reports every stale pin as its own refusal line so the operator fixes all in one pass, and treats a path absent at --base as stale, not skipped. It reads a path pin's real blob as git rev-parse <base>:<path>, which equals git hash-object in a checkout only while no clean filter is configured; slice pins get a throwaway checkout removed in a finally.

## Fleet engine pin

- **fleet/launch.mjs defaultEngineSha** — Without --engine, fleet/launch.mjs defaultEngineSha uses git ls-remote on the public ultrapowers repository's HEAD. The sandbox clones the engine from GitHub at engine=, so only shas GitHub already has can work; a local HEAD may be unfetchable.
- **fleet/launch.mjs launchBody / fetchCompilerAt** — fleet/launch.mjs settles the engine sha first (--engine, else the main tip) and fetches the plan compiler at that sha, because that is the copy the sandbox's preflight runs; the plan must compile against it on the laptop or nothing launches, so a bad sha costs seconds rather than VM time. engineSource records whether the operator pinned the engine or the launcher took the tip.
- **fleet/launch.mjs engineLine** — fleet/launch.mjs engineLine annotates the engine only when the launcher took the main tip, so the tip never passes for an operator's choice (#636); a pinned sha needs no annotation. The annotation is a rendered launch line, never part of the assignment comment, whose text is pinned byte for byte and must not carry prose around the sha.

## Fleet test rig

- **fleet/tests/_boot_helpers.mjs** — Shared fleet test rigs such as fleet/tests/_boot_helpers.mjs are underscore-prefixed so tests/test_fleet_suite.py's test_*.mjs glob does not run them as tests. fleet/tests/test_sims_are_hermetic.mjs forbids one sim importing another, so code shared by test_factory_boot.mjs and test_factory_publish.mjs lives in a rig module behind bootRig({plan, stubs}), and every spawned process gets env from simEnv, never process.env.
- **buildEngineDir** — buildEngineDir in fleet/tests/_boot_helpers.mjs builds the fake engine's factory/ as a real directory of symlinks to the real files plus its own empty node_modules, so factory/boot.sh's engine_deps returns without running npm and nothing is written into the checkout's own factory/.
- **makeProxyServer** — fleet/tests/_boot_helpers.mjs runs an always-200 HTTP stand-in for the reflection/oauth-usage proxy in the test process so factory/preflight.mjs never needs the network; because that server shares the test's event loop, every boot is spawned and awaited, never spawnSync'd, or preflight's fetch would never complete.

## Fleet vm sizing

- **fleet/launch.mjs isMemorySize** — The lobby's --memory takes <int>GB verbatim, but lobby parseMemoryGb also accepts forms like '16 G' that would put a space inside the new line. fleet/launch.mjs isMemorySize therefore pins --memory and the config's memory to ^[1-9][0-9]*GB$ before the number is read.
- **fleet/launch.mjs vmSizeFor** — fleet/launch.mjs vmSizeFor sizes a run's VM from the plan's width W (most tasks ready at once), clamped by the fleet ceiling: cpu = min(cap, 2 + ceil(W/3)) and memory = min(cap, 2 + W) GB, because the engine and publish need a fixed floor and each extra implementer costs about 1 GB and a third of a core (RUNBOOK Capacity). For a stories-v1 plan each builder's checker runs Chromium at 0.7-1 GB per page (#1087), so memory becomes max(6, ceil(2 + 1.25 W)) GB. The ceiling is what a run may ask for, never the size every run gets; values are spelled as the lobby takes them verbatim.
- **fleet/launch.mjs refuseUnlaunchable** — exe.dev allocation is over-committable and refuses nothing by sum, so fleet/launch.mjs refuseUnlaunchable checks only that one run's cpu and memory fit the billing plan's maxima, never a sum over live VMs; contention bounds concurrency and concurrent plans are by design.

## Github integration per target

- **fleet/target.mjs** — Each target repository gets exactly one exe.dev integration, gh-<owner>-<repo>, created with --act-as-user and attached to tag:fleet; the launcher's --tag fleet is the grant (exe.dev's policy model was rolled back; there is no policy verb). There is no read-only twin or write grant because exe.dev's GitHub edge routes by repo path, serves a cached installation token for 30-60 s after an edit (a PR opened 20 s after a swap was bot-authored), and has no tie-break for two integrations naming one repo on one VM (measured 2026-09-03). Creation is idempotent, and gc only reports, since a repo private to another account looks identical to a deleted one.
- **addCommand (fleet/target.mjs)** — addCommand in fleet/target.mjs creates the target's integration with --attach tag:fleet in the same `integrations add` call, so a fresh object never needs a second write (which would hit exe.dev's cached-token window), and never passes --readonly.
- **gc (fleet/target.mjs)** — gc in fleet/target.mjs takes each integration's repository from the listing's `repository` field because gh-<owner>-<repo> cannot be reversed: the slash became a hyphen and hyphens are legal in both owner and repo.

## Launch checkout hygiene

- **fleet/launch.mjs SHALLOW_FIX** — fleet/launch.mjs refuses a shallow launch checkout and tells the operator to unshallow it by hand (SHALLOW_FIX); the operator's clone is theirs and a launch never rewrites it.
- **fleet/launch.mjs checkCheckout** — fleet/launch.mjs checkCheckout refuses a shallow checkout before reading the origin, because truncated history makes any merge-base answer about --base meaningless; the launcher never deepens the operator's clone.
- **fleet/plan-pins.mjs basePinCheckout** — fleet/plan-pins.mjs basePinCheckout materialises the tree at --base in a throwaway directory with read-tree and checkout-index --prefix against a temporary GIT_INDEX_FILE, so the operator's index, HEAD and working tree are never read or written and a launch verifying slice pins leaves the checkout exactly as one verifying none.

## Exe dev integrations

- **fleet/launch.mjs NEW_INTEGRATION_FLAG** — exe.dev refuses the --integration flag on the new verb (since 2026-09-11); a fleet VM receives its credentials (claude-max and the target's GitHub object) through each integration's attachment tag:fleet, so --tag fleet is the grant. fleet/launch.mjs guards with NEW_INTEGRATION_FLAG and refuses a new line carrying --integration before issuing it.
- **fleet/launch.mjs launchBody remoteFor** — The run's credentials (claude-max and the target's GitHub object) reach the VM through the attachment tag:fleet each integration carries, so fleet/launch.mjs remoteFor passes --tag fleet and never --integration, which exe.dev refuses since 2026-09-11; the guard refuses before the verb rather than after the lobby does.

## Fleet boot sims

- **fleet/tests/test_factory_boot.mjs / _boot_helpers.mjs runBootAsync** — The boot sims (fleet/tests/test_factory_boot.mjs on the rig in _boot_helpers.mjs) serve the Anthropic usage endpoint from an in-process HTTP stub. A boot run with spawnSync blocks the event loop that stub runs on, so preflight's fetch hangs and classifies `inconclusive`; every boot is therefore spawned asynchronously (runBootAsync) while fixture git calls may stay synchronous. Every spawned process gets its environment from simEnv, never process.env.
- **fleet/tests/test_factory_boot.mjs leg (a3)** — The sim PATH includes node's own directory, which on some machines also holds a real `claude`. To simulate a missing claude, the boot sims shadow it with a stub that exits 127 rather than deleting the stub, otherwise the boot would find and run the real installed release.

## Fleet launch order

- **fleet/launch.mjs** — fleet/launch.mjs is the whole laptop client for a run; its order (validate, read, refresh the credential, push the plan to the evidence repository, then exactly one mutating lobby verb, new) and every literal are defined in fleet/CONTRACT.md, not restated in code. A refusal exits 2 before anything is created; a failure after that exits 1 and prints the lobby's own words.
- **fleet/launch.mjs launchBody / compilePlanForRun** — fleet/launch.mjs parses the plan exactly once, before the new verb, and every downstream decision (VM size, refusals) reads that one parse. plan_parse.py output does not depend on the run number; the stamp is only a label, so a run number bumped by a push race needs no reparse.

## Fleet usage guard

- **fleet/launch.mjs USAGE_REFUSE_PCT** — fleet/launch.mjs refuses a launch, before anything is pushed, when the account is at or past USAGE_REFUSE_PCT (95%) of either its five-hour or seven-day window (#1114). The reading still owed is how often a refused launch would have merged.
- **fleet/launch.mjs defaultReadUsage** — The sandbox cannot read account usage because the exe.dev proxy answers GET /api/oauth/usage with 403, so fleet/launch.mjs defaultReadUsage reads it on the laptop with claude-token.mjs usage --no-rotate right after the credential refresh, which never mints a token. An offline laptop or a keychain without an accessToken answers unread and the launch proceeds.

## Launch plan commit

- **fleet/launch.mjs VERDICTS_FILE** — When a plan has a sibling .gate-verdicts.json, fleet/launch.mjs commits it as gate-verdicts.json beside plan.md in the run folder. No engine reads it; skills/ultrawrite/scripts/authoring_census.py --fetch reads it off the run's tag.
- **fleet/launch.mjs commitPlan** — fleet/launch.mjs commitPlan builds a parentless commit whose tree is only runs/<slug>/<N>/plan.md (plus gate-verdicts.json when present), using plumbing against a temporary empty index in the target clone's object store. Nothing of the base tree enters it because the evidence repository holds no copy of the product, and the operator's index and working tree are never touched, so a dirty checkout is safe. A local git failure is still a refusal since nothing remote has changed yet.

## Run number reservation

- **fleet/launch.mjs launchBody / highestRunInEvidence** — fleet/launch.mjs proposes run number N as one past the highest the evidence repository holds for the target, but another launch can take N between the read and the push; the push is where N is settled.
- **fleet/launch.mjs pushPlan** — Two launches on one target can read the same highest run number, so fleet/launch.mjs pushPlan reserves N by pushing the plan commit to the evidence repository. On a refused push it re-reads highestRunInEvidence (live branches and tags): if a ref for N appeared it was a race, so it builds a fresh plan commit for the next N (the subject carries the number) and retries; otherwise the refusal is the repository's own (hook or credential) and is reported at once. Git's rejection wording is never parsed, and at most PUSH_ATTEMPTS (3) pushes are made.

## Builder no git

- **factory/flock/nogit** — Models never run git: the Flock puts factory/flock/nogit first on every builder session's PATH, so a git reached from inside a script (e.g. a python subprocess) is refused as surely as one typed at the prompt, which no reading of the Bash command line could catch. The engine's PreToolUse hook additionally denies a git named by absolute path, which the PATH shim cannot see; fleet/tests/test_factory_nogit.mjs proves both.

## Evidence repository

- **fleet/launch.mjs launchBody** — A run's record lives in the operator's evidence repository, taken from --evidence-repo or the evidence setting in ~/.ultrapowers/fleet.json (#1395). fleet/launch.mjs never derives it from the target and refuses a launch that names neither, before anything is read.

## Fleet sim rig

- **test_factory_publish withShortBudget** — In fleet/tests/test_factory_publish.mjs the engine directory is built from symlinks; factory/publish.mjs reads the policy.json beside its own resolved path and node resolves a symlinked main to the checkout's copy. To give a run a patched policy.json the sim must replace both policy.json and publish.mjs with real files, while publish.mjs's relative imports still resolve through the engine's symlinks.

## Fleet test sims

- **fleet/tests/test_factory_preflight.mjs runAsync** — A fleet sim that answers its child from an in-process node:http stub (fleet/tests/test_factory_preflight.mjs runAsync) must run the child with async spawn and await close; spawnSync blocks the event loop the stub server runs on, so the child would never get an answer.

## Fleet token rotation

- **fleet/launch.mjs defaultRefreshCredential** — The Claude Max access token lives at the exe.dev edge and expires within hours while the laptop holds the refresh token. Before creating a VM, fleet/launch.mjs defaultRefreshCredential calls claude-token.mjs refresh for the run's account, which rotates within four hours of expiry but holds when a fleet VM is listed, since a refresh revokes the token every live run uses. A missing keychain record is a refusal, never a skip, because a misnamed account or an unrefreshed bearer parks every run at the boot's bearer probe.

## Fleet vm naming

- **fleet/launch.mjs NEW_ATTEMPTS** — fleet/launch.mjs issues the exe.dev new verb up to NEW_ATTEMPTS (3) times with a 1-3 s jittered sleep between. exe.dev does not reserve names, but a VM name is one incarnation while the run number is the identity, so every attempt mints a fresh fleet-r<N>-<time>-<hex> name.

## Flock objection

- **factory/flock/engine.mjs objection** — A builder that finds its task cannot be done as the plan is written files an objection: the task parks for the operator (one objection row, one task:parked row marked objected, no give-backs) and the run ends a draft whose reason, in the builder's words, the pull-request body carries. This replaced handing the task round by give-backs after the wrong-plans reading of flock-baseline run-32 (2026-11-13); fleet/tests/test_flock_objection.mjs guards it.

## Flock pulls

- **factory/flock/engine.mjs pulls (narrow scope)** — Under the narrow pull policy, a builder still receives every change into its copy; a change outside its scope arrives as a pull row marked quiet rather than being held back, because on flock-baseline run-10 (2026-11-13) a probe reading a file through an import had no derived edge and, with changes held back, its task was given back until it parked. When two tasks insert at one spot of a file, each task reopened red is told of the spot via a board note naming both insertions. fleet/tests/test_flock_pulls.mjs guards both.

## Flock scope rule

- **factory/flock/scope.mjs** — A Flock run never settles green on a change nobody planned or wrote: factory/flock/scope.mjs records a scope:outside row and drafts the run when a file changes with no builder edit, as happened with run-247's weave fault. A Delete: path in a task is the task's own and raises no amendment. fleet/tests/test_flock_scope.mjs reproduces this with an @unwritten seam.

## Gate jev replay probe

- **fleet/tests/gate_jev_replay_probe.mjs** — fleet/tests/gate_jev_replay_probe.mjs is a hand-run live probe that replays every labelled gate disagreement and agreed fail in the operator's untracked plans through the live Jev, rebuilding each diet with extract_gate_input.py and skipping rounds whose hash moved. It exits 0 when both known-bad controls read fail by majority, no agreed fail now passes and at least two thirds of the wrong fails now pass; 2 when there is no key or nothing replayable; 1 otherwise. It spends reps x (rounds + 2) calls.

## Intent tray

- **hooks/register.js** — hooks/register.js, the intent tray mod, runs inside Claude Code, so fleet/tests/test_intent_tray.mjs drives it under Node through a stand-in $ that offers only the calls the tray may make and refuses what the hooks API types refuse (plugin-authoring types/claude-code.d.ts, Claude Code 2.1.286): unknown nouns, Button hotkeys other than one digit or lowercase letter, and values $.store cannot keep as JSON. Each fresh module import is one session; sessions sharing a store Map share the plugin's one store file.

## Launch arguments

- **fleet/launch.mjs validateArgs** — fleet/launch.mjs validateArgs refuses any --hold=<value> spelling before reading the plan: the sandbox accepts only hold=1, and a launch meant to hold must never silently become one that merges.

## Launch duplicate detection

- **fleet/launch.mjs duplicate-launch refusal (--again)** — On 2026-09-15 the same plan was launched twice within a minute on one target and the first run died; the two launches had different plan= commits but one plan blob. fleet/launch.mjs therefore identifies "the same plan" by the plan text's git blob sha, never the VM comment's commit sha, refuses a launch whose plan is live on the target (naming the run and VM), and requires --again to proceed. The check runs on the laptop before any sandbox exists, so fleet/tests/test_launch_duplicate.mjs is the only alarm for that race (zero catches over 29 runs, #1264, 2026-09-24).

## Launch plan path

- **fleet/launch.mjs launch** — fleet/launch.mjs resolves the plan path once with `path.resolve(repoDir, planPath)` and uses the absolute path downstream, because its python3 children run with `cwd: repoDir`; on 2026-09-21 a relative path read against the process cwd died with ENOENT. An absolute path is read as given, and a missing plan is refused naming the absolute path tried. A sibling `<stem>.gate-verdicts.json` rides the plan commit as `runs/<slug>/<N>/gate-verdicts.json` because the laptop's authoring census reads it off the run's tag (run-268 dropped it).

## Launch preflight refusals

- **fleet/launch.mjs refuseUnlaunchable / toolchainViolations** — A probe or check whose command word the sandbox lacks would exit 127 in its first second on the VM, after the push and the new verb. fleet/launch.mjs refuseUnlaunchable checks every word against SANDBOX_TOOLCHAIN (toolchainViolations) first and refuses by name (#645).

## Plan grammar detection

- **fleet/launch.mjs planGrammar** — planGrammar in fleet/launch.mjs reads the plan header's own **Grammar:** line, not any occurrence in the body, so a claims-v1 plan that quotes a stories-v1 header inside a fenced example is not treated as stories-v1; fleet/tests/test_launch_stories_grammar.mjs guards it.

## Publish preflight

- **fleet/launch.mjs refuseUnlaunchable / assetsConfigAtBase** — exe.dev's edge replaces the Authorization header, so wrangler's asset-upload JWT is refused 401 (#1312) and a publishing plan whose wrangler.jsonc at --base declares assets could only die in publish:deploy after every task merged. fleet/launch.mjs refuseUnlaunchable refuses such a plan before sizing, credential and push (#1313). The TinyApp template packs its page into the Worker and declares no assets; the guard stays for other targets while the edge replaces the header.

## Sandbox toolchain

- **fleet/toolchain.mjs SANDBOX_TOOLCHAIN** — fleet/toolchain.mjs `SANDBOX_TOOLCHAIN` lists what a fresh sandbox can run by name: the exeuntu image's tools plus exactly what fleet/setup-script.mjs installs (node/npm/npx, bun/bunx, celld, pytest). Because a probe or Check runs under `timeout <s> bash -lc <line>` on the box, a missing command would exit 127 only after the plan is pushed and a VM created, so `toolchainViolations` refuses it on the laptop, by command name and never by language (operator's choice, 2026-09-05). A new word is added here beside the setup-script step that installs it.
