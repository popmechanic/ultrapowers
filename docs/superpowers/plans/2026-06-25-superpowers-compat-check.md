# Superpowers Compatibility Check Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ultrapowers' loose advisory superpowers-version check with a resolver-grounded, contract-token preflight that resolves the *active* superpowers, asserts a single shared manifest, and grades its response.

**Architecture:** Three co-located Python scripts under `skills/ultrapowers/scripts/` — a resolver (active install from `enabledPlugins` + `installed_plugins.json`), a shared contract manifest + checker, and a preflight that composes them with exit-code semantics — wired into `SKILL.md` Step 1. The pytest tripwire is GA-flipped to import the shared manifest and run against the live cache; the frozen `superpowers-v6` snapshot is retired.

**Tech Stack:** Python 3 standard library (`json`, `pathlib`, `dataclasses`), pytest, Bash for the SKILL.md invocation.

## Global Constraints

- Python 3 standard library only — no new dependencies; never add the `anthropic` SDK or any `ANTHROPIC_API_KEY` (a distributed plugin must need no API key).
- The contract-token manifest in `superpowers_contract.py` is the **single source of truth** — the runtime preflight and the pytest both import it; no second token list may exist anywhere (DRY / anti-drift).
- The compat check is strictly **read-only** — it never mutates the user's plugin config, `settings.json`, or the superpowers cache.
- Versioning stays `0.0.x`; this change ships **no** version bump (release is a separate ritual, not in this plan).
- `TESTED_AGAINST` is pinned to the latest verified superpowers release: `6.0.3`.
- Every `implementation` task is a worktree-pure diff against the integration branch.

**Acceptance:** suite — ultrapowers' own engine/script/skill development; author and operator both read the diffs, and the committed pytest suite (plus the new tests below) is the verification. No held-out exam.

---

### Task 1: Shared contract manifest + checker

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `skills/ultrapowers/scripts/superpowers_contract.py`
- Test: `tests/test_superpowers_contract.py`

**Interfaces:**
- Produces:
  - `TESTED_AGAINST: str` (= `"6.0.3"`)
  - `MANIFEST: list[dict]` — each entry `{"rel": str, ...}` with exactly one of `"token": str`, `"any_of": list[str]`, or `"exists_only": True`, plus `"why": str`.
  - `Report` dataclass: `Report(ok: bool, missing: list[dict], checked: int)`.
  - `check(superpowers_root) -> Report`.

**Parallelization rationale:** the shared manifest is the single token source; factoring it into its own module (DRY — the repo's explicit anti-drift value) lets Task 3 (preflight) and Task 5 (GA-flip test) build against one interface in parallel instead of each carrying its own token list.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_superpowers_contract.py
import pathlib, sys
from collections import defaultdict

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "skills/ultrapowers/scripts"))
import superpowers_contract as sc  # noqa: E402


def _synthesize(root, omit_index=None):
    """Write a full superpowers tree under `root` that satisfies every MANIFEST
    entry (derived from MANIFEST itself, so it never drifts). When omit_index is
    set, the token for MANIFEST[omit_index] is left out of its file."""
    by_file = defaultdict(list)
    for i, e in enumerate(sc.MANIFEST):
        by_file[e["rel"]].append((i, e))
    for rel, entries in by_file.items():
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        chunks = []
        for i, e in entries:
            if i == omit_index or e.get("exists_only"):
                continue
            tok = e.get("any_of", [e.get("token")])[0]
            chunks.append(tok)
        p.write_text("\n".join(chunks) + "\n")


def test_check_passes_on_full_tree(tmp_path):
    _synthesize(tmp_path)
    rep = sc.check(tmp_path)
    assert rep.ok is True
    assert rep.missing == []
    assert rep.checked == len(sc.MANIFEST)


def test_check_reports_exact_missing_token(tmp_path):
    # Drop the "### Task N:" entry's token; check must name that entry.
    idx = next(i for i, e in enumerate(sc.MANIFEST) if e.get("token") == "### Task N:")
    _synthesize(tmp_path, omit_index=idx)
    rep = sc.check(tmp_path)
    assert rep.ok is False
    assert any(m.get("token") == "### Task N:" for m in rep.missing)


def test_check_reports_absent_file_as_missing(tmp_path):
    # Empty tree → every entry missing (no partial-tree skip after the GA-flip).
    rep = sc.check(tmp_path)
    assert rep.ok is False
    assert len(rep.missing) == len(sc.MANIFEST)


