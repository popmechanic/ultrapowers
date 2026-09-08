# compile_plan --base accepts a sha

**Grammar:** claims-v1

**Claim:** `--base` accepts a 40-hex sha as well as a directory; on a sha the compiler reads the tree with `git show <sha>:<path>` / `git ls-tree` for every BASE-fact it computes, so a plan can be checked against the exact commit `launch.mjs --base` will use. (quoted from #725)

**Goal:** #725 — a plan authored for a re-drive on a parked branch is checked today against
the plan's own working directory (main), where the parked branch's files do not exist, so
its `Consumes:` lines and Stale-if predicates draw false `referent` advisories; `--base`
wants a directory, so the author builds a `git worktree` by hand. After this run
`compile_plan.py --check --renders --base <sha>` and `pin_base_facts.py --base <sha>` read
the tree at that commit through git in the plan's own repository, a sha that is not present
locally is refused with one error line, and a directory `--base` prints exactly what it
prints at BASE — the diagnostic vocabulary is frozen and this is an input mode.
**Closes:** #725

**Tech Stack:** Python 3 (`skills/ultrapowers/scripts/compile_plan.py`, the compiler, and
`skills/ultrawrite/scripts/pin_base_facts.py`, which imports the compiler's `_git`,
`default_base`, `_path_referent` and `_referent_scan_lines` rather than re-implementing
them); git as the tree reader (`git -C <repo> ls-tree -r --name-only <sha>`,
`git -C <repo> show <sha>:<path>`, `git -C <repo> grep … <sha> -- <pathspecs>`,
`git -C <repo> rev-parse --verify --quiet <sha>^{commit}`); pytest from the repo root
(`python3 -m pytest`, `pytest.ini` scopes it to `tests/`), every fixture repository built
by the test itself under `tmp_path` with `git init` and commits, nothing on the network.

**Parallelization rationale:** wave 1 is one task, width 1. The change is one reader
(`BaseTree`) that every tree read in the compiler goes through, the two-line resolution
change in `pin_base_facts.py` that imports it, the pre-#725 pins in
`tests/test_compile_plan_base_message.py` that the new behaviour replaces, and the
SKILL sentence that teaches the flag. `pin_base_facts.py` consumes the reader's runtime
behaviour (what `git show`/`ls-tree` return for a sha), so a second task would be a chain
of one behind the first, buying a wait and no width; and the pin file and the reader are
one seam — a tree where the reader accepts a sha and the pin still asserts the old
"wants a checkout directory" line is red by construction.

## Authoring notes

Choices taken in the operator's stead, each the `(Recommended)` option ultrawrite would have
offered: one task (the seam is one reader and its one consumer); `**Review:** lean` — the
exam is mechanical and every failure is a red pytest line, so a wave-0 peer exam would buy
its clock cost and little sight; a sha `--base` is resolved against the plan's own
repository (`default_base(plan_path)`) and a sha that is not a commit there, or a plan
outside any checkout, is an input error refused before the verdict (exit non-zero, one
`error:` line on stderr), the way `--base requires --renders` already is — not an
`ADVISORY` line, since the frozen advisory tail never changes the exit code and an absent
commit is not something to render over; the `--help` entry keeps the `<checkout-dir>`
token beside the new `<sha>` form, so #637's leg (a) stays true; #637's leg (c) tests (the
`wants a checkout directory, got a commit sha` line for two non-commit shas) are deleted
with their docstring paragraph because the line they pin no longer exists, and legs (a)
and (b) of that file stay; the new exam is one file named for its surface,
`tests/test_compile_plan_base_tree.py` (what `--base` reads, sha or directory), extended
later by any task on that surface; execution recommendation: Ultrapowers (risk override —
the compiler's advisory tail is the frozen periphery, and the corpus byte-pins are the only
thing that shows a printed line moved), T=1, width 1.

