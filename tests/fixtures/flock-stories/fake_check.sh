#!/bin/sh
# Stands in for factory/stack/tinyapp/check.ts in the Flock's own tests: exit 0
# when the copy holds `ok`, 2 when it holds `env-broken`, 1 otherwise.
test -f env-broken && { echo "fake checker: the environment is broken"; exit 2; }
test -f ok && exit 0
echo "fake checker: no ok file in $(pwd)"
exit 1
