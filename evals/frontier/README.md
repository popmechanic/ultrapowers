# evals/frontier/

`evals/frontier/corpus/` and `evals/frontier/results/` are **untracked on purpose** (#544
§Roadmap step 4, operator decision 2026-09-08): 388 files of frozen replay evidence —
`corpus-index.json`, the per-run `wave-<n>` directories holding `conflicts.json`,
`fold_log.jsonl`, `fold_stats.json` and `task-*.patch`, and the eighty-one `results/`
readings written by `run_eval.py` and by hand. The durable copy is
the operator's laptop: copy both directories out of the working tree before pulling the
commit that removes them, then put them back, where the `.gitignore` rule now keeps them
out of the index. A fresh clone, a fleet sandbox and CI correctly find nothing here but
this file and the nine scripts, which stay tracked.

Regenerate: `python3 evals/frontier/corpus_extract.py --evidence <dir-of-tgz> --out
evals/frontier/corpus` rebuilds the corpus from run evidence, and `synth_corpus.py` the
`synth-<sha>` entries.

The tests never read this directory: `tests/conftest.py`'s `fixture_corpus` calls
`corpuslib.make_fixture_corpus` into a pytest tmp dir, once per session. The two readings
cited by path — `2026-08-20-phase2-migration.md` from `CLAUDE.md` and
`2026-08-19-t15-resolver-token-share.md` from
`skills/ultralearn/references/reading-lenses.md` — are on the laptop, and
`git log -- evals/frontier/corpus evals/frontier/results` still reads their history.
