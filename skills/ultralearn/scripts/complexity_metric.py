"""Standing-concept complexity metric over the engine's operator surfaces.
Advisory governor for the ultralearn loop (G2): counts the named concepts an
operator or orchestrator must hold in mind — steps, knobs, states, verbs,
checks, flags — rather than prose punctuation. Measures accretion; never
branches."""
from __future__ import annotations
import json, re, sys
from pathlib import Path

# Each counter is a pure text -> int function over one named surface.
SURFACES = {
    "skillSteps":   "skills/ultrapowers/SKILL.md",
    "skillWords":   "skills/ultrapowers/SKILL.md",
    "engineKnobs":  "skills/ultrapowers/harnesses/waves.js",
    "enumStates":   "skills/ultrapowers/harnesses/waves.js",
    "engineLoc":    "skills/ultrapowers/harnesses/waves.js",
    "lockVerbs":    "skills/ultrapowers/scripts/run_lock.sh",
    "gateChecks":   "skills/ultrapowers/scripts/gate_check.py",
    "compileFlags": "skills/ultrapowers/scripts/compile_plan.py",
}

# The concept counters that sum into standingConcepts. skillWords and engineLoc
# ratchet individually as size signals but are not concepts themselves.
CONCEPT_KEYS = ["skillSteps", "engineKnobs", "enumStates", "lockVerbs",
                "gateChecks", "compileFlags"]


def count_skill_steps(text):
    """Named operator steps: `## Step N` sections plus bold sub-steps
    (`**4b — …`, `**4a½ — …`, `**1. …`)."""
    sections = re.findall(r"^#{2,3}\s*Step\s+\d", text, re.M)
    substeps = re.findall(r"^\*\*\d+[a-z½]*(?:\s*—|\.\s)", text, re.M)
    return len(sections) + len(substeps)


def count_words(text):
    return len(text.split())


def count_engine_knobs(text):
    """Distinct launch-args keys the harness reads (ARGS.<name>)."""
    return len(set(re.findall(r"\bARGS\.(\w+)", text)))


def count_enum_states(text):
    """Distinct enum members across the harness's structured-output schemas."""
    members = set()
    for body in re.findall(r"enum:\s*\[([^\]]*)\]", text):
        members.update(re.findall(r"'([^']+)'", body))
    return len(members)


def count_lines(text):
    return len(text.splitlines() or [""])


def count_lock_verbs(text):
    """Case labels of the lock script's verb dispatch (`  acquire)` …)."""
    return len(set(re.findall(r"^\s{2}(\w[\w-]*)\)\s*$", text, re.M)))


def count_gate_checks(text):
    """Distinct named checks the deterministic gate can emit."""
    return len(set(re.findall(r'check\(\s*"([^"]+)"', text)))


def count_compile_flags(text):
    """CLI flags on the compiler; positional args are excluded."""
    return len(set(re.findall(r'add_argument\(\s*"(--[\w-]+)"', text)))


COUNTERS = {
    "skillSteps": count_skill_steps,
    "skillWords": count_words,
    "engineKnobs": count_engine_knobs,
    "enumStates": count_enum_states,
    "engineLoc": count_lines,
    "lockVerbs": count_lock_verbs,
    "gateChecks": count_gate_checks,
    "compileFlags": count_compile_flags,
}


def compute_metrics(root):
    root = Path(root)
    texts = {p: (root / p).read_text() for p in set(SURFACES.values())}
    metrics = {k: COUNTERS[k](texts[SURFACES[k]]) for k in COUNTERS}
    metrics["standingConcepts"] = sum(metrics[k] for k in CONCEPT_KEYS)
    return metrics


def verdict(metrics, baseline):
    out = []
    for k in sorted(metrics):
        b = baseline.get(k)
        if isinstance(b, (int, float)) and metrics[k] > b:
            out.append(f"{k} rose {b} -> {metrics[k]}")
    return out


def main(argv):
    root = Path(__file__).resolve().parents[3]
    metrics = compute_metrics(root)
    print(json.dumps(metrics, indent=2, sort_keys=True))
    if "--baseline" in argv:
        base = json.loads(Path(argv[argv.index("--baseline") + 1]).read_text())
        for line in verdict(metrics, base):
            print("RATCHET:", line)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
