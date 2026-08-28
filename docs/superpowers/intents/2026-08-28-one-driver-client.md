# Intent — One Driver, the client half (0.3.0)

**Signed by:** operator, pending. **Spec:** `docs/superpowers/specs/2026-08-28-one-driver.md`
§8e. **Branch:** `one-driver`. **Ticket:** #390. **Sibling intent:**
`2026-08-28-one-driver-engine.md` (#389).

*Same release, same branch, separate signed intent — the two halves share no `Files:` and no
dependency edges. Operator decisions 4, 5, 6 and 7 of 2026-08-28 (#366 Amendment 7) are what
put this half inside 0.3.0 rather than beside it.*

## Scope

Fork exactly one thing — the authoring path — and drop the rest rather than vendoring it.
`superpowers:brainstorming` + `superpowers:writing-plans` + `ultrapowers:ultraplan` collapse
into **one owned authoring skill** that produces the intent document the driver consumes.
The seven practice skills are dropped as dependencies and not copied. Superpowers stays
installed on the operator's machine; the residual is one precedence line.

## Global Constraints

- **Ship the MIT copyright and permission notice** with any prose derived from superpowers
  (© 2025 Jesse Vincent). Derivation is permitted; attribution is the condition.
- **Nothing is vendored.** The seven practice skills are dropped, never copied — ~10,054
  words that must not enter this repo.
- **The intent-doc schema is the spec's §6, verbatim.** Seven slots, `Files:` and `tier` in
  the signed tier. §6 exists so this half and the engine half cannot drift; a draft already
  let them, and the trim review caught it.
- **No new mechanism for the hook residual.** One precedence line, leaning on superpowers'
  own documented precedence rule. If that measurably fails, *then* there is a case for
  something heavier — not before.

## Tasks

### C1 — the owned authoring skill

- **Depends-on:** —
- **Interfaces:** `/ultrapowers:authoring` produces a signed intent document
- **Produces:** the slot schema, the fork question bank, read-back in both registers, and
  brainstorming's kept shape (path classification, one question per message, 2–3 approaches
  with a recommendation, a review gate)
- **Files:** `skills/ultraauthor/SKILL.md`, `skills/ultraauthor/references/`,
  `tests/test_skill_budget.py`
- **tier:** most-capable
- **Acceptance:** `see:` `wc -w skills/ultraauthor/SKILL.md` reports **≤ 1,500**, pinned by
  `test_skill_budget.py` and refusing the release above it. The fork question bank cites the
  ultralearn ledger or the redirect corpus for every question — **no invented questions**,
  which is checkable by reading the citations.

### C2 — the deterministic intent checker

- **Depends-on:** C1
- **Interfaces:** `check_intent.py <intent.md>` → exit 0 or a named refusal
- **Produces:** refusal on an empty or `unknown` slot, on a slot count ≠ 7, on > 8 standing
  decisions, on a task missing any of id / `Depends-on` / `Interfaces` / `Produces:` /
  `Files:` / `tier` / acceptance, and on a human-eyes acceptance statement with no matching
  pre-authorization
- **Files:** `skills/ultrapowers/scripts/check_intent.py`, `tests/test_check_intent.py`
- **tier:** most-capable
- **Acceptance:** `do:` run it against an intent whose `## Cadence` heading is also mentioned
  in prose earlier in the file. `see:` it counts the **heading**, not the prose mention —
  slot boundaries anchor at line start. A first hand-validation of the engine intent got this
  wrong and silently reported **0 standing decisions** where there were 7: a false green, in
  the one tool whose whole job is refusing false greens.

### C3 — delete `ultraplan` and drop the seven dependencies

- **Depends-on:** C1
- **Interfaces:** —
- **Produces:** `skills/ultraplan/` deleted; the authoring half of `plan-markers.md` and its
  "Executor variance" section deleted; the seven practice skills dropped from every manifest
  and doc that names them
- **Files:** `skills/ultraplan/`, `skills/ultrapowers/references/plan-markers.md`,
  `.claude-plugin/plugin.json`, `tests/test_recommendation_rubric.py`
- **tier:** standard
- **Acceptance:** `see:` `grep -ril "superpowers:" skills/ .claude-plugin/` returns **no
  match that is a dependency** — remaining hits are prose about the lift, and each is a
  sentence a reader can tell is historical. `python3 -m pytest` green.

### C4 — the precedence line

- **Depends-on:** C1
- **Interfaces:** `hooks/session_start.sh`
- **Produces:** one line declaring that the ultrapowers authoring skill owns the
  plan-authoring pipeline
- **Files:** `hooks/session_start.sh`, `tests/test_recommendation_rubric.py`
- **tier:** standard
- **Acceptance:** `do:` start a fresh session with superpowers installed and say "let's build
  X". `see:` the session reaches for the ultrapowers authoring skill, not
  `superpowers:brainstorming`. If it does not, that is the measured case for something
  heavier — record it and park rather than inventing a mechanism.

### C5 — the standing rule, README and marketplace

- **Depends-on:** —
- **Interfaces:** the product statement
- **Produces:** CLAUDE.md's *"extends, does not fork"* text deleted; README and marketplace
  say ultrapowers is the system and the plugin its thin client, execution on an exe.dev fleet
  you provision, no local engine
- **Files:** `CLAUDE.md`, `README.md`, `.claude-plugin/marketplace.json`,
  `tests/test_product_statement.py`
- **tier:** standard
- **Acceptance:** `do:` read the marketplace card as a new user. `see:` it says where
  execution happens and that a fleet is required, with no sentence implying a local run.
  Pre-authorized as a wording ack (standing decision 3).

### C6 — `ultradocket`'s sweep emits intent documents

- **Depends-on:** C1, C2
- **Interfaces:** the docket sweep
- **Produces:** swept issues become signed-shaped intent docs, not plans; the triage half
  unchanged; the vestigial `**Seal:**` field removed
- **Files:** `skills/ultradocket/SKILL.md`, `skills/ultradocket/scripts/`,
  `tests/test_compile_docket.py`, `tests/test_docket_lib.py`
- **tier:** most-capable
- **Acceptance:** `do:` sweep a two-issue docket. `see:` the output passes `check_intent.py`
  with exit 0. **No tool in the repo still emits the old plan artifact** — this is the
  operator's stated reason for putting this task in 0.3.0 rather than after it.

## Standing decisions

1. **Naming the new skill directory is authorized** — `ultraauthor` in the `Files:` blocks is
   a placeholder, not a signed decision.
2. **Dropping a superpowers-derived paragraph rather than rewriting it is authorized** where
   the paragraph's content is already covered; the ≤ 1,500-word ceiling wins over fidelity.
3. **`deferred:manual` acks on documentation wording are pre-authorized** — README, SKILL.md
   and marketplace text read correctly if the words are present and name nothing deleted.
4. **Deleting a test whose only subject is deleted skill text is authorized.**
5. **If the precedence line proves insufficient in the C4 acceptance, park — do not invent a
   mechanism.** That failure is a measured case for a later ticket, and inventing machinery
   inside this run is exactly what the surface ceiling exists to prevent.

## Cadence

One run, **width ≤ 8**, one wave per sandbox (measured — `evals/frontier/results/2026-08-28-wave-width.md`). Two waves fall out: C1 and C5 have no dependencies;
C2, C3, C4 and C6 follow C1.

**Where the §6 schema chafed, recorded for its own revision:**

- **Slot boundaries must anchor at line start**, and this was found the hard way — a
  hand-written validator sliced on the first textual occurrence of `## Cadence`, hit a prose
  mention in the preamble, and reported **0 standing decisions** where there were 7. C2's
  acceptance now pins it. A schema whose slot names are also natural prose invites exactly
  this bug.
- **`Files:` on a skill fork is nearly meaningless.** C1 creates a directory that does not
  exist and C3 deletes one that does; the compiler's write-after-write overlap edges have
  little to work with. The signed-`Files:` rule was justified by *code* contention (spec §6),
  and it earns less on this half.

## Acceptance

The run is green when every task's acceptance statement above is met, `python3 -m pytest` is
green, `validate_skill.py` passes on every surviving skill, and the word ceilings hold.
The release is refused without the §9 numbers in its commit body.

## Out of scope

- **Everything in the engine intent**, including the ten fixture intent docs for gate parity
  — those are `evals/fixtures/*/intent.md` and belong to the engine's T11.
- **`claude plugin eval`** — it gates this client surface, and it is the natural next ticket
  once the skill exists; it is not a 0.3.0 bar.
- **Vendoring anything from superpowers.**
