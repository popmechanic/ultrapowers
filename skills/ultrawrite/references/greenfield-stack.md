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
- **Dependencies:** tinybase react react-dom dev: @types/bun typescript

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

A Durable Object **Facet** is not that shape, and does not become it until celld
carries a facet's WebSocket: on celld 0.5.0 the 101 a facet accepts does not
cross back to its root — the `webSocket` is null and the upgrade headers are
absent, on macOS and on Linux alike — while a named Durable Object's socket
works in the same fleet (denoland/celld#210, 2026-09-17). A plan that wants
facets keeps them behind a flag, and only for verbs that are not sockets. How an
exam starts, budgets and stops that server is `## The runtime host`, below.

## State exams

*Deferred since cut three (2026-09-22): no plan can name a `Test:` path, so nothing in this section has a reader until state exams return as probes — owed on map #1248. The text below is the shape for that day, kept as it was.*

Every `**Review:** peer` task of a TinyApp plan names one `*.test.ts` state exam
as a Proof `Test:` path — a `lean` task may carry one, and no other task type
owes one. The exam is a single Bun test. The `tinyapp-exam` it imports is
`packages/tinyapp-exam` of popmechanic/tinyapp-fixture, copied into each target
per plan (its own tests stay in the fixture) until it is published as a package.
Hand an examiner this shape, verbatim, in Context; the examiner receives no
library docs and writes the file from the task text alone:

```ts
import { stateExam } from "tinyapp-exam";
import { schema, addTodo } from "../../../src/store";   // relative to tests/exams/<slug>/, where the exam lands

stateExam({
  clock: "2026-01-01T00:00:00Z",
  seed:     "state-exams/seeds/empty.json",
  action:   (store) => addTodo(store, "buy milk"),
  expected: "state-exams/expected/one-open-todo.json",
  view:     { selector: "li", count: 1, text: "buy milk", unchecked: true },
  mutant:   [{ table: "todos", row: "1", cell: "done", value: true }],
});
```

The exam lands under `tests/exams/<slug>/`, so every import is written for that
depth. Its snapshots live in the target: seeds under `state-exams/seeds/` and
expected states under `state-exams/expected/`, each a JSON `[tables, values]`
pair — TinyBase's `getContent()` shape — loaded with `setContent` against the
app's schema. Snapshots fold as text, so two tasks editing one meet in the
kernel line-wise and the schema-typed load catches a bad fold.

`view` is a closed vocabulary —
`{selector, count?, text?, attr?: {name, value}, checked?, unchecked?, absent?: true}`
— and `mutant` is a list of `{table, row, cell, value}`, `{…, cell: absent}` or
`{table, row: absent}` entries: each mutation must break the exam.

Seeding is the plan's own work. The generated scaffold's store file is where the
plan's Task writes the branch: the store module honours `window.__TINYAPP_SEED__`
— when it is present the store loads that content and starts neither the
`WsSynchronizer` nor the persister, so the exam owns the state it asserts.

An `action` need not be a callback. The fixture's
`tests/state-exams/click-completes-todo.test.ts` is the interaction shape to
hand an examiner, verbatim:

```ts
import {stateExam} from 'tinyapp-exam';
import {createTodosStore} from '../../client/src/storeData';

// Clicking the first todo's checkbox completes that todo and leaves the other
// one open. `TodoList` renders rows ascending by row id, so `#todo-0` is the
// first `.todoItem` and `Page.act` clicks the first match of its selector —
// hence row `0` is the one that moves.
stateExam({
  clock: '2026-01-01T00:00:00Z',
  entry: 'client/index.html',
  seed: 'state-exams/seeds/two-open-todos.json',
  store: () => createTodosStore(),
  action: {click: '.todoItem input[type=checkbox]'},
  expected: 'state-exams/expected/two-todos-first-done.json',
  view: [
    // `.todoItem.completed` names exactly the row that was clicked: the bare
    // `.todoItem input[type=checkbox]` would match both boxes, and `checked`
    // asks that *every* match read `data-checked="true"`.
    {selector: '.todoItem.completed input[type=checkbox]', checked: true},
    {selector: '.todoItem', count: 2},
  ],
  mutant: [{table: 'todos', row: '0', cell: 'completed', value: false}],
});
```

Its `tests/state-exams/enter-submits-todo.test.ts` reaches the callback exam's
state by the app's own path, through two moves:

```ts
import {stateExam} from 'tinyapp-exam';
import {createTodosStore} from '../../client/src/storeData';

// Typing into the input and pressing Enter submits the form, and `addTodo`
// assigns row id `0` on a store seeded empty — so the state reached is the
// same one-open-todo state the callback exam reaches, by the app's own path.
stateExam({
  clock: '2026-01-01T00:00:00Z',
  entry: 'client/index.html',
  seed: 'state-exams/seeds/empty.json',
  store: () => createTodosStore(),
  action: [
    {type: ['input[placeholder="What needs to be done?"]', 'buy milk']},
    {key: ['input[placeholder="What needs to be done?"]', 'Enter']},
  ],
  expected: 'state-exams/expected/one-open-todo.json',
  view: {selector: '.todoItem', count: 1, text: 'buy milk'},
  mutant: [{table: 'todos', row: '0', cell: 'text', value: ''}],
});
```

So an `action` is a store callback, or one of the three interaction forms —
`{click: selector}`, `{type: [selector, text]}`, `{key: [selector, key]}` — or
an array of those forms, performed in order.

An exam that names an `entry` renders it and performs its action for real; one
that names none is a store exam and its render move is recorded as `skipped`.
The interaction runs in the machine's own Chromium, driven over raw CDP: on the
fleet image that binary is `/headless-shell/headless-shell` (Chromium 151).
`TINYAPP_BROWSER` names one elsewhere and `launchBrowser` reads it first;
`TINYAPP_BROWSER_ARGS` is space-separated extra flags, such as `--no-sandbox`
on a box that needs it. A missing browser is a red exam that names the path —
`browser: no such binary <path>`.

The page is a `data:` URL with every request blocked and the clock pinned in
the page. `walls.json` gained `action_ms`, the interaction's wall alone and
`null` for a callback, and `browser`, which reads `'ran'` or `'skipped'`.
`contract.json` records `pinned_in_page`: `true` for an interaction, `false`
for a callback.

Two rules here are measured, not guessed. `bundleOf` builds with
`minify: true` because Chromium hangs rather than fails on a `data:` URL over
2,097,152 characters, and the fixture's unminified bundle is ~1.94 MB against
789 KB minified. And every seed and expected literal is computed at BASE, never
written from memory: run-7 parked because its plan pinned
`two-todos-one-done.json` (row 1 done) as the state of clicking the first box
(row 0), and asserted a `checked` view over a selector matching both boxes.

A target that exposes `bun run lint:state` has it run over a plan's seeds and
expected files before the gate readers.

*No schema defaults on a cell or value a plan adds.* A `default` is materialised
into every existing row's `getContent()`, rewriting every seed and expected file
(measured: 5–7 files, 13–20 pins across three plans); a cell with no default is
absent on old rows and every BASE snapshot round-trips byte-identical (measured
across the three plans of the #867 trio, popmechanic/tinyapp-fixture,
2026-09-15).

*A plan that adds a callback, an invariant or a snapshot owns the linter's four
test files.*
`packages/tinyapp-lint/test/{lint-cli,invariants,reachability,views}.test.ts`
pin exact counts and lists; loosen them to containment and tree-computed counts,
never to a new exact literal, because a sibling plan changes them concurrently
(both folds of 2026-09-15 — run-12's publish fold onto run-13's merge, #1019
comment).

*A date field is a text input.* The exam's `type` is CDP `Input.insertText`,
which does not reach `<input type="date">` (run-12's authoring, measured).

*An exam never spawns a test runner.* An exam proves one claim — one claim, one
prover, at the layer where the claim can be false — so it reaches for the state
through imports and calls and never for a runner: no `bun test` over another
file or a package, no `bun run lint:state|lint:ui|typecheck|history`, no
`Bun.spawn`, `spawnSync` or `execSync`. Regression is the fold's one suite run
per merge, and a verification must not re-run other verifications. Measured: 19
of 29 fixture exam files spawned runners, one leg took 573 s, and the fold suite
grew from 2.4 to 19 minutes over n=4 fixture runs ending at run-24, where a
plain exam runs in 1.4 s. A comment carrying one of the five literals is an
offender too — the check is a `grep`, for the reason the gotchas' zero-count-grep
row gives — and the compiler refuses a `Run:` that names two exams at once with
`one Run, one exam`. Every TinyApp plan carries this Global Constraint, blocking:

```
- Check: ! grep -rnE 'bun test|bun run|Bun\.spawn|spawnSync|execSync' tests/state-exams | grep -vE ':[0-9]+:[[:space:]]*(//|\*|/\*)' | grep .
```

The first `grep` prints every matching line as `path:line:text`, the second
drops lines that are comments (`//`, `*` or `/*` after leading whitespace: an
exam's header comment may quote a `Run:` line without running it, fixture
run-28, 2026-09-17), and the last exits 0 only when something is left; so the
leading `!` makes a clean tree exit 0 and silent, and one offender exit 1
with that file's path on stdout.

