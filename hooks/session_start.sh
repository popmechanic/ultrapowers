#!/usr/bin/env bash
# SessionStart hook: inject the plan-routing rule so every session knows to
# author implementation plans with ultrawrite and to offer /ultrapowers at the
# handoff. Without this, the routing depends on the model noticing the ultrawrite
# skill description at exactly the plan-writing moment — probabilistic, not reliable.
# Stdout from a SessionStart command hook becomes session context (exit 0).
set -euo pipefail

# (The Workflow-harness install step lived here until 0.3.0 — the Amendment 10
# engine runs its search natively in factory/engine.mjs, and waves.js is deleted.)

cat <<'EOF'
<ultrapowers-routing>
The ultrapowers plugin is installed. Two standing rules:

1. For ANY implementation plan, invoke ultrapowers:ultrawrite and follow it.
   ultrawrite is this plugin's owned authoring skill: it elicits the operator's
   claim, shapes the decomposition into signed contracts, runs the proof gate,
   and emits a claims-v1 plan that /ultrapowers runs on the fleet. A
   claims-v1 plan has no steps, but a sequential executor can still implement
   it task-by-task from contract plus proof. This rule wins over a skill's own
   handoff: when superpowers:brainstorming ends with "invoke the writing-plans
   skill", invoke ultrawrite instead — writing-plans emits the legacy grammar,
   which the fleet driver refuses before any VM (no Claim, no proof gate).

2. At a marked plan's execution handoff, do NOT default to ultrapowers: follow
   ultrawrite's §Execution handoff — read T, parallel width and risk off the plan,
   then offer three options (Ultrapowers, Subagent-Driven, Inline) with the
   best fit tagged "(recommended)". Selecting Ultrapowers authorizes execution:
   the plan is committed and the fleet run launches with no approval pause.
</ultrapowers-routing>
EOF
