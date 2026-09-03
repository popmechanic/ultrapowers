#!/bin/sh
# The golden image, declared. One first-boot script; nothing is done by hand.
#
# exe.dev runs a setup script ONCE at first boot as `exedev` (not root), with
# passwordless `sudo -n` available. Every privileged line below therefore takes
# `sudo -n`: without it the install stops on "Could not open lock file ... are
# you root?" and the VM comes up with no node and no npm (measured 2026-09-03
# on two fresh VMs, #588).
#
# It is idempotent: re-running it on a built VM re-proves every claim and
# rewrites the stamp. It prints one line per step and exits non-zero the moment
# anything fails, so a half-built golden is never mistaken for a good one.
#
# The last line writes /home/exedev/.fleet-golden = sha256 of THIS FILE'S bytes.
# That stamp is what `fleet/golden.sh verify` compares against the checked-in
# script, so an image and the script that claims to describe it cannot drift.
#
# NO CREDENTIALS. In particular no anthropic environment variable anywhere: the token
# lives at exe.dev's edge (the `claude-max` http-proxy integration) and reaches
# only the engine's child environment, set by the boot unit, never the image.
set -eu

REPO_URL=https://github.com/popmechanic/ultrapowers.git
REPO_DIR=/home/exedev/repo
BUN_FIXTURE=evals/fixtures/bun-greenfield/project
CLAUDE_DIR=/home/exedev/.claude
UNIT_DIR=/home/exedev/.config/systemd/user
ME=$(id -un)

step() { printf '[golden-setup] %s\n' "$*"; }
fail() { printf '[golden-setup] FAILED: %s\n' "$*" >&2; exit 1; }

# --- node -------------------------------------------------------------------
# exeuntu ships `claude` and Shelley; node is not preinstalled, which is the
# whole reason this script exists.
if command -v node >/dev/null 2>&1; then
  step "node already present: $(node --version)"
else
  step 'installing node LTS from nodesource'
  curl -fsSL https://deb.nodesource.com/setup_lts.x -o /tmp/nodesource-setup.sh
  sudo -n bash /tmp/nodesource-setup.sh
  sudo -n env DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
  rm -f /tmp/nodesource-setup.sh
  step "node installed: $(node --version)"
fi
command -v npm >/dev/null 2>&1 || fail 'npm missing after the node install'
step "npm: $(npm --version)"

# --- busybox ----------------------------------------------------------------
# `busybox httpd` serves the run's status page on port 8000, which exe.dev
# proxies at https://fleet-run-<N>.exe.xyz/ — the only way anyone watches a run.
if command -v busybox >/dev/null 2>&1; then
  step 'busybox already present'
else
  step 'installing busybox'
  sudo -n env DEBIAN_FRONTEND=noninteractive apt-get update
  sudo -n env DEBIAN_FRONTEND=noninteractive apt-get install -y busybox
  step 'busybox installed'
fi
busybox httpd --help >/dev/null 2>&1 || busybox --list | grep -qx httpd \
  || fail 'busybox has no httpd applet'
step 'busybox httpd applet present'

# --- git identity -----------------------------------------------------------
# The engine commits inside the sandbox, so the image needs an identity. The
# address comes from Reflection, which answers with the account's own email;
# a golden built without network to Reflection still gets a usable identity.
EMAIL=$(curl -fsS --max-time 10 https://reflection.int.exe.xyz/email 2>/dev/null || true)
EMAIL=$(printf '%s' "$EMAIL" | tr -d '\r\n' \
  | sed -e 's/.*"email"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/' -e 's/^"//' -e 's/"$//')
case "$EMAIL" in
  *@*) : ;;
  *) EMAIL=fleet@localhost ;;
esac
git config --global user.name fleet
git config --global user.email "$EMAIL"
step "git identity: fleet <$EMAIL>"

# --- pytest + xdist ---------------------------------------------------------
# `--break-system-packages` is REQUIRED, not optional: exeuntu's python3.12 is
# PEP 668 externally-managed, so a plain `pip install --user` refuses outright
# and the golden comes up without xdist while pytest still answers --version
# from dist-packages. The IMPORT is the check, never the install's exit code.
step 'installing pytest + pytest-xdist'
python3 -m pip install --user --break-system-packages pytest pytest-xdist
python3 -m pytest --version >/dev/null || fail 'pytest does not run'
python3 -c 'import xdist; print(xdist.__version__)' >/dev/null \
  || fail 'xdist installed but not importable'