## The runtime host

*Deferred since cut three (2026-09-22): no plan can name a `Test:` path, so nothing in this section has a reader until state exams return as probes — owed on map #1248. The text below is the shape for that day, kept as it was.*

A TinyApp's server runs on **celld**, and a plan that names a state exam names
the host with it. What follows is what a plan writes down about that host — the
start line, the budget, the teardown and the one thing an exam must never reach
for — not how the engine runs it.

- **Where it is.** On a fleet sandbox celld is already at `/usr/local/bin/celld`,
  put there by the fleet's own setup script and verified by digest; on a laptop it
  is wherever the operator installed it, so a plan names the binary and never a
  package manager.
- **How an exam starts it.** The start line is
  `celld dev <server dir> --no-watch --clean --port <p>`, with `<p>` a free
  loopback port the exam picks. `celld dev` takes no `--internal-listen` (0.5.0
  answers `unknown argument`, read 2026-09-17): it starts its node with
  `--internal-listen 127.0.0.1:0` itself, so an instance holds **two ports**,
  the worker's and one the node picks, ephemeral and never named or tunnelled.
  `--no-watch` is not optional — without it a mid-run tree change rebuilds under
  a running exam — and `--clean` starts the copy from empty state.
- **Its bundler.** `CELLD_ESBUILD` names `<repo>/node_modules/.bin/esbuild`, and
  that binary comes from the plan's own Dependencies line, which carries esbuild
  after its `dev:` word (`dev: esbuild@0.25.x`) — so the sandbox installs no
  esbuild of its own and the version an exam bundles with is the one the plan
  pinned.
