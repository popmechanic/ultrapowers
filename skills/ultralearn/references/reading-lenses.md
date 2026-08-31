# ultralearn — Reading Lenses

You are reading ONE ultrapowers run bundle (`bundle.json` + `slice.md`). Apply
the five lenses below and return findings as a JSON array. Return raw data only.

## The five lenses

1. **friction** — where the run broke or strained: merge conflicts, blocked or
   cascade-blocked waves, fix-loop exhaustion, gate rejections, lost
   coordinates, operator interventions, re-runs.
   For a FLEET bundle, read the drive's structured artifact first:
   `detail.errors`, `detail.timedOut`, `detail.neverClaimed`, and
   `detail.publishTimedOut` in `gate-read-<runId>.detail.json` name the
   drive-layer seam (lease expiry, transport death, publish loss) that
   `shim.log` then evidences.
2. **routing** — was ultrapowers the right call; did the routing recommendation
   match how the run actually went; were Type/Depends-on markers and wave shape
   good, or did poor marking cause serialization or conflicts.
3. **operator** — the human's qualitative arc: confusion, surprise,
   trust/distrust, what they said at planning and at the gate, where they spent
   attention versus where the design intended. Watch specifically for a
   NEEDS_ACK approved under a claimed standing instruction with no printed ack
   list or standing-approval sidecar — that recurrence is what would buy an
   enforcement guard.
4. **cost** — tokens, turns, tier choices, parallelism payoff, anything the
   metrics in `bundle.json` reveal about effort versus benefit.
   For a FLEET bundle, also read `detail.sandboxStat` ({peakCores, meanCores,
   peakMemBytes} — a floor estimate) and the raw `stat-<runId>.json` beside the
   gate read — the same aggregation W2's sandbox-sizing verdict uses — and
   `shim.log`'s `engine auth` line (`authMethod` must read `oauth_token`; any
   other value means the engine billed a gateway, flag it).
5. **frontier** — OPEN-ENDED. How large/complex did the work get and still
   succeed? What did the agents do that the design did NOT anticipate —
   self-limiting, self-correcting, or otherwise surprising behavior? Seed
   example to calibrate novelty: a planning agent that declined to author a full
   implementation plan in one pass, reasoning that test-driven development is
   impossible against files that do not yet exist. Flag anything of that
   character.

## Watch-items (standing, until removed by a distill cycle)

- **fold-relaxation canary** — tag by prefixing the finding title with
  `fold-canary:` (lens: frontier). Active for runs at engineVersion ≥ 0.2.0
  (the release adopting `--overlap fold` as the default + the §5 authoring
  relaxation — the unmeasured rigor trade, so it carries this canary per house
  doctrine). From each run dir's `frontier/` records, read: (a) the fallback
  rate per contended wave, and (b) the redirect-round rate on plans with
  contended waves vs. the portfolio baseline (the standing redirect-round
  count below supplies the baseline). **Expected fallback sources are named up
  front** so their first occurrence reads as the priced cost, not a
  regression: concurrently-created binary paths, runtime over-cap growth, and
  semantic suite failures at candidate time. First persistence of *elevated*
  rates flags the relaxation possibly-failed; second persistence makes
  drafting the reversal (restore `serialize` as the default, keep the engine
  capability guarded) mandatory distill output. Adoption of any reversal stays
  operator-gated.

  Sensor baseline for this canary (Phase-1 fold-native authoring program §1f):
  - **What to read** — `bundle.json`'s `frontier.maxLinesByWave` (per-wave list
    of the largest file the resolver's brief was built against, one entry per
    fold call) and `audit.totals.wallSecByTask` (summed implementer wall-clock
    seconds per task id, from each transcript's first-to-last record
    `timestamp`).
  - **What a rising `maxLines` means** — a wave whose contended files are
    growing is exactly the shape hunk-scoped resolver briefs (spec §1a) were
    built to survive; a rising trend with no matching rise in fallback/
    redirect rate is the relaxation still paying, not yet failing.
  - **What `wallSecByTask` feeds** — Phase 3's MEASURED leg: the wall-clock
    half of the eventual before/after comparison, read alongside the resolver
    token-share reading in `evals/frontier/results/2026-08-19-t15-resolver-token-share.md`.

