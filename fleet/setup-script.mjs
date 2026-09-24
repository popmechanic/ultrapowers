/**
 * fleet/setup-script.mjs — the per-run first-boot setup script.
 *
 * exe.dev runs `--setup-script` exactly once, at first boot, as `exedev`, with
 * HOME/USER/PATH set and nothing else — no XDG_RUNTIME_DIR, passwordless
 * `sudo -n`, the file piped in as /dev/stdin and capped at 10 KiB. The image
 * already ships claude, gh, busybox, git, jq and python3; the delta this script
 * installs is exactly node, bun, celld and pytest — kata is the engine boot's to install, at the
 * version its own sha pins (#1190). It also drops the two files a run
 * needs — the bootstrap at /usr/local/lib/fleet/bootstrap.sh (root-owned, 0555)
 * and the unit template in the user's own systemd directory — waits for the
 * user bus, starts the run, and deletes itself.
 *
 * The run number is baked in as a literal: the script is generated per run and
 * reads no environment variable for it, so a box can never run someone else's
 * assignment because a unit file leaked an --env.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** exe.dev's ceiling for a `--setup-script` payload. */
export const SETUP_SCRIPT_MAX_BYTES = 10240
/** The fleet's own, tighter budget for the same payload: headroom under the
 *  platform's ceiling, so a growing bootstrap is noticed on the laptop before
 *  the lobby refuses it. */
export const SETUP_SCRIPT_BUDGET_BYTES = 9216
export const NODE_VERSION = '24.20.0'
export const BUN_VERSION = '1.4.2'
export const CELLD_VERSION = '0.5.0'
/**
 * The digest of celld's one x86_64 Linux asset, read on the laptop at the bump
 * (`shasum -a 256`, 2026-09-17) and measured again on an exe VM the same day.
 * A literal and not a sums file because the release carries neither: it ships
 * the three `.gz` assets and nothing else, and the attestation check needs a
 * token this sandbox deliberately does not hold — so the record is here, beside
 * bun's version, and it moves only when a human bumps CELLD_VERSION.
 */
export const CELLD_SHA256 = '1039eee3737bb432ca0cd399fc55cc0aab4e653b2beae26009e455fea4e5334c'

const NODE_TARBALL = `node-v${NODE_VERSION}-linux-x64.tar.xz`
const NODE_URL = `https://nodejs.org/dist/v${NODE_VERSION}/${NODE_TARBALL}`
const SHASUMS_URL = `https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt`
const BUN_URL =
  `https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-x64.zip`
const CELLD_ASSET = 'celld-x86_64-unknown-linux-gnu.gz'
// Straight to /usr/local/bin (root-owned 0755, on PATH for `/bin/sh -c` — the
// bun lesson), never through the vendor's own installer script, whose rollback
// symlinks are worthless on a VM that lives for one run, and never under
// /usr/local/lib/fleet, which is the immutable bootstrap's path.
const CELLD_URL =
  `https://github.com/denoland/celld/releases/download/v${CELLD_VERSION}/${CELLD_ASSET}`

const BOOTSTRAP_TAG = 'FLEET_BOOTSTRAP_EOF'
const UNIT_TAG = 'FLEET_UNIT_EOF'

/** The two files the script carries, as they sit beside this module. */
export function readFleetFiles() {
  return {
    bootstrap: fs.readFileSync(path.join(HERE, 'fleet-bootstrap.sh'), 'utf8'),
    unit: fs.readFileSync(path.join(HERE, 'fleet-run@.service'), 'utf8'),
  }
}

// A quoted heredoc body: the bytes arrive unexpanded, so the only thing that can
// go wrong is the delimiter appearing inside them. Say so rather than truncate.
function heredocBody(tag, text) {
  const body = text.endsWith('\n') || text === '' ? text : `${text}\n`
  if (body.split('\n').includes(tag)) {
    throw new Error(`embedded file carries the heredoc delimiter ${tag} on a line of its own`)
  }
  return body
}

/**
 * The setup script for one run. `bootstrap` and `unit` are carried verbatim.
 */
