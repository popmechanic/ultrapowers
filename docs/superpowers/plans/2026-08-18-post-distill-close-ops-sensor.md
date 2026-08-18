# Post-distill close/ops/sensor slate (#158, #159, #160) — Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Acceptance:** suite — the committed pytest suite is the verification; no harness JS is touched, so the `.mjs` sims are not in play; sealing not requested.

**Goal:** Ship the three orthogonal close/ops/sensor fixes filed from the 2026-08-18 distill — residual-manifest grammar (#158), Run-ID-at-launch prose (#159), harvester precision v4 (#160) — and release 0.2.14.

**Architecture:** Three independent surfaces: `residual_manifest.py` (one regex + text), `ultrapowers/SKILL.md` (three prose lines + a containment test), `harvest_runs.py` (a cache-path version source, a plural `transcriptDirs` bundle field + audit-note clause, a two-rule bound on the approved slice tail). Frozen periphery (`ultra_gate.py`, `gate_check.py`, `run_lock.sh`, sealing scripts) untouched; `waves.js` untouched.

**Tech Stack:** Python 3 stdlib, pytest.

**Spec:** `docs/superpowers/specs/2026-08-18-post-distill-close-ops-sensor.md`

## Global Constraints

- Frozen periphery untouched: `skills/ultrapowers/scripts/{ultra_gate.py,gate_check.py,collect_seal.py,seal_hash.py,run_acceptance.sh,run_lock.sh}` are read/imported only, never edited.
- `skills/ultrapowers/harnesses/waves.js` untouched (no sim-sentinel obligation).
- No direct Anthropic API calls, no `anthropic` SDK, no `ANTHROPIC_API_KEY` in repo code.
- Ledger contract stable across the coming rewrite: `engineVersion` stays `{epoch, asOf, basis}`; existing `basis` strings (`home-repo-date`, `foreign-date-upper-bound`, `unknown`) unchanged when the cache path is absent; home origin keeps `home-repo-date`; redirect-round vocabulary untouched.
- Derive-mode output of `residual_manifest.py` stays byte-identical (gate acks still emit bare `acked`).
- Release: bump **both** `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` to `0.2.14` (plain integers, never zero-padded); commit `chore(release): 0.2.14 — …`.

---

### Task 1: #158 — disposition grammar accepts `acked:<annotation>` and `filed:<ref> <note>`

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/scripts/residual_manifest.py`
- Modify: `skills/ultrapowers/references/finishing-notes.md`
- Test: `tests/test_residual_manifest.py`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `DISPOSITION` regex `^(?:fixed|acked(?::\S.*)?|filed:\S+(?:\s.*)?|waived:\S.*)$` (module constant; no signature change).

Touch points: docstring (:19–22), `DISPOSITION` (:47), `emit()` header comment (:150–153); finishing-notes.md disposition list (:89–100).

- [ ] **Step 1: Write the failing tests** — append to `tests/test_residual_manifest.py` (reuse its `write`, `report`, `run`, `manifest_rows` helpers exactly as `test_check_red_pins_malformed_disposition_values` does):

```python
def test_check_green_accepts_annotated_acked_and_filed_note(tmp_path):
    # #158: the natural spellings are valid — annotation on acked, note after filed:<ref>
    rp = write(tmp_path, "r.json", report())
    row = manifest_rows(run(rp).stdout)[0]
    for value in ("acked:operator accepted the sandbox gap",
                  "filed:#152 — tracked there",
                  "filed:#152 tracked there"):
        m = tmp_path / "residual-manifest.md"
        m.write_text(row + " " + value + "\n")
        r = run("--check", m)
        assert r.returncode == 0, (value, r.stdout, r.stderr)
        assert "CLEAN" in r.stdout


def test_check_red_pins_empty_annotation_forms(tmp_path):
    # #158: an annotation slot must be non-empty when opened; bare filed: stays red
    rp = write(tmp_path, "r.json", report())
    row = manifest_rows(run(rp).stdout)[0]
    for value in ("acked:", "acked: ", "filed:", "filed: #1"):
        m = tmp_path / "residual-manifest.md"
        m.write_text(row + " " + value + "\n")
        r = run("--check", m)
        assert r.returncode == 2, (value, r.stdout, r.stderr)
        assert row.split()[1] in r.stderr, value


def test_emitted_header_names_optional_annotation_forms(tmp_path):
    rp = write(tmp_path, "r.json", report())
    out = run(rp).stdout
    assert "acked[:<annotation>]" in out
    assert "filed:<ref>[ <note>]" in out
```

- [ ] **Step 2: Run to verify they fail**

Run: `python3 -m pytest tests/test_residual_manifest.py -k "annotated or empty_annotation or emitted_header" -v`
Expected: the green test FAILS (exit 2 for `acked:…`), the header test FAILS (`acked[:<annotation>]` absent); the red-pin test may already pass.

- [ ] **Step 3: Implement** — in `skills/ultrapowers/scripts/residual_manifest.py`:

Replace line 47:
```python
DISPOSITION = re.compile(
    r"^(?:fixed|acked(?::\S.*)?|filed:\S+(?:\s.*)?|waived:\S.*)$")
```

Docstring (the `<value> one of` sentence, ~:19–22) becomes:
```
duplicates within one report tiebreak -2, -3, ...) and <value> one of
fixed | acked[:<annotation>] | filed:<ref>[ <note>] | waived:<reason>
(an opened annotation slot must be non-empty; #158).
```

`emit()` header comment (~:152–153) becomes:
```python
             "<!-- disposition one of: fixed | acked[:<annotation>] | "
             "filed:<ref>[ <note>] | waived:<reason> -->", ""]
