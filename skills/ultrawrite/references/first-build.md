<!-- Commands here name the plugin directory as `<plugin-root>`; SKILL.md shows its real path. -->

# A new app's first build — one author

Follow this when `bun <plugin-root>/skills/ultrawrite/stories/product.ts route <dir>/product.json`
prints `ROUTE fact: first build, one author`. The first version of a new app is one
claims-v1 task for one builder, written from the operator's ask and the app's rules, on a
repository that is empty but for the README, the record and the placed theme.

**Why (an `experiment`).** On 2026-11-24 one author and three builders in shared files each
built Potluck from the same ask, empty repository and probes (popmechanic-potluck-3 run-1 and
run-2, n=1 run per arm). In a blind smoke test the operator judged the one-author app entirely
superior, and both better than the stories-pipeline Potluck of 2026-11-20. Its rollback is a
checkout of `dd53be04`, from before the stories route was retired
(`docs/adr/0018-stories-route-retired.md`).

**Why UI SDK and a theme (an `experiment`).** On 2026-11-25 a spike built one page three ways,
bare, on stock UI SDK and on Pouf-themed UI SDK (n=1 run per arm); blind, the operator ranked
the Pouf-themed page first, the stock one second and the bare one third. So every first build
is handed UI SDK, pinned, and a theme in its first commit, and is made to use neither
(`docs/adr/0019-tinyapp-themes.md`). Its rollback is the one the `ui` cell of
`skills/ultrawrite/stories/policy.json` states: handed nothing: this recipe's Context without
the UI paragraph, and no place step.

## The steps

1. **Enrich the ask** as `references/enrich.md` says, through the understanding, the map and
   the build order.
2. **Write the app's rules** off the understanding's product assumptions, one sentence each
   ("only a guest who said yes can bring a dish"). These are what the probes prove.
3. **Fix three names**, and only these, so probes can call the app without choosing its design:
   - a rules module (`src/<app>.ts`) whose exported functions you spell out with their
     arguments and results, including one `view(store)` that returns everything the page shows;
   - `client/src/app.tsx` exporting `App`, a React component taking `{store}` and drawing the
     whole page from it;
   - a `dev` script in `package.json` that serves the page, and the sync it needs, on
     `0.0.0.0` at the port in `PORT`.
4. **Place the theme** in a clone of the target, before the plan is written, since the plan
   lists what it writes. Run `bun install` in `<plugin-root>/skills/ultrawrite/themes` once,
   then `bun <plugin-root>/skills/ultrawrite/themes/place.ts --theme <theme> --app <clone>`,
   where `<theme>` is the record's `intent.theme`, else the `ui` cell's `theme`. It refuses a
   theme that fails `check.ts` and writes nothing then; otherwise it writes
   `client/src/theme/` (`structure.css`, `<name>/` and `theme.json`) and prints the
   `- Modify:` lines after `PLACED <name>`, the folder name the rest of this recipe calls
   `<name>`. Keep those lines for step 5's Files.
