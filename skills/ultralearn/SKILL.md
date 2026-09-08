---
name: ultralearn
description: Use when the operator wants to learn from real ultrapowers runs — harvest runs across projects, read them through five lenses, accumulate a redaction-guarded observation ledger, and distill human-gated improvement proposals. Two verbs - "ultralearn" (sense) and "ultralearn distill" (propose).
---

# ultralearn — feedback loop from in-practice use

A developer tool that closes the loop from real ultrapowers runs back into the
plugin. Deterministic Python harvests and merges; subagents read. All LLM work
runs inside Claude Code — no API key, no external calls.

## Verb 1 — `ultralearn` (sense)

1. **Harvest.** Run the harvester to detect real runs and build local bundles.
   **Fleet runs (0.3.0 and later) come from their event log**, not from a
   transcript on this machine — the driver runs in a sandbox, so nothing local
   ever sees one:
   `python3 skills/ultralearn/scripts/harvest_fleet_runs.py --evidence <owner>/<repo> --run <N>`
   reads each run's committed record off its `ultra/evidence/run-<N>` tag —
   since #624 the tag is the record of every finished run — and falls back to
   the `ultra/evidence-run-<N>` branch, which exists only while that run is in
   flight. Or pass an unpacked run directory as a positional argument — the
   positional `paths` also takes a tree holding several of them, or a
   sandbox-logs tarball. It writes `bundle.json` + `slice.md` into the
   gitignored cache
   `~/.claude/ultralearn/runs/run-<N>-<date>/` — the run id and its opening day
   in UTC (`run-30-2026-08-30`), so a restarted numbering never lands on an
   older run's bundle. `--run` is repeatable and restricts the pull; `--force`
   rebuilds a cached bundle. `--engine-version <release>` stamps the bundle's
   version explicitly; without it that version is a date guess, and the merge
   will not stamp a finding from it. A fleet run directory is one holding an
   `events.jsonl`.
   Incremental: a cached bundle is "already cached" only when the record's sha
   matches its `evidenceSha` — a record that has moved since (a re-publish, a
   re-tagged run) is rebuilt, not skipped.
   Sequential-engine drains (subagent-driven, inline) write no `events.jsonl`
   and are **invisible to this harvester by design** — "0 new" there is
   correct, not a bug. Drains are sensed by **commissioned transcript
   reads**: after a drain, dispatch readers at the drain session's
   transcript with the same five lenses, including the redirect-round count,
   assigned to exactly one reader. Readers MUST set `evidenceAbstracted:
   true` (no bundle triggers the foreign rule), stamp `engineVersion` (plain
   version string — the repo release at drain time), and use the drain
   session id as `runId`; the merge guard then forces only `origin: foreign`
   — accepted. Promote trigger for a drain detector: a sense pass where
   commissioned reads **miss or misread** drain evidence; record the miss as
   a ledger finding.
2. **Read.** For each new bundle, dispatch a subagent with
   `references/reading-lenses.md` as its instructions plus the bundle's
   `bundle.json` and `slice.md`. The agent returns a JSON array of findings.
   Dispatch readers in parallel. Every reader applies all five lenses,
   including the open-ended `frontier` pass that catches emergent behavior.
3. **Merge.** Collect the findings and merge them behind the redaction guard.
   Build both bundle lookups once, read the released-version set, and pass all
   three to `merge_findings`:
   `origin_lookup, engine_lookup = bundle_lookups("~/.claude/ultralearn")`, then
   `released = released_versions()` (from `_readers`), then
   `merge_findings(findings, "docs/superpowers/observations/ledger.jsonl", origin_lookup, engine_lookup, released=released)`.
   `origin_lookup(runId)` reads `origin` from the cached `bundle.json` (fail
   closed to `foreign`); `engine_lookup(runId)` reads `engineVersion.epoch`, so
   each ledger entry records the ultrapowers version the finding was observed
   under — letting `distill` weigh whether a finding predates a fix. A bundle
   whose epoch was guessed from the run's date stamps no version at all, and a
   finding stamped with a version this plugin never released is refused — never
   written, and counted under the returned `refused`. Then
   `regenerate_digest(...)` rewrites `docs/superpowers/observations/ledger.md`
   (the version shows as `_(vX.Y.Z)_`). **Foreign verbatim evidence never
   lands** — the guard drops it.
   Script: `python3 skills/ultralearn/scripts/merge_ledger.py`

**Historical corpus** — runs 10–23 predate `events.jsonl` (pre-#421), so no
harvester reads them and no sense pass expects to. Their evidence survives as
archaeology only, in `.claude/ultrapowers/fleet-evidence-archive/`: one
`sandbox-logs/fleet-run-<N>-<stamp>/sandbox-logs.tgz` tarball per run (18 of
them, run 10 onward), beside that era’s per-run gate reads and control-plane
payloads. The archive is untracked and absent from every sandbox — read it on
the laptop, or not at all.

## Verb 2 — `ultralearn distill` (propose)

Read the accumulated `ledger.jsonl`, cluster recurring/co-occurring findings
across runs, rank by frequency × severity × novelty, and draft improvement
proposals — each mapped to a real surface (`references/*.md`, the routing hook,
ultrawrite, `report-format.md`/`SKILL.md`, `README`). Draft each proposal against
`references/distilling-proposals.md`, which is **structural-first**: *make the
defect inexpressible, not detected*. A guard is a standing tax collected from
every future run; a representation change is paid once — so before drafting
any fix, name what made the defect possible and propose the change to that.
A reactive per-defect guard is the fallback (on a recurring cluster the
consolidation attempt is recorded first), machinery is earned by recurrence
(first occurrence → prose or a watch-item; second → build — the parked list
is the open `watch-item`-labeled GitHub issues, read at distill start via
`gh issue list --label watch-item --state open`), and at most one
additive guard per cycle is recommended for adoption. Weigh each finding's `engineVersion`: a cluster seen
only under versions older than the current release may already be addressed — flag
it as possibly-stale and confirm against the current engine before proposing a
fix, rather than re-solving a closed problem. The same version stamp powers the
reverse check: for each previously adopted proposal that carried a
`canaryMetric` (required on any rigor-for-efficiency trade; default = the
redirect-round rate every sensed run records), compare the canary across runs
before and after the adopting version — a rising canary means the trade is
failing, and drafting its reversal belongs in this distill's output. Output draft GitHub issues and/or
spec stubs under `docs/superpowers/specs/`. **Nothing is filed or committed
without operator approval** — present the drafts and let the operator choose.
This human gate is the loop's governor, mirroring the pre-merge gate.

**Deletion candidate (mandatory).** Every distill cycle must nominate at least
one `simplification` proposal — a rule, guard, knob, or subsystem the evidence
suggests the engine could shed — even when ranked last. The sensing lenses hunt
friction, so left alone the loop only ever accretes; the deletion candidate is
its counterweight. Weak nominations are fine: name the candidate, what evidence
would justify removing it, and what currently blocks removal.

## Privacy (two tiers — the repo is public)

- Local, gitignored (`~/.claude/ultralearn/`): raw bundles, full slices,
  verbatim evidence, watermark.
- Local, untracked since #544 (`docs/superpowers/observations/`): abstracted findings, metrics,
  local pointers only. Runs are classified `home` (this repo — verbatim OK) or
  `foreign` (any other project — evidence must be abstracted).
