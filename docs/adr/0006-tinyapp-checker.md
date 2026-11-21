# 0006. The TinyApp checker

Status: accepted (2026-11-21)  
Governs: `evals/readings/checker_kit.py`, `factory/stack/tinyapp/browser.ts`, `factory/stack/tinyapp/celld.ts`, `factory/stack/tinyapp/check.ts`, `factory/stack/tinyapp/probe.ts`, `factory/stack/tinyapp/screens.ts`

Recovered from the code comments removed by `/delete-comment` on 2026-11-21: each entry is a
decision the code cannot show on its own. Symbols are named; line numbers are not.

## Tinyapp browser cdp

- **factory/stack/tinyapp/browser.ts** — factory/stack/tinyapp/browser.ts drives the machine's own Chromium over the DevTools protocol directly, with no client library: a CDP connection is a WebSocket of {id, method, params, sessionId} messages and Bun ships both spawn and WebSocket. The headless shell is started with --remote-debugging-port=0 and its chosen port is read from the 'DevTools listening on ws://' stderr line, because Bun cannot hand a child extra pipes and port 0 lets two exams run side by side. No request leaves the machine: every request is paused through the Fetch domain and continued only for the page's own loopback origin, since a blanket block would refuse the page's own document; the page bundles its font so it dials nothing else.
- **DEVTOOLS_TIMEOUT_MS** — In factory/stack/tinyapp/browser.ts, DEVTOOLS_TIMEOUT_MS is 15 seconds although the headless shell's DevTools line was measured to arrive in about 100 ms; the value is a give-up point, not an expected wait.
- **Browser.openUrl** — Browser.openUrl in factory/stack/tinyapp/browser.ts refuses every request except to the page's origin or an origin listed in allow; allow exists so a convergence exam can reach a second loopback origin (the sync runtime) without lifting the block, each entry judged by the same prefix rule. It resolves as soon as navigation is under way, not on a load event, because the target page redirects on its first document and callers poll the page for their own readiness signal.
- **devtoolsUrl** — devtoolsUrl in factory/stack/tinyapp/browser.ts keeps reading and discarding the headless shell's stderr after it finds the DevTools line, because a child process blocks once its stderr pipe fills; the drain runs for the life of the process.
- **nodeFor** — nodeFor in factory/stack/tinyapp/browser.ts locates elements with Accessibility.queryAXTree by computed role and accessible name, because the accessible name is the browser's own computation (label for, aria-label, placeholder) that no CSS selector can reach. Accessibility.enable is idempotent and cheap, so it is called on every lookup instead of being tracked.
- **centreOf** — centreOf in factory/stack/tinyapp/browser.ts reports a node with a zero-width or zero-height content box as having no centre, because a mouse event aimed at a degenerate box (e.g. an unstyled span role=checkbox) lands on whatever is painted underneath, such as body. For such nodes act calls the element's own click() in the page (clickInPage) instead of dispatching mouse events.
- **clickNode** — clickNode in factory/stack/tinyapp/browser.ts calls DOM.scrollIntoViewIfNeeded before dispatching mouse events, because a mouse event aimed at a box outside the viewport lands on nothing.
- **optionFor** — optionFor in factory/stack/tinyapp/browser.ts skips accessibility nodes marked ignored when looking for an option, because a picker component may keep a hidden native select whose options carry the same names as the visible ones.
- **Page.act select** — The select action in factory/stack/tinyapp/browser.ts presses the combobox with a mouse press and polls for the option up to SELECT_OPEN_MS, because a Radix Select opens on pointerdown, picks on pointerup and renders its listbox in a portal a frame or more after the press. If the mouse does not open it, an ArrowDown key press is tried.
- **Page.act select** — After picking an option, the select action in factory/stack/tinyapp/browser.ts waits until no listbox remains in the accessibility tree, because Radix hides the rest of the page from the tree while its listbox is open; the next read then sees the screen as a person does after the pick.
- **Page.act key** — The key action in factory/stack/tinyapp/browser.ts sends Enter with text '\r' and windowsVirtualKeyCode 13, because a page's keypress handlers and a form's implicit submission read that text, not the key name.
- **launchBrowser** — launchBrowser in factory/stack/tinyapp/browser.ts rejects a missing binary before spawning anything, so nothing is left running. It passes no --no-sandbox because the default sandbox works on the fleet image; machines that need extra flags (a laptop, a container without user namespaces) add them via the space-separated TINYAPP_BROWSER_ARGS environment variable.
- **Browser.openUrl** — openUrl in factory/stack/tinyapp/browser.ts enables Fetch interception for every URL and continues only requests to the origin or allow-listed origins, failing the rest with BlockedByClient, because a page served from an origin cannot have all requests blocked the way a data: page can: its own document is a request.
- **Browser.close** — Browser.close in factory/stack/tinyapp/browser.ts sends a CDP Browser.close and waits up to EXIT_GRACE_MS before killing the process, so the headless shell takes its own child processes down with it.
- **factory/stack/tinyapp/browser.ts** — Borrowed from popmechanic/tinyapp-fixture `packages/tinyapp-exam/src/browser.ts` at d71c037 (2026-09-27), with its two sibling imports inlined; a fix upstream is not picked up automatically.

## Tinyapp state probe

