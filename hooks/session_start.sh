#!/usr/bin/env bash
# SessionStart hook: inject the plan-routing rule so every session knows to
# layer ultraplan onto writing-plans and to offer /ultrapowers at the handoff.
# Without this, the routing depends on the model noticing the ultraplan skill
# description at exactly the plan-writing moment — probabilistic, not reliable.
# Stdout from a SessionStart command hook becomes session context (exit 0).
set -euo pipefail

# Install the committed harnesses as project saved workflows NOW, at session
# start, so the Workflow engine picks them up when it snapshots its saved-
# workflow registry. The engine builds that registry once per session; a copy
# made mid-session (SKILL.md Step 4a) is only registered NEXT session, which is
# why a fresh checkout's first `/ultrapowers` saw "Workflow 'ultrapowers-probe'
# not found" (the project .claude/workflows/ is gitignored and plugins cannot
# ship saved workflows, so the dir was empty at the registry snapshot). Doing
# the install here closes that window. Guarded so it can NEVER break the hook's
# real contract — emitting the routing rule below; all output is swallowed and
# any failure (no python3, read-only fs, etc.) just defers to Step 4a.
(
  set +eu
  plugin_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  harnesses="$plugin_root/skills/ultrapowers/harnesses"
  dest="${CLAUDE_PROJECT_DIR:-$PWD}/.claude/workflows"
  mkdir -p "$dest"
  for m in "$harnesses"/*.harness.json; do
    [ -e "$m" ] || continue
    f="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['file'])" "$m")"
    [ -n "$f" ] && [ -e "$harnesses/$f" ] && cp "$harnesses/$f" "$dest/$f"
  done
) >/dev/null 2>&1 || true

cat <<'EOF'
<ultrapowers-routing>
The ultrapowers plugin is installed. Two standing rules:

1. Whenever you invoke superpowers:writing-plans — for ANY implementation
   plan — also invoke ultrapowers:ultraplan and follow both. ultraplan layers
   additive Type/Depends-on markers and worktree-pure authoring rules; the
   plan remains fully executable by the sequential superpowers executors.

2. At a marked plan's execution handoff, offer THREE options, parallel first:
   1. /ultrapowers <plan-path> (recommended for marked plans) — parallel
      waves, worktree isolation, per-task review, one pre-merge human gate.
      Selecting this option authorizes execution: begin implementation
      immediately after rendering the wave plan, with no approval pause.
   2. superpowers:subagent-driven-development (sequential).
   3. superpowers:executing-plans (inline).
</ultrapowers-routing>
EOF
