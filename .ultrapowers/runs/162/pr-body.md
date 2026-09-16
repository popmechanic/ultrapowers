Run-159's task 3 built the same two helpers its sibling task 2 was contracted to produce, and the folded engine would have been a syntax error; the reviewer caught it, but under the one-round policy a reviewer's block ends the task, so a correct patch died with no chance to rename three helpers. This puts that check where the driver's own evidence already goes: before review, the driver reads the exports the patch adds, and one that matches a symbol a sibling declares and this task does not is a red on the pre-review pass, which buys the same repair round a failing command buys. A worker learns of the collision from the driver instead of from a fatal review, the reviewer sees the record of it, and a plan whose tasks stay inside their contracts sees nothing new.

**Merge-ready**

> A worker that adds a public name a sibling task was contracted to provide is told so before any reviewer reads it, and gets its one repair round to rename or remove it.

| task | claim | exam | probes | mutant | suite |
|---|---|---|---|---|---|
| 1 | A worker that adds a public name a sibling task was contracted to provide is told so before any reviewer reads it, and gets its one repair round to rename or remove it. | red at BASE → green | — | — | — |

Residuals: 4 from review

Amendments: 1 from workers

- task 1 — clause: M1's declaration-keyword list: implemented the compiler's full `_DECL_KEYWORDS` set (class, def, async, function, const, let, var, interface, type, struct, enum, export, abstract, static) rather than only the eight M1 enumerates (class, def, function, const, let, var, async, export). — M1's governing sentence is `exactly as the compiler does` and the Context says M1 restates `_interface_token` `so the engine and the compiler agree on which entries name a symbol`. A differential run against skills/ultrapowers/scripts/compile_plan.py over 25 entries agrees on all 25 with the full set; with only M1's eight it disagreed on four (`interface Shape`, `type Row = {a: number}`, `abstract class Zed`, `static helper()` — each tokened to the keyword instead of the symbol), leaving the engine blind to a real collision against a contract the compiler did pair. The ten entries leg (a) pins are unaffected either way.

<details><summary>Record</summary>

## fleet run-162 — gate-green

| | |
|---|---|
| verdict | `PASS` |
| target | `popmechanic/ultrapowers` at `cf289581ebe2fa8dc23a8683c6d4e31c835d2ae2` |
| engine | `cf289581ebe2fa8dc23a8683c6d4e31c835d2ae2` |
| plan | `.ultrapowers/plan.md` at `f534ddc2874211ccc261315a0ac0d756965946d2` |
| branch | `ultra/integration-run-162` |
| vm | `fleet-r162-2609161723-f1c3` |

### Checks

```json
{"mode": "gate", "stamp": "run-162", "reportPath": "/home/exedev/target/.claude/ultrapowers/run-run-162/report.json", "branch": "ultra/integration-run-162", "gateCheck": {"verdict": "PASS", "checks": [{"name": "report-parse", "ok": true, "detail": ""}, {"name": "clean-tree", "ok": true, "detail": ""}, {"name": "wave-merges", "ok": true, "detail": ""}, {"name": "head-match", "ok": true, "detail": ""}, {"name": "git-verified", "ok": true, "detail": ""}, {"name": "ancestry", "ok": true, "detail": ""}, {"name": "deliverables", "ok": true, "detail": ""}], "notes": [], "repo": "/home/exedev/target"}, "gateCheckExit": 0, "suite": {"passed": true, "unattributed": [], "output": "============================= test session starts ==============================\nplatform linux -- Python 3.12.3, pytest-7.4.4, pluggy-1.4.0\nrootdir: /home/exedev/target/.claude/ultrapowers/run-run-162/clones/integration\nconfigfile: pytest.ini\ntestpaths: tests\nplugins: xdist-3.4.0\ncreated: 3/3 workers\n3 workers [282 items]\n\n........................................................................ [ 25%]\n........................................................................ [ 51%]\n........................................................................ [ 76%]\n..................................................................       [100%]\n======================== 282 passed in 76.98s (0:01:16) ========================\n"}, "verdict": "PASS"}

```

### Evidence

https://github.com/popmechanic/ultrapowers/tree/ultra/evidence/run-162/.ultrapowers/runs/162/

- approve-receipt.json
- claude-version.txt
- engine.log
- events.jsonl
- gate-receipt.json
- kata.jsonl
- pr-body.md
- publish-fold
- receipt.json
- report.json
- residuals.jsonl
- status.json
- transcripts

### Plan

https://github.com/popmechanic/ultrapowers/blob/ultra/plan/run-162/.ultrapowers/plan.md

### Residuals

- [ ] task 1 reviewer — `addedExportsOf` de-duplicates rows by `(path, name)` (`const key = current + ' ' + m[1]
- [ ] task 1 reviewer — if (seen.has(key)) continue`, fleet/run-engine.mjs, patch lines 100–102), while M2 spells the contract as "one [row] per ADDED line ... that declares a top-level export". The de-duplication M3 requires is per distinct `(name, path)` pair at the pass, so folding it into the reader is observably equivalent through M3/M4 (and leg (b)'s fixture has no duplicate name, so the exam cannot tell the two readings apart) — but a patch that adds two `export const X` lines in one file yields one row where M2's letter says two. Either move the `seen` set up into `exportCollisions()` (where M3 actually asks for it) and let `addedExportsOf` emit one row per added line, or treat this as a deliberate reading of M2 and say so in an AMENDMENTS entry the way the `_DECL_KEYWORDS` divergence was declared. No behaviour this task's exam or its Proof `Run:` commands observe changes either way, which is why this is advisory.
- [ ] task 1 reviewer — M1's own enumeration and its governing sentence disagree, and the diff cannot satisfy both. M1 says `producedSymbolOf` reduces "exactly as the compiler does", then spells the cut as "the characters up to the first `(`, `->`, `=`, whitespace or closing backtick" — but the compiler's `_interface_token` cuts on `re.split(r"[(\s:]", ...)` (skills/ultrapowers/scripts/compile_plan.py:1667): it cuts on `:`, which M1 omits, and does NOT cut on `->` or `=`, which M1 adds. The implementation takes the union (`split(/\(|->|=|\s|:/)`, fleet/run-engine.mjs, patch line 60), which is the most defensive reading and matches M1's letter, but it still disagrees with the compiler on an entry whose backtick span carries `=` or `->` with no preceding whitespace — `` `MAX_ROUNDS=3` `` tokens to `MAX_ROUNDS` in the engine and `MAX_ROUNDS=3` in the compiler — which is the one class of disagreement this helper exists to prevent. The fix is to M1's text (drop `->` and `=` from the enumeration, add `:`), not to a line inside this task's FILES, so the actor is the plan
- [ ] task 1 reviewer — every entry leg (a) pins and every entry the launch plan itself carries is cut at `(` or whitespace first, so nothing in this run is affected.

</details>

