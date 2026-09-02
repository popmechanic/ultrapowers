#!/usr/bin/env python3
"""Generate each claims-v1 task's `**BASE facts:**` block from the tree at BASE.

    pin_base_facts.py <plan.md> [--base <root>] [--write | --verify]

A plan names referents — `pkg/a.py`, `pkg/a.py:2`, `alpha`. Typed by hand they
rot silently: the path moves, the line shifts, the symbol's first definition
lands in another file, and the plan still reads as if it knows the tree. Under
the map of #551 a plan may name nothing it does not Produce or Consume OUTSIDE
a generated block, so this script is the generator: for every referent a task
names that resolves at BASE it pins the identity that cannot drift silently —
the blob sha — beside the path, line and quoted line text a reader needs.

Three modes, one resolver:

* default — print one block per task, in task order.
* `--write` — splice each block into the end of its task's Context slot,
  replacing any block already there and touching no other byte. Idempotent at a
  fixed base: a second `--write` rewrites the identical bytes.
* `--verify` — re-resolve every fact the plan already carries and exit 2 with
  one `stale:` line per fact that no longer holds.

A referent that does not resolve at BASE is OMITTED rather than pinned as
missing: the compiler's `ADVISORY referent:` line already names it, and a block
of facts is not the place to record an absence. A plan that is not claims-v1 is
not this script's business and exits 0 saying so.

Nothing here reaches the network, and the resolver is the compiler's own — the
referent scan, the path normalizer and the `_git` wrapper are imported, never
re-implemented, so what this pins is exactly what the compiler resolves.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "ultrapowers/scripts"))
from compile_plan import (  # noqa: E402
    CLAIMS_GRAMMAR,
    PATH_RE,
    SLOT_LABEL_RE,
    _fence_aware_lines,
    _git,
    _path_referent,
    _referent_scan_lines,
    default_base,
    match_head,
    plan_grammar,
    split_tasks,
)

BLOCK_LABEL = "**BASE facts:**"
BLOCK_HEAD_RE = re.compile(r"^\*\*BASE facts:\*\*")
BULLET_RE = re.compile(r"^- ")
# The quoted line text is evidence, not the line: capped so a long line cannot
# push the block out of a paragraph's readable width.
LINE_CAP = 60
SHA_LEN = 7
# A bare backticked identifier — the only token shape a symbol fact is drawn
# from. Anything with a dot, slash, space or paren is a path, a field or prose.
SYMBOL_RE = re.compile(r"^[A-Za-z_]\w*$")
# The trailing `:N` a line-numbered referent carries. `_path_referent` strips it
# (and `:N-M`), so the line number is read off the RAW token here; a range names
# no single line and pins as a plain path fact.
LINE_SUFFIX_RE = re.compile(r":(\d+)$")
CODE_PATHSPECS = ("*.py", "*.mjs", "*.js", "*.ts", "*.sh")
# The first definition line of a symbol, over the code files, in `git ls-files`
# order (git grep walks the tree in index order, so the first hit IS the first
# in that order).
DEF_PATTERN = (r"^(\s*(export\s+)?(async\s+)?(def|function|class|const|let)"
               r"\s+%s\b)")


# --------------------------------------------------------------------------- #
# Resolving one referent against the tree at BASE                              #
# --------------------------------------------------------------------------- #
def base_sha(base):
    """The commit the facts are generated against: HEAD in `--base`."""
    return _git(base, "rev-parse", "HEAD").strip()


def blob_sha(base, sha, path):
    """The 7-char blob sha of `path` in the tree at `sha`, or None when the
    path is absent there or names a tree rather than a blob."""
    for line in _git(base, "ls-tree", sha, "--", path).splitlines():
        head = line.split("\t", 1)[0].split()
        if len(head) >= 3 and head[1] == "blob":
            return head[2][:SHA_LEN]
    return None


def file_line(base, sha, path, n):
    """Line `n` (1-based) of `path` at `sha`, stripped and capped, or None."""
    lines = _git(base, "show", "%s:%s" % (sha, path)).splitlines()
    if not 1 <= n <= len(lines):
        return None
    return quote_line(lines[n - 1])


def quote_line(text):
    return text.strip()[:LINE_CAP]


def symbol_site(base, sha, sym):
    """(path, line) of `sym`'s first definition among the code files at `sha`,
    or None when it has none there."""
    out = _git(base, "grep", "-n", "-E", DEF_PATTERN % re.escape(sym), sha,
               "--", *CODE_PATHSPECS)
    for line in out.splitlines():
        rest = line[len(sha) + 1:] if line.startswith(sha + ":") else line
        path, _, tail = rest.partition(":")
        num, _, _ = tail.partition(":")
        if path and num.isdigit():
            return path, int(num)
    return None


def task_referents(body):
    """Every referent token a task body names, in document order, deduped, with
    any `**BASE facts:**` block already in the body removed first — a block's
    own facts are generated text, never referents to re-pin."""
    out = []
    for line in _referent_scan_lines({"body": strip_block(body)}):
        for tok in PATH_RE.findall(line):
            tok = tok.strip()
            if tok and tok not in out:
                out.append(tok)
    return out


def resolve(base, sha, tok):
    """The fact a referent token pins at BASE, or None when it does not
    resolve there (absent path, line past the end, symbol with no definition,
    token that names no referent at all)."""
    path = _path_referent(tok)
    if path is not None:
        blob = blob_sha(base, sha, path)
        if blob is None:
            return None
        m = LINE_SUFFIX_RE.search(tok.strip())
        if m is None:
            return {"kind": "path", "referent": path, "path": path, "blob": blob}
        n = int(m.group(1))
        text = file_line(base, sha, path, n)
        if text is None:
            return None
        return {"kind": "line", "referent": "%s:%d" % (path, n), "path": path,
                "line": n, "text": text, "blob": blob}
    if not SYMBOL_RE.match(tok):
        return None
    site = symbol_site(base, sha, tok)
    if site is None:
        return None
    path, n = site
    blob = blob_sha(base, sha, path)
    if blob is None:
        return None
    return {"kind": "symbol", "referent": tok, "symbol": tok, "path": path,
            "line": n, "blob": blob}


def task_facts(base, sha, body):
    """Every fact a task body's referents pin at BASE, in document order."""
    facts = []
    for tok in task_referents(body):
        fact = resolve(base, sha, tok)
        if fact is not None:
            facts.append(fact)
    return facts


