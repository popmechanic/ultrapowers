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

Durations are modeled (seeded uniform(60, 600)), not measured.
No fixture in this corpus carries a same-file dependency edge, so the third column necessarily equals the second — the same-file column is unexercised here, not measured as neutral.

## K-gate summary

- K1 (fold order-independence): PASS
- K2 (fold idempotence): PASS
- K3 (real-run fidelity): not evaluated (recovered-n=1 below floor 3)
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

Recovered 1 run(s); K3 needs at least 3.

- `c9feb919` — 3 wave(s), 7 task(s), 33 clean path(s) checked, 0 silent divergence(s), 0 conflicted path(s)

Runs not recovered:

- `a5603190`: reconciliation commit ff28dee8547766bdb93e16db95aca86cc89ec4f1 on integration chain
- `767fb9ca`: reconciliation commit 951452dc6e25857d30b04af84ce0697d61132565 on integration chain
- `81759f58`: reconciliation commit 6f762e8cff27db3d8a7623b14e072ad5d508d252 on integration chain
- `fdc1e7fb`: reconciliation commit 84fcf975da6dccfb2cfc3e13109c6a191ba47310 on integration chain
- `236fb0dd`: reconciliation commit 63a0771af7ffd9b96b21132d88e6727e8a5b7a3a on integration chain
- `e1256d84`: reconciliation commit 4d12c07f57aeff4fa48eb85445b0ac182a19c105 on integration chain
- `39a166c5`: reconciliation commit e549982f292bec7cc8605060e89ee0b8ef505ba1 on integration chain
- `5a74648a`: reconciliation commit fe4f7d3992659a6b505c0986845a094455eef6b0 on integration chain
- `59a84df7`: reconciliation commit e69a329b66582ae9f414c8face5d62a1d9bde47f on integration chain
- `07143202`: reconciliation commit a394b8d1f0bb8f52a9541bbd661ea717d871e560 on integration chain
- `d576e451`: reconciliation commit 0964b87e4c030e911bee5155785174b438684845 on integration chain
- `5b8abae1`: reconciliation commit 1759836ed8b1230614b7d531087de4424720dd1f on integration chain
- `22343f7a`: reconciliation commit 66f07f8ebf202c658dba081d5b29e54ca386e53c on integration chain
- `ed898248`: reconciliation commit e8f529985a861bfc8cb3497575be7fb28b4b83ca on integration chain
- `66c0548a`: reconciliation commit 8ae3520aa20eaf00aecbd70ddeb168209fa01c80 on integration chain
- `91edea6a`: reconciliation commit 9afa3a5580394cc24449702f24ef056d9a27d4d3 on integration chain
- `d012eaaf`: reconciliation commit e93ce042a5343238731a181ea1ed5f497e8ec19b on integration chain
- `40123f0f`: reconciliation commit 9b9f1919b5bf16295f4f28742296d04bd17cfa71 on integration chain
- `79d2aab0`: reconciliation commit cd739865de9402d700a2d1148cfd6dec22426a16 on integration chain
- `1e29ebbe`: reconciliation commit 05b9a2fe752e8aaa4ab3c8c8c598bee2aa684b26 on integration chain
- `521d7707`: reconciliation commit ed79cf7ea6eb30da113673b66f0eab556fc81ddb on integration chain
- `a989e50c`: reconciliation commit bce3d74ec61a0aac860ee48e5419004a45f4e39c on integration chain
- `a49e5435`: reconciliation commit c664c4341eb128643cba6c383076c237f3126b0d on integration chain
- `f9093684`: reconciliation commit 0b1f64204283ab441e6d5292261f66f2a5bb90ef on integration chain
- `c64fbdac`: reconciliation commit 7b441736511cadcdc1a11e531f962f5953ef646f on integration chain
- `c8a3a5ce`: reconciliation commit 490d8a159c2f04e6e651937bb044dce9756c4c19 on integration chain
- `d3576a91`: reconciliation commit 0e4295cd8c7bd0d13f371519150462374a7552d5 on integration chain
- `8d0ee798`: reconciliation commit 2e0b1e5009fce3a738bcad1db923a7e577d8e358 on integration chain
- `f2b96216`: reconciliation commit ab2286d0ebbba71cfac9ac887ee18772c5930821 on integration chain
- `b514f80f`: reconciliation commit 01f75ecb254ef66c2fd94d24f1953d96ad84a25c on integration chain
- `b55a480a`: reconciliation commit 05076f10f0b15cb4fabf05b45a5a124f0a6e2f90 on integration chain
- `d9369661`: reconciliation commit 36979e393f6e0060df07c26bbb47cff76f405e16 on integration chain
- `1a58ed29`: reconciliation commit ebc522a8403777aaf3280826916602155951ffc8 on integration chain
- `31339f70`: reconciliation commit 60b02846b1f6268c61a6716c30af074a05ccfbac on integration chain
- `13e97401`: reconciliation commit c92a3d03423e7e8b0e526d4e5cc30e00094380c7 on integration chain

