"""End-to-end test for warm_cache.sh — the lockfile-keyed warm dependency cache
(spec §2.3a). A REAL bash script, a REAL temp cache (CLAUDE_PLUGIN_DATA pointed
at tmp_path), and assertions that a HIT restores files, a changed lockfile MISSES
with exit 3, and populate is atomic + idempotent."""
import os
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]
WARM = ROOT / "skills/ultrapowers/scripts/warm_cache.sh"


def run(tmp_path, *args, env_extra=None):
    env = dict(os.environ)
    env["CLAUDE_PLUGIN_DATA"] = str(tmp_path / "plugindata")
    if env_extra:
        env.update(env_extra)
    return subprocess.run(["bash", str(WARM), *args],
                          cwd=tmp_path, capture_output=True, text=True, env=env)


def make_lockfile(tmp_path, name, content):
    lf = tmp_path / name
    lf.write_text(content)
    return lf


def make_deps_dir(tmp_path, name, files):
    d = tmp_path / name
    d.mkdir()
    for rel, body in files.items():
        p = d / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(body)
    return d


def test_populate_then_restore_hits_and_clones_files(tmp_path):
    lock = make_lockfile(tmp_path, "bun.lock", "dep-a@1.0.0\ndep-b@2.0.0\n")
    src = make_deps_dir(tmp_path, "node_modules",
                        {"dep-a/index.js": "A\n", "dep-b/lib/util.js": "B\n"})
    p = run(tmp_path, "populate", str(lock), str(src))
    assert p.returncode == 0, p.stderr
    target = tmp_path / "fresh_worktree" / "node_modules"
    target.parent.mkdir(parents=True)
    p = run(tmp_path, "restore", str(lock), str(target))
    assert p.returncode == 0, p.stderr
    assert (target / "dep-a/index.js").read_text() == "A\n"
    assert (target / "dep-b/lib/util.js").read_text() == "B\n"


def test_restore_misses_with_exit_3_when_never_populated(tmp_path):
    lock = make_lockfile(tmp_path, "uv.lock", "never-cached\n")
    target = tmp_path / "t" / ".venv"
    target.parent.mkdir(parents=True)
    p = run(tmp_path, "restore", str(lock), str(target))
    assert p.returncode == 3, (p.returncode, p.stdout, p.stderr)
    assert not target.exists()


def test_changed_lockfile_content_misses_with_exit_3(tmp_path):
    lock = make_lockfile(tmp_path, "bun.lock", "dep-a@1.0.0\n")
    src = make_deps_dir(tmp_path, "node_modules", {"dep-a/index.js": "A\n"})
    assert run(tmp_path, "populate", str(lock), str(src)).returncode == 0
    t1 = tmp_path / "w1" / "node_modules"; t1.parent.mkdir(parents=True)
    assert run(tmp_path, "restore", str(lock), str(t1)).returncode == 0
    lock.write_text("dep-a@1.0.1\n")
    t2 = tmp_path / "w2" / "node_modules"; t2.parent.mkdir(parents=True)
    p = run(tmp_path, "restore", str(lock), str(t2))
    assert p.returncode == 3, (p.returncode, p.stdout, p.stderr)
    assert not t2.exists()


def test_populate_is_idempotent(tmp_path):
    lock = make_lockfile(tmp_path, "bun.lock", "dep-a@1.0.0\n")
    src = make_deps_dir(tmp_path, "node_modules", {"dep-a/index.js": "A\n"})
    assert run(tmp_path, "populate", str(lock), str(src)).returncode == 0
    assert run(tmp_path, "populate", str(lock), str(src)).returncode == 0
    target = tmp_path / "w" / "node_modules"; target.parent.mkdir(parents=True)
    p = run(tmp_path, "restore", str(lock), str(target))
    assert p.returncode == 0, p.stderr
    assert (target / "dep-a/index.js").read_text() == "A\n"


def test_restore_rejects_missing_lockfile(tmp_path):
    target = tmp_path / "t"; target.mkdir()
    p = run(tmp_path, "restore", str(tmp_path / "does_not_exist.lock"), str(target))
    assert p.returncode == 2, (p.returncode, p.stdout, p.stderr)
    assert "lockfile" in p.stderr.lower()


def test_populate_rejects_missing_source_dir(tmp_path):
    lock = make_lockfile(tmp_path, "bun.lock", "x\n")
    p = run(tmp_path, "populate", str(lock), str(tmp_path / "no_such_dir"))
    assert p.returncode == 2, (p.returncode, p.stdout, p.stderr)
    assert "source" in p.stderr.lower()


def test_rejects_unknown_subcommand_and_bad_arity(tmp_path):
    lock = make_lockfile(tmp_path, "bun.lock", "x\n")
    p = run(tmp_path, "frobnicate", str(lock), str(tmp_path))
    assert p.returncode == 2
    assert "usage" in p.stderr.lower()
    p = run(tmp_path, "restore", str(lock))
    assert p.returncode == 2
    assert "usage" in p.stderr.lower()


def test_no_args_prints_usage(tmp_path):
    p = run(tmp_path)
    assert p.returncode == 2
    assert "usage" in p.stderr.lower()


def test_restore_falls_back_when_hardlink_fails_cross_device(tmp_path):
    lock = make_lockfile(tmp_path, "bun.lock", "dep-a@1.0.0\n")
    src = make_deps_dir(tmp_path, "node_modules", {"dep-a/index.js": "A\n"})
    p = run(tmp_path, "populate", str(lock), str(src))
    assert p.returncode == 0, p.stderr

    # Shim `cp` so a hardlink-clone (`cp -al`) FAILS only when the destination is
    # the worktree target — letting any probe in a temp dir succeed. This is the
    # cross-device case: the probe's filesystem supports hardlinks but the real
    # cache->worktree clone does not.
    shim = tmp_path / "shim"
    shim.mkdir()
    (shim / "cp").write_text(
        '#!/usr/bin/env bash\n'
        'dst="${@: -1}"\n'
        'for a in "$@"; do\n'
        '  if [ "$a" = "-al" ]; then\n'
        '    case "$dst" in *fresh_worktree*) exit 1 ;; *) exec /bin/cp "$@" ;; esac\n'
        '  fi\n'
        'done\n'
        'exec /bin/cp "$@"\n')
    (shim / "cp").chmod(0o755)

    target = tmp_path / "fresh_worktree" / "node_modules"
    target.parent.mkdir(parents=True)
    p = run(tmp_path, "restore", str(lock), str(target),
            env_extra={"PATH": f"{shim}:{os.environ['PATH']}"})
    assert p.returncode == 0, p.stderr
    assert (target / "dep-a/index.js").read_text() == "A\n"
