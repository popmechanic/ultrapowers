# Post-distill close/ops/sensor slate (#158, #159, #160)

_Spec 2026-08-18 (post-distill filing slate over the foreign 0.2.x sense
pass), rev 2 after trim review (trims 1–6 adopted; #160 graded up as
written, flat after trims). Three orthogonal items filed ahead of the coming plan-authoring
rewrite; everything engine-shaped from that distill was deliberately held
(see `2026-08-18-rewrite-design-inputs.md`). Frozen periphery untouched
throughout; no waves.js change; no direct API calls. Proposals 2/3/5 of
`~/.claude/ultralearn/distills/2026-08-18-proposals.json`. complexityEffect:
structural for all three; author's netConceptDelta claim: #158 down, #159
flat, #160 flat — graded by the trim reviewer, not the author (§Trim
review)._

## Problem

Three seams the first foreign 0.2.x runs exposed, none engine-side:

- **#158** — the residual-manifest close check rejected 19/26 rows on its
  first foreign use because the disposition grammar lets only `waived`
  carry text; the orchestrator's natural `acked:<reason>` and
  `filed:<ref> — <note>` had to be stripped to bare tokens, losing the
  audit trail the manifest exists to keep.
- **#159** — `run-<stamp>/wf-runs.json` learns a workflow run ID only when
  a gate runs over that launch's report, so un-gated launches (failed
  preflight relaunch, fail→salvage round) are outside the approve sweep
  set; skylights ended approve with 4 leftover worktrees under two such IDs.
- **#160** — the harvester stamps foreign `engineVersion` from a date upper
  bound though the transcript names the exact plugin-cache path (two live
  over-attributions); the bundle exposes one `transcriptDir` for a
  multi-run session so the audit's scope is illegible; the #150 mode-(b)
  approved slice runs to transcript end and carried ~250 records of
  unrelated sensitive post-run work into the local slice.

## Design

### #158 — disposition grammar (residual_manifest.py)

Grounded: `DISPOSITION = ^(?:fixed|acked|filed:\S+|waived:\S.*)$`
(`residual_manifest.py:47`); the docstring (:20–22), the emitted header
comment in `emit()`, and `finishing-notes.md` §Residual manifest list the
four values.

Change — one regex, one asymmetry removed:

```
DISPOSITION = ^(?:fixed|acked(?::\S.*)?|filed:\S+(?:\s.*)?|waived:\S.*)$
```

- `acked` — bare, or `acked:<annotation>` (non-empty; `acked:` / `acked: `
  stay red, the same rule `waived:` already follows).
- `filed:<ref>` — ref is still `\S+`; any whitespace-separated note may
  follow (`filed:#152 — note`, `filed:#152 note`). Bare `filed:` and
  `filed: #1` stay red.
- Everything else unchanged: `fixed` bare only, `Fixed` red, `acked because
  reasons` (no colon) red.

Docstring, `emit()` header comment, and finishing-notes.md say
`acked[:<annotation>]` and `filed:<ref>[ <note>]`. Derive-mode output is
byte-identical (gate acks still emit bare `acked`). No new values.

### #159 — record the Run ID at launch (SKILL.md prose)

Grounded: `ultra_gate.py` (FROZEN) `load_wf_runs` reads `wf-runs.json` as a
bare sorted JSON array and every approve/teardown sweeps its union with
`wf_<stamp>` (:44–67, :118, :139). The writer already exists:
`skills/ultradocket/scripts/record_wf_run.py <stamp> <wf_runId>` imports
the frozen reader for shape fidelity and refuses (exit 1) to clobber an
unreadable file; the drain lane already calls it after every launch
(`ultradocket/SKILL.md` step 2).

Change — prose only, in `skills/ultrapowers/SKILL.md`:

- **Step 4c**, immediately after the launch paragraph: the Workflow tool's
  immediate result (the launch runs in the background) prints
  `Run ID: <wf_runId>`; before anything else, record it —
  `python3 ${CLAUDE_PLUGIN_ROOT}/skills/ultradocket/scripts/record_wf_run.py
  <stamp> <wf_runId>`. Exit 1 (unreadable existing file) is surfaced, never
  skipped. (Layering, stated: `ultrapowers/SKILL.md` now names an ultradocket
  script — one that itself imports the frozen ultrapowers reader; the
  `${CLAUDE_PLUGIN_ROOT}` form is the correct one for foreign installs.)
- **Step 5 Salvage** and **Redirect**: the same line after each relaunch
  (each relaunch mints a fresh runtime ID).
