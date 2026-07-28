# #96 suite-bootstrap cell — false_block 1→0

Deterministic (no-LLM) cell per docs/superpowers/specs/2026-07-27-gate-derives-inputs.md.

| arm | engine-ref | falseBlock | status |
|-----|-----------|------------|--------|
| baseline (0.1.12) | f2efcd3 | 1 | OK |
| fixed (this branch) | HEAD | 0 | OK |

Counter contract met: the cell's false-block counter went 1→0; no other cell's
counters regress (no other cells were re-run — the deterministic cell shares no
state with the A/B protocol rows); pytest suite and harness sims green on this
branch (see the plan's gate task).
