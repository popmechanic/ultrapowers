import fcntl
import glob, os, shutil, subprocess, tempfile, pytest

FLEET = os.path.join(os.path.dirname(__file__), "..", "fleet")
ENGINE_DEPS_DIR = os.path.join(os.path.dirname(__file__), "..", "factory")


def sim_env():
    dropped_prefixes = ("ULTRA_", "TINYAPP_", "FLEET_", "ANTHROPIC_", "CLAUDE_", "GH_")
    interpreters = ("node", "python3", "git", "bash", "sh")
    dirs = []
    for tool in interpreters:
        found = shutil.which(tool)
        if not found:
            continue
        parent = os.path.dirname(found)
        if parent not in dirs:
            dirs.append(parent)
    home = tempfile.mkdtemp(prefix="fleet-bridge-")
    env = {"PATH": os.pathsep.join(dirs), "HOME": home, "TMPDIR": home}
    return {
        key: value
        for key, value in env.items()
        if not key.startswith(dropped_prefixes)
    }


def _sim_id(fleet_dir, path):
    rel = os.path.relpath(path, os.path.join(fleet_dir, "tests"))
    return rel.replace(os.sep, "/")


def collect_sims(fleet_dir):
    tests_dir = os.path.join(fleet_dir, "tests")
    paths = glob.glob(os.path.join(tests_dir, "test_*.mjs"))
    return sorted(paths, key=lambda p: _sim_id(fleet_dir, p))


TESTS = collect_sims(FLEET)
IDS = [_sim_id(FLEET, path) for path in TESTS]


def _ensure_node_modules():
    with open(os.path.join(ENGINE_DEPS_DIR, "package.json")) as lockf:
        fcntl.flock(lockf, fcntl.LOCK_EX)
        if not os.path.isdir(os.path.join(ENGINE_DEPS_DIR, "node_modules")):
            subprocess.run(["npm", "install", "--no-audit", "--no-fund"],
                           cwd=ENGINE_DEPS_DIR, check=True, capture_output=True)


MJS_TIMEOUT = 300


@pytest.mark.parametrize("path", TESTS, ids=IDS)
def test_fleet_mjs(path):
    _ensure_node_modules()
    env = sim_env()
    try:
        r = subprocess.run(["node", path], capture_output=True, text=True, timeout=MJS_TIMEOUT, env=env)
        assert r.returncode == 0, r.stdout + r.stderr
        assert "ALL TESTS PASSED" in r.stdout
    finally:
        shutil.rmtree(env["HOME"], ignore_errors=True)