# --------------------------------------------------------------------------- #
# Rendering and re-reading a block                                             #
# --------------------------------------------------------------------------- #
def render_fact(fact):
    if fact["kind"] == "path":
        return "- `%s` blob %s" % (fact["path"], fact["blob"])
    if fact["kind"] == "line":
        return "- `%s:%d` blob %s line %d `%s`" % (
            fact["path"], fact["line"], fact["blob"], fact["line"], fact["text"])
    return "- `%s` at `%s:%d` blob %s" % (
        fact["symbol"], fact["path"], fact["line"], fact["blob"])


def render_block(sha, facts):
    """The block: a label line carrying the base sha, then one bullet per fact.
    A fence is illegal in Context, so this is a plain paragraph."""
    head = "%s (generated at %s)" % (BLOCK_LABEL, sha[:SHA_LEN])
    return "\n".join([head] + [render_fact(f) for f in facts])


LINE_FACT_RE = re.compile(
    r"^- `([^`]+):(\d+)` blob ([0-9a-f]+) line (\d+) `(.*)`$")
SYMBOL_FACT_RE = re.compile(r"^- `([^`]+)` at `([^`]+):(\d+)` blob ([0-9a-f]+)$")
PATH_FACT_RE = re.compile(r"^- `([^`]+)` blob ([0-9a-f]+)$")


def parse_fact(line):
    """The fact a rendered bullet records, or None when the line is not one."""
    m = LINE_FACT_RE.match(line)
    if m:
        return {"kind": "line", "referent": "%s:%s" % (m.group(1), m.group(2)),
                "path": m.group(1), "line": int(m.group(4)), "text": m.group(5),
                "blob": m.group(3)}
    m = SYMBOL_FACT_RE.match(line)
    if m:
        return {"kind": "symbol", "referent": m.group(1), "symbol": m.group(1),
                "path": m.group(2), "line": int(m.group(3)), "blob": m.group(4)}
    m = PATH_FACT_RE.match(line)
    if m:
        return {"kind": "path", "referent": m.group(1), "path": m.group(1),
                "blob": m.group(2)}
    return None


def block_spans(lines):
    """(start, end) line-index pairs of every `**BASE facts:**` block in
    `lines`: the label line plus the `- ` bullets that follow it."""
    spans = []
    i = 0
    while i < len(lines):
        if BLOCK_HEAD_RE.match(lines[i].strip()):
            j = i + 1
            while j < len(lines) and BULLET_RE.match(lines[j].strip()):
                j += 1
            spans.append((i, j))
            i = j
            continue
        i += 1
    return spans


def strip_block(body):
    """`body` with any `**BASE facts:**` block removed."""
    lines = body.split("\n")
    for start, end in reversed(block_spans(lines)):
        del lines[start:end]
    return "\n".join(lines)


def parse_blocks(body):
    """Every fact the blocks already in `body` record, in document order."""
    lines = body.split("\n")
    facts = []
    for start, end in block_spans(lines):
        for line in lines[start + 1:end]:
            fact = parse_fact(line.strip())
            if fact is not None:
                facts.append(fact)
    return facts


# --------------------------------------------------------------------------- #
# Locating each task's Context slot in the plan's own lines                    #
# --------------------------------------------------------------------------- #
def _slot_name(raw):
    return re.sub(r"[\s-]+", "-", raw.strip().lower())


