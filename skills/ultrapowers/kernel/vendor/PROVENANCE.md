# Vendored: manyana

- Upstream: https://github.com/bramcohen/manyana
- Upstream commit: bd77d480e7649f239c42d10a5e64565ee064dd08
- License: public domain (upstream README)
- Local patch (exactly one, for Python < 3.12 compatibility — upstream line 123
  uses PEP 701 nested same-quote f-string syntax):

    -        result.append(f'{depth} {['<', '>'][anchored_right]} {count} {line}')
    +        arrow = ('<', '>')[anchored_right]
    +        result.append(f'{depth} {arrow} {count} {line}')

- sha256 of the patched file (pinned, with this file, by the vendor-directory digest in
  tests/test_fold_wave_anchor.py M7 leg (g); read it with
  `shasum -a 256 skills/ultrapowers/kernel/vendor/manyana.py`):
  3c8ba319bb286aac0ca8f2d7ac355e2610eafa290d2f1e46c7eb5ff562220004

Re-vendoring procedure: fetch upstream, re-apply the patch hunk above, re-run
`python3 -m pytest -q` (the kernel's tests ride the suite), and update the sha256 in
this file and `FROZEN_VENDOR_DIGEST` in tests/test_fold_wave_anchor.py in the same commit.
