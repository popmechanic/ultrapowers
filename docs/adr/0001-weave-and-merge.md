# 0001. The weave and the merge

Status: accepted (2026-11-21)  
Governs: `evals/readings/weave_census.py`, `factory/flock/edit_spans.mjs`, `factory/flock/weave.py`, `factory/flock/weave_store.py`, `tests/test_vendor_pin.py`, `tests/test_weave_store.py`

Recovered from the code comments removed by `/delete-comment` on 2026-11-21: each entry is a
decision the code cannot show on its own. Symbols are named; line numbers are not.

## What the weave is for

- **Throughput, not coherence** — The weave exists so that builders on independent, checkable work need not wait on each other: tasks that share a file run at once, a merge never refuses, a main that moves mid-run is folded in, and every line keeps its author. It shares text, not understanding, and nothing in it makes a design coherent. The Potluck comparison of 2026-11-24 (n=1 run per arm, popmechanic-potluck-3) was the first run built to use same-file concurrent writing on purpose: one builder owned the page, two helpers worked in the same four files, all were asked to publish as they went. On run-2, 2 of 7 publishes were mid-task (the rules at 32 s, the page outline at 100 s), 8 conflicts opened (7 closed by the host, 1 by a builder), 10 peer:rewrite rows were recorded, and the page's owner called done at 134 s on its one green probe; the operator judged the one-author app of run-1 entirely superior in a blind smoke test. Across potluck-2 runs 1–2 and ultrapowers runs 304–308, 26 of 27 publishes came at done and one edit was truly concurrent (run 305, resolved in 26 s). So a plan splits only where the pieces are independently checkable, and a design that must read as one thing is one task (#1607). Manyana stays: its measured value is on the large-codebase runs.

## Weave store

