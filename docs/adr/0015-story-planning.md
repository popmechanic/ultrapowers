# 0015. Story planning for TinyApps

Status: accepted (2026-11-21)  
Governs: `skills/ultrawrite/catalog/todo-tags/store.js`, `skills/ultrawrite/catalog/todo/store.js`, `skills/ultrawrite/stories/arrange.ts`, `skills/ultrawrite/stories/ask.ts`, `skills/ultrawrite/stories/bundle.ts`, `skills/ultrawrite/stories/checks.ts`, `skills/ultrawrite/stories/compile.ts`, `skills/ultrawrite/stories/gate_jev.ts`, `skills/ultrawrite/stories/jev_checks.ts`, `skills/ultrawrite/stories/notebook.ts`, `skills/ultrawrite/stories/parts.ts`, `skills/ultrawrite/stories/preview.ts`, `skills/ultrawrite/stories/preview/names.ts`, `skills/ultrawrite/stories/preview/page.tsx`, `skills/ultrawrite/stories/preview/play.ts`, `skills/ultrawrite/stories/preview/probe.ts`, `skills/ultrawrite/stories/product.ts`, `skills/ultrawrite/stories/scaffold.ts`, `skills/ultrawrite/stories/storyui.ts`, `tests/test_preview_server.py`, `tests/test_stories_compile.py`, `tests/test_stories_parse.py`

Recovered from the code comments removed by `/delete-comment` on 2026-11-21: each entry is a
decision the code cannot show on its own. Symbols are named; line numbers are not.

## Experience walk

- **skills/ultrawrite/stories/walk.ts** — A run's probes show that an app works, not that it is good to use: on 2026-11-24 the Potluck app the operator judged far worse passed six of six probes and the better one five (n=1 run per arm), and on 2026-11-20 a page they called nonsensical passed seventeen of seventeen (#1609). So the session that serves a built app for the operator's smoke walks it first as a first-time user and answers the six `smoke_walk` questions of skills/ultrawrite/stories/questions.json, each yes, partly or no with one sentence of evidence. walk.ts makes no model or network call: it lists the questions, refuses an incomplete walk, renders the answers for a pull request comment, records the operator's own verdict beside the walk and counts agreement over `*.walk.json`. The walk reports and never gates. It is an experiment kept on the laptop until the walk and the operator have agreed on n=5 runs; moving it into the sandbox is a separate decision, and its rollback is removing the step.

## First build route