```

In `skills/ultrapowers/references/finishing-notes.md`, the four-item list (~:89–100) becomes:
```markdown
- `fixed` — verified closed (say how in the row text).
- `acked` or `acked:<annotation>` — operator acknowledged; the required
  action is named in the row text or the annotation. Anything beyond
  already-authorized tooling lands here — the manifest authorizes no new
  autonomous actions.
- `filed:<ref>` or `filed:<ref> <note>` — stays open under a tracking
  reference (a free-text note may follow the ref).
- `waived:<reason>` — stays open with the reason stated.
```

- [ ] **Step 4: Run the whole file**

Run: `python3 -m pytest tests/test_residual_manifest.py -v`
Expected: all PASS (including the pre-existing red set: `Fixed`, `acked because reasons`, bare `waived:`).

- [ ] **Step 5: Commit**

```bash
git add skills/ultrapowers/scripts/residual_manifest.py skills/ultrapowers/references/finishing-notes.md tests/test_residual_manifest.py
git commit -m "fix(residual-manifest): accept acked:<annotation> and filed:<ref> <note> (#158)"
```

---

### Task 2: #159 — SKILL.md records the printed Run ID after every launch

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultrapowers/SKILL.md`
- Create: `tests/test_skill_wf_run_record.py`

**Interfaces:**
- Consumes: the existing writer `skills/ultradocket/scripts/record_wf_run.py <stamp> <wf_runId>` (unchanged).
- Produces: nothing code-level.

Budget: SKILL.md grows by ≤ 8 lines net; no new concept beyond "record the ID when it is printed".

- [ ] **Step 1: Write the failing test** — `tests/test_skill_wf_run_record.py`:

```python
"""#159: the /ultrapowers launch and both relaunch lanes record the printed
Workflow Run ID into run-<stamp>/wf-runs.json at launch time (via the
existing ultradocket writer), so un-gated launches are in the approve sweep
set. Containment pin only — two splits, no SKILL.md parser."""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
SKILL = ROOT / "skills/ultrapowers/SKILL.md"
WRITER = "record_wf_run.py"


def _steps():
    text = SKILL.read_text()
    parts = text.split("\n## Step ")
    return {p.split(" ", 1)[0]: p for p in parts[1:]}   # "4" -> Step 4 text


def test_step4_launch_records_run_id():
    assert WRITER in _steps()["4"]


def test_step5_salvage_and_redirect_record_run_id():
    step5 = _steps()["5"]
    bullets = step5.split("\n- **")
    salvage = [b for b in bullets if b.startswith("Salvage**")]
    redirect = [b for b in bullets if b.startswith("Redirect")]
    assert salvage and WRITER in salvage[0]
    assert redirect and WRITER in redirect[0]


def test_writer_exists_and_is_named_by_plugin_root():
    assert (ROOT / "skills/ultradocket/scripts" / WRITER).is_file()
    assert "${CLAUDE_PLUGIN_ROOT}/skills/ultradocket/scripts/" + WRITER in SKILL.read_text()
```

