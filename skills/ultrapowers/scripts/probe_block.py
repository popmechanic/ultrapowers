#!/usr/bin/env python3
"""A state probe, as a stories-v1 plan carries it: one fenced ```probe block
holding one JSON object. The grammar is closed, and code decides every check.

    {"clause": "S1.2", "layer": "store" | "ui" | "saved",
     "given": [{"tool": name, "args": {...}}, ...],
     "do":    [{"tool": name, "args": {...}}]            (store, saved)
            | [{"click" | "type" | "key": {...}}, ...]   (ui),
     "expect": [check, ...],
     "see": [{"role": r, "name": n, "count"?: k}, ...],
     "judge": null | "a sentence Jev reads over the before/after state",
     "holds_before": bool}

A check is exactly one of:
    {"table": t, "row": r, "cell": c, "eq": v}         the cell holds v
    {"table": t, "row": r, "cell": c, "absent": true}  the cell is not set
    {"table": t, "row": r, "absent": true}             the row is gone
    {"value": k, "eq": v} | {"value": k, "absent": true}
    {"unchanged": true}                                nothing changed
Equality is by value AND type, so true, "true" and 1 are three answers."""
import json

LAYERS = ("store", "ui", "saved")
UI_FORMS = ("click", "type", "key")
PROBE_KEYS = {"clause", "layer", "given", "do", "expect", "see", "judge", "holds_before"}
EMPTY = [{}, {}]
_MISSING = object()


def is_tool_call(x):
    return (isinstance(x, dict) and set(x) == {"tool", "args"}
            and isinstance(x["tool"], str) and x["tool"] != ""
            and isinstance(x["args"], dict))


def is_ui_call(x):
    return (isinstance(x, dict) and len(x) == 1 and next(iter(x)) in UI_FORMS
            and isinstance(next(iter(x.values())), dict))


def is_check(c):
    if not isinstance(c, dict):
        return False
    keys = set(c)
    if keys == {"unchanged"}:
        return c["unchanged"] is True
    if keys == {"value", "eq"}:
        return isinstance(c["value"], str)
    if keys == {"value", "absent"}:
        return isinstance(c["value"], str) and c["absent"] is True
    if keys in ({"table", "row", "absent"}, {"table", "row", "cell", "absent"}):
        return (c["absent"] is True
                and all(isinstance(c[k], str) for k in keys - {"absent"}))
    if keys == {"table", "row", "cell", "eq"}:
        return all(isinstance(c[k], str) for k in ("table", "row", "cell"))
    return False


def _is_see(s):
    return (isinstance(s, dict) and set(s) <= {"role", "name", "count"}
            and isinstance(s.get("role"), str) and isinstance(s.get("name"), str)
            and isinstance(s.get("count", 0), int))


def validate_probe(p):
    """Every way `p` leaves the grammar, one plain sentence each; [] when valid."""
    if not isinstance(p, dict):
        return ["probe: must be a JSON object"]
    where = "probe %s" % p.get("clause", "?")
    errs = []
    extra = set(p) - PROBE_KEYS
    if extra:
        errs.append("%s: unknown keys %s" % (where, ", ".join(sorted(extra))))
    if not isinstance(p.get("clause"), str) or not p.get("clause"):
        errs.append("%s: clause must name the story step, e.g. S1.2" % where)
    if p.get("layer") not in LAYERS:
        errs.append("%s: layer must be store, ui or saved" % where)
    given = p.get("given", [])
    if not isinstance(given, list) or not all(is_tool_call(g) for g in given):
        errs.append("%s: given must be a list of {tool, args} calls" % where)
    do = p.get("do")
    if not isinstance(do, list) or not do:
        errs.append("%s: do must be a non-empty list" % where)
    elif p.get("layer") == "ui":
        if not all(is_ui_call(d) for d in do):
            errs.append("%s: a ui probe's do is click/type/key steps" % where)
    elif not (len(do) == 1 and is_tool_call(do[0])):
        errs.append("%s: a store or saved probe's do is one {tool, args} call" % where)
    expect = p.get("expect")
    if not isinstance(expect, list) or not expect or not all(is_check(c) for c in expect):
        errs.append("%s: expect must be a non-empty list of closed checks" % where)
    see = p.get("see", [])
    if not isinstance(see, list) or not all(_is_see(s) for s in see):
        errs.append("%s: see must be a list of {role, name, count?}" % where)
    if p.get("judge") is not None and not isinstance(p.get("judge"), str):
        errs.append("%s: judge must be a sentence or null" % where)
    if not isinstance(p.get("holds_before", False), bool):
        errs.append("%s: holds_before must be true or false" % where)
    return errs


