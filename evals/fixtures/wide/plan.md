# Textkit Breadth Modules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan may also be executed by `/ultrapowers`.

**Acceptance:** sealed 68ac67fde6a4 (sha256:68ac67fde6a475ff2be3c5bf5d066089c9d6dc5049d24cc299bcdbbafc4406fd)

**Goal:** Extend the `textkit` package with six independent text-processing modules, each with its own test file. The modules share no files and have no dependencies on each other.

**Tech Stack:** Python 3.11 + pytest. Run the suite with `python3 -m pytest tests/ -q` from the repo root.

---

### Task 1: word_count module

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `textkit/word_count.py`
- Test: `tests/test_word_count.py`

- [ ] **Step 1: Write failing tests** for `word_count(text)`:
  - Returns a dict mapping each word to its count.
  - Words are maximal runs matching `[a-z0-9]+` after lowercasing the input (so `"Don't"` yields `don` and `t`).
  - Empty string or string with no word characters returns `{}`.
  - Example: `word_count("The cat and the hat")` → `{"the": 2, "cat": 1, "and": 1, "hat": 1}`.
- [ ] **Step 2: Implement** `word_count(text)` in `textkit/word_count.py` to make the tests pass.

### Task 2: truncate module

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `textkit/truncate.py`
- Test: `tests/test_truncate.py`

- [ ] **Step 1: Write failing tests** for `truncate(text, limit, ellipsis="...")`:
  - If `len(text) <= limit`, return `text` unchanged.
  - Otherwise return `text[: limit - len(ellipsis)].rstrip() + ellipsis`.
  - Raise `ValueError` if `limit < len(ellipsis)`.
  - Example: `truncate("hello brave world", 10)` → `"hello b..."`.
- [ ] **Step 2: Implement** `truncate` in `textkit/truncate.py` to make the tests pass.

### Task 3: titlecase module

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `textkit/titlecase.py`
- Test: `tests/test_titlecase.py`

- [ ] **Step 1: Write failing tests** for `titlecase(text)`:
  - Split on whitespace; rejoin with single spaces.
  - Each word is capitalized (first letter upper, rest lower), EXCEPT minor words, which become fully lowercase: `a an and as at but by for in of on or the to`.
  - The first and last words are always capitalized, even if minor.
  - Example: `titlecase("the lord of the rings")` → `"The Lord of the Rings"`.
  - Empty or whitespace-only input returns `""`.
- [ ] **Step 2: Implement** `titlecase` in `textkit/titlecase.py` to make the tests pass.

### Task 4: redact module

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `textkit/redact.py`
- Test: `tests/test_redact.py`

- [ ] **Step 1: Write failing tests** for `redact(text, words)`:
  - Replaces each whole-word, case-insensitive occurrence of any word in the iterable `words` with `"*"` repeated to the match's length.
  - Whole-word means regex word boundaries (`\b`): `redact("scandal!", ["scandal"])` → `"*******!"` but `redact("scandals", ["scandal"])` is unchanged.
  - Example: `redact("Tell Alice that ALICE called", ["alice"])` → `"Tell ***** that ***** called"`.
  - Empty `words` returns the text unchanged.
- [ ] **Step 2: Implement** `redact` in `textkit/redact.py` to make the tests pass.

### Task 5: ngrams module

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `textkit/ngrams.py`
- Test: `tests/test_ngrams.py`

- [ ] **Step 1: Write failing tests** for `ngrams(tokens, n)`:
  - `tokens` is a list; returns a list of tuples of `n` consecutive tokens.
  - Example: `ngrams(["a", "b", "c"], 2)` → `[("a", "b"), ("b", "c")]`.
  - Returns `[]` when `n > len(tokens)`.
  - Raises `ValueError` when `n < 1`.
- [ ] **Step 2: Implement** `ngrams` in `textkit/ngrams.py` to make the tests pass.

### Task 6: reverse_words module

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `textkit/reverse_words.py`
- Test: `tests/test_reverse_words.py`

- [ ] **Step 1: Write failing tests** for `reverse_words(text)`:
  - Splits on whitespace, reverses the word order, joins with single spaces.
  - Example: `reverse_words("one  two three")` → `"three two one"`.
  - Empty or whitespace-only input returns `""`.
- [ ] **Step 2: Implement** `reverse_words` in `textkit/reverse_words.py` to make the tests pass.

### Task 7: Full-suite verification

**Type:** gate

**Files:** none

- [ ] Run `python3 -m pytest tests/ -q` from the repo root and confirm every test passes, including the pre-existing slugify tests.
