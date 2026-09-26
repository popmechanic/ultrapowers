#!/usr/bin/env python3
"""PROTOTYPE (map #1292, ticket 4). One row per ledger run, in the second-pass comment's columns,
plus the two ticket-4 follow-up readings: long shell waits and the host's replace-all misses.

  python3 flock/proto/readings/ledger_table.py flock/proto/runs/ledger-FE* ...
"""
import json, os, sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import analyze  # noqa: E402

COLS = ['run', 'arm', 'green', 'wall_s', 'last_session_to_settled_s', 'conflicts', 'same_spot', 'red_from_peer',
        'red_waiting_rename', 'peer_lines', 'refusals', 'flipbacks', 'out_tokens', 'bash_over_60s', 'wait_for',
        'replay_mismatch', 'order']


def row(run):
    a = analyze.one(run)
    ev = analyze.rows(run)
    summ = json.load(open(os.path.join(run, 'summary.json')))
    ends = [r['t'] for r in ev if r['kind'] == 'session:end']
    st = summ['settled']['t'] if summ['settled'] else None
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
    if summ.get('final') and os.path.exists(os.path.join(run, 'edge', 'ledger', 'core.py')):
        src = open(os.path.join(run, 'edge', 'ledger', 'core.py')).read()
        v = src.split('VALIDATORS = [', 1)[1].split(']', 1)[0] if 'VALIDATORS = [' in src else ''
        order = [x.strip().rstrip(',') for x in v.strip().split('\n') if x.strip()]
    return {
        'run': os.path.basename(run).split('-')[0] + ' ' + os.path.basename(run).split('-')[1],
        'arm': a['publish_arm'], 'green': a['final_green'], 'wall_s': a['wall_s'],
        'last_session_to_settled_s': round((st - max(ends)) / 1000, 1) if st and ends else None,
        'conflicts': '%d->%d%s' % (a['conflicts_opened'], a['conflicts_closed'], ' (+%d resolve task)' % a['resolve_tasks'] if a['resolve_tasks'] else '')
        + (' unions=%d' % a['conflict_unions'] if a['conflict_unions'] else ''),
        'same_spot': a['same_spot_facts'], 'red_from_peer': a['red_from_peer'],
        'red_waiting_rename': a['proof_red_kinds'].get('rename not yet landed', 0),
        'peer_lines': a['peer_lines_touched'], 'refusals': a['edit_failures'], 'flipbacks': a['flipbacks'],
        'out_tokens': '%.1fk' % (a['output_tokens'] / 1000), 'bash_over_60s': ','.join(longb) or '-',
        'wait_for': '%d (%s)' % (len(waits), ','.join('%s %.0fs %s' % (w['agent'], w['waited_ms'] / 1000, 'held' if w['held'] else 'timeout') for w in waits)) if waits else '0',
        'replay_mismatch': a['edit_how'].get('edit-call-mismatch', 0), 'order': order,
    }


if __name__ == '__main__':
    rs = [row(r.rstrip('/')) for r in sys.argv[1:]]
    print(' | '.join(COLS))
    for r in rs:
        print(' | '.join(str(r[c]) for c in COLS))
