# Residual Manifest at Finishing (#149) Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Acceptance:** suite — the committed pytest suite (including the new `tests/test_residual_manifest.py`) is the verification; no harness JS is touched, so no `.mjs` sims and no re-bake.

**Goal:** Close #149: derive the finishing obligation list mechanically from
report.json's three finding families instead of trusting orchestrator memory,
and make run close / drain-entry close pass a mechanical, non-frozen
disposition check.

**Architecture:** One new advisory script with two modes — derive (multi-report
union of `completenessFindings` + `judgmentCalls` + `deferredVerification`
into content-addressed manifest rows) and `--check` (exit-code authority that
every row is dispositioned). The contract lives in exactly one home (the
finishing-notes reference, whose old Deferred-verification checklist section it
replaces); the report-format reference gains a one-line pointer; the two
SKILL.md files gain only invocation wiring. No frozen gate script, harness JS,
or report.json schema change anywhere.

**Tech Stack:** Python 3.11, stdlib only (`argparse`, `hashlib`, `json`, `re`);
pytest via `python3 -m pytest`. No new dependencies; no Anthropic API/SDK
(repo rule: distributed plugin needs no API key).

**Spec:** docs/superpowers/specs/2026-08-14-residual-manifest.md

## Global Constraints

- **Frozen gate scripts stay byte-identical:** `gate_check.py` (its NEEDS_ACK
  machinery is NOT extended — its acks derive from `coverage` +
  `deferredVerification` only, and stay that way), `ultra_gate.py`,
  `run_lock.sh` untouched. The manifest is a layer above the gate, at the
  ceremony the gate feeds.
- **report.json schema unchanged:** the engine emits nothing new;
  `skills/ultrapowers/harnesses/*.js` untouched (so no `.mjs` sim is owed and
  the report-format reference is not a bake source — no re-bake).
