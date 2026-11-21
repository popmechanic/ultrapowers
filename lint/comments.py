#!/usr/bin/env python3
import ast
import bisect
import io
import json
import re
import subprocess
import sys
import tokenize
from pathlib import Path

USAGE = """Usage: comments.py [--update | --list path... | --json [path...]]

The comment ratchet. Counts comment lines per tracked source file (JS/TS, Python
docstrings and comments, shell) and holds each file at or below its count in
lint/comments-baseline.json. Decisions live in docs/adr/, not in comments.

  comments.py            check every tracked file against the baseline
  comments.py --update   rewrite the baseline to today's counts (only ever lower)
  comments.py --list F   print each comment in F with its line range
  comments.py --json     every comment, one JSON object per line (the /delete-comment inventory)
"""

ROOT = Path(__file__).resolve().parents[1]
BASELINE = ROOT / "lint" / "comments-baseline.json"
SOURCE = re.compile(r"\.(mjs|cjs|js|jsx|ts|tsx|py|sh)$")
EXCLUDED = re.compile(r"(^|/)(vendor|pouf)/|^evals/fixtures/|^tests/fixtures/")
SHELL_NAMES = {"factory/flock/nogit/git"}
PRAGMA = re.compile(
    r"^(#!|//\s*@ts-|/\*\s*eslint|//\s*eslint|#\s*noqa|#\s*type:\s*ignore|#\s*pragma|"
    r"///\s*<reference|#\s*-\*-|/\*\*?\s*@jsx|//\s*biome-ignore|//\s*prettier-ignore|"
    r"/\*\s*istanbul|#\s*shellcheck|#\s*fmt:|/\*\*\s*@type\s*\{[^}]*\}\s*\*/$)")

REGEX_AFTER = set("(,=:[!&|?{};+-*%<>~^") | {""}
REGEX_KEYWORDS = {"return", "typeof", "case", "do", "else", "in", "of", "new", "delete",
                  "void", "throw", "instanceof", "yield", "await"}


def js_comments(src):
    out, i, n = [], 0, len(src)
    prev, stack = "", []
    if src.startswith("#!"):
        i = src.find("\n") if "\n" in src else n

    def skip_string(i, q):
        i += 1
        while i < n and src[i] != q:
            if src[i] == "\\":
                i += 1
            elif src[i] == "\n":
                return i + 1
            i += 1
        return i + 1

    def skip_template(i):
        while i < n:
            c = src[i]
            if c == "\\":
                i += 2
                continue
            if c == "`":
                return i + 1, False
            if c == "$" and i + 1 < n and src[i + 1] == "{":
                return i + 2, True
            i += 1
        return i, False

    while i < n:
        c = src[i]
        if c in " \t\r\n":
            i += 1
            continue
        two = src[i:i + 2]
        if two == "//":
            j = src.find("\n", i)
            j = n if j < 0 else j
            out.append((i, j))
            i = j
            continue
        if two == "/*":
            j = src.find("*/", i + 2)
            j = n if j < 0 else j + 2
            out.append((i, j))
            i = j
            continue
        if c in "'\"":
            i = skip_string(i, c)
            prev = "str"
            continue
        if c == "`":
            i, opened = skip_template(i + 1)
            if opened:
                stack.append(1)
            prev = "str"
            continue
        if c == "/" and (prev in REGEX_AFTER or prev in REGEX_KEYWORDS):
            j, cls = i + 1, False
            while j < n and src[j] != "\n":
                if src[j] == "\\":
                    j += 2
                    continue
                if src[j] == "[":
                    cls = True
                elif src[j] == "]":
                    cls = False
                elif src[j] == "/" and not cls:
                    break
                j += 1
            i = j + 1
            while i < n and (src[i].isalnum()):
                i += 1
            prev = "re"
            continue
        if stack and c == "{":
            stack[-1] += 1
        elif stack and c == "}":
            stack[-1] -= 1
            if stack[-1] == 0:
                stack.pop()
                i, opened = skip_template(i + 1)
                if opened:
                    stack.append(1)
                prev = "str"
                continue
        if c.isalnum() or c in "_$":
            j = i
            while j < n and (src[j].isalnum() or src[j] in "_$"):
                j += 1
            prev = src[i:j]
            i = j
            continue
        prev = c
        i += 1
    starts = [0] + [m.end() for m in re.finditer("\n", src)]
    at = lambda pos: bisect.bisect_right(starts, pos)
    return [(at(a), at(b - 1), src[a:b]) for a, b in out]


