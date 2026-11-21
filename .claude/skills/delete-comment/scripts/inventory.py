#!/usr/bin/env python3
import json
import subprocess
import sys
from pathlib import Path

USAGE = """Usage: inventory.py <workdir> <shards> [path...]

Writes <workdir>/blocks.json (every comment block, consecutive own-line comments joined,
each with an id) and <workdir>/shards/shardNN.jsonl, whole files per shard, balanced."""

ROOT = Path(__file__).resolve().parents[4]


def own_line(lines, start, text):
    line = lines[start - 1]
    first = text.split("\n")[0]
    at = line.find(first)
    return at >= 0 and line[:at].strip() in ("", "{")


def main(argv):
    if len(argv) < 2 or not argv[1].isdigit():
        print(USAGE)
        return 1
    work, shards = Path(argv[0]), int(argv[1])
    raw = subprocess.run([sys.executable, str(ROOT / "lint" / "comments.py"), "--json", *argv[2:]],
                         capture_output=True, text=True, check=True).stdout.splitlines()
    rows = [json.loads(r) for r in raw]
    files = {}
    blocks = []
    for r in rows:
        lines = files.setdefault(r["file"], (ROOT / r["file"]).read_text(encoding="utf-8").split("\n"))
        r["own"] = own_line(lines, r["start"], r["text"])
        r["kind"] = "docstring" if r["text"].lstrip("rbuRBU").startswith(('"""', "'''", '"', "'")) else "comment"
        prev = blocks[-1] if blocks else None
        line_comment = r["text"].startswith(("//", "#"))
        if (prev and prev["file"] == r["file"] and prev["own"] and r["own"] and line_comment
                and prev["text"].startswith(("//", "#")) and r["start"] == prev["end"] + 1):
            prev["end"] = r["end"]
            prev["text"] += "\n" + r["text"]
            prev["parts"].append(dict(r))
        else:
            blocks.append({**r, "parts": [dict(r)]})
    for i, b in enumerate(blocks):
        b["id"] = f"C{i:04d}"
    work.mkdir(parents=True, exist_ok=True)
    (work / "blocks.json").write_text(json.dumps(blocks))
    by_file = {}
    for b in blocks:
        by_file.setdefault(b["file"], []).append(b)
    weight = lambda bs: len(bs) + sum(b["end"] - b["start"] + 1 for b in bs) / 4
    bins = [[] for _ in range(shards)]
    sizes = [0.0] * shards
    for f, bs in sorted(by_file.items(), key=lambda kv: -weight(kv[1])):
        k = sizes.index(min(sizes))
        bins[k].append(f)
        sizes[k] += weight(bs)
    (work / "shards").mkdir(exist_ok=True)
    (work / "out").mkdir(exist_ok=True)
    for k, fs in enumerate(bins):
        with open(work / "shards" / f"shard{k:02d}.jsonl", "w") as out:
            for f in sorted(fs):
                for b in by_file[f]:
                    out.write(json.dumps({key: b[key] for key in
                                          ("id", "file", "start", "end", "own", "kind", "text")}) + "\n")
    print(f"{len(blocks)} blocks in {len(by_file)} files, {shards} shards in {work}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
