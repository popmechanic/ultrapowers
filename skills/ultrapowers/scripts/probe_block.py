#!/usr/bin/env python3
import json

LAYERS = ("store", "ui", "saved")
UI_FORMS = ("click", "type", "key", "select")
PROBE_KEYS = {"clause", "layer", "as", "given", "do", "expect", "see", "judge", "holds_before"}


def is_who(x):
    return x is None or (isinstance(x, str) and x != "")


def is_tool_call(x):
    return (isinstance(x, dict) and set(x) in ({"tool", "args"}, {"tool", "args", "as"})
            and isinstance(x["tool"], str) and x["tool"] != ""
            and isinstance(x["args"], dict) and is_who(x.get("as")))


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
    if not is_who(p.get("as")):
        errs.append("%s: as must be an email or null" % where)
    given = p.get("given", [])
    if not isinstance(given, list) or not all(is_tool_call(g) for g in given):
        errs.append("%s: given must be a list of {tool, args, as?} calls" % where)
    do = p.get("do")
    if not isinstance(do, list) or not do:
        errs.append("%s: do must be a non-empty list" % where)
    elif p.get("layer") == "ui":
        if not all(is_ui_call(d) for d in do):
            errs.append("%s: a ui probe's do is click/type/key/select steps" % where)
    elif not (len(do) == 1 and is_tool_call(do[0]) and "as" not in do[0]):
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
    try:
        p = json.loads(text)
    except ValueError as exc:
        return None, ["probe: not JSON: %s" % exc]
    return p, validate_probe(p)


def tools_of(p):
    names = {g["tool"] for g in p.get("given", []) if is_tool_call(g)}
    names |= {d["tool"] for d in p.get("do", []) if is_tool_call(d)}
    return names