step "xdist importable: $(python3 -c 'import xdist; print(xdist.__version__)')"

# --- bun --------------------------------------------------------------------
# The installer puts bun in ~/.bun/bin and appends to ~/.bashrc, which is a
# LOGIN-shell path — and the engine never uses a login shell (`ultra_run.py`
# runs the suite through /bin/sh -c). An image with bun only on the login PATH
# looks healthy and cannot run a single Bun target (#456, measured 2026-09-03).
# Symlink into a directory already on the non-interactive PATH instead.
if [ ! -x /home/exedev/.bun/bin/bun ]; then
  step 'installing bun'
  curl -fsSL https://bun.sh/install | bash
fi
sudo -n ln -sf /home/exedev/.bun/bin/bun /usr/local/bin/bun
sudo -n ln -sf /home/exedev/.bun/bin/bunx /usr/local/bin/bunx
# Prove it the way the ENGINE will see it — a non-login shell. `bash -lc` here
# is a check that cannot fail: it passes on exactly the broken image.
bash -c 'bun --version' >/dev/null || fail 'bun not on the non-login PATH'
bash -c 'bunx --version' >/dev/null || fail 'bunx not on the non-login PATH'
step "bun on the non-login PATH: $(bash -c 'bun --version')"

# --- the engine clone -------------------------------------------------------
# The default branch is enough: the boot script checks out the run's `engine=`
# sha itself. What the clone buys is a warm object store and fleet/node_modules,
# neither of which any per-run fetch can supply.
if [ -d "$REPO_DIR/.git" ]; then
  step "engine clone present; fetching $REPO_URL"
  git -C "$REPO_DIR" remote set-url origin "$REPO_URL"
  git -C "$REPO_DIR" fetch --prune origin
else
  step "cloning $REPO_URL to $REPO_DIR"
  git clone "$REPO_URL" "$REPO_DIR"
fi
step "engine clone at $(git -C "$REPO_DIR" rev-parse --short HEAD)"

step 'installing fleet node deps'
if [ -f "$REPO_DIR/fleet/package-lock.json" ]; then
  ( cd "$REPO_DIR/fleet" && npm ci --no-audit --no-fund )
else
  # No lockfile in the repo: `npm ci` refuses outright, so install instead.
  ( cd "$REPO_DIR/fleet" && npm install --no-audit --no-fund )
  rm -f "$REPO_DIR/fleet/package-lock.json"
fi
[ -d "$REPO_DIR/fleet/node_modules" ] || fail 'fleet/node_modules missing after install'
step 'fleet node deps installed'

# --- bun cache --------------------------------------------------------------
# Warm the global package cache IN THE IMAGE so it clones with every sandbox
# instead of being refetched per run (#425). `bun install --offline` succeeding
# IS the proof the cache is real — it cannot pass by reaching the registry.
step 'warming the bun package cache'
( cd "$REPO_DIR/$BUN_FIXTURE" && bash -c 'bun install' >/dev/null )
rm -rf "$REPO_DIR/$BUN_FIXTURE/node_modules" "$REPO_DIR/$BUN_FIXTURE/bun.lock"
( cd "$REPO_DIR/$BUN_FIXTURE" && bash -c 'bun install --offline' >/dev/null ) \
  || fail 'bun install --offline failed: the cache is cold'
rm -rf "$REPO_DIR/$BUN_FIXTURE/node_modules" "$REPO_DIR/$BUN_FIXTURE/bun.lock"
# Measure the cache BY PATH, never with `du -sh $(bun pm cache)`: outside a
# project dir that substitution collapses to empty and du measures `.` instead,
# printing a healthy-looking number for a cold cache (2026-08-30).
step "bun cache: $(du -sh /home/exedev/.bun/install/cache | cut -f1)"