def test_tested_against_is_pinned():
    assert sc.TESTED_AGAINST == "6.0.3"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/test_superpowers_contract.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'superpowers_contract'`.

- [ ] **Step 3: Write the module**

```python
# skills/ultrapowers/scripts/superpowers_contract.py
"""Single source of truth for the superpowers contract tokens ultrapowers depends
on. Imported by both the runtime preflight (check_superpowers_compat.py) and the
pytest tripwire (test_superpowers_compat.py), so there is exactly one token list.

Each MANIFEST entry names a file (relative to a superpowers install root), the
literal token that must be present in it (or `any_of` alternatives, or
`exists_only` for a file whose mere presence is the contract), and WHY ultrapowers
depends on it. To re-verify against a newer superpowers release, run the live
tripwire (tests/test_superpowers_compat.py) against it, then bump TESTED_AGAINST."""
from dataclasses import dataclass, field
import pathlib

TESTED_AGAINST = "6.0.3"  # latest released superpowers whose contract we verified

MANIFEST = [
    # writing-plans template shape — compile_plan.py + Step-1 shape check parse these
    {"rel": "skills/writing-plans/SKILL.md", "token": "Implementation Plan",
     "why": "Step-1 heading convenience match"},
    {"rel": "skills/writing-plans/SKILL.md", "token": "### Task N:",
     "why": "compile_plan.py + Step-1 shape check parse the task heading"},
    {"rel": "skills/writing-plans/SKILL.md", "token": "### Task N: [Component Name]",
     "why": "dependency-analysis.md's contiguous-header-block rule assumes heading↔Files adjacency"},
    {"rel": "skills/writing-plans/SKILL.md", "token": "**Files:**",
     "why": "the Files block is the writes/reads source for the DAG"},
    {"rel": "skills/writing-plans/SKILL.md", "token": "- [ ]",
     "why": "checkbox step syntax the compiler/executors track"},
    {"rel": "skills/writing-plans/SKILL.md", "token": "- Create:",
     "why": "writes-set parse"},
    {"rel": "skills/writing-plans/SKILL.md", "token": "- Modify:",
     "why": "writes-set parse"},
    {"rel": "skills/writing-plans/SKILL.md", "token": "- Test:",
     "why": "reads-set parse"},
    {"rel": "skills/writing-plans/SKILL.md", "token": ":123-145",
     "why": "line-range file-reference form the parser tolerates"},
    {"rel": "skills/writing-plans/SKILL.md", "token": "## Global Constraints",
     "why": "forwarded to every reviewer as the attention lens"},
    {"rel": "skills/writing-plans/SKILL.md", "token": "**Interfaces:**",
     "why": "Consumes/Produces drive undeclared-dependency detection"},
    {"rel": "skills/writing-plans/SKILL.md", "token": "**Tech Stack:**",
     "why": "Step 2 derives testCmd from it"},
    {"rel": "skills/writing-plans/SKILL.md", "token": "Two execution options",
     "why": "ultraplan overlays a third option on exactly two"},
    {"rel": "skills/writing-plans/SKILL.md", "token": "batch execution with checkpoints",
     "why": "ultraplan's Inline option calls this wording stale on purpose"},
    {"rel": "skills/writing-plans/SKILL.md", "token": "## Self-Review",
     "why": "ultraplan's self-review additions extend this section"},
    # subagent-driven-development — Step 6 fallback + re-bake sources
    {"rel": "skills/subagent-driven-development/SKILL.md", "token": "Continuous execution",
     "why": "plan-markers Executor variance + Step 6 rely on the no-pause posture"},
    {"rel": "skills/subagent-driven-development/SKILL.md", "token": "without stopping",
     "why": "continuous-execution posture"},
    {"rel": "skills/subagent-driven-development/SKILL.md",
     "token": "Do not pause to check in with your human partner between tasks",
     "why": "exact sentence plan-markers.md quotes"},
    {"rel": "skills/subagent-driven-development/SKILL.md", "token": "without explicit user consent",
     "why": "Step 6 fallback relies on the main/master consent red flag"},
    {"rel": "skills/subagent-driven-development/SKILL.md", "token": "spec compliance",
     "why": "unified task-reviewer design is built on this verdict"},
    {"rel": "skills/subagent-driven-development/SKILL.md", "any_of": ["code quality", "task quality"],
     "why": "unified task-reviewer quality verdict"},
    {"rel": "skills/subagent-driven-development/SKILL.md", "token": "superpowers:using-git-worktrees",
     "why": "Step 6 hands a clean checkout expecting self-isolation"},
    {"rel": "skills/subagent-driven-development/SKILL.md", "token": "Model Selection",
     "why": "reviewer-prompts.md re-bakes the model-tier scheme from here"},
    {"rel": "skills/subagent-driven-development/SKILL.md", "token": "re-dispatch with a more capable model",
     "why": "reviewer-prompts.md headless-downgrade note paraphrases the BLOCKED ladder"},
    {"rel": "skills/subagent-driven-development/SKILL.md", "token": "address them before review",
     "why": "reviewer-prompts.md paraphrases DONE_WITH_CONCERNS handling"},
    {"rel": "skills/subagent-driven-development/implementer-prompt.md",
     "token": "DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT",
     "why": "IMPLEMENTER_SCHEMA enum + headless-downgrade notes built on these four"},
    {"rel": "skills/subagent-driven-development/task-reviewer-prompt.md", "exists_only": True,
     "why": "reviewer-prompts.md names it as a re-bake source"},
    # requesting-code-review template
    {"rel": "skills/requesting-code-review/code-reviewer.md", "token": "**Architecture:**",
     "why": "reviewer-prompts.md deliberate-drop note names it"},
    {"rel": "skills/requesting-code-review/code-reviewer.md", "token": "**Production readiness:**",
     "why": "reviewer-prompts.md deliberate-drop note names it"},
    {"rel": "skills/requesting-code-review/code-reviewer.md", "token": "Type safety where applicable?",
     "why": "reviewer-prompts.md deliberate-drop ledger names it"},
    {"rel": "skills/requesting-code-review/code-reviewer.md", "token": "Edge cases handled?",
     "why": "reviewer-prompts.md deliberate-drop ledger names it"},
    {"rel": "skills/requesting-code-review/code-reviewer.md", "token": "Integration tests where they matter?",
     "why": "reviewer-prompts.md deliberate-drop ledger names it"},
    # other handoff skills ultrapowers gates on
    {"rel": "skills/finishing-a-development-branch/SKILL.md",
     "token": "Cannot proceed with merge/PR until tests pass",
     "why": "Step 5 gates the Approve path on this precondition"},
    {"rel": "skills/verification-before-completion/SKILL.md", "token": "Evidence before claims",
     "why": "wave-merge.md + reviewer-prompts.md cite it as the critic's source"},
    {"rel": "skills/executing-plans/SKILL.md", "token": "execute all tasks",
     "why": "plan-markers Executor variance + ultraplan's Inline option assume continuous execution"},
]