- [ ] **Step 2: Run to verify it fails**

Run: `python3 -m pytest tests/test_skill_wf_run_record.py -v`
Expected: 3 FAIL (`record_wf_run.py` absent from SKILL.md).

- [ ] **Step 3: Edit SKILL.md** — three insertions + one wording change:

After line 172 (`Your \`tier\` fills ride inside …`), insert a new paragraph:
```markdown
**Record the Run ID first.** The Workflow tool's immediate result prints
`Run ID: <wf_runId>` (the run continues in the background). Before anything
else, record it — `python3 ${CLAUDE_PLUGIN_ROOT}/skills/ultradocket/scripts/record_wf_run.py <stamp> <wf_runId>`
— so approve/teardown sweep it even if this launch never reaches a gate. Exit 1
(an unreadable existing `wf-runs.json`) is surfaced, never skipped.
```

In the **Approve** bullet, change `sweeps **every wf run ID the gate recorded across launches**` to `sweeps **every wf run ID recorded for this stamp — at launch and by the gate —**`.

In the **Salvage** bullet, after `Return here.` at its end, change to: `Record the new launch's printed Run ID (\`record_wf_run.py <stamp> <wf_runId>\`, as in Step 4). Return here.`

In the **Redirect** bullet, after `route every post-gate edit through this lane.` change `Return here.` to: `Record the relaunch's printed Run ID (\`record_wf_run.py <stamp> <wf_runId>\`, as in Step 4). Return here.`

- [ ] **Step 4: Run the pin and the SKILL validator**

Run: `python3 -m pytest tests/test_skill_wf_run_record.py -v && python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers`
Expected: 3 PASS; validator exit 0.

- [ ] **Step 5: Run the SKILL-touching pins**

Run: `python3 -m pytest tests/test_recommendation_rubric.py tests/test_no_prompt_drift.py -q`
Expected: PASS (SKILL.md prose is not a baked prompt source; this is a sanity check).

- [ ] **Step 6: Commit**

```bash
git add skills/ultrapowers/SKILL.md tests/test_skill_wf_run_record.py
git commit -m "docs(skill): record the printed Workflow Run ID at every launch (#159)"
```

---

### Task 3: #160(i) — engineVersion from the plugin-cache path (foreign only)

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultralearn/scripts/harvest_runs.py`
- Test: `tests/test_harvest_runs.py`

**Interfaces:**
- Consumes: existing `_last_launch_tool_use_index(records, stamp)`, `session_registry(records)`, `_iter_blocks_indexed`, `_block_text`.
- Produces: `_plugin_cache_version(records, launch_index: int | None) -> str | None`; `_engine_epoch(records, origin, timeline=None, cache_version=None) -> dict` (new keyword, default `None` keeps every existing call unchanged).

- [ ] **Step 1: Write the failing tests** — append to `tests/test_harvest_runs.py` (uses its `_rec`, `_wf_launch`, `_ts`, `TIMELINE`, `REAL`, `_real_receipt`, `_merged_feature_repo` helpers):

```python
def _cache_turn(ver, mkt="ultrapowers"):
    return _rec("user", [{"type": "text", "text":
        f"Base directory for this skill: /Users/x/.claude/plugins/cache/{mkt}/ultrapowers/{ver}/skills/ultrapowers\n\n# Ultrapowers"}])


def test_plugin_cache_version_last_before_launch():
    recs = [_cache_turn("0.2.0"), _wf_launch("S1"), _cache_turn("0.2.1")]
    launch_idx = h._last_launch_tool_use_index(recs, "S1")
    assert h._plugin_cache_version(recs, launch_idx) == "0.2.0"
    # no launch anchor -> last anywhere
    assert h._plugin_cache_version(recs, None) == "0.2.1"
    assert h._plugin_cache_version([_rec("user", [{"type": "text", "text": "no path"}])], None) is None


def test_plugin_cache_version_matches_only_ultrapowers_cache_path():
    recs = [_rec("user", [{"type": "text", "text":
        "plugins/cache/superpowers-marketplace/superpowers/6.3.0/skills/x"}])]
    assert h._plugin_cache_version(recs, None) is None


