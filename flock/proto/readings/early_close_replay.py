#!/usr/bin/env python3
"""PROTOTYPE (map #1292, ticket 4, the final atlas race). Offline proof for the host's early
conflict close (`--early-close held`): replay each recorded run's weave-ops.jsonl into a fresh
keeper, keep the host's conflict ledger the way host.mjs keeps it, and ask at every publish
whether an open conflict already holds its resolution.

  python3 flock/proto/readings/early_close_replay.py flock/proto/runs/atlas-AE* flock/proto/runs/ledger* ...

The rule (`held`), per open conflict on path p, checked at every publish:
  some agent S published p, S's last edit to p came after the last peer change to p reached
  S's copy (S edited with every side it had received in view), and S's published text of p is
  byte-for-byte the merged text of p. Then the merged text is S's own writing over both sides.

Also read (evidence only, never a trigger): `unflagged`, the conflict's hunks no longer flagged
on the merged snapshot. The control below shows why it is not a trigger: Manyana stops flagging
a blind conflict as soon as one side pulls and republishes, with nobody having looked at it.

Safety reading, per early close at t: the conflicted region's merged text at t (the hunks'
visible lines with one line of context each side) must still be in the final merged text. A
region that changed after t was still being worked, and an early close there would be wrong.
And a control: two agents change one spot blind; the rule must not fire until one of them edits
after receiving the other's side.
"""
import difflib, hashlib, json, os, sys, tempfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import weave as W  # noqa: E402


def hunks(annotated):
    out, side, cur = [], None, None
    for l in (annotated or '').split('\n'):
        if l.startswith('<<<<<<< begin'):
            cur, side = {'a': [], 'b': []}, 'a'; continue
        if l.startswith('======= begin'):
            side = 'b'; continue
        if l.startswith('>>>>>>> end'):
            if cur:
                out.append('\u0001'.join(sorted(['\n'.join(cur['a']), '\n'.join(cur['b'])])))
            cur = side = None; continue
        if cur and side:
            cur[side].append(l)
    return out


def region(annotated):   # the host's region id (host.mjs region())
    return hashlib.sha1('\u0002'.join(sorted(hunks(annotated))).encode()).hexdigest()[:10]


def window(annotated):
    """The merged visible lines a conflict spans, with one line of context each side."""
    vis, spans, lo, section = [], [], None, None
    for l in (annotated or '').split('\n'):
        if l.startswith('<<<<<<< begin') or l.startswith('======= begin'):
            if lo is None:
                lo = len(vis)
            section = 'deleted' if 'deleted' in l else 'shown'
            continue
        if l.startswith('>>>>>>> end'):
            spans.append((lo, len(vis))); lo = section = None; continue
        if section == 'deleted':
            continue
        vis.append(l)
    return ['\n'.join(vis[max(0, a - 1):b + 1]) for a, b in spans]


