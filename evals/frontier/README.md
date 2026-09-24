# evals/frontier/

`evals/frontier/corpus/` and `evals/frontier/results/` are **untracked on purpose** (#544
§Roadmap step 4, operator decision 2026-09-08): the frozen replay corpus and the eval
readings live on the operator's laptop, and `git log -- evals/frontier` still reads their
history. The nine scripts that built and replayed the corpus left the tree on 2026-09-24
with the kernel legs they exercised (the weave shadow, the auto-union, the commit-input path).
