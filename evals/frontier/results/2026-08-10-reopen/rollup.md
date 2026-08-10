# Frontier probe — roll-up

## Makespans (track a)

| fixture | waves | frontier | frontier w/o same-file edges | delta % |
| --- | --- | --- | --- | --- |
| wide | 457.7 | 457.7 | 457.7 | 0.0% |
| chained | 1325.5 | 1325.5 | 1325.5 | 0.0% |
| mixed | 1496.9 | 1496.9 | 1496.9 | 0.0% |
| flawed | 1496.9 | 1496.9 | 1496.9 | 0.0% |
| degrade | 478.8 | 478.8 | 478.8 | 0.0% |
| webapp | 1063.6 | 1011.2 | 1011.2 | 4.9% |
| contend | 687.3 | 687.3 | 405.3 | 0.0% |

Durations are modeled (seeded uniform(60, 600)), not measured.
Same-file edges dropped for the third column: 3.

## K-gate summary

- K1 (fold order-independence): PASS
- K2 (fold idempotence): PASS
- K3 (real-run fidelity): true
- K4 (no interleaving): PASS

## Track (b) narrations (S3 — operator grades these)

**adjacent-lines** — `adjacent.py` (lines), reported by task-b

```
line0
line1
line2
line3
line4
<<<<<<< begin added frontier
line5 edited by task-a
======= begin deleted frontier
line5
======= begin added task-b
line6 edited by task-b
======= begin deleted task-b
line6
>>>>>>> end conflict
line7
line8
line9
line10
line11
```

**delete-vs-modify** — `showcase.py` (lines), reported by task-mod

```
<<<<<<< begin deleted frontier
def showcase(x):
    a = x * 2
======= begin added task-mod
    log(a)
======= begin deleted frontier
    b = a + 1
    return b

>>>>>>> end conflict
```

**delete-vs-modify** — `showcase.py` (delete/modify), reported by task-mod

```
path showcase.py deleted concurrently with text that survives the delete; the text wins the manifest
```

**add-add-divergent** — `fresh.py` (add/add), reported by task-b

```
<<<<<<< begin added frontier
FRESH = "a"
======= begin added task-b
FRESH = "b"
>>>>>>> end conflict
```

**four-way-fanin** — `fanin.py` (lines), reported by 2

```
# fanin.py shared base for frontier eval
BASE_0 = 0
BASE_1 = 1
BASE_2 = 2
BASE_3 = 3
BASE_4 = 4
BASE_5 = 5
BASE_6 = 6
BASE_7 = 7
# end of shared base
<<<<<<< begin added both

======= begin added frontier
def task_1_fanin():
    return "1"
======= begin added 2
def task_2_fanin():
    return "2"
>>>>>>> end conflict
```

**four-way-fanin** — `fanin.py` (lines), reported by 3

```
# fanin.py shared base for frontier eval
BASE_0 = 0
BASE_1 = 1
BASE_2 = 2
BASE_3 = 3
BASE_4 = 4
BASE_5 = 5
BASE_6 = 6
BASE_7 = 7
# end of shared base
<<<<<<< begin added both

======= begin added frontier
def task_1_fanin():
    return "1"
def task_2_fanin():
    return "2"
======= begin added 3
def task_3_fanin():
    return "3"
>>>>>>> end conflict
```

**four-way-fanin** — `fanin.py` (lines), reported by 4

```
# fanin.py shared base for frontier eval
BASE_0 = 0
BASE_1 = 1
BASE_2 = 2
BASE_3 = 3
BASE_4 = 4
BASE_5 = 5
BASE_6 = 6
BASE_7 = 7
# end of shared base
<<<<<<< begin added both

======= begin added frontier
def task_1_fanin():
    return "1"
def task_2_fanin():
    return "2"
def task_3_fanin():
    return "3"
======= begin added 4
def task_4_fanin():
    return "4"
>>>>>>> end conflict
```

## Track (c) recovered runs

Recovered 16 run(s); K3 needs at least 3.

