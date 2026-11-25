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

A new app's **first build** does not use the generator: it starts from a repository empty
but for the README, the product record and the placed theme, and one author writes the page as ordinary React, as `first-build.md` says (operator,
2026-11-24, an `experiment`: n=1 run per arm, popmechanic-potluck-3 run-1 and run-2;
rollback a checkout of `dd53be04`, `docs/adr/0018-stories-route-retired.md`). Its
check is `bun install && bunx tsc --noEmit`, since nothing is installed before the builder
opens and no test is written.

A first build is also **handed UI SDK and a theme**: `@ui-sdk/react` and `@ui-sdk/core`,
which the app declares in `dependencies` at exactly the `sdk` of the `ui` cell in
`skills/ultrawrite/stories/policy.json` (one probe checks the pin), and a theme folder that
`skills/ultrawrite/themes/place.ts` writes to `client/src/theme/` in the first commit, over a
`structure.css` shared by every theme. A theme is plain CSS and optional layout components,
loaded as text and inlined into the page in place of UI SDK's `web.css`, under the layer
order `ui-sdk, structure, <theme name>`. Whether the page uses the components and the theme,
restyled or not, is the builder's call, and nothing checks which (operator, 2026-11-25, an `experiment`: n=1 run per arm, blind; rollback
the cell's, `docs/adr/0019-tinyapp-themes.md`).

**Who is signed in** comes from Cloudflare Access, never from the app: the
app's Worker answers `/me` with the email `ctx.access.getIdentity()` vouches
for (null when Access did not run), the page keeps it, and every store write is
given it, so a role rule lives in the app's rules module. The rule runs in the
page, so it stops the page's own writes, not a client that writes the store
directly; a server-side lock is its own task (radio rs4, 2026-09-28).

## Going online

A TinyApp goes online as **one Cloudflare Worker** that serves both the page and
the store (operator, 2026-09-29). The app's `bun run pack` builds the page and
writes every output file into the Worker's own source, and `bun run deploy` packs
before `wrangler deploy`, so there is no second host for the page. The Worker answers
these routes and no others:

- `/` — the page, public and read-only: it shows only what a visitor may see and
  re-reads `/public.json` every 5 s instead of syncing.
- `/public.json` — the saved snapshot of the store, read-only.
- `/health` — `200` when the Worker is up; what a plan's Verify line reads.
- `/staff` — the same page with everything on it, its write controls and the sync.
- `/sync` — the store's `WsSynchronizer` socket.
- `/me` — who is signed in, as `## The store, and the TinyApp shape` says.

**Cloudflare Access** guards `/staff`, `/sync` and `/me`, and leaves `/`,
`/public.json` and `/health` public. The operator sets that Access application
in the Cloudflare dashboard; no plan does, and no task writes Access config.

The public page is the same page with the write controls gone, not a second app.

A plan that publishes carries two header lines, verbatim:

- **Publish:** bun install && bun run deploy
- **Verify:** curl -fsS "$ULTRA_PUBLISH_URL/health"

and sets the Worker's `name` in the app's wrangler config. The Cloudflare account
goes in the app's `deploy` script, never in the config: `"deploy": "bun run pack &&
CLOUDFLARE_ACCOUNT_ID=<id> bunx wrangler deploy --config <wrangler config>"`. celld
refuses `account_id` and `workers_dev` in the config it starts from (radio-station,
2026-09-29: `celld deploy does not support these config keys: account_id,
workers_dev`). The Publish line runs once the plan's tasks have merged; the Verify
line exits 0 only when the deployed Worker answers `/health`.

## The engine boundary

The ultrapowers engine runs whatever `**Bootstrap:**` and `Check:` lines the plan
names and knows nothing about Bun. This page is **authoring guidance**: it changes what a plan writes
down, never how a run executes.

## The baseline rule

Any greenfield plan run on the fleet must start from a tree whose run-wide
`Check:` is **green at BASE**: a Check already red before any work is a red no
task owns (authoring-gotchas.md). So a greenfield plan driven through
`/ultrapowers` starts from a seeded, passing skeleton; for a TinyApp's first build,
`first-build.md` says what the base holds and what its check is.
