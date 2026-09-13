#!/usr/bin/env python3
"""split_fixture — one eval fixture's reference tree, split back into the
per-task patches the plan says produced it.

An eval fixture under `evals/fixtures/<name>/` carries a `plan.md`, the
`project/` tree the plan is executed against, and — for the three real-join
fixtures — a `reference/` tree holding the answer. The fold-order sim
(`fleet/tests/test_readiness_fold_order.mjs`) needs that answer as a WAVE: one
`git diff --binary --full-index --no-renames <BASE>` per task, all of them
taken against the same BASE, so the kernel can fold them simultaneously and in
every adoption order and be graded on whether every order lands the same tree.

This script is how those patches are produced, once, and it is the only place
a split decision is ever recorded: the fixtures themselves are ground truth and
are never edited to make a split come out (#360 §Ground truth). A split error —
an atom no rule claims, one two tasks claim, or an ownership the kernel cannot
fold back into `reference/` — is resolved in `OVERRIDES` below and nowhere
else; anything left over is a non-zero exit naming the atom, never a guess.

The split rule
--------------
For every path under `reference/`, diff the `project/` copy (empty when the
path is a creation) against the `reference/` copy and cut the difference into
ATOMS:

  * the added lines of one change region are cut into blocks — a new block at
    every added line indented no deeper than the region's first, except a
    continuation (`else:`, `elif`, `except:`, `finally:`, a closing bracket),
    which stays with the block it continues.  That is the "keep a block with
    its header's task" rule: a function's body rides with its `def`.
  * each deleted line of the region is paired to the added line it most
    resembles (difflib's own fancy-replace pairing, cutoff 0.6) and rides with
    that line's block; an unpaired deletion rides with its nearest paired
    neighbour.

An atom is claimed by the task whose DECLARED SYMBOL its added lines mention:

  tier 1  the flags a task's section names (`--verbose`), matched literally;
  tier 2  the identifiers inside that section's backticked code spans, matched
          as whole words, after every `--flag` span is masked out so `--header`
          never lends its name to a task that only declares the flag.

A symbol two tasks of the same fixture declare is discriminating for neither
and is dropped. A task can only claim an atom in a path its `Files:` block
declares, and a path exactly one task declares needs no claim at all.

Output
------
`<out-dir>/task-<id>.patch` for every task whose Files block carries a
`Modify:` or `Create:` path, plus `<out-dir>/manifest.json` describing the wave
for the sim, plus `<out-dir>/replies/<path>/h<N>.txt` — the committed answer to
each merge the fold leaves to a resolver. Nothing is written until the fixture
has been read and split, so a fixture with no `reference/` tree leaves the
out-dir untouched.

Contention and commutes
-----------------------
Two tasks that add lines at ONE anchor do not commute: the kernel's weave
orders concurrent additions by line CONTENT, and `reference/` orders them by
task, so such a path is left out of the manifest's `commutes` and its one merge
goes to the resolver, answered by the committed reply. Everywhere else the
regions have an owner apiece, the fold is clean, and `commutes` carries every
path two tasks share.
"""
import argparse
import builtins
import difflib
import json
import keyword
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURES_DIR = REPO_ROOT / "evals" / "fixtures"

# The scratch BASE's identity and clock, fixed so the commit — and therefore
# every patch taken against it — is the same sha on every box.
BASE_STAMP = "2026-08-31T00:00:00+00:00"
BASE_NAME = "ultrapowers fixture split"
BASE_EMAIL = "fixtures@example.invalid"