- **factory/stack/tinyapp/check.ts** — factory/stack/tinyapp/check.ts proves one story step against one copy of a TinyApp: it builds the page, serves it on loopback, starts celld on a temp copy of the server, sets the scene through the page's own actions, refuses a step whose ending already holds (hollow), does the step by role and name, checks store and screen, then restarts celld and reads the store back in a fresh browser to prove persistence. Its exit code is the contract: 0 pass, 1 a finding about the app, 2 could not run.
- **factory/stack/tinyapp/check.ts aborted/starting/own** — When factory/stack/tinyapp/check.ts passes its budget, main stops waiting but the run keeps going, so the `aborted` flag forbids any new start and every in-flight start (tracked in `starting` by `own`) is awaited and owned before cleanup. This guarantees no celld or browser outlives the check.
- **factory/stack/tinyapp/check.ts build** — factory/stack/tinyapp/check.ts builds the page with an asynchronous Bun.spawn rather than spawnSync, because a synchronous build would block the event loop and the budget timer could not fire to stop a hung build.
- **factory/stack/tinyapp/check.ts run (celld restart)** — In factory/stack/tinyapp/check.ts the first celld's cleanup stays registered after the restart: stopping an already stopped celld is a no-op, and the restarted celld's cleanup runs first (cleanups pop in reverse) and removes the shared data directory. Removing the first registration would not be safer, only redundant.
- **factory/stack/tinyapp/check.ts main stopWith** — The Flock runs each fact with spawnSync and a timeout (policy `exam.fact_timeout_seconds`, 60 s by default), which kills with SIGTERM. factory/stack/tinyapp/check.ts therefore treats SIGTERM/SIGINT exactly like its own budget timeout: it marks the run aborted so in-flight starts are owned before cleanup, and answers an exit-2 could-not-run result, never leaving a celld or browser behind.
- **factory/stack/tinyapp/check.ts main** — After an abort, factory/stack/tinyapp/check.ts waits for every in-flight start to settle before cleanup so it can own and stop it; the wait is bounded because each start is itself limited by the budget (readyMs) or a fixed launch timeout.

## State probe semantics

- **factory/stack/tinyapp/probe.ts checksFor / holds** — factory/stack/tinyapp/probe.ts is the single definition of stories-v1 state-probe semantics: closed checks over TinyBase [tables, values] content with row ids matched by creation order. The compiler (skills/ultrawrite/stories/compile.ts) derives probes with checksFor and the sandbox checker decides them with holds, so authoring and proof can never disagree on what a probe means.
- **factory/stack/tinyapp/probe.ts ToolCall.as** — In a stories-v1 probe (factory/stack/tinyapp/probe.ts ToolCall), `as` names who is signed in from that call on: an email, or null for nobody. When `as` is absent the page's own sign-in stands, so absent and null mean different things.
- **factory/stack/tinyapp/probe.ts checksFor** — factory/stack/tinyapp/probe.ts checksFor emits closed checks for exactly the rows, cells and values a step changed, never a whole-table equality, so a cell another piece adds later does not break an earlier piece's probe. A step that changes nothing yields [{unchanged: true}].

## Tinyapp checker

- **celld.ts** — factory/stack/tinyapp/celld.ts starts one celld per check on a temporary copy of the app's server/, so nothing is written inside the builder's copy. A restart with clean: false reloads the Durable Object's SQLite from the same temp dir, which is how the checker proves data is saved.
- **startCelld readiness** — celld.ts in factory/stack/tinyapp treats a server as ready when /health answers {"ok":true} (packed apps) or when / answers text containing "tinyapp root" (older apps, still used by evals/fixtures/tinyapp-todo).

## Tinyapp screen state

- **factory/stack/tinyapp/screens.ts DEFAULT_PATH** — factory/stack/tinyapp/screens.ts DEFAULT_PATH records where json-render's ActionProvider writes a built-in action that names no statePath (validateForm writes /formValidation), so the checker can flag such actions as writing outside /draft/.
- **factory/stack/tinyapp/screens.ts bindings** — Screens may write only under /draft/. factory/stack/tinyapp/screens.ts bindings flags a $bindState outside /draft/ and every $bindItem, because $bindItem writes the repeated saved row itself and so can never be a draft write.

## Checker kit reading

- **evals/readings/checker_kit.py** — evals/readings/checker_kit.py scores the TinyApp state-probe checker against a good todo app and broken copies; it is not a test and nothing runs it automatically because it needs bun, celld and a browser (TINYAPP_BROWSER, /headless-shell or the Mac's Chrome). It is run by hand whenever factory/stack/tinyapp/ changes and exits 0 only when every case lands as expected.

## Tinyapp checkers

- **factory/stack/tinyapp/screens.ts main** — factory/stack/tinyapp/screens.ts checks a TinyApp copy's screens without a browser: it imports the copy's catalog and store modules in Bun and validates client/src/screen.json (or, for apps built before it, client/src/pieces/<piece>.json) against the catalog and the plan's card actions. It writes nothing and exits 0 on pass, 1 on findings about the app, 2 when it could not run, which callers read as distinct outcomes.

## Tinyapp screen contract

- **Page.count** — Chrome gives a run of text no accessibility role or name, so Page.count in factory/stack/tinyapp/browser.ts counts role 'text' in the page itself: elements inside #app marked data-part="text" whose whitespace-collapsed text equals the name. The TinyApp template's registry marks only reading parts with data-part="text", so this attribute is a contract between the template, the checker and the preview.

## Tinyapp screen parts

- **factory/stack/tinyapp/screens.ts checkParts** — factory/stack/tinyapp/screens.ts checkParts requires every catalog part to have a line in client/src/screens/draws.json (the role it draws and the props that name it) and every line to have a part (#1491), and checks that client/src/pouf/ matches its sha256 pins byte for byte. A part added during a run must wrap 1st-Pouf in client/src/screens/ rather than patch it; apps scaffolded before draws.json are checked for the pin only.
