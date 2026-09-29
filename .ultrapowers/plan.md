# A run's record holds each fact once

**Grammar:** claims-v1
**Claim:** After a run, its record says each thing once: what changed at each tested step is a patch I can replay onto the base, and the files and rows nothing reads are gone. (elicited)
**Summary:** This trims a run's record so each fact is written once: the changes at each tested step become patches that replay onto the starting point, and the timing files and duplicate rows nothing reads are dropped. It exists because most of a run's record was full copies of file texts, capped and cut short on big runs, beside timings for a decision already made. You get a smaller record that never truncates and that shows exactly what each tested step changed.

**Goal:** The in-place half of #1395 (the record DRY), launchable before the record moves home: `snapshot-texts.json` gives way to per-snapshot patches in `snapshots.jsonl`, the digest's `base` row stops listing every path, `board-ops.json` and `summary.json`'s `board_*` stats go, and the `tool:post` rows go.
**Tech Stack:** Node (the Flock engine, ES modules), bash (the boot), git, Markdown
**Spec:** none — #1395 and the operator's picks of 2026-09-29 (three plans; this is the first)

## Global Constraints

- `board.json`, `red-checks.json`, `past.json`, `summary.json` (minus its `board_*` keys), `events.jsonl` (minus `tool:post`), `engine.log` and `status.json` stay as they are.
- Check: node fleet/tests/flock_delete_probe.mjs
- Check: python3 -m pytest -q tests/test_fleet_suite.py -k "boot or publish or flock"

### Task 1: A probe that reads a real run's record

**Type:** implementation

**Files:**
- Create: `fleet/tests/flock_record_probe.mjs`

**Claim:** One command runs a small real Flock run and reports what its record holds. (derived)
Machine: M1. `node fleet/tests/flock_record_probe.mjs` exits 0 and prints exactly one line, a JSON object whose keys are exactly `exit`, `files`, `summary_keys`, `digest_base_keys`, `snapshots` and `reproduces`, with `exit` equal to 0 and `snapshots` at least 1.

**Authorized-by:** #1395; operator picks 2026-09-29

**Interfaces:**
- Consumes: none
- Produces: `fleet/tests/flock_record_probe.mjs`

**Context:** Model it on `fleet/tests/flock_delete_probe.mjs`: build a throwaway target in a temp dir (base holds `a.txt`, `b.txt`), a two-task claims-v1 plan whose tasks touch different files (task 1 changes `a.txt` and creates `new.txt`; task 2 deletes `b.txt`), and run `factory/flock/engine.mjs` with `--builder scripted:<script.json>` (a path mapped to `null` deletes it) and `TYPESAFE_BASE_URL` empty. The engine writes its record into `--run-dir`. The printed object is the shared literal the sibling tasks read:
`exit` the engine's exit code; `files` the sorted names of the files directly in the run dir; `summary_keys` the sorted keys of `summary.json`; `digest_base_keys` the sorted keys of the `weave-ops.digest.jsonl` row whose `op` is `base`; `snapshots` the row count of `snapshots.jsonl`; `reproduces` — `null` when any `snapshots.jsonl` row lacks a `patch` string, otherwise `true` when applying every row's `patch` in row order with `git apply` onto a fresh checkout of base leaves a tree equal to the target's HEAD after the run (`git diff --quiet HEAD`), and `false` otherwise. The probe prints the object even when the engine exits non-zero, removes its temp dir, and exits 0 whenever it could print; it exits 1 only when it could not run.

**Proof:**
- Run: node fleet/tests/flock_record_probe.mjs | python3 -c "import json,sys; ls=sys.stdin.read().splitlines(); assert len(ls)==1, ls; f=json.loads(ls[0]); assert sorted(f)==['digest_base_keys','exit','files','reproduces','snapshots','summary_keys'], f; assert f['exit']==0 and f['snapshots']>=1, f" [M1]
- Legs: (a) the probe prints one JSON line with exactly the six keys, a zero engine exit and at least one snapshot [M1].

**Stale-if:**
- path-absent: `fleet/tests/flock_delete_probe.mjs`

### Task 2: Each tested snapshot is a patch that replays onto base

**Type:** implementation

**Files:**
- Create: `factory/flock/compact_record.mjs`
- Modify: `factory/flock/engine.mjs`
- Modify: `factory/boot.sh`
- Modify: `fleet/CONTRACT.md`

**Claim:** What changed at each tested step is a patch I can replay onto the base, and no file texts are copied into the record. (derived)
Machine: M1. After the probe's run, the run directory holds no `snapshot-texts.json`. M2. Every `snapshots.jsonl` row carries `from` (the previous row's `snap`, or `base` for the first row) and `patch`, a unified diff against `from`, and applying the rows' patches in order onto base reproduces the landed tree: the probe reports `reproduces` true. M3. The `weave-ops.digest.jsonl` row whose `op` is `base` carries `paths_count` and no `paths` array. M4. `factory/boot.sh` no longer names `snapshot-texts.json`.

**Authorized-by:** #1395 (tested snapshots as patches; the digest's path list is a copy of the git tree)

**Interfaces:**
- Consumes: `fleet/tests/flock_record_probe.mjs`
- Produces: `compactRecord(snapshots, baseFiles, weaveOpsLines)`

