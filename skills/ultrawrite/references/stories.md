<!-- Moved out of ultrawrite's SKILL.md to keep it under 500 lines. Commands here name the
     plugin directory as `<plugin-root>`; SKILL.md shows its real path. -->

## Story planning — TinyApp targets (`stories-v1`)

A TinyApp plan is not written; it is compiled from a bundle the author drafts
after enriching the ask with the operator, who then signs it in one question. Specs:
`docs/superpowers/specs/2026-09-28-coarse-input-planning-design.md` and
`docs/superpowers/specs/2026-09-28-enrich-the-ask-design.md`. Before signing,
the operator sees each piece's real screen, picks one of Jev's versions of it,
pins notes on it, and watches each story play on it; the real app is judged
again at the PR smoke.

1. **Read the notebook first:** `bun <plugin-root>/skills/ultrawrite/stories/notebook.ts show`.
   Use its words; avoid its failed ones.
2. **Take the ask as it comes**, in any form. Save it verbatim to `<bundle>/ask.txt`.
   The ask file holds only the operator's own words for this plan: never notes, earlier picks or the author's lines, because Jev reads every sentence in it.
3. **Enrich the ask — every plan, never skipped:** follow
   `skills/ultrawrite/references/enrich.md` (intent, understanding, the whole
   product's map, the build order) into `<bundle>/product.json`. Draft no story
   until the operator has confirmed which plan comes first. A small, clear ask
   passes through quickly; it still gets the understanding and a one-line map.
4. **Draft the bundle for that plan**, starting from `skills/ultrawrite/catalog/<piece>/`
   wherever one fits:
   - `page.json`: its title, kind, three summary sentences, `subproject`, links as
     sentences (run inside the trigger's `store.transaction`), numbers, and stories,
     each with its `steps`. A step is `{tool, args, layer}` (`store`, `ui` or
     `saved`); a `ui` step adds `ui` (click/type/key by role and name) and `see`.
     The accessible names you choose are the builder's contract. A step's
     `"as": "<email>"` (or `null`) sets who is signed in from that step on.
   - To deploy when the run lands, `page.json` carries `publish`: `{"deploy": "bun install && bun run deploy", "verify": "curl -fsS \"$ULTRA_PUBLISH_URL/health\""}` (`server/wrangler.jsonc` names the Worker; the account is a `CLOUDFLARE_ACCOUNT_ID=` prefix in the app's `deploy` script, since celld refuses `account_id` in the config; see `references/greenfield-stack.md`).
   - `cards.json`, each card with its `concept`, or several with `concepts`: one per
     map line its screen covers.
   - `store.js` exports `TOOLS` and `makeStore`.
5. **Write the stories the coverage rule requires**, not ones you invent:
   - every card's main story
   - one story per refusal, ending in a `ui` step with `"refused": "<the refusal sentence>"`
   - one story per link

   A step's `see` names only text its own piece, or a piece it depends on, draws:
   on potluck run-1 (2026-10-01) S3's `see` read the answer piece's text from a
   guest step, and the guest builder drew it too. A link story's check goes to the
   piece of its link, the tool's owner included, that depends on every other one
   (#1490, #1525), so it may read the text of any piece in the link; with no such
   piece it goes to the tool's owner and reads only that piece's text.

   The only alternative to a refusal story is a waiver
   `{piece, action, refuses, arg, "reason": "unreachable-from-screen"}`, where `arg`
   is a row id the screen can't invent. The operator never sees waivers; they
   appear on the PR card.
6. **Run the checks before they see anything:**
   `bun <plugin-root>/skills/ultrawrite/stories/jev_checks.ts <bundle>`.
   - Fix every code refusal.
   - Act on every `JEV flag` yourself.
   - `DOUBT:` lines (at most three, highest first) go into the sign question.
7. **See it — the real screen, before signing:**
   1. Scaffold into a scratch app and `bun install` there:
      `bun <plugin-root>/skills/ultrawrite/stories/scaffold.ts <bundle> <scratch>/app`.
   2. `bun <plugin-root>/skills/ultrawrite/stories/arrange.ts <bundle> --app <scratch>/app` has
      Jev arrange each piece's screen into versions A, B and C at
      `<bundle>/screens/<piece>.<V>.json`. Jev only chooses and places the
      bundle's own controls and text (under a second per run on the todo bundle,
      n=5 runs, 2026-10-01).
   3. Start `bun <plugin-root>/skills/ultrawrite/stories/preview.ts <bundle> --app <scratch>/app`
      in the background from the session's working directory and open the URL its
      first line prints in the Browser pane (the Desktop Code tab). Elsewhere, in
      a terminal, open the `/compare` address in the default browser:
      `open <url>compare` on macOS or `xdg-open <url>compare` on Linux, where
      `<url>` is the printed address ending in `/`. Its `/compare` page shows the
      versions side by side, each with a Choose button.
   4. When the intent tray is installed, call its `show_screen` tool
      (`mcp__ultrapowers__show_screen`, `name` the app's title, `versions` the
      letters, `url` the preview's `/compare` address) so the tray's **Open
      screen** button runs the same open command and the operator picks and
      sends notes from the tray; otherwise ask
      the pick as one AskUserQuestion with a screenshot of `/compare`.
   5. Record the pick with `arrange.ts <bundle> --app <scratch>/app --piece <p> --pick <V>`:
      it writes the approved screen, `<bundle>/screens/<piece>.json`, and the
      page redraws in place.
   6. The operator pins notes in Comment mode: a floating Comment button; click
      one element or drag a box, type a note, and a numbered pin stays (About
      this view covers the whole screen). Notes reach
      `.ultrapowers/feedback.jsonl` and the tray. Apply them with
      `arrange.ts <bundle> --app <scratch>/app --piece <p> --reshape --note '<target>: <note>' …`.
      A note the composer cannot satisfy is yours to apply by hand to the spec;
      then `bun factory/stack/tinyapp/screens.ts --bundle <bundle> --copy <scratch>/app`
      re-checks it.
   7. Play each story on the approved screen while the operator watches:
      `curl -s 'http://127.0.0.1:<port>/play?story=<id>'` answers
      `{"story","ok","misses"}`. Fix a miss before signing. `/play` needs the preview's `/` page
      open (the single screen): the `/compare` page never plays a story, and
      the server then answers at once with the page to open.

   Compile later copies each approved screen into the app as the builder's
   starting spec.
8. **Touch 1, sign:** render `product.md`
   (`bun <plugin-root>/skills/ultrawrite/stories/product.ts render <bundle>/product.json --bundle <bundle> --out <bundle>/product.md`)
   and ask one AskUserQuestion call:
   - The first question is this plan's stories as numbered sentences, with the
     product's first line, the build order and the approved screen. Its options
     are *Sign (Recommended)*, *Fix a line* and *Please explain*.
   - Up to three more questions come from the `DOUBT:` lines, each a concrete
     product choice.

   A fixed line is the new sentence. Re-ask only if a check changed.
9. **Make the target app:**
   1. `bun <plugin-root>/skills/ultrawrite/stories/scaffold.ts <bundle> <checkout>`
   2. `bun install` in the checkout
   3. Compile: `bun <plugin-root>/skills/ultrawrite/stories/compile.ts <bundle> --app <checkout>
      --plan-id <id> --date <YYYY-MM-DD> --out <checkout>/.ultrapowers/plan.md`.
      Compile also writes `stories/product.json` and `.ultrapowers/product.md`.
   4. `python3 <plugin-root>/skills/ultrapowers/scripts/plan_check.py --base <sha>
      <checkout>/.ultrapowers/plan.md` to `PLAN OK`
   5. Before launching, play every story's last step on the checkout with the
      fleet's own checker:
      `bun factory/stack/tinyapp/check.ts --plan <checkout>/.ultrapowers/plan.md --clause <S#.#> --copy <checkout>`
      (about 10 s each). When every one exits 0, the approved screens and the
      bundle's store already make the app: commit the checkout as the result,
      launch nothing, and go to touch 2. Shopping-list run-1 (2026-10-01) is the
      case: the fleet built nothing, and the engine now ends such a run as done,
      with nothing to build. When any exits 1, launch the plan.
10. **Touch 2 is the real app at the PR smoke.** Anything wrong is one line in chat
    and becomes the next ask, which starts at `enrich.md`'s "A later plan for the
    same product".
11. **Write the notebook:** one `add` line per *Please explain* or fixed word, and
    `notebook.ts log <plan-id> --rounds … --explains … --fixes …`.
