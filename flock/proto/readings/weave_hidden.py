"""Gap 5 — candidates as hidden lines, using only Manyana's own counts.

A line is visible when its count is odd. Merge keeps max(count). So:
  hidden   = count 2 (inserted, then marked dead)
  select   = count 3 on any replica; the merge's max carries it everywhere
  re-hide  = count 4, and so on (generation counting)
Candidate lines here carry unique text, which stands in for the line identity
#359 would provide; everything else is the vendored kernel, unmodified.
"""
import itertools, json, os, random, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import weave_edits as W  # apply_edit, join, visible
import fold_wave
M = W.manyana


def set_count(state_str, text, bump_to_parity):
    """Increment the count of the entry whose line == text until its parity is
    `bump_to_parity` (1 = visible, 0 = hidden). Returns the new state."""
    st = M.deserialize_state(state_str)
    hits = [e for e in st if e[0] == text]
    assert len(hits) == 1, (text, len(hits))
    while hits[0][3] % 2 != bump_to_parity:
        hits[0][3] += 1
    return M.serialize_state(st)


def run():
    base = ["function importCsv(text) {", "  const header = text.slice(0, 1)", "}", "",
            "function exportCsv(rows) {", "  return rows.join('\\n')", "}"]
    B0 = M.initial_state(base)
    c1 = ["  const rows = text.split('\\n')  /*c1a*/", "  if (!rows.length) throw new Error('empty')  /*c1b*/"]
    c2 = ["  const rows = parse(text, { strict: true })  /*c2a*/", "  return rows.map(toWidget)  /*c2b*/"]
    out = {}

    # each candidate written into its own replica, then hidden before it is shared
    A = W.apply_edit(B0, 2, 2, c1)
    for t in c1: A = set_count(A, t, 0)
    B = W.apply_edit(B0, 2, 2, c2)
    for t in c2: B = set_count(B, t, 0)
    C = W.apply_edit(B0, 6, 6, ["  // peer C: a comment in exportCsv"])   # an unrelated peer edit
    ab, conf_ab = W.join(A, B)
    abc, conf_abc = W.join(ab, C)
    out["1 both hidden, merged with a peer edit"] = {
        "visible == base + C's line": W.visible(abc) == base[:6] + ["  // peer C: a comment in exportCsv"] + base[6:],
        "conflict flagged": conf_ab or conf_abc,
        "order-free": len({W.join(W.join(x, y)[0], z)[0] for x, y, z in itertools.permutations([A, B, C])}) == 1}

    # the host selects candidate 2 on ONE replica only; gossip spreads it
    S = abc
    for t in c2: S = set_count(S, t, 1)
    stale = abc                                   # a replica that has not heard yet
    m, conf = W.join(stale, S)
    want = base[:2] + [c2[0], c2[1]] + base[2:6] + ["  // peer C: a comment in exportCsv"] + base[6:]
    got = W.visible(m)
    out["2 select candidate 2 on one replica, merge with a stale one"] = {
        "candidate 2 visible everywhere": all(t in got for t in c2), "candidate 1 still hidden": not any(t in got for t in c1),
        "text as intended (up to the order of the two candidates' slots)": sorted(got) == sorted(want),
        "conflict flagged": conf, "order-free": W.join(stale, S)[0] == W.join(S, stale)[0]}

    # partial adoption: one line of the losing candidate, while a peer edits elsewhere
    P = set_count(m, c1[1], 1)
    Q = W.apply_edit(m, 0, 0, ["// peer D: a header comment"])
    pq, conf = W.join(P, Q)
    got = W.visible(pq)
    out["3 adopt one line of candidate 1, concurrent peer edit"] = {
        "adopted line visible": c1[1] in got, "rest of candidate 1 hidden": c1[0] not in got,
        "peer line kept": "// peer D: a header comment" in got, "conflict flagged": conf,
        "order-free": W.join(P, Q)[0] == W.join(Q, P)[0], "result": got}

    # two replicas select DIFFERENT candidates at the same time
    X = abc
    for t in c1: X = set_count(X, t, 1)
    Y = abc
    for t in c2: Y = set_count(Y, t, 1)
    xy, conf = W.join(X, Y)
    got = W.visible(xy)
    out["4 two replicas select different candidates concurrently"] = {
        "both candidates visible": all(t in got for t in c1 + c2), "conflict flagged": conf, "result": got}

    # the author's own view: author keeps its candidate VISIBLE locally and gossips
    Aview = W.apply_edit(B0, 2, 2, c1)            # count 1: the author is still working on it
    mm, conf = W.join(Aview, B)
    out["5 author gossips its still-visible candidate"] = {
        "candidate 1 becomes visible to everyone": all(t in W.visible(mm) for t in c1),
        "conflict flagged": conf}

    # re-hide after selection, and re-select (generation counting)
    R = pq
    for t in c2: R = set_count(R, t, 0)
    R2 = R
    for t in c2: R2 = set_count(R2, t, 1)
    out["6 re-hide then re-select"] = {"hidden after re-hide": not any(t in W.visible(R) for t in c2),
                                       "visible after re-select": all(t in W.visible(R2) for t in c2),
                                       "re-select beats a stale re-hidden replica": all(t in W.visible(W.join(R, R2)[0]) for t in c2)}
    return out


if __name__ == "__main__":
    print(json.dumps(fold_wave.run_on_kernel_thread(run), indent=1))