def py_comments(src):
    out = [(t.start[0], t.end[0], t.string)
           for t in tokenize.generate_tokens(io.StringIO(src).readline)
           if t.type == tokenize.COMMENT]
    for node in ast.walk(ast.parse(src)):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            first = node.body[0] if node.body else None
            if (isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant)
                    and isinstance(first.value.value, str)):
                out.append((first.lineno, first.end_lineno, ast.get_source_segment(src, first)))
    return out


def sh_comments(src):
    out, heredoc = [], None
    for no, text in enumerate(src.split("\n"), 1):
        if heredoc:
            if text.strip() == heredoc:
                heredoc = None
            continue
        stripped = text.strip()
        if stripped.startswith("#"):
            out.append((no, no, stripped))
            continue
        m = re.search(r"<<-?\s*['\"]?(\w+)['\"]?", text)
        if m:
            heredoc = m.group(1)
    return out


def comments(rel):
    src = (ROOT / rel).read_text(encoding="utf-8")
    if rel.endswith(".py"):
        found = py_comments(src)
    elif rel.endswith(".sh") or rel in SHELL_NAMES:
        found = sh_comments(src)
    else:
        found = js_comments(src)
    return [c for c in found if not PRAGMA.match(c[2].strip())]


def comment_lines(rel):
    return len({no for start, end, _ in comments(rel) for no in range(start, end + 1)})


def tracked():
    names = subprocess.run(["git", "-C", str(ROOT), "ls-files", "-z"], capture_output=True,
                           text=True, check=True).stdout.split("\0")
    return sorted(p for p in names if p and (SOURCE.search(p) or p in SHELL_NAMES)
                  and not EXCLUDED.search(p) and (ROOT / p).is_file())


def counts():
    return {p: c for p in tracked() if (c := comment_lines(p))}


def check():
    baseline = json.loads(BASELINE.read_text()) if BASELINE.exists() else {}
    now = counts()
    over = [(p, c, baseline.get(p, 0)) for p, c in now.items() if c > baseline.get(p, 0)]
    under = [(p, now.get(p, 0), b) for p, b in baseline.items() if now.get(p, 0) < b]
    for p, c, b in over:
        print(f"{p}: {c} comment lines, allowed {b}. Delete the comment; a decision goes "
              f"in docs/adr/ (lint/comments.py --list {p})")
    for p, c, b in under:
        print(f"{p}: {c} comment lines, baseline {b}. Lock it in: python3 lint/comments.py --update")
    return 1 if over or under else 0


def main(argv):
    if argv[:1] == ["--update"]:
        baseline = json.loads(BASELINE.read_text()) if BASELINE.exists() else {}
        now = counts()
        raised = [p for p, c in now.items() if BASELINE.exists() and c > baseline.get(p, 0)]
        if raised and "--allow-raise" not in argv:
            print("refusing to raise the baseline for: " + ", ".join(raised))
            return 1
        BASELINE.write_text(json.dumps(now, indent=1, sort_keys=True) + "\n")
        print(f"{sum(now.values())} comment lines in {len(now)} files")
        return 0
    if argv[:1] == ["--json"]:
        for rel in argv[1:] or tracked():
            for start, end, text in comments(rel):
                print(json.dumps({"file": rel, "start": start, "end": end, "text": text}))
        return 0
    if argv[:1] == ["--list"]:
        for rel in argv[1:]:
            for start, end, text in comments(rel):
                print(f"{rel}:{start}-{end}: {text.splitlines()[0][:100]}")
        return 0
    if argv:
        print(USAGE)
        return 1
    return check()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