- **same-file authoring cost** — tag by prefixing the finding title with
  `authoring-cost-samefile:` (lens: routing). The question: during PLANNING —
  brainstorm→spec→ultraplan authoring, wherever the bundle's planning turns
  show it, not just execution — do tasks get contorted to AVOID same-file
  edits? Signals: a feature split across modules unnaturally, a chain of
  dependent tasks where a fan of independent ones was natural, an interface
  file invented mainly to separate two writers, or a `Depends-on` marker added
  solely because of file overlap rather than a real logical dependency. Emit a
  finding only on affirmative evidence (silence is not a finding), keep a
  verbatim evidence pointer for home runs, and note the strength (explicit
  authoring reasoning about file overlap > structure that merely looks
  contorted). Pre-registered consumer: the manyana door-1 recurrence trigger —
  substantive findings across 2+ independent sense passes reopen a design
  conversation only.

## The redirect-round count (required, exactly one per bundle)

Always emit one `friction` finding recording the run's **redirect-round
count**: the number of times completed work was sent back for another round —
per-task review fix cycles plus gate/operator redirects (resume relaunches).
Emit it even when the count is 0, at severity 0 — the zero is the data; a
bundle with no count finding reads as unmeasured, not clean. Break the count
down by cause — `infra` (provider overload, disk, environment), `finding`
(review/critic-confirmed code defects), `plan` (plan-authored defects),
`elective` (operator-chosen polish) — and record the run's implementation-task
count alongside, so rates compare like with like across run scales and
platform weather never masquerades as rigor signal. Across runs this
count becomes the redirect-round *rate*, the canary metric distill watches to
judge whether an adopted rigor-for-efficiency trade is paying.

Machine-readably: the count finding additionally carries
`redirectRounds` — `{"total": N, "infra": a, "finding": b, "plan": c,
"elective": d}`, non-negative integers (the cause counts should sum to
`total`) — and `implementationTasks` (integer). The title prose stays as
the human headline; the structured fields are what the canary aggregates
by `engineVersion`, so emit them on every count finding, including the
zero (`{"total": 0, ...}`).

## Output schema (one object per finding)

- `runId` (string) — copy from `bundle.json`.
- `lens` (string) — one of friction | routing | operator | cost | frontier.
- `title` (string) — a one-line headline.
- `novelty` (integer 0–2) — 0 routine, 1 notable, 2 never-seen.
- `severity` (integer 0–3) — 0 informational … 3 blocking/harmful.
- `evidence` (string) — what in the run supports this.
- `evidenceAbstracted` (boolean) — see the foreign rule below.
- `implication` (string) — what it suggests changing.
- `surface` (string) — the repo area a fix would touch (e.g. references/*.md,
  the routing hook, ultraplan, report-format.md, SKILL.md, README).
- `redirectRounds` (object — required on the redirect-round count finding
  only) — `{total, infra, finding, plan, elective}`, non-negative integers.
- `implementationTasks` (integer — required on the redirect-round count
  finding only) — the run's implementation-task count.

## The foreign rule (mandatory)

`bundle.json` carries `origin`: `home` or `foreign`. For a **foreign** run
(any project other than ultrapowers itself), you MUST set
`evidenceAbstracted: true` and write `evidence` as the *shape* of the behavior
with identifiers and domain specifics stripped — never quote verbatim text from
a foreign project. For a `home` run, verbatim evidence is allowed and
`evidenceAbstracted` may be false.

## Reading across the cutover

The corpus now spans two engines: runs before 0.3.0 were the LLM-orchestrator,
runs from 0.3.0 on are the One Driver fleet. Two disciplines apply whenever a
reading touches that boundary.

- **A finding class that stops appearing may have been deleted, not fixed.**
  The pre-0.3.0 corpus was the LLM-orchestrator engine; ten issues were closed
  on 2026-08-30 as moot-by-cutover — defects in machinery 0.3.0 deleted. A
  reader comparing eras must make that distinction expressible, or the first
  pass reads the cutover as an improvement it was not. When a lens wants to
  claim an improvement across the boundary, it states which of the two it is —
  the defect was fixed, or the machinery carrying it was **deleted, not
  fixed** — or it does not make the claim.
- **Cite event ids.** A fleet bundle carries `events`, and its `slice.md` opens
  with a ULID-stamped timeline. Any observation about timing, ordering, or a
  worker's fate cites the ULIDs it rests on, so the operator can check it
  mechanically against `events.jsonl` (#415's success criterion). An
  uncited timing claim about a fleet run is unchecked, and reads as such.
