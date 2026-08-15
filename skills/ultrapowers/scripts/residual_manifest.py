#!/usr/bin/env python3
"""Derive and check the residual manifest at finishing (issue #149).

report.json emits three finding families -- completenessFindings,
judgmentCalls, deferredVerification -- but whether they survive to
release/close used to depend on orchestrator memory. Derive mode unions all
three families across every report passed (resume/redirect rounds each pass
their report) into one manifest row per distinct finding, content-addressed
so the same finding gets the same id in every round. Check mode is the
mechanical close check: exit 0 iff every row is dispositioned.

Modes:
  derive: residual_manifest.py <report.json> [more-reports...]
              [--gate-acks <standing-approval.json>]  > residual-manifest.md
  check:  residual_manifest.py --check <manifest.md>

Row grammar (one line per row, exactly; anything else is commentary):
  - <id> [<family>] <text> — disposition: <value>
with <id> = <family>-<12-hex sha256 of the normalized text> (byte-identical
duplicates within one report tiebreak -2, -3, ...) and <value> one of
fixed | acked | filed:<ref> | waived:<reason>.

Canonical manifest location: <runDir>/residual-manifest.md, beside
report.json. NON-FROZEN and advisory-by-construction: a layer above the
gate, at the ceremony the gate feeds -- it extends no frozen gate script.
"""
import argparse
import hashlib
import json
import re
import sys

FAMILIES = ("completenessFindings", "judgmentCalls", "deferredVerification")

# Keys that identify a report result even when all three finding families
# are absent (a genuine report may legally emit zero findings).
REPORT_MARKERS = ("tasks", "waveMerges", "coverage", "tests")

# The constant suffix gate_check.py (FROZEN) appends to the recorded ack
# detail for runtime/external deferredVerification items -- copied exactly.
STRUCTURAL_SUFFIX = (" [structural false-green: sandbox could not "
                     "execute it against the target]")

ROW = re.compile(r"^- (?P<id>[A-Za-z]+-[0-9a-f]{12}(?:-\d+)?) "
                 r"\[(?P<family>[A-Za-z]+)\] "
                 r"(?P<text>.*) — disposition:(?P<value>.*)$")
DISPOSITION = re.compile(r"^(?:fixed|acked|filed:\S+|waived:\S.*)$")


def die(msg):
    print("residual_manifest: " + msg, file=sys.stderr)
    sys.exit(1)


def load_json(path, what):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError, TypeError) as e:
        die("unreadable %s %r (%s)" % (what, path, e))


def load_result(path):
    """Accept the saved Workflow envelope (gate fields live under result.*)
    or a bare result object. Die (exit 1) on anything that is not
    recognizably a report -- a silent {} fallback would emit a vacuous-green
    empty manifest for the wrong file."""
    data = load_json(path, "report")
    if isinstance(data, dict) and "result" in data:
        if not isinstance(data["result"], dict):
            die("not a report: %r has a non-dict result envelope" % path)
        result = data["result"]
    elif isinstance(data, dict):
        result = data
    else:
        die("not a report: %r is not a JSON object" % path)
    if (not any(k in result for k in FAMILIES)
            and not any(k in result for k in REPORT_MARKERS)):
        die("not a report: %r has none of the finding families (%s) "
            "and no report markers (%s)"
            % (path, ", ".join(FAMILIES), ", ".join(REPORT_MARKERS)))
    return result


def normalize(text):
    return " ".join(str(text).split())


def finding_text(family, item):
    if family == "deferredVerification" and isinstance(item, dict):
        head = "%s (%s)" % (item.get("deliverable", "?"),
                            item.get("reason", "unknown"))
        why = normalize(item.get("why", "") or "")
        return normalize(head) + ((" — " + why) if why else "")
    return normalize(item)


