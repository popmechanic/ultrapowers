#!/usr/bin/env python3
"""The wrong-plans reading: how a run coped with a plan that carried one planted flaw.

    python3 evals/readings/wrong_plans.py <evidence clone> <id>=<run> ... [--jev] [--json <file>]

The plans, their flaws and what coping well looks like are `evals/fixtures/wrong_plans/manifest.json`.
Each is launched held (`fleet/launch.mjs <plan> --target <manifest target> --base <manifest base>
--hold`), so no run merges and every run starts from the same commit. `<id>=<run>` names the run a
plan got; `<id>=gate` says the launcher refused it on its proof-gate record, which is a result.

For each run this reads `events.jsonl`, `engine.log` and `status.json` at the run's tag in the
evidence clone and prints one row of counted facts: how it ended, wall seconds, builder sessions,
tasks reopened red, tasks given back, conflicts opened, tasks the engine added, files written
outside the plan, beliefs posted, and dollars. `--jev` adds one judgment, `said so`: whether
anything the builders wrote states the planted flaw (`questions.json` beside this file, asked of
TypeSafe with the key in `~/.ultrapowers/typesafe.env`). Every message read is printed under the
table, so a person can check the judgment.
"""
import json, os, subprocess, sys, urllib.request
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
MANIFEST = os.path.join(HERE, '..', 'fixtures', 'wrong_plans', 'manifest.json')


def show(evidence, slug, run, name):
    # the run's tag, else its live branch: a run whose tag did not verify keeps the branch
    for ref in ('%s/run-%s' % (slug, run), 'origin/live/%s/run-%s' % (slug, run)):
        r = subprocess.run(['git', '-C', evidence, 'show', '%s:runs/%s/%s/%s' % (ref, slug, run, name)],
                           capture_output=True, text=True, errors='replace')
        if r.returncode == 0:
            return r.stdout
    return ''


def when(ts):
    return datetime.fromisoformat(ts.replace('Z', '+00:00'))


def read_run(evidence, slug, run):
    rows = []
    for line in show(evidence, slug, run, 'events.jsonl').splitlines():
        try:
            rows.append(json.loads(line))
        except ValueError:
            pass
    if not rows:
        return None
    of = lambda kind: [e for e in rows if e.get('kind') == kind]
    try:
        status = json.loads(show(evidence, slug, run, 'status.json'))
    except ValueError:
        status = {}
    start, ends = of('start'), of('terminal')
    end = ends[-1] if ends else {}
    cost = None
    for line in show(evidence, slug, run, 'engine.log').splitlines():
        at = line.find('"cost_usd":')
        if at >= 0:
            cost = float(line[at + 11:].split(',')[0].split('}')[0])
    sessions = of('session:end')
    added = sorted({str(e.get('task')) for e in of('session:start') if str(e.get('task'))[:2] in ('R:', 'L:', 'C:')})
    said = ['%s: %s' % (e.get('by'), e.get('claim')) for e in of('belief') if e.get('by') != 'host']
    said += ['%s, closing task %s: %s' % (e.get('agent'), e.get('task'), e.get('done')) for e in sessions if e.get('done')]
    said += ['the run ended: %s' % e.get('why') for e in ends if e.get('why')]
    return {
        'run': run, 'state': status.get('state'), 'ended': end.get('pr'), 'why': end.get('why'),
        'wall_s': round((when(end['ts']) - when(start[0]['ts'])).total_seconds()) if start and end.get('ts') else None,
        'sessions': len(sessions), 'red_proofs': sum(e.get('redRuns') or 0 for e in sessions),
        'reopened': len(of('reopen')), 'given_back': sum(1 for e in sessions if e.get('released')),
        'parked_tasks': len(of('task:parked')), 'conflicts': len(of('conflict:open')), 'engine_tasks': added,
        'outside_plan': sorted({e.get('path') for e in of('driver:amendment') if e.get('path')}),
        'beliefs': len([e for e in of('belief') if e.get('by') != 'host']), 'cost_usd': cost, 'said': said,
    }