@dataclass
class Report:
    ok: bool
    missing: list = field(default_factory=list)
    checked: int = 0


def check(superpowers_root):
    """Return a Report of which MANIFEST tokens are absent from the given
    superpowers install root. An absent file counts every one of its entries as
    missing (no partial-tree skip)."""
    root = pathlib.Path(superpowers_root)
    missing = []
    for entry in MANIFEST:
        path = root / entry["rel"]
        if not path.exists():
            missing.append(entry)
            continue
        if entry.get("exists_only"):
            continue
        text = path.read_text()
        tokens = entry.get("any_of", [entry.get("token")])
        if not any(tok in text for tok in tokens):
            missing.append(entry)
    return Report(ok=not missing, missing=missing, checked=len(MANIFEST))
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest tests/test_superpowers_contract.py -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/scripts/superpowers_contract.py tests/test_superpowers_contract.py
git commit -m "feat(compat): shared superpowers contract manifest + checker"
```

---

### Task 2: Active-superpowers resolver

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `skills/ultrapowers/scripts/resolve_superpowers.py`
- Test: `tests/test_resolve_superpowers.py`

**Interfaces:**
- Produces: `resolve_active(claude_home, project) -> dict` shaped
  `{"active": [{"marketplace": str|None, "installPath": str, "version": str, "gitCommitSha": str}], "ambiguous": bool}`.
  Also a CLI: `python3 resolve_superpowers.py [--claude-home P] [--project P]` printing that dict as JSON.

**Parallelization rationale:** resolution (which install is active) is a separate concern from token-checking; a good engineer factors it into its own module regardless of parallelism, and doing so lets it land in the same wave as the checker.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_resolve_superpowers.py
import json, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "skills/ultrapowers/scripts"))
import resolve_superpowers as rs  # noqa: E402


def _write(p, obj):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj))


def _setup(tmp_path, enabled, installed, project_enabled=None):
    home = tmp_path / "home"
    _write(home / "settings.json", {"enabledPlugins": enabled})
    _write(home / "plugins/installed_plugins.json", {"version": 1, "plugins": installed})
    project = tmp_path / "proj"
    if project_enabled is not None:
        _write(project / ".claude/settings.json", {"enabledPlugins": project_enabled})
    (project / ".claude").mkdir(parents=True, exist_ok=True)
    return home, project


def _install(path, version, sha):
    return [{"installPath": path, "version": version, "gitCommitSha": sha}]


def test_picks_enabled_excludes_disabled(tmp_path):
    home, project = _setup(
        tmp_path,
        enabled={"superpowers@claude-plugins-official": False},
        installed={
            "superpowers@claude-plugins-official": _install("/c/6.0.3", "6.0.3", "aaa"),
            "superpowers@superpowers-marketplace": _install("/m/6.0.0", "6.0.0", "bbb"),
        },
    )
    res = rs.resolve_active(home, project)
    assert res["ambiguous"] is False
    assert [a["version"] for a in res["active"]] == ["6.0.0"]
    assert res["active"][0]["marketplace"] == "superpowers-marketplace"


def test_absent_entry_is_enabled_by_default(tmp_path):
    home, project = _setup(
        tmp_path, enabled={},
        installed={"superpowers@m": _install("/m/6.0.0", "6.0.0", "bbb")},
    )
    res = rs.resolve_active(home, project)
    assert [a["version"] for a in res["active"]] == ["6.0.0"]


def test_project_settings_override_user(tmp_path):
    # user enables official; project disables it -> excluded.
    home, project = _setup(
        tmp_path,
        enabled={"superpowers@official": True},
        installed={"superpowers@official": _install("/c/6.0.3", "6.0.3", "aaa")},
        project_enabled={"superpowers@official": False},
    )
    res = rs.resolve_active(home, project)
    assert res["active"] == []


def test_multiple_enabled_flags_ambiguous(tmp_path):
    home, project = _setup(
        tmp_path, enabled={},
        installed={
            "superpowers@a": _install("/a/6.0.0", "6.0.0", "x"),
            "superpowers@b": _install("/b/6.0.3", "6.0.3", "y"),
        },
    )
    res = rs.resolve_active(home, project)
    assert res["ambiguous"] is True
    assert len(res["active"]) == 2


def test_none_installed(tmp_path):
    home, project = _setup(tmp_path, enabled={}, installed={"frontend-design@x": _install("/f", "1", "z")})
    res = rs.resolve_active(home, project)
    assert res == {"active": [], "ambiguous": False}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/test_resolve_superpowers.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'resolve_superpowers'`.