def test_engine_epoch_prefers_cache_path_for_foreign_only():
    recs = [_ts("2026-06-20T10:00:00.000Z")]
    foreign = h._engine_epoch(recs, "foreign", TIMELINE, cache_version="0.0.9")
    assert foreign["epoch"] == "0.0.9" and foreign["basis"] == "plugin-cache-path"
    assert foreign["asOf"] == "2026-06-20T10:00:00.000Z"
    home = h._engine_epoch(recs, "home", TIMELINE, cache_version="0.0.9")
    assert home == h._engine_epoch(recs, "home", TIMELINE)          # home unchanged
    assert h._engine_epoch(recs, "foreign", TIMELINE, cache_version=None) == \
        h._engine_epoch(recs, "foreign", TIMELINE)                  # None -> unchanged


def test_build_bundle_stamps_cache_path_version_for_foreign(tmp_path):
    recs = [_cache_turn("0.2.0")] + REAL + [_wf_launch("S1")]
    session = tmp_path / "sess.jsonl"
    session.write_text("\n".join(json.dumps(r) for r in recs) + "\n")
    out = h.build_bundle(session, "-Users-x-proj", tmp_path / "cache",
                         "-Users-marcusestes-Websites-ultrapowers")
    bundle = json.loads((out / "bundle.json").read_text())
    assert bundle["engineVersion"]["epoch"] == "0.2.0"
    assert bundle["engineVersion"]["basis"] == "plugin-cache-path"
```

- [ ] **Step 2: Run to verify they fail**

Run: `python3 -m pytest tests/test_harvest_runs.py -k "plugin_cache_version or prefers_cache_path or stamps_cache_path" -v`
Expected: FAIL (`_plugin_cache_version` undefined; `_engine_epoch` rejects `cache_version`).

- [ ] **Step 3: Implement** — in `skills/ultralearn/scripts/harvest_runs.py`:

Add above `_engine_epoch`:
```python
_PLUGIN_CACHE_VER = re.compile(
    r"plugins/cache/[^/\s]+/ultrapowers/([0-9]+(?:\.[0-9]+)+)/")


def _plugin_cache_version(records, launch_index):
    """#160(i): the exact installed ultrapowers version, read from the
    plugin-cache path the transcript names verbatim (skill-load "Base
    directory for this skill:" turns and tool output carry
    `plugins/cache/<marketplace>/ultrapowers/<ver>/`). Scans `_block_text`
    only — text and tool_result blocks; tool_use inputs are not read (Bash
    commands mostly carry the literal `${CLAUDE_PLUGIN_ROOT}`). Returns the
    last match at-or-before `launch_index` (the last registered launch's
    tool_use record), else the last match anywhere (launch-less sessions:
    poisonable by pasted fixtures, accepted — no launch means no run to
    mis-attribute), else None."""
    before, anywhere = None, None
    for idx, _r, b in _iter_blocks_indexed(records):
        txt = _block_text(b)
        if not txt or "plugins/cache/" not in txt:
            continue
        found = _PLUGIN_CACHE_VER.findall(txt)
        if not found:
            continue
        anywhere = found[-1]
        if launch_index is not None and idx <= launch_index:
            before = found[-1]
    return before if before is not None else anywhere
```

Change `_engine_epoch`'s signature and add the early return (docstring gains the sentence in the comment):
```python
def _engine_epoch(records, origin, timeline=None, cache_version=None):
    """Resolve which ultrapowers version was current when the run launched.

    home   → the repo epoch at that date (a self-dev run may be AT or slightly
             AHEAD of it, since dev runs often install the repo-HEAD engine).
    foreign→ an UPPER BOUND: the latest release by that date; the project's
             installed plugin cache may lag behind it ("installed plugin lags
             the repo") — unless `cache_version` (#160(i), the exact version
             parsed from the transcript's plugin-cache path) is given, in
             which case foreign returns it with basis "plugin-cache-path".
             Home ignores `cache_version` so the home ledger baseline keeps
             its date semantics. Returns {epoch, asOf, basis}; epoch None if
             unknown."""
    if timeline is None:
        timeline = _release_timeline()
    ts = _run_timestamp(records)
    if cache_version and origin != "home":
        return {"epoch": cache_version, "asOf": ts, "basis": "plugin-cache-path"}
    ...  # rest unchanged