# ── the override table ────────────────────────────────────────────────────
#
# One entry per atom no declared symbol claims, two tasks claim, or whose
# symbol-given owner the kernel could not fold back into `reference/`. The key is
# `(fixture, path, header)` — `header` being the atom's first non-blank added
# line, stripped — and the value is the task id that owns it. Adding a fixture
# means running the script and reading the atoms it names.
OVERRIDES = {
    # The reference solution's docstring: no task's symbol appears in it, and
    # it has to ride with someone. The first task that edits the file takes it.
    ("contend", "clitool/cli.py",
     '"""Tiny report CLI: parse args, list rows, print them. Reference solution."""'): "1",
    ("contend-wide", "clitool/cli.py",
     '"""Tiny report CLI: parse args, list rows, print them. Reference solution."""'): "1",
    # `import re` is `parse_value`'s dependency — task 1's, though the task
    # text never names the module.
    ("degrade", "confkit/config.py", "import re"): "1",

    # ── one writer per change region ──────────────────────────────────────
    # A region two tasks both add lines to is merged by the kernel's own
    # weave, and that weave orders concurrent additions at one anchor by line
    # CONTENT, not by task.  `reference/` orders them by task, so a region
    # with two writers can never fold back to `reference/` on its own; a
    # region with two writers ONE OF WHICH DELETES cannot even fold clean.
    # Both are split errors, so both are settled here: every region below is
    # given to one task, chosen so that no task is left with nothing.
    #
    # contend/clitool/cli.py — docstring→1, parser gap→1, helper gap→2,
    # main body→3 (task 4 has clitool/textutil.py to itself).
    ("contend", "clitool/cli.py",
     'parser.add_argument("--format", choices=["plain", "csv"], default="plain")'): "1",
    ("contend", "clitool/cli.py",
     'parser.add_argument("--limit", type=int, default=None)'): "1",
    ("contend", "clitool/cli.py", "def clamp(rows, limit):"): "2",
    ("contend", "clitool/cli.py", "if args.verbose:"): "3",
    ("contend", "clitool/cli.py", "for row in rows:"): "3",
    # degrade/confkit/config.py — the `import re` line is task 1's (above);
    # the one body region, whose rewrite of `get_config` deletes, is task 2's.
    ("degrade", "confkit/config.py", "def parse_value(raw):"): "2",
    ("degrade", "confkit/config.py", "def load_env_overrides(environ):"): "2",
    # contend-wide/clitool/cli.py — eight tasks over five regions, so the two
    # pure-addition regions (the parser gap and the helper gap) stay shared
    # and are settled by a committed reply; the deleting region, `main`'s
    # body, goes to task 6 whole so the fold has one conflict, not two.
    ("contend-wide", "clitool/cli.py", "if args.sort:"): "6",
    ("contend-wide", "clitool/cli.py", "if args.reverse:"): "6",
    ("contend-wide", "clitool/cli.py", "rows = clamp(rows, args.limit)"): "6",
    ("contend-wide", "clitool/cli.py", "if args.verbose:"): "6",
    ("contend-wide", "clitool/cli.py", "if args.header:"): "6",
    ("contend-wide", "clitool/cli.py", "if args.json:"): "6",
}

_STOPWORDS = (set(keyword.kwlist) | set(dir(builtins))
              | {"self", "args", "argv", "None", "True", "False"})

_FLAG_RE = re.compile(r"--[A-Za-z][A-Za-z0-9_-]*")
_CODE_SPAN_RE = re.compile(r"`([^`\n]+)`")
_IDENT_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
_TASK_HEAD_RE = re.compile(r"^###\s+Task\s+([0-9A-Za-z._-]+)\s*:\s*(.*)$")
_FILES_HEAD_RE = re.compile(r"^\*\*Files:\*\*\s*(.*)$")
_FILES_BULLET_RE = re.compile(r"^-\s*(Modify|Create|Test|Delete)\s*:\s*`([^`]+)`")
_CONTINUATION_RE = re.compile(r"^(else\b|elif\b|except\b|finally\b|[)\]}])")


class SplitError(Exception):
    """A split this script refuses to guess at."""


# ── the plan ──────────────────────────────────────────────────────────────

class Task:
    def __init__(self, task_id, title):
        self.id = task_id
        self.title = title
        self.lines = []
        self.files_lines = []
        self.writes = []          # Modify:/Create: paths, in declaration order
        self.flags = set()
        self.idents = set()

    @property
    def text(self):
        return "".join(self.lines)

    @property
    def prose(self):
        """The section minus its Files block — test paths are not symbols."""
        body = self.text
        for line in self.files_lines:
            body = body.replace(line, "")
        return body