export function renderSetupScript({ run, bootstrap, unit }) {
  if (!/^[0-9]+$/.test(String(run))) throw new Error(`run must be digits, got ${run}`)

  const script = `#!/usr/bin/env bash
# fleet first-boot setup, generated for one run and thrown away by its own last
# line. Installs the delta the image lacks, drops the bootstrap and the unit
# template, then starts the run.
set -euo pipefail
RUN=${run}
exec >>"$HOME/fleet-setup.log" 2>&1
LIB="\${FLEET_LIB_DIR:-/usr/local/lib/fleet}"
BUS="\${FLEET_USER_BUS:-/run/user/$(id -u)/bus}"
BUS_WAIT="\${FLEET_BUS_WAIT_SECONDS:-60}"
# The platform hands this script HOME/USER/PATH and nothing else, so systemd's
# client has no address for the user bus and every --user call below would die
# with "Failed to connect to bus" even once the socket is there. Pointed at the
# socket this script waits for.
XDG_RUNTIME_DIR="\${XDG_RUNTIME_DIR:-$(dirname "$BUS")}"
DBUS_SESSION_BUS_ADDRESS="\${DBUS_SESSION_BUS_ADDRESS:-unix:path=$BUS}"
export XDG_RUNTIME_DIR DBUS_SESSION_BUS_ADDRESS
work="$(mktemp -d)"
cd "$work"

# The platform's setup unit starts ahead of user@.service, so the user bus may
# not exist yet and a --user call would fail with "Failed to connect to bus".
# The deadline is in seconds of wall clock, not a count of tries.
deadline=$(( $(date +%s%3N) + BUS_WAIT * 1000 ))
while [ ! -S "$BUS" ]; do
  if [ "$(date +%s%3N)" -ge "$deadline" ]; then
    echo "setup: no user bus at $BUS"
    exit 1
  fi
  sleep 0.2
done

# node: nodejs.org only, and only once the release's own sums agree.
curl -fsSL -o SHASUMS256.txt ${SHASUMS_URL}
curl -fsSL -o ${NODE_TARBALL} ${NODE_URL}
grep " ${NODE_TARBALL}$" SHASUMS256.txt | sha256sum -c -
sudo -n tar -xJf ${NODE_TARBALL} -C /usr/local --strip-components=1

# bun: the pinned release, with bunx beside it.
curl -fsSL -o bun.zip ${BUN_URL}
unzip -q -o bun.zip
sudo -n install -m 0755 bun-linux-x64/bun /usr/local/bin/bun
sudo -n ln -sf bun /usr/local/bin/bunx

# celld: the pinned release, against the digest the plugin records.
curl -fsSL -o ${CELLD_ASSET} ${CELLD_URL}
echo '${CELLD_SHA256}  ${CELLD_ASSET}' | sha256sum -c -
gzip -dc ${CELLD_ASSET} >celld
sudo -n install -m 0755 celld /usr/local/bin/celld

# pytest: python3 here is externally managed, so apt is the only sane path.
sudo -n apt-get update -qq
sudo -n apt-get install -y --no-install-recommends python3-pytest python3-pytest-xdist

# Quoted heredocs: both files land as handed in, expanding nothing.
cat <<'${BOOTSTRAP_TAG}' >bootstrap.sh
${heredocBody(BOOTSTRAP_TAG, bootstrap)}${BOOTSTRAP_TAG}
sudo -n install -d -m 0755 "$LIB"
sudo -n install -m 0555 bootstrap.sh "$LIB/bootstrap.sh"
mkdir -p "$HOME/.config/systemd/user" "$HOME/.claude"
cat <<'${UNIT_TAG}' >"$HOME/.config/systemd/user/fleet-run@.service"
${heredocBody(UNIT_TAG, unit)}${UNIT_TAG}
printf '%s\\n' '{"env":{"CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS":"0"},"permissions":{"defaultMode":"bypassPermissions"}}' >"$HOME/.claude/settings.json"
git config --global user.name fleet
git config --global user.email fleet@exe.dev


systemctl --user daemon-reload
# Credentials reach this box by the policy tag:fleet, with no documented order
# against this script; wait, bounded, until Reflection lists claude-max.
for i in $(seq 1 30); do
  curl -fsS https://reflection.int.exe.xyz/integrations | grep -q '"claude-max"' && break
  sleep 2
done
systemctl --user start "fleet-run@$RUN.service"
sudo -n rm -f -- "$0"
`

  // The fleet's budget is the tighter of the two, so it is the one that fails
  // first and the one the message always names — a render over the platform's
  // ceiling is over the budget too, and a reader told only about 10240 would
  // think the payload had room it does not have.
  const bytes = Buffer.byteLength(script, 'utf8')
  if (bytes > SETUP_SCRIPT_BUDGET_BYTES) {
    const past = bytes > SETUP_SCRIPT_MAX_BYTES
      ? ` (and past the platform's ceiling of ${SETUP_SCRIPT_MAX_BYTES})`
      : ''
    throw new Error(
      `setup script is ${bytes} bytes; the fleet's budget is ${SETUP_SCRIPT_BUDGET_BYTES}${past}`)
  }
  return script
}
