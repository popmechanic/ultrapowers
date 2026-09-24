# catch-counter: runner
import fcntl
import glob, os, shutil, subprocess, tempfile, pytest

FLEET = os.path.join(os.path.dirname(__file__), "..", "fleet")


def sim_env():
    """The environment one bridged `node <sim>` runs under.

    `PATH` carries the directories holding the interpreters and nothing else —
    a laptop's PATH is forty entries of plugin `bin/`s, and CI's puts node and
    python3 under /opt/hostedtoolcache; that is what is being kept out. `HOME`
    and `TMPDIR` name a directory of this call's own, so no sim reads the box's
    `~/.ultrapowers/fleet.json` or `~/.gitconfig`.

    No `FLEET_HOME`: the bridge is not a sim's home. Each sim mints its own
    under its own `mkdtemp`, and a `FLEET_` fact planted here is exactly the
    ambient kind the hermetic probe keeps out.
    """
    # The prefixes of this process's environment that never reach a sim. The
    # same contract `fleet/tests/_helpers.mjs`'s `simEnv` holds for the
    # children a sim starts, held here for the sims themselves: what a sim sees
    # is what the bridge handed it, never a fact of the box the bridge runs on.
    dropped_prefixes = ("ULTRA_", "TINYAPP_", "FLEET_", "ANTHROPIC_", "CLAUDE_", "GH_")
    # `sh` is looked up too: a sim's `bash -c`/`sh -c` children resolve on the
    # PATH they inherit from the sim, and the sim inherits this one.
    interpreters = ("node", "python3", "git", "bash", "sh")
    dirs = []
    for tool in interpreters:
        found = shutil.which(tool)
        if not found:
            # Left out silently: the sim that needs it fails where it spawns it.
            continue
        parent = os.path.dirname(found)
        if parent not in dirs:
            dirs.append(parent)
    home = tempfile.mkdtemp(prefix="fleet-bridge-")
    env = {"PATH": os.pathsep.join(dirs), "HOME": home, "TMPDIR": home}
    # Built from nothing rather than filtered from the parent, so this last pass
    # is a guard on what the lines above set: a key added here that carries a
    # swept prefix never reaches a sim.
    return {
        key: value
        for key, value in env.items()
        if not key.startswith(dropped_prefixes)
    }


def _sim_id(fleet_dir, path):
    """`path` as the bridge names it: relative to `<fleet_dir>/tests`, /-joined."""
    rel = os.path.relpath(path, os.path.join(fleet_dir, "tests"))
    return rel.replace(os.sep, "/")


def collect_sims(fleet_dir):
    """Every `<fleet_dir>/tests/test_*.mjs`, in relative-path order — the paths
    `node` is handed, ordered by the id the parametrize shows."""
    tests_dir = os.path.join(fleet_dir, "tests")
    paths = glob.glob(os.path.join(tests_dir, "test_*.mjs"))
    return sorted(paths, key=lambda p: _sim_id(fleet_dir, p))


TESTS = collect_sims(FLEET)
IDS = [_sim_id(FLEET, path) for path in TESTS]


def _ensure_node_modules():
    """Install fleet deps at most once even under pytest-xdist (#426): every
    worker process runs this check-then-act, so the check must sit inside an
    exclusive flock — otherwise a second worker sees the node_modules dir npm
    creates first and runs node against a half-written tree. package.json is
    the lock file: always present, never modified by flock (advisory only).
    No unlocked fast path: npm creates node_modules early, so an isdir check
    outside the lock would pass while a peer's install is still writing."""
    with open(os.path.join(FLEET, "package.json")) as lockf:
        fcntl.flock(lockf, fcntl.LOCK_EX)
        if not os.path.isdir(os.path.join(FLEET, "node_modules")):
            subprocess.run(["npm", "install", "--no-audit", "--no-fund"],
                           cwd=FLEET, check=True, capture_output=True)


# A hang detector, not a budget: sized for the slowest box the suite runs on
# under `-n auto`, not for the longest sim here (~12 s).
MJS_TIMEOUT = 300


@pytest.mark.parametrize("path", TESTS, ids=IDS)
def test_fleet_mjs(path):
    _ensure_node_modules()
    # The sim's environment is bound once, because its `HOME` is the
    # `fleet-bridge-*` directory this call has to remove when the sim is done
    # (#890): a suite of a hundred sims left a hundred of them under the tmpdir
    # for good. `finally`, so a red sim and a timed-out one are reaped too;
    # `ignore_errors`, so a dir a sim already removed is not a second failure.
    env = sim_env()
    try:
        r = subprocess.run(["node", path], capture_output=True, text=True, timeout=MJS_TIMEOUT, env=env)
        assert r.returncode == 0, r.stdout + r.stderr
        assert "ALL TESTS PASSED" in r.stdout
    finally:
        shutil.rmtree(env["HOME"], ignore_errors=True)
