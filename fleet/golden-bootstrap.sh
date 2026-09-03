#!/bin/sh
# Bootstrap by indirection. THIS FILE IS A TEMPLATE — it refuses to run.
#
# exe.dev's `new --setup-script=/dev/stdin` reads one script on stdin, and the
# real golden build is far too long to want to ship down that pipe (over
# /exec it would not fit at all: 30 s, 64 KB). So the pipe carries this: a few
# hundred bytes that fetch the versioned build script from GitHub at one sha
# and run it. The sha is what makes a golden reproducible — the image is the
# output of `fleet/golden-setup.sh` AT A COMMIT, and nothing else.
#
# `fleet/golden.sh build` generates the runnable copy by substituting the sha.
# Never hand-edit the SHA line: an edited bootstrap and a `verify` that reads
# the checked-in script at that sha would disagree, which is the exact drift
# the stamp exists to catch.
set -eu

SHA=__GOLDEN_SHA__
URL=https://raw.githubusercontent.com/popmechanic/ultrapowers/__GOLDEN_SHA__/fleet/golden-setup.sh
OUT="${TMPDIR:-/tmp}/golden-setup.sh"

# Only the SHA= and URL= lines above are substituted, so this guard keeps the
# placeholder verbatim and an ungenerated copy refuses to run.
case "$SHA" in
  *__GOLDEN_SHA__*)
    echo 'golden-bootstrap: this is the template, not a generated bootstrap.' >&2
    echo 'Run: fleet/golden.sh print-bootstrap --sha <sha>' >&2
    exit 1
    ;;
esac

echo "[golden-bootstrap] fetching golden-setup.sh at $SHA"
curl -fsSL "$URL" -o "$OUT"
echo "[golden-bootstrap] running $OUT"
sh "$OUT"
echo '[golden-bootstrap] done'