```

In `build_bundle`, after `registry = session_registry(records)` and before the bundle dict, add:
```python
    last_stamp_for_anchor = registry["stamps"][-1] if registry["stamps"] else None
    launch_idx = (_last_launch_tool_use_index(records, last_stamp_for_anchor)
                  if last_stamp_for_anchor else None)
    cache_version = _plugin_cache_version(records, launch_idx)
```
and change the bundle line to `"engineVersion": _engine_epoch(records, origin, cache_version=cache_version),`.

- [ ] **Step 4: Run the file**

Run: `python3 -m pytest tests/test_harvest_runs.py -q`
Expected: all PASS (existing engine-epoch tests unchanged; positional `timeline` still works).

- [ ] **Step 5: Commit**

```bash
git add skills/ultralearn/scripts/harvest_runs.py tests/test_harvest_runs.py
git commit -m "feat(ultralearn): exact foreign engineVersion from the plugin-cache path (#160 i)"
```

---

### Task 4: #160(ii) — bundle `transcriptDirs` + audit-note unit clause

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultralearn/scripts/harvest_runs.py`
- Test: `tests/test_harvest_runs.py`

**Interfaces:**
- Consumes: existing `_transcript_dirs(records) -> list[str]`, `_merge_audits(audits) -> dict`.
- Produces: bundle key `transcriptDirs: list[str]` (the ordered union, same list `_transcript_dirs` returns); `_merge_audits` note clause `AUDIT_UNIT_NOTE` (module constant string).

- [ ] **Step 1: Write the failing tests** — append to `tests/test_harvest_runs.py`:

```python
def test_merge_audits_names_the_token_unit_once_when_totals_exist():
    merged = h._merge_audits([{"agents": [{"role": "impl:1", "model": "m", "turns": 2, "outputTokens": 10}],
                               "totals": {"turns": 2, "outputTokens": 10}}])
    assert merged["totals"] == {"turns": 2, "outputTokens": 10}
    assert h.AUDIT_UNIT_NOTE in merged["note"]
    assert merged["note"].count("output_tokens") == 1
    # empty shape untouched
    assert h._merge_audits([]) == {"agents": [], "note": "no transcript dir"}


def test_bundle_carries_plural_transcript_dirs(tmp_path):
    d1 = tmp_path / "wf_a"; d1.mkdir(); (d1 / "agent-1.jsonl").write_text("")
    d2 = tmp_path / "wf_b"; d2.mkdir(); (d2 / "agent-2.jsonl").write_text("")
    recs = (REAL[:1]
            + [_wf_launch("S1"),
               _rec("user", [{"type": "tool_result", "content": [{"type": "text",
                   "text": f"Transcript dir: {d1}\n{{\"integrationBranch\":\"ultra/x\"}}"}]}]),
               _rec("user", [{"type": "tool_result", "content": [{"type": "text",
                   "text": f"Transcript dir: {d2}\n{{\"integrationBranch\":\"ultra/x\"}}"}]})])
    session = tmp_path / "sess.jsonl"
    session.write_text("\n".join(json.dumps(r) for r in recs) + "\n")
    out = h.build_bundle(session, "-Users-x-proj", tmp_path / "cache",
                         "-Users-marcusestes-Websites-ultrapowers")
    bundle = json.loads((out / "bundle.json").read_text())
    assert bundle["transcriptDirs"] == [str(d1), str(d2)]
    assert bundle["transcriptDir"] == str(d2)          # singular keeps "last dir"
```

- [ ] **Step 2: Run to verify they fail**

Run: `python3 -m pytest tests/test_harvest_runs.py -k "token_unit or plural_transcript_dirs" -v`
Expected: FAIL (`AUDIT_UNIT_NOTE` undefined; `transcriptDirs` KeyError).

- [ ] **Step 3: Implement** — in `skills/ultralearn/scripts/harvest_runs.py`:

Add near the top constants:
```python
# #160(ii): the audit's token unit, named once so cost-lens readers stop
# comparing it to the Workflow tool's reported total.
AUDIT_UNIT_NOTE = ("outputTokens = assistant output_tokens summed over agent "
                   "transcripts (not the Workflow tool's reported total)")
```

In `_merge_audits`, replace the tail:
```python
    merged = {"agents": agents}
    if totals:
        merged["totals"] = totals
        notes.append(AUDIT_UNIT_NOTE)
    if notes:
        merged["note"] = "; ".join(notes)
    return merged
```

In `build_bundle`'s bundle dict, after `"transcriptDir": tdir,` add `"transcriptDirs": tdirs,`.