- **Its memory budget.** `CELLD_MAX_RSS_MB` is set per instance, because celld's
  own thresholds read root cgroup paths an exe VM does not have and fall back to
  `MemTotal` and celld's own RSS — a reading that is not the VM's real share, so
  the plan states the number rather than letting celld guess it.
- **Its exam surface.** The exam-mode surface is enabled by `TINYAPP_EXAM=1` in
  `.dev.vars`, and only under it does the root serve `content`, `rows`, `fork`,
  `reload` and `discard` — `/exam/content?f=`, `/exam/rows?f=`, `/exam/fork?from=&to=`,
  `/exam/reload?f=` and `/exam/discard?f=`, each a call through to the module
  object. A build without that flag serves `/sync/<module>` and nothing else.
- **Its config.** The config file is `wrangler.jsonc`, since celld rejects
  `wrangler.toml`; a scaffold that writes the TOML form is converted before the
  first exam runs. celld 0.5 also refuses the deploy-only keys `account_id` and
  `workers_dev` in it (`celld deploy does not support these config keys`, run-38
  on tinyapp-fixture, 2026-09-24 — every fold red, the run parked), so a target
  that deploys names its account in a committed env file wrangler reads with
  `--env-file` (`CLOUDFLARE_ACCOUNT_ID=…`) and never in the config celld starts from.
