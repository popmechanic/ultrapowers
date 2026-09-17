"""The 50 disagreements #1127 reading 1 owes a hand read, stratified.

The reviewer's prefix is opus grading ITSELF, inconsistently — that inconsistency
is the premise of the whole cut. So a Jev/prefix disagreement is not a Jev error
by default; it is the thing a person has to look at. This draws a stratified 50
so the sitting that chooses thresholds reads every disagreement class rather than
fifty of whichever one is most common.

Deterministic: seeded, so the same corpus draws the same fifty.
"""
import json, random, sys, collections

def main(argv):
    rows = {json.loads(l)['id']: json.loads(l) for l in open(argv[1])}
    ans = {}
    for l in open(argv[2]):
        d = json.loads(l)
        if 'answers' in d:
            ans[d['id']] = d['answers']
    out_path = argv[3]

    def ch(i, k):
        v = ans[i].get(k, {})
        return v.get('choice'), v.get('confidence') or 0
    def nl(i, k):
        v = ans[i].get(k, {})
        return v.get('noul')

    strata = collections.defaultdict(list)
    for i in ids_of(rows, ans):
        pre = rows[i]['reviewer_prefix']
        st, stc = ch(i, 'status')
        ac, acc = ch(i, 'actor')
        # Each bucket is one way the two readings part company.
        if pre == 'plan_defect' and ac != 'plan':
            strata['plan_prefix_jev_disagrees'].append(i)
        elif pre is None and ac == 'plan' and acc >= 0.8:
            strata['no_prefix_jev_says_plan'].append(i)
        elif pre == 'unverified' and st != 'unverified':
            strata['unverified_prefix_jev_disagrees'].append(i)
        elif pre is None and st == 'unverified' and stc >= 0.9:
            strata['no_prefix_jev_says_unverified'].append(i)
        elif pre == 'outside_files' and (nl(i, 'scope_only') or 0) < 0.5:
            strata['outside_files_prefix_jev_low_scope'].append(i)
        elif pre is None and (nl(i, 'claim_false') or 0) >= 0.7:
            # the class that would BLOCK: a minor the policy might promote
            strata['would_block_graded_minor'].append(i)

    rng = random.Random(1131)
    picked, per = [], max(1, 50 // max(1, len(strata)))
    for name in sorted(strata):
        pool = sorted(strata[name])
        rng.shuffle(pool)
        picked += [(name, i) for i in pool[:per]]
    # top up to 50 from the largest strata, deterministically
    rest = [(n, i) for n in sorted(strata) for i in sorted(strata[n]) if (n, i) not in picked]
    rng.shuffle(rest)
    picked += rest[:max(0, 50 - len(picked))]

    with open(out_path, 'w') as f:
        for name, i in picked[:50]:
            f.write(json.dumps({
                'stratum': name, 'id': i,
                'reviewer_prefix': rows[i]['reviewer_prefix'],
                'jev': {k: ans[i].get(k) for k in
                        ('actor', 'status', 'subject', 'claim_false',
                         'fixable_in_files', 'process_only', 'scope_only')},
                'task_claim': rows[i]['task_claim'][:400],
                'task_files': rows[i]['task_files'],
                'text': rows[i]['text'][:1500],
                'hand_read': None,  # the sitting fills this: who is right, and why
            }) + '\n')
    print('strata:')
    for name in sorted(strata):
        print('  %-34s %4d in corpus, %d drawn'
              % (name, len(strata[name]), sum(1 for n, _ in picked[:50] if n == name)))
    print('wrote %d rows -> %s' % (min(50, len(picked)), out_path))

def ids_of(rows, ans):
    return [i for i in rows if i in ans]

if __name__ == '__main__':
    main(sys.argv)