- [ ] **Step 3: Write the module**

```python
# skills/ultrapowers/scripts/resolve_superpowers.py
"""Resolve the ACTIVE superpowers install(s) from the settings cascade plus
installed_plugins.json. Read-only: never mutates plugin config. The old check
listed one hard-coded cache directory and so read a DISABLED install's version;
this reads `enabledPlugins` (the authoritative active signal) instead."""
import argparse
import json
import pathlib


def _load(path):
    try:
        return json.loads(pathlib.Path(path).read_text())
    except Exception:
        return {}


def _enabled_map(claude_home, project):
    """Merge enabledPlugins across the settings cascade; later files win."""
    home = pathlib.Path(claude_home)
    proj = pathlib.Path(project)
    merged = {}
    for p in (home / "settings.json",
              proj / ".claude/settings.json",
              proj / ".claude/settings.local.json"):
        merged.update(_load(p).get("enabledPlugins", {}))
    return merged


def resolve_active(claude_home, project):
    enabled = _enabled_map(claude_home, project)
    installed = _load(pathlib.Path(claude_home) / "plugins/installed_plugins.json").get("plugins", {})
    active = []
    for key, entries in installed.items():
        name = key.split("@", 1)[0]
        if name != "superpowers":
            continue
        if enabled.get(key) is False:  # explicit false disables; absent => enabled
            continue
        marketplace = key.split("@", 1)[1] if "@" in key else None
        for e in (entries if isinstance(entries, list) else [entries]):
            active.append({
                "marketplace": marketplace,
                "installPath": e.get("installPath"),
                "version": e.get("version"),
                "gitCommitSha": e.get("gitCommitSha"),
            })
    return {"active": active, "ambiguous": len(active) > 1}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--claude-home", default=str(pathlib.Path.home() / ".claude"))
    ap.add_argument("--project", default=".")
    a = ap.parse_args()
    print(json.dumps(resolve_active(a.claude_home, a.project), indent=2))


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest tests/test_resolve_superpowers.py -v`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/scripts/resolve_superpowers.py tests/test_resolve_superpowers.py
git commit -m "feat(compat): resolve active superpowers from enabledPlugins cascade"
```

---

### Task 3: Preflight composer + exit-code semantics

**Type:** implementation
**Depends-on:** 1, 2

**Files:**
- Create: `skills/ultrapowers/scripts/check_superpowers_compat.py`
- Test: `tests/test_check_superpowers_compat.py`

**Interfaces:**
- Consumes: `check`, `TESTED_AGAINST` (Task 1); `resolve_active` (Task 2).
- Produces: `main(claude_home, project) -> int` (exit code) and a CLI entrypoint
  `python3 check_superpowers_compat.py` that prints a verdict and exits 0 / non-zero.

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_check_superpowers_compat.py
import json, pathlib, sys
from collections import defaultdict

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "skills/ultrapowers/scripts"))
import superpowers_contract as sc  # noqa: E402
import check_superpowers_compat as ck  # noqa: E402


def _full_tree(root):
    by_file = defaultdict(list)
    for e in sc.MANIFEST:
        by_file[e["rel"]].append(e)
    for rel, entries in by_file.items():
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        toks = [e.get("any_of", [e.get("token")])[0] for e in entries if not e.get("exists_only")]
        p.write_text("\n".join(toks) + "\n")


def _home_with(tmp_path, install_path, version):
    home = tmp_path / "home"
    (home / "plugins").mkdir(parents=True, exist_ok=True)
    (home / "settings.json").write_text(json.dumps({"enabledPlugins": {}}))
    (home / "plugins/installed_plugins.json").write_text(json.dumps(
        {"plugins": {"superpowers@m": [{"installPath": str(install_path),
                                        "version": version, "gitCommitSha": "x"}]}}))
    return home


def test_exit_zero_when_all_tokens_present(tmp_path, capsys):
    sp = tmp_path / "sp"; _full_tree(sp)
    home = _home_with(tmp_path, sp, sc.TESTED_AGAINST)
    assert ck.main(home, tmp_path) == 0


def test_advisory_on_version_delta_still_exit_zero(tmp_path, capsys):
    sp = tmp_path / "sp"; _full_tree(sp)
    home = _home_with(tmp_path, sp, "6.0.99")  # != TESTED_AGAINST
    rc = ck.main(home, tmp_path)
    assert rc == 0
    assert "advisory" in capsys.readouterr().out.lower()


def test_nonzero_and_names_missing_token(tmp_path, capsys):
    sp = tmp_path / "sp"; _full_tree(sp)
    # break one token: blank the writing-plans file
    (sp / "skills/writing-plans/SKILL.md").write_text("nothing useful\n")
    home = _home_with(tmp_path, sp, sc.TESTED_AGAINST)
    rc = ck.main(home, tmp_path)
    assert rc != 0
    assert "### Task N:" in capsys.readouterr().out


def test_skip_when_no_superpowers(tmp_path, capsys):
    home = tmp_path / "home"
    (home / "plugins").mkdir(parents=True, exist_ok=True)
    (home / "settings.json").write_text(json.dumps({"enabledPlugins": {}}))
    (home / "plugins/installed_plugins.json").write_text(json.dumps({"plugins": {}}))
    rc = ck.main(home, tmp_path)
    assert rc == 0
    assert "skip" in capsys.readouterr().out.lower()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/test_check_superpowers_compat.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'check_superpowers_compat'`.

