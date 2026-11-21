import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

export const SETUP_SCRIPT_MAX_BYTES = 10240
export const SETUP_SCRIPT_BUDGET_BYTES = 9216
export const NODE_VERSION = '24.22.1'
export const BUN_VERSION = '1.4.4'
export const CELLD_VERSION = '0.6.1'
export const CELLD_SHA256 = '79a8253cff5d4e8a4a9f7a2611e393390f7fe9025f00e88467875b007c44866b'

const NODE_TARBALL = `node-v${NODE_VERSION}-linux-x64.tar.xz`
const NODE_URL = `https://nodejs.org/dist/v${NODE_VERSION}/${NODE_TARBALL}`
const SHASUMS_URL = `https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt`
const BUN_URL =
  `https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-x64.zip`
const CELLD_ASSET = 'celld-x86_64-unknown-linux-gnu.gz'
const CELLD_URL =
  `https://github.com/denoland/celld/releases/download/v${CELLD_VERSION}/${CELLD_ASSET}`

const BOOTSTRAP_TAG = 'FLEET_BOOTSTRAP_EOF'
const UNIT_TAG = 'FLEET_UNIT_EOF'

export function readFleetFiles() {
  return {
    bootstrap: fs.readFileSync(path.join(HERE, 'fleet-bootstrap.sh'), 'utf8'),
    unit: fs.readFileSync(path.join(HERE, 'fleet-run@.service'), 'utf8'),
  }
}

function heredocBody(tag, text) {
  const body = text.endsWith('\n') || text === '' ? text : `${text}\n`
  if (body.split('\n').includes(tag)) {
    throw new Error(`embedded file carries the heredoc delimiter ${tag} on a line of its own`)
  }
  return body
}

const EVIDENCE_REPO = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/

export function renderSetupScript({ run, evidence, bootstrap, unit }) {
  if (!/^[0-9]+$/.test(String(run))) throw new Error(`run must be digits, got ${run}`)
  if (typeof evidence !== 'string' || !EVIDENCE_REPO.test(evidence) || /\/\.\.?$/.test(evidence)) {
    throw new Error(`evidence must be <owner>/<repo>, got ${JSON.stringify(evidence ?? null)}`)
  }

  const script = `#!/usr/bin/env bash
# fleet first-boot setup, generated for one run and thrown away by its own last
# line. Installs the delta the image lacks, drops the bootstrap and the unit
# template, then starts the run.
set -euo pipefail
RUN=${run}
exec >>"$HOME/fleet-setup.log" 2>&1
stamp() { printf '%s setup: %s\\n' "$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)" "$1"; }
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
stamp bus
deadline=$(( $(date +%s%3N) + BUS_WAIT * 1000 ))
while [ ! -S "$BUS" ]; do
  if [ "$(date +%s%3N)" -ge "$deadline" ]; then
    echo "setup: no user bus at $BUS"
    exit 1
  fi
  sleep 0.2
done

# The three fetches are latency-bound, so all start at once; each is its own
# job, waited on by its own pid, so a failed curl or a bad sum still stops the
# script under set -e.
stamp fetch
# node: nodejs.org only, and only once the release's own sums agree.
( curl -fsSL -o SHASUMS256.txt ${SHASUMS_URL}
curl -fsSL -o ${NODE_TARBALL} ${NODE_URL}
grep " ${NODE_TARBALL}$" SHASUMS256.txt | sha256sum -c -
sudo -n tar -xJf ${NODE_TARBALL} -C /usr/local --strip-components=1 ) & node_pid=$!
# bun: the pinned release, with bunx beside it.
( curl -fsSL -o bun.zip ${BUN_URL}
unzip -q -o bun.zip
sudo -n install -m 0755 bun-linux-x64/bun /usr/local/bin/bun
sudo -n ln -sf bun /usr/local/bin/bunx ) & bun_pid=$!
# celld: the pinned release, against the digest the plugin records.
( curl -fsSL -o ${CELLD_ASSET} ${CELLD_URL}
echo '${CELLD_SHA256}  ${CELLD_ASSET}' | sha256sum -c -
gzip -dc ${CELLD_ASSET} >celld
sudo -n install -m 0755 celld /usr/local/bin/celld ) & celld_pid=$!
wait "$node_pid"
wait "$bun_pid"
wait "$celld_pid"

# pytest: the image's uv, every distribution pinned to what noble's packages shipped.
stamp pytest
sudo -n uv pip install --system --break-system-packages pytest==7.4.4 pytest-xdist==3.4.0 pluggy==1.4.0 packaging==24.0 iniconfig==1.1.1 execnet==2.0.0

stamp files
# Quoted heredocs: both files land as handed in, expanding nothing.
cat <<'${BOOTSTRAP_TAG}' >bootstrap.sh
${heredocBody(BOOTSTRAP_TAG, bootstrap)}${BOOTSTRAP_TAG}
sudo -n install -d -m 0755 "$LIB"
sudo -n install -m 0555 bootstrap.sh "$LIB/bootstrap.sh"
mkdir -p "$HOME/.config/systemd/user" "$HOME/.claude"
cat <<'${UNIT_TAG}' >"$HOME/.config/systemd/user/fleet-run@.service"
${heredocBody(UNIT_TAG, unit)}${UNIT_TAG}
printf '%s\\n' '${evidence}' >"$HOME/fleet-evidence-repo"
printf '%s\\n' '{"env":{"CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS":"0"},"permissions":{"defaultMode":"bypassPermissions"}}' >"$HOME/.claude/settings.json"
git config --global user.name fleet
git config --global user.email fleet@exe.dev

stamp daemon-reload
systemctl --user daemon-reload
# Credentials reach this box by their attachment tag:fleet, with no documented order
# against this script; wait, bounded, until Reflection lists claude-max.
stamp credentials
for i in $(seq 1 30); do
  curl -fsS https://reflection.int.exe.xyz/integrations | grep -q '"claude-max"' && break
  sleep 2
done
stamp start
systemctl --user start "fleet-run@$RUN.service"
stamp done
sudo -n rm -f -- "$0"
`

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