`git grep -n -e '--base'` at BASE across `skills/`, `tests/`, `fleet/`, `README.md` and
`docs/`: the compiler (`compile_plan.py` 2010–2014, 2602–2608, 3826–3859), the pin script
(`pin_base_facts.py` 4, 83, 356–377), `tests/test_check_renders.py` (directory `--base`
throughout — unchanged behaviour, not in Files), `tests/test_compile_plan_base_message.py`
(#637's pins), `skills/ultrawrite/SKILL.md` (the proof-gate compile line at 231 carries no
`--base` today; this task adds it), and — other flags of the same name, untouched —
`fleet/launch.mjs`'s `--base <sha>` in `fleet/RUNBOOK.md`, `fleet/CONTRACT.md` and
`skills/ultrapowers/SKILL.md`, `fold_wave.py`'s `--base`, `run_acceptance.sh`'s
`--base REF`, `ultra_gate.py`, and `skills/ultradocket/SKILL.md`'s `run_acceptance.sh`
line.

## Global Constraints

- The diagnostic vocabulary is frozen (CLAUDE.md §Conventions): no `ADVISORY` sentence,
  refusal species, `PLAN OK` / `N violation(s)` verdict or exit code that a directory
  `--base` or a bare `--check` produces at BASE changes by one byte, and the sha mode adds no
  new `ADVISORY` sentence — a sha is an input, and every line it prints is a line a
  directory could have printed.
- Check: git diff --quiet $ULTRA_BASE -- evals/fixtures tests/fixtures skills/ultrapowers/scripts/gate_check.py skills/ultrapowers/scripts/ultra_gate.py skills/ultrapowers/scripts/run_acceptance.sh tests/test_compile_plan_proof_runs.py tests/test_check_renders.py
- Every git read of the base tree in `compile_plan.py` and `pin_base_facts.py` runs as
  `git -C <repo>` in the plan's own repository, through one reader; no code path opens a
  file under `--base` with `open()`/`read_text()` when `--base` is a sha, and
  `pin_base_facts.py` imports that reader from the compiler rather than re-implementing a
  git call.
- Check: python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrawrite

**Acceptance:** suite — the committed suite is the verification.

### Task 1: One reader for the tree at BASE, a directory or a sha

**Type:** implementation

**Files:**
- Modify: `skills/ultrapowers/scripts/compile_plan.py`
- Modify: `skills/ultrawrite/scripts/pin_base_facts.py`
- Modify: `skills/ultrawrite/SKILL.md`
- Test: `tests/test_compile_plan_base_tree.py`
- Test: `tests/test_compile_plan_base_message.py`
- Test: `tests/test_pin_base_facts.py`