- [ ] **Step 3: Write the module**

```python
# skills/ultrapowers/scripts/check_superpowers_compat.py
"""Runtime superpowers compatibility preflight, invoked by SKILL.md Step 1.

Resolves the active superpowers (enabledPlugins + installed_plugins.json), checks
the shared contract manifest against each active install, and exits:
  0          — all contract tokens present (prints an `advisory:` line if the
               version differs from TESTED_AGAINST), OR superpowers is not
               installed/resolvable (prints a skip notice).
  non-zero   — a contract token ultrapowers depends on is missing; prints exactly
               which token, in which file, and why."""
import argparse
import pathlib
import sys

# Co-located scripts: Python puts this file's dir on sys.path[0] at runtime.
from resolve_superpowers import resolve_active
from superpowers_contract import check, TESTED_AGAINST


def main(claude_home, project):
    res = resolve_active(claude_home, project)
    active = res["active"]
    if not active:
        print("superpowers not installed/resolvable — skipping compat check "
              "(the workflow path does not depend on live superpowers).")
        return 0
    if res["ambiguous"]:
        print(f"note: {len(active)} enabled superpowers installs found — checking each.")
    broken = []
    for inst in active:
        rep = check(inst["installPath"])
        label = f"{inst['version']} ({inst['marketplace']})"
        if not rep.ok:
            broken.append((inst, rep))
        elif inst["version"] != TESTED_AGAINST:
            print(f"advisory: validated against superpowers {TESTED_AGAINST}; "
                  f"you have {label}; all {rep.checked} contract tokens present.")
    if broken:
        for inst, rep in broken:
            print(f"CONTRACT BREAK: superpowers {inst['version']} "
                  f"({inst['marketplace']}) at {inst['installPath']}")
            for e in rep.missing:
                tok = e.get("token") or " | ".join(e.get("any_of", [])) or "(file must exist)"
                print(f"  - MISSING [{e['rel']}] {tok!r} — {e['why']}")
        return 1
    return 0


def _cli():
    ap = argparse.ArgumentParser()
    ap.add_argument("--claude-home", default=str(pathlib.Path.home() / ".claude"))
    ap.add_argument("--project", default=".")
    a = ap.parse_args()
    return main(a.claude_home, a.project)


if __name__ == "__main__":
    sys.exit(_cli())
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest tests/test_check_superpowers_compat.py -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/scripts/check_superpowers_compat.py tests/test_check_superpowers_compat.py
git commit -m "feat(compat): preflight composer with graded exit-code semantics"
```