def replay(run):
    k = W.Keeper()
    last_edit, last_arrival, pub = {}, {}, {}   # agent -> path -> t ; agent -> path -> (text, held)
    ledger, snaps, last_pub = {}, [], {}
    for line in open(os.path.join(run, 'weave-ops.jsonl')):
        o = json.loads(line); t = o.pop('t'); op = o.pop('op')
        res = getattr(k, 'r_' + op)(**o)
        if op in ('edit', 'rewrite'):
            last_edit.setdefault(o['agent'], {})[o['path']] = t
        elif op == 'pull':
            for c in res['changed']:
                if c['conflict']:   # a peer's side arrived with conflict marks (a union counts too)
                    last_arrival.setdefault(o['agent'], {})[c['path']] = t
                if c['conflict'] and not c['addsOnly']:
                    # a conflict seen in one copy's pull: the puller's side may not be published yet,
                    # so the rule waits for the puller's next publish (`party`)
                    key = (c['path'], region(c['annotated']))
                    ledger.setdefault(key, {'path': c['path'], 'region': key[1], 'open_t': t, 'hunks': hunks(c['annotated']), 'window': window(c['annotated']), 'early': None, 'unflagged': None, 'via': 'pull', 'party': o['agent']})
        elif op == 'publish':
            a = o['agent']
            last_pub[a] = t
            for p, te in last_edit.get(a, {}).items():
                pub.setdefault(a, {})[p] = ('\n'.join(k.lines(a, p)), te >= last_arrival.get(a, {}).get(p, -1), t)
            m = k.r_merged()
            snaps.append((t, m['files']))
            for p in m['conflicts']:
                if m['addsOnly'].get(p):
                    continue
                key = (p, region(m['annotated'][p]))
                ledger.setdefault(key, {'path': p, 'region': key[1], 'open_t': t, 'hunks': hunks(m['annotated'][p]), 'window': window(m['annotated'][p]), 'early': None, 'unflagged': None, 'via': 'edge'})
            for e in ledger.values():
                if e['early'] is not None:
                    continue
                p = e['path']
                cur = hunks(m['annotated'][p]) if p in m['conflicts'] else []
                if e['unflagged'] is None and not set(e['hunks']) & set(cur):
                    e['unflagged'] = t
                if e.get('party') and last_pub.get(e['party'], -1) < e['open_t']:
                    continue
                holders = [s for s, ps in pub.items() if p in ps and ps[p][1] and ps[p][0] == m['files'].get(p)]
                if holders:
                    e['early'] = t; e['by'] = holders; e['early_text'] = m['files'][p]
    ev = [json.loads(l) for l in open(os.path.join(run, 'events.jsonl'))]
    recorded = {}
    for r in ev:
        if r['kind'] == 'conflict:close':
            recorded.setdefault((r['path'], r.get('region')), r['t'])   # runs before ticket 5 keyed by path only
            recorded.setdefault((r['path'], None), r['t'])
    rtask = {r['path']: r['t'] for r in ev if r['kind'] == 'resolve-task'}
    rdone = {r['task'][2:]: r['t'] for r in ev if r['kind'] == 'session:end' and str(r['task']).startswith('R:')}

    def text_at(t, p):   # the merged text of p as of the last publish at or before t
        cur = ''
        for ts, files in snaps:
            if ts > t + 50:
                break
            cur = files.get(p, '')
        return cur
    out = []
    for e in ledger.values():
        safe = None
        if e['early'] is not None:
            # the reference: the text the run itself settled that conflict on (the recorded close, or
            # the resolve task's end, whichever is later), else the end of the run
            rec = next((recorded[x] for x in [(e['path'], e['region']), (e['path'], None)] if x in recorded), None)
            ref = max([x for x in (rec, rdone.get(e['path'])) if x is not None], default=None)
            ref_text = text_at(ref, e['path']) if ref is not None and ref > e['early'] else (snaps[-1][1].get(e['path'], '') if snaps else '')
            safe = region_kept(e, ref_text)
        out.append({'path': e['path'], 'region': e['region'], 'via': e['via'], 'open_s': round(e['open_t'] / 1000, 1),
                    'early_s': None if e['early'] is None else round(e['early'] / 1000, 1), 'by': e.get('by'),
                    'unflagged_s': None if e['unflagged'] is None else round(e['unflagged'] / 1000, 1),
                    'recorded_close_s': next((round(recorded[x] / 1000, 1) for x in [(e['path'], e['region']), (e['path'], None)] if x in recorded), None),
                    'resolve_task_s': None if e['path'] not in rtask else round(rtask[e['path']] / 1000, 1),
                    'region_same_as_recorded_resolution': safe})
    return out


def region_kept(e, final):
    """True when nothing after the early close touched the conflicted region: the file is the same
    at the end, or every line that changed after it lies outside the region's window (the
    conflict's lines as the merged text showed them, one line of context each side)."""
    before = e['early_text']
    if before == final:
        return True
    a, b = before.split('\n'), final.split('\n')
    rows = set()
    for w in e['window']:
        wl = w.split('\n')
        hit = next((i for i in range(len(a) - len(wl) + 1) if a[i:i + len(wl)] == wl), None)
        if hit is None:
            return False   # the region's text at open is no longer in the text at close: unknown, count it against
        rows.update(range(hit, hit + len(wl)))
    for tag, i1, i2, _, _ in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if tag != 'equal' and (rows & set(range(i1, max(i2, i1 + 1)))):
            return False
    return True


