# Harvester Gate Evidence + Synthetic Origin (#98) Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The ultralearn harvester records a run's full gate history and true terminus (never a stale mid-run receipt as the run's fate), reads drain-run receipts from disk when the transcript lacks them, and classifies temp-dir eval-cell runs as `origin: synthetic` so field statistics exclude them by construction.

**Architecture:** `harvest_runs.py` grows `_gate_evidence(records)` (all `mode=="gate"` receipts in order + approve/teardown terminal markers → `(reports, terminus)`), a `_disk_gate_reports(plan_path)` fallback, and one temp-root rule in `classify_origin`; `build_bundle` adds `gateReports`/`terminus`/`truncated` while `gateReport` keeps meaning the final receipt. `merge_ledger.py` names `synthetic` a first-class origin (redaction already fails closed) and tags digest rows `_(synthetic)_`.

**Tech Stack:** Python 3, pytest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-27-harvester-gate-evidence.md`

**Acceptance:** suite — the committed pytest suite is the verification; measurement-loop code, not the frozen verification periphery. No seal requested.

## Global Constraints

- **Additive bundle contract:** `bundle.gateReport` keeps its exact current meaning — the FINAL gate receipt, or `null`. New fields (`gateReports`, `terminus`, `truncated`) are additions; no existing bundle key changes shape. Every pre-existing test in `tests/test_harvest_runs.py` must pass unmodified.
- **Terminus vocabulary (verbatim):** `"approved" | "PASS" | "NEEDS_ACK" | "BLOCKED" | "unknown"`. `truncated` is `true` exactly when terminus is `"NEEDS_ACK"`, `"BLOCKED"`, or `"unknown"`.
- **Origin vocabulary (verbatim):** `"home" | "foreign" | "synthetic"`. The redaction guard's fail-closed posture is untouched: any non-`home` origin commits abstracted findings only, and `bundle_lookups`' missing-bundle default stays `"foreign"`.
- **Fail soft on disk:** the disk fallback never raises out of `build_bundle` — missing repo, unreadable JSON, or absent receipts degrade to today's behavior (`gateReport: null`).
- **No Anthropic SDK / `ANTHROPIC_API_KEY`** in any shipped or dev script (CLAUDE.md).
- Suite gate: `python3 -m pytest` green from the repo root.

---

### Task 1: Gate evidence, disk fallback, truncation, synthetic origin (harvester)

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Modify: `skills/ultralearn/scripts/harvest_runs.py`
- Test: `tests/test_harvest_runs.py`

**Interfaces:**
- Consumes: nothing from sibling tasks.
- Produces: `_gate_evidence(records) -> (list[dict], str)` where each list entry is `{"receipt": dict, "stamp": str|None, "ordinal": int, "source": "transcript"|"disk"}` and the string is the terminus; `_disk_gate_reports(plan_path: str) -> list[dict]` (same entry shape, `source: "disk"`); `classify_origin(project_slug, home_slug) -> "home"|"foreign"|"synthetic"`; bundle fields `gateReports`, `terminus`, `truncated`.

**Parallelization rationale:** none needed — the two tasks split on the existing file seam (harvester vs ledger merge), which is how the code is already factored.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_harvest_runs.py`, reusing its existing helpers (`_rec`, `make_records_with_text`, `_real_receipt`, `REAL`):