Extraction is reconciliation-tolerant (#133): a reconciliation commit folds into its wave as a pseudo-task endpoint diff, is absorbed by a later wave's merge-base, or — after the last merge — cuts fidelity comparison at that merge (noted per run below). The fidelity bar is unchanged: every wave's fold must reproduce the tree at its last merge on all non-conflicted paths.

- `a5603190` — 4 wave(s), 5 task(s), 2 reconciliation pseudo-task(s), 16 clean path(s) checked, 0 silent divergence(s), 0 conflicted path(s)
  - comparison cut at last merge; trailing reconciliation commit(s): 4eb1d403
- `c9feb919` — 3 wave(s), 7 task(s), 0 reconciliation pseudo-task(s), 33 clean path(s) checked, 0 silent divergence(s), 0 conflicted path(s)
- `39a166c5` — 2 wave(s), 2 task(s), 1 reconciliation pseudo-task(s), 36 clean path(s) checked, 0 silent divergence(s), 0 conflicted path(s)
  - comparison cut at last merge; trailing reconciliation commit(s): e2793933
- `5a74648a` — 3 wave(s), 7 task(s), 3 reconciliation pseudo-task(s), 30 clean path(s) checked, 0 silent divergence(s), 0 conflicted path(s)
- `59a84df7` — 3 wave(s), 3 task(s), 2 reconciliation pseudo-task(s), 14 clean path(s) checked, 0 silent divergence(s), 0 conflicted path(s)
- `c64fbdac` — 3 wave(s), 5 task(s), 3 reconciliation pseudo-task(s), 31 clean path(s) checked, 0 silent divergence(s), 0 conflicted path(s)
- `c8a3a5ce` — 3 wave(s), 4 task(s), 1 reconciliation pseudo-task(s), 9 clean path(s) checked, 0 silent divergence(s), 0 conflicted path(s)
  - comparison cut at last merge; trailing reconciliation commit(s): 4ac330d9
- `d3576a91` — 1 wave(s), 1 task(s), 0 reconciliation pseudo-task(s), 2 clean path(s) checked, 0 silent divergence(s), 0 conflicted path(s)
  - comparison cut at last merge; trailing reconciliation commit(s): e478a1a7
- `8d0ee798` — 6 wave(s), 8 task(s), 4 reconciliation pseudo-task(s), 48 clean path(s) checked, 0 silent divergence(s), 0 conflicted path(s)
- `f2b96216` — 2 wave(s), 2 task(s), 1 reconciliation pseudo-task(s), 6 clean path(s) checked, 0 silent divergence(s), 0 conflicted path(s)
  - comparison cut at last merge; trailing reconciliation commit(s): 76fdebd8
- `b514f80f` — 3 wave(s), 8 task(s), 2 reconciliation pseudo-task(s), 26 clean path(s) checked, 0 silent divergence(s), 0 conflicted path(s)
- `b55a480a` — 2 wave(s), 5 task(s), 1 reconciliation pseudo-task(s), 14 clean path(s) checked, 0 silent divergence(s), 0 conflicted path(s)
- `d9369661` — 2 wave(s), 7 task(s), 2 reconciliation pseudo-task(s), 17 clean path(s) checked, 0 silent divergence(s), 0 conflicted path(s)
- `1a58ed29` — 2 wave(s), 8 task(s), 2 reconciliation pseudo-task(s), 19 clean path(s) checked, 0 silent divergence(s), 0 conflicted path(s)
- `31339f70` — 2 wave(s), 9 task(s), 2 reconciliation pseudo-task(s), 18 clean path(s) checked, 0 silent divergence(s), 0 conflicted path(s)
- `13e97401` — 5 wave(s), 11 task(s), 1 reconciliation pseudo-task(s), 27 clean path(s) checked, 0 silent divergence(s), 0 conflicted path(s)
  - comparison cut at last merge; trailing reconciliation commit(s): ccee2e36

Runs not recovered:

- `767fb9ca`: no per-task merges on integration chain (nothing to replay)
- `81759f58`: no per-task merges on integration chain (nothing to replay)
- `fdc1e7fb`: no per-task merges on integration chain (nothing to replay)
- `236fb0dd`: no per-task merges on integration chain (nothing to replay)
- `e1256d84`: no per-task merges on integration chain (nothing to replay)
- `07143202`: no per-task merges on integration chain (nothing to replay)
- `d576e451`: no per-task merges on integration chain (nothing to replay)
- `5b8abae1`: no per-task merges on integration chain (nothing to replay)
- `22343f7a`: no per-task merges on integration chain (nothing to replay)
- `ed898248`: no per-task merges on integration chain (nothing to replay)
- `66c0548a`: no per-task merges on integration chain (nothing to replay)
- `91edea6a`: no per-task merges on integration chain (nothing to replay)
- `d012eaaf`: no per-task merges on integration chain (nothing to replay)
- `40123f0f`: no per-task merges on integration chain (nothing to replay)
- `79d2aab0`: no per-task merges on integration chain (nothing to replay)
- `1e29ebbe`: no per-task merges on integration chain (nothing to replay)
- `521d7707`: no per-task merges on integration chain (nothing to replay)
- `a989e50c`: no per-task merges on integration chain (nothing to replay)
- `a49e5435`: no per-task merges on integration chain (nothing to replay)
- `f9093684`: no per-task merges on integration chain (nothing to replay)

## Exclusions

- `c-767fb9ca`: no per-task merges on integration chain (nothing to replay)
- `c-81759f58`: no per-task merges on integration chain (nothing to replay)
- `c-fdc1e7fb`: no per-task merges on integration chain (nothing to replay)
- `c-236fb0dd`: no per-task merges on integration chain (nothing to replay)
- `c-e1256d84`: no per-task merges on integration chain (nothing to replay)
- `c-07143202`: no per-task merges on integration chain (nothing to replay)
- `c-d576e451`: no per-task merges on integration chain (nothing to replay)
- `c-5b8abae1`: no per-task merges on integration chain (nothing to replay)
- `c-22343f7a`: no per-task merges on integration chain (nothing to replay)
- `c-ed898248`: no per-task merges on integration chain (nothing to replay)
- `c-66c0548a`: no per-task merges on integration chain (nothing to replay)
- `c-91edea6a`: no per-task merges on integration chain (nothing to replay)
- `c-d012eaaf`: no per-task merges on integration chain (nothing to replay)
- `c-40123f0f`: no per-task merges on integration chain (nothing to replay)
- `c-79d2aab0`: no per-task merges on integration chain (nothing to replay)
- `c-1e29ebbe`: no per-task merges on integration chain (nothing to replay)
- `c-521d7707`: no per-task merges on integration chain (nothing to replay)
- `c-a989e50c`: no per-task merges on integration chain (nothing to replay)
- `c-a49e5435`: no per-task merges on integration chain (nothing to replay)
- `c-f9093684`: no per-task merges on integration chain (nothing to replay)