- [ ] **Step 4: Run the file**

Run: `python3 -m pytest tests/test_harvest_runs.py -q`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/ultralearn/scripts/harvest_runs.py tests/test_harvest_runs.py
git commit -m "feat(ultralearn): plural transcriptDirs on the bundle + audit token-unit note (#160 ii)"
```

---

### Task 5: #160(iii) — bound the approved-terminus slice tail

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `skills/ultralearn/scripts/harvest_runs.py`
- Test: `tests/test_harvest_runs.py`

**Interfaces:**
- Consumes: existing `_last_artifact_record_index`, `session_registry`, `_iter_blocks_indexed`, `_block_text`.
- Produces: `_is_operator_turn(record: dict, block: dict) -> bool`; `_approved_tail_cutoff(records, cut: int | None) -> int | None` (record index, or None for "no bound").

- [ ] **Step 1: Write the failing tests** — append to `tests/test_harvest_runs.py` (reuses `_approval_tail_recs`, `_wf_launch`, `_rec`):

```python
def _approve_ok():
    return _rec("user", [{"type": "tool_result", "content": [{"type": "text",
        "text": json.dumps({"mode": "approve", "lockReleased": True, "stamp": "S1"})}]}])


def test_approved_tail_stops_at_first_operator_turn_inclusive():
    recs = [_wf_launch("S1"), _approve_ok(),
            _rec("assistant", [{"type": "text", "text": "Merged; gate green, lock released."}]),
            _rec("user", [{"type": "text", "text": "what should we do next about the wave?"}]),
            _rec("assistant", [{"type": "text", "text": "Next wave: regenerate the gate brief."}]),
            _rec("user", [{"type": "text", "text": "begin the wave work now"}])]
    out = h.slice_transcript(recs, terminus="approved")
    assert "what should we do next" in out          # first operator turn kept
    assert "regenerate the gate brief" not in out    # everything after it dropped
    assert "begin the wave work" not in out


def test_approved_tail_ignores_meta_and_notification_user_records():
    recs = [_wf_launch("S1"), _approve_ok(),
            dict(_rec("user", [{"type": "text", "text": "Base directory for this skill: /x/gate"}]), isMeta=True),
            _rec("user", "<task-notification>agent finished the wave</task-notification>"),
            _rec("user", [{"type": "text", "text": "<local-command-stdout>gate</local-command-stdout>"}]),
            _rec("user", [{"type": "text", "text": "[Request interrupted by user] gate"}]),
            _rec("user", [{"type": "text", "text": "yes - approved, merge the wave"}]),
            _rec("user", [{"type": "text", "text": "now something unrelated about the gate"}])]
    out = h.slice_transcript(recs, terminus="approved")
    assert "yes - approved, merge the wave" in out
    assert "something unrelated" not in out
    assert "Base directory for this skill" not in out   # never a **user:** line


def test_approved_tail_stops_before_finishing_handoff():
    recs = [_wf_launch("S1"), _approve_ok(),
            _rec("assistant", [{"type": "tool_use", "name": "Skill",
                                "input": {"skill": "superpowers:finishing-a-development-branch"}}]),
            _rec("user", [{"type": "text", "text": "merge locally, the wave is done"}])]
    out = h.slice_transcript(recs, terminus="approved")
    assert "merge locally" not in out


def test_approved_tail_without_bound_runs_to_end():
    recs = [_wf_launch("S1"), _approve_ok(),
            _rec("assistant", [{"type": "text", "text": "gate summary line one"}]),
            _rec("assistant", [{"type": "text", "text": "gate summary line two"}])]
    out = h.slice_transcript(recs, terminus="approved")
    assert "line one" in out and "line two" in out


def test_non_approved_terminus_unaffected_by_tail_bound():
    recs = [_wf_launch("S1"), _approve_ok(),
            _rec("user", [{"type": "text", "text": "yes - approved, merge the wave"}])]
    assert "approved, merge" not in h.slice_transcript(recs, terminus="NEEDS_ACK")
```

- [ ] **Step 2: Run to verify they fail**

Run: `python3 -m pytest tests/test_harvest_runs.py -k "approved_tail or unaffected_by_tail" -v`
Expected: the first three FAIL (tail runs to end today); the last two PASS already.

- [ ] **Step 3: Implement** — in `skills/ultralearn/scripts/harvest_runs.py`, add above `slice_transcript`:

```python
_NON_OPERATOR_PREFIXES = ("<task-notification>", "<local-command-",
                          "<system-reminder>", "[Request interrupted")
