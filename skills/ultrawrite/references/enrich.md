# Enrich the ask

Every TinyApp plan starts here. The operator's words are coarse on purpose; this
stage turns them into a product record (`<bundle>/product.json`) the rest of the
pipeline verifies. No story is drafted until stage 4 is confirmed. Spec:
`docs/superpowers/specs/2026-09-28-enrich-the-ask-design.md`.

## The one rule for the operator

The operator decides what the app does, who uses it and how it looks. Before any
question or page reaches them, check it against that sentence; if it fails, you
decide it and record it. They never see: kind, concept, sub-project, card, piece,
probe, waiver, ids, statuses or Jev scores. Every question is one AskUserQuestion
with (Recommended) and *Please explain*, and opens by naming what it touches
("This is about the radio app…").

## A later plan for the same product

If the target app has `stories/product.json`, copy it into the bundle and start at
stage 4: the map and the understanding are already signed. Add to the map only
what the new ask brings (stage 3 for those concepts alone). Pass the new ask with
`--ask-file` to the bundle stage; Jev reads its sentences because they are new.
The ask file holds only the operator's own words for this plan: never notes, earlier picks or the author's lines, because Jev reads every sentence in it.

**A change to something already built** (touch 2 said "delete should ask first"):
name the built plan that owns it as `page.json`'s `subproject`, and carry cards
only for the concepts the change touches. Compile keeps the plan's earlier plan
ids in its `history`.

## 1. Intent

Ask, one question at a time, until you can write three things: who uses it
(`audience`), the three-sentence summary (what it is, why it exists, how it is
used), and what would make the operator call it a success (`success`). Offer
concrete readings as options, not open questions. Classify `kind` yourself.

## 2. Understanding

Write `understanding`: the ask verbatim, what they said, what you assume, what you
are unsure of. Mark each assumption `about: product` (what it does, who uses it,
how it looks) or `about: technical`; decide the technical ones yourself
(`state: decided, by: author`). Run:

    bun skills/ultrawrite/stories/jev_checks.ts <bundle> --stage understanding

Show the operator what they said and the product assumptions only, in one
question: "Here is what I understood — correct anything, or say yes." Every
`DOUBT:` line becomes a concrete choice inside that question or the next.

## 3. Map the whole product

List everything a successful version of this product, for this audience, needs —
especially what the ask never said. Think in the audience's day: what each kind of
user comes to do, what keeps them coming back, what the people running it need,
what could go wrong. Each concept is one purpose, written as something a person
does or sees ("Listeners see what is on air right now"), under a plain heading
(`part`). Never list plumbing (sync, storage, login mechanics); a product decision
such as "who may edit a show page" is listed, in those words. Run:

    bun skills/ultrawrite/stories/jev_checks.ts <bundle> --stage map

Split any concept flagged as two needs. Then
ask which belong in the **First version**: one multi-select question per heading,
at most three things per question (the fourth option is *Please explain*), at most
four questions per call, and as many calls as the map needs, headings with the
most First-version recommendations first. Jev's `recommend` lines set
(Recommended). A heading with more than three things is split into two questions
("Back office, 1 of 2"). Unticked
ones become **Later** unless flagged "may not serve what the product is for", which
you offer as **Not doing**. Record the answer as `status` (keep / defer / cut) and
run `bun skills/ultrawrite/stories/product.ts record <bundle>/product.json`.

## 4. The order we build it in

Group the First version into plans, each usable and judgeable on its own, in the
order they must be built, each with a plain `reason`. Run:

    bun skills/ultrawrite/stories/jev_checks.ts <bundle> --stage decompose

Regroup any plan flagged "may not be usable on its own". Ask the operator in one
question: "We build X first, then Y, then Z, because …; start with X?" Mark the
chosen one `next`, the rest `planned`. `bun skills/ultrawrite/stories/product.ts
check <bundle>/product.json` must print `PRODUCT OK`.

## How it looks

"How it looks", the third of the operator's three decisions, is never asked in
words during enrichment. It is answered on the real screen: Jev arranges each
piece's screen into versions (`bun skills/ultrawrite/stories/arrange.ts`), the
operator picks one in the Browser pane and pins notes on it in Comment mode
(SKILL.md, Story planning, the See it step).

## Then

Draft the bundle for the `next` plan only (SKILL.md, Story planning, steps 4–8):
cards carry `concept` (or `concepts`, one per map line a screen covers),
`page.json` carries `subproject`, and the coverage rule decides which stories
must exist. The operator sees the real screen before the
sign question. What the operator signs is
`bun skills/ultrawrite/stories/product.ts render <bundle>/product.json --bundle <bundle> --out <bundle>/product.md`,
shown in the sign question with the approved screen.
