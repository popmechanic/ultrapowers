"""Offline replay of factory/questions.json's `landing` set over the recorded
reviewer residuals (#1127 reading 1, map #1131).

The questions are READ FROM questions.json, never retyped here: the whole point
of one judge file is that the strings a replay scores are the strings a run asks.

Three of the ten cannot be read offline and are dropped with their reason:

  borne_out, defect_visible  need `hunks`. The pre-fix patch never reaches a tag
                             and a reviewer transcript carries no `diff --git`
                             line (measured on run-183), so no diff exists for
                             these rows. #1127 reading 3 says exactly this.
  settled_by_fact            needs `sibling_facts`, which the dataset predates.

What remains is scored against the reviewer's OWN prefix, which is opus grading
itself: `unverified` (118), `plan_defect` (110), `outside_files` (98),
`undeclared_amendment` (5), none (826).

Every row in the corpus is a residual the referee graded MINOR. So any row the
policy would grade blocking is a FALSE BLOCK, and with `borne_out` absent the
rate this computes is an UPPER BOUND: the missing term can only remove blocks.

Cached to the output file, so a rerun replays rather than re-asks.
"""
import json, os, sys, time, urllib.request, urllib.error, concurrent.futures as cf

HERE = os.path.dirname(os.path.abspath(__file__))
QUESTIONS_JSON = os.path.join(HERE, os.pardir, 'questions.json')
URL = 'https://api.typesafe.ai/v1/systemone'
MODEL = 'jev-latest'
# The three the corpus cannot ground, and why — printed at every run.
UNREADABLE = {
    'borne_out': 'needs `hunks`; no diff on any tag',
    'defect_visible': 'needs `hunks`; no diff on any tag',
    'settled_by_fact': 'needs `sibling_facts`; the corpus predates them',
}

def load_questions():
    doc = json.load(open(QUESTIONS_JSON))
    qs = dict(doc['sets']['landing']['questions'])
    # The clause-bearing read is per-patch, not per-finding: it has no place here.
    qs.pop('claim_established', None)
    dropped = {k: UNREADABLE[k] for k in list(qs) if k in UNREADABLE}
    for k in dropped:
        qs.pop(k)
    return qs, dropped

def key():
    env = os.path.expanduser('~/.ultrapowers/typesafe.env')
    return dict(l.strip().split('=', 1) for l in open(env) if '=' in l)['TYPESAFE_API_KEY']

def ask(row, questions, api_key):
    state = {
        'task': {
            'title': row['task_title'], 'claim': row['task_claim'],
            'machine': row['task_machine'][:4000], 'files': row['task_files'],
        },
        'finding': {'text': row['text'][:20000], 'file': row['file'], 'line': row['line']},
    }
    body = json.dumps({'state': state, 'model': MODEL, 'questions': questions}).encode()
    last = ''
    for attempt in range(6):
        req = urllib.request.Request(URL, data=body, headers={
            'Authorization': 'Bearer ' + api_key, 'Content-Type': 'application/json'})
        t0 = time.time()
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                d = json.loads(r.read())
                return {'id': row['id'], 'ms': int((time.time() - t0) * 1000),
                        'usage': d.get('usage'), 'answers': d['answers']}
        except urllib.error.HTTPError as e:
            txt = e.read()[:300].decode(errors='replace')
            if e.code in (429, 529, 500, 502, 503):
                time.sleep(2 ** attempt); last = '%d %s' % (e.code, txt); continue
            return {'id': row['id'], 'error': '%d %s' % (e.code, txt)}
        except Exception as e:  # noqa: BLE001 — a replay reports, it does not raise
            time.sleep(2 ** attempt); last = str(e)
    return {'id': row['id'], 'error': 'gave up: ' + last}

def main(argv):
    dataset, out_path = argv[1], argv[2]
    limit = int(argv[3]) if len(argv) > 3 else None
    questions, dropped = load_questions()
    print('asking %d questions: %s' % (len(questions), ', '.join(sorted(questions))))
    for k, why in sorted(dropped.items()):
        print('  dropped %-16s %s' % (k, why))
    api_key = key()
    rows = [json.loads(l) for l in open(dataset)]
    done = set()
    if os.path.exists(out_path):
        for l in open(out_path):
            d = json.loads(l)
            if 'answers' in d:
                done.add(d['id'])
    todo = [r for r in rows if r['id'] not in done][:limit]
    print('rows %d  cached %d  todo %d' % (len(rows), len(done), len(todo)), flush=True)
    n = 0
    with open(out_path, 'a') as out, cf.ThreadPoolExecutor(8) as ex:
        for res in ex.map(lambda r: ask(r, questions, api_key), todo):
            out.write(json.dumps(res) + '\n'); out.flush(); n += 1
            if n % 100 == 0:
                print(n, flush=True)
    print('done')

if __name__ == '__main__':
    main(sys.argv)
