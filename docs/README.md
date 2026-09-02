# docs/

`docs/superpowers/` — the specs, plans, gate-verdict records, intents, the docket and the
ultralearn observation ledger — is **untracked on purpose** (#544, operator decision
2026-09-02): the design record stays out of the GitHub project until the ledger work
(#485, #484, #417) replicates it through a hosted store. It exists on two devices — the
laptop checkout and the orchestrator's `/home/exedev/repo` — each with `docs/superpowers/`
in `.git/info/exclude`, and `rsync` between them is the interim replication
(`fleet/RUNBOOK.md` §Live W1 run). A fresh clone, a fleet sandbox and CI correctly find
nothing here but this file and the tracked media.

A plan does not need to be in git to run: `drive-one.mjs --plan-from-assignment` ships the
plan and its verdict record in the run assignment and the sandbox compiles from that copy.
The tests that used to read the live plans read frozen copies under `tests/fixtures/plans/`.
