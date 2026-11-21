# 0014. The TinyApp template

Status: accepted (2026-11-21)  
Governs: `skills/ultrawrite/stories/tinyapp-template/client/src/app.tsx`, `skills/ultrawrite/stories/tinyapp-template/client/src/public.ts`, `skills/ultrawrite/stories/tinyapp-template/client/src/screens/catalog.ts`, `skills/ultrawrite/stories/tinyapp-template/client/src/screens/example.ts`, `skills/ultrawrite/stories/tinyapp-template/client/src/screens/functions.ts`, `skills/ultrawrite/stories/tinyapp-template/client/src/screens/pieces.ts`, `skills/ultrawrite/stories/tinyapp-template/client/src/screens/registry.tsx`, `skills/ultrawrite/stories/tinyapp-template/client/src/screens/state.ts`, `skills/ultrawrite/stories/tinyapp-template/scripts/build-client.ts`, `skills/ultrawrite/stories/tinyapp-template/scripts/pack-client.ts`, `skills/ultrawrite/stories/tinyapp-template/server/index.ts`, `tests/test_tinyapp_template.py`

Recovered from the code comments removed by `/delete-comment` on 2026-11-21: each entry is a
decision the code cannot show on its own. Symbols are named; line numbers are not.

## Tinyapp screen contract

- **registry.tsx ActionButton/ActionCheckbox/ActionSelect** — In the TinyApp template's client/src/screens/registry.tsx, ActionButton, ActionCheckbox and ActionSelect run their card action through useActions().handlers and emit only when it answers true, so a spec's on-draft writes run only after the action succeeded. Actions take args rather than an on binding because json-render 0.21.0 resolves $item to a state path inside action params but to the item's value inside props.
- **registry.tsx Text** — In the TinyApp template's registry.tsx, Text renders inside a div because 1st-Pouf's Text is a span and two placed in a Card would run together. Reading parts carry data-part="text"; the checker and the preview count a story's text lines only among them (as storyui names them from draws.json), so a picker's face that happens to read a name is not counted as a line.
- **registry.tsx ActionSelect** — In the TinyApp template's registry.tsx, ActionSelect shows its label above the control like a text box and uses it as the accessible name, which is how the checker's browser locates it by role and name.

## Tinyapp screens catalog

- **skills/ultrawrite/stories/tinyapp-template/client/src/screens/catalog.ts** — The TinyApp screens catalog (catalog.ts) lists which 1st-Pouf pieces a json-render screen may name and their props. Its props mirror each 1st-Pouf component's own variant props so the registry passes them straight through and tsc refuses a value 1st-Pouf would not accept, and it imports neither React nor 1st-Pouf so it loads in Bun without a DOM.
- **skills/ultrawrite/stories/tinyapp-template/client/src/screens/catalog.ts BUILT_IN** — In the TinyApp screens catalog, json-render's built-in actions (setState, pushState, removeState, validateForm, listed as BUILT_IN in catalog.ts) may write only under /draft/; changes to the store go through the store's own tool actions.
- **skills/ultrawrite/stories/tinyapp-template/client/src/screens/example.ts asExample** — A text box's example is drawn as "e.g. <word>" so it never reads as text already typed (#1506), but the screen spec keeps the raw word because the arranger matches on it. asExample in example.ts therefore adds the prefix only where the box is drawn and leaves an example already worded "e.g. ..." unchanged.

## Tinyapp template build

- **skills/ultrawrite/stories/tinyapp-template/scripts/build-client.ts** — The `bun build` command line loads no plugins and would leave 1st-Pouf's @theme and @utility rules uncompiled, so the TinyApp template builds its page with scripts/build-client.ts, which runs Tailwind over client/index.html into an output directory and works from any cwd.
- **skills/ultrawrite/stories/tinyapp-template/scripts/pack-client.ts** — The TinyApp template packs its built page into the Worker: scripts/pack-client.ts builds client/index.html and writes every output file into server/client-files.ts, so a deploy uploads a single Worker bundle with no separate asset upload.

## Tinyapp template page

