# PROTOTYPE — fleet dashboard (#182) — THROWAWAY, wipe me

**One self-contained HTML file, no build, no deps.** Open
`index.html` in a browser (or `python3 -m http.server` in this dir).
Three structurally different variants of the fleet pane, switchable with the
floating pill or ←/→ keys, `?variant=A|B|C` in the URL.

The question: **what does the operator actually need to see, and what is
noise?** Data is a simulated snapshot of the #178 validated store schema
(runs / claims / budgets / spend / receipts) plus #181's page-classes; the
SIMULATED badge is always on (viewer honesty contract).

- **A — Drain board.** Columns by run status; the docket frontier as a flow,
  arrival-order fold lane at the bottom, page alerts on top.
- **B — Ops table.** One dense receipts-verbatim row per run; aggregates
  strip; parked rows tinted; claim state shown as derived (store + clock).
- **C — Attention triage.** Inverts the hierarchy: ONLY things needing the
  operator render full-width (pages, parks with why + suggested next act);
  healthy runs collapse to a one-line tickertape. Noise hidden by default —
  the #181 park-by-default doctrine as a screen.