def parse_plan(plan_path):
    """Every `### Task <id>` section of a plan, in plan order."""
    tasks = []
    current = None
    in_files = False
    for line in plan_path.read_text().splitlines(keepends=True):
        head = _TASK_HEAD_RE.match(line.rstrip("\n"))
        if head:
            current = Task(head.group(1), head.group(2).strip())
            tasks.append(current)
            in_files = False
            continue
        if current is None:
            continue
        current.lines.append(line)
        stripped = line.rstrip("\n")
        files_head = _FILES_HEAD_RE.match(stripped)
        if files_head:
            in_files = True
            current.files_lines.append(line)
            continue
        if in_files:
            bullet = _FILES_BULLET_RE.match(stripped)
            if bullet:
                current.files_lines.append(line)
                if bullet.group(1) in ("Modify", "Create"):
                    current.writes.append(bullet.group(2))
                continue
            if stripped.strip():
                in_files = False
    if not tasks:
        raise SplitError("%s names no `### Task` section" % plan_path)
    return tasks


def declare_symbols(tasks):
    """Fill each task's `flags`/`idents` with the symbols that discriminate it
    from every other task of the same plan."""
    for task in tasks:
        prose = task.prose
        task.flags = set(_FLAG_RE.findall(prose))
        masked = _FLAG_RE.sub(" ", prose)
        idents = set()
        for span in _CODE_SPAN_RE.findall(masked):
            for token in _IDENT_RE.findall(span):
                if len(token) >= 3 and token not in _STOPWORDS:
                    idents.add(token)
        task.idents = idents

    for attr in ("flags", "idents"):
        counts = {}
        for task in tasks:
            for symbol in getattr(task, attr):
                counts[symbol] = counts.get(symbol, 0) + 1
        for task in tasks:
            setattr(task, attr, {s for s in getattr(task, attr) if counts[s] == 1})


# ── the atoms ─────────────────────────────────────────────────────────────

class Atom:
    def __init__(self, added, header):
        self.added = added        # the reference lines this atom contributes
        self.header = header      # first non-blank added line, stripped
        self.deleted = []         # project lines it removes, in file order
        self.owner = None

    @property
    def text(self):
        return "".join(self.added)


class Region:
    """One non-equal opcode: project[i1:i2] becomes reference[j1:j2]."""

    def __init__(self, i1, i2, atoms):
        self.i1 = i1
        self.i2 = i2
        self.atoms = atoms


def _indent(line):
    return len(line) - len(line.lstrip(" "))


def _cut_blocks(added):
    """`added` cut into atoms by the block rule."""
    body = [ln for ln in added if ln.strip()]
    if not body:
        return [Atom(list(added), added[0].strip() if added else "")]
    base = _indent(body[0])
    atoms, pending, cur = [], [], None
    for line in added:
        if not line.strip():
            # A blank line separates; it rides with whatever comes next, so a
            # task's own patch carries the blank lines around its own block and
            # not one more.
            pending.append(line)
            continue
        indent = _indent(line)
        starts = (cur is None
                  or (indent <= base and not _CONTINUATION_RE.match(line.strip())))
        if starts:
            cur = Atom(pending + [line], line.strip())
            atoms.append(cur)
            base = min(base, indent)
        else:
            cur.added.extend(pending)
            cur.added.append(line)
        pending = []
    if pending:                          # trailing blanks ride with the last
        atoms[-1].added.extend(pending)
    return atoms


def _best_pair(deleted, added):
    """difflib's fancy-replace pick: the most similar (deleted, added) pair, or
    None when nothing clears the 0.6 cutoff."""
    best, at = 0.6, None
    matcher = difflib.SequenceMatcher()
    for i, d in enumerate(deleted):
        matcher.set_seq2(d)
        for j, a in enumerate(added):
            matcher.set_seq1(a)
            if (matcher.real_quick_ratio() <= best or matcher.quick_ratio() <= best
                    or matcher.ratio() <= best):
                continue
            best, at = matcher.ratio(), (i, j)
    return at


def _pair_deletions(deleted, added, doff, aoff, out):
    """`out[k]` = the index into the region's added lines that deleted line `k`
    pairs with. Recursive on the best pair, so the pairing never crosses
    itself: a deletion below another deletion's partner stays below it."""
    if not deleted or not added:
        return
    at = _best_pair(deleted, added)
    if at is None:
        return
    i, j = at
    out[doff + i] = aoff + j
    _pair_deletions(deleted[:i], added[:j], doff, aoff, out)
    _pair_deletions(deleted[i + 1:], added[j + 1:], doff + i + 1, aoff + j + 1, out)