---

### Task 4: Wire SKILL.md Step 1 to the preflight

**Type:** implementation
**Depends-on:** 3

**Files:**
- Modify: `skills/ultrapowers/SKILL.md`
- Test: `tests/test_compat_skill_wiring.py`

**Interfaces:**
- Consumes: the script `skills/ultrapowers/scripts/check_superpowers_compat.py` and its exit-code contract (Task 3).

- [ ] **Step 1: Write the failing test**

```python
# tests/test_compat_skill_wiring.py
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
SKILL = ROOT / "skills/ultrapowers/SKILL.md"


def test_step1_invokes_compat_script():
    text = SKILL.read_text()
    assert "check_superpowers_compat.py" in text


def test_step1_documents_graded_behavior():
    text = SKILL.read_text().lower()
    assert "contract token" in text       # the gate condition
    assert "advisory" in text             # the version-delta warn path
    assert "human" in text                # the block-with-override gate


def test_step1_no_longer_lists_a_hard_coded_cache_path():
    text = SKILL.read_text()
    assert "plugins/cache/claude-plugins-official/superpowers/`" not in text
    assert "vendored Superpowers v6 snapshot (dev 08fc48c)" not in text
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python3 -m pytest tests/test_compat_skill_wiring.py -v`
Expected: FAIL — the current Step 1 lacks `check_superpowers_compat.py` and still names the hard-coded cache path / vendored snapshot.

- [ ] **Step 3: Replace the Step 1 attestation block in `skills/ultrapowers/SKILL.md`**

Find this block (the paragraph beginning `**Validated against the vendored Superpowers v6 snapshot...` through the end of the warn-and-continue quote, immediately before `**v6 plan signals:**`) and replace it with the markdown between the `~~~` markers below (the inner ```` ```bash ```` stays a normal triple-backtick fence in SKILL.md):

