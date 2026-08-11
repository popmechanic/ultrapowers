# Review-Packet Branch Naming (#130) Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Review packets are named by branch, not sha pair, so a same-branch redo overwrites its stale predecessor — per spec `docs/superpowers/specs/2026-08-10-review-packet-branch-naming-design.md`.

**Architecture:** One function (`default_name()` in the `review-package` bash script) switches from `review-<base7>..<head7>.diff` to `review-<sanitized-branch>.diff`, with the old sha-pair name as the detached-HEAD fallback. The packet's content header (full `base..head` line) is untouched — the reviewer's recorded-HEAD fallback check stays as-is.

**Tech Stack:** Bash, git, pytest.

**Acceptance:** suite — a bash script and its committed pytest coverage; no `harnesses/*.js` change, so the suite-gate JS guard stays unarmed by construction (spec §Acceptance).

## Global Constraints

- Branch detection MUST be `git branch --show-current` (exit 0, empty output when detached). NOT `git symbolic-ref --short HEAD` — it exits 128 when detached and, in the assignment form, kills the script under `set -euo pipefail`; the existing `test_packet_dir_shared_across_worktrees` runs the script in a detached worktree.
- Sanitization: every character outside `[A-Za-z0-9._-]` maps to `-`.
- The packet content (header, Commits, Files changed, Diff sections) does not change. The explicit-OUTFILE and trailing-slash forms keep their behavior; the directory form receives the new default name.
- Only `skills/ultrapowers/scripts/review-package` and `tests/test_review_package.py` change. No harness, prompt, gate, or frozen-periphery file.
- Suite gate: `python3 -m pytest` green from the repo root.

---

### Task 1: Branch-derived `default_name()` + tests

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/scripts/review-package:8,56-58`
- Test: `tests/test_review_package.py`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing consumed by other tasks (single-task plan). Externally: the packet default filename becomes `review-<sanitized-branch>.diff` (branch case) / `review-<base7>..<head7>.diff` (detached case); stdout echo contract unchanged.

- [ ] **Step 1: Write the failing tests**

In `tests/test_review_package.py`, replace the two-line sha-pair assertion in `test_outfile_trailing_slash_is_a_target_directory` (lines 144–146):

```python
    assert out_path.name == "review-main.diff"   # branch-derived (fixture repo is on main)
```

(The `base7`/`head7` lines above it are then unused in that test — delete them.)

Append three new tests:

```python
def test_same_branch_redo_overwrites_predecessor(tmp_path):
    # The #130 trap: a redo on the SAME branch must overwrite the stale
    # packet, not accrete beside it — at most one packet per branch.
    repo, base, head = make_repo(tmp_path)
    p1 = run_script(repo, base, head)
    assert p1.returncode == 0, p1.stderr
    first = pathlib.Path(p1.stdout.strip().splitlines()[-1])
    (repo / "f.txt").write_text("redone line\n")
    git(repo, "add", ".")
    git(repo, "commit", "-m", "third commit subject")
    head2 = git(repo, "rev-parse", "HEAD").stdout.strip()
    p2 = run_script(repo, base, head2)
    assert p2.returncode == 0, p2.stderr
    second = pathlib.Path(p2.stdout.strip().splitlines()[-1])
    assert second == first                      # same filename: overwrite, not accrete
    packets = list(first.parent.glob("review-*.diff"))
    assert packets == [first]                   # exactly one packet on disk
    body = first.read_text()
    assert "third commit subject" in body       # content is the redo's
    assert head2 in body                        # header records the new head


def test_branch_name_is_sanitized(tmp_path):
    repo, base, head = make_repo(tmp_path)
    git(repo, "checkout", "-b", "ultra/task_3+x")
    p = run_script(repo, base, head)
    assert p.returncode == 0, p.stderr
    out_path = pathlib.Path(p.stdout.strip().splitlines()[-1])
    # `/` and `+` map to `-`; `_` and `.` survive.
    assert out_path.name == "review-ultra-task_3-x.diff"


def test_detached_head_falls_back_to_sha_pair_name(tmp_path):
    repo, base, head = make_repo(tmp_path)
    git(repo, "checkout", "--detach", head)
    p = run_script(repo, base, head)
    assert p.returncode == 0, p.stderr
    out_path = pathlib.Path(p.stdout.strip().splitlines()[-1])
    base7 = git(repo, "rev-parse", "--short", base).stdout.strip()
    head7 = git(repo, "rev-parse", "--short", head).stdout.strip()
    assert out_path.name == f"review-{base7}..{head7}.diff"
```

- [ ] **Step 2: Run the four tests to verify they fail**

Run: `python3 -m pytest tests/test_review_package.py -v -k "trailing_slash or redo or sanitized or detached"`
Expected: 3 FAIL (name assertions — today every case yields the sha-pair name) + 1 PASS (`detached` — the fallback IS today's behavior; it pins the regression).

- [ ] **Step 3: Implement**

In `skills/ultrapowers/scripts/review-package`, replace `default_name()` (currently lines 56–58):

```bash
default_name() {
  # Branch-derived: one packet per branch, so a same-branch redo OVERWRITES
  # its stale predecessor (#130 — a sha-pair name let a packet outlive a
  # history rewrite and point at a commit no branch contained). Detached
  # HEAD (--show-current prints nothing, exit 0) falls back to the sha-pair
  # name — no branch identity exists to key on.
  local branch
  branch=$(git branch --show-current)
  if [ -n "$branch" ]; then
    echo "review-$(printf '%s' "$branch" | tr -c 'A-Za-z0-9._-' '-').diff"
  else
    echo "review-$(git rev-parse --short "$base")..$(git rev-parse --short "$head").diff"
  fi
}
```

And update the usage comment's default-OUTFILE line (line 8) to:

```bash
# Default OUTFILE: <main-repo-root>/.claude/ultrapowers/scratch/review-<branch>.diff
# (branch sanitized to [A-Za-z0-9._-]; detached HEAD falls back to
# review-<base7>..<head7>.diff). One packet per branch: a redo overwrites.
```

- [ ] **Step 4: Run the four tests to verify they pass**

Run: `python3 -m pytest tests/test_review_package.py -v`
Expected: all PASS (the untouched tests assert directories and content, never the default filename).

- [ ] **Step 5: Run the full suite**

Run: `python3 -m pytest`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/scripts/review-package tests/test_review_package.py
git commit -m "fix(#130): review packets named by branch — a redo overwrites its stale predecessor"
```