- **factory/flock/weave_store.py** — factory/flock/weave_store.py keeps main's memory: at most one stored weave per tree of the target's default branch, each an entry commit on `refs/ultrapowers/weave/v1` with subject `weave <tree sha>`, holding meta.json and per-path `.weave-state`, `.weave-auth`, `.weave-dels`. Non-UTF-8 or non-regular paths are listed in `unwoven` and never woven again. Because two weaves of one text built by different routes merged back to that text 0 times in 25 (probe, n=25 files, 917 commits, 2026-11-12), a tree's weave is built once and shared: a commit without an entry is replayed deterministically from the nearest stored first-parent ancestor, so sandboxes write byte-identical entries; every load checks visible text against git and raises Drift on mismatch. The `open`, `push`, `join` and `settle` verbs print one JSON line each with the documented fields.
- **factory/flock/weave_store.py entries** — The weave ref is an append-only log whose order means nothing; lookup is by subject. When two entries name the same tree, the one nearer the root is authoritative (factory/flock/weave_store.py `entries`), so the first stored weave of a tree is never displaced.
- **factory/flock/weave_store.py verify** — When factory/flock/weave_store.py `verify` checks a stored weave against git, a path absent at that tree must have no visible lines (every line deleted); otherwise it is drift.
- **factory/flock/weave_store.py replay** — factory/flock/weave_store.py `replay` is the only way a tree without an entry gets one: each changed text file goes through the keeper's `rewrite`, authored `@c:<commit sha12>`. Being a pure function of the ancestor entry and the commits, replaying A->B->C equals replaying B->C from a stored B.
- **factory/flock/weave_store.py write_entry** — factory/flock/weave_store.py `write_entry` never overwrites: if an entry already exists for the tree it is returned and nothing is written, so the first stored weave of a tree is the only one.
- **factory/flock/weave_store.py join** — The catch-up merge (factory/flock/weave_store.py `join`) joins the run's stored entry with the moved main's entry. Both weaves descend from the entry the run started on, so it runs one Manyana `merge_states` per differing path and keeps every line's identity; no text is diffed. It returns joined/conflicts/files/paths or a reason it could not join.
- **factory/flock/weave_store.py join** — factory/flock/weave_store.py `join` skips a path that is not text on main; the catch-up's own byte rule in factory/flock/catchup.mjs decides it instead.
- **factory/flock/weave_store.py sync** — factory/flock/weave_store.py `sync` takes in the remote's weave entries: local entries for trees the remote lacks are re-parented onto the remote tip; one whose tree the remote holds is dropped and named in `forks` if it differs. A local genesis is dropped once the remote has any entry, because a store has exactly one beginning.
- **factory/flock/weave_store.py push** — When factory/flock/weave_store.py `push` finds a fork (this clone built a tree's weave that the remote holds differently), it keeps the remote's and pushes nothing, because anything woven on top of the local version is not main's memory.
- **factory/flock/weave_store.py push** — factory/flock/weave_store.py `push` pushes the weave ref with `--force-with-lease` set to the remote tip this clone last fetched (empty when none, meaning the ref must not yet exist), so a push lands only on the entries it was built on; a refusal syncs and retries.
- **factory/flock/weave_store.py open_store** — factory/flock/weave_store.py `open_store` begins a store at the commit when none exists anywhere, and with a remote pushes that beginning before using it, so two sandboxes beginning at once end on one genesis. It returns None when the commit is older than the store.
- **factory/flock/weave_store.py** — In factory/flock/weave_store.py a line present at the store's genesis carries no author label and reads as base; replayed commits author their lines '@c:<sha12>'.
- **factory/flock/weave_store.py** — When a Flock run starts from main's stored weave (factory/flock/weave_store.py), lines written by earlier runs read as base inside the new run; only the current run's own lines carry a peer's name, while the stored entry keeps every run's '@r<N>:<task>' labels.

## Weave main memory

- **factory/flock/weave.py Keeper.r_memory** — Keeper.r_memory in factory/flock/weave.py installs main's stored weave only for paths the engine already handed to base. A stored path absent at the run's tree (deleted, or never woven by the engine) stays out of every copy, and the later store request reconciles it.
- **factory/flock/weave.py Keeper.r_main** — When main moves mid-run and a path the run weaves has become unwoven (no longer text) on main, Keeper.r_main in factory/flock/weave.py answers moved: false with reason no-longer-text. The run stops following main, and the publish's catch-up decides that path by its bytes instead of by weave merge.
- **factory/flock/weave.py Keeper.r_main** — When main moves mid-run, Keeper.r_main in factory/flock/weave.py takes into main's published sidecars only the authorship and deletion labels added since the Memory the run holds. Lines main had before stay authored base inside the run, so blame and peer notes never credit old work to main.
- **factory/flock/weave.py Keeper.r_store** — Keeper.r_store in factory/flock/weave.py writes the run's join into main's weave store with each builder label such as A.2 renamed @r<run>:2, since a builder letter is meaningless after the run. A label the store already gave (@..., a line main brought mid-run) is kept unchanged.
- **factory/flock/weave.py Keeper.r_store** — The weave store in factory/flock/weave.py holds entries only for paths some run changed; a path untouched by the run and never stored is skipped by r_store because its weave is just its text, rebuilt from the file at the next run.
- **factory/flock/weave.py Keeper.r_store** — When the weave store already holds a path that this run began anew (deleted and created again, so it was not installed from memory), Keeper.r_store in factory/flock/weave.py merges the run's weave into the stored one instead of overwriting it, so lines keep their identity on main.
- **factory/flock/weave.py Keeper.r_blame** — Keeper.r_blame in factory/flock/weave.py drops store labels (those starting @) before labelling lines, so a line main brought into the run mid-flight reads as base rather than as a builder's or main's work in this run.

## Weave line identity

- **factory/flock/weave.py apply_edit** — factory/flock/weave.py applies a builder's edit directly to the weave state (marking visible lines deleted and inserting new entries) using the same anchoring rule as Manyana's update_state, instead of diffing the finished file. This keeps line identity tied to the edit call while the sha-pinned kernel stays unpatched; apply_edit returns the new state and the raw lines it deleted.
- **factory/flock/weave.py line_keys** — Manyana treats two weave entries as one line when they hang off the same parent, on the same side, with the same text. factory/flock/weave.py makes that notion explicit as a short hash per entry (line_keys), computed from the state alone, so authorship, deletion and replacement sidecars can be keyed by it and gossiped beside the weave without changing the kernel.
- **factory/flock/weave.py line_keys** — line_keys in factory/flock/weave.py keys each weave entry as blake2b(parent key, side, text, rank among equal-text siblings on that side). The rank is the only positional component and exists to tell apart repeated identical lines under one parent (the XaXbX case); everything else follows Manyana's own notion of the same line.
- **factory/flock/weave.py line_keys, Keeper.r_edit** — Deleting a line in a Manyana weave only bumps its visibility counter, and line_keys in factory/flock/weave.py does not hash that counter, so a deleted line keeps the same key. That is what lets the deletion sidecar (kdel) record who deleted each entry by the same identity its author wrote it under.

## Weave kernel stack

- **factory/flock/weave.py STACK_BYTES, run_on_kernel_thread** — The vendored Manyana kernel's merge walk recurses about 2*lines+4 frames per weave state, and raising sys.setrecursionlimit alone crashes CPython with SIGSEGV when the C stack runs out. factory/flock/weave.py therefore runs the serve loop on a thread created with a 1 GiB stack (STACK_BYTES) and a recursion limit of 1,000,000, which is what lets large files weave without patching the sha-pinned kernel.
- **factory/flock/weave.py run_on_kernel_thread** — run_on_kernel_thread in factory/flock/weave.py marshals the result and every exception, SystemExit included, back to the caller so exit codes survive the thread hop. Because threading.stack_size and sys.setrecursionlimit are process-global, both are restored on every path; if the platform refuses the big stack or the thread, the work runs on the main thread with one stderr line, trading headroom for availability.
- **factory/flock/weave.py run_on_kernel_thread** — threading.stack_size raises ValueError before changing anything, so run_on_kernel_thread in factory/flock/weave.py falls back to a main-thread call on that error without restoring a prior stack size.

## Weave merge semantics

- **factory/flock/weave.py Keeper.state** — When a copy in factory/flock/weave.py has no weave for a path, Keeper.state installs an empty initial state, so independent creations of the same path by different agents merge against one shared empty ancestor rather than as unrelated histories.
- **factory/flock/weave.py Keeper.r_pull, Keeper.r_merged** — Every copy in factory/flock/weave.py starts from the base weave, so when a peer's published weave for a path still equals base, the puller (r_pull) and the join (r_merged) skip it: the receiver already holds it and no merge is needed.
- **factory/flock/weave.py Keeper.r_merged** — In r_merged of factory/flock/weave.py a published weave equal to the base (or to the join so far) is skipped, since every copy began from the base and the join already holds it.

## Weave same anchor

- **factory/flock/weave.py same_anchor** — Manyana orders concurrent inserts at one anchor by text and, for an adds-only union, hides the conflict; when both sides insert identical text at one anchor it merges them into one line and flags nothing about what follows. same_anchor in factory/flock/weave.py detects both shapes (siblings and unified) from line keys and authorship sidecars and reports [{kind, anchor, lines, authors}], so the engine can surface concurrent same-place inserts the kernel would silently interleave.
- **factory/flock/weave.py same_anchor** — same_anchor in factory/flock/weave.py reports a unified line only when the lines following it come from one side; when both sides added followers, the siblings shape already reports that region, so it is not reported twice.
- **factory/flock/weave.py both_created** — A path absent at the run's base that main and a builder each created independently merges, in Manyana, as two whole files one after the other, marked adds-only. both_created in factory/flock/weave.py flags only that main-versus-builder case (one side's lines carry a stored @ label); two builders of one run creating the same file are not flagged, because both tasks' probes run on the join while no probe of the run speaks for main's file.

