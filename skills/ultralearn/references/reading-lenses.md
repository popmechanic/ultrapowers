# ultralearn — Reading Lenses

You are reading ONE ultrapowers run bundle (`bundle.json` + `slice.md`). Apply
the five lenses below and return findings as a JSON array. Return raw data only.

## The five lenses

1. **friction** — where the run broke or strained: merge conflicts, blocked or
   cascade-blocked waves, fix-loop exhaustion, gate rejections, lost
   coordinates, operator interventions, re-runs.
2. **routing** — was ultrapowers the right call; did the routing recommendation
   match how the run actually went; were Type/Depends-on markers and wave shape
   good, or did poor marking cause serialization or conflicts.
3. **operator** — the human's qualitative arc: confusion, surprise,
   trust/distrust, what they said at planning and at the gate, where they spent
   attention versus where the design intended.
4. **cost** — tokens, turns, tier choices, parallelism payoff, anything the
   metrics in `bundle.json` reveal about effort versus benefit.
5. **frontier** — OPEN-ENDED. How large/complex did the work get and still
   succeed? What did the agents do that the design did NOT anticipate —
   self-limiting, self-correcting, or otherwise surprising behavior? Seed
   example to calibrate novelty: a planning agent that declined to author a full
   implementation plan in one pass, reasoning that test-driven development is
   impossible against files that do not yet exist. Flag anything of that
   character.

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

## The foreign rule (mandatory)

`bundle.json` carries `origin`: `home` or `foreign`. For a **foreign** run
(any project other than ultrapowers itself), you MUST set
`evidenceAbstracted: true` and write `evidence` as the *shape* of the behavior
with identifiers and domain specifics stripped — never quote verbatim text from
a foreign project. For a `home` run, verbatim evidence is allowed and
`evidenceAbstracted` may be false.
