#!/usr/bin/env python3
"""PROTOTYPE (map #1292, ticket 4, the scale pass). One row per atlas run, in the columns of the
third-pass comment, plus per-agent idle time read from the host's own events.

  python3 flock/proto/readings/atlas_table.py flock/proto/runs/atlas-AE* ...

Idle, per agent, from start to the run's end (settled, or the terminal outcome):
  unclaimed  time outside any session: nothing on the board it could claim (the host's
             claim loop polls every 1.5 s and logs nothing, so this is end - sessions)
  wait_for   time inside a session spent in wait_for (the board tool that waits for a fact)
  shell>60s  time inside a session spent in one Bash call longer than 60 s (a shell wait)
"""
import collections, json, os, sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import analyze  # noqa: E402

COLS = ['run', 'arm', 'green', 'wall_s', 'last_session_to_settled_s', 'sessions', 'red_from_peer', 'red_waiting_producer',
        'red_waiting_rename', 'conflicts', 'same_spot', 'order_ok', 'bash_over_60s', 'wait_for', 'out_tokens',
        'idle_unclaimed_s', 'idle_wait_for_s', 'busy_share']
PRODUCER = ('stub not yet written', 'symbol not yet written')


def idle(ev, end):
    agents = sorted({r['agent'] for r in ev if r['kind'] == 'session:start'})
    open_, busy = {}, collections.Counter()
    for r in ev:
        if r['kind'] == 'session:start':
            open_[r['agent']] = r['t']
        elif r['kind'] == 'session:end' and r['agent'] in open_:
            busy[r['agent']] += r['t'] - open_.pop(r['agent'])
    for a, t in open_.items():
        busy[a] += end - t
    t0 = next((r['t'] for r in ev if r['kind'] == 'start'), 0)
    unclaimed = {a: max(0, end - t0 - busy[a]) for a in agents}
    waitfor = collections.Counter()
    for r in ev:
        if r['kind'] == 'wait_for':
            waitfor[r['agent']] += r['waited_ms']
    return agents, unclaimed, waitfor, busy


def row(run):
    a = analyze.one(run)
    ev = analyze.rows(run)
    summ = json.load(open(os.path.join(run, 'summary.json')))
    ends = [r['t'] for r in ev if r['kind'] == 'session:end']
    st = summ['settled']['t'] if summ['settled'] else None
    end = st or (summ.get('outcome') or {}).get('t') or summ['wall_ms']
    pend, longb = {}, []
    for r in ev:
        if r['kind'] == 'tool' and r['tool'] == 'Bash':
            pend[r['agent']] = r
        elif r['kind'] == 'tool:post' and r['tool'] == 'Bash' and r['agent'] in pend:
            s = pend.pop(r['agent'])
            if r['t'] - s['t'] > 60000:
                longb.append('%s %ds' % (s['agent'], round((r['t'] - s['t']) / 1000)))
    waits = [r for r in ev if r['kind'] == 'wait_for']
    order = None
    f = os.path.join(run, 'edge', 'atlas', 'validate.py')
    if os.path.exists(f):
        src = open(f).read()
        v = src.split('RULES = [', 1)[1].split(']', 1)[0] if 'RULES = [' in src else ''
        order = [x.strip().rstrip(',') for x in v.strip().split('\n') if x.strip()]
    agents, unclaimed, waitfor, busy = idle(ev, end)
    kinds = a['proof_red_kinds']
    span = max(1, end - next((r['t'] for r in ev if r['kind'] == 'start'), 0))
    return {
        'run': os.path.basename(run).split('-')[1], 'arm': a['publish_arm'], 'green': a['final_green'], 'wall_s': a['wall_s'],
        'last_session_to_settled_s': round((st - max(ends)) / 1000, 1) if st and ends else None,
        'sessions': a['sessions'],
        'red_from_peer': a['red_from_peer'],
        'red_waiting_producer': sum(kinds.get(k, 0) for k in PRODUCER),
        'red_waiting_rename': kinds.get('rename not yet landed', 0),
        'conflicts': '%d->%d%s' % (a['conflicts_opened'], a['conflicts_closed'], ' (+%d resolve task)' % a['resolve_tasks'] if a['resolve_tasks'] else '')
        + (' unions=%d' % a['conflict_unions'] if a['conflict_unions'] else ''),
        'same_spot': a['same_spot_facts'],
        'order_ok': order == ['check_name', 'check_range', 'check_country', 'check_people'] if order is not None else None,
        'bash_over_60s': ','.join(longb) or '-',
        'wait_for': '%d (%d held, %.0fs total)' % (len(waits), sum(1 for w in waits if w['held']), sum(w['waited_ms'] for w in waits) / 1000) if waits else '0',
        'out_tokens': '%.1fk' % (a['output_tokens'] / 1000),
        'idle_unclaimed_s': ' '.join('%s%.0f' % (x, unclaimed[x] / 1000) for x in agents),
        'idle_wait_for_s': ' '.join('%s%.0f' % (x, waitfor[x] / 1000) for x in agents),
        'busy_share': '%.0f%%' % (100 * sum(busy.values()) / (len(agents) * span)) if agents else None,
        '_other_red_kinds': {k: v for k, v in kinds.items() if k not in PRODUCER and k != 'rename not yet landed'},
    }


if __name__ == '__main__':
    rs = [row(r.rstrip('/')) for r in sys.argv[1:]]
    print(' | '.join(COLS))
    for r in rs:
        print(' | '.join(str(r[c]) for c in COLS))
    for r in rs:
        if r['_other_red_kinds']:
            print(r['run'], 'other red kinds:', r['_other_red_kinds'])