def context_ranges(text):
    """For each task, in `split_tasks` order, the (start, end) line indices of
    its Context slot's content within `text.split("\\n")` — end exclusive, past
    the slot's last non-blank line. None for a task with no locatable Context.

    Recomputed from the label lines rather than reached out of
    `parse_claims_body`, which returns slot TEXT and keeps its ranges private.
    """
    lines = list(_fence_aware_lines(text))
    heads = [i for i, (line, fenced) in enumerate(lines)
             if not fenced and match_head(line)]
    out = []
    for n, start in enumerate(heads):
        stop = heads[n + 1] if n + 1 < len(heads) else len(lines)
        labels = [(i, _slot_name(m.group(1)))
                  for i in range(start, stop)
                  for m in [SLOT_LABEL_RE.match(lines[i][0].strip())]
                  if m and not lines[i][1]]
        span = None
        for k, (i, name) in enumerate(labels):
            if name != "context":
                continue
            end = labels[k + 1][0] if k + 1 < len(labels) else stop
            while end > i + 1 and not lines[end - 1][0].strip():
                end -= 1
            span = (i, end)
            break
        out.append(span)
    return out


def rewrite(text, blocks):
    """`text` with each task's Context slot ending in exactly its block: any
    block already there is removed, the new one is appended after the slot's
    last content line preceded by exactly one newline. Every other byte is the
    file's own."""
    lines = text.split("\n")
    spans = context_ranges(text)
    # Back to front, so an earlier task's edit cannot shift a later span.
    for span, block in reversed(list(zip(spans, blocks))):
        if span is None:
            continue
        start, end = span
        slot = lines[start:end]
        for s, e in reversed(block_spans(slot)):
            del slot[s:e]
        while len(slot) > 1 and not slot[-1].strip():
            slot.pop()
        lines[start:end] = slot + block.split("\n")
    return "\n".join(lines)


# --------------------------------------------------------------------------- #
# The three modes                                                              #
# --------------------------------------------------------------------------- #
def verify_fact(base, sha, task_id, fact):
    """The `stale:` line this fact earns at BASE, or None when it still holds."""
    def stale(detail):
        return "stale: task %s `%s` %s" % (task_id, fact["referent"], detail)

    if fact["kind"] == "symbol":
        site = symbol_site(base, sha, fact["symbol"])
        if site is None:
            return stale("no definition in a code file at base")
        path, n = site
        if (path, n) != (fact["path"], fact["line"]):
            return stale("first definition `%s:%d` -> `%s:%d`"
                         % (fact["path"], fact["line"], path, n))
        blob = blob_sha(base, sha, path)
        if blob != fact["blob"]:
            return stale("blob %s -> %s" % (fact["blob"], blob or "absent"))
        return None

    blob = blob_sha(base, sha, fact["path"])
    if blob is None:
        return stale("blob %s -> path absent at base" % fact["blob"])
    if blob != fact["blob"]:
        return stale("blob %s -> %s" % (fact["blob"], blob))
    if fact["kind"] == "line":
        text = file_line(base, sha, fact["path"], fact["line"])
        if text != fact["text"]:
            return stale("line %d `%s` -> %s"
                         % (fact["line"], fact["text"],
                            "`%s`" % text if text is not None else "past the end"))
    return None


def main(argv=None):
    ap = argparse.ArgumentParser(
        description="Pin each claims-v1 task's BASE facts from the tree at BASE.")
    ap.add_argument("plan", type=Path)
    ap.add_argument("--base", type=Path, default=None,
                    help="the checkout the facts are resolved against "
                         "(default: the plan's own git toplevel)")
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--write", action="store_true",
                      help="splice each block into its task's Context slot")
    mode.add_argument("--verify", action="store_true",
                      help="exit 2 with one `stale:` line per fact that no "
                           "longer holds at --base")
    args = ap.parse_args(argv)

    if not args.plan.exists():
        sys.exit("error: no such plan: %s" % args.plan)
    text = args.plan.read_text()
    if plan_grammar(text) != CLAIMS_GRAMMAR:
        print("pin_base_facts: %s is not a claims-v1 plan — nothing to pin"
              % args.plan)
        return 0

    base = args.base if args.base is not None else default_base(args.plan)
    if base is None:
        sys.exit("error: no git checkout found for %s (pass --base)" % args.plan)
    sha = base_sha(base)
    if not sha:
        sys.exit("error: %s is not a git checkout" % base)

    tasks = split_tasks(text)
    if args.verify:
        stale = [line for t in tasks
                 for line in [verify_fact(base, sha, t["id"], f)
                              for f in parse_blocks(t["body"])]
                 if line is not None]
        for line in stale:
            print(line)
        return 2 if stale else 0

    blocks = [render_block(sha, task_facts(base, sha, t["body"])) for t in tasks]
    if args.write:
        args.plan.write_text(rewrite(text, blocks))
        return 0
    print("\n\n".join(blocks))
    return 0


if __name__ == "__main__":
    sys.exit(main())