- **routeOf** — A new app's first plan goes to one author. `routeOf` in skills/ultrawrite/stories/product.ts reads a product record with no built plan as a first build and prints the route from the `first_build.route` cell of the policy.json beside it: `solo` sends the author to skills/ultrawrite/references/first-build.md (a one-task claims-v1 plan from the ask and the app's rules, with no stories, parts kit, arranger or template), `stories` to the stories pipeline; a record with a built plan is a later plan: `claims` when a built plan carries `by: solo`, written by `product.ts built` (`markBuilt`) when the first-build plan is made and committed into the app as stories/product.json, else `stories`. A one-author app has no template, parts kit or screen file, so the stories compiler cannot run on it; its later plans are ordinary claims-v1 plans (operator, 2026-11-24). On 2026-11-24 the operator judged a one-author Potluck entirely superior to a three-builder one in a blind smoke test, and both better than the stories-pipeline Potluck of 2026-11-20 (n=1 run per arm, popmechanic-potluck-3 run-1 and run-2, #1606), so the cell is an experiment whose rollback is `stories`.

## Stories preview server

- **skills/ultrawrite/stories/preview.ts** — skills/ultrawrite/stories/preview.ts serves a bundle's screen with the scaffolded TinyApp's own kit (no CDN), pushes changes under screens/ over a websocket, takes picks and notes as JSON lines on POST /feedback and runs story plays via /play and /played. Only its own page may talk to it (#1530): every request must name the server's own host, and data routes refuse cross-site browser requests and non-JSON POSTs.
- **PROBE** — In-repo, skills/ultrawrite/stories/preview/probe.ts re-exports factory/stack/tinyapp/probe.ts; preview.ts copies the real probe file over it when staging the page inside the app, where the repo-relative path no longer resolves.
- **DATA** — skills/ultrawrite/stories/preview.ts applies the cross-site checks only to the routes that read or change the operator's work (/ws, /bundle, /specs, /play, /played, /feedback); the page and its static files stay reachable from any link because those requests carry no data.
- **foreign** — skills/ultrawrite/stories/preview.ts foreign() refuses a request whose Host is not the server's own (DNS rebinding) and, on data routes, a browser request from another site or a non-JSON POST; a request with neither Origin nor Sec-Fetch-Site, such as curl or Claude, passes.
- **main (pageDir/dist cleanup)** — skills/ultrawrite/stories/preview.ts removes only <app>/.preview/page and <app>/.preview/dist at start, never all of .preview, because skills/ultrawrite/stories/arrange.ts stages json-render's composer at <app>/.preview/json-render.
- **Bun.serve idleTimeout** — skills/ultrawrite/stories/preview.ts sets Bun.serve's idleTimeout (seconds) to PLAY_WAIT plus ten, so a story play that runs its full wait still returns its JSON answer rather than being cut by Bun's idle timeout.

## Jev authoring checks

- **skills/ultrawrite/stories/jev_checks.ts** — skills/ultrawrite/stories/jev_checks.ts asks Jev at each enrichment stage after the code checks run; Jev judges and never generates or decides, and its flags are for the author to act on. Only three kinds of flag may become operator doubts (DOUBT:), each a product choice in plain words: an ask sentence with two readings, an assumption about what the app does, and a link the audience might not expect.
- **reader (skills/ultrawrite/stories/jev_checks.ts)** — In jev_checks.ts, reader's `one` sends each Jev request immediately so a stage's calls run concurrently, and returns a thunk the stage awaits in its own order, so flags and product.json reading rows keep a deterministic order.
- **understanding (skills/ultrawrite/stories/jev_checks.ts)** — The understanding stage in jev_checks.ts sends only assumptions the author made alone (by: author) to the surprise question; a choice the operator already made is never re-asked.
- **understanding (skills/ultrawrite/stories/jev_checks.ts)** — An assumption labelled technical skips the surprise question, so jev_checks.ts asks Jev whether it is really about the product; a high reading is only a flag for the author, never an operator doubt.
- **bundleStage (skills/ultrawrite/stories/jev_checks.ts)** — The bundle stage in jev_checks.ts runs the ambiguity check on --ask-file text only when it differs from product.json's understanding.ask: the first plan's ask was already read at the understanding stage, while a later plan's ask is new words.

## Screen arrangement

- **skills/ultrawrite/stories/arrange.ts** — skills/ultrawrite/stories/arrange.ts builds every candidate element for a TinyApp page by code from the cards and the store, never from a story's `ui` or `see`: each action's control, each string or number input's draft box, one list per table its row actions work on, a few containers, the page title, each card's purpose and its `shows` lines. Jev only chooses and places those candidates through json-render's vendored composer, once per version in questions.json's authoring_arrange, keeping Jev a judgment and never generation. The composer is staged into <app>/.preview/json-render/ so it shares the installed app's zod.
- **skills/ultrawrite/stories/arrange.ts Line** — json-render's composer cannot read `$computed` props, so skills/ultrawrite/stories/arrange.ts sends each page line to it as `stand` (its plain words) and swaps it back to `real` (the computed format) after composing, and folds back before any reshape.
- **skills/ultrawrite/stories/arrange.ts recipeKey** — recipeKey in skills/ultrawrite/stories/arrange.ts serialises elements with object keys sorted because the composer compares element recipes that way; matching candidates to composed elements by any other serialisation would miss.
- **skills/ultrawrite/stories/arrange.ts draftKey** — When two actions take an input of the same name, skills/ultrawrite/stories/arrange.ts gives each its own draft path (`/draft/<action>.<input>`) so typing for one action never fills the other's box; an input only one action types into keeps `/draft/<input>`.
- **skills/ultrawrite/stories/arrange.ts inUseOrder** — After Jev composes a page, inUseOrder in skills/ultrawrite/stories/arrange.ts fixes the order a person uses the screen by code (#1510): an action's text boxes sit directly before its button in the card's input order, and a whole-list button sits just below the list its action changes. Anything already in order is left as composed so each version keeps its own containers.
- **descriptionsOf** — skills/ultrawrite/stories/arrange.ts descriptionsOf describes each element of a screen spec by its candidate's description, and a container below the root also names what it holds (each child's description up to its first colon), so an operator's reshape note can name a group by its content ("the party form", "the guests"). A bare "A row" gave Jev nothing to move, and the Potluck reshape finished without an edit (#1591; tests/test_arrange.py test_reshape_names_a_container_by_what_it_holds).

## Stories bundle format

- **skills/ultrawrite/stories/bundle.ts Step.as** — In a stories bundle, a step's `as` sets who is signed in from that step on (an email, or null for nobody) until another step changes it; storyui.ts and the checker carry it forward across later steps.
- **skills/ultrawrite/stories/bundle.ts Page.publish** — A stories page that deploys carries publish {deploy, verify, rollback?}: the sandbox runs deploy after the self-merge, then verify with ULTRA_PUBLISH_URL set, and rollback when verify fails.
- **skills/ultrawrite/stories/bundle.ts Action Card** — A card action's `label` names its control and an input's `x-label` its text box; in a row `${cell}` names a cell of that row and `${col.cell}` a cell of the row column col names, and `control: "checkbox"` draws a checkbox ticked by the table's boolean column. A card's `shows` lists lines its piece draws: `{text, in}` per row of table in, `{text}` on the page with slots from state.values or totals (`${sum t.c}`, `${count t}`, `${count t c=v}`), or `{heading}` (one card at most). `words` maps slot to stored value to the reader's shown words.
- **skills/ultrawrite/stories/bundle.ts Card.concepts** — A stories card can cover several product-map lines: its `concepts` list stands beside or instead of the single `concept`, and conceptsOf merges both without duplicates.
- **skills/ultrawrite/stories/bundle.ts writePageOrder** — skills/ultrawrite/stories/bundle.ts writePageOrder writes client/src/screens/order.json with the pieces in build order (dependencies first, ties in card order), so the TinyApp page reads, for example, party before guests before dishes rather than by file name.

## Gate jev reading

- **skills/ultrawrite/stories/gate_jev.ts** — skills/ultrawrite/stories/gate_jev.ts asks Jev, in one request over the gate reader's diet, whether each Machine clause states a computable fact, whether a probe would catch it false, whether a leg contradicts its cited clause, and (when base is present) whether a base file pins the opposite. The pass/fail verdict is computed from policy.json thresholds, and it is recorded beside the agent reader's verdict: Jev judges alongside and decides nothing.
- **skills/ultrawrite/stories/gate_jev.ts READING** — Which reading gate_jev.ts asks is set by policy.json gate_reading: the caught question's key and whether Jev reads base entries marked own (the task's own Modify:/Delete: files). A missing cell means the 2026-09-29 reading, and each cell reverts independently; an unknown caught key falls back to caught with one stderr line, and each recorded round names the reading asked.
- **skills/ultrawrite/stories/gate_jev.ts record** — record in skills/ultrawrite/stories/gate_jev.ts is the one writer of a task's gate verdict in gate-verdicts.json: it sets {hash, verdict, reason}, the fields plan_check.py reads, and appends the round with Jev's reading beside it, leaving every other key as it was.
- **skills/ultrawrite/stories/gate_jev.ts readings** — The gate-Jev census in skills/ultrawrite/stories/gate_jev.ts (readings) counts each reading (caught question key / own-files setting) separately, because a reworded question is a different question whose agreement cannot be pooled; a round recorded without a reading counts as caught/read.

## Stories plan checks

- **runChecks** — skills/ultrawrite/stories/checks.ts runs the code checks a bundle meets before compile, in two severities: a refusal stops compile, a fact is printed for the author to act on and stops nothing.
- **runChecks** — The sandbox's stories parser reads an id only as S, L or N followed by digits; any other id would compile and then be silently dropped. runChecks in skills/ultrawrite/stories/checks.ts therefore refuses any story, link or number id not of that shape, and any id used twice.
- **runChecks** — compile.ts hands a link step's check to the one link piece (the tool's owner counted) built after all the others. When no piece depends on all the rest, runChecks in skills/ultrawrite/stories/checks.ts reports a fact, since the check then goes to the tool's owner and may run before the other pieces are built.
- **runChecks** — runChecks in skills/ultrawrite/stories/checks.ts requires a card for every concept a subproject builds only when the subproject is not yet built; a change to a built plan carries cards only for what it changes.

