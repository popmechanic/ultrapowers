# Comment triage brief

The repository root (read `CLAUDE.md` first for vocabulary: Flock, weave,
Manyana, plan/probes, fleet, sandbox, Jev, TinyApp). We are removing code comments from the codebase.
You categorise every comment block in your shard. **You never edit any repository file.**

Your input: a JSONL shard, one comment block per line: `{id, file, start, end, own, kind, text}`.
`start`/`end` are 1-based lines in the file as it is on `main` now. `own` is false for a trailing
comment on a code line. `kind` is `comment` or `docstring` (Python docstrings count as comments).

For each block, open the file and read the code around it (and anything it references) before judging.

## Categories (pick exactly one)

- `tautology` — repeats what the code already says (names, obvious control flow, "loop over X",
  section banners, a docstring that restates the signature/name).
- `stale` — references code, behaviour, files, flags, tickets or an implementation that no longer
  exists or is no longer true; also change-history narration ("added for #359", "was X, now Y",
  "the old factory did…") whose only content is history that git already holds.
- `excuse` — licenses a hacky or knowingly-imperfect implementation: workaround, "for now",
  "temporary", "bridge", "best effort", "good enough", swallowed error, magic sleep/retry, copy-paste
  "kept in sync with", TODO/FIXME/XXX, "can't do X because Y so we do Z" where Z is a hack.
- `decision` — documents an important, non-obvious decision a future reader needs and cannot recover
  from the code: why this shape over the obvious one, an invariant, a protocol or wire contract, a
  constraint from an external system (exe.dev, GitHub, git, Claude Code), a measured reading behind a
  threshold. It will be moved into an ADR, so it must survive being read away from the code.
- `keep` — must stay for now: load-bearing text (a test or code reads the source text, a usage string
  printed at runtime, a license/provenance header, a marker another tool greps for), or you genuinely
  cannot decide. Use sparingly; it leaves the comment for a later pass under the lint ratchet.

Tie-breaks: a comment that is mostly history but states a still-true non-obvious constraint is
`decision`. A comment explaining *what* a clear line does is `tautology` even if long. A test's
docstring that lists the cases the test asserts is `tautology` unless it records why a case exists.
Before calling something `keep` because a test may read it, grep `tests/` and `fleet/tests/` for a
distinctive phrase of it.

## Output

Write `<work>/out/shardNN.jsonl` (same NN as your input shard),
one JSON object per input id, every id exactly once:

```
{"id": "C0123", "category": "tautology|stale|excuse|decision|keep", "reason": "<= 20 words"}
```

plus, by category:

- `decision`: `"adr_topic"` (kebab-case slug naming the decision area, e.g. `weave-protocol`,
  `fleet-token-rotation`, `plan-parser-grammar`; reuse one slug for related decisions),
  `"symbol"` (the function/constant/module it governs), and `"decision"`: 1–4 sentences in present
  tense restating the context, the decision and its consequence in plain words, self-contained
  (no "this function", no line numbers; name the file and symbol).
- `excuse`: `"issue_title"` (imperative, <= 70 chars) and `"issue_body"`: what the hack is (file +
  symbol), why it is hacky, what a proper fix looks like, and the comment text quoted. Several blocks
  excusing the same hack share an identical `issue_title`.
- `keep`: say in `reason` what reads it.

Validate your file before finishing: every input id present once, valid JSON per line.
Final reply: only the counts per category and the path of your output file.
