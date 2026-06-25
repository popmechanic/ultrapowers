#!/usr/bin/env bash
# Self-host preflight: compare the installed (cached) engine to the repo engine.
# When /ultrapowers self-hosts in the ultrapowers repo, the cache can lag repo
# main and the run would exercise the wrong engine ([ae56a1205e971b82]).
#
# Usage: check_engine_skew.sh <cached_dir> <repo_dir>
#   cached_dir: root of the installed plugin cache (e.g. ~/.claude/plugins/cache/.../ultrapowers/<ver>)
#   repo_dir:   root of the repository being developed (e.g. the session repo)
# Exit 0 + "IN_SYNC" stdout when the two harnesses/waves.js hash-match.
# Exit 1 + "SKEW" on stderr when they differ or either file is missing.
set -eu
cached="${1:?usage: check_engine_skew.sh <cached_dir> <repo_dir>}"
repo="${2:?usage: check_engine_skew.sh <cached_dir> <repo_dir>}"
cf="$cached/skills/ultrapowers/harnesses/waves.js"
rf="$repo/skills/ultrapowers/harnesses/waves.js"
if [ ! -f "$cf" ] || [ ! -f "$rf" ]; then
  echo "SKEW: missing engine file (cached=$cf exists=$([ -f "$cf" ] && echo yes || echo no), repo=$rf exists=$([ -f "$rf" ] && echo yes || echo no))" >&2
  exit 1
fi
if [ "$(shasum -a 256 "$cf" | cut -d' ' -f1)" = "$(shasum -a 256 "$rf" | cut -d' ' -f1)" ]; then
  echo "IN_SYNC"
  exit 0
fi
echo "SKEW: cached engine differs from repo engine — install the repo engine into .claude/workflows/ before launch" >&2
exit 1