- **How an exam stops it.** Teardown is a `SIGTERM` to the supervisor and then a
  wait for the port to clear — it drains in about a second — because a hard kill
  leaves the port held and the next task starts on `Address already in use`.
- **What it must never reach for.** The probe runs with **no bucket** and no
  network: no R2 or KV binding, no fetch off the box, nothing but `lo` up (it
  passes inside `unshare -n`), so a green exam is a claim about the store and not
  about the operator's account.
- **The walls, so a plan can size a task.** Measured on a laptop: `celld dev
  --clean` is ready in about 1 s, and a fork by read and seed is 12–16 ms
  (popmechanic/tinyapp-fixture branch `facets-on-celld`, `3b1afca`, 2026-09-17;
  connect 18–23 ms, sync 21 ms, converge 0 ms at n=3, and the earlier facet probe's
  fork plus seed at n=20, 2026-09-16).

## Styling (experiment, 2026-09-16)

A TinyApp's styling is **Tailwind v4 + shadcn/ui installed by its CLI + `@shadcn/lint`**,
signed by the operator on 2026-09-16 as an *experiment* on popmechanic/tinyapp-fixture
(spec `2026-09-16-linted-design-system-experiment.md`, on the laptop), read over the next
five fixture runs after the re-platform merges — no default until `n = 5 runs`. The trade
is stated: more specificity in the stack, bought for a sensor nothing else in the fleet
carries — presentation checked mechanically, with diagnostics the fix round converges on
(shadcn-ui/lint's evals: zero findings in one round across 150+ agent task runs).

- **The system.** `bunx --bun shadcn@latest init -d --yes` on the Vite client, then `add`
  only the components the app uses; tokens in the client's `index.css` `@theme inline`
  block; Tailwind v4 through `@tailwindcss/vite`. No hand-written CSS files. The tsconfig
  alias is `paths: {"@/*": ["./src/*"]}` with **no `baseUrl`** (TypeScript 6 refuses it).
- **The lint.** A root `lint:ui` script runs ESLint 9 with the six `@shadcn/lint` rules
  (`no-restyle` allowing `layout`, `no-raw-colors`, `no-arbitrary-values`,
  `no-inline-styles`, `no-unknown-classes`, `require-static-classes`) over the client's
  source, with `components/ui/**` excluded from every rule — shadcn's own generated files
  carry arbitrary values by design (8 of the probe's 15 baseline findings). Every TinyApp
  plan carries `- Check: bun run lint:ui` in its Global Constraints, blocking; `(minor)`
  on that line is the rollback inside the experiment.
- **The exams.** Interactions select by role and accessible name
  (`{click: {role, name}}`), never by a class: `no-unknown-classes` flags a semantic class
  on a plain element too (7 of the 15). Views use tags and shadcn's `data-slot`
  attributes. Every control has an accessible name; one the tree cannot name is a red exam.
- **The reading.** Per task: `lint:ui` findings on the first `driver:check-run` (drift), and
  whether the fix round reached exit 0 (correction). Keep when drift is non-zero on at
  least one task per run and every task reaches zero in its one round; flat drift over the
  window retires the section. **Rollback:** the fixture's CSS files as they stand at
  `062aebf63e8f21290e7bd7348fa60ed7d76d6332`.

## The engine boundary

The ultrapowers engine runs whatever `testCmd` it is handed and knows nothing
about Bun. This page is **authoring guidance**: it changes what a plan writes
down, never how a run executes.

## The baseline rule

Any Bun fixture or greenfield plan run on the fleet must start from a tree that
is **green at BASE**. A tree whose tests do not exist yet cannot pass knob
validation, so a greenfield plan driven through `/ultrapowers` starts from a
seeded, passing skeleton — see the Bun eval fixture for the shape.
