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
# The image carries TOOLS and one immutable bootstrap — no engine checkout. The
# bootstrap clones each run's engine at the sha its assignment names, so a
# pre-cloned repo could only ever be a stale one (run-68). And NO CREDENTIALS:
# no anthropic environment variable anywhere. The token lives at exe.dev's edge
# (the `claude-max` integration) and reaches only the engine's child environment.
set -eu

REPO_URL=https://github.com/popmechanic/ultrapowers.git
BUN_FIXTURE=evals/fixtures/bun-greenfield/project
BOOTSTRAP=/home/exedev/fleet-bootstrap.sh
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
# proxies at https://<vm>.exe.xyz/ — the only way anyone watches a run.
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

# --- gh ---------------------------------------------------------------------
# The sandbox opens its own PR with `gh` against github.int.exe.xyz. The token
# is at the edge, so gh needs no login here — only to exist. Installed from
# GitHub's own apt repository when the image does not already carry it.
if command -v gh >/dev/null 2>&1; then
  step "gh already present: $(gh --version | head -n 1)"
else
  step 'installing gh from cli.github.com'
  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /tmp/githubcli.gpg
  sudo -n install -d -m 755 /etc/apt/keyrings
  sudo -n install -m 644 /tmp/githubcli.gpg /etc/apt/keyrings/githubcli-archive-keyring.gpg
  rm -f /tmp/githubcli.gpg
  printf 'deb [arch=%s signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main\n' \
    "$(dpkg --print-architecture)" >/tmp/github-cli.list
  sudo -n install -m 644 /tmp/github-cli.list /etc/apt/sources.list.d/github-cli.list
  rm -f /tmp/github-cli.list
  sudo -n env DEBIAN_FRONTEND=noninteractive apt-get update
  sudo -n env DEBIAN_FRONTEND=noninteractive apt-get install -y gh
  step "gh installed: $(gh --version | head -n 1)"
fi

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

# --- the source tree, at the build commit, in a scratch directory -----------
# Three things come out of the repo at GOLDEN_SHA — the bootstrap, its unit
# and the bun fixture — and nothing of the repo stays in the image. The
# bootstrap exports GOLDEN_SHA; without it the clone sits on the default
# branch and a golden built for an unmerged branch is missing that branch's
# files. GitHub serves any reachable sha by id, so a branch tip fetches by sha
# with no ref name.
SRC=$(mktemp -d "${TMPDIR:-/tmp}/ultrapowers-src.XXXXXX")
step "cloning $REPO_URL to $SRC"
git clone -q "$REPO_URL" "$SRC"
if [ -n "${GOLDEN_SHA:-}" ]; then
  git -C "$SRC" fetch -q origin "$GOLDEN_SHA"
  git -C "$SRC" checkout -q "$GOLDEN_SHA"
else
  step 'GOLDEN_SHA not set; reading the default branch'
fi
step "source at $(git -C "$SRC" rev-parse HEAD)"

# --- the bootstrap and its unit ---------------------------------------------
# The bootstrap lives OUTSIDE any checkout (run-68: a boot script replaced at
# its own path by the engine checkout), mode 755 so systemd can exec it. The
# unit is a TEMPLATE, `fleet-run@.service`, instanced per run as
# `fleet-run@<N>.service`; it is installed and reloaded but NOT enabled: the
# launcher starts the instance over ssh once the assignment is written and the
# grants are attached, so a boot never races a grant and a fresh copy of the
# golden does nothing on its own.
[ -f "$SRC/fleet/fleet-bootstrap.sh" ] || fail 'fleet/fleet-bootstrap.sh missing from the source'
[ -f "$SRC/fleet/fleet-run@.service" ] || fail 'fleet/fleet-run@.service missing from the source'
install -m 755 "$SRC/fleet/fleet-bootstrap.sh" "$BOOTSTRAP"
install -d "$UNIT_DIR"
install -m 644 "$SRC/fleet/fleet-run@.service" "$UNIT_DIR/fleet-run@.service"
bash -n "$BOOTSTRAP" || fail 'the installed bootstrap does not parse'
step "installed $BOOTSTRAP (755) and $UNIT_DIR/fleet-run@.service"

# --- bun cache --------------------------------------------------------------
# Warm the global package cache IN THE IMAGE so it clones with every sandbox
# instead of being refetched per run (#425). `bun install --offline` succeeding
# IS the proof the cache is real — it cannot pass by reaching the registry.
step 'warming the bun package cache'
( cd "$SRC/$BUN_FIXTURE" && bash -c 'bun install' >/dev/null )
rm -rf "$SRC/$BUN_FIXTURE/node_modules" "$SRC/$BUN_FIXTURE/bun.lock"
( cd "$SRC/$BUN_FIXTURE" && bash -c 'bun install --offline' >/dev/null ) \
  || fail 'bun install --offline failed: the cache is cold'
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

# --- the user manager -------------------------------------------------------
# Lingering is what keeps the user manager alive with nobody logged in, so an
# ssh `systemctl --user start` finds a manager to talk to. exeuntu already
# lingers exedev out of the box; this is the guarantee on any image that stops.
sudo -n loginctl enable-linger "$ME"
step "lingering: $(loginctl show-user "$ME" -p Linger 2>/dev/null || echo Linger=unknown)"

# A first-boot setup script (and an ssh command) has no XDG_RUNTIME_DIR, and
# `systemctl --user` cannot find the user bus without one. Measured on a stock
# exeuntu VM: exporting it is the difference between a reload and "Failed to
# connect to bus". First boot can also run this before a user bus exists at
# all; the manager reads the unit file when it starts, so that is not a failure.
XDG_RUNTIME_DIR=/run/user/$(id -u)
export XDG_RUNTIME_DIR
if systemctl --user daemon-reload 2>/dev/null; then
  step 'user manager reloaded; fleet-run@.service installed, not enabled'
else
  step 'no user bus yet; the manager reads fleet-run@.service when it starts'
fi

# --- prune ------------------------------------------------------------------
# The scratch clone goes before the stamp: an image is tools plus the
# bootstrap, and a repo left behind is the pre-clone this build exists to end.
rm -rf "$SRC"
step 'removed the scratch source tree'
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
