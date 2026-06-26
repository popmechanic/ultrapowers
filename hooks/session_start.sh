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
  installed_set=""
  # One python3 pass lists every manifest's `file` (was one spawn per manifest).
  files="$(python3 -c "
import glob, json, os, sys
for m in sorted(glob.glob(os.path.join(sys.argv[1], '*.harness.json'))):
    try:
        f = json.load(open(m)).get('file')
    except Exception:
        continue
    if f:
        print(f)
" "$harnesses")"
  for f in $files; do
    [ -e "$harnesses/$f" ] || continue
    # Skip the copy when the installed copy is byte-identical (the common no-change
    # session) — avoids an unconditional 74KB write of waves.js every session start.
    cmp -s "$harnesses/$f" "$dest/$f" 2>/dev/null || cp "$harnesses/$f" "$dest/$f"
    installed_set="$installed_set $f"
  done
  # GC: remove any .js files in the workflows dir that are not in the current
  # manifest set — stale orphans from older plugin versions (e.g. workflow.js
  # from 0.0.6) would otherwise accumulate and shadow the current harnesses.
  for existing in "$dest"/*.js; do
    [ -e "$existing" ] || continue
    base="$(basename "$existing")"
    case " $installed_set " in *" $base "*) : ;; *) rm -f "$existing" ;; esac
  done
) >/dev/null 2>&1 || true

cat <<'EOF'
<ultrapowers-routing>
The ultrapowers plugin is installed. Two standing rules:

1. Whenever you invoke superpowers:writing-plans — for ANY implementation
   plan — also invoke ultrapowers:ultraplan and follow both. ultraplan layers
   additive Type/Depends-on markers and worktree-pure authoring rules; the
   plan remains fully executable by the sequential superpowers executors.

2. At a marked plan's execution handoff, do NOT default to ultrapowers. First run
   the execution-fit analysis, then offer THREE options, parallel first, tagging
   the single best-fit option "(recommended)". Read three signals off the marked
   plan: T = number of implementation tasks; parallel width = is there a wave with
   ≥2 independent tasks (after treating same-file edits as dependencies); risk =
   sealed acceptance, a high-stakes surface (auth, payments, migrations, data
   integrity, public API), or hard-to-verify behavior. Decide, first match wins:
   risk → Ultrapowers (the risk override); parallel width and T≥4 → Ultrapowers;
   T≤2 → Inline; else → Subagent-Driven. Show a one-line analysis, then:
   1. Ultrapowers — /ultrapowers <plan-path>: parallel waves, worktree isolation,
      per-task review, one pre-merge human gate. Selecting ultrapowers authorizes execution:
      begin implementation immediately after rendering the wave plan, with no approval pause.
   2. Subagent-Driven — superpowers:subagent-driven-development (sequential).
   3. Inline — superpowers:executing-plans (inline).
</ultrapowers-routing>
EOF
