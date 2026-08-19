"""Base report renderer: a plain-text totals-by-category summary.

This is the pre-existing renderer every record report is built from; the
export feature (Task 2) adds machine-readable formats alongside it rather
than replacing it.
"""


def totals_by_category(records):
    totals = {}
    for r in records:
        cat = r.get("category", "uncategorized")
        totals[cat] = totals.get(cat, 0) + r.get("amount", 0)
    return totals


def render_report(records):
    totals = totals_by_category(records)
    lines = ["%s: %s" % (cat, totals[cat]) for cat in sorted(totals)]
    return "\n".join(lines)
