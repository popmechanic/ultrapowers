#!/usr/bin/env bash
# The golden, in three verbs: build, verify, swap.
#
#   fleet/golden.sh build  [--sha <sha>] [--name fleet-golden-next]
#   fleet/golden.sh verify <name> [--sha <sha>]
#   fleet/golden.sh swap   [--from fleet-golden-next] [--to fleet-golden]
#   fleet/golden.sh print-bootstrap [--sha <sha>]
#
# An image is the output of `fleet/golden-setup.sh` AT A COMMIT. `build` bakes
# that commit into a tiny bootstrap, pipes the bootstrap into `new`, and waits
# for the stamp the setup script writes at its last line. `verify` compares
# that stamp against the checked-in script, so an image and the script that
# claims to describe it cannot drift unnoticed.
#
# Never `rm fleet-golden` to make room for a rebuild: a build that fails
# partway then leaves no golden and no run can be provisioned until it is
# repaired. Build the replacement under a second name, verify it, drive a real
# run on it, and only then `swap`.
#
# Every lobby and VM command goes through run_ssh(), so a test can stub the
# whole platform with FLEET_SSH=<path to a stub executable>.
set -euo pipefail

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
SETUP_REL=fleet/golden-setup.sh
TEMPLATE="$ROOT/fleet/golden-bootstrap.sh"
PLACEHOLDER=__GOLDEN_SHA__

DEFAULT_BUILD_NAME=fleet-golden-next
DEFAULT_GOLDEN_NAME=fleet-golden
POLL_SECONDS=${FLEET_POLL_SECONDS:-15}
BUILD_TIMEOUT=${FLEET_BUILD_TIMEOUT:-900}   # 15 minutes

say()  { printf '%s\n' "$*"; }
die()  { printf 'golden.sh: %s\n' "$*" >&2; exit 1; }

# The one seam. Tests point FLEET_SSH at a stub; nothing else in this file
# knows how to reach exe.dev.
run_ssh() { "${FLEET_SSH:-ssh}" "$@"; }

sha256_stdin() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum | cut -d' ' -f1
  else shasum -a 256 | cut -d' ' -f1; fi
}

# A VM name reaches a shell on exe.dev's side; keep it to what a name can be.
valid_name() { [[ $1 =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]]; }
valid_sha()  { [[ $1 =~ ^[0-9a-f]{40}$ ]]; }

# The bytes of fleet/golden-setup.sh at <sha> — the image's definition. Falls
# back to the working tree when the sha is not in this clone (a freshly pushed
# commit on another machine), and says so, because the stamp it predicts would
# then be a guess.
setup_bytes_at() {
  local sha=$1
  if [ -n "$sha" ] && git -C "$ROOT" cat-file -e "$sha:$SETUP_REL" 2>/dev/null; then
    git -C "$ROOT" show "$sha:$SETUP_REL"
  else
    if [ -n "$sha" ]; then
      printf 'golden.sh: %s not in this clone; using the working tree\n' "$sha" >&2
    fi
    cat "$ROOT/$SETUP_REL"
  fi
}

expected_stamp_at() { setup_bytes_at "$1" | sha256_stdin; }

# The bootstrap is the template with the sha substituted. Generated, never
# hand-edited: the sha in the URL and the sha `verify` reads must be one value.
render_bootstrap() {
  local sha=$1
  [ -f "$TEMPLATE" ] || die "missing $TEMPLATE"
  sed -e "/^SHA=/s/$PLACEHOLDER/$sha/" -e "/^URL=/s/$PLACEHOLDER/$sha/" "$TEMPLATE"
}

resolve_sha() {
  local sha=${1:-}
  if [ -z "$sha" ]; then sha=$(git -C "$ROOT" rev-parse HEAD); fi
  valid_sha "$sha" || die "not a 40-hex sha: $sha"
  printf '%s\n' "$sha"
}

cmd_print_bootstrap() {
  local sha=''
  while [ $# -gt 0 ]; do
    case $1 in
      --sha) sha=${2:-}; shift 2 ;;
      *) die "print-bootstrap: unknown argument $1" ;;
    esac
  done
  render_bootstrap "$(resolve_sha "$sha")"
}

