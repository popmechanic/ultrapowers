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

## State exams

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

## The engine boundary

The ultrapowers engine runs whatever `testCmd` it is handed and knows nothing
about Bun. This page is **authoring guidance**: it changes what a plan writes
down, never how a run executes.

## The baseline rule

Any Bun fixture or greenfield plan run on the fleet must start from a tree that
is **green at BASE**. A tree whose tests do not exist yet cannot pass knob
validation, so a greenfield plan driven through `/ultrapowers` starts from a
seeded, passing skeleton — see the Bun eval fixture for the shape.