# --- claude settings --------------------------------------------------------
# Golden-only files belong in this version-controlled script, not in hand work
# after the boot. No token and no anthropic variable here or anywhere in the image.
install -d -m 700 "$CLAUDE_DIR"
cat > "$CLAUDE_DIR/settings.json" <<'JSON'
{"env":{"CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS":"0"},"permissions":{"defaultMode":"bypassPermissions"}}
JSON
chmod 600 "$CLAUDE_DIR/settings.json"
step 'wrote ~/.claude/settings.json (600)'

# --- systemd user units -----------------------------------------------------
# The sandbox boots INERT: fleet-boot.service starts at boot, reads this VM's
# own comment from Reflection, and does nothing until an assignment appears.
# Lingering is what starts the user manager without anyone logging in.
install -d "$UNIT_DIR"
[ -f "$REPO_DIR/fleet/fleet-boot.service" ] || fail 'fleet/fleet-boot.service missing from the clone'
install -m 644 "$REPO_DIR/fleet/fleet-boot.service" "$UNIT_DIR/fleet-boot.service"
cat > "$UNIT_DIR/fleet-deadman.service" <<'UNIT'
[Unit]
Description=ultrapowers sandbox deadman

[Service]
Type=oneshot
ExecStart=/home/exedev/repo/fleet/sandbox-boot.sh deadman
UNIT
cat > "$UNIT_DIR/fleet-deadman.timer" <<'UNIT'
[Unit]
Description=ultrapowers sandbox deadman (6h)

[Timer]
OnActiveSec=6h
AccuracySec=1min

[Install]
WantedBy=timers.target
UNIT
# exeuntu already lingers exedev out of the box, so this is a no-op on a stock
# VM and the guarantee on any image that ever stops doing it.
sudo -n loginctl enable-linger "$ME"
step "lingering: $(loginctl show-user "$ME" -p Linger 2>/dev/null || echo Linger=unknown)"

# A first-boot setup script (and an ssh command) has no XDG_RUNTIME_DIR, and
# `systemctl --user` cannot find the user bus without one. Measured on a stock
# exeuntu VM: exporting it is the difference between `enable` working and
# "Failed to connect to bus".
XDG_RUNTIME_DIR=/run/user/$(id -u)
export XDG_RUNTIME_DIR

if systemctl --user daemon-reload 2>/dev/null; then
  systemctl --user enable fleet-boot.service
  systemctl --user enable fleet-deadman.timer
  step 'fleet-boot.service and fleet-deadman.timer enabled'
else
  # First boot can run this script before a user bus exists. `enable` is only
  # a symlink into the wants directory, so write the symlinks and let the user
  # manager pick them up when it starts. Root creates them, so hand them back.
  step 'no user bus yet; writing the wants symlinks by hand'
  install -d "$UNIT_DIR/default.target.wants" "$UNIT_DIR/timers.target.wants"
  sudo -n ln -sf "$UNIT_DIR/fleet-boot.service" "$UNIT_DIR/default.target.wants/fleet-boot.service"
  sudo -n ln -sf "$UNIT_DIR/fleet-deadman.timer" "$UNIT_DIR/timers.target.wants/fleet-deadman.timer"
  sudo -n chown -h "$ME:$ME" "$UNIT_DIR/default.target.wants/fleet-boot.service" \
    "$UNIT_DIR/timers.target.wants/fleet-deadman.timer"
  step 'fleet-boot.service and fleet-deadman.timer enabled (by symlink)'
fi

# --- prune ------------------------------------------------------------------
# Every `claude` invocation leaves a session transcript under ~/.claude/projects;
# those ride into every sandbox clone and land in the evidence bundle, polluting
# the ultralearn corpus. Prune at the END: nothing after this writes one.
rm -rf "$CLAUDE_DIR"/projects/*
step 'pruned ~/.claude/projects'

# --- stamp ------------------------------------------------------------------
[ -f "$0" ] || fail "cannot stamp: \$0 ($0) is not a file — run this script from a file, not stdin"
STAMP=$(sha256sum "$0" | cut -d' ' -f1)
printf '%s\n' "$STAMP" > /home/exedev/.fleet-golden
step "stamped /home/exedev/.fleet-golden = $STAMP"
step 'golden ready'