cmd_build() {
  local sha='' name=$DEFAULT_BUILD_NAME print=0
  while [ $# -gt 0 ]; do
    case $1 in
      --sha)  sha=${2:-}; shift 2 ;;
      --name) name=${2:-}; shift 2 ;;
      --print-bootstrap) print=1; shift ;;
      *) die "build: unknown argument $1" ;;
    esac
  done
  sha=$(resolve_sha "$sha")
  valid_name "$name" || die "not a VM name: $name"

  if [ "$print" = 1 ]; then render_bootstrap "$sha"; return 0; fi

  local expected boot
  expected=$(expected_stamp_at "$sha")
  boot=$(mktemp "${TMPDIR:-/tmp}/golden-bootstrap.XXXXXX")
  # shellcheck disable=SC2064
  trap "rm -f '$boot'" EXIT
  render_bootstrap "$sha" > "$boot"

  say "build: $name from $SETUP_REL at $sha"
  say "build: expecting stamp $expected"
  say "build: bootstrap is $(wc -c < "$boot" | tr -d ' ') bytes"
  # The tag is what makes the copy reachable: `cp` inherits tags, and every
  # read-only target grant is attached to tag:fleet.
  run_ssh exe.dev "new --name=$name --cpu=8 --memory=16GB --tag=fleet --setup-script=/dev/stdin --json" < "$boot"

  local waited=0 got=''
  while [ "$waited" -lt "$BUILD_TIMEOUT" ]; do
    got=$(run_ssh "$name.exe.xyz" 'cat /home/exedev/.fleet-golden' 2>/dev/null | tr -d '\r\n ' || true)
    if [ "$got" = "$expected" ]; then
      say "build: $name stamped $got after ${waited}s"
      say "build: next — fleet/golden.sh verify $name --sha $sha"
      return 0
    fi
    sleep "$POLL_SECONDS"
    waited=$((waited + POLL_SECONDS))
    say "build: waiting (${waited}s) — stamp so far: ${got:-<none>}"
  done
  die "build: $name did not reach stamp $expected within ${BUILD_TIMEOUT}s (last: ${got:-<none>})"
}

