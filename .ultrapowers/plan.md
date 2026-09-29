# The parser says what a task's files are

**Grammar:** claims-v1
**Claim:** The plan parser's own description says a task's file list carries the files it creates, modifies and deletes. (elicited)
**Summary:** This adds one sentence to the plan parser's description, saying that a task's file list now includes the files it deletes, as #1367 made true. It exists because the run that makes it is launched on the commit before #1367, so it can only reach main by catching up past that change: the first live use of the Flock's new catch-up. You get a correct description and, from the run's record, the catch-up's first real receipt.

**Goal:** Document the public `files` field in `plan_parse.py`'s module docstring; the run proves the catch-up live (an `experiment`, n=0 live catch-ups before it; rollback: revert the squash).
**Tech Stack:** Python 3
**Spec:** none — map #1292 ticket 5 (the first live catch-up)

## Global Constraints

- The edit is to the module docstring only; no code line of `plan_parse.py` changes.
- Check: python3 -m pytest -q tests/test_plan_parse.py tests/test_plan_check.py

### Task 1: The parser's docstring names what files carries

**Type:** implementation

**Files:**
- Modify: `skills/ultrapowers/scripts/plan_parse.py`

**Claim:** The plan parser's own description says a task's file list carries the files it creates, modifies and deletes. (derived)
Machine: M1. The module docstring of `skills/ultrapowers/scripts/plan_parse.py` carries the sentence `Each task's files is the sorted set of its Create, Modify and Delete paths.`

**Authorized-by:** #1367 (a task's public `files` carries its Delete: paths); map #1292 ticket 5

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** Put the sentence, byte for byte, as its own line in the module docstring at the top of the file, directly after the paragraph that begins `Prints exactly one JSON object on stdout` (it ends `whether or not a <stem>.gate-verdicts.json sits beside it.`), separated from it by one blank line. Change nothing else in the file: the file's code further down may differ from what this sentence describes at the run's base, and that is expected.

**Proof:**
- Run: python3 -c "import ast; d=ast.get_docstring(ast.parse(open('skills/ultrapowers/scripts/plan_parse.py').read())); assert 'Each task' + chr(39) + 's files is the sorted set of its Create, Modify and Delete paths.' in d, d" [M1]
- Legs: (a) the module docstring contains the sentence exactly [M1].

**Stale-if:**
- path-absent: `skills/ultrapowers/scripts/plan_parse.py`
