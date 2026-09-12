#!/usr/bin/env bash
# fleet/kata-hub-setup.sh — the kata hub's first-boot setup script, as a template.
#
# `renderHubSetupScript` in fleet/kata-hub.mjs replaces the one `__KATA_UNIT__`
# line below with the bytes of fleet/kata.service and hands the result to
# `new --setup-script /dev/stdin` on that call's stdin. exe.dev stores a
# rendered setup script as a property of the VM, so this file carries NO
# secret — and no origin either: the `https_url` does not exist until `new` has
# answered. The bearer, the daemon's `config.toml` and the restart that picks
# them up are delivered over ssh afterwards; until then `ExecStartPre` fails
# fast and the unit parks.
set -euo pipefail
exec >>"$HOME/kata-setup.log" 2>&1
KATA_VERSION=0.17.2
ASSET=kata_0.17.2_linux_amd64.tar.gz
BASE=https://github.com/kenn-io/kata/releases/download/v0.17.2/
printf 'installing kata %s\n' "$KATA_VERSION"
work="$(mktemp -d)"
cd "$work"

# The binary, and only once the release's own sums agree.
curl -fsSL -o SHA256SUMS "${BASE}SHA256SUMS"
curl -fsSL -o "$ASSET" "${BASE}${ASSET}"
grep " $ASSET$" SHA256SUMS | sha256sum -c -
bin="$(tar -tzf "$ASSET" | grep -E '(^|/)kata$' | head -n 1)"
tar -xzf "$ASSET"
sudo -n install -m 0755 "$bin" /usr/local/bin/kata

# KATA_HOME, owned by the user the unit runs as.
sudo -n install -d -m 0750 -o exedev -g exedev /var/lib/kata

# The unit, verbatim, in a quoted heredoc: the bytes arrive unexpanded.
cat <<'KATA_UNIT_EOF' >kata.service
__KATA_UNIT__
KATA_UNIT_EOF
sudo -n install -m 0644 kata.service /etc/systemd/system/kata.service
sudo -n systemctl daemon-reload
# The env file is not here yet, so `ExecStartPre` fails and the start does too.
# That is the design — enabling is what matters, and the laptop's own
# `systemctl restart kata.service` after it delivers the env is what brings the
# daemon up. A failed start must not take this script down with it.
sudo -n systemctl enable --now kata.service || true

# The last two acts: the flag the laptop polls for, then this script itself.
sudo -n touch /var/lib/kata/.setup-done
sudo -n rm -f -- "$0"