FINISHING_HANDOFF_SKILL = "superpowers:finishing-a-development-branch"


def _is_operator_turn(record, block):
    """#160(iii): a `user`-type record that is actually the human — not a
    skill load (`isMeta`), a background/subagent completion, a local-command
    echo, or an interrupt marker, all of which ride `user` records."""
    if record.get("type") != "user" or record.get("isMeta"):
        return False
    if not (isinstance(block, dict) and block.get("type") == "text"):
        return False
    txt = (block.get("text") or "").lstrip()
    return bool(txt) and not txt.startswith(_NON_OPERATOR_PREFIXES)


def _approved_tail_cutoff(records, cut):
    """#160(iii): bound for the approved-terminus tail (#150 mode b). After
    the artifact cut, the earliest of: the first operator turn (INCLUSIVE —
    the approval reply is kept; what follows is the tangent) or the
    finishing handoff Skill call (exclusive). Returns the last record index
    to keep, or None when no bound is found (tail runs to transcript end,
    today's behavior)."""
    start = -1 if cut is None else cut
    for idx, r, b in _iter_blocks_indexed(records):
        if idx <= start:
            continue
        if _is_operator_turn(r, b):
            return idx
        if (isinstance(b, dict) and b.get("type") == "tool_use"
                and b.get("name") == "Skill"
                and (b.get("input") or {}).get("skill") == FINISHING_HANDOFF_SKILL):
            return idx - 1
    return None
```

In `slice_transcript`, replace
```python
    if terminus == "approved":
        cutoff = None
```
with
```python
    if terminus == "approved":
        # #150 mode (b) tail, bounded per #160(iii): through the approval
        # reply (first operator turn, inclusive) or up to the finishing
        # handoff; no bound found -> transcript end.
        cutoff = _approved_tail_cutoff(records, cutoff)
```
and update the mode-(b) comment block above it: replace "so the slice extends past the artifact cut to the transcript end … no cap, no sentinel." with "so the slice extends past the artifact cut to `_approved_tail_cutoff` — the first operator turn (inclusive) or the finishing handoff, else transcript end (#160(iii): an unbounded tail carried ~250 records of unrelated post-run work)."

Note `_iter_blocks_indexed` already turns string `content` into a `{"type": "text"}` block, so string-content operator acks (#137) are covered by `_is_operator_turn` unchanged.

- [ ] **Step 4: Run the file**

Run: `python3 -m pytest tests/test_harvest_runs.py -q`
Expected: all PASS — including the pre-existing `test_slice_approved_terminus_extends_past_artifact_cut` (its tail: assistant "Gate is green…", user "yes - approved, merge it" = first operator turn kept, then the lunch noise dropped either way) and `test_build_bundle_approved_slice_keeps_post_artifact_approval_exchange` ("ship it - thanks" is the first operator turn, kept).

- [ ] **Step 5: Commit**

```bash
git add skills/ultralearn/scripts/harvest_runs.py tests/test_harvest_runs.py
git commit -m "feat(ultralearn): bound the approved-terminus slice tail at the approval reply / finishing handoff (#160 iii)"
```

---

### Task 6: Full-suite verification

**Type:** gate
**Depends-on:** 1, 2, 3, 4, 5

- [ ] Run: `python3 -m pytest -q` — Expected: all green.
- [ ] Run: `python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrapowers && python3 skills/ultrapowers/scripts/validate_skill.py skills/ultraplan` — Expected: exit 0.
- [ ] Run: `git diff --stat main...HEAD -- skills/ultrapowers/harnesses/ skills/ultrapowers/scripts/ultra_gate.py skills/ultrapowers/scripts/gate_check.py` — Expected: empty (frozen periphery and waves.js untouched).

---

### Task 7: Release 0.2.14

**Type:** release
**Depends-on:** 6

- [ ] Open the PR from the feature branch (`gh pr create`), merge to `main`.
- [ ] On `main`: set `"version": "0.2.14"` in **both** `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`; commit `chore(release): 0.2.14 — residual-manifest grammar (#158), Run ID at launch (#159), harvester precision v4 (#160)`; push.
