# Greenfield stack — Bun + TypeScript + TinyBase authoring defaults

Load this when a plan **creates a new codebase** (#425). It fixes the setup and
check lines a greenfield plan hands the engine, the one tsconfig detail that costs an
author an hour when it is guessed wrong, and the store the app keeps its state in.

## When it applies

Greenfield **target apps** only — a codebase the plan itself brings into
existence. It is never a restriction on an existing repo (whose stack is
already chosen and whose suite already runs), never on ultrapowers' own suite
(pytest), and never on the fleet driver (Node — its spawn/SIGTERM semantics are
what the driver measures, so it stays where it is).

## The header lines, verbatim

- `**Bootstrap:** bun install` — the setup the engine runs before any builder opens
- `- Check: bunx tsc --noEmit && bun test` — under `## Global Constraints`, run on every tested snapshot
- `**Dependencies:** tinybase react react-dom dev: @types/bun typescript`

Write the first two exactly as above. Bare `tsc` requires a global TypeScript
install; `bunx tsc` resolves the project's own devDependency — which is what
keeps a fresh clone's bootstrap to a single `bun install` with nothing but Bun
present.

The third row is the plan's own: a TinyApp plan names every package it needs on
that one header line, the specs before the single `dev:` word installed for the
app and the ones after it installed as development-only. A package is declared
there and nowhere else — no task adds one by editing `package.json`,
`bunfig.toml` or `bun.lock`, and a manifest on a task's Files list is edited for
a script or a config field, never for a dependency.

## Why it earns the restriction

`Consumes:`/`Produces:` stop being prose a person has to eyeball. Running
`tsc --noEmit` over the integrated tree catches cross-task interface drift
deterministically, and interface drift is *the* characteristic failure of
parallel implementation: each task is green alone and the seam between them is
not. `bun test` is fast enough that a builder can afford the whole suite
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
is not this project's vocabulary.

A TinyApp's server is **one root Durable Object per app instance** — `AppRoot`,
reached as `env.APP.getByName('<instance>')` — and it is the only object the
outside world addresses. Each store is a **module object** of its own: a
`WsServerDurableObject` whose `createPersister()` is
`createDurableObjectSqlStoragePersister(store, this.ctx.storage.sql, { mode: 'fragmented' })`,
named `<instance>/<module>[@label]` — the optional `@label` names a fork of that
module — and reached only through the root, which maps `/sync/<module>` to
`env.MODULES.getByName('<instance>/<module>')` and serves the exam surface beside
it. The parcelling follows the plan's: one task owns one module, so two tasks
never write one store, and the client's `WsSynchronizer` dials `/sync/<module>`
for the module it reads.

A Durable Object **Facet** is not that shape while celld cannot carry a facet's
WebSocket. celld runs facets (`ctx.facets`, on 0.5.0 and later; each with its own
SQLite file since 0.6.0), and a facet answers a plain request. But on celld 0.6.1 the
`101` a facet returns still reaches the client without its upgrade (`Missing
upgrade header`), both for a facet started from a loaded Worker and for one
started from the app's own class through `ctx.exports`, while a named Durable
Object's socket echoes and closes cleanly on the same build (macOS arm64,
2026-10-01, n=1 run each; denoland/celld#210 was closed as not planned on
2026-09-17). A plan that wants facets keeps them behind a flag, and only for
verbs that are not sockets.

A **stories-v1** plan does not scaffold with the generator: its launch base is
`skills/ultrawrite/stories/tinyapp-template/` written by `stories/scaffold.ts`
(a React 19 page, one `AppStore` Durable Object with the SQLite persister). It
is still a TinyApp; builders write each piece's screen as a json-render spec and
no page code, as `## Screens` says (operator, 2026-10-01).

A new app's **first build** uses neither the generator nor the template: it starts from an
empty repository and one author writes the page as ordinary React, as
`first-build.md` says (operator, 2026-11-24, an `experiment`: n=1 run per arm,
popmechanic-potluck-3 run-1 and run-2; rollback the `first_build.route` policy cell). Its
check is `bun install && bunx tsc --noEmit`, since nothing is installed before the builder
opens and no test is written.

**Who is signed in** comes from Cloudflare Access, never from the app: the
template's Worker answers `/me` with the email `ctx.access.getIdentity()` vouches
for (null when Access did not run), the page keeps it as the hook's `who`, and
every store tool gets it as `run`'s third argument, so a role rule lives in the
signed store module. A story step's `"as": "<email>" | null` sets who is signed
in from that step on; the checker sets the hook's `who` the same way. The rule
runs in the page, so it stops the screens and the page's tools, not a client
that writes the store directly; a server-side lock is its own piece (radio rs4,
2026-09-28).

## Going online

A TinyApp goes online as **one Cloudflare Worker** that serves both the page and
the store (operator, 2026-09-29). The template's `scripts/pack-client.ts`
(`bun run pack`) builds `client/index.html` and writes every output file into
`server/client-files.ts`, and `bun run deploy` runs `pack-client` before
`wrangler deploy`, so there is no second host for the page. The Worker answers
these routes and no others:

- `/` — the page, public and read-only: it mounts only the pieces whose spec
  says `"public": true` and re-reads `/public.json` every 5 s instead of syncing.
- `/public.json` — the saved snapshot of the store, read-only.
- `/health` — `200` when the Worker is up; what a plan's Verify line reads.
- `/staff` — the same page with every piece, its WebMCP tools and the sync.
- `/sync` — the store's `WsSynchronizer` socket.
- `/me` — who is signed in, as `## The store, and the TinyApp shape` says.