- **skills/ultrawrite/stories/tinyapp-template/client/src/app.tsx** — skills/ultrawrite/stories/tinyapp-template/client/src/app.tsx is given code builders never edit: it makes the one synced store from the signed store module, draws the screen spec, exposes window.__TINYAPP__ for the checker and offers the same tools over WebMCP. Who is signed in comes from the Worker's /me (Cloudflare Access) and is passed to every action as run's third argument. Off /staff the page is public and read-only, drawing only the subtrees the screen lists in `public` and polling /public.json every 5 s; at /staff it draws everything, registers WebMCP tools and syncs. An app without screen.json still draws each piece from client/src/pieces/, signed-out only those marked public.
- **skills/ultrawrite/stories/tinyapp-template/client/src/app.tsx modelContext** — The TinyApp page offers its TOOLS plus a read-only readTables tool to an in-browser agent over WebMCP. The WebMCP spec puts modelContext on document while Chrome's early preview put it on navigator, so app.tsx checks both; with neither present nothing registers and the page works unchanged.

## Tinyapp template screens

- **client/src/screens/pieces.ts** — skills/ultrawrite/stories/tinyapp-template/client/src/screens/pieces.ts is imported by app.tsx as Bun macros (with {type: 'macro'}): the bundler runs screenSpec and pieceSpecs at build time and inlines their results, so the node:fs reads never ship to the browser.
- **screenSpec (client/src/screens/pieces.ts)** — A TinyApp's page screen is client/src/screen.json ({root, elements, public?}); screenSpec returns null when absent because apps built before the one-screen page have no screen.json and keep per-piece specs, which pieceSpecs reads.

## Tinyapp template server

- **skills/ultrawrite/stories/tinyapp-template/server/index.ts AppStore.snapshot** — The TinyApp template's AppStore.snapshot returns the store content as a JSON string, because the content object does not survive the Durable Object RPC boundary.
- **skills/ultrawrite/stories/tinyapp-template/server/index.ts snapshot** — TinyBase's WsServerDurableObject names the Durable Object after the sync path without its leading '/', so the TinyApp template server reaches the store for /public.json with idFromName('sync/app').

## Tinyapp public page

- **tinyapp-template client/src/public.ts isStaff** — In the TinyApp template (skills/ultrawrite/stories/tinyapp-template/client/src/public.ts), the page decides before mounting whether it is public or staff: anyone may open the public page and see the published snapshot, and only /staff (or a page the checker points at a sync server via the sync global) connects to the synced store to change it. The file is given code builders do not edit.

## Tinyapp screen computed functions

- **client/src/screens/functions.ts functions** — In the TinyApp template, a screen row sees only its own cells, so a row that names another table's row reads that row's text through the $computed function lookup, and format assembles labels from pieces (#1524); sum and count give totals and words maps a saved value (including '') to plain words. skills/ultrawrite/stories/arrange.ts emits these calls.

## Tinyapp screen spec

- **tinyapp-template client/src/screens/pieces.ts pieceSpecs** — TinyApps scaffolded before the single client/src/screen.json still carry per-piece specs under client/src/pieces/; the template draws those in the build order from screens/order.json (todo-tags: todo then tag), not by file name (#1491).

## Tinyapp screen state

- **tinyapp-template client/src/screens/state.ts tinybaseState** — The TinyApp template's json-render StateStore (client/src/screens/state.ts tinybaseState) exposes a snapshot {tables, values, draft, session} over the TinyBase store, but setSnapshot keeps only the new `draft`, so screens can never write saved data directly; it changes only through the app's actions. The snapshot rebuilds on every store transaction, and `refresh` rebuilds it for outside changes such as the session's `who`.

## Tinyapp template deps

- **skills/ultrawrite/stories/tinyapp-template package.json, bun.lock** — The TinyApp template pins every dependency in package.json to an exact version, and its committed bun.lock (copied by scaffold.ts) must list the same specs and resolve each direct dependency to its pin; tests/test_tinyapp_template.py checks this so a stale lockfile fails in the repo, not in a scaffolded app.
