# The skill reads a run's state off the evidence tag

**Grammar:** claims-v1

**Claim:** An operator following the skill to read a finished run's status reads it off the evidence tag and gets the record, not a 404. (elicited)

**Goal:** #710 — since #704 the boot tags a finished run's record as `ultra/evidence/run-<N>`
and deletes the branch `ultra/evidence-run-<N>` in the same step, and `fleet/CONTRACT.md` and
`fleet/RUNBOOK.md` were rewritten to read by tag; `skills/ultrapowers/SKILL.md` §Client step 3
still hands the agent a `gh api … ?ref=ultra/evidence-run-<N>` recipe, so an operator asking how a
finished run went is sent to a ref that is gone. After this run the skill's recipe reads the tag,
the branch is named only for a run in flight, and the docs pin stays green. This run is also the
confidence run for the two suite deletions of #712 — one prose task, nothing under `fleet/`.
**Closes:** #710

**Tech Stack:** Markdown skill documents (`skills/ultrapowers/SKILL.md`,
`skills/ultrapowers/references/first-run.md`); the proof is shell (`grep`, `sed`, `tr`) over those
files plus `python3 -m pytest` on `tests/test_docs_agree_with_code.py`, the structural pin of the
four operator documents. No code moves.

**Parallelization rationale:** wave 1 is one task, width 1. The recipe, the sentence that qualifies
the branch and the pin that keeps the documents on the contract are one edit to one section of one
skill; there is no second contract to run beside it.

## Global Constraints

- Check: `git diff --quiet $ULTRA_BASE -- fleet/ tests/`
- The skill teaches the contract's words, not its own: a run's record is read by tag,
  `?ref=ultra/evidence/run-<N>`, exactly as `fleet/CONTRACT.md` §Literals *The two tags* and
  `fleet/RUNBOOK.md` §Per run *Watch* have it; the branch `ultra/evidence-run-<N>` is a working
  surface that goes at publish, and a sentence that names it says so.
- `skills/ultrapowers/references/first-run.md` gains no `## ` heading: its headings are
  `fleet/doctor.mjs`'s `ROW_IDS` in order, and `tests/test_docs_agree_with_code.py` refuses a
  drift.

**Acceptance:** suite — the committed suite is the verification.

### Task 1: The read-state recipe reads the tag

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `skills/ultrapowers/SKILL.md`
- Modify: `skills/ultrapowers/references/first-run.md`