```python
# --- #98: full gate history, terminus, truncation, disk fallback, synthetic ---

def _approve_marker():
    # Mirror ultra_gate.py --approve's printed JSON shape.
    return {"mode": "approve", "stamp": "20260703-000000",
            "branch": "ultra/integration-x", "swept": None, "lockReleased": True}


def test_gate_evidence_collects_all_receipts_with_ordinals():
    first = _real_receipt("BLOCKED", 1)
    second = _real_receipt("NEEDS_ACK", 2)
    records = make_records_with_text(
        json.dumps(first, indent=2) + "\nre-ran\n" + json.dumps(second, indent=2))
    reports, terminus = h._gate_evidence(records)
    assert [r["receipt"]["verdict"] for r in reports] == ["BLOCKED", "NEEDS_ACK"]
    assert [r["ordinal"] for r in reports] == [0, 1]  # same stamp → per-stamp ordinal
    assert all(r["source"] == "transcript" for r in reports)
    assert all(r["stamp"] == "20260703-000000" for r in reports)
    assert terminus == "NEEDS_ACK"


def test_terminus_approved_when_approve_follows_blocked():
    # The recovered-false-red case: BLOCKED receipt, then the approve marker.
    records = make_records_with_text(
        json.dumps(_real_receipt("BLOCKED", 1), indent=2)
        + "\napproved:\n" + json.dumps(_approve_marker(), indent=2))
    reports, terminus = h._gate_evidence(records)
    assert [r["receipt"]["verdict"] for r in reports] == ["BLOCKED"]
    assert terminus == "approved"


def test_terminus_blocked_without_approve():
    records = make_records_with_text(json.dumps(_real_receipt("BLOCKED", 1), indent=2))
    _, terminus = h._gate_evidence(records)
    assert terminus == "BLOCKED"


def test_gate_evidence_empty_is_unknown():
    assert h._gate_evidence(make_records_with_text("no receipts here")) == ([], "unknown")


def test_disk_fallback_loads_receipts_ordered_by_mtime(tmp_path):
    repo = tmp_path / "repo"
    (repo / ".git").mkdir(parents=True)
    plan = repo / "docs/superpowers/plans/p.md"
    plan.parent.mkdir(parents=True)
    plan.write_text("plan")
    older = repo / ".claude/ultrapowers/run-a"
    newer = repo / ".claude/ultrapowers/run-b"
    older.mkdir(parents=True)
    newer.mkdir(parents=True)
    (older / "gate-receipt.json").write_text(json.dumps(_real_receipt("BLOCKED", 1)))
    (newer / "gate-receipt.json").write_text(json.dumps(_real_receipt("PASS", 0)))
    os.utime(older / "gate-receipt.json", (1000, 1000))
    os.utime(newer / "gate-receipt.json", (2000, 2000))
    entries = h._disk_gate_reports(str(plan))
    assert [e["receipt"]["verdict"] for e in entries] == ["BLOCKED", "PASS"]
    assert all(e["source"] == "disk" for e in entries)
    assert entries[0]["stamp"] == "20260703-000000"  # from the receipt itself


def test_disk_fallback_fails_soft(tmp_path):
    assert h._disk_gate_reports(str(tmp_path / "gone/plan.md")) == []
    assert h._disk_gate_reports(None) == []


def test_bundle_carries_evidence_fields(tmp_path):
    # REAL's legacy report yields a single-entry list and unknown terminus.
    session = tmp_path / "sess.jsonl"
    session.write_text("\n".join(json.dumps(r) for r in REAL) + "\n")
    out = h.build_bundle(session, "-Users-marcusestes-Documents-Legal-x",
                         tmp_path / "cache", "-Users-marcusestes-Websites-ultrapowers")
    bundle = json.loads((out / "bundle.json").read_text())
    assert bundle["gateReport"]["integrationBranch"] == "ultra/x"  # unchanged meaning
    assert bundle["gateReports"][0]["receipt"]["integrationBranch"] == "ultra/x"
    assert bundle["terminus"] == "unknown"
    assert bundle["truncated"] is True


def test_classify_origin_synthetic_temp_roots():
    home = "-Users-marcusestes-Websites-ultrapowers"
    for slug in ("-tmp-jsdeps-cell-abc", "-private-tmp-x",
                 "-var-folders-9k-xyz", "-private-var-folders-9k-xyz"):
        assert h.classify_origin(slug, home) == "synthetic"
    assert h.classify_origin(home, home) == "home"
    assert h.classify_origin(home + "--worktree", home) == "home"
    assert h.classify_origin("-Users-x-proj", home) == "foreign"
```

Add `import os` to the test file's imports if absent.

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest tests/test_harvest_runs.py -q`
Expected: FAIL — `h._gate_evidence` / `h._disk_gate_reports` do not exist; synthetic slugs classify `foreign`.

- [ ] **Step 3: Implement in `harvest_runs.py`**

1. `classify_origin` gains the temp-root rule FIRST (a home slug never carries these prefixes, so precedence is safe):

```python
SYNTHETIC_SLUG_PREFIXES = ("-tmp-", "-private-tmp-",
                           "-var-folders-", "-private-var-folders-")


