# `plans/` is historical

Since version 0.3.0 the signed artifact that drives a run is the intent
document under [`../intents/`](../intents/), not a plan: the per-wave plan is
machine-derived from that intent and disposable, so nothing in this directory
is an input to a run any more. The files kept here are the historical record of
how earlier work was planned — read them for context, never as the source of
truth for what a run executes. See [`CLAUDE.md`](../../../CLAUDE.md) for the
current plan shape and the routing rule that produces it.
