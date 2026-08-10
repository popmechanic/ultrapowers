# Vendored: manyana

- Upstream: https://github.com/bramcohen/manyana
- Upstream commit: bd77d480e7649f239c42d10a5e64565ee064dd08
- License: public domain (upstream README)
- Local patch (exactly one, for Python < 3.12 compatibility — upstream line 123
  uses PEP 701 nested same-quote f-string syntax):

    -        result.append(f'{depth} {['<', '>'][anchored_right]} {count} {line}')
    +        arrow = ('<', '>')[anchored_right]
    +        result.append(f'{depth} {arrow} {count} {line}')

- sha256 of the patched file (pinned by tests/test_frontier_kernel.py):
  3c8ba319bb286aac0ca8f2d7ac355e2610eafa290d2f1e46c7eb5ff562220004

Re-vendoring procedure: fetch upstream, re-apply the patch hunk above, re-run
`python3 evals/frontier/vendor/manyana.py` (all tests must pass), update the
sha256 in BOTH this file and tests/test_frontier_kernel.py in the same commit.