def control():
    """Two agents change one spot blind; the rule must hold off until one edits after seeing both."""
    d = tempfile.mkdtemp()
    with open(os.path.join(d, 'f.py'), 'w') as f:
        f.write('def f(x):\n    y = x + 1\n    return y\n\n\ndef g():\n    pass\n')
    k = W.Keeper(); k.r_base(d, ['f.py'])
    last_edit, last_arrival, pub, steps = {}, {}, {}, []

    def edit(a, *args):
        k.r_edit(a, 'f.py', *args); last_edit.setdefault(a, {})['f.py'] = len(steps) + 0.5

    def pull(a):
        r = k.r_pull(a)
        for c in r['changed']:
            last_arrival.setdefault(a, {})[c['path']] = len(steps) + 0.5
        return [c['conflict'] for c in r['changed']]

    def publish(a, label):
        k.r_publish(a)
        for p, te in last_edit.get(a, {}).items():
            pub.setdefault(a, {})[p] = ('\n'.join(k.lines(a, p)), te >= last_arrival.get(a, {}).get(p, -1))
        m = k.r_merged()
        held = [s for s, ps in pub.items() if 'f.py' in ps and ps['f.py'][1] and ps['f.py'][0] == m['files']['f.py']]
        flagged = 'f.py' in m['conflicts'] and not m['addsOnly'].get('f.py')
        opened = flagged or any(s['flagged'] for s in steps)
        steps.append({'step': label, 'flagged': flagged, 'rule_fires': bool(held) and opened, 'text': m['files']['f.py']})
    # A rewrites the body; B deletes the same line and adds its own: a real, non-union conflict
    edit('A', 1, 3, ['    return x + 1']); publish('A', 'A publishes its side')
    edit('B', 1, 2, ['    y = x * 2', '    y = y + 1']); publish('B', 'B publishes its side, blind')
    c = pull('B'); publish('B', 'B pulls A (conflict marks: %s) and republishes WITHOUT editing' % c)
    c = pull('A'); publish('A', 'A pulls B and republishes WITHOUT editing')
    edit('B', 0, 4, ['def f(x):', '    return (x * 2) + 1']); publish('B', 'B edits f after holding both sides, publishes')
    return steps


if __name__ == '__main__':
    def main():
        rows = []
        for run in sys.argv[1:]:
            run = run.rstrip('/')
            if not os.path.exists(os.path.join(run, 'weave-ops.jsonl')):
                continue
            for r in replay(run):
                r['run'] = os.path.basename(run).split('-2026')[0]
                rows.append(r)
        cols = ['run', 'path', 'via', 'open_s', 'unflagged_s', 'early_s', 'by', 'recorded_close_s', 'resolve_task_s', 'region_same_as_recorded_resolution']
        print(' | '.join(cols))
        for r in rows:
            print(' | '.join(str(r.get(c)) for c in cols))
        n_early = sum(1 for r in rows if r['early_s'] is not None)
        bad = [r for r in rows if r['early_s'] is not None and not r['region_same_as_recorded_resolution']]
        print('\nruns %d, conflicts %d, would close early %d, early close whose region then changed before the recorded resolution %d, never closed early %d'
              % (len({r['run'] for r in rows}), len(rows), n_early, len(bad), len(rows) - n_early))
        saved = [r['resolve_task_s'] - r['early_s'] for r in rows if r['early_s'] is not None and r['resolve_task_s'] is not None]
        if saved:
            print('resolve-task time it would have pre-empted (s): %s' % ', '.join('%.0f' % s for s in saved))
        print('\ncontrol (blind conflict):')
        for s in control():
            print('  %-75s flagged=%s rule_fires=%s' % (s['step'], s['flagged'], s['rule_fires']))
    W.fold_wave.run_on_kernel_thread(main)
