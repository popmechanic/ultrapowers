# PROTOTYPE — coordination store schema & claims (#178) — THROWAWAY, wipe me

**This directory is a prototype on a throwaway branch. It never merges to main.**

## The question

Does this store schema + claims model hold up under the hard cases the Width
Program charter names? Specifically:

1. **Schema** — `runs`, `claims`, `budgets`, `spend`, `receipts` tables where
   receipts are *pointers into git, never content*.
2. **TTL-lease claims re-derived from the store + clock, never socket
   liveness** — a disconnected-but-unexpired holder still holds; an expired
   lease frees without any revocation write; a stale holder cannot renew.
3. **Eviction semantics** — `expired` and `revoked` are distinct states that
   must never be conflated (unavailable ≠ revoked).
4. **Spend ledger under concurrent CRDT writers** — a mutable counter cell
   loses increments under cell-level LWW; append-only writer-namespaced rows
   sum correctly. Budget caps are advisory pre-check + authoritative post-hoc.
5. **Merge-guard-then-converge on a plain ws-server** — the server cannot
   pre-strip like a Cloudflare DO (`willApplyChanges`); it can only
   converge-away *after* relay via its own synced store. Does that suffice?
6. **Server/writer-authored row ids** — collision-free multi-writer creation.

Julian lessons carried (from the #178 asset comment): merge-guard-then-
converge, writer-namespaced ids, authority from the store never the socket,
no coordination field before its reader exists.

## Run

```bash
cd prototype-178-store-schema && npm install   # once
npm run proto        # scripted hard-case scenarios S1–S5, full state printed
npm run proto:tui    # hand-drive the state model (keys listed on screen)
npm run proto:ws     # same scenarios over a REAL tinybase ws-server (substrate check)
```

## Layout

- `schema.mjs` — the pure logic module (the part worth lifting later): table
  shapes, claim-state derivation, spend summation, budget math, guard
  predicate, id helpers. No I/O, no terminal code.
- `scenarios.mjs` — S1–S5 against real `MergeableStore`s synced in-memory.
- `tui.mjs` — thin interactive shell over `schema.mjs`.
- `ws-run.mjs` — spins up `createWsServer` + ws clients, runs the scenario
  core over the wire, exits cleanly (no orphan servers — see the
  workerd-leak lesson).