def ask_jev(flaw, said):
    """`named`, `hinted` or `silent` with its confidence, or None when Jev did not answer."""
    try:
        env = open(os.path.join(os.path.expanduser('~'), '.ultrapowers', 'typesafe.env')).read()
        key = [l.split('=', 1)[1].strip() for l in env.splitlines() if l.startswith('TYPESAFE_API_KEY=')][0]
        q = json.load(open(os.path.join(HERE, 'questions.json')))['sets']['wrong_plan']['questions']['noticed']
        body = json.dumps({'state': {'flaw': flaw, 'said': said}, 'model': 'jev-latest', 'questions': {'noticed': q}}).encode()
        req = urllib.request.Request('https://api.typesafe.ai/v1/systemone', data=body, method='POST',
                                     headers={'content-type': 'application/json', 'authorization': 'Bearer ' + key})
        a = json.load(urllib.request.urlopen(req, timeout=60))['answers']['noticed']
        return {'answer': a.get('choice'), 'confidence': a.get('confidence')}
    except Exception:
        return None


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    evidence, picks, jev, out = argv[0], {}, '--jev' in argv, None
    if '--json' in argv:
        out = argv[argv.index('--json') + 1]
    for a in argv[1:]:
        if '=' in a and not a.startswith('--'):
            k, v = a.split('=', 1)
            picks[k] = v
    manifest = json.load(open(MANIFEST))
    slug = manifest['target'].replace('/', '-')
    results = []
    for plan in manifest['plans']:
        got = picks.get(plan['id'])
        if got is None:
            continue
        if got == 'gate':
            results.append({'id': plan['id'], 'expect': plan['expect'], 'gate': 'refused'})
            continue
        r = read_run(evidence, slug, got)
        if r is None:
            results.append({'id': plan['id'], 'expect': plan['expect'], 'run': got, 'missing': True})
            continue
        r.update(id=plan['id'], expect=plan['expect'], flaw=plan['flaw'])
        if jev and plan['flaw']:
            r['said_so'] = ask_jev(plan['flaw'], r['said'])
        results.append(r)
    cols = ['plan', 'expected', 'ended', 'wall s', 'sessions', 'reopened', 'given back', 'conflicts', 'engine tasks', 'outside plan', 'beliefs', 'said so', '$']
    table = []
    for r in results:
        if r.get('gate'):
            table.append([r['id'], r['expect'], 'refused at the gate'] + ['-'] * 10)
        elif r.get('missing'):
            table.append([r['id'], r['expect'], 'no record for run %s' % r['run']] + ['-'] * 10)
        else:
            s = r.get('said_so')
            table.append([r['id'], r['expect'], '%s (%s)' % (r['ended'] or r['state'], (r['why'] or '')[:44]), r['wall_s'], r['sessions'], r['reopened'],
                          r['given_back'], r['conflicts'], ' '.join(r['engine_tasks']) or '-', ' '.join(r['outside_plan']) or '-', r['beliefs'],
                          ('%s %.2f' % (s['answer'], s['confidence'] or 0)) if s else '-', r['cost_usd'] if r['cost_usd'] is not None else '-'])
    widths = [max(len(str(x)) for x in col) for col in zip(cols, *table)] if table else [len(c) for c in cols]
    for row in [cols] + table:
        print('  '.join(str(x).ljust(w) for x, w in zip(row, widths)).rstrip())
    for r in results:
        if r.get('said'):
            print('\n== %s (run %s): what was written down' % (r['id'], r['run']))
            for line in r['said']:
                print('  - ' + ' '.join(str(line).split())[:600])
    if out:
        json.dump({'target': manifest['target'], 'base': manifest['base'], 'results': results}, open(out, 'w'), indent=1)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