def _attach_deletions(region_deleted, atoms):
    """Give every deleted line of a region to the atom it belongs with."""
    if not region_deleted:
        return
    added = []
    for k, atom in enumerate(atoms):
        for line in atom.added:
            added.append((line, k))
    paired = {}
    _pair_deletions(list(region_deleted), [ln for ln, _ in added], 0, 0, paired)

    # An unpaired deletion takes the atom of its nearest paired neighbour, and
    # atom 0 when the region paired nothing at all.
    resolved = [paired.get(k) for k in range(len(region_deleted))]
    for k in range(len(resolved)):
        if resolved[k] is not None:
            continue
        for step in range(1, len(resolved) + 1):
            before = k - step
            after = k + step
            if before >= 0 and resolved[before] is not None:
                resolved[k] = resolved[before]
                break
            if after < len(resolved) and resolved[after] is not None:
                resolved[k] = resolved[after]
                break
    for k, line in enumerate(region_deleted):
        atoms[added[resolved[k]][1] if resolved[k] is not None else 0].deleted.append(line)


def atoms_of(project_text, reference_text):
    """`reference − project` as regions of atoms, in file order."""
    project_lines = project_text.splitlines(keepends=True)
    reference_lines = reference_text.splitlines(keepends=True)
    matcher = difflib.SequenceMatcher(None, project_lines, reference_lines,
                                      autojunk=False)
    regions = []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            continue
        added = reference_lines[j1:j2]
        deleted = project_lines[i1:i2]
        atoms = _cut_blocks(added) if added else [Atom([], deleted[0].strip())]
        _attach_deletions(deleted, atoms)
        regions.append(Region(i1, i2, atoms))
    return project_lines, regions


# ── claiming ──────────────────────────────────────────────────────────────

def _claim_in(text, candidates):
    """The tasks one piece of added text names, tier by tier: the flag spelled
    out, then a declared identifier, then a flag's bare name (`args.verbose`
    for `--verbose`). The first tier that picks exactly one task wins."""
    flagged = {t.id for t in candidates if any(f in text for f in t.flags)}
    if len(flagged) == 1:
        return flagged
    words = set(_IDENT_RE.findall(_FLAG_RE.sub(" ", text)))
    named = {t.id for t in candidates if t.idents & words}
    if len(named) == 1:
        return named
    bare = {t.id for t in candidates
            if any(f.lstrip("-") in words for f in t.flags)}
    if len(bare) == 1:
        return bare
    return flagged | named | bare


def _claimants(atom, candidates):
    """The tasks an atom's added lines name — read off the whole atom, and,
    when the whole atom is ambiguous, off its header alone: a block belongs to
    the task its header line belongs to."""
    for text in (atom.text, atom.header):
        claims = _claim_in(text, candidates)
        if len(claims) == 1:
            return claims
    return _claim_in(atom.text, candidates)


def assign(fixture, path, regions, tasks):
    """Give every atom of one path an owner, or raise naming what is left."""
    candidates = [t for t in tasks if path in t.writes]
    if not candidates:
        raise SplitError("%s: %s is in no task's Files block" % (fixture, path))
    unresolved = []
    for region in regions:
        for atom in region.atoms:
            if len(candidates) == 1:
                atom.owner = candidates[0].id
                continue
            override = OVERRIDES.get((fixture, path, atom.header))
            if override is not None:
                if override not in {t.id for t in candidates}:
                    raise SplitError(
                        "%s: the override for %s / %r names task %s, which does not "
                        "write that path" % (fixture, path, atom.header, override))
                atom.owner = override
                continue
            claims = _claimants(atom, candidates)
            if len(claims) == 1:
                atom.owner = claims.pop()
            else:
                unresolved.append((atom.header, sorted(claims)))
    if unresolved:
        raise SplitError(
            "%s: %d atom(s) of %s claimed by %s — add an OVERRIDES entry for each:\n%s"
            % (fixture, len(unresolved), path,
               "no task or by two", "\n".join(
                   '  ("%s", "%s", %r): "?",   # claimed by %s'
                   % (fixture, path, header, ", ".join(claims) or "nobody")
                   for header, claims in unresolved)))


def compose(project_lines, regions, owner):
    """One task's version of a path: its own atoms applied, every other atom's
    project lines left exactly as they were."""
    out, pos = [], 0
    for region in regions:
        out.extend(project_lines[pos:region.i1])
        for atom in region.atoms:
            if atom.owner != owner:
                out.extend(atom.deleted)
            else:
                out.extend(atom.added)
        pos = region.i2
    out.extend(project_lines[pos:])
    return "".join(out)