cmd_verify() {
  local name=${1:-}; shift || true
  local sha=''
  [ -n "$name" ] || die 'verify: needs a VM name'
  while [ $# -gt 0 ]; do
    case $1 in
      --sha) sha=${2:-}; shift 2 ;;
      *) die "verify: unknown argument $1" ;;
    esac
  done
  valid_name "$name" || die "not a VM name: $name"
  [ -z "$sha" ] || valid_sha "$sha" || die "not a 40-hex sha: $sha"

  local host="$name.exe.xyz" expected got
  expected=$(expected_stamp_at "$sha")

  got=$(run_ssh "$host" 'cat /home/exedev/.fleet-golden' 2>/dev/null | tr -d '\r\n ' || true)
  if [ "$got" != "$expected" ]; then
    die "stamp: $name has ${got:-<none>}, $SETUP_REL is $expected"
  fi
  say "stamp: $got"

  local out
  # The image's one moving part: the immutable bootstrap, executable, outside
  # every checkout. Its bytes are the setup script's concern (the stamp above).
  out=$(run_ssh "$host" 'stat -c %a /home/exedev/fleet-bootstrap.sh' | tr -d '\r\n ' || true)
  [ "$out" = '755' ] || die "fleet-bootstrap.sh: mode is ${out:-<none>}, want 755"
  say 'fleet-bootstrap.sh: 755'

  # Installed, never enabled: the launcher starts it. `static` is what a unit
  # with no [Install] section reads as; `disabled` would be one that grew an
  # [Install] and was still left alone. `enabled` is a golden that runs
  # something at boot with no assignment — the v1 shape.
  out=$(run_ssh "$host" 'XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user is-enabled fleet-run.service' | tr -d '\r\n ' || true)
  case "$out" in
    static|disabled) say "fleet-run.service: $out" ;;
    *) die "fleet-run.service: ${out:-<none>}, want static or disabled" ;;
  esac

  # No engine pre-clone. A repo in the image is exactly the stale boot script
  # run-68 died on; the bootstrap clones each run's engine at its own sha.
  out=$(run_ssh "$host" 'test -e /home/exedev/repo && echo present || echo absent' | tr -d '\r\n ' || true)
  [ "$out" = 'absent' ] || die "/home/exedev/repo: ${out:-<none>}, want absent"
  say '/home/exedev/repo: absent'

  out=$(run_ssh "$host" 'busybox --list | grep -cx httpd' | tr -d '\r\n ' || true)
  [ "$out" = '1' ] || die "busybox: httpd applet ${out:-<none>}, want 1"
  say 'busybox: httpd'

  out=$(run_ssh "$host" 'gh --version' | head -n 1 | tr -d '\r\n' || true)
  [ -n "$out" ] || die 'gh: not installed'
  say "gh: $out"

  out=$(run_ssh "$host" 'node --version' | tr -d '\r\n ' || true)
  [ -n "$out" ] || die 'node: not installed'
  say "node: $out"

  out=$(run_ssh "$host" 'npm --version' | tr -d '\r\n ' || true)
  [ -n "$out" ] || die 'npm: not installed'
  say "npm: $out"

  # A non-login shell, the way the engine runs the suite. `bash -lc` here would
  # be a check that cannot fail — it passes on exactly the broken image.
  out=$(run_ssh "$host" "bash -c 'bun --version'" | tr -d '\r\n ' || true)
  [ -n "$out" ] || die 'bun: not on the non-login PATH'
  say "bun: $out"

  out=$(run_ssh "$host" "python3 -c 'import xdist; print(xdist.__version__)'" | tr -d '\r\n ' || true)
  [ -n "$out" ] || die 'xdist: not importable'
  say "xdist: $out"

  out=$(run_ssh "$host" 'stat -c %a /home/exedev/.claude/settings.json' | tr -d '\r\n ' || true)
  [ "$out" = '600' ] || die "settings.json: mode is ${out:-<none>}, want 600"
  say 'settings.json: 600'

  # The OAuth token lives at exe.dev's edge. An image that carries ANTHROPIC_*
  # is an image that could leak a subscription if a clone were compromised.
  # The files a shell or Claude Code would read a variable from, and the
  # bootstrap itself.
  out=$(run_ssh "$host" 'grep -l ANTHROPIC_ /home/exedev/.claude/settings.json /home/exedev/.bashrc /home/exedev/.profile /home/exedev/fleet-bootstrap.sh 2>/dev/null | wc -l' | tr -d '\r\n ' || true)
  [ "$out" = '0' ] || die "ANTHROPIC_*: named in ${out:-?} file(s), want 0"
  say 'no ANTHROPIC_*'

  say "verify: $name is a good golden"
}

cmd_swap() {
  local from=$DEFAULT_BUILD_NAME to=$DEFAULT_GOLDEN_NAME
  while [ $# -gt 0 ]; do
    case $1 in
      --from) from=${2:-}; shift 2 ;;
      --to)   to=${2:-}; shift 2 ;;
      *) die "swap: unknown argument $1" ;;
    esac
  done
  valid_name "$from" || die "not a VM name: $from"
  valid_name "$to"   || die "not a VM name: $to"

  # Removing the old golden first is safe only because the replacement already
  # exists and has been verified — that is the whole reason swap is its own verb.
  say "swap: rm $to"
  run_ssh exe.dev "rm $to --json" || say "swap: $to did not exist; continuing"
  say "swap: rename $from -> $to"
  run_ssh exe.dev "rename $from $to"

  local listing
  listing=$(run_ssh exe.dev 'ls --json')
  printf '%s' "$listing" | grep -q "\"$to\"" || die "swap: $to is not in ls --json after the rename"
  if printf '%s' "$listing" | grep -q "\"$from\""; then
    die "swap: $from is still in ls --json after the rename"
  fi
  say "swap: $to is the golden"
}

main() {
  local verb=${1:-}
  [ $# -gt 0 ] && shift || true
  case $verb in
    build)            cmd_build "$@" ;;
    verify)           cmd_verify "$@" ;;
    swap)             cmd_swap "$@" ;;
    print-bootstrap)  cmd_print_bootstrap "$@" ;;
    --print-bootstrap) cmd_print_bootstrap "$@" ;;
    ''|-h|--help|help)
      sed -n '2,9p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      [ -z "$verb" ] && exit 1 || exit 0
      ;;
    *) die "unknown verb: $verb" ;;
  esac
}

main "$@"