~~~markdown
**Superpowers compatibility preflight.** Before computing waves, verify the
*active* superpowers still exposes the contract tokens ultrapowers depends on.
The active install is the one Claude Code actually serves skills from — resolved
from `enabledPlugins` + `installed_plugins.json`, **not** by listing a cache
directory (an earlier check listed one hard-coded path and so read a *disabled*
install's version). Run:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/check_superpowers_compat.py
```

Act on the result:

- **Exit 0** — proceed. If it printed an `advisory:` line (your superpowers
  version differs from the tested-against version but every contract token is
  present), relay that line once and continue.
- **Exit 0 with a skip notice** (superpowers not installed/resolvable) — proceed;
  the workflow path does not depend on live superpowers.
- **Non-zero** — a contract token ultrapowers depends on is missing. STOP and
  surface a human gate: quote the missing tokens the script printed (file + token
  + why) and ask the operator to confirm continuing despite the contract break,
  or abort. Suspect upstream drift first;
  `python3 -m pytest tests/test_superpowers_compat.py` localizes it in the
  ultrapowers repo.
~~~

Leave the following `**v6 plan signals:**` paragraph in place, but delete its final sentence — `This attestation only fixes which contract the tripwire checks; how `compile_plan.py` consumes the blocks is wired in the compiler tasks.` — and the preceding `Check the installed version (the directory name under ...)` clause is already removed with the block above.

- [ ] **Step 4: Run the test to verify it passes**

Run: `python3 -m pytest tests/test_compat_skill_wiring.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/SKILL.md tests/test_compat_skill_wiring.py
git commit -m "feat(compat): wire SKILL.md Step 1 to the resolver-grounded preflight"
```

---

### Task 5: GA-flip — live tripwire, retire the frozen snapshot

**Type:** implementation
**Depends-on:** 1, 2

**Files:**
- Modify: `tests/test_superpowers_compat.py`
- Test: `tests/test_superpowers_compat.py`

Files-note — `tests/test_superpowers_compat.py` (this file is its own test)

**Interfaces:**
- Consumes: `MANIFEST`, `check` (Task 1); `resolve_active` (Task 2).

- [ ] **Step 1: Confirm nothing else depends on the frozen snapshot**

Run: `grep -rn "superpowers-v6" --include=*.py --include=*.md . | grep -v docs/superpowers/`
Expected: the only matches are inside `tests/test_superpowers_compat.py` (which we rewrite below). If any other file references it, stop and surface it — do not delete the fixture blind.

- [ ] **Step 2: Replace the entire contents of `tests/test_superpowers_compat.py`**

The frozen `tests/fixtures/superpowers-v6/` snapshot was a stand-in while v6 was unreleased. v6 has shipped (6.0.0 / 6.0.2 / 6.0.3), so drift detection now runs against the live installed cache via the shared manifest. Replace the file with:

```python
"""Superpowers upstream-drift tripwire — GA-flipped.

Drift detection runs against the LIVE active superpowers, resolved exactly as the
runtime preflight resolves it, using the shared contract manifest. It skips when
no superpowers cache is present (e.g. CI), so the deterministic signal there comes
from the checker's own unit tests (tests/test_superpowers_contract.py) and the
single-source assertion below."""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "skills/ultrapowers/scripts"))
import resolve_superpowers as rs  # noqa: E402
import superpowers_contract as sc  # noqa: E402

import pytest

CLAUDE_HOME = pathlib.Path.home() / ".claude"


def _active():
    return rs.resolve_active(CLAUDE_HOME, ROOT)["active"]


@pytest.mark.skipif(not _active(), reason="no active superpowers cache on this machine (e.g. CI)")
def test_live_superpowers_satisfies_contract():
    failures = []
    for inst in _active():
        rep = sc.check(inst["installPath"])
        if not rep.ok:
            for m in rep.missing:
                tok = m.get("token") or " | ".join(m.get("any_of", [])) or "(must exist)"
                failures.append(f"{inst['version']} [{m['rel']}] {tok!r} — {m['why']}")
    assert not failures, (
        "active superpowers is missing contract tokens ultrapowers depends on:\n"
        + "\n".join(failures)
        + "\n\nRe-audit SKILL.md Steps 1/5/6 and the re-bake sources, then update "
        "MANIFEST/TESTED_AGAINST in skills/ultrapowers/scripts/superpowers_contract.py.")


def test_manifest_is_the_single_token_source():
    """This suite must not carry a parallel inline token list — it asserts only via
    the shared MANIFEST. Guards against the duplicate-source drift the repo forbids."""
    this = pathlib.Path(__file__).read_text()
    # The only place a literal contract token may live is superpowers_contract.py.
    assert "MANIFEST" in this and "sc.check" in this
    assert "HANDOFF_SKILLS" not in this  # the old hand-maintained list is gone