# ── git ───────────────────────────────────────────────────────────────────

def _env():
    env = dict(os.environ)
    env.update({
        "GIT_AUTHOR_NAME": BASE_NAME, "GIT_COMMITTER_NAME": BASE_NAME,
        "GIT_AUTHOR_EMAIL": BASE_EMAIL, "GIT_COMMITTER_EMAIL": BASE_EMAIL,
        "GIT_AUTHOR_DATE": BASE_STAMP, "GIT_COMMITTER_DATE": BASE_STAMP,
        "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_SYSTEM": os.devnull,
        "LC_ALL": "C", "TZ": "UTC",
    })
    return env


def _git(cwd, *argv, text=True):
    result = subprocess.run(["git", "-C", str(cwd), *argv], capture_output=True,
                            env=_env())
    if result.returncode != 0:
        raise SplitError("git %s in %s failed: %s"
                         % (" ".join(argv), cwd, result.stderr.decode("utf-8", "replace")))
    return result.stdout.decode() if text else result.stdout


def _scratch_base(project, repo):
    """`project/` committed as the BASE every patch is taken against."""
    shutil.copytree(project, repo, dirs_exist_ok=True)
    shutil.rmtree(repo / ".git", ignore_errors=True)
    _git(repo.parent, "init", "--quiet", "--initial-branch=main", str(repo))
    _git(repo, "add", "-A")
    _git(repo, "commit", "--quiet", "-m", "base")
    return _git(repo, "rev-parse", "HEAD").strip()


def _capture(repo, base_sha, clone, contents):
    """One task's whole contribution, captured the way the driver captures it."""
    _git(clone.parent, "clone", "--quiet", str(repo), str(clone))
    for rel, text in sorted(contents.items()):
        target = clone / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)
    _git(clone, "add", "-A")
    return _git(clone, "diff", "--binary", "--full-index", "--no-renames",
                base_sha, text=False)


# ── the split ─────────────────────────────────────────────────────────────

def _reference_paths(reference):
    return sorted(str(p.relative_to(reference)) for p in reference.rglob("*")
                  if p.is_file())