## Stories preview

- **sandbox (skills/ultrawrite/stories/preview/page.tsx)** — On the preview's /compare page (skills/ultrawrite/stories/preview/page.tsx) each version gets its own store, filled the same way, so acting in one version leaves the others' rows unchanged.
- **recorded (skills/ultrawrite/stories/preview/page.tsx)** — `arrange.ts --pick` writes the approved screen as a byte copy of the chosen version, so the preview page identifies the recorded pick as the version whose JSON equals the approved spec.
- **kept (skills/ultrawrite/stories/preview/page.tsx)** — When new specs arrive and the versions differ, the preview page drops the pick clicked earlier, since re-arranged versions mean the old click no longer names what is drawn.
- **skills/ultrawrite/stories/preview/probe.ts** — skills/ultrawrite/stories/preview/probe.ts re-exports factory/stack/tinyapp/probe.ts in the repo; preview.ts copies the real probe.ts over it when staging the page inside an app, where the repo path is unreachable. There is one definition of the probe core.

## Stories ui replay

- **skills/ultrawrite/stories/storyui.ts storyUi** — skills/ultrawrite/stories/storyui.ts replays each story through the bundle's store module and writes only the on-screen half: each ui-layer step's gestures (draft boxes typed, then the control that runs its tool, in its row when listed) and what is drawn after it, including elements that left with count 0. Names are read as the browser and checker read them: role and naming props from the app's draws.json, each prop resolved by json-render against the page state.
- **skills/ultrawrite/stories/storyui.ts draftInput** — A TinyApp screen's draft box binds `$bindState` to `/draft/<input>` or `/draft/<tool>.<input>`; skills/ultrawrite/stories/storyui.ts draftInput maps that path back to the tool input it fills, ignoring another tool's qualified draft.
- **skills/ultrawrite/stories/storyui.ts storyUi** — On macOS a temp directory is reached through the /var -> /private/var link, and a store module copied in under the linked path will not import, so skills/ultrawrite/stories/storyui.ts resolves the app directory with realpath first.
- **skills/ultrawrite/stories/storyui.ts storyUi** — skills/ultrawrite/stories/storyui.ts copies the bundle's store.js into the app's client/src and imports it from there, because only inside the app does its `tinybase` import resolve against the app's node_modules; the copy is removed after import.

