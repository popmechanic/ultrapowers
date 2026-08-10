# Addendum — does the same-file rule bind in the real plan corpus? (2026-08-10)

Follow-up measurement to `2026-08-10-readjudication.md`, answering the
materiality question's missing half: the contend fixture shows the
serialization rule costs 41% *when contention exists*; this measures how often
contention exists in plans as actually authored. Method: compile all 84
archived plans in `docs/superpowers/plans/` with the committed
`compile_plan.py`, count dependency edges by why-label, and compute modeled
makespans (waves vs frontier vs frontier without same-file edges), averaged
over 20 duration seeds (uniform 60–600s — same model as the probe; same
caveat: modeled, not measured). 69 plans have ≥2 implementation tasks; 14
have fewer (nothing to parallelize); 1 pre-ultraplan plan fails to compile.

## Result: the rule binds in 2 of 69 plans — both pre-rule relics

- **Same-file edges exist in 14/69 plans** (43 edges corpus-wide:
  30 `write-after-write`, 11 `ambiguous-files`, 2 `write-after-create`,
  against 162 explicit `marker` edges).
- **Dropping same-file edges shortens the modeled makespan in exactly 2
  plans**: `2026-06-02-ultrapowers-implementation.md` (45.8% recovery) and
  `2026-06-05-ultrapowers-improvement-plan.md` (58.1%) — the two plans
  written *before* ultraplan and its serialization discipline existed.
- **In all 67 post-ultraplan plans the recovery is 0.0%**, including the 12
  that carry same-file edges: those edges are off the critical path or
  redundant with explicit marker dependencies that exist for semantic
  reasons and would serialize the tasks regardless.

## Reading

The two pre-rule plans are the counterfactual glimpse: unconstrained
authoring *does* pile tasks onto shared files, and the kernel-measured 41–58%
recovery is real on that shape. But under the rule, that shape does not
occur — modern plans are authored (interfaces, file ownership, explicit
markers) so that same-file contention is designed away before compilation.
The compiled cost of the rule on the corpus that actually runs is zero.

What this count cannot see: the rule's cost is paid at **authoring time**
(decomposition contortions to avoid file sharing) rather than at execution
time. That cost is real but unmeasurable from compiled plans, and no sense
pass to date has surfaced same-file serialization as a recurring pain
cluster.

## Incidental finding — barrier removal on real plans

The same sweep gives S1's *barrier* column on real shapes, which the fixture
corpus understated (0–4.9%): across the 69 real plans, barrier-free
scheduling recovers a **mean 4.9% / median 1.4% / max 21.7%** of modeled
makespan, with 30 plans above 5%. Wave barriers are cheap on average but not
uniformly free. Recorded for completeness; this is clock, modeled, and no
gate turns on it.

## Disposition suggested by the numbers

The contend fixture's 41% does not materialize on the corpus as authored:
same-file relaxation as a makespan play is **shelve-confirmed-with-teeth**.
The residual open questions — authoring-time cost of the rule, and whether
the barrier-removal tail (up to ~22%, modeled) is worth anything — are
recorded here for any future look; neither is evidence the pre-registered
rule counts today. Operator adjudication over `2026-08-10-readjudication.md`
plus this addendum stands as the cycle's close.
