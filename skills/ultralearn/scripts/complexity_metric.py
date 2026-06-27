"""Reproducible complexity metric over the engine's gate-spec surfaces.
Advisory governor for the ultralearn loop (G2): measures accretion; never branches."""
from __future__ import annotations
import json, re, sys
from pathlib import Path

ISSUE_RE = re.compile(r"#[0-9]+[a-z]*")
SENT_RE = re.compile(r"(?<=[.])\s+(?=[A-Z`|])")

def compute_metrics(paths):
    parens, longest, refs, loc = {}, 0, set(), 0
    for p in paths:
        text = Path(p).read_text()
        lines = text.splitlines() or [""]
        parens[p] = round(text.count("(") / len(lines), 4)
        loc += len(lines)
        refs.update(ISSUE_RE.findall(text))
        longest = max([longest] + [len(s) for s in SENT_RE.split(text)])
    return {"parensPerLine": parens, "longestRuleChars": longest,
            "distinctIssueRefs": len(refs), "engineLoc": loc}

def verdict(metrics, baseline):
    out = []
    for f, v in metrics.get("parensPerLine", {}).items():
        b = baseline.get("parensPerLine", {}).get(f)
        if b is not None and v > b:
            out.append(f"parensPerLine[{f}] rose {b} -> {v}")
    for k in ("longestRuleChars", "distinctIssueRefs", "engineLoc"):
        b = baseline.get(k)
        if b is not None and metrics.get(k, 0) > b:
            out.append(f"{k} rose {b} -> {metrics[k]}")
    return out

GATE_SURFACES = [
    "skills/ultrapowers/SKILL.md",
    "skills/ultrapowers/references/report-format.md",
    "skills/ultrapowers/references/reviewer-prompts.md",
    "skills/ultrapowers/references/dependency-analysis.md",
    "skills/ultrapowers/references/wave-merge.md",
]

def main(argv):
    root = Path(__file__).resolve().parents[3]
    metrics = compute_metrics([str(root / p) for p in GATE_SURFACES])
    # Emit repo-RELATIVE surface keys so the generated baseline is portable across
    # checkouts and CI — the absolute repo root differs per worktree, so an
    # absolute-keyed baseline silently breaks the ratchet's set-equality check when
    # regenerated anywhere but its birth worktree. compute_metrics keys by whatever
    # path string it is handed (absolute, to read the files); relativize at this
    # single emit point so `complexity_metric.py > baseline.json` is reproducible.
    metrics["parensPerLine"] = {str(Path(k).relative_to(root)): v
                                for k, v in metrics["parensPerLine"].items()}
    print(json.dumps(metrics, indent=2, sort_keys=True))
    if "--baseline" in argv:
        base = json.loads(Path(argv[argv.index("--baseline") + 1]).read_text())
        for line in verdict(metrics, base):
            print("RATCHET:", line)
    return 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