def acked_by_record(item, ack_list):
    """Pre-fill from durable records only: a standing-approval.json ackList
    entry (gate_check.py ack shape: type "deferred:<reason>", detail
    "<deliverable> — <why>" plus, for runtime/external, STRUCTURAL_SUFFIX)
    matching this deferredVerification item. Exact match only -- a prefix
    match would let an ack for one item cross-ack another whose why is a
    string-prefix of it."""
    if not (isinstance(item, dict) and ack_list):
        return False
    deliverable = str(item.get("deliverable", "?"))
    reason = str(item.get("reason", "unknown"))
    # gate_check.py records str(d.get("why", "")): absent -> "", None ->
    # "None" -- replicate its coercion exactly.
    prefix = deliverable + " — " + str(item.get("why", ""))
    for ack in ack_list:
        if not (isinstance(ack, dict)
                and str(ack.get("type", "")) == "deferred:" + reason):
            continue
        detail = str(ack.get("detail", ""))
        if detail == prefix or detail == prefix + STRUCTURAL_SUFFIX:
            return True
    return False


def derive(report_paths, ack_list):
    rows = {}  # id -> (family, text, disposition-suffix); insertion-ordered
    for path in report_paths:
        result = load_result(path)
        seen = {}  # per-report tiebreak counters for byte-identical dupes
        for family in FAMILIES:
            items = result.get(family) or []
            if not isinstance(items, list):
                continue
            for item in items:
                text = finding_text(family, item)
                if not text:
                    continue
                digest = hashlib.sha256(
                    text.encode("utf-8")).hexdigest()[:12]
                base = family + "-" + digest
                n = seen.get(base, 0) + 1
                seen[base] = n
                rid = base if n == 1 else "%s-%d" % (base, n)
                if rid in rows:
                    continue  # the union dedupes on content id
                disp = (" acked" if family == "deferredVerification"
                        and acked_by_record(item, ack_list) else "")
                rows[rid] = (family, text, disp)
    return rows


def emit(rows, sources):
    lines = ["# Residual manifest", "",
             "<!-- derived from: " + ", ".join(sources) + " -->",
             "<!-- disposition one of: fixed | acked | filed:<ref> | "
             "waived:<reason> -->", ""]
    if not rows:
        lines.append("No residual findings.")
    for rid, (family, text, disp) in rows.items():
        lines.append("- %s [%s] %s — disposition:%s"
                     % (rid, family, text, disp))
    print("\n".join(lines))


def check(path):
    try:
        with open(path) as f:
            lines = f.read().splitlines()
    except OSError as e:
        die("unreadable manifest %r (%s)" % (path, e))
    bad, total = [], 0
    for line in lines:
        m = ROW.match(line)
        if not m:
            continue  # commentary
        total += 1
        value = m.group("value").strip()
        if not DISPOSITION.match(value):
            bad.append(m.group("id") +
                       ("" if not value
                        else " (invalid disposition %r)" % value))
    if bad:
        print("residual_manifest: NOT CLEAN — %d undispositioned row(s):"
              % len(bad), file=sys.stderr)
        for b in bad:
            print("  " + b, file=sys.stderr)
        return 2
    print("residual_manifest: CLEAN — %d row(s) dispositioned%s"
          % (total, " (zero rows: vacuous pass)" if total == 0 else ""))
    return 0


def main():
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("reports", nargs="*",
                    help="report.json files to union (derive mode)")
    ap.add_argument("--gate-acks", default=None, metavar="STANDING_APPROVAL",
                    help="standing-approval.json whose recorded ackList "
                         "pre-dispositions matching deferredVerification "
                         "rows as acked")
    ap.add_argument("--check", default=None, metavar="MANIFEST",
                    help="check mode: exit 0 iff every row is dispositioned")
    a = ap.parse_args()

    if a.check:
        if a.reports or a.gate_acks:
            die("--check takes a manifest only (no reports, no --gate-acks)")
        return check(a.check)
    if not a.reports:
        die("derive mode needs at least one report.json "
            "(or --check <manifest>)")
    ack_list = []
    if a.gate_acks:
        ack_list = load_json(a.gate_acks, "gate-acks").get("ackList") or []
    emit(derive(a.reports, ack_list), a.reports)
    return 0


if __name__ == "__main__":
    sys.exit(main())
