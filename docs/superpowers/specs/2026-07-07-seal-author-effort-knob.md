# Seal-author effort knob (single-channel)

**Date:** 2026-07-07 · **Disposition:** suite · **Status:** built inline (TDD)

## Problem

The independent acceptance author inherits whatever model and reasoning
effort the operator's chat session happens to be set to — the plugin never
chose that spend. Observed live 2026-07-07: a session on Fable 5 at xhigh
effort dispatched the seal author, which generated ~146.6k output tokens over
17m49s (and counting) at a sustained ~137 tok/s — wall time was pure thinking
volume, not stalls. Ledger trend (ultralearn): ~108k tok / ~10 min @ 0.0.25 →
~240k / ~30 min @ 0.0.29 → ~197k / 26 min @ 0.0.30, tracking spec size and
ambient session settings, with no engine change in between. The cost of the
single most expensive fixed-cost agent in the arc was set by accident.

## Design

One channel owns each knob, per the #89 single-channel doctrine:

- **Effort** — pinned in a new plugin agent definition `agents/seal-author.md`
  (`effort: high` frontmatter; Claude Code auto-discovers plugin `agents/`
  dirs, addressed as `ultrapowers:seal-author`). Omitting the key would
  re-inherit the session's ambient effort — the defect this exists to prevent.
- **Tier** — stays a dispatch-time decision ("most-capable tier" in the
  brief); the definition deliberately carries **no** `model:` key so a second
  tier channel cannot appear.
- **Brief** — stays single-sourced in
  `skills/ultraplan/references/seal-author-prompt.md`; the agent-definition
  body is a thin pointer, not a second prompt source.

Both dispatch texts (the brief header and the ultraplan sealing step) name
the agent type so the pin actually applies. Escalation needs no machinery:
an operator who wants a hotter seal says so, explicitly.

## Acceptance

Committed suite. `tests/test_seal_author_agent.py` pins: definition exists,
`effort: high` present, no `model:` key, both dispatch texts carry
`ultrapowers:seal-author`, neither dispatch text regrows its own effort
value, and the brief keeps "most-capable tier".

## Non-goals / queued

Sealing at spec-approval time (asynchronous, off the human critical path) is
the larger clock win and is queued separately as a GitHub issue — it changes
*when* the fixed cost is paid; this spec only makes the cost deliberate.
