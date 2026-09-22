# The git block skips heredoc bodies and quoted strings, and still denies a real git segment

**Grammar:** claims-v1

**Claim:** `findGit` does not read inside a heredoc body (`<<WORD` … `WORD`) or inside a single- or double-quoted string; `git` as the first word of a real segment is still denied. (quoted from #1230)
**Summary:** The guard that stops a worker running git today also denies commands that merely write the word into a file, three times on run-215. This plan teaches it to skip text inside heredocs and quotes while still denying a real git command. Workers lose fewer turns to false denials and the record of denials becomes a true reading.

**Goal:** #1230: `findGit` in `factory/gitblock.mjs` reads a Bash line's heredoc bodies and its single- and double-quoted strings as data, not as segments, so a `cat > f <<'EOF'` body that mentions git is not a git command; a real `git` command word on the same line is still answered. The exam is three legs added to the existing sim, one per behaviour.
**Closes:** #1230

**Tech Stack:** Node 24 ESM, no new npm dependency.
**Exam command:** node {paths}
**Spec:** none on disk — issue #1230 is the brief (map #1131; the git block of #1156), and everything a worker needs is in the Context. The sandbox holds no spec.

## Global Constraints

- Check: git diff --quiet $ULTRA_BASE -- factory/roles factory/union.mjs factory/worker.mjs factory/reverify.mjs factory/judge.mjs factory/questions.json factory/boot.sh fleet/fleet-bootstrap.sh skills/ultrapowers/kernel
- `factory/gitblock.mjs` still imports nothing: no filesystem, no process, no network.
- The reader errs toward denying: a change that lets a real git command word through, on any shape the sim at BASE already pins, is a defect whatever it fixes.

### Task 1: The git block reads heredoc bodies and quoted strings as data

**Type:** implementation
**Review:** peer

**Files:**
- Modify: `factory/gitblock.mjs`
- Test: `fleet/tests/test_factory_worker_gitblock.mjs`

**Claim:** A worker's Bash line that writes the word git into a file through a heredoc, or carries it inside a quoted string, is not denied; a line that also runs git after the heredoc is still denied. (derived)
Machine: M1. `findGit` of the run-215 line `cat > /tmp/test_pattern.txt <<'EOF'\nfunction git (cwd, args) {\n  return 1\n}\ngit(root, ['init'])\nEOF\necho done` (the `\n` a real newline) answers exactly `null`.
M2. `findGit` of that same line with `; git status` appended after `echo done` answers a string, and the sim's five legs from #1156 — a bare `git status`, the `&&` chain and `sh -c 'git reset --hard'` each a string; `grep -rn git factory/ | head -5` and `cat .gitignore` each `null` — still pass unedited.
M3. `findGit` of `echo "note; git status"` — a delimiter and a git word inside one double-quoted string — answers exactly `null`; a single-quoted string is read by the same rule.

**Authorized-by:** #1230 (map #1131; the git block of #1156); `factory/gitblock.mjs`'s own header rule that a miss is worse than a false deny.

**Interfaces:**
- Consumes: none
- Produces: `findGit(command: string) -> string | null`

**Context:** You see this task body and nothing else. **The defect, at BASE.** `factory/gitblock.mjs` (140 lines) splits the whole line before it reads any word: line 18 defines the segment delimiters — `&&`, `||`, `;`, `|`, `&`, a newline, `$(`, a backtick, `(` and `{` — and line 98, `const segments = line.split(SEGMENT_DELIM)`, cuts on every one of them wherever it stands, inside a quote or a heredoc body included. `tokenize` (line 43) holds a single- or double-quoted run together as one word, but only inside a segment already cut, so a quote that spans a delimiter is cut in two. Measured at BASE: `findGit` of the run-215 line in M1 answers the string `git` — the body line `git(root, ['init'])` becomes the segment `git` between the newline before it and the `(` after it; `findGit('echo "note; git status"')` answers the string `git status"`; and `findGit('echo "git status"')` already answers `null`, because no delimiter stands inside those quotes — which is why leg (c) puts a `;` inside the string. **The record.** Run-215 (2026-09-22) wrote three `worker:denied` rows with `why: git` for lines that ran no git, at 18:53:47Z, 18:54:03Z and 18:54:16Z (n=3 of the 16 `worker:denied` rows on the run's evidence tag, 2026-09-22). The 18:54:16Z row's `command` is, verbatim, the M1 line: a scratch file written through `cat > /tmp/test_pattern.txt <<'EOF'`, whose body defines `function git (cwd, args)` and calls `git(root, ['init'])`, then `echo done`. **The rule to implement.** A heredoc opens at `<<`, optionally `<<-`, followed by WORD — bare, or wrapped in single or double quotes; its body starts after the next newline and ends at the first line that is exactly WORD (with `<<-`, leading tabs stripped before the comparison); `<<<` is a here-string, not a heredoc. Nothing in a body is a segment or a word. A single-quoted string runs to the next `'`; a double-quoted string to the next unescaped `"`; nothing inside either is a delimiter. A heredoc or quote left open at the end of the line runs to the end and is skipped — bash never executes that text as a command either, so skipping it is not a miss. The rest of the line is read exactly as today: every delimiter at line 18 still cuts, and `commandWordIndex`, the wrappers and `isGitWord` are unchanged. **Two traps.** First, `sh -c`, `bash -c`, `zsh -c` and `eval` (lines 116–137) read their quoted argument one level deeper through `findGit(stripQuotes(...))` — the sim's leg (b) pins `sh -c 'git reset --hard'` as a string, so a quoted string is still handed down when it is the `-c` argument or `eval`'s rest; what changes is only that its contents are never cut into segments at the outer level. Second, the header comment (lines 1–14) says the reader "cannot tell quoted data from code" — after this task it can, for these two shapes, so that sentence is rewritten; the rest of the header, "a miss is worse than a false deny", stands. **For the examiner.** The exam extends `fleet/tests/test_factory_worker_gitblock.mjs` (179 lines at BASE, five legs (a)–(e) under `// ── <letter>. [M<n>] …` comments, `console.log('ALL TESTS PASSED')` on line 179): add the three legs below under one comment naming this task (#1230), above that final line, and edit nothing above the comment. The file is guarded, so it is merged and from then on rides the repository's pytest bridge, which runs it as `node fleet/tests/test_factory_worker_gitblock.mjs` with no network and wants the last line `ALL TESTS PASSED` and exit 0. Keep it hermetic: `findGit` is already imported; no child process, no disk write, no network, no other `test_*.mjs` named. The M1 string is written in JavaScript with `\n` escapes, single quotes inside a double-quoted or template literal, and the M2 string is that same literal plus `; git status`.

**Proof:**
- Test: `fleet/tests/test_factory_worker_gitblock.mjs`
- Guard: `fleet/tests/test_factory_worker_gitblock.mjs`
- Legs: (a) [M1] `findGit` of the run-215 heredoc line — the M1 literal, newlines real — is strictly `null`; (b) [M2] `findGit` of that literal with `; git status` appended is of type `string`, and the file's five legs from #1156 stay above the new comment, unedited, so `git status`, the `&&` chain and `sh -c 'git reset --hard'` still answer strings and the grep-argument and `.gitignore` lines still answer `null`; (c) [M3] `findGit('echo "note; git status"')` is strictly `null`.

**Stale-if:**
- issue-closed: #1230
