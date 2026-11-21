---
name: delete-comment
description: Use when the operator runs "/delete-comment [path...]" or asks to sweep, triage or delete code comments. Categorises every comment (tautology, stale, excuse, decision), deletes them, files an issue per excuse, moves decisions into docs/adr/, and ratchets lint/comments-baseline.json down.
argument-hint: "[path...]"
allowed-tools: Read Grep Glob Bash Edit Write Agent AskUserQuestion
---

# /delete-comment

This repository keeps no comments. `lint/comments.py` counts comment lines per tracked source
file and `tests/test_comment_ratchet.py` holds every file at or below
`lint/comments-baseline.json`. This skill lowers that baseline: every comment it can judge
leaves, and what it knew goes somewhere better.

| Category | What it is | Action |
|---|---|---|
| `tautology` | repeats what the code says | delete |
| `stale` | describes code, behaviour or history that is no longer true, or history git holds | delete |
| `excuse` | licenses a hack: workaround, "for now", TODO, swallowed error, magic retry | delete, file one issue per hack |
| `decision` | an important, non-obvious decision the code cannot show | delete, record in an ADR |
| `keep` | load-bearing text, or undecided | leave; the ratchet holds it |

Pragmas (`#!`, `@ts-`, `eslint-`, `noqa`, `type: ignore`, inline `@type` casts) are not comments
to the lint and are never touched. Vendored code (`vendor/`, `pouf/`) and fixtures are out of
scope.

## Steps

1. **Branch.** From a clean `main`: `git switch -c chore/delete-comments-<YYYY-MM-DD>`.
2. **Inventory.** In the scratchpad, `python3 .claude/skills/delete-comment/scripts/inventory.py
   <work> <shards> [path...]`. One shard per ~170 blocks, at most 12. It writes `blocks.json`
   and `shards/shardNN.jsonl` (whole files per shard).
3. **Triage.** One `general-purpose` subagent per shard, all in one message, each told to read
   and follow `.claude/skills/delete-comment/references/triage-brief.md` for its shard and to
   write `<work>/out/shardNN.jsonl`. They never edit the repository. Check every id came back
   once before going on.
4. **Spot-check.** Read 20 random deletions and every `keep`; overturn a verdict by editing
   its line in `out/`.
5. **ADRs.** Group the `decision` verdicts by `adr_topic`, merging near-duplicate topics. Each
   topic becomes or extends one `docs/adr/NNNN-<topic>.md` in the shape of
   `docs/adr/README.md`; add it to the index there. Name symbols and files, never line numbers.
6. **Delete.** `python3 .claude/skills/delete-comment/scripts/apply.py <work>`. A `FAIL` line
   is a comment it could not place; fix it by hand or mark it `keep`. Re-parse what changed:
   `node --check` per `.mjs`/`.js`, `bun build --no-bundle` per `.ts`/`.tsx`.
7. **Issues.** Group the `excuse` verdicts by `issue_title`. Invoking this skill is the
   operator's ask to file them: one `gh issue create --label comment-excuse` per title,
   body = the drafted `issue_body` plus the file and symbol. Put the issue numbers in the PR.
8. **Ratchet.** `python3 lint/comments.py --update` (it refuses to raise a count), then the
   gate: `python3 -m pytest`. A test that read a deleted comment's text is a `keep`: restore
   that comment and re-run.
9. **PR.** One hand PR: categories with counts, ADRs added, issues filed, lines shed, and the
   baseline total before and after. `gh pr merge --auto --squash`.

## Estimating

`python3 lint/comments.py --json | python3 -c "import json,sys; print(sum(r['end']-r['start']+1
for r in map(json.loads, sys.stdin)))"` is the comment-line ceiling; trailing comments shed no
line, and each deleted block usually frees one blank line beside it.
