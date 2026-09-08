#!/usr/bin/env bash
#
# fleet/strip-exams.sh — the run's reserved exam directories, off its branch and
# onto its record.
#
#   bash fleet/strip-exams.sh <target-clone> <branch> <run-id> <evidence-dest>
#
# A run's exams are written into directories reserved for them —
# `tests/exams/<slug>/` and `fleet/tests/exams/<slug>/`, where `<slug>` is the
# run id with every character outside `[A-Za-z0-9_]` replaced by `_` — and they
# belong to the run, not to the target. The fold has to see them (they are what
# the fold's suite runs), and the operator opening the pull request must not:
# an exam is the run's measurement of its own work, and a diff that carries it
# asks a reader to review a test written for one branch's sake. So the exams
# ride the branch through every fold and come off it here, in the last step
# before the push, copied into the evidence worktree where the run's record
# already lives — `<evidence-dest>/exams/<the directory the branch held>/…`,
# byte for byte, under the same paths — and removed from the branch in one
# commit whose tree is otherwise the tip's, path for path.
#
# Plumbing, not a checkout. The target clone's working tree is at `base=` and
# its HEAD is on the base's branch; `<branch>` is a ref this script never checks
# out. Every read is of the ref, the new tree is built in a temporary index of
# this script's own, and the only thing that moves is `refs/heads/<branch>` —
# so the clone's HEAD, index and working tree are exactly what they were when
# this returns. The caller is `push_head` in `fleet/sandbox-boot.sh`, which runs
# this on every push attempt: the fold floors on the attempt's own candidate, so
# a second attempt returns the exams to the branch and this strips them again.
#
# Idempotent by its own answer: a branch with neither directory in its tree is a
# branch that says `nothing to strip` and is left alone, which is what a re-run
# of the same attempt sees.
set -euo pipefail

if [ "$#" -ne 4 ]; then
  printf 'usage: strip-exams.sh <target-clone> <branch> <run-id> <evidence-dest>\n' >&2
  exit 2
fi

REPO="$1"
BRANCH="$2"
RUN_ID="$3"
DEST="$4"

# The slug rule, the same one `fleet/exam-paths.mjs` spells for the engine:
# `run-7` → `run_7`. `printf '%s'` writes no trailing newline, so `tr` sees the
# id and nothing else; `\n` stays in the retained set all the same, so a `tr`
# that is ever handed a stream keeps its lines.
SLUG="$(printf '%s' "$RUN_ID" | tr -c 'A-Za-z0-9_\n' '_')"

# The two reserved directories, in the order a reader of the diff meets them.
RESERVED="tests/exams/$SLUG fleet/tests/exams/$SLUG"

git_ref() { git -C "$REPO" "$@"; }

# The ones this branch actually holds. `ls-tree -d` prints the tree entry when
# the directory is there and nothing at all when it is not, so the answer is
# whether the line came.
present=()
for dir in $RESERVED; do
  if [ -n "$(git_ref ls-tree -d --name-only "$BRANCH" -- "$dir")" ]; then
    present+=("$dir")
  fi
done

if [ "${#present[@]}" -eq 0 ]; then
  printf '%s: nothing to strip — %s carries no reserved exam directory\n' \
    "$RUN_ID" "$BRANCH"
  exit 0
fi

OLD="$(git_ref rev-parse "$BRANCH")"

# THE RECORD FIRST. The copy is made from the ref before the ref moves, so a
# strip that dies between the two has published the exams and stripped nothing
# — the harmless order — rather than removed them from the only place they were.
for dir in "${present[@]}"; do
  git_ref ls-tree -r --name-only "$BRANCH" -- "$dir" | while IFS= read -r blob; do
    mkdir -p "$DEST/exams/$(dirname "$blob")"
    git_ref cat-file blob "$BRANCH:$blob" >"$DEST/exams/$blob"
  done
done

# THE BRANCH. A temporary index, because the clone's own index is the operator's
# view of the working tree and this script does not touch it; `update-index
# --force-remove` rather than `git rm --cached`, because the paths being removed
# are on the branch and in neither HEAD nor the working tree, which is exactly
# the state `git rm`'s up-to-date check refuses.
INDEX="$(mktemp "${TMPDIR:-/tmp}/strip-exams-index.XXXXXX")"
trap 'rm -f "$INDEX"' EXIT
# `read-tree` wants the file absent or a valid index, never the empty one
# `mktemp` just made.
rm -f "$INDEX"

# Exported for the three commands that read an index and unset again straight
# after, so nothing below this block can be reading it by accident.
export GIT_INDEX_FILE="$INDEX"
git_ref read-tree "$BRANCH"
git_ref ls-files -z -- "${present[@]}" | git_ref update-index -z --force-remove --stdin
TREE="$(git_ref write-tree)"
unset GIT_INDEX_FILE

# An identity only when the clone has none: the boot script sets one on the
# target clone, and a value here would override it.
if ! git_ref config --get user.email >/dev/null 2>&1; then
  export GIT_AUTHOR_NAME="fleet" GIT_AUTHOR_EMAIL="fleet@localhost"
  export GIT_COMMITTER_NAME="fleet" GIT_COMMITTER_EMAIL="fleet@localhost"
fi

NEW="$(git_ref commit-tree "$TREE" -p "$OLD" -m "$RUN_ID: exams to the record")"
# The old sha as the expected value: another writer between the read and here
# loses the race and this exits non-zero rather than dropping its commits.
git_ref update-ref "refs/heads/$BRANCH" "$NEW" "$OLD"

printf '%s: exams to the record — %s stripped from %s (%s → %s), copied under %s\n' \
  "$RUN_ID" "${present[*]}" "$BRANCH" "$OLD" "$NEW" "$DEST/exams"
