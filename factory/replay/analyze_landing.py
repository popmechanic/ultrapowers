"""Read the landing replay (#1127 reading 1, map #1131): agreement against the
reviewer's own prefix, and the false-block curve the policy would pay.

Every row in the corpus is a residual the referee graded MINOR, so a row the
policy grades blocking is a false block. `borne_out` could not be asked offline,
so the rate here is an UPPER BOUND: the missing conjunct can only remove blocks.

Prints, and writes a JSON summary for the threshold sitting to read.
"""
import json, sys, collections

def load(dataset, answers):
    rows = {json.loads(l)['id']: json.loads(l) for l in open(dataset)}
    out = {}
    for l in open(answers):
        d = json.loads(l)
        if 'answers' in d:
            out[d['id']] = d
    return rows, out

def noul(a, k):
    v = a.get(k)
    return v.get('noul') if isinstance(v, dict) else None

def choice(a, k):
    v = a.get(k)
    return (v.get('choice'), v.get('confidence')) if isinstance(v, dict) else (None, None)

def rate(num, den):
    return '%5.1f%% (%d/%d)' % (100.0 * num / den, num, den) if den else '   n/a (0)'

def main(argv):
    rows, ans = load(argv[1], argv[2])
    ids = [i for i in rows if i in ans]
    print('scored %d of %d rows\n' % (len(ids), len(rows)))

    lat = sorted(ans[i]['ms'] for i in ids)
    tok = sum(ans[i].get('usage', {}).get('input_tokens', 0) for i in ids)
    print('cost and clock: %d input tokens over %d calls = $%.3f at $0.042/Mtok; '
          'latency median %d ms, p95 %d ms'
          % (tok, len(ids), tok / 1e6 * 0.042, lat[len(lat) // 2], lat[int(len(lat) * .95)]))

    summary = {'n': len(ids), 'readings': {}, 'false_block_curve': {}}

    # ---- reading A: status vs the reviewer's `unverified:` prefix -------------
    print('\n== A. `status` against the reviewer\'s own `unverified:` prefix ==')
    print('   (the prefix is opus grading itself; 118 rows carry it)')
    for lo in (0.0, 0.8, 0.9):
        tp = fp = fn = tn = 0
        for i in ids:
            c, conf = choice(ans[i]['answers'], 'status')
            said = (c == 'unverified' and (conf or 0) >= lo)
            gold = rows[i]['reviewer_prefix'] == 'unverified'
            tp += said and gold; fp += said and not gold
            fn += (not said) and gold; tn += (not said) and not gold
        prec = tp / (tp + fp) if tp + fp else 0
        rec = tp / (tp + fn) if tp + fn else 0
        print('   confidence >= %.1f   precision %s  recall %s  agreement %s'
              % (lo, rate(tp, tp + fp), rate(tp, tp + fn), rate(tp + tn, len(ids))))
        summary['readings']['status_vs_unverified_conf_%.1f' % lo] = {
            'precision': prec, 'recall': rec, 'tp': tp, 'fp': fp, 'fn': fn, 'tn': tn}

    # ---- reading B: actor=plan vs the `plan-defect:` prefix -------------------
    print('\n== B. `actor = plan` against the reviewer\'s own `plan-defect:` prefix ==')
    print('   (110 rows carry it; this is the reading that would replace routeToPlan\'s regex)')
    for lo in (0.0, 0.8, 0.9):
        tp = fp = fn = tn = 0
        for i in ids:
            c, conf = choice(ans[i]['answers'], 'actor')
            said = (c == 'plan' and (conf or 0) >= lo)
            gold = rows[i]['reviewer_prefix'] == 'plan_defect'
            tp += said and gold; fp += said and not gold
            fn += (not said) and gold; tn += (not said) and not gold
        print('   confidence >= %.1f   precision %s  recall %s  agreement %s'
              % (lo, rate(tp, tp + fp), rate(tp, tp + fn), rate(tp + tn, len(ids))))
        summary['readings']['actor_plan_vs_prefix_conf_%.1f' % lo] = {
            'tp': tp, 'fp': fp, 'fn': fn, 'tn': tn}
    # the regex it would replace, on the same rows
    tp = sum(1 for i in ids if rows[i]['route_to_plan'] and rows[i]['reviewer_prefix'] == 'plan_defect')
    fp = sum(1 for i in ids if rows[i]['route_to_plan'] and rows[i]['reviewer_prefix'] != 'plan_defect')
    fn = sum(1 for i in ids if not rows[i]['route_to_plan'] and rows[i]['reviewer_prefix'] == 'plan_defect')
    print("   today's routeToPlan regex   precision %s  recall %s" % (rate(tp, tp + fp), rate(tp, tp + fn)))
    summary['readings']['routeToPlan_regex'] = {'tp': tp, 'fp': fp, 'fn': fn}

    # ---- reading C: scope_only vs the `outside_files:` prefix -----------------
    print('\n== C. `scope_only` against the reviewer\'s own `outside_files:` prefix ==')
    print('   (98 rows carry it)')
    for t in (0.5, 0.7, 0.8, 0.9):
        tp = fp = fn = 0
        for i in ids:
            v = noul(ans[i]['answers'], 'scope_only')
            said = v is not None and v >= t
            gold = rows[i]['reviewer_prefix'] == 'outside_files'
            tp += said and gold; fp += said and not gold; fn += (not said) and gold
        print('   scope_only >= %.1f   precision %s  recall %s' % (t, rate(tp, tp + fp), rate(tp, tp + fn)))
        summary['readings']['scope_only_t%.1f' % t] = {'tp': tp, 'fp': fp, 'fn': fn}

    # ---- reading D: the false-block curve ------------------------------------
    print('\n== D. false-block rate: every one of these %d rows was graded MINOR ==' % len(ids))
    print('   policy: claim_false >= t2  AND  actor = implementer  AND  fixable_in_files >= t3')
    print('           AND  status != unverified  AND  process_only < t4')
    print('   `borne_out >= t1` could not be asked offline, so each rate is an UPPER BOUND.')
    print('\n     t2    t3    t4   would block')
    for t2 in (0.5, 0.7, 0.8, 0.9):
        for t3 in (0.5, 0.7):
            for t4 in (0.5,):
                n = 0
                for i in ids:
                    a = ans[i]['answers']
                    cf_, ff = noul(a, 'claim_false'), noul(a, 'fixable_in_files')
                    po = noul(a, 'process_only')
                    act, _ = choice(a, 'actor')
                    st, _ = choice(a, 'status')
                    if None in (cf_, ff, po):
                        continue
                    if cf_ >= t2 and act == 'implementer' and ff >= t3 and st != 'unverified' and po < t4:
                        n += 1
                print('   %5.1f %5.1f %5.1f   %s' % (t2, t3, t4, rate(n, len(ids))))
                summary['false_block_curve']['t2=%.1f,t3=%.1f,t4=%.1f' % (t2, t3, t4)] = {
                    'blocked': n, 'of': len(ids), 'rate': n / len(ids)}

    # ---- distributions, for the threshold sitting ----------------------------
    print('\n== E. distributions ==')
    for k in ('actor', 'status', 'subject'):
        c = collections.Counter(choice(ans[i]['answers'], k)[0] for i in ids)
        print('   %-8s %s' % (k, dict(c.most_common())))
        summary['readings']['dist_' + k] = dict(c.most_common())
    for k in ('claim_false', 'fixable_in_files', 'process_only', 'scope_only'):
        vs = sorted(v for v in (noul(ans[i]['answers'], k) for i in ids) if v is not None)
        print('   %-16s median %.2f  p75 %.2f  p90 %.2f  >=0.8: %s'
              % (k, vs[len(vs) // 2], vs[int(len(vs) * .75)], vs[int(len(vs) * .9)],
                 rate(sum(1 for v in vs if v >= 0.8), len(vs))))
        summary['readings']['dist_' + k] = {
            'median': vs[len(vs) // 2], 'p75': vs[int(len(vs) * .75)],
            'p90': vs[int(len(vs) * .9)], 'ge_0.8': sum(1 for v in vs if v >= 0.8), 'n': len(vs)}

    if len(argv) > 3:
        json.dump(summary, open(argv[3], 'w'), indent=2)
        print('\nsummary -> ' + argv[3])

if __name__ == '__main__':
    main(sys.argv)