def test_tested_against_is_a_released_version():
    # Sanity: TESTED_AGAINST is a concrete x.y.z, not a dev snapshot label.
    parts = sc.TESTED_AGAINST.split(".")
    assert len(parts) == 3 and all(p.isdigit() for p in parts)
```

- [ ] **Step 3: Delete the retired snapshot fixture**

```bash
git rm -r tests/fixtures/superpowers-v6
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `python3 -m pytest tests/test_superpowers_compat.py -v`
Expected: PASS — `test_live_superpowers_satisfies_contract` runs against the installed cache (this machine has 6.0.0/6.0.3, both satisfy the manifest); the other two pass. On a machine with no cache the live test SKIPS.

- [ ] **Step 5: Commit**

```bash
git add tests/test_superpowers_compat.py
git commit -m "feat(compat): GA-flip — live drift tripwire via shared manifest; retire v6 snapshot"
```

---

### Task 6: Document the `.git/ultra` latent fragility

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `skills/ultrapowers/references/known-fragilities.md`
- Test: `tests/test_known_fragilities_note.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_known_fragilities_note.py
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
NOTE = ROOT / "skills/ultrapowers/references/known-fragilities.md"


def test_note_exists_and_covers_git_ultra():
    assert NOTE.exists(), "known-fragilities.md is missing"
    text = NOTE.read_text()
    assert ".git/ultra" in text
    assert "git-common-dir" in text
    assert "6.0.3" in text  # ties it to the superpowers precedent
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python3 -m pytest tests/test_known_fragilities_note.py -v`
Expected: FAIL — file does not exist.

- [ ] **Step 3: Write the note**

```markdown
# Known fragilities

Latent risks that are not currently failing but are worth tracking. Each entry
records the risk, why it does not bite today, and what would change that.

## Review packets live under `.git/ultra/`

`skills/ultrapowers/scripts/review-package` writes each task's review diff to
`$(git rev-parse --git-common-dir)/ultra/…`, i.e. **inside `.git/`**, so the
implementer and reviewer worktrees (different linked worktrees) share one location.

This is the same protected path superpowers fled in **6.0.3**: Claude Code treats
`.git/` as a protected path and denies *file-write-tool* writes there, which was
blocking superpowers' SDD subagents (it relocated its scratch to `.superpowers/sdd/`).

**Why it does not bite ultrapowers today:** ultrapowers writes the packet via a
Bash script with shell redirection (`> "$out"`), which is not intercepted the way
the Write/Edit file tools are. Empirically `.git/ultra/` accumulates packets across
runs and a write probe succeeds.

**What would change that:** if Claude Code tightens `.git/` protection to cover
Bash-tool writes, or on a surface that already does, the reviewer step would lose
its packet. The fix would be to relocate ultrapowers scratch out of `.git/` (e.g.
to `.superpowers/` like upstream, or an OS tempdir), updating `review-package`,
`waves.js` (the implementer's "generate the review packet" step and the reviewer's
read), and any sweep tooling. Tracked as a follow-up; no code move yet.
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `python3 -m pytest tests/test_known_fragilities_note.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/references/known-fragilities.md tests/test_known_fragilities_note.py
git commit -m "docs(compat): record the .git/ultra latent fragility"
```

---

### Task 7: Full-suite gate

**Type:** gate
**Depends-on:** 1, 2, 3, 4, 5, 6

**Files:**
- Test: `tests/`

Files-note — `tests/` (whole suite)

The pre-merge verification for this plan. Runs the committed suite; nothing to implement.

Run: `python3 -m pytest`
Expected: PASS — all prior tests plus the new compat tests green; no references to `tests/fixtures/superpowers-v6` remain.

---

## Wave summary (for transparency)

- **Wave 1** (independent): Task 1 (contract manifest+checker), Task 2 (resolver), Task 6 (fragility note).
- **Wave 2** (needs 1+2): Task 3 (preflight), Task 5 (GA-flip).
- **Wave 3** (needs 3): Task 4 (SKILL.md wiring).
- **Gate:** Task 7 (`python3 -m pytest`).

No same-wave file collisions: every wave-1 task writes a different new file; wave-2 writes `check_superpowers_compat.py` (Task 3) vs `tests/test_superpowers_compat.py` (Task 5); wave-3 touches only `SKILL.md`.