## Weave authorship sidecars

- **factory/flock/weave.py _union_rep** — In factory/flock/weave.py the replaced-lines sidecar (krep) keeps, per line identity, each writing label's replaced lines, because identical text written at one spot by several labels collapses to one identity. The replaced-line tuples are immutable and shared between copies and publishes rather than deep-copied, which keeps gossip of the sidecar cheap.
- **factory/flock/weave.py Keeper.kauth** — Each copy in factory/flock/weave.py carries authorship keyed by line identity (kauth), published and pulled beside the weave. Pulling unions a peer's sidecar into one's own, so the result does not depend on the order in which peers are merged, matching the leaderless any-order merge of the weave itself.

## Weave protocol

- **factory/flock/weave.py Keeper request ops** — factory/flock/weave.py is a long-lived process driven over stdin/stdout with one JSON request per line, each answered {ok: true, ...} or {ok: false, error}. Its ops are base, edit, rewrite, view, publish, pull, merged, authors_keyed, memory, store, main and blame; line identity comes from edit calls, and rewrite (a Write or shell change) is the one fallback that diffs visible text and replays it as edits. Authorship rides in per-copy sidecars keyed by line identity with labels task_label(agent, task), and a line with no sidecar entry is authored base; lines main brought mid-run carry store labels (@r<run>:<task>, @c:<sha12>) and blame reads them as base.
- **factory/flock/weave.py Keeper.r_merged** — Keeper.r_merged in factory/flock/weave.py answers the files of the join and the lines lost in it (lines someone other than their author removed) from one and the same join, so a snapshot and its lost-lines report always describe identical state.

## Vendor kernel pin

- **tests/test_vendor_pin.py FROZEN_VENDOR_DIGEST** — tests/test_vendor_pin.py freezes the tracked file list and a digest over the bytes of skills/ultrapowers/kernel/vendor/, so any added, removed or changed vendor file fails the suite. vendor/manyana.py is never edited; re-vendoring updates FROZEN_VENDOR_DIGEST in the same commit, as vendor/PROVENANCE.md describes.

## Weave census

- **evals/readings/weave_census.py** — evals/readings/weave_census.py is a hand-run reading, not a test, that asks whether a Flock merge ever wrote a line no builder wrote. It reports per-run event counts, fused tokens (two earlier tokens run together, run-277's species) in landed squash commits, and line provenance against base plus every builder's recorded edit or rewrite. Provenance reads the landed commit's parent as base, which is later than the run's base after a catch-up, so a FOREIGN line there can be the run's own base line (run-264); a person reads each candidate.

## Weave edit replay

- **factory/flock/edit_spans.mjs editSpans** — The Flock replays a builder's Edit tool call into its weave replica as line spans computed by editSpans in factory/flock/edit_spans.mjs. Spans are returned last-first, in the visible line numbers of the text before the edit, so applying them in order to the weave's copy reproduces exactly what the Edit tool wrote. For a replace-all, matches whose lines touch form one group and become one span with every match in it replaced; one span per match would let an earlier span restore a later match's old text.

## Weave text fidelity

- **factory/flock/weave.py Keeper.r_base** — Keeper.r_base in factory/flock/weave.py reads base files with newline='' so a CRLF file's lines keep their trailing carriage return exactly as on disk and as the weave store weaves them. Python's universal newlines made every such line differ on its first sync.
