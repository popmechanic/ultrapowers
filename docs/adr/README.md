# Architecture decision records

The code carries no comments (`lint/comments.py`, ratcheted by `tests/test_comment_ratchet.py`).
A non-obvious decision a reader needs and cannot recover from the code lives here instead, one
file per decision area, named by the files and symbols it governs, never by line number.

Each record has this shape:

```
# NNNN. <Subsystem>

Status: accepted (YYYY-MM-DD)
Governs: `<file>`, …

## <Decision area>

- **<symbol>** — context, decision and consequence in plain words, self-contained.
```

A decision that stops being true is struck through with the date and the superseding record,
not deleted. `/delete-comment` adds to these records; so can any hand change.

## Index

- [0001. The weave and the merge](0001-weave-and-merge.md) — 41 decisions
- [0002. Catching up and publishing a run](0002-catch-up-and-publish.md) — 19 decisions
- [0003. The Flock engine](0003-flock-engine.md) — 79 decisions, 6 struck
- [0004. The sandbox boot and its evidence](0004-boot-and-evidence.md) — 31 decisions, 1 struck
- [0005. The run record, status page and PR body](0005-run-record.md) — 13 decisions
- [0006. The TinyApp checker](0006-tinyapp-checker.md) — 31 decisions, superseded by 0018
- [0007. Talking to exe.dev](0007-exe-dev-lobby.md) — 20 decisions
- [0008. The Claude credential](0008-claude-token.md) — 22 decisions
- [0009. The fleet doctor](0009-doctor.md) — 23 decisions
- [0010. The janitor](0010-janitor.md) — 30 decisions
- [0011. Launching a run](0011-fleet-launch.md) — 86 decisions, 2 struck
- [0012. The plan grammar, parser and laptop check](0012-plan-grammar-and-check.md) — 32 decisions, 3 struck
- [0013. Authoring records, provenance and the census](0013-authoring-records.md) — 25 decisions
- [0014. The TinyApp template](0014-tinyapp-template.md) — 19 decisions, superseded by 0018
- [0015. Story planning for TinyApps](0015-story-planning.md) — 60 decisions, superseded by 0018
- [0016. The plugin hooks](0016-hooks.md) — 6 decisions, 8 struck
- [0017. The test suite and fleet sims](0017-test-rig.md) — 9 decisions
- [0018. The stories route is retired](0018-stories-route-retired.md) — 20 decisions