## Exclusions

- `c-a5603190`: reconciliation commit ff28dee8547766bdb93e16db95aca86cc89ec4f1 on integration chain
- `c-767fb9ca`: reconciliation commit 951452dc6e25857d30b04af84ce0697d61132565 on integration chain
- `c-81759f58`: reconciliation commit 6f762e8cff27db3d8a7623b14e072ad5d508d252 on integration chain
- `c-fdc1e7fb`: reconciliation commit 84fcf975da6dccfb2cfc3e13109c6a191ba47310 on integration chain
- `c-236fb0dd`: reconciliation commit 63a0771af7ffd9b96b21132d88e6727e8a5b7a3a on integration chain
- `c-e1256d84`: reconciliation commit 4d12c07f57aeff4fa48eb85445b0ac182a19c105 on integration chain
- `c-39a166c5`: reconciliation commit e549982f292bec7cc8605060e89ee0b8ef505ba1 on integration chain
- `c-5a74648a`: reconciliation commit fe4f7d3992659a6b505c0986845a094455eef6b0 on integration chain
- `c-59a84df7`: reconciliation commit e69a329b66582ae9f414c8face5d62a1d9bde47f on integration chain
- `c-07143202`: reconciliation commit a394b8d1f0bb8f52a9541bbd661ea717d871e560 on integration chain
- `c-d576e451`: reconciliation commit 0964b87e4c030e911bee5155785174b438684845 on integration chain
- `c-5b8abae1`: reconciliation commit 1759836ed8b1230614b7d531087de4424720dd1f on integration chain
- `c-22343f7a`: reconciliation commit 66f07f8ebf202c658dba081d5b29e54ca386e53c on integration chain
- `c-ed898248`: reconciliation commit e8f529985a861bfc8cb3497575be7fb28b4b83ca on integration chain
- `c-66c0548a`: reconciliation commit 8ae3520aa20eaf00aecbd70ddeb168209fa01c80 on integration chain
- `c-91edea6a`: reconciliation commit 9afa3a5580394cc24449702f24ef056d9a27d4d3 on integration chain
- `c-d012eaaf`: reconciliation commit e93ce042a5343238731a181ea1ed5f497e8ec19b on integration chain
- `c-40123f0f`: reconciliation commit 9b9f1919b5bf16295f4f28742296d04bd17cfa71 on integration chain
- `c-79d2aab0`: reconciliation commit cd739865de9402d700a2d1148cfd6dec22426a16 on integration chain
- `c-1e29ebbe`: reconciliation commit 05b9a2fe752e8aaa4ab3c8c8c598bee2aa684b26 on integration chain
- `c-521d7707`: reconciliation commit ed79cf7ea6eb30da113673b66f0eab556fc81ddb on integration chain
- `c-a989e50c`: reconciliation commit bce3d74ec61a0aac860ee48e5419004a45f4e39c on integration chain
- `c-a49e5435`: reconciliation commit c664c4341eb128643cba6c383076c237f3126b0d on integration chain
- `c-f9093684`: reconciliation commit 0b1f64204283ab441e6d5292261f66f2a5bb90ef on integration chain
- `c-c64fbdac`: reconciliation commit 7b441736511cadcdc1a11e531f962f5953ef646f on integration chain
- `c-c8a3a5ce`: reconciliation commit 490d8a159c2f04e6e651937bb044dce9756c4c19 on integration chain
- `c-d3576a91`: reconciliation commit 0e4295cd8c7bd0d13f371519150462374a7552d5 on integration chain
- `c-8d0ee798`: reconciliation commit 2e0b1e5009fce3a738bcad1db923a7e577d8e358 on integration chain
- `c-f2b96216`: reconciliation commit ab2286d0ebbba71cfac9ac887ee18772c5930821 on integration chain
- `c-b514f80f`: reconciliation commit 01f75ecb254ef66c2fd94d24f1953d96ad84a25c on integration chain
- `c-b55a480a`: reconciliation commit 05076f10f0b15cb4fabf05b45a5a124f0a6e2f90 on integration chain
- `c-d9369661`: reconciliation commit 36979e393f6e0060df07c26bbb47cff76f405e16 on integration chain
- `c-1a58ed29`: reconciliation commit ebc522a8403777aaf3280826916602155951ffc8 on integration chain
- `c-31339f70`: reconciliation commit 60b02846b1f6268c61a6716c30af074a05ccfbac on integration chain
- `c-13e97401`: reconciliation commit c92a3d03423e7e8b0e526d4e5cc30e00094380c7 on integration chain