**Cloudflare Access** guards `/staff`, `/sync` and `/me`, and leaves `/`,
`/public.json` and `/health` public. The operator sets that Access application
in the Cloudflare dashboard; no plan does, and no task writes Access config.

A plan marks a piece a visitor may see with `"public": true` in its spec,
`client/src/pieces/<piece>.json`; a piece without it is mounted only under
`/staff`. A public piece renders on both, and hides its staff controls with
`visible` on `/session/staff` — so the public page is the same screens with the
write controls gone, not a second app.

A plan that publishes carries two header lines, verbatim:

- **Publish:** bun install && bun run deploy
- **Verify:** curl -fsS "$ULTRA_PUBLISH_URL/health"

and sets the Worker's `name` in `server/wrangler.jsonc`. The Cloudflare account
goes in the app's `deploy` script, never in the config: `"deploy": "bun
scripts/pack-client.ts && CLOUDFLARE_ACCOUNT_ID=<id> bunx wrangler deploy --config
server/wrangler.jsonc"`. celld refuses `account_id` and `workers_dev` in the config
it starts from, and the story checker runs every step under celld (radio-station,
2026-09-29: `celld deploy does not support these config keys: account_id,
workers_dev`). The Publish line runs once the plan's tasks have merged; the Verify
line exits 0 only when the deployed Worker answers `/health`.

## Screens

A TinyApp's screens are built from **1st-Pouf**, not hand-written page code
(operator, 2026-10-01; this replaces the 2026-09-16 Tailwind + shadcn styling
experiment).

- **The spec.** The page is one screen, `client/src/screen.json`, a
  json-render spec — `{root, elements, public?}`, where `public` lists the
  element ids whose subtrees a signed-out visitor sees on `/` — over the catalog in
  `client/src/screens/catalog.ts`: 1st-Pouf's pieces with Zod props, and the
  store-bound `ActionButton`, `ActionCheckbox`, `DraftInput` and `DraftNumber`. The page is
  React 19; a builder writes specs, and a part only when a story needs one.
- **The parts list grows in the open (operator, 2026-11-20, #1491).** Each part has a
  line in `client/src/screens/draws.json` naming the accessibility role it draws and
  the props that name it (`ActionButton`: a button, by `name` then `label`). A story
  that expects to see a role no part draws is a `PARTS fact:` while planning, and
  compile tells that piece's task to add the part; any builder whose screen needs one
  adds it: its props in `catalog.ts`, a wrapper over a 1st-Pouf component in
  `registry.tsx`, its `draws.json` line, and any label function in `functions.ts`. The
  PR lists the run's new parts under `### New screen parts`; one worth keeping is copied
  into the template by hand, so the next app starts with it. Before this, the parts were
  closed to a run, and potluck-2 run-1 (2026-11-20) ended a draft on a status label no
  part could draw.
- **Where the spec starts.** The screen starts as the whole page the operator
  picked while planning (`<bundle>/screens/screen.json`, which compile copies
  in), else the scaffold's empty column; every piece's builder edits it from there.
- **The reads.** A row shows its own cells; a row naming another table's row (a tag's
  `todoId`) reads that row's text through the `$computed` functions `lookup` and `format` in
  `client/src/screens/functions.ts`, which every renderer is given (#1524).
- **The writes.** Saved data changes only through card actions, run from an
  element's `action` prop. `$bindState` and json-render's built-in state
  actions write only under `/draft/` (a built-in with no `statePath` writes its own
  default, so it names one), and no screen binds `$bindItem`, which writes the row.
- **The look.** 1st-Pouf (moji2002/1st-pouf, MIT, Copyright (c) 2026 Mojtaba
  Beheshti) is vendored byte-identical at `client/src/pouf/` from commit
  `1993b1ec9f2d93b6753929d1f70c89f8ef89b13e`, pinned by
  `client/src/pouf.vendor.json`, and never patched; its `blocks/` and `demos/`
  folders, which nothing imports, are left out (the manifest's `omitted`). Tailwind v4 compiles its
  theme at build through `bun-plugin-tailwind` in `scripts/build-client.ts`,
  which `bun run pack` and the story checker both run. The font is
  `@fontsource-variable/nunito`, bundled, so no font host is dialled.
- **The check.** `bun factory/stack/tinyapp/screens.ts (--plan <plan.md> |
  --bundle <dir>) [--copy <app>] [--piece <piece>]` checks every spec without a
  browser (exit 0 pass, 1 finding, 2 could not run); the engine runs it as one
  more fact of each piece's task, so a missing or miswired button is caught
  there. It also checks the parts: every part has its `draws.json` line, and
  `client/src/pouf/` is byte-for-byte its pin.

## The engine boundary

The ultrapowers engine runs whatever `**Bootstrap:**` and `Check:` lines the plan
names and knows nothing about Bun. This page is **authoring guidance**: it changes what a plan writes
down, never how a run executes.

## The baseline rule

Any greenfield plan run on the fleet must start from a tree whose run-wide
`Check:` is **green at BASE**: a Check already red before any work is a red no
task owns (authoring-gotchas.md). So a greenfield plan driven through
`/ultrapowers` starts from a seeded, passing skeleton — for a TinyApp,
`skills/ultrawrite/stories/scaffold.ts`.