**Claim:** `--base` accepts a 40-hex sha as well as a directory; on a sha the compiler reads the tree with `git show <sha>:<path>` / `git ls-tree` for every BASE-fact it computes, so a plan can be checked against the exact commit `launch.mjs --base` will use. (quoted from #725)
Machine: M1. `compile_plan.py --check --renders --base <sha>`, where `<sha>` is a 40-hex commit of the plan's own repository, prints no `ADVISORY referent:` line for a path a task body names that exists in the tree at that sha, and `--check --renders --base <dir>` on the same plan, where `<dir>` is a checkout whose tree lacks that path, prints the `ADVISORY referent:` line naming it.
M2. With a directory `--base` the compiler prints what it printed at BASE: the five canonical fixtures `wide`, `chained`, `mixed`, `degrade` and `contend` each print exactly `PLAN OK` and nothing else under `--check --renders --base evals/fixtures/<name>/project` on `evals/fixtures/<name>/plan.md`; every Run-less fixture plan's bare `--check` stdout, stderr and exit code still equal the frozen compiler blob at `0a3559a`'s; and a directory that is not a git checkout still draws the `is not a git checkout` skip line.
M3. A 40-hex `--base` that names no commit of the plan's repository, and a 40-hex `--base` given for a plan that lies outside any git checkout, each exit non-zero with empty stdout — no verdict line at all — and one stderr line beginning `error:` that contains the sha; none of the four runs the exam makes on the sha fixture (the two of M1 and these two) prints a line containing `wants a checkout directory`; the `--help` entry for `--base` contains both `<checkout-dir>` and `<sha>`.
M4. Under `--base <sha>` each of the compiler's other tree reads reads the tree at the sha: (i) the Produces blast-radius render lists a code file that mentions a task's `Produces:` symbol only in the tree at the sha, and does not list it under `--base <dir>` of a checkout lacking that file; (ii) the `pinned-elsewhere` species draws its line for a Machine-clause span pinned by a test file that exists only at the sha, and draws none under that `--base <dir>`; (iii) the `base-sha-in-suite` species draws its line for a `Test:` file that exists only in the tree at the sha and freezes the 40-hex sha of an earlier commit of the repository, and draws none under that `--base <dir>`.
M5. On a plain compile, `--base <sha>` classifies a claims-v1 same-file pair by the tree at the sha: a shared path committed as a symlink at the sha puts the two tasks in two waves, and `--base <dir>` of a checkout holding that path as a plain text file puts them in one wave.
M6. `pin_base_facts.py --base <sha>` on a two-task plan prints two blocks, each headed `(generated at <the sha's first seven characters>)` and neither headed with the checkout's HEAD, from the tree at the sha — a path present only at the sha pins its blob — and `--verify --base <sha>` on the `--write` output exits 0; `--base <dir>` still passes every print, `--write` and `--verify` leg of `tests/test_pin_base_facts.py`; a 40-hex `--base` naming no commit of the plan's repository exits non-zero with one stderr line beginning `error:` that contains the sha.
M7. `skills/ultrawrite/SKILL.md` §The proof gate carries the compile line as `compile_plan.py --check --renders --base <checkout-dir|sha> <plan.md>` and, in the same section, the sentence that `--base` takes a checkout directory or a 40-hex sha and that a sha must be present locally.

**Authorized-by:** #725; CLAUDE.md §Conventions (the verification periphery is frozen — the diagnostic vocabulary changes only for an eval-measured regression; an input mode is not a vocabulary change)

**Interfaces:**
- Consumes: nothing
- Produces: `BaseTree`

**Context:** The tree reads at BASE, each of which is today a `git -C <dir>` call or an
`open()` on the directory, and each of which this task routes through the one reader:
`_git(base, *args)` at `compile_plan.py:2528` (returns `''` on any failure — so a presence
probe must be `rev-parse --verify --quiet <sha>^{commit}`, whose stdout is the peeled sha on
a hit, exactly as `_resolves_as_commit` at line 3708 already does; `cat-file -e` is silent
both ways); `_git_tracked` (`ls-files`, 2543), `_git_word_files` (`grep -l -w -F`, 2553),
`_git_literal_in_code` (2560), `_git_substring_files` (`grep -l -F -e`, 2566);
`is_binary(tree_root, rel_path)` at 2190 (`is_symlink()` plus a NUL sniff of the first
`_BINARY_SNIFF_BYTES` bytes via `open()`), reached from `claims_grammar_advisories` at 2020
and from `build_edges` at 2419, which the plain compile calls with `tree_root=args.base` at
4051; `render_advisories` at 2585, whose sha branch at 2604–2609 prints the #637 skip line
this task deletes; `_render_base_sha_in_suite` at 3755, which reads a `Test:` file with
`(base / path).read_text(errors="replace")` at 3767; and in `pin_base_facts.py`
`base_sha(base)` at line 83 (`rev-parse HEAD`), while `blob_sha`, `file_line` and
`symbol_site` there already read by sha (`ls-tree <sha> -- <path>`, `show <sha>:<path>`,
`grep -n -E <pattern> <sha> -- <pathspecs>`) and need only the pair `(repo, sha)` resolved
from the flag. `_species_wide_files` (3468) reads no tree — it counts Files entries — and
`_report_field_vocab` reads the plugin's own `report-format.md`, not BASE; neither changes.

The reader's shape, one literal every edit agrees with: `BaseTree` is a small class in
`compile_plan.py` with `repo: Path` (the git toplevel `git -C` runs in), `rev: str`
(`"HEAD"` for a directory `--base`, the sha itself for a sha `--base`) and the methods
`tracked(exclude) -> set[str]`, `word_files(word, exclude) -> list[str]`,
`literal_in_code(literal, exclude) -> bool`, `substring_files(literal, exclude) -> list[str]`,
`read_text(path) -> str | None`, `is_binary(path) -> bool`, `resolves_as_commit(sha) -> bool`,
and a constructor `BaseTree.from_flag(value, plan_path)` that returns the reader for a
`--base` value — a directory (a checkout: `repo` is its toplevel, `rev` is `HEAD`) or a
40-hex sha (`repo` is `default_base(plan_path)`, `rev` is the sha) — and raises `SystemExit`
with the `error:` line of M3 when the sha is not a commit of that repository or the plan
lies outside any checkout. `ctx["base"]` becomes the reader; `default_base` and `_git`
keep their names and signatures because `pin_base_facts.py` imports them. In git terms:
`git ls-tree -r --name-only <rev> -- . <exclude pathspecs>` is the tracked set (for `HEAD`
it equals `ls-files` on a clean checkout, and the canonical fixtures are committed trees, so
M2 holds either way — but keep `ls-files` for the directory case so an uncommitted file in
an author's checkout still resolves, as it does today); `git grep -l … <rev> -- <pathspecs>`
prints each hit as `<rev>:<path>` when a tree-ish is given, so the reader strips that
prefix; `git show <rev>:<path>` is `read_text`; `git ls-tree <rev> -- <path>` with mode
`120000` is a symlink, and the NUL sniff reads the first 8 KB of `git show <rev>:<path>`
as bytes; a path absent at the rev is `None`/`False`, the fold-preserving direction
`is_binary` already takes. The `:(exclude)` pathspecs `_exclude_pathspecs` builds work
unchanged after a tree-ish.

The frozen surfaces: leg (e) of `tests/test_compile_plan_proof_runs.py` compares every
Run-less fixture plan's bare `--check` stdout, stderr and exit code to the compiler blob at
`0a3559a2e0c9998553c0c725e5510e20e5802b1b` — the `ADVISORY grammar: same-file pair not
classifiable without a tree … pass --base so the compiler can tell …` sentence at
`compile_plan.py:2010–2014` is one of those bytes and stays as it is. `tests/test_check_renders.py`
pins the directory forms (`is not a git checkout`, `no git checkout found for … (pass
--base)`, `--base requires --renders`) and is not in Files: it must keep passing untouched.
`tests/test_compile_plan_base_message.py` pins #637: leg (a) reads `<checkout-dir>` off the
`--help` entry (keep that token; add `<sha>`), leg (b) pins the frozen same-file sentence
(untouched), and leg (c) — `test_the_two_leg_c_values_really_are_forty_hex`,
`test_a_forty_hex_base_says_it_wants_a_checkout_directory` and
`test_a_forty_hex_base_prints_no_is_not_a_git_checkout_line`, with the `SHA_SKIP` constant
and the M3 paragraph of the module docstring — pins the line this task deletes; those go,
and the docstring says why (#725). Its `_check` helper asserts `PLAN OK` and exit 0 first,
so the M3 error path is exercised in the new file, not there. `tests/test_pin_base_facts.py`
already builds throwaway repositories (`new_repo`, `commit`, `git`, `sha7`, `base7`) and its
new legs sit under a comment naming this task. Legs (a) and (c)–(f) are `--check --renders`
runs, since only that tail prints the renders; leg (g) is the plain compile. The new exam file builds its fixture the
same way: one `git init` repository under `tmp_path`, a commit carrying the sha-only file
(`git rev-parse HEAD` is the sha), then a second commit that deletes it, so the working
directory of that same repository is the "directory lacking the file" and no clone is
needed; a plan written inside that repository has `default_base` equal to it. The
non-commit sha for M3 is `0000000000000000000000000000000000000000`. For M4 (iii) a
commit's tree cannot contain its own sha, so that fixture is three commits: the sha-only
`Test:` file lands in the second and freezes the first commit's sha; the third deletes it.
**BASE facts:** (generated at 1c83b61)
- `tests/test_pin_base_facts.py` blob 4964a09
- `skills/ultrawrite/SKILL.md` blob dfa2fe9
- `_resolves_as_commit` at `skills/ultrapowers/scripts/compile_plan.py:3708` blob 61e8140
- `_git_tracked` at `skills/ultrapowers/scripts/compile_plan.py:2543` blob 61e8140
- `_git_word_files` at `skills/ultrapowers/scripts/compile_plan.py:2553` blob 61e8140
- `_git_literal_in_code` at `skills/ultrapowers/scripts/compile_plan.py:2560` blob 61e8140
- `_git_substring_files` at `skills/ultrapowers/scripts/compile_plan.py:2566` blob 61e8140
- `claims_grammar_advisories` at `skills/ultrapowers/scripts/compile_plan.py:1914` blob 61e8140
- `build_edges` at `skills/ultrapowers/scripts/compile_plan.py:2206` blob 61e8140
- `render_advisories` at `skills/ultrapowers/scripts/compile_plan.py:2584` blob 61e8140
- `_render_base_sha_in_suite` at `skills/ultrapowers/scripts/compile_plan.py:3755` blob 61e8140
- `blob_sha` at `skills/ultrawrite/scripts/pin_base_facts.py:87` blob c39e869
- `file_line` at `skills/ultrawrite/scripts/pin_base_facts.py:97` blob c39e869
- `symbol_site` at `skills/ultrawrite/scripts/pin_base_facts.py:109` blob c39e869
- `_species_wide_files` at `skills/ultrapowers/scripts/compile_plan.py:3468` blob 61e8140
- `_report_field_vocab` at `skills/ultrapowers/scripts/compile_plan.py:2733` blob 61e8140
- `repo` at `fleet/tests/test_exam_edited_patches.mjs:45` blob 628c82c
- `rev` at `fleet/tests/test_run_waves.mjs:171` blob 963d7e9
- `HEAD` at `fleet/tests/test_retire.mjs:138` blob b372ccc
- `default_base` at `skills/ultrapowers/scripts/compile_plan.py:2578` blob 61e8140
- `_git` at `evals/ab_lib.py:120` blob 82dda3c
- `is_binary` at `skills/ultrapowers/kernel/repo_weave.py:158` blob c9856c0
- `_exclude_pathspecs` at `skills/ultrapowers/scripts/compile_plan.py:2539` blob 61e8140
- `tests/test_compile_plan_proof_runs.py` blob ce4a5ae
- `tests/test_check_renders.py` blob 0c9186b
- `tests/test_compile_plan_base_message.py` blob a8f0166
- `test_the_two_leg_c_values_really_are_forty_hex` at `tests/test_compile_plan_base_message.py:305` blob a8f0166
- `test_a_forty_hex_base_says_it_wants_a_checkout_directory` at `tests/test_compile_plan_base_message.py:313` blob a8f0166
- `test_a_forty_hex_base_prints_no_is_not_a_git_checkout_line` at `tests/test_compile_plan_base_message.py:324` blob a8f0166
- `_check` at `tests/test_compile_plan_base_message.py:177` blob a8f0166
- `new_repo` at `tests/test_pin_base_facts.py:64` blob 4964a09
- `commit` at `fleet/janitor.mjs:212` blob c8d8258
- `git` at `fleet/lobby.mjs:271` blob 62d348b
- `sha7` at `tests/test_pin_base_facts.py:75` blob 4964a09
- `base7` at `tests/test_pin_base_facts.py:79` blob 4964a09
- `skills/ultrawrite/scripts/pin_base_facts.py` blob c39e869

**Proof:**
- Test: `tests/test_compile_plan_base_tree.py`
- Test: `tests/test_compile_plan_base_message.py`
- Test: `tests/test_pin_base_facts.py`
- Legs: (a) in a repository whose first commit carries pkg/only.py and whose second commit deletes it, a signed claims-v1 plan inside that repository whose task Context names pkg/only.py prints, under `--check --renders --base <first commit sha>`, no line starting `ADVISORY referent:` that contains pkg/only.py, and under `--check --renders --base <that repository's directory>` exactly one such line [M1]; (b) in `tests/test_compile_plan_base_tree.py`, for each of `wide`, `chained`, `mixed`, `degrade` and `contend`, `--check --renders --base evals/fixtures/<name>/project` on `evals/fixtures/<name>/plan.md` exits 0 with stdout exactly `PLAN OK` plus its newline, and `--check --renders --base <an empty directory under tmp_path>` on a clean plan prints the line `ADVISORY renders skipped: <that directory> is not a git checkout`; and the first Run bullet below re-runs `tests/test_compile_plan_proof_runs.py`, whose `test_every_run_less_fixture_plan_checks_byte_identically_to_base` compares each Run-less fixture plan's bare `--check` stdout, stderr and exit code to the compiler blob `0a3559a2e0c9998553c0c725e5510e20e5802b1b` that its `base_compiler` fixture fetches, and must still pass [M2]; (c) `--check --renders --base 0000000000000000000000000000000000000000` on the first leg's plan exits non-zero with stdout exactly empty, and its stderr holds exactly one line beginning `error:`, containing that sha; the same three assertions for a signed plan written under a `tmp_path` that is no git checkout with `--base <the first commit sha>`; the combined stdout and stderr of those two runs and of the two runs of the first leg contain no line with `wants a checkout directory`; and the `--help` entry for `--base`, dewrapped as `tests/test_compile_plan_base_message.py` dewraps it, contains `<checkout-dir>` and `<sha>` [M3]; (d) with lib/uses_sym.py mentioning `probe_sym` as a whole word only in the first commit and a task whose Interfaces has `Produces: probe_sym(n: int) -> str`, the blast-radius render under `--base <sha>` prints a line naming lib/uses_sym.py, and under `--base <dir>` no line names it [M4]; (e) with tests/test_pin.py carrying the exact span `runner: None` only in the first commit and a task whose Machine clause pins `runner: None`, `--base <sha>` prints one `pinned-elsewhere` line naming tests/test_pin.py and `--base <dir>` prints none [M4]; (f) in a repository of three commits — the first any file, the second adding tests/test_frozen.py whose text contains the first commit's 40-hex sha, the third deleting it — with a task `Test: tests/test_frozen.py`, `--base <second commit sha>` prints one `base-sha-in-suite` line naming tests/test_frozen.py and `--base <that repository's directory>` prints none [M4]; (g) with app/shared committed as a symlink in the first commit and replaced by a plain text file in the second, a two-task signed plan whose tasks both `Modify: app/shared` compiles (no `--check`) under `--base <sha>` to two waves and under `--base <dir>` to one wave [M5]; (h) in `tests/test_pin_base_facts.py`, on a repository whose first commit carries pkg/only.py and whose second deletes it, `pin_base_facts.py --base <first commit sha>` on a two-task plan prints exactly two blocks, both headed `(generated at <first seven characters of that sha>)`, no block headed with the first seven characters of HEAD, the first carrying pkg/only.py with its blob sha, `--write --base <sha>` then `--verify --base <sha>` exits 0, and `--base 0000000000000000000000000000000000000000` exits non-zero with one stderr line beginning `error:` containing that sha [M6]; (i) `python3 -m pytest tests/test_pin_base_facts.py` passes with the pre-existing print, `--write` and `--verify` legs unchanged [M6]; (j) the two Run bullets below scope `skills/ultrawrite/SKILL.md` to its proof-gate section and find the compile line with `--base <checkout-dir|sha>` and the sentence naming both forms and local presence [M7].
- Run: python3 -m pytest -q tests/test_compile_plan_base_tree.py tests/test_compile_plan_base_message.py tests/test_pin_base_facts.py tests/test_compile_plan_proof_runs.py tests/test_check_renders.py
- Run: sed -n '/^## The proof gate/,/^## The worktree-pure contract/p' skills/ultrawrite/SKILL.md | grep -q -e 'compile_plan.py --check --renders --base <checkout-dir|sha> <plan.md>'
- Run: sed -n '/^## The proof gate/,/^## The worktree-pure contract/p' skills/ultrawrite/SKILL.md | tr '\n' ' ' | grep -q -e 'a checkout directory or a 40-hex sha.*present locally'

**Stale-if:**
- issue-closed: #725
- path-absent: `skills/ultrawrite/scripts/pin_base_facts.py`
- path-absent: `tests/test_compile_plan_base_message.py`