def split_fixture(fixture, out_dir):
    """Split `evals/fixtures/<fixture>/reference` into one patch per task.

    Writes `task-<id>.patch` for every task whose Files block declares a
    `Modify:` or `Create:` path, plus the `manifest.json` the fold-order sim
    reads, and returns the paths written in the order they were written.
    """
    out_dir = Path(out_dir)
    root = FIXTURES_DIR / fixture
    if not root.is_dir():
        raise SplitError("%s: no fixture at %s" % (fixture, root))
    reference = root / "reference"
    if not reference.is_dir():
        raise SplitError("%s: no reference/ tree at %s — a fixture with no "
                         "reference solution cannot be split" % (fixture, reference))
    project = root / "project"
    if not project.is_dir():
        raise SplitError("%s: no project/ tree at %s" % (fixture, project))

    tasks = parse_plan(root / "plan.md")
    declare_symbols(tasks)
    writers = [t for t in tasks if t.writes]
    if not writers:
        raise SplitError("%s: no task declares a Modify: or Create: path" % fixture)

    # One pass over the reference tree: every path's atoms, owned.
    contents = {t.id: {} for t in writers}
    touched = {t.id: [] for t in writers}
    contested = {}            # path -> the regions two tasks both add lines to
    for rel in _reference_paths(reference):
        reference_text = (reference / rel).read_text()
        source = project / rel
        project_text = source.read_text() if source.is_file() else ""
        if project_text == reference_text:
            continue
        project_lines, regions = atoms_of(project_text, reference_text)
        assign(fixture, rel, regions, tasks)
        shared_regions = [r for r in regions if len({a.owner for a in r.atoms}) > 1]
        for task in writers:
            composed = compose(project_lines, regions, task.id)
            if composed != project_text:
                contents[task.id][rel] = composed
                touched[task.id].append(rel)
        # The split is only a split if replaying every atom is the reference.
        replay, pos = [], 0
        for region in regions:
            replay.extend(project_lines[pos:region.i1])
            for atom in region.atoms:
                replay.extend(atom.added)
            pos = region.i2
        replay.extend(project_lines[pos:])
        if "".join(replay) != reference_text:
            raise SplitError("%s: the atoms of %s do not replay reference/%s"
                             % (fixture, rel, rel))
        if shared_regions:
            contested[rel] = [_reply_text(project_lines, regions, replay, region)
                              for region in shared_regions]

    missing = [t.id for t in writers if not contents[t.id]]
    if missing:
        raise SplitError("%s: task(s) %s own no atom, so their patch would be "
                         "empty" % (fixture, ", ".join(missing)))

    # Every task on the file it shares with another task: the wave's contract.
    # A path only commutes when the tasks that share it add lines in regions of
    # their own: the kernel's weave orders two tasks' additions at ONE anchor by
    # line content, which is not the order `reference/` wants, so a path with a
    # contested region is not declared — its one merge is the resolver's, and
    # the committed reply beside the manifest is the answer.
    shared = {rel for rel in set().union(*(set(v) for v in touched.values()))
              if sum(1 for t in writers if rel in touched[t.id]) > 1}
    commutes = {t.id: sorted(rel for rel in touched[t.id]
                             if rel in shared and rel not in contested)
                for t in writers}
    commutes = {tid: paths for tid, paths in commutes.items() if paths}

    manifest = {
        "fixture": fixture,
        "project": "evals/fixtures/%s/project" % fixture,
        "tasks": [{"id": t.id, "patch": "task-%s.patch" % t.id} for t in writers],
        "commutes": commutes,
        "replies": "replies",
    }

    with tempfile.TemporaryDirectory(prefix="split-fixture-") as tmp:
        work = Path(tmp)
        repo = work / "base"
        base_sha = _scratch_base(project, repo)
        patches = {t.id: _capture(repo, base_sha, work / ("clone-%s" % t.id),
                                  contents[t.id]) for t in writers}

    out_dir.mkdir(parents=True, exist_ok=True)
    written = []
    for task in writers:
        target = out_dir / ("task-%s.patch" % task.id)
        target.write_bytes(patches[task.id])
        written.append(target)
    manifest_path = out_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    written.append(manifest_path)
    written.extend(_write_replies(out_dir / manifest["replies"], contested))
    return written


def _reply_text(project_lines, regions, reference_lines, target):
    """`reference/`'s text for one contested region, over the extent the kernel
    briefs a resolver on.

    That extent is not the region: the weave takes a block out to the nearest
    line it can still anchor on, and a blank line either side of an added run
    matches a blank line of the project copy, so the brief swallows them.  The
    answer is therefore everything `reference/` holds between the last
    non-blank project line before the region and the first one after it.
    """
    at, base, ref = {}, 0, 0
    for region in regions:
        for k in range(base, region.i1):
            at[k] = ref
            ref += 1
        ref += sum(len(atom.added) for atom in region.atoms)
        base = region.i2
    for k in range(base, len(project_lines)):
        at[k] = ref
        ref += 1

    lo = 0
    for k in range(target.i1 - 1, -1, -1):
        if k in at and project_lines[k].strip():
            lo = at[k] + 1
            break
    hi = len(reference_lines)
    for k in range(target.i2, len(project_lines)):
        if k in at and project_lines[k].strip():
            hi = at[k]
            break
    return "".join(reference_lines[lo:hi])


def _write_replies(root, contested):
    """The committed answer to every merge the fold leaves to a resolver.

    A contested region is the only thing the kernel narrates, and it narrates
    the blocks of one path in file order, so contested region `k` of a path is
    that path's hunk `h<k+1>`.
    """
    written = []
    for rel in sorted(contested):
        directory = root / rel.replace("/", "__")
        directory.mkdir(parents=True, exist_ok=True)
        for k, text in enumerate(contested[rel], start=1):
            target = directory / ("h%d.txt" % k)
            target.write_text(text)
            written.append(target)
    return written


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="split_fixture",
        description="Split an eval fixture's reference tree into per-task patches.")
    parser.add_argument("fixture", help="a directory name under evals/fixtures/")
    parser.add_argument("out_dir", help="where the patches and manifest.json go")
    args = parser.parse_args(argv)
    try:
        written = split_fixture(args.fixture, Path(args.out_dir))
    except SplitError as error:
        sys.stderr.write(str(error) + "\n")
        return 1
    for path in written:
        print(path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
