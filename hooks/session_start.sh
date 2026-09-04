#!/usr/bin/env bash
# SessionStart hook: inject the plan-routing rule so every session knows to
# author implementation plans with ultrawrite and to offer /ultrapowers at the
# handoff. Without this, the routing depends on the model noticing the ultrawrite
# skill description at exactly the plan-writing moment — probabilistic, not reliable.
# Stdout from a SessionStart command hook becomes session context (exit 0).
set -euo pipefail

# (The Workflow-harness install step lived here until 0.3.0 — the Amendment 10
# engine runs waves natively in fleet/run-engine.mjs, and waves.js is deleted.)

cat <<'EOF'
<ultrapowers-routing>
The ultrapowers plugin is installed. Two standing rules:

1. For ANY implementation plan, invoke ultrapowers:ultrawrite and follow it.
   ultrawrite is this plugin's owned authoring skill: it elicits the operator's
   claim, shapes the decomposition into signed contracts, runs the proof gate,
   and emits a claims-v1 plan that /ultrapowers compiles into waves. A
   claims-v1 plan has no steps, but a sequential executor can still implement
   it task-by-task from contract plus proof. This rule wins over a skill's own
   handoff: when superpowers:brainstorming ends with "invoke the writing-plans
   skill", invoke ultrawrite instead — writing-plans emits the legacy grammar,
   which the fleet driver refuses before any VM (no Claim, no proof gate).

2. At a marked plan's execution handoff, do NOT default to ultrapowers. First run
   the execution-fit analysis, then offer THREE options, parallel first, tagging
   the single best-fit option "(recommended)". Read three signals off the marked
   plan: T = number of implementation tasks; parallel width = is there a wave with
   ≥2 independent tasks, after treating non-text same-file edits between tasks as dependencies (text overlap folds at merge); risk =
   a high-stakes surface (auth, payments, migrations, data
   integrity, public API, loops/cursors/pagination/budgets/termination logic), or hard-to-verify behavior. Decide, first match wins:
   risk → Ultrapowers (the risk override); parallel width and T≥3 → Ultrapowers;
   T≤2 → Inline; else → Subagent-Driven. Show a one-line analysis, then:
   1. Ultrapowers — /ultrapowers <plan-path>: commits the plan and drives it on the
      exe.dev fleet (parallel waves in a sandbox, per-task review, the orchestrator
      opens the PR). Selecting ultrapowers authorizes execution: the plan is committed
      and the fleet run launched immediately, with no approval pause.
   2. Subagent-Driven — superpowers:subagent-driven-development (sequential).
   3. Inline — superpowers:executing-plans (inline).
</ultrapowers-routing>
EOF