5. **Write the plan**, claims-v1, one task (the task shape is `SKILL.md`'s):
   - **Claim:** the operator's do-and-see sentence, confirmed with the three-sentence summary
     in one touch.
   - **Files:** `package.json`, `tsconfig.json`, the rules module, `client/src/app.tsx`, and
     the placed theme's files as `place.ts` printed them (step 4), under `Modify:`.
   - **Context** carries, in this order: the ask's summary and the rules; the sentence
     *A person who has never seen the page should be able to use it without instructions:
     what is saved is always visible, and the next thing to do is obvious.*; the stack (Bun,
     TypeScript, React, one TinyBase `MergeableStore` synced over a `WsSynchronizer` to a
     Durable Object with a SQLite persister; `celld` is on the sandbox's PATH); the UI
     paragraph below; that the repository starts empty but for the README, the record and the
     theme, and its layout beyond the three names is the builder's; the three names; and
     *You are the only author: how the page reads to a person, its order, its words and what
     it shows, is yours to design.*
   - **The UI paragraph**, with `<version>` the `sdk` of the `ui` cell in
     `skills/ultrawrite/stories/policy.json` and `<name>` the theme step 4 placed:

     > Declare `@ui-sdk/react` and `@ui-sdk/core` in `package.json`'s `dependencies`, not
     > `devDependencies`, at exactly `<version>`; a probe checks that pin. UI SDK is a library
     > of UI behaviours (keyboard, focus, selection, popups, the ARIA they need) with unstyled
     > React components built from them. Its guide is at
     > `node_modules/@ui-sdk/core/skills/ui-sdk/SKILL.md` once installed; where it tells you to
     > write tests, do not: this plan's probes are the proof. A theme named `<name>` is in
     > `client/src/theme/<name>/`; read its `README.md` first. It replaces UI SDK's own
     > `web.css`. The page has no CSS pipeline: stylesheets are read as text and inlined, as
     > the README shows. Using the components and the theme, restyling them, adding to them,
     > or not using them is your call: the page is yours. Nothing checks that you used them.
   - **Global Constraints:** the check line below, the stack, and what the app must not do.
6. **Write the proof** (next section), rehearse it, run the gate, and check the plan as for
   any claims-v1 plan.
7. **Record the plan as built by one author** and put the record in the app:
   `bun <plugin-root>/skills/ultrawrite/stories/product.ts built <dir>/product.json --plan <plan id>`,
   then copy it to `stories/product.json` in the target's first commit, beside the README. A
   later plan finds it there (`enrich.md`, "A later plan for the same product") and
   `product.ts route` then answers `later plan, claims`. The record is written before the
   run, so it says built from then on: when a first build drafts and is planned again, run
   `built` with the new plan id (the old id moves to the plan's `history`) and keep following
   this recipe, whatever the route line says, until a first build has merged.
8. **Launch held** (`--hold`) on that repository: one commit holding the README,
   `stories/product.json` and `client/src/theme/`. Keep the plan itself in an untracked folder
   of the clone (`plans/`, named in `.git/info/exclude`), since `plan_check.py` reads the plan
   from inside the target's checkout. The routing rule reads a one-task plan as inline; a
   first build goes to the fleet anyway, for the sandbox, the proof and the pull request.
9. **Touch 2 is the real app.** Serve it from the run's sandbox (`bun run dev` as a user unit,
   `ssh exe.dev share port <vm> <port>`). A draft whose only red probe is the serve probe is
   still worth serving: read the red before judging the app.
10. **Walk it before the operator does** (`## The walk`), then give them the link with the
   walk's answers in the message.

## The proof

Every probe is one `Run:` line ending in its clause tag, and begins with `bun install` (all
but the version probe below), because an empty base installs nothing before the builder
opens (popmechanic-potluck-3, 2026-11-24; runroom-ab run-3). For the same reason the plan's
check is exactly:

```
- Check: bun install && bunx tsc --noEmit
```

Write no `bun test` into it: the builder writes no tests, and `bun test` with none exits 1.
A file the app's `.gitignore` covers never reaches the copy the probes and the check run on,
so nothing they need may be an ignored file: a generated source is either tracked or built by
the command that needs it.

- **One probe per rule**, calling the rules module under `bun -e` and exiting non-zero when
  the rule does not hold. Seed the store through the module's own functions, act, then read
  `view(store)`. A rule about what must not happen asserts both the refusal and that nothing
  changed.
- **One page probe:** seed a store, render `App` to HTML with `renderToString`, and require
  every seeded name and one computed total. Choose the seed so that total differs from every
  other number in it, or a page that shows the wrong sum still passes.
- **One serve probe**, verbatim apart from the clause tag. It starts the app as the leader of
  its own process group and stops the whole group, because a `dev` script usually starts the
  server one level down, and stopping only the script leaves that server running (reproduced
  2026-11-24):

```
- Run: test -f package.json && bun install >/dev/null 2>&1 && P=$(bun -e "const s=Bun.serve({port:0,fetch:()=>new Response('')});console.log(s.port);s.stop()") && ( (PORT=$P python3 -c "import os,sys; os.getpgrp()==os.getpid() or os.setsid(); os.execvp(sys.argv[1], sys.argv[1:])" bun run dev >/dev/null 2>&1 & echo $! >/tmp/app-$P.pid) ) && ok=1 && for i in $(seq 25); do curl -sf http://127.0.0.1:$P/ | grep -qi '<html' && ok=0 && break; sleep 1; done; kill -- -"$(cat /tmp/app-$P.pid 2>/dev/null)" 2>/dev/null; test "$ok" = 0 [M6]
```

- **One version probe** for the plan's one clause about the pin, such as *The app declares
  UI SDK at exactly the pinned version*. It is verbatim apart from that clause's tag and the
  version, which is the `ui` cell's `sdk`, and it reads `dependencies` only. It reads
  `package.json` alone, so it is the one probe that does not begin with `bun install`;
  nothing probes that the page uses the library or the theme:

```
- Run: test -f package.json && bun -e "const d=require('./package.json').dependencies||{};process.exit(d['@ui-sdk/react']==='0.1.0-beta.17'&&d['@ui-sdk/core']==='0.1.0-beta.17'?0:1)" [M7]
```

**Rehearse before the gate.** Write a throwaway stub that satisfies the three names (a few
lines each) and declares the two pinned packages, run every probe and the check against it,
and delete it. A probe that cannot pass on a stub cannot pass on the app.

**What the proof does not cover.** It shows the rules hold, the page shows what is saved and
the app starts. It does not show that two browsers sync or that the flow makes sense to a
person. The walk looks at that first; the operator's smoke is the verdict.

## The walk

A report for the operator, never a gate: nothing in a run, a check or the launcher reads it.

1. List the six questions: `bun <plugin-root>/skills/ultrawrite/stories/walk.ts questions`.
2. Open the served app in your own browser (an ssh tunnel to the sandbox's port works where
   the private link does not) and use it as a first-time user, doing each thing the Claim
   names. Look at the page, not only its text: a screenshot shows whether it is bare. With
   the page open, run these two in the browser's developer console. The first prints the
   bytes of script the page loaded, fetched and inline, uncompressed; the second puts every
   UI SDK slot on the page on the clipboard as a JSON list (`copy` is the console's own):

   ```
   performance.getEntriesByType('resource').filter(r=>r.initiatorType==='script').reduce((n,r)=>n+r.decodedBodySize,0)+[...document.scripts].filter(s=>!s.src).reduce((n,s)=>n+new Blob([s.text]).size,0)
   copy(JSON.stringify([...new Set([...document.querySelectorAll('[data-slot]')].map(e=>e.dataset.slot))].sort()))
   ```
3. Write `<plan-stem>.walk.json` beside the plan: `app`, `run` (the evidence tag),
   `answers`, a map from each question id to `answer` (`yes`, `partly` or `no`) and one
   sentence of `evidence` naming what you saw, the first console result as `script_bytes`
   (a number) and the clipboard, pasted as it is, as `slots` (a list).
4. `bun <plugin-root>/skills/ultrawrite/stories/walk.ts render <plan-stem>.walk.json` refuses
   an incomplete walk and prints the block, with the script size and the slots. Then, from
   the app's checkout,
   `bun <plugin-root>/skills/ultrawrite/themes/check.ts client/src/theme/<name> --slots <plan-stem>.walk.json`
   (the app's own copy of the theme, given as a path) lists the slots on the page the theme
   has no rule for. It exits 0 whatever it lists when the walk file has a `slots` list, and
   2 when it has none. Add its lines under the block, and post the two as one comment on the
   run's pull request (`gh pr comment <url> --body-file -`).
5. Reset the app's saved state so the operator starts empty, then send the link.
6. When the operator has judged the app, record whether their smoke matched the walk:
   `walk.ts verdict <plan-stem>.walk.json --operator agree|disagree [--note <text>]`.

An `experiment` (#1609): on 2026-11-24 the six questions separated the two Potluck apps by
hand (n=1 walk per app). The walk stays on the laptop until it and the operator have agreed
on n=5 runs, counted by `walk.ts agreement docs/superpowers/plans`; its rollback is skipping
this section.

## A later plan

When `product.ts route` prints `ROUTE fact: later plan, claims`, plan the change as an
ordinary claims-v1 plan on an existing codebase, as `SKILL.md` says: enrich from the app's `stories/product.json`, sign the
Claim, write tasks with probes in the same three shapes (a rule through the rules module, the
page rendered from a seeded store, the app served), run the gate and the walk. A change that
redesigns how the page reads is one task (`decomposition.md`, "Split by default"). When the
plan is written, mark its plan built with `product.ts built` and commit the updated
`stories/product.json` to the app's main yourself before the launch: a builder never sees the
record, so it is not one of the run's Files.

## A worked plan

`plan.md` at the evidence tag `popmechanic-potluck-3/run-1`: the Potluck first build, six
probes, one task.