**Claim:** Every read-state recipe in the two skill documents says `?ref=ultra/evidence/run-<N>` (the tag), with the branch named only as "while the run is in flight". (quoted from #710)
Machine: M1. In `skills/ultrapowers/SKILL.md` and `skills/ultrapowers/references/first-run.md`,
every read of `.ultrapowers/runs/<N>/…` through `gh api …/contents/…` — every occurrence of the
path `contents/.ultrapowers/runs…`, each with the `?ref=` glued to it — carries
`?ref=ultra/evidence/run-<N>` as its ref and nothing else as its ref, so no read names the branch,
a sha, `main`, or no ref, on its own line or beside a tagged one; and the branch's one spelling,
`evidence-run-`, appears in `SKILL.md` on no line inside a fenced code block and on no line that
carries `gh api`, `curl`, `git `, `?ref=` or `githubusercontent` — so a read at the branch
spelled any other way (a shell variable in the path, a raw URL, a `git show <ref>:<path>`) is
absent too; §Client of `SKILL.md` carries that tag recipe, and `first-run.md` — which carries no
read recipe at BASE — names `evidence-run-` nowhere.
M2. Every period-delimited sentence of `skills/ultrapowers/SKILL.md` that names the evidence
branch — as `ultra/evidence-run-<N>` or as the words `evidence branch` — carries the words
`in flight`; at least one sentence of §Client names `ultra/evidence-run-<N>` with that
qualifier; and §Client names the tag `ultra/evidence/run-<N>` in prose as well as in the recipe,
as what a finished run's record is.
M3. `python3 -m pytest -q tests/test_docs_agree_with_code.py` exits 0 on the edited tree.

**Authorized-by:** #710; #704 (the tag record); `fleet/CONTRACT.md` §Literals *The two tags*
(the authority: "The record is read by tag:
`.ultrapowers/runs/<N>/status.json?ref=ultra/evidence/run-<N>`")

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** BASE is `1c2c89e3` (main). What each file says there, by line — `git grep -n
'evidence-run' skills/ultrapowers/SKILL.md skills/ultrapowers/references/first-run.md` finds
exactly two hits, both in SKILL.md:

- `skills/ultrapowers/SKILL.md` (blob `802f5965`), §Client (the section runs from `## Client`,
  line 111, to `## Resources`, line 191): step 3 says at 152 "the same bytes on the VM's status
  page and on the run's evidence branch at every transition", at 154 "read `status.json` off the
  evidence branch — it is there from the first transition and stays after the VM is reaped", and
  at 158 the recipe
  `gh api 'repos/<repo>/contents/.ultrapowers/runs/<N>/status.json?ref=ultra/evidence-run-<N>' --jq .content | base64 -d`;
  step 4 says at 168 "its evidence is `ultra/evidence-run-<N>`, under `.ultrapowers/runs/<N>/`,
  never merged and linked from the PR body" and at 179 "A parked run with nothing to publish opens
  no PR; its evidence branch is still pushed." Those four sentences are the four the sentence
  sweep in the Proof lists at BASE; each is either rewritten to name the tag or kept with the
  in-flight qualifier in the same period-delimited sentence — the sweep splits on `. ` after
  joining lines, so a qualifier in the next sentence does not count.
- `skills/ultrapowers/references/first-run.md` (blob `0897044d`) carries no read recipe and no
  `evidence-run-` at all; its one mention of state is line 38, the VM's own page
  `https://<vm>.exe.xyz/status.json`. It is in Files because the operator's sentence names it; it
  needs no edit to satisfy the Claim, and if one is made it adds no `## ` heading (see the Global
  Constraints) — every heading is a doctor row.
- `README.md` line 211 says the PR body "links the evidence branch"; that is prose, not a read
  recipe, and it is outside this task's Files — leave it.

What the boot does, so the skill's sentences are true: `fleet/sandbox-boot.sh` `record_tags`
runs after the last evidence push of a run that ends `done` or `parked` — it tags the plan
commit `ultra/plan/run-<N>` and the evidence head `ultra/evidence/run-<N>`, verifies both with
`git ls-remote --tags`, then deletes `ultra/plan-run-<N>` and `ultra/evidence-run-<N>` in the
same step; a tag that does not verify keeps both branches, and a run that ends `failed` keeps them
for the one-time sweep (`node fleet/retire.mjs`). So a parked run is tagged too — line 179's
"its evidence branch is still pushed" becomes a sentence about its tag — and the branch holds the
same bytes as the VM's page only while the run is in flight. The contract's own words, to reuse:
`fleet/CONTRACT.md` line 83 "The record is read by tag:
`.ultrapowers/runs/<N>/status.json?ref=ultra/evidence/run-<N>`", and `fleet/RUNBOOK.md` lines
174–182 "Read it by tag, which is the one spelling that keeps working after the run's branches are
gone" then, under the recipe, "While the run is still in flight the tag is not written yet, and
the same bytes are on its evidence branch; the VM's own page above is the live read."

The pin: `tests/test_docs_agree_with_code.py` reads SKILL.md, first-run.md, RUNBOOK.md and
README.md structurally — every `--flag` on SKILL.md's single `node …fleet/launch.mjs` line is in
the launcher's usage, first-run.md's `## ` headings equal the doctor's `ROW_IDS` in order, every
`fleet/<name>.mjs|sh` named exists, the retired vocabulary (`drive-one`, `refs/fleet/`,
`grant.mjs`, `fleetRuns`, `plans/run-<N>.md`, …) appears nowhere. Its `?ref=` check —
`test_no_ref_reads_the_evidence_branch_instead_of_the_evidence_tag` — covers only RUNBOOK.md and
CONTRACT.md, which is why the Proof's grep legs are the pin for the two skill files. Keep the
launch line and the VM-name example (`fleet-r<N>-…`) as they are. Two sims pin sentences of
§Client that sit beside the edit and must stay verbatim: `fleet/tests/test_sandbox_boot_merge.mjs`
slices step 4 (`4. **The PR is the gate` to `5. **Reap`) and matches "A ready PR merges itself
once its checks are green" … "`--hold` on the launch line keeps it open" in that order;
`fleet/tests/test_janitor_reap_only.mjs` needs step 5's "The launcher runs it before every
launch; nothing schedules it" and no word `cron` in either skill file. No test pins the four
sentences being rewritten (`git grep` of "evidence branch", "evidence-run-<N>" and "still
pushed" over `tests/` and `fleet/tests/` finds no hit on either skill file).

**Proof:**
- Legs: (a) for each of `skills/ultrapowers/SKILL.md` and
  `skills/ultrapowers/references/first-run.md`: every occurrence of the path
  `contents/.ultrapowers/runs`, taken as one space-delimited token with whatever is glued to it,
  ends in `?ref=ultra/evidence/run-<N>` (a closing quote or bracket may follow, no ref character
  may) — the first two `Run:` commands below, each an equality between the number of such tokens
  and the number of them ending in the tag; at BASE SKILL.md's one token ends in
  `?ref=ultra/evidence-run-<N>'` so the counts are `1` and `0`; a second path on the same line at
  the branch, at `main`, at a sha, or with no `?ref=` is its own token and breaks the equality [M1];
  (b) SKILL.md carries the recipe line with the tag,
  `contents/.ultrapowers/runs/<N>/status.json?ref=ultra/evidence/run-<N>` as a fixed string —
  the third `Run:`; and first-run.md names `evidence-run-` on no line at all — the fourth
  `Run:`, a whole-file count that must be `0`, which is the falsifier for a recipe added to
  first-run.md at the branch, spelled any way [M1];
  (c) in SKILL.md the lines inside fenced code blocks (the fifth `Run:` toggles on a line whose
  first non-blank characters are three backticks, spelled in octal so the command carries none)
  name `evidence-run-` zero times, and the lines carrying `gh api`, `curl`, `git ` (with its
  space), `?ref=` or `githubusercontent` name `evidence-run-` zero times — the sixth `Run:`; at
  BASE the fenced count is `1` (the recipe at line 158) and the command-line count is `1` (the
  same line), and a `gh api` with a shell variable in the path, a raw-URL `curl`, or a
  `git show ultra/evidence-run-<N>:…` — in a fence or in prose, with or without `in flight` in
  its sentence — raises one of the two counts [M1];
  (d) with SKILL.md joined into one line and split into sentences at `. `: every sentence that
  names `evidence-run-` or `evidence branch` also carries `in flight` — the seventh `Run:`, the
  count of such sentences lacking `in flight` must be `0`; at BASE it is `4` (the sentences at
  lines 152, 154–158, 168 and 179), so a branch left named without the qualifier in any one of
  them fails it [M2];
  (e) §Client (from `## Client` to `## Resources`), split into sentences the same way, has at
  least one sentence naming `ultra/evidence-run-<N>` that carries `in flight` — the eighth
  `Run:`; a rewrite that drops the branch entirely fails it [M2];
  (f) §Client names `ultra/evidence/run-<N>` on at least two lines — the ninth `Run:`; the
  recipe alone gives `1`, so the record must also be named in prose [M2];
  (g) the docs pin is green on the edited tree — the tenth `Run:` [M3].
- Run: test "$(grep -o 'contents/.ultrapowers/runs[^ ]*' skills/ultrapowers/SKILL.md | grep -c .)" = "$(grep -o 'contents/.ultrapowers/runs[^ ]*' skills/ultrapowers/SKILL.md | grep -c '?ref=ultra/evidence/run-<N>[^A-Za-z0-9/_.-]*$')"
- Run: test "$(grep -o 'contents/.ultrapowers/runs[^ ]*' skills/ultrapowers/references/first-run.md | grep -c .)" = "$(grep -o 'contents/.ultrapowers/runs[^ ]*' skills/ultrapowers/references/first-run.md | grep -c '?ref=ultra/evidence/run-<N>[^A-Za-z0-9/_.-]*$')"
- Run: grep -F -q 'contents/.ultrapowers/runs/<N>/status.json?ref=ultra/evidence/run-<N>' skills/ultrapowers/SKILL.md
- Run: test "$(grep -c 'evidence-run-' skills/ultrapowers/references/first-run.md)" = 0
- Run: test "$(awk -v f="$(printf '\140\140\140')" '{ s = $0; sub(/^[ \t]*/, "", s) } index(s, f) == 1 { c = !c; next } c' skills/ultrapowers/SKILL.md | grep -c 'evidence-run-')" = 0
- Run: test "$(grep -e 'gh api' -e 'curl' -e 'git ' -e '?ref=' -e 'githubusercontent' skills/ultrapowers/SKILL.md | grep -c 'evidence-run-')" = 0
- Run: test "$(tr '\n' ' ' < skills/ultrapowers/SKILL.md | sed 's/\. /.\n/g' | grep -e 'evidence-run-' -e 'evidence branch' | grep -v -c 'in flight')" = 0
- Run: sed -n '/^## Client/,/^## Resources/p' skills/ultrapowers/SKILL.md | tr '\n' ' ' | sed 's/\. /.\n/g' | grep 'ultra/evidence-run-<N>' | grep -q 'in flight'
- Run: test "$(sed -n '/^## Client/,/^## Resources/p' skills/ultrapowers/SKILL.md | grep -c 'ultra/evidence/run-<N>')" -ge 2
- Run: python3 -m pytest -q tests/test_docs_agree_with_code.py -p no:cacheprovider

**Stale-if:**
- issue-closed: #710
- path-absent: `skills/ultrapowers/SKILL.md`
- path-absent: `skills/ultrapowers/references/first-run.md`
- path-absent: `tests/test_docs_agree_with_code.py`