- **Step 5 Approve** wording: the sweep set is "every wf run ID recorded
  for this stamp — at launch and by the gate".

No new file, no sweep-logic change, no waves.js change. Pin: a small
containment test (`tests/test_skill_wf_run_record.py`): split SKILL.md on
`## Step ` headings, assert the Step 4 text and — inside the Step 5 text —
both the `- **Salvage**` and `- **Redirect` bullets (split on `\n- **`)
contain `record_wf_run.py`. No SKILL.md parser beyond those two splits.

### #160 — harvester precision v4 (harvest_runs.py, sensor-side)

Ledger contract kept stable across the rewrite: `engineVersion` stays
`{epoch, asOf, basis}`; existing `basis` strings unchanged when the new
source is absent; redirect-round vocabulary untouched.

**(i) engineVersion from the plugin-cache path.** Grounded:
`_engine_epoch` (:693–717) is date-only. Every skill-load turn ("Base
directory for this skill: …") and much tool output carry
`plugins/cache/<marketplace>/ultrapowers/<ver>/` verbatim (22 mentions in
steve-health, 25 skylights, 10 home drain).

New `_plugin_cache_version(records, launch_index)`: regex
`plugins/cache/[^/\s]+/ultrapowers/([0-9]+(?:\.[0-9]+)+)/` over
`_block_text` of every block (text and tool_result blocks — the skill-load
turns and tool output are the carriers; `tool_use.input` is not scanned,
and Bash commands mostly carry the literal `${CLAUDE_PLUGIN_ROOT}`);
returns the last match at-or-before the last registered launch's tool_use
index (the anchor `_last_launch_tool_use_index` already computes), else the
last match anywhere (launch-less sessions: poisonable by pasted fixtures,
accepted — no launch means no run to mis-attribute), else `None`.
`_engine_epoch` gains a `cache_version` argument, honored for **foreign
origin only**: set → `{epoch: <ver>, asOf: <run ts>, basis:
"plugin-cache-path"}`; `None`, or home origin → today's date-bound result
unchanged (home rows keep `home-repo-date`, so the ledger's home baseline
is untouched across the rewrite; the two live over-attributions were both
foreign). `build_bundle` wires it. Multiple distinct versions in a session
resolve by the same rule; no extra field.

**(ii) transcript dirs: legible scope.** Grounded: `_transcript_dirs`
(:324–363) already unions every printed `Transcript dir:` (re-run on the
home drain session: 4 dirs, 41 agents, 492k output tokens); the raw
finding's "one transcriptDir" reading came from the singular bundle field.
A ledger walk (`<runDir>/wf-runs.json` → `<session-dir>/subagents/workflows/<id>`)
was considered and **dropped at trim review**: it keys off registered
launches in the session transcript, so it cannot reach the one case it was
for (a launch made from a subagent), and the remaining case (tool_use
present, print truncated) has zero observations. Change: bundle gains
`transcriptDirs` — the ordered union `_transcript_dirs` already computes —
at top level; the singular `transcriptDir` keeps its meaning (last dir).
`_merge_audits`, when `totals` is non-empty, appends one note clause naming
the unit: "outputTokens = assistant output_tokens summed over agent
transcripts (not the Workflow tool's reported total)"; the empty
`{"agents": [], "note": "no transcript dir"}` shape is untouched. No
`audit_run.py` change.

**(iii) bounded approved tail.** Grounded: `slice_transcript` (:155–190)
sets `cutoff = None` when `terminus == "approved"`, so the tail runs to
transcript end. Bound the tail at the **earliest** of, scanning records
after the artifact cut in order:

1. the first **operator turn** — **inclusive** (the approval reply is kept;
   what follows is the tangent). An operator turn is a `user`-type record,
   not `isMeta`, whose content is a string or carries a `text` block, and
   whose text does not start with `<task-notification>`, `<local-command-`,
   `<system-reminder>`, or `[Request interrupted` (skill loads, background
   completions, local-command echoes and interrupts ride `user` records
   and are not the operator). In the observed steve-health tail this stops
   the slice at "what should we do next?" — one line. (Design change vs.
   the filed proposal's "second operator turn", recorded: the approval turn
   normally precedes the cut because `--approve` output carries the stamp;
   the first post-cut operator turn is either the approval reply or the
   tangent's opener, and keeping one line of the latter is harmless.)
2. the finishing handoff — the first `Skill` tool_use whose `input.skill`
   is `superpowers:finishing-a-development-branch` — exclusive. Operator-
   named; kept as a one-line check. The "first non-ultrapowers skill load"
   bound was **dropped at trim review** (unobserved, and as drafted it
   would not fire on `superpowers:brainstorming` opening a new task).

No bound found → tail to transcript end (today's behavior). Non-approved
termini keep the artifact cut unchanged. Existing mode-(b) fixtures pass
(their tails end at the first operator turn); new fixtures cover the
excluded `user`-record shapes explicitly.

**Out of scope (recorded, not built):** #156 items 1–7 stay under #156;
the drain report.json materialization / result-file join waits on the
drain lane's fate under the rewrite.

## Verification (suite disposition)

`python3 -m pytest` is the gate. New/changed tests:

- `tests/test_residual_manifest.py`: green — `acked:<reason>`,
  `filed:#152 — note`, `filed:#152 note`; red — `acked:`, `acked: `,
  `filed:`, `filed: #1`; existing red set (`Fixed`, `acked because reasons`,
  bare `waived:`) unchanged; emitted header names the optional forms.
- `tests/test_skill_wf_run_record.py`: SKILL.md names `record_wf_run.py`
  in Step 4c, Salvage, Redirect.
- `tests/test_harvest_runs.py`: cache-path present, foreign →
  `plugin-cache-path`; present, home → `home-repo-date` unchanged; absent →
  date-bound basis unchanged; two versions → last-before-launch; bundle
  `transcriptDirs` equals the ordered union; audit note names the unit only
  when totals exist; approved tail with a tangent operator turn stops there
  (inclusive); a skill-load / task-notification / isMeta `user` record after
  the cut does not end the tail; handoff bound; no-bound → transcript end.

No harness JS touched → the `.mjs` sims are not in play.

## Adds / Removes (author disclosure for trim review)

Adds (rev 2): one regex alternation each on `acked`/`filed` (#158);
three prose lines + one containment test (#159), plus `validate_skill.py` resolving a `skills/<name>/scripts|references|kernel/…` reference against that sibling skill (found at build: the old rule resolved every `scripts/x` against the current skill and went red on the cross-skill call; pinned in `tests/test_validate_skill.py`); `_plugin_cache_version`,
a `cache_version` argument on `_engine_epoch` (foreign only), one bundle
field (`transcriptDirs`), one audit-note clause, a two-rule tail bound in
`slice_transcript` (#160).
Removes: nothing. Rev 1 also had `_ledger_transcript_dirs`, per-`runs[]`
`transcriptDirs`, a second dir layout, home-origin cache-path stamping and
a third tail rule — all deleted at trim review.

## Trim review

Reviewer: one fresh-context subagent (inputs: rev-1 spec, issues #158/#159/#160,
the distilling-proposals brief, the touched code + tests). Grade of rev 1:
#158 **down**, #159 **flat**, #160 **up as written / flat if trims 1–4
adopted**; overall flat conditional on the trims. Grounding check: all line
references and regex/frozen-shape claims correct; two inaccuracies named
(the `workflows/<id>` layout is not observed on disk — only
`subagents/workflows/<id>`; `${CLAUDE_PLUGIN_ROOT}` command lines mostly carry
the literal variable, not the path).

Adopt-or-answer:

1. **Collapse the three-rule tail bound** — ADOPTED in part: the
   "non-ultrapowers skill load" rule deleted; the operator-turn rule made
   primary and defined with the meta/notification exclusions the reviewer
   listed; the finishing-handoff rule kept as the operator-named one-line
   check (answer: named in the filing instruction; unobserved but costless).
2. **Delete the ledger walk** — ADOPTED: it cannot reach the subagent-launch
   case (no registered runDir) and the truncated-print case is unobserved.
3. **Drop per-`runs[]` `transcriptDirs`** — ADOPTED; one top-level list.
4. **One layout only** — ADOPTED (moot after 2); the false "two layouts"
   claim removed.
5. **Cache-path stamping foreign-only** — ADOPTED: home rows keep
   `home-repo-date`, keeping the home ledger baseline stable across the
   rewrite; both live over-attributions were foreign.
6. **Simplest containment pin for #159** — ADOPTED, split rule stated.
7. **#158 no trim** — recorded.

Under-specification fixes: operator-turn definition (above); (i) scans
`_block_text` only, launch-less fallback named as poisonable-and-accepted;
audit note only when totals non-empty; #159 names the `Run ID:` line of the
Workflow tool's immediate result and states the ultradocket layering.
Reviewer's scope note recorded: the "first operator turn" rule is a design
change from the filed "second operator turn" (reason in §(iii)).