- **`tests/test_report_runbook.py` must stay green** after every task.
- **Shrink budget (complexity-ratcheted SKILL.md surfaces):** the
  `skills/ultrapowers/SKILL.md` edit must be net-negative-or-neutral in words —
  `wc -w` after ≤ 2794 (the before-count; the replaced "carry prior items
  forward yourself" text pays for the new instruction). The
  `skills/ultradocket/SKILL.md` edit grows ≤ 45 words (1847 before → ≤ 1892).
- **One vocabulary, one grammar, everywhere:** disposition values are exactly
  `fixed | acked | filed:<ref> | waived:<reason>`; row grammar is exactly
  `- <id> [<family>] <text> — disposition: <value>` (em dash, U+2014); row id is
  `<family>-<12-hex sha256 of the normalized finding text>` with `-2`/`-3`…
  tiebreak for byte-identical duplicates within one report. The old
  `closed | still-open | needs-human` triple is superseded and deleted, with
  its mapping stated once in the contract home.
- **Canonical manifest location:** `<runDir>/residual-manifest.md`, beside
  report.json. The new script is NON-frozen, advisory-by-construction; its
  exit code is authority only at the close ceremony.

---

### Task 1: `residual_manifest.py` — derive + check modes, with tests

**Type:** implementation
**Depends-on:** none
**Review:** adversarial

**Files:**
- Create: `skills/ultrapowers/scripts/residual_manifest.py`
- Test: `tests/test_residual_manifest.py`

**Interfaces:**
- Consumes: nothing from other tasks. Reads report.json files in either shape:
  the saved Workflow envelope (gate fields under `result.*`) or a bare result
  object; reads `standing-approval.json` (`{grantedAt, instruction, ackList}`,
  ackList entries in the gate-check ack shape
  `{"type": "deferred:<reason>", "detail": "<deliverable> — <why>..."}`).
- Produces: **the CLI contract** the two documentation-wiring tasks reference:
  - Derive: `python3 skills/ultrapowers/scripts/residual_manifest.py
    <report.json> [more-reports...] [--gate-acks <standing-approval.json>]`
    → manifest markdown on stdout (invoker redirects to
    `<runDir>/residual-manifest.md`), exit 0; exit 1 on unreadable input.
  - Check: `python3 skills/ultrapowers/scripts/residual_manifest.py --check
    <manifest.md>` → exit 0 iff every row's disposition is one of
    `fixed | acked | filed:<ref> | waived:<reason>` (a zero-row manifest
    passes, vacuously); exit 2 naming each undispositioned/invalid row id on
    stderr; exit 1 on unreadable input.
  - Row grammar (one line per row, exactly; anything else is commentary):
    `- <id> [<family>] <text> — disposition: <value>` with
    `<id> = <family>-<12-hex sha256 of normalized text>` (+ `-2`/`-3`…
    tiebreak within one report) and `<family>` one of the literal report
    field names `completenessFindings | judgmentCalls | deferredVerification`.

Advisory by construction like the neighbouring `audit_run.py` /
`redirect_args.py`: argparse, `die()` to stderr + exit 1 on unreadable input,
no third-party imports, never invoked by any frozen gate script.
Normalization = collapse all whitespace runs to single spaces and strip
(`" ".join(text.split())`). A `deferredVerification` object normalizes to the
text `<deliverable> (<reason>) — <why>` (` — <why>` omitted when `why` is
empty). `--gate-acks` pre-fills `acked` ONLY for a `deferredVerification` row
whose recorded ackList entry has `type == "deferred:<reason>"` and `detail`
starting `"<deliverable> — "` — derivation from a durable record, never
auto-judgment; everything else derives with an empty disposition slot.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_residual_manifest.py` with exactly this content:

```python
# tests/test_residual_manifest.py
import hashlib
import json
import subprocess
import sys
from pathlib import Path

SCRIPT = (Path(__file__).resolve().parents[1] /
          "skills/ultrapowers/scripts/residual_manifest.py")

CF = "Task 2 endpoint lacks a timeout test"
JC = "degradation: task 3 budget-deferred (budget exhausted at wave 2)"
DV_BROWSER = {"deliverable": "viewer/swarm.html", "reason": "browser",
              "why": "live UI flow"}
DV_RUNTIME = {"deliverable": "deploy hook", "reason": "runtime",
              "why": "needs prod boot"}


def rid(family, text):
    norm = " ".join(text.split())
    return family + "-" + hashlib.sha256(norm.encode("utf-8")).hexdigest()[:12]


def report(**over):
    result = {"integrationBranch": "ultra/int-1", "waves": [["1"]],
              "tasks": [{"task": "1", "status": "done"}],
              "tests": {"passed": True}, "unfinished": [],
              "completenessFindings": [CF], "judgmentCalls": [JC],
              "deferredVerification": [DV_BROWSER, DV_RUNTIME]}
    result.update(over)
    return {"summary": "workflow envelope", "result": result}


def write(tmp_path, name, obj):
    p = tmp_path / name
    p.write_text(json.dumps(obj))
    return p


def run(*argv):
    return subprocess.run([sys.executable, str(SCRIPT), *map(str, argv)],
                          capture_output=True, text=True)


def manifest_rows(stdout):
    return [l for l in stdout.splitlines() if l.startswith("- ")]


def test_derive_emits_exact_rows_for_all_three_families(tmp_path):
    rp = write(tmp_path, "report.json", report())
    r = run(rp)
    assert r.returncode == 0, r.stderr
    dv_browser_text = "viewer/swarm.html (browser) — live UI flow"
    dv_runtime_text = "deploy hook (runtime) — needs prod boot"
    assert manifest_rows(r.stdout) == [
        "- %s [completenessFindings] %s — disposition:"
        % (rid("completenessFindings", CF), CF),
        "- %s [judgmentCalls] %s — disposition:"
        % (rid("judgmentCalls", JC), JC),
        "- %s [deferredVerification] %s — disposition:"
        % (rid("deferredVerification", dv_browser_text), dv_browser_text),
        "- %s [deferredVerification] %s — disposition:"
        % (rid("deferredVerification", dv_runtime_text), dv_runtime_text),
    ]


def test_multi_report_union_dedupes_by_content_id(tmp_path):
    r1 = write(tmp_path, "r1.json", report())
    r2 = write(tmp_path, "r2.json",
               report(completenessFindings=[CF, "second-round-only finding"]))
    rows_single = manifest_rows(run(r1).stdout)
    rows_union = manifest_rows(run(r1, r2).stdout)
    # the same finding in two rounds -> ONE row with the SAME id
    assert len(rows_union) == len(rows_single) + 1
    assert set(rows_single) < set(rows_union)
    assert any("second-round-only finding" in row for row in rows_union)


def test_byte_identical_duplicates_within_one_report_get_tiebreak_ids(tmp_path):
    rp = write(tmp_path, "r.json", report(judgmentCalls=[JC, JC, JC]))
    rows = manifest_rows(run(rp).stdout)
    base = rid("judgmentCalls", JC)
    ids = [row.split()[1] for row in rows if "[judgmentCalls]" in row]
    assert ids == [base, base + "-2", base + "-3"]


def test_gate_acks_prefills_only_recorded_items(tmp_path):
    rp = write(tmp_path, "r.json", report())
    sa = write(tmp_path, "standing-approval.json", {
        "grantedAt": "turn-3",
        "instruction": "approve if clean apart from the usual runtime acks",
        "ackList": [{"type": "deferred:runtime",
                     "detail": "deploy hook — needs prod boot "
                               "[structural false-green: sandbox could not "
                               "execute it against the target]"}]})
    rows = manifest_rows(run(rp, "--gate-acks", sa).stdout)
    runtime = [x for x in rows if "deploy hook (runtime)" in x]
    browser = [x for x in rows if "viewer/swarm.html (browser)" in x]
    assert runtime and runtime[0].endswith("— disposition: acked")
    assert browser and browser[0].endswith("— disposition:")


def test_bare_result_object_accepted(tmp_path):
    rp = write(tmp_path, "r.json", report()["result"])
    r = run(rp)
    assert r.returncode == 0
    assert len(manifest_rows(r.stdout)) == 4


def test_check_green_on_fully_dispositioned_manifest(tmp_path):
    rp = write(tmp_path, "r.json", report())
    values = iter(["fixed", "filed:#152", "acked",
                   "waived:sandbox cannot reach prod"])
    dispositioned = []
    for line in run(rp).stdout.splitlines():
        if line.startswith("- ") and line.endswith("disposition:"):
            line = line + " " + next(values)
        dispositioned.append(line)
    m = tmp_path / "residual-manifest.md"
    m.write_text("\n".join(dispositioned) + "\nfree commentary, ignored\n")
    r = run("--check", m)
    assert r.returncode == 0, r.stderr


def test_check_zero_row_manifest_passes_vacuously(tmp_path):
    m = tmp_path / "residual-manifest.md"
    m.write_text("# Residual manifest\n\nNo residual findings.\n")
    assert run("--check", m).returncode == 0


def test_check_red_names_undispositioned_and_invalid_rows(tmp_path):
    rp = write(tmp_path, "r.json", report())
    rows = manifest_rows(run(rp).stdout)
    fixed, empty, invalid = rows[0] + " fixed", rows[1], rows[2] + " done"
    m = tmp_path / "residual-manifest.md"
    m.write_text("\n".join([fixed, empty, invalid]) + "\n")
    r = run("--check", m)
    assert r.returncode == 2
    assert empty.split()[1] in r.stderr
    assert invalid.split()[1] in r.stderr
    assert fixed.split()[1] not in r.stderr


def test_derive_without_reports_exits_1():
    r = run()
    assert r.returncode == 1
    assert "derive mode needs" in r.stderr
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest tests/test_residual_manifest.py -v`
Expected: 9 FAILED — the script does not exist, so every subprocess exits 2
(`can't open file`) and the assertions on returncode/stdout fail.

- [ ] **Step 3: Write the implementation**

Create `skills/ultrapowers/scripts/residual_manifest.py` with exactly this
content:

```python
#!/usr/bin/env python3
"""Derive and check the residual manifest at finishing (issue #149).

report.json emits three finding families -- completenessFindings,
judgmentCalls, deferredVerification -- but whether they survive to
release/close used to depend on orchestrator memory. Derive mode unions all
three families across every report passed (resume/redirect rounds each pass
their report) into one manifest row per distinct finding, content-addressed
so the same finding gets the same id in every round. Check mode is the
mechanical close check: exit 0 iff every row is dispositioned.

Modes:
  derive: residual_manifest.py <report.json> [more-reports...]
              [--gate-acks <standing-approval.json>]  > residual-manifest.md
  check:  residual_manifest.py --check <manifest.md>

Row grammar (one line per row, exactly; anything else is commentary):
  - <id> [<family>] <text> — disposition: <value>
with <id> = <family>-<12-hex sha256 of the normalized text> (byte-identical
duplicates within one report tiebreak -2, -3, ...) and <value> one of
fixed | acked | filed:<ref> | waived:<reason>.

Canonical manifest location: <runDir>/residual-manifest.md, beside
report.json. NON-FROZEN and advisory-by-construction: a layer above the
gate, at the ceremony the gate feeds -- it extends no frozen gate script.
"""
import argparse
import hashlib
import json
import re
import sys

FAMILIES = ("completenessFindings", "judgmentCalls", "deferredVerification")

ROW = re.compile(r"^- (?P<id>[A-Za-z]+-[0-9a-f]{12}(?:-\d+)?) "
                 r"\[(?P<family>[A-Za-z]+)\] "
                 r"(?P<text>.*) — disposition:(?P<value>.*)$")
DISPOSITION = re.compile(r"^(?:fixed|acked|filed:\S+|waived:\S.*)$")


def die(msg):
    print("residual_manifest: " + msg, file=sys.stderr)
    sys.exit(1)


def load_json(path, what):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError, TypeError) as e:
        die("unreadable %s %r (%s)" % (what, path, e))


def load_result(path):
    """Accept the saved Workflow envelope (gate fields live under result.*)
    or a bare result object."""
    data = load_json(path, "report")
    if isinstance(data, dict) and isinstance(data.get("result"), dict):
        return data["result"]
    return data if isinstance(data, dict) else {}


def normalize(text):
    return " ".join(str(text).split())


def finding_text(family, item):
    if family == "deferredVerification" and isinstance(item, dict):
        head = "%s (%s)" % (item.get("deliverable", "?"),
                            item.get("reason", "unknown"))
        why = normalize(item.get("why", "") or "")
        return normalize(head) + ((" — " + why) if why else "")
    return normalize(item)


def acked_by_record(item, ack_list):
    """Pre-fill from durable records only: a standing-approval.json ackList
    entry (gate_check.py ack shape: type "deferred:<reason>", detail starting
    "<deliverable> — ") matching this deferredVerification item."""
    if not (isinstance(item, dict) and ack_list):
        return False
    deliverable = str(item.get("deliverable", "?"))
    reason = str(item.get("reason", "unknown"))
    for ack in ack_list:
        if (isinstance(ack, dict)
                and str(ack.get("type", "")) == "deferred:" + reason
                and str(ack.get("detail", "")).startswith(deliverable + " — ")):
            return True
    return False


def derive(report_paths, ack_list):
    rows = {}  # id -> (family, text, disposition-suffix); insertion-ordered
    for path in report_paths:
        result = load_result(path)
        seen = {}  # per-report tiebreak counters for byte-identical dupes
        for family in FAMILIES:
            items = result.get(family) or []
            if not isinstance(items, list):
                continue
            for item in items:
                text = finding_text(family, item)
                if not text:
                    continue
                digest = hashlib.sha256(
                    text.encode("utf-8")).hexdigest()[:12]
                base = family + "-" + digest
                n = seen.get(base, 0) + 1
                seen[base] = n
                rid = base if n == 1 else "%s-%d" % (base, n)
                if rid in rows:
                    continue  # the union dedupes on content id
                disp = (" acked" if family == "deferredVerification"
                        and acked_by_record(item, ack_list) else "")
                rows[rid] = (family, text, disp)
    return rows


def emit(rows, sources):
    lines = ["# Residual manifest", "",
             "<!-- derived from: " + ", ".join(sources) + " -->",
             "<!-- disposition one of: fixed | acked | filed:<ref> | "
             "waived:<reason> -->", ""]
    if not rows:
        lines.append("No residual findings.")
    for rid, (family, text, disp) in rows.items():
        lines.append("- %s [%s] %s — disposition:%s"
                     % (rid, family, text, disp))
    print("\n".join(lines))


def check(path):
    try:
        with open(path) as f:
            lines = f.read().splitlines()
    except OSError as e:
        die("unreadable manifest %r (%s)" % (path, e))
    bad, total = [], 0
    for line in lines:
        m = ROW.match(line)
        if not m:
            continue  # commentary
        total += 1
        value = m.group("value").strip()
        if not DISPOSITION.match(value):
            bad.append(m.group("id") +
                       ("" if not value
                        else " (invalid disposition %r)" % value))
    if bad:
        print("residual_manifest: NOT CLEAN — %d undispositioned row(s):"
              % len(bad), file=sys.stderr)
        for b in bad:
            print("  " + b, file=sys.stderr)
        return 2
    print("residual_manifest: CLEAN — %d row(s) dispositioned%s"
          % (total, " (zero rows: vacuous pass)" if total == 0 else ""))
    return 0


def main():
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("reports", nargs="*",
                    help="report.json files to union (derive mode)")
    ap.add_argument("--gate-acks", default=None, metavar="STANDING_APPROVAL",
                    help="standing-approval.json whose recorded ackList "
                         "pre-dispositions matching deferredVerification "
                         "rows as acked")
    ap.add_argument("--check", default=None, metavar="MANIFEST",
                    help="check mode: exit 0 iff every row is dispositioned")
    a = ap.parse_args()

    if a.check:
        if a.reports or a.gate_acks:
            die("--check takes a manifest only (no reports, no --gate-acks)")
        return check(a.check)
    if not a.reports:
        die("derive mode needs at least one report.json "
            "(or --check <manifest>)")
    ack_list = []
    if a.gate_acks:
        ack_list = load_json(a.gate_acks, "gate-acks").get("ackList") or []
    emit(derive(a.reports, ack_list), a.reports)
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

Then: `chmod +x skills/ultrapowers/scripts/residual_manifest.py`

- [ ] **Step 4: Run the new tests to verify they pass**

Run: `python3 -m pytest tests/test_residual_manifest.py -v`
Expected: 9 passed.

- [ ] **Step 5: Run the full suite**

Run: `python3 -m pytest`
Expected: 951 passed (the 942-test baseline + these 9), including
`tests/test_report_runbook.py` untouched-green.

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/scripts/residual_manifest.py tests/test_residual_manifest.py
git commit -m "feat(scripts): residual_manifest.py — derive + mechanical close check (#149)"
```

---

### Task 2: Contract home in the finishing-notes reference + report-format pointer

**Type:** implementation
**Depends-on:** 1
**Review:** lean

**Files:**
- Modify: `skills/ultrapowers/references/finishing-notes.md`
- Modify: `skills/ultrapowers/references/report-format.md`

**Interfaces:**
- Consumes: the CLI contract from the task that builds the derive/check script
  (invocation forms, row grammar, id form, disposition vocabulary, exit codes,
  canonical location — restated verbatim in Step 1 below).
- Produces: the `## Residual manifest` contract section — the ONE place the
  contract lives. Coordination note: this section name is fixed by this plan;
  the sibling SKILL-wiring task points at it as
  "§Residual manifest" without depending on this task (different files).

- [ ] **Step 1: Replace the Deferred-verification checklist section with the Residual manifest contract**

In `skills/ultrapowers/references/finishing-notes.md`, delete this section
(lines 61–71, quoted verbatim — the old `closed | still-open | needs-human`
vocabulary is superseded, not kept alongside):

~~~markdown
## Deferred-verification checklist

The gate report's `deferredVerification` array is a post-merge obligation
list, not a footnote. After the merge lands, walk it item by item: attempt
closure where tooling exists (run the runtime path, drive the browser flow,
hit the deployed service), and report per-item status in the finishing
summary — `closed` (verified, say how), `still-open` (say what blocks it),
or `needs-human` (say exactly what the operator must do). The checklist
authorizes no new autonomous actions — anything beyond already-authorized
tooling stays `needs-human`. An item nobody closes survives in the summary
by name; it must never silently evaporate between the gate and the handoff.
~~~

and put exactly this in its place (same position, between the "Cross-phase
integration review" and "Shipped SHA ≠ gate-verified SHA" sections):

~~~markdown
## Residual manifest

The gate report's three finding families — `completenessFindings`,
`judgmentCalls`, `deferredVerification` — feed one derived obligation list
at finishing: the residual manifest. Derivation and disposition are
required at run close and at drain-entry close; the finishing summary
attaches the manifest. Derive it from **all** of this run's gate reports
(resume/redirect rounds each pass theirs — the union is computed, never
remembered):

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/residual_manifest.py \
  <report.json> [more-reports...] [--gate-acks <runDir>/standing-approval.json] \
  > <runDir>/residual-manifest.md
```

Canonical location: `<runDir>/residual-manifest.md`, beside report.json.
One row per distinct finding, content-addressed — id
`<family>-<12-hex sha256 of the normalized text>`, so the same finding gets
the same id in every round and the union dedupes on id; byte-identical
duplicates within one report tiebreak `-2`, `-3`, … Each row is exactly:

```
- <id> [<family>] <text> — disposition: <value>
```

Anything else in the file is commentary. With `--gate-acks`,
`deferredVerification` rows carrying a recorded gate ack are emitted
pre-dispositioned `acked` — derivation from a durable record, never
auto-judgment. Every other row derives with an empty disposition slot for
the orchestrator or operator to fill with one of:

- `fixed` — verified closed (say how in the row text).
- `acked` — operator acknowledged; the required action is named in the row
  text. Anything beyond already-authorized tooling lands here — the
  manifest authorizes no new autonomous actions.
- `filed:<ref>` — stays open under a tracking reference.
- `waived:<reason>` — stays open with the reason stated.

(Supersedes the old per-item `closed | still-open | needs-human` triple:
`closed → fixed`; `still-open → filed:<ref>` or `waived:<reason>` — staying
open with neither a ref nor a reason is exactly the evaporation this
manifest exists to kill; `needs-human → acked`.)

The close check — exit-code authority for the close ceremony, touching no
frozen gate script:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/skills/ultrapowers/scripts/residual_manifest.py \
  --check <runDir>/residual-manifest.md
```

Exit 0 iff every row is dispositioned (a zero-row manifest passes,
vacuously); exit 2 names the undispositioned rows. Resume gates derive and
render the union only — `--check` runs solely at run close and drain-entry
close.
~~~

- [ ] **Step 2: Add the one pointer line to the report-format reference**

In `skills/ultrapowers/references/report-format.md`, directly after the
field-reference table (its last row is the `completenessFindings` row) and
before the `### \`waveMerges[].status\` values` heading, insert one line (with
a blank line on each side):

~~~markdown
The three finding-family arrays — `completenessFindings`, `judgmentCalls`, `deferredVerification` — feed the residual manifest at finishing (derive + disposition contract: `finishing-notes.md` §Residual manifest).
~~~

No new contract section here — the contract lives only in the section created
in Step 1.

- [ ] **Step 3: Retarget the presentation item 9a cross-reference (rename fallout)**

Still in `report-format.md`, presentation item 9a ends with a pointer to the
section Step 1 deleted; leaving it would dangle. Replace only its final
sentence — old:

~~~markdown
After merge, finishing consumes this array as a per-item checklist — see finishing-notes.md §Deferred-verification checklist.
~~~

new:

~~~markdown
After merge, finishing consumes this array via the residual manifest — see finishing-notes.md §Residual manifest.
~~~

This is a mechanical retarget of an existing pointer to the renamed section,
not new contract content; the "one line only" of new pointer content is
Step 2's line.

- [ ] **Step 4: Verify the old vocabulary and section name are gone**

Run: `grep -rn "Deferred-verification checklist" skills/`
Expected: no matches (exit 1).

Run: `grep -rln "still-open\|needs-human" skills/`
Expected: exactly one file — `skills/ultrapowers/references/finishing-notes.md`
(the single stated-mapping sentence beginning "Supersedes the old per-item").

Run: `grep -c "§Residual manifest" skills/ultrapowers/references/report-format.md`
Expected: `2` (the Step-2 pointer + the retargeted 9a pointer).

- [ ] **Step 5: Run the suite (the report-runbook pin must stay green)**

Run: `python3 -m pytest tests/test_report_runbook.py -v` then `python3 -m pytest`
Expected: report-runbook tests pass (the pin greps `waveMerges`/frontier/
reviewVerdict literals, all untouched); full suite green.

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/references/finishing-notes.md skills/ultrapowers/references/report-format.md
git commit -m "docs(references): residual-manifest contract home + report-format pointer (#149)"
```

---

### Task 3: SKILL wiring — finishing step + resume gates (ultrapowers), end gate (ultradocket)

**Type:** implementation
**Depends-on:** 1
**Review:** lean

**Files:**
- Modify: `skills/ultrapowers/SKILL.md`
- Modify: `skills/ultradocket/SKILL.md`

**Interfaces:**
- Consumes: the CLI contract from the task that builds the derive/check script
  (derive over all rounds' reports to `<runDir>/residual-manifest.md`;
  `--check` exit-code authority at close; zero-row manifests pass vacuously).
  Coordination note: the contract home's section name is fixed by this plan as
  `## Residual manifest` in the ultrapowers finishing-notes reference — point
  at it by that name; do NOT depend on the sibling documentation task
  (different files, no shared edit).
- Produces: nothing consumed downstream (prose invocation wiring only).

Shrink budget (hard acceptance criterion, restated from Global Constraints):
`skills/ultrapowers/SKILL.md` `wc -w` after ≤ 2794 (before-count; expected
2789 — the deleted carry-forward text pays for the new instruction).
`skills/ultradocket/SKILL.md` grows ≤ 45 words: 1847 before → ≤ 1892
(expected ≈ 1879).

- [ ] **Step 1: Record the word-count baselines**

Run: `wc -w skills/ultrapowers/SKILL.md skills/ultradocket/SKILL.md`
Expected: `2794` and `1847`. (If they differ, the files moved under this plan
— stop and re-derive the budget as after ≤ before for the ultrapowers file and
after ≤ before+45 for the ultradocket file.)

- [ ] **Step 2: Replace the resume-gate carry-forward text (derive + render only)**

In `skills/ultrapowers/SKILL.md` Step 5, replace this paragraph (lines
244–248, quoted verbatim):

~~~markdown
**Resume gates carry the union.** A Salvage/Redirect relaunch produces a fresh
report, so at any gate reached via relaunch, present the **union** of
`deferredVerification` items across every gate report this integration branch
has produced — carry prior items forward yourself; an item leaves the ack list
only by explicit operator disposition, never as a relaunch side effect.
~~~

with exactly:

~~~markdown
**Resume gates derive the union.** At any gate reached via relaunch, derive and
render the manifest (`residual_manifest.py` over every gate report this
integration branch has produced) — render only; `--check` runs solely at run
close.
~~~

(57 words → 35: a mid-run Redirect round must not pay a full disposition
ceremony for judgment calls still in flight.)

- [ ] **Step 3: Wire the finishing step into the Approve bullet**

Still in `skills/ultrapowers/SKILL.md`, in the **Approve** bullet, replace this
passage (quoted verbatim, two-space bullet indentation preserved):

~~~markdown
  (single-run pipelines already got it at Step 4), then apply the two
  `references/finishing-notes.md` checks and proceed to
  `superpowers:finishing-a-development-branch`, carrying the runbook.
~~~

with exactly:

~~~markdown
  (single-run pipelines already got it at Step 4). Then (every run) derive
  `<runDir>/residual-manifest.md` from every round's gate report and disposition
  every row (`residual_manifest.py --check` green), apply the
  `references/finishing-notes.md` checks, and proceed to
  `superpowers:finishing-a-development-branch`, carrying the runbook and
  manifest.
~~~

(21 words → 38; "the two checks" was already stale once the reference gained
its contract section.)

- [ ] **Step 4: Enforce the ultrapowers shrink budget**

Run: `wc -w skills/ultrapowers/SKILL.md`
Expected: 2789 — MUST be ≤ 2794. If over, trim the Step-2/Step-3 replacement
prose (never other sections) until ≤.

- [ ] **Step 5: Add the per-entry manifest to the ultradocket end gate**

In `skills/ultradocket/SKILL.md`, section "### The single end gate", replace
this sentence (quoted verbatim):

~~~markdown
Per entry: exam evidence (raw runner JSON), engine, cost,
disposition (`executed`/merged or `parked` + reason), branch, and the review
posture used (suite-gate authority, or the escalated tasks named); plus portfolio
totals and the could-have-parallelized projection.
~~~

with exactly:

~~~markdown
Per entry: exam evidence (raw runner JSON), engine, cost,
disposition (`executed`/merged or `parked` + reason), branch, the review
posture used (suite-gate authority, or the escalated tasks named), and the
entry's residual manifest (`<runDir>/residual-manifest.md`, derived per the
ultrapowers `references/finishing-notes.md` §Residual manifest; drain close
runs `residual_manifest.py --check` per entry — exit 2 surfaces its
undispositioned rows in this evidence block; an entry with no gate report
derives a zero-row manifest, which passes vacuously); plus portfolio
totals and the could-have-parallelized projection.
~~~

Then run: `wc -w skills/ultradocket/SKILL.md`
Expected: ≈ 1879 — MUST be ≤ 1892 (before + 45).

- [ ] **Step 6: Run the full suite**

Run: `python3 -m pytest`
Expected: green (951 with the script task merged; 942 if this task runs before
it lands — either way zero failures: no test pins the replaced prose, and
`tests/test_report_runbook.py`'s ultrapowers-SKILL assertions — "engine skew",
"round-trip" — are untouched).

- [ ] **Step 7: Commit**

```bash
git add skills/ultrapowers/SKILL.md skills/ultradocket/SKILL.md
git commit -m "docs(skills): wire residual manifest into run close, resume gates, and drain end gate (#149)"
```