**Context:** Today `writeCompactRecord()` in `factory/flock/engine.mjs` (near line 1122) writes `snapshots.jsonl` (per snapshot: `snap`, `t`, `changed` [{path, sha1, bytes}], `deleted`), `snapshot-texts.json` (the changed texts keyed by sha1, capped at 524288 bytes, `truncated` when cut) and `weave-ops.digest.jsonl` (the raw weave ops with `content` replaced by `content_sha1`/`content_bytes`; its `base` row still carries a `paths` array of every text path in the repo). Move that logic into a pure module `factory/flock/compact_record.mjs` exporting `compactRecord(snapshots, baseFiles, weaveOpsLines)` that returns the two files' contents, and call it from the engine. Keep each row's `snap`, `t`, `changed` and `deleted`; add `from` and `patch`. A patch is a unified diff that `git apply` accepts, covering changed, created and deleted text files, against the previous tested snapshot (base for the first). Keep a total cap of 524288 bytes over all patches; a row whose patch did not fit carries `patch: null` and `truncated: true`. The digest's `base` row replaces `paths` with `paths_count`. Remove `snapshot-texts.json` from `ENGINE_EVIDENCE` in `factory/boot.sh` (line 158) and rewrite the two `fleet/CONTRACT.md` bullets for `snapshots.jsonl` and `snapshot-texts.json` (lines 74–77) as one bullet describing the patches. The probe that reads the result is `fleet/tests/flock_record_probe.mjs`; its printed object is `{exit, files, summary_keys, digest_base_keys, snapshots, reproduces}`.

**Proof:**
- Run: node fleet/tests/flock_record_probe.mjs | python3 -c "import json,sys; f=json.load(sys.stdin); assert 'snapshot-texts.json' not in f['files'], f" [M1]
- Run: node fleet/tests/flock_record_probe.mjs | python3 -c "import json,sys; f=json.load(sys.stdin); assert f['reproduces'] is True, f" [M2]
- Run: node fleet/tests/flock_record_probe.mjs | python3 -c "import json,sys; f=json.load(sys.stdin); k=f['digest_base_keys']; assert 'paths_count' in k and 'paths' not in k, f" [M3]
- Run: bash -c "! grep -q snapshot-texts factory/boot.sh" [M4]
- Legs: (a) the run dir lists no `snapshot-texts.json` [M1]; (b) replaying the rows' patches onto base yields the landed tree [M2]; (c) the digest's base row has `paths_count` and no `paths` [M3]; (d) the boot names no `snapshot-texts` [M4].

**Stale-if:**
- path-absent: `factory/flock/engine.mjs`

### Task 3: The board timings and the tool:post rows leave the record

**Type:** implementation

**Files:**
- Modify: `factory/flock/engine.mjs`
- Modify: `factory/boot.sh`
- Modify: `fleet/CONTRACT.md`

**Claim:** The timing files and duplicate rows nothing reads are gone from the record. (derived)
Machine: M1. After the probe's run, the run directory holds no `board-ops.json`, and no key of `summary.json` starts with `board`. M2. `factory/flock/engine.mjs` writes no `tool:post` event: the string `tool:post` appears nowhere in the file. M3. `factory/boot.sh` no longer names `board-ops.json`.

**Authorized-by:** #1395 (the board timings measured a settled decision; one tool row per call)

**Interfaces:**
- Consumes: `fleet/tests/flock_record_probe.mjs`
- Produces: none

**Context:** `summary.json`'s `board_ops`, `board_op_us_p50`, `board_op_us_p90`, `board`, `board_by_op`, `board_writes`, `board_writes_per_s` and `board_peak_writes_per_s` (engine.mjs lines 1097–1101), and the `board-ops.json` write (line 1110), recorded the in-process board's timings for the kata-versus-own-board decision, which is settled; nothing reads them. Remove them, and `byOp`/`peakPerSecond`/`READS` if nothing else uses them; the board keeps collecting whatever it needs to run. The `tool:post` row (PostToolUse hook, line 822) carries only `agent` and `tool` beside the PreToolUse `tool` row and nothing reads it; drop it and leave the `tool` row as the one row per call (no comment should name `tool:post` either). Remove `board-ops.json` from `ENGINE_EVIDENCE` in `factory/boot.sh` (line 158) and its bullet from `fleet/CONTRACT.md` (line 69). The probe that reads the result is `fleet/tests/flock_record_probe.mjs`; its printed object is `{exit, files, summary_keys, digest_base_keys, snapshots, reproduces}`.

**Proof:**
- Run: node fleet/tests/flock_record_probe.mjs | python3 -c "import json,sys; f=json.load(sys.stdin); assert 'board-ops.json' not in f['files'] and not [k for k in f['summary_keys'] if k.startswith('board')], f" [M1]
- Run: bash -c "! grep -q tool:post factory/flock/engine.mjs" [M2]
- Run: bash -c "! grep -q board-ops factory/boot.sh" [M3]
- Legs: (a) no `board-ops.json` and no `board*` summary key [M1]; (b) the engine source holds no `tool:post` [M2]; (c) the boot names no `board-ops` [M3].

**Stale-if:**
- path-absent: `factory/flock/engine.mjs`
