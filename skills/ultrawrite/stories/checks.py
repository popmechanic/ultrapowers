#!/usr/bin/env python3
"""The code checks a bundle meets before compile. A refusal stops compile; a
fact is printed for the author to act on and stops nothing."""
from bundle import KINDS
import probe_block
import steps as steps_mod


def run_checks(b):
    page, cards, rows = b["page"], b["cards"], b["steps"]
    refusals, facts = [], []
    kind = page.get("kind")
    if kind not in KINDS:
        refusals.append("page: kind must be behaviour, preserve or look")
    summary = page.get("summary")
    if not (isinstance(summary, list) and len(summary) == 3
            and all(isinstance(s, str) and s.strip() for s in summary)):
        refusals.append("page: summary must be three sentences")
    story_ids = [s["id"] for s in page.get("stories", [])]
    link_ids = [l["id"] for l in page.get("links", [])]
    if kind == "behaviour" and not story_ids:
        refusals.append("page: a behaviour plan needs at least one story")
    if kind == "preserve" and not page.get("numbers"):
        refusals.append("page: a preserve plan needs at least one number")

    pieces = {c["piece"]: c for c in cards}
    owner = {a["name"]: c["piece"] for c in cards for a in c["actions"]}
    by_story = steps_mod.stories_of(rows)
    chain_ok = True
    for sid in story_ids:
        if sid not in by_story:
            refusals.append("story %s has no recorded steps" % sid)
    for sid, srows in by_story.items():
        if sid not in story_ids:
            refusals.append("steps recorded for %s, which is not on the page" % sid)
        errs = steps_mod.validate_story(srows)
        chain_ok = chain_ok and not errs
        refusals += errs
    for s in page.get("stories", []):
        sid = s["id"]
        setup = s.get("setup")
        if not setup:
            continue
        if sid not in by_story:
            continue  # "story %s has no recorded steps" above already covers this
        for sc in setup:
            tool = sc.get("tool")
            if tool not in owner:
                refusals.append("story %s: setup names tool %s, which is no piece's action"
                                % (sid, tool))
        srows = by_story[sid]
        matches = (len(srows) >= len(setup)
                   and all(srows[i].get("tool") == setup[i].get("tool")
                           and probe_block.same_value(srows[i].get("args", {}), setup[i].get("args", {}))
                           for i in range(len(setup))))
        if not matches:
            refusals.append("story %s: its recorded steps do not begin with its setup" % sid)
    for r in rows:
        where = "step %s.%s" % (r.get("story"), r.get("step"))
        tool = r.get("tool")
        if tool not in owner:
            refusals.append("%s: tool %s is no piece's action" % (where, tool))
        elif owner[tool] != r.get("piece"):
            refusals.append("%s: tool %s belongs to piece %s, not %s"
                            % (where, tool, owner[tool], r.get("piece")))
        if r.get("link") is not None and r["link"] not in link_ids:
            refusals.append("%s: link %s is not on the page" % (where, r["link"]))
    for lid in link_ids:
        if not any(r.get("link") == lid for r in rows):
            refusals.append("link %s has no recorded step" % lid)

    for c in cards:
        name = c["piece"]
        if c.get("main_story") not in story_ids:
            refusals.append("piece %s: its main story %s is not on the page"
                            % (name, c.get("main_story")))
        for dep in c.get("depends_on", []):
            if dep not in pieces:
                refusals.append("piece %s: depends on %s, which is no piece" % (name, dep))
        for table, cells in c.get("state", {}).get("tables", {}).items():
            for cell in cells:
                if b["store_text"].count(cell) < 2:
                    facts.append("CODE fact: piece %s: %s.%s is named fewer than twice in "
                                 "the store module; no action may use it" % (name, table, cell))
        if not chain_ok:
            continue
        for a in c["actions"]:
            for sentence in a.get("refuses", []):
                shown = any(r.get("tool") == a["name"]
                            and probe_block.same_value(probe_block.checks_for(r["before"], r["after"]),
                                                        [{"unchanged": True}])
                            for r in rows)
                if not shown:
                    facts.append('CODE fact: piece %s: %s refuses "%s" but no recorded step shows it'
                                 % (name, a["name"], sentence))
    return refusals, facts
