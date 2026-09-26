#!/usr/bin/env python3
"""Score the pre-registered Run Room A/B (#1292). Factory runs by target/run; Flock runs by out dir.
  ab_score.py factory popmechanic/runroom 1   |   ab_score.py flock <runs/runroom-ab1-...>"""
import json, subprocess, sys
from datetime import datetime

def gh_raw(repo, path, ref):
    r = subprocess.run(['gh', 'api', f'repos/{repo}/contents/{path}?ref={ref}', '-H', 'Accept: application/vnd.github.raw'], capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else None

def factory(repo, n):
    for ref in (f'ultra/evidence/run-{n}', f'ultra/evidence-run-{n}'):
        ev = gh_raw(repo, f'.ultrapowers/runs/{n}/events.jsonl', ref)
        if ev: break
    rows = [json.loads(l) for l in ev.splitlines() if l.strip()]
    ts = lambda r: datetime.fromisoformat(r['ts'].replace('Z', '+00:00')).timestamp()
    folds = [r for r in rows if r['kind'] == 'fold:verify']
    de = [r for r in rows if r['kind'] == 'dispatch:end']
    adopted = len({r['task'] for r in folds})
    return {'arm': 'factory', 'run': f'{repo}#{n}', 'time_s': round(ts(folds[-1]) - ts(rows[0]), 1),
            'cost_usd': round(sum(r.get('cost_usd') or 0 for r in de), 2), 'out_tokens': sum(r.get('output_tokens') or 0 for r in de),
            'dispatches': len(de), 'tasks_adopted': adopted}

def flock(out):
    s = json.load(open(f'{out}/summary.json'))
    per = (s.get('final') or {}).get('perTask') or {}
    green = sum(1 for xs in per.values() for x in xs if x == 0); total = sum(len(xs) for xs in per.values())
    return {'arm': 'flock', 'run': out.rstrip('/').split('/')[-1], 'time_s': round(s['settled']['t'] / 1000, 1) if s.get('settled') else None,
            'cost_usd': s.get('cost_usd'), 'out_tokens': (s.get('tokens') or {}).get('output'), 'sessions': s.get('sessions'),
            'probes_green': f'{green}/{total}', 'check_exit': (s.get('final') or {}).get('check'), 'outcome': s.get('outcome')}

print(json.dumps(factory(sys.argv[2], sys.argv[3]) if sys.argv[1] == 'factory' else flock(sys.argv[2])))