def parse_probe_text(text):
    """`(probe, errors)` for one fence's body."""
    try:
        p = json.loads(text)
    except ValueError as exc:
        return None, ["probe: not JSON: %s" % exc]
    return p, validate_probe(p)


def tools_of(p):
    """Every tool name the probe calls, in `given` and in a tool-form `do`."""
    names = {g["tool"] for g in p.get("given", []) if is_tool_call(g)}
    names |= {d["tool"] for d in p.get("do", []) if is_tool_call(d)}
    return names


def same_value(a, b):
    """Deep, type-strict equality: dicts by same keys and pairwise same_value
    values, lists/tuples by same length and pairwise same_value, everything
    else by exact type and equality — so True, 1 and 1.0 are three different
    answers."""
    if isinstance(a, dict) and isinstance(b, dict):
        return set(a) == set(b) and all(same_value(v, b[k]) for k, v in a.items())
    if isinstance(a, (list, tuple)) and isinstance(b, (list, tuple)):
        return type(a) is type(b) and len(a) == len(b) and all(same_value(x, y) for x, y in zip(a, b))
    return type(a) is type(b) and a == b


def probe_for(row, prior, clause):
    """The probe a signed step's row derives: `given` from the story's
    earlier rows, `do` from the step itself, `expect` from its recorded
    diff."""
    expect = checks_for(row["before"], row["after"])
    do = row["ui"] if row["layer"] == "ui" else [{"tool": row["tool"], "args": row.get("args", {})}]
    return {"clause": clause, "layer": row["layer"],
            "given": [{"tool": r["tool"], "args": r.get("args", {})} for r in prior],
            "do": do, "expect": expect, "see": row.get("see", []), "judge": None,
            "holds_before": expect == [{"unchanged": True}]}


def checks_for(before, after):
    """The closed checks that say exactly how `after` differs from `before`:
    only rows and cells that changed, so a cell another piece adds later never
    breaks them. No difference at all is `[{"unchanged": true}]`."""
    bt, bv = before
    at, av = after
    out = []
    for t in sorted(set(bt) | set(at)):
        brows, arows = bt.get(t, {}), at.get(t, {})
        for r in sorted(set(brows) | set(arows)):
            if r in brows and r not in arows:
                out.append({"table": t, "row": r, "absent": True})
                continue
            bcells, acells = brows.get(r, {}), arows.get(r, {})
            for c in sorted(set(bcells) | set(acells)):
                b, a = bcells.get(c, _MISSING), acells.get(c, _MISSING)
                if a is _MISSING:
                    out.append({"table": t, "row": r, "cell": c, "absent": True})
                elif b is _MISSING or not same_value(a, b):
                    out.append({"table": t, "row": r, "cell": c, "eq": a})
    for k in sorted(set(bv) | set(av)):
        b, a = bv.get(k, _MISSING), av.get(k, _MISSING)
        if a is _MISSING:
            out.append({"value": k, "absent": True})
        elif b is _MISSING or not same_value(a, b):
            out.append({"value": k, "eq": a})
    return out or [{"unchanged": True}]


def holds(check, content, before=None):
    """Whether one check is true of `content` (`before` is read only by
    `unchanged`)."""
    tables, values = content
    if "unchanged" in check:
        return before is not None and same_value(content, before)
    if "value" in check:
        if check.get("absent"):
            return check["value"] not in values
        return check["value"] in values and same_value(values[check["value"]], check["eq"])
    row = tables.get(check["table"], {}).get(check["row"])
    if "cell" not in check:
        return row is None
    if row is None or check["cell"] not in row:
        return bool(check.get("absent"))
    if check.get("absent"):
        return False
    return same_value(row[check["cell"]], check["eq"])


def hollow(p, before):
    """A probe tests nothing when every check already holds before its step,
    unless it says the clause is about something staying the same."""
    if p.get("holds_before"):
        return False
    return all(holds(c, before, before) for c in p["expect"])
