# Greenfield stack — Bun + TypeScript + TinyBase authoring defaults

Load this when a plan **creates a new codebase** (#425). It fixes the two knobs
a greenfield plan hands the engine, the one tsconfig detail that costs an
author an hour when it is guessed wrong, and the store the app keeps its state in.

## When it applies

Greenfield **target apps** only — a codebase the plan itself brings into
existence. It is never a restriction on an existing repo (whose stack is
already chosen and whose suite already runs), never on ultrapowers' own suite
(pytest), and never on the fleet driver (Node — its spawn/SIGTERM semantics are
what the driver measures, so it stays where it is).

## The two knobs, verbatim

- **testCmd:** bunx tsc --noEmit && bun test
- **bootstrapCmd:** bun install

Write both exactly as above. Bare `tsc` requires a global TypeScript install;
`bunx tsc` resolves the project's own devDependency — which is what keeps a
fresh clone's bootstrap to a single `bun install` with nothing but Bun present.

## Why it earns the restriction

`Consumes:`/`Produces:` stop being prose a reviewer has to eyeball. Running
`tsc --noEmit` over the integrated tree catches cross-task interface drift
deterministically, and interface drift is *the* characteristic failure of
parallel implementation: each task is green alone and the seam between them is
not. `bun test` is fast enough that an implementer can afford the whole suite
on every iteration, so a task never trades coverage for turnaround.

## The tsconfig gotcha

Take the Bun types from the `@types/bun` devDependency and name them in
tsconfig:

```json
{ "compilerOptions": { "types": ["bun"] } }
```

The older `bun-types` package name fails with
`TS2688: Cannot find type definition file for 'bun-types'`.

## The store, and the TinyApp shape

The app's state is **one TinyBase store** (operator, 2026-09-08). Every `do:` in a
Claim is a store mutation through the app's own callbacks and every `see:` is a
store read plus a render against it, so an exam can probe the store directly,
in-process, in milliseconds — no network or DOM event loop in the loop. That
holds exactly when the app reads from nowhere but the store; a plan that has
the app fetch or read outside its persister has left the shape and says so.

A **TinyApp** is the synced shape of that stack, and only that shape: a TinyBase
`MergeableStore` in the client, a `WsSynchronizer` to a Durable Object with a
SQLite persister, scaffolded by the official generator as a typed project —

```sh
npm create tinybase@latest -- --non-interactive --projectName <name> \
  --language typescript --framework react --schemas true \
  --syncType durable-objects --persistenceType sqlite --installAndRun false
```

— so the store's schema drives TypeScript inference and `bunx tsc --noEmit`
checks every data access (operator, 2026-09-09, chosen over a single-file
`index.html` + `app.jsx` that no compiler can see). Read
https://tinybase.org/skills/build-with-tinybase/SKILL.md before scaffolding; the
generator's `--list-options` is the authority for current values. An app whose
store is local-only is a Bun + TypeScript + TinyBase target, not a TinyApp. Write the
word `TinyApp` for that shape and nothing else; the borrowed term "vibes app"
is not this project's vocabulary. The runtime that hosts a TinyApp's Durable
Object inside a sandbox is #764's question, not this page's.

## The engine boundary

The ultrapowers engine runs whatever `testCmd` it is handed and knows nothing
about Bun. This page is **authoring guidance**: it changes what a plan writes
down, never how a run executes.

## The baseline rule

Any Bun fixture or greenfield plan run on the fleet must start from a tree that
is **green at BASE**. A tree whose tests do not exist yet cannot pass knob
validation, so a greenfield plan driven through `/ultrapowers` starts from a
seeded, passing skeleton — see the Bun eval fixture for the shape.