def classify_origin(project_slug, home_slug):
    if project_slug.startswith(SYNTHETIC_SLUG_PREFIXES):
        return "synthetic"
    if project_slug == home_slug or project_slug.startswith(home_slug + "--"):
        return "home"
    return "foreign"
```

2. Generalize the receipt scan. Rename the body of `_gate_report` into `_gate_evidence(records)` and keep `_gate_report` as a thin compatibility wrapper:

```python
def _gate_evidence(records):
    """All printed gate receipts in transcript order, plus the run terminus.

    Returns (reports, terminus): reports is a list of
    {"receipt", "stamp", "ordinal", "source"} (ordinal = position among
    receipts sharing that stamp, transcript order); terminus is "approved"
    when an approve marker follows the last receipt (or stands alone),
    else the last receipt's verdict, else "unknown".
    """
    receipts, approve_after = [], False
    for _r, b in _iter_blocks(records):
        txt = _block_text(b)
        i = txt.find('"mode"')
        while i != -1:
            start = txt.rfind("{", 0, i + 1)
            if start != -1:
                obj = _balanced_json(txt, start)
                if isinstance(obj, dict) and obj.get("mode") == "gate" and "verdict" in obj:
                    receipts.append(obj)
                    approve_after = False
                elif isinstance(obj, dict) and obj.get("mode") in ("approve", "teardown") \
                        and "lockReleased" in obj:
                    if obj["mode"] == "approve":
                        approve_after = True
            i = txt.find('"mode"', i + 1)
    if receipts:
        per_stamp = {}
        reports = []
        for r in receipts:
            stamp = r.get("stamp")
            ordinal = per_stamp.get(stamp, 0)
            per_stamp[stamp] = ordinal + 1
            reports.append({"receipt": r, "stamp": stamp,
                            "ordinal": ordinal, "source": "transcript"})
        terminus = "approved" if approve_after else receipts[-1].get("verdict", "unknown")
        return reports, terminus
    if approve_after:
        return [], "approved"
    legacy = _legacy_gate_report(records)   # the existing pass-2 scan, extracted verbatim
    if legacy is not None:
        return [{"receipt": legacy, "stamp": None,
                 "ordinal": 0, "source": "transcript"}], "unknown"
    return [], "unknown"


def _gate_report(records):
    reports, _ = _gate_evidence(records)
    return reports[-1]["receipt"] if reports else None
