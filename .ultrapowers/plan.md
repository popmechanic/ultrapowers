# A TinyApp goes online: a public page, staff behind sign-in, a deploy from the sandbox

**Grammar:** claims-v1
**Claim:** A TinyApp can go online from its run: anyone can open its public page and see it, only signed-in staff can change anything, and the sandbox deploys it itself. (elicited)
**Summary:** Every TinyApp now comes ready to go online: its page is built into the app's server, so the run's sandbox can deploy it, and the server has a public read-only page for everyone and the full live app at /staff for people who sign in. The public page reads a snapshot of what the station saved every few seconds and has no way to change anything, so visitors can't edit even with browser tools, which the in-browser rules alone could not stop. It exists so the radio app can be shared with listeners while only its staff and hosts edit, and so a run deploys and checks its own app (#1312).

**Goal:** Put a TinyApp online safely: pack the page into the Worker (#1312), a read-only public page, the live app at /staff behind Cloudflare Access, and a /health check for deploys (operator, 2026-09-29).
**Closes:** #1312
**Tech Stack:** Bun + TypeScript + TinyBase; Cloudflare Workers with a Durable Object; celld for local runs.

Spec: this session's design, 2026-09-29, prototyped on a copy of popmechanic/radio-station (every probe below passed on the prototype and failed at base).

## Global Constraints

- The template's routes, all served by one Worker: `/health` answers `{"ok":true}`; `/public.json` answers the saved store's content `[tables, values]` as JSON (`cache-control: no-store`); `/me` answers `{"email": …}` from Cloudflare Access; `/sync/…` is the live TinyBase sync; every other path answers the packed page (`index.html` for any path the pack has no file for). Cloudflare Access guards `/staff`, `/sync` and `/me`; `/`, `/public.json` and `/health` stay public.
- The public page never opens the sync: it loads `/public.json` into a local store every 5 s and mounts only the pieces `PUBLIC` names; staff (`/staff…`, or any page given a sync address, as the checker's is) get the live app and every piece.
- A deploy uploads one Worker and no static assets: the exe.dev edge replaces wrangler's asset-upload token (#1312), so a separate asset upload is refused.
- An app scaffolded before this change keeps working with the checker, which accepts the old `tinyapp root` answer at `/` as well as `/health`.
- Check: python3 -m pytest -q tests/test_stories_parse.py tests/test_stories_check.py tests/test_probe_block.py

### Task 1: The page is packed into the Worker

**Type:** implementation

**Files:**
- Create: `skills/ultrawrite/stories/tinyapp-template/scripts/pack-client.ts`
- Create: `skills/ultrawrite/stories/tinyapp-template/server/client-files.ts`
- Modify: `skills/ultrawrite/stories/tinyapp-template/package.json`

**Claim:** A TinyApp's page is built into its server, so a deploy uploads one thing. (derived)
Machine: M1. In a copy of the template (with a pieces index and a store module added and `bun install` run), `bun run pack` writes `server/client-files.ts` holding an `/index.html` entry whose text contains `<main id=`.

**Authorized-by:** #1312 (the pack spike); operator, 2026-09-29

**Interfaces:**
- Consumes: nothing
- Produces: `FILES: Record<string, { type: string; text?: string; base64?: string }>`

**Context:** `scripts/pack-client.ts` runs `bun build ./client/index.html --outdir <temp> --minify`, walks the output, and writes `server/client-files.ts` exporting `FILES`, keyed by `/`-rooted path (`/index.html`, `/index-<hash>.js`): text types (`.html`, `.js`, `.css`, `.json`, `.svg`, `.txt`, `.map`) as `{type, text}` with their content type, anything else as `{type, base64}`. It prints `PACKED <n> file(s) into server/client-files.ts` and exits 1 when the build fails. Commit `server/client-files.ts` as an empty `FILES` so the Worker compiles before the first pack. `package.json` gains the scripts `pack` (`bun scripts/pack-client.ts`) and `deploy` (`bun scripts/pack-client.ts && bunx wrangler deploy --config server/wrangler.jsonc`). The spike behind it (#1312, n=1, 2026-09-26): 638 KiB uploaded, no asset-upload call, page, script and deep link all 200.

**Proof:**
- Run: bash -c 'set -e; T=$(mktemp -d); cp -R skills/ultrawrite/stories/tinyapp-template/. $T; cd $T; mkdir -p client/src/pieces; printf "export const PIECES = [] as const;\nexport const PUBLIC: readonly string[] = [];\n" > client/src/pieces/index.ts; printf "export const TOOLS = []; export function makeStore () { return { getTablesSchemaJson: () => \"{}\" } }\n" > client/src/store.js; bun install --silent >/dev/null 2>&1; bun run pack >/dev/null; grep -q "\"/index.html\"" server/client-files.ts; grep -q "<main id=" server/client-files.ts' [M1]
- Legs: (a) after `bun run pack` the generated file has an `/index.html` entry carrying the page's `<main id=` [M1].

**Stale-if:**
- path-exists: `skills/ultrawrite/stories/tinyapp-template/scripts/pack-client.ts`

### Task 2: The Worker serves the page, the snapshot and /health

**Type:** implementation

**Files:**
- Modify: `skills/ultrawrite/stories/tinyapp-template/server/index.ts`

**Claim:** A TinyApp can go online from its run: anyone can open its public page and see it, only signed-in staff can change anything, and the sandbox deploys it itself. (derived)
Machine: M1. A copy of the template, packed and run under `celld dev`, answers `/health` with `"ok":true`, answers `/` and `/staff` with the page (`<main id=`), and, after a sync client at `/sync/app` sets the row `shows/0` to `{name: "Night Owls"}`, answers `/public.json` with content containing `"Night Owls"`.

**Authorized-by:** operator, 2026-09-29 ("Yes, plan the template first")

**Interfaces:**
- Consumes: `FILES: Record<string, { type: string; text?: string; base64?: string }>`
- Produces: nothing

**Context:** `server/index.ts` keeps `AppStore` (a `WsServerDurableObject` persisting to its SQLite) and `/me`. Add to `AppStore` an RPC method `snapshot()` that loads a fresh `createMergeableStore()` through `createDurableObjectSqlStoragePersister(store, this.ctx.storage.sql, {mode: 'fragmented'})` and returns `JSON.stringify(store.getContent())`: a string, because the content object does not survive the RPC boundary (prototype, celld, 2026-09-29: `DataCloneError`). The Worker's routes: `/health` → `Response.json({ok: true})`; `/me` as today; `/public.json` → the Durable Object named `sync/app` (TinyBase names it after the sync path without its leading `/`), its `snapshot()` text with `content-type: application/json` and `cache-control: no-store`; paths starting `/sync/` → the TinyBase sync fetch as today; anything else → the `FILES` entry for the path, else `/index.html`, with the entry's content type (a base64 entry decoded to bytes), or a 404 saying the page is not packed when `FILES` is empty. The probe packs a copy of the template, starts `celld dev` on a free port with `CELLD_ESBUILD` set, writes the row with a TinyBase `WsSynchronizer` client in Bun, and reads the routes with `curl`.

**Proof:**
- Run: bash -c 'set -e; T=$(mktemp -d); cp -R skills/ultrawrite/stories/tinyapp-template/. $T; cd $T; mkdir -p client/src/pieces; printf "export const PIECES = [] as const;\nexport const PUBLIC: readonly string[] = [];\n" > client/src/pieces/index.ts; printf "export const TOOLS = []; export function makeStore () { return { getTablesSchemaJson: () => \"{}\" } }\n" > client/src/store.js; bun install --silent >/dev/null 2>&1; bun run pack >/dev/null; ln -s $T/node_modules server/node_modules; P=$(python3 -c "import socket;s=socket.socket();s.bind((\"127.0.0.1\",0));print(s.getsockname()[1])"); (cd server && CELLD_ESBUILD=$T/node_modules/.bin/esbuild celld dev . --port $P --clean >/dev/null 2>&1 & echo $! > $T/pid); trap "kill \$(cat $T/pid) 2>/dev/null" EXIT; for i in $(seq 1 80); do curl -sf 127.0.0.1:$P/health >/dev/null && break; sleep 0.5; done; curl -s 127.0.0.1:$P/health | grep -q "\"ok\":true"; curl -s 127.0.0.1:$P/ | grep -q "<main id="; curl -s 127.0.0.1:$P/staff | grep -q "<main id="; printf "%s\n" "import {createMergeableStore} from \"tinybase\"; import {createWsSynchronizer} from \"tinybase/synchronizers/synchronizer-ws-client\"; const s=createMergeableStore(); const y=await createWsSynchronizer(s,new WebSocket(\"ws://127.0.0.1:$P/sync/app\")); await y.startSync(); s.setRow(\"shows\",\"0\",{name:\"Night Owls\"}); await new Promise(r=>setTimeout(r,1500)); await y.destroy();" > w.ts; bun w.ts; curl -s 127.0.0.1:$P/public.json | grep -q "\"Night Owls\""' [M1]
- Legs: (a) `/health` says `"ok":true`, `/` and `/staff` serve the page, and `/public.json` carries the row a sync client wrote [M1].

**Stale-if:**
- path-absent: `skills/ultrawrite/stories/tinyapp-template/server/index.ts`

### Task 3: The page is public and read-only unless it is /staff

**Type:** implementation

**Files:**
- Create: `skills/ultrawrite/stories/tinyapp-template/client/src/public.ts`
- Modify: `skills/ultrawrite/stories/tinyapp-template/client/src/app.ts`

**Claim:** Anyone can open a TinyApp's public page and see what was saved, and only the /staff page connects to change it. (derived)
Machine: M1. `isStaff(path, syncGlobal)` is true for `/staff` and `/staff/x`, and for any path when `syncGlobal` is set, and false for `/` and `/staffing`; `loadPublic(store, fetchImpl)` puts the fetched JSON into the store with `setContent` and answers `true`, and answers `false` for a response that is not ok. M2. In a browser, a packed app with pieces `a` and `b` and `PUBLIC` `["a"]`, served by `celld dev`, mounts only `a` at `/`, opens no WebSocket and reports `synced`; at `/staff` it mounts `a` and `b` and opens one WebSocket. M3. Pieces get `session.staff`, WebMCP tools register for staff only, and the staff sync defaults to the page's own origin (`wss://` on https) unless `__TINYAPP_SYNC__` is set; this is how the page's code reads, judged against its hunk.

**Authorized-by:** operator, 2026-09-29 ("Yes, plan the template first": a read-only public page, staff at /staff)

**Interfaces:**
- Consumes: nothing
- Produces: `isStaff(path: string, syncGlobal: unknown): boolean`
- Produces: `loadPublic(store, fetchImpl?, url?): Promise<boolean>`

**Context:** `client/src/public.ts` holds the two decisions, pure and testable: `isStaff` (`syncGlobal !== undefined || path === '/staff' || path.startsWith('/staff/')`) and `loadPublic(store, fetchImpl = fetch, url = '/public.json')`, which fetches with `cache: 'no-store'`, calls `store.setContent(json)` on success, and answers `false` on a non-ok response or any error. `client/src/app.ts` (given code; builders never edit it) imports `PUBLIC` beside `PIECES` from `./pieces/index`, computes `staff` once, passes `session = {who, staff}` to every piece's `mount`, skips non-`PUBLIC` pieces when not staff, registers WebMCP tools only for staff, and ends in two branches: not staff → `hook.synced = await loadPublic(store)` and a 5 s `setInterval` of `loadPublic`; staff → today's `/me` read and sync, with the default origin now the page's own (`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`), not `:8787`. The checker always sets `__TINYAPP_SYNC__`, so its stories keep running the staff app. The M2 probe carries its browser script base64-encoded (it counts WebSocket constructions through a page prelude and reads the mounted `section[data-piece]`s), because the script's quotes cannot ride a one-line shell command readably.

**Proof:**
- Run: bun -e 'const {isStaff,loadPublic}=await import("./skills/ultrawrite/stories/tinyapp-template/client/src/public.ts"); let set=null; const store={setContent:(c)=>{set=c}}; const ok1=isStaff("/staff",undefined)&&isStaff("/staff/x",undefined)&&!isStaff("/",undefined)&&!isStaff("/staffing",undefined)&&isStaff("/","ws://x"); const f=async()=>({ok:true,json:async()=>[{shows:{"0":{name:"Night Owls"}}},{}]}); const ok2=(await loadPublic(store,f))===true&&set[0].shows["0"].name==="Night Owls"; const bad=async()=>({ok:false}); const ok3=(await loadPublic(store,bad))===false; if(!(ok1&&ok2&&ok3)){console.error(JSON.stringify({ok1,ok2,ok3}));process.exit(1)}' [M1]
- Run: bash -c 'set -e; R=$PWD; T=$(mktemp -d); cp -R skills/ultrawrite/stories/tinyapp-template/. $T; cd $T; mkdir -p client/src/pieces; printf "export function mount (root: HTMLElement) { root.textContent = \"piece\"; }\n" > client/src/pieces/a.ts; cp client/src/pieces/a.ts client/src/pieces/b.ts; printf "import * as a from \"./a\";\nimport * as b from \"./b\";\nexport const PIECES = [[\"a\", a], [\"b\", b]] as const;\nexport const PUBLIC: readonly string[] = [\"a\"];\n" > client/src/pieces/index.ts; printf "import {createStore} from \"tinybase\";\nexport const TOOLS = [];\nexport function makeStore () { return createStore(); }\n" > client/src/store.js; bun install --silent >/dev/null 2>&1; bun run pack >/dev/null; ln -s $T/node_modules server/node_modules; P=$(python3 -c "import socket;s=socket.socket();s.bind((\"127.0.0.1\",0));print(s.getsockname()[1])"); (cd server && CELLD_ESBUILD=$T/node_modules/.bin/esbuild celld dev . --port $P --clean >/dev/null 2>&1 & echo $! > $T/pid); trap "kill \$(cat $T/pid) 2>/dev/null" EXIT; for i in $(seq 1 80); do curl -sf 127.0.0.1:$P/health >/dev/null && break; sleep 0.5; done; echo Y29uc3Qge2xhdW5jaEJyb3dzZXJ9ID0gYXdhaXQgaW1wb3J0KHByb2Nlc3MuZW52LlJFUE8gKyAnL2ZhY3Rvcnkvc3RhY2svdGlueWFwcC9icm93c2VyLnRzJyk7CmNvbnN0IHUgPSAnaHR0cDovLzEyNy4wLjAuMTonICsgcHJvY2Vzcy5lbnYuUE9SVDsKY29uc3QgcHJlID0gJ3dpbmRvdy5fX3dzPTA7Y29uc3QgVz13aW5kb3cuV2ViU29ja2V0O3dpbmRvdy5XZWJTb2NrZXQ9ZnVuY3Rpb24oLi4uYSl7d2luZG93Ll9fd3MrKztyZXR1cm4gbmV3IFcoLi4uYSl9O3dpbmRvdy5XZWJTb2NrZXQucHJvdG90eXBlPVcucHJvdG90eXBlOyc7CmNvbnN0IGIgPSBhd2FpdCBsYXVuY2hCcm93c2VyKCk7CmNvbnN0IGxvb2sgPSBhc3luYyAocGF0aCkgPT4gewogIGNvbnN0IHAgPSBhd2FpdCBiLm9wZW5Vcmwoe3VybDogdSArIHBhdGgsIG9yaWdpbjogdSwgY2xvY2s6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSwgcHJlbHVkZTogcHJlfSk7CiAgYXdhaXQgbmV3IFByb21pc2UoKHIpID0+IHNldFRpbWVvdXQociwgMjUwMCkpOwogIHJldHVybiBKU09OLnBhcnNlKGF3YWl0IHAuZXZhbHVhdGUoJ0pTT04uc3RyaW5naWZ5KHtwaWVjZXM6Wy4uLmRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoInNlY3Rpb25bZGF0YS1waWVjZV0iKV0ubWFwKHg9PnguZGF0YXNldC5waWVjZSksd3M6d2luZG93Ll9fd3Msc3luY2VkOiEhKHdpbmRvdy5fX1RJTllBUFBfXyYmd2luZG93Ll9fVElOWUFQUF9fLnN5bmNlZCl9KScpKTsKfTsKY29uc3QgcHViID0gYXdhaXQgbG9vaygnLycpOwpjb25zdCBzdGFmZiA9IGF3YWl0IGxvb2soJy9zdGFmZicpOwphd2FpdCBiLmNsb3NlKCk7CmNvbnN0IG9rID0gSlNPTi5zdHJpbmdpZnkocHViKSA9PT0gSlNPTi5zdHJpbmdpZnkoe3BpZWNlczogWydhJ10sIHdzOiAwLCBzeW5jZWQ6IHRydWV9KSAmJiBKU09OLnN0cmluZ2lmeShzdGFmZi5waWVjZXMpID09PSBKU09OLnN0cmluZ2lmeShbJ2EnLCAnYiddKSAmJiBzdGFmZi53cyA9PT0gMTsKaWYgKCFvaykgeyBjb25zb2xlLmVycm9yKEpTT04uc3RyaW5naWZ5KHtwdWIsIHN0YWZmfSkpOyBwcm9jZXNzLmV4aXQoMSk7IH0K | base64 -d > probe.mjs; REPO=$R PORT=$P bun probe.mjs' [M2]
- Legs: (a) the five `isStaff` cases, a `loadPublic` that sets the fetched content and answers `true`, and one that answers `false` on a failed response [M1]; (b) in a real browser (the checker's own `factory/stack/tinyapp/browser.ts`, with `WebSocket` wrapped to count connections), `/` shows only piece `a`, opens 0 WebSockets and is synced, and `/staff` shows `a` and `b` and opens 1 [M2]; M3 is read against the hunk.

**Stale-if:**
- path-exists: `skills/ultrawrite/stories/tinyapp-template/client/src/public.ts`

### Task 4: A scaffolded app names its public pieces

**Type:** implementation

**Files:**
- Modify: `skills/ultrawrite/stories/scaffold.ts`

**Claim:** A new TinyApp starts with the public page ready and says which pieces it shows. (derived)
Machine: M1. Scaffolding the `todo` catalog bundle writes a `client/src/pieces/index.ts` containing `export const PUBLIC: readonly string[] = [];`, and the app carries `scripts/pack-client.ts` and `server/client-files.ts` from the template.

**Authorized-by:** operator, 2026-09-29

**Interfaces:**
- Consumes: nothing
- Produces: nothing

**Context:** `skills/ultrawrite/stories/scaffold.ts` copies the template and writes `client/src/pieces/index.ts` (one import per piece and `PIECES`). Append, after `PIECES`, a comment line and `export const PUBLIC: readonly string[] = [];`: no piece is public until a plan names it. The template's new `scripts/` and `server/client-files.ts` come along with the existing template copy.

**Proof:**
- Run: bash -c 'set -e; T=$(mktemp -d)/app; bun skills/ultrawrite/stories/scaffold.ts skills/ultrawrite/catalog/todo $T >/dev/null; grep -q "export const PUBLIC: readonly string\[\] = \[\];" $T/client/src/pieces/index.ts; test -f $T/scripts/pack-client.ts; test -f $T/server/client-files.ts' [M1]
- Legs: (a) the scaffolded index declares an empty `PUBLIC`, and the pack script and the empty files module are in the new app [M1].

**Stale-if:**
- path-absent: `skills/ultrawrite/stories/scaffold.ts`

### Task 5: The checker knows a packed app is ready

**Type:** implementation

**Files:**
- Modify: `factory/stack/tinyapp/celld.ts`

**Claim:** The story checker keeps working on apps whose server serves the page. (derived)
Machine: M1. `startCelld` on an app whose Worker answers `/health` with `{"ok":true}` and answers `/` with a page (not `tinyapp root`) comes up ready and stops cleanly.

**Authorized-by:** operator, 2026-09-29

**Interfaces:**
- Consumes: nothing
- Produces: nothing

**Context:** `startCelld` in `factory/stack/tinyapp/celld.ts` waits until `GET /` contains `tinyapp root`, which the packed template no longer answers. Make it ready when `GET /health` answers ok with `"ok":true`, or, for apps scaffolded before this change, when `GET /` contains `tinyapp root`. Nothing else in the checker changes. The probe's throwaway Worker installs the template's `package.json` (for `esbuild`, which celld needs through `node_modules/.bin`); the sandbox has no `esbuild` on its PATH (run-260, 2026-09-29: builder B's engine belief). The untagged guard is the checker's own reading (`evals/readings/checker_kit.py`, which must still score 10/10 whenever `factory/stack/tinyapp/` changes).

**Proof:**
- Run: bash -c 'set -e; T=$(mktemp -d); mkdir -p $T/server; cp skills/ultrawrite/stories/tinyapp-template/package.json $T/; (cd $T && bun install --silent >/dev/null 2>&1); test -x $T/node_modules/.bin/esbuild; printf "export default { fetch: (r: Request) => new URL(r.url).pathname === \"/health\" ? Response.json({ok: true}) : new Response(\"a page\") };\n" > $T/server/index.ts; printf "{\"name\": \"t\", \"main\": \"index.ts\", \"compatibility_date\": \"2026-09-01\"}\n" > $T/server/wrangler.jsonc; bun -e "const {startCelld}=await import(\"./factory/stack/tinyapp/celld.ts\"); const c=await startCelld(\"$T\",{readyMs:30000}); await c.stop();"' [M1]
- Run: python3 evals/readings/checker_kit.py
- Legs: (a) celld comes up ready for a Worker that only answers `/health`, and stops [M1].

**Stale-if:**
- path-absent: `factory/stack/tinyapp/celld.ts`

### Task 6: The stack reference says how a TinyApp goes online

**Type:** implementation

**Files:**
- Modify: `skills/ultrawrite/references/greenfield-stack.md`

**Claim:** A plan author learns how a TinyApp goes online and what a plan's Publish and Verify lines are. (derived)
Machine: M1. `skills/ultrawrite/references/greenfield-stack.md` names `/public.json` and `pack-client`; what it says of the routes, the Access paths, `PUBLIC`, `session.staff` and the Publish and Verify lines is read against the diff.

**Authorized-by:** operator, 2026-09-29

**Interfaces:**
- Consumes: nothing
- Produces: nothing

**Context:** Add a section to `skills/ultrawrite/references/greenfield-stack.md` on going online: the routes listed in this plan's Global Constraints; that Cloudflare Access guards `/staff`, `/sync` and `/me` and leaves `/`, `/public.json` and `/health` public (the operator sets the Access application in the Cloudflare dashboard; no plan does); that a plan names its public pieces in `client/src/pieces/index.ts`'s `PUBLIC` and pieces hide staff controls when `session.staff` is false; and the deploy lines a publishing plan carries: `**Publish:** bun install && bun run deploy`, and `**Verify:** curl -fsS "$ULTRA_PUBLISH_URL/health"`, with the Worker's `name` and `account_id` set in `server/wrangler.jsonc`.

**Proof:**
- Run: grep -q 'public.json' skills/ultrawrite/references/greenfield-stack.md [M1]
- Run: grep -q 'pack-client' skills/ultrawrite/references/greenfield-stack.md [M1]
- Legs: (a) the reference names `/public.json` and `pack-client`, neither of which it names at BASE [M1].

**Stale-if:**
- path-absent: `skills/ultrawrite/references/greenfield-stack.md`