## Stories compiler

- **skills/ultrawrite/stories/compile.ts probesOf** — skills/ultrawrite/stories/compile.ts compiles a story bundle into a stories-v1 plan by replaying the app's real store module: a probe's given comes from the story's earlier steps, do from the step, and expect from the diff the step made. The app's earlier probes in stories/probes.jsonl from other plans become Guards.
- **skills/ultrawrite/stories/compile.ts probesOf carrier** — In skills/ultrawrite/stories/compile.ts probesOf, a step tied to a link is carried by the link piece (the tool's owner included) that depends on every other linked piece, so its check is built after everything it reads (#1490, #1525); when none qualifies, the tool's owner carries it and runChecks reports that as a fact.
- **skills/ultrawrite/stories/compile.ts main** — skills/ultrawrite/stories/compile.ts copies the bundle's store.js into the app before replaying it; when the compile fails it restores the previous store file (or removes it), so the app's store sha recorded in an existing plan still holds.

## Tinyapp screens

- **skills/ultrawrite/stories/compile.ts PART_FILES** — In a TinyApp, 1st-Pouf is vendored at client/src/pouf/ and never patched. skills/ultrawrite/stories/compile.ts PART_FILES tells builders to add a new screen part in client/src/screens/catalog.ts, registry.tsx and draws.json (#1491), never under client/src/pouf/.
- **skills/ultrawrite/stories/compile.ts compilePlan** — skills/ultrawrite/stories/compile.ts compilePlan has three screen modes: an app holding client/src/screens/catalog.ts gets one json-render spec per piece over that catalog, while an app scaffolded before the catalog keeps plain-DOM .ts screens; with onePage, every piece's builder writes into the single client/src/screen.json. draws lists the roles the app's parts draw (#1491), and a task whose stories expect an undrawn role is told to add a part.
- **skills/ultrawrite/stories/compile.ts main draws** — skills/ultrawrite/stories/compile.ts reads the app's draws.json only when the app holds client/src/screens/catalog.ts; an app scaffolded before the parts list has draws null and its stories' roles are not checked.

## Accessible name parity

- **skills/ultrawrite/stories/preview/names.ts roleOf nameOf** — skills/ultrawrite/stories/preview/names.ts computes an element's accessible role (explicit role, else implicit) and name (aria-label, aria-labelledby, label, content text only for content-named roles, then title) the way the stories and the browser checker name it. Comment mode and story play find elements with it, so a name the preview shows is a name the checker counts.
- **skills/ultrawrite/stories/preview/names.ts FROM_CONTENT** — The checker (factory/stack/tinyapp/browser.ts) counts names from Chrome's accessibility tree, so skills/ultrawrite/stories/preview/names.ts FROM_CONTENT lists exactly the roles Chrome names from their content. Read off Chrome on 2026-11-20 (#1532): listitem, row and every landmark came back unnamed, so they are excluded.

## Card words grammar

- **skills/ultrawrite/stories/arrange.ts wordsOf** — A card control's label is plain text, or inside a row may carry `${cell}` naming a cell of that row and `${col.cell}` naming a cell of the row that column `col` points to (via x-row-of), read by the `lookup` function (#1524) and joined by `format`. wordsOf in skills/ultrawrite/stories/arrange.ts compiles that grammar into json-render expressions.
- **skills/ultrawrite/stories/arrange.ts totalOf** — A page line slot in a card's `shows` is a value name in state.values, `sum <table>.<column>`, `count <table>` or `count <table> <column>=<value>`; totalOf in skills/ultrawrite/stories/arrange.ts compiles each to a json-render state read or computed function.

## Product record

- **skills/ultrawrite/stories/product.ts** — The product record (product.json, product-v1) holds the app's intent, what the operator said and the author assumed, the concepts a successful version needs and the build order. It lives in the bundle while a plan is authored and in the target app at stories/product.json after compile; product.md is rendered from it in the operator's words by skills/ultrawrite/stories/product.ts and is never written by hand.
- **skills/ultrawrite/stories/product.ts renderProduct** — skills/ultrawrite/stories/product.ts renderProduct writes product.md in the operator's words with no ids, statuses, kinds or scores, because the operator adjudicates in plain language and never reads technical fields.

## Story preview

- **preview.ts /specs** — The story preview's /specs (skills/ultrawrite/stories/preview.ts) answers only the one whole-page screen; per-piece screen files left from before the whole-page screen must not be read, and tests/test_preview_server.py plants one to prove it.
- **preview/names.ts** — tests/test_preview_server.py compares the (role, name) counts of preview/names.ts and the checker's Chrome by name only, because Chrome's own role mapping (an img is image, a headerless table is a layout table with no cells) is not what the preview reads.

## Catalog store links

- **skills/ultrawrite/catalog/todo-tags/store.js deleteTodo** — In the todo-tags catalog store (skills/ultrawrite/catalog/todo-tags/store.js), the link "deleting a todo clears its tags" is implemented inside `deleteTodo` in one transaction, because skills/ultrawrite/stories/compile.ts derives a link's probes by replaying the real store module; a link implemented elsewhere would not be derived.

## Jev cli contract

- **skills/ultrawrite/stories/ask.ts** — skills/ultrawrite/stories/ask.ts asks one Jev question from questions.json over state on stdin and prints {"noul": <number|null>}. A failed Jev call prints null and exits 0, so callers read no answer as an absent reading rather than a crash; only bad input (usage, unknown set or question, non-JSON stdin) exits 2.

## Operator notebook

- **skills/ultrawrite/stories/notebook.ts** — The operator notebook is a private file, read at the start of every planning session, that records which words land with the operator. skills/ultrawrite/stories/notebook.ts keeps it outside every repository on purpose, so it is never committed or shipped to a sandbox.

## Plan parser packaging

- **skills/ultrapowers/scripts/plan_parse.py / fleet/compiler.mjs fetchCompilerAt** — fleet/compiler.mjs fetches plan_parse.py alone into a temp directory for a claims-v1 plan and adds stories_parse.py, stories_check.py and probe_block.py only for stories-v1. So plan_parse.py must import the stories modules lazily and parse a claims plan without them; tests/test_stories_parse.py guards this.

## Stories link routing

- **skills/ultrawrite/stories/compile.ts link routing** — The stories compiler (skills/ultrawrite/stories/compile.ts) sends a link's check to the piece that depends on all the other linked pieces; the potluck app's shape, a board piece depending on both todo and tag, is a case it must route correctly.

## Story preview play

- **skills/ultrawrite/stories/preview/play.ts inTurn** — In skills/ultrawrite/stories/preview/play.ts, inTurn queues story plays so each starts only after every earlier one ends, whatever its outcome, because each play clears and refills the single shared store and two overlapping plays would corrupt each other.
- **fill / play** — The preview's replay (skills/ultrawrite/stories/preview/page.tsx `fill`, preview/play.ts `play`) runs each story step's tool and ignores one that throws: a step the tool refuses is skipped and the replay goes on, so one bad step never blanks the preview.

## Tinyapp scaffold

- **skills/ultrawrite/stories/scaffold.ts** — skills/ultrawrite/stories/scaffold.ts writes the starting app for a stories-v1 launch: the TinyApp template, the bundle's store at client/src/store.js and a client/src/screen.json holding an empty column that runs no action, so the screens check stays red until a builder writes the screen. It refuses a target directory holding anything but .git.

## Tinyapp screen parts

- **skills/ultrawrite/stories/parts.ts undrawn** — Each part in a TinyApp's client/src/screens/draws.json names the accessibility role it draws and the props that name it (#1491). skills/ultrawrite/stories/parts.ts finds roles a story expects to see that no part draws; the planning checks report them and the compiler writes the need into the task that requires it, so a builder adds the part in the open rather than the story silently failing.

## Tinyapp store tools

- **skills/ultrawrite/catalog/todo/store.js TOOLS** — A catalog piece's store module (skills/ultrawrite/catalog/todo/store.js) exposes every action as a WebMCP-shaped tool: name, owning piece, plain description, typed input schema, and run(store, args) returning true when it changed the store. The schema sets no defaults, so a todo never ticked has no completed cell, which state probes rely on.