```

Extract the current pass-2 (`"integrationBranch"` scan) into `_legacy_gate_report(records)` byte-for-byte; the anchored `"mode"`/balanced-JSON scan above is the current pass-1 extended with the approve/teardown branch. Note the deliberate detail: a gate receipt after an approve marker resets `approve_after` — only an approve that FOLLOWS the last receipt makes the terminus `approved`.

3. Disk fallback:

```python
def _disk_gate_reports(plan_path):
    """Fallback for runs whose transcript shows no receipts (docket drains):
    read gate-receipt.json files from the run's repo, located via planPath.
    Fails soft to [] — the repo may be gone."""
    if not plan_path:
        return []
    root = Path(plan_path).parent
    while root != root.parent:
        if (root / ".git").exists():
            break
        root = root.parent
    else:
        return []
    if not (root / ".git").exists():
        return []
    entries = []
    try:
        files = sorted((root / ".claude/ultrapowers").glob("run-*/gate-receipt.json"),
                       key=lambda p: p.stat().st_mtime)
    except OSError:
        return []
    for f in files:
        try:
            obj = json.loads(f.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(obj, dict) and "verdict" in obj:
            entries.append({"receipt": obj,
                            "stamp": obj.get("stamp") or f.parent.name[len("run-"):],
                            "ordinal": 0, "source": "disk"})
    per_stamp = {}
    for e in entries:
        e["ordinal"] = per_stamp.get(e["stamp"], 0)
        per_stamp[e["stamp"]] = e["ordinal"] + 1
    return entries
```

4. Wire `build_bundle`: replace the `gate_report = _gate_report(records)` line with:

```python
    gate_reports, terminus = _gate_evidence(records)
    if not gate_reports:
        gate_reports = _disk_gate_reports(plan_path)
        if gate_reports:
            terminus = gate_reports[-1]["receipt"].get("verdict", "unknown")
    gate_report = gate_reports[-1]["receipt"] if gate_reports else None
```

and extend the `bundle = {...}` dict (keeping `"gateReport": gate_report` exactly as is) with:

```python
        "gateReports": gate_reports,
        "terminus": terminus,
        "truncated": terminus in ("NEEDS_ACK", "BLOCKED", "unknown"),
```

(`classify_session_kind` keeps receiving `gate_report`, unchanged.)

- [ ] **Step 4: Run the tests**

Run: `python3 -m pytest tests/test_harvest_runs.py -q`
Expected: PASS — including every pre-existing `_gate_report` test unmodified (the wrapper preserves last-receipt and legacy-fallback behavior). Then `python3 -m pytest -q` green.

- [ ] **Step 5: Commit**

```bash
git add skills/ultralearn/scripts/harvest_runs.py tests/test_harvest_runs.py
git commit -m "feat(ultralearn): full gate history + terminus + truncated, disk receipt fallback, synthetic origin (#98)"
```

---

### Task 2: Ledger merge — synthetic as a first-class origin

**Type:** implementation
**Depends-on:** none
**Review:** lean

**Files:**
- Modify: `skills/ultralearn/scripts/merge_ledger.py`
- Test: `tests/test_merge_ledger.py`

**Interfaces:**
- Consumes: nothing from sibling tasks (origin values arrive as plain strings in findings/bundles).
- Produces: digest rows tagged `_(synthetic)_` for `origin == "synthetic"`; `redact_finding` docstring naming the three-value origin vocabulary; unchanged fail-closed behavior.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_merge_ledger.py` (reusing its `_finding` helper and `m` import):

```python
def test_synthetic_verbatim_rejected_abstracted_allowed():
    # synthetic is non-home → fail-closed redaction, same as foreign.
    assert m.redact_finding(_finding(evidenceAbstracted=False), "synthetic") is None
    out = m.redact_finding(_finding(evidenceAbstracted=True, evidence="shape only"),
                           "synthetic")
    assert out is not None and out["origin"] == "synthetic"


def test_digest_tags_synthetic_rows(tmp_path):
    ledger = tmp_path / "ledger.jsonl"
    rows = [
        m.redact_finding(_finding(title="synth", evidenceAbstracted=True,
                                  evidence="shape"), "synthetic"),
        m.redact_finding(_finding(title="field", evidenceAbstracted=True,
                                  evidence="shape"), "foreign"),
    ]
    ledger.write_text("\n".join(json.dumps(r) for r in rows) + "\n")
    digest = tmp_path / "digest.md"
    m.regenerate_digest(ledger, digest)
    text = digest.read_text()
    synth_line = next(line for line in text.splitlines() if "synth" in line)
    field_line = next(line for line in text.splitlines() if "field" in line)
    assert "_(synthetic)_" in synth_line and "_(abstracted)_" not in synth_line
    assert "_(abstracted)_" in field_line
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest tests/test_merge_ledger.py -q`
Expected: `test_digest_tags_synthetic_rows` FAILS (synthetic rows currently tag `_(abstracted)_`); the redaction test may already pass (fail-closed is generic) — that is fine, it pins the contract.

- [ ] **Step 3: Implement in `merge_ledger.py`**

1. In `regenerate_digest`, replace the tag line with:

```python
            if f.get("origin") == "home":
                tag = ""
            elif f.get("origin") == "synthetic":
                tag = " _(synthetic)_"
            else:
                tag = " _(abstracted)_"
```

2. In `redact_finding`'s docstring, name the vocabulary — replace the "Fails closed" sentence with:

```
    Origin is one of "home" | "foreign" | "synthetic" (eval-cell runs; field
    statistics exclude synthetic rows by construction). Fails closed: any
    origin other than 'home' commits abstracted findings only.
```

- [ ] **Step 4: Run the tests**

Run: `python3 -m pytest tests/test_merge_ledger.py -q` then `python3 -m pytest -q`
Expected: PASS; full suite green.

- [ ] **Step 5: Commit**

```bash
git add skills/ultralearn/scripts/merge_ledger.py tests/test_merge_ledger.py
git commit -m "feat(ultralearn): synthetic as first-class origin in redaction docs + digest tagging (#98)"
```

---

### Task 3: Suite gate

**Type:** gate
**Depends-on:** 1, 2

Run from the repo root on the integrated tree:

- `python3 -m pytest` — the whole committed suite green (no harness JS changed in this plan, so no `.mjs` sims are triggered).
