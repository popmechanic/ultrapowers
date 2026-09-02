# plans/ is historical

Since 0.3.0 the per-wave plan is machine-derived and disposable, so the files in
this directory are **historical** — a record of how past runs were shaped, not
the input to a new one. The signed artifact that drives a run now lives in
[`../intents/`](../intents/): you sign an intent, and the compiler derives the
plan from it wave by wave.

See [`CLAUDE.md`](../../../CLAUDE.md) for the current plan shape and where each
document in `docs/superpowers/` fits.
