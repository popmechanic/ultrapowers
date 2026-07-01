"""End-to-end test for the review-package script — the pre-baked review packet
(spec §2.1). A REAL temp repo with two commits touching one file; asserts the
packet is written to the SHARED scratch dir under `.superpowers/ultra` (outside
`.git/`, yet resolving identically from every linked worktree), is echoed on
stdout, and carries the commit subjects, the ## Diff header, and a +/- diff hunk."""
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "skills/ultrapowers/scripts/review-package"


def git(cwd, *args):
    return subprocess.run(["git", *args], cwd=cwd, check=True,
                          capture_output=True, text=True)


def make_repo(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    git(repo, "init", "-b", "main")
    git(repo, "config", "user.email", "rp@test")
    git(repo, "config", "user.name", "review-package test")
    (repo / "f.txt").write_text("original line\n")
    git(repo, "add", ".")
    git(repo, "commit", "-m", "first commit subject")
    base = git(repo, "rev-parse", "HEAD").stdout.strip()
    (repo / "f.txt").write_text("changed line\n")
    git(repo, "add", ".")
    git(repo, "commit", "-m", "second commit subject")
    head = git(repo, "rev-parse", "HEAD").stdout.strip()
    return repo, base, head


def run_script(repo, *args):
    return subprocess.run(["bash", str(SCRIPT), *args], cwd=repo,
                          capture_output=True, text=True)


def test_review_package_writes_to_shared_superpowers_dir_and_echoes_path(tmp_path):
    repo, base, head = make_repo(tmp_path)
    p = run_script(repo, base, head)
    assert p.returncode == 0, p.stderr
    out_path = pathlib.Path(p.stdout.strip().splitlines()[-1])
    assert out_path.exists(), f"packet not written: {out_path}"
    common = pathlib.Path(
        git(repo, "rev-parse", "--git-common-dir").stdout.strip())
    if not common.is_absolute():
        common = (repo / common)
    # The scratch dir is derived from the RESOLVED PARENT of --git-common-dir
    # (the main repo root, shared by every linked worktree), under .superpowers/.
    expected_dir = (common.resolve().parent / ".superpowers" / "ultra")
    assert out_path.resolve().parent == expected_dir.resolve()
    # It must escape the protected .git/ entirely.
    assert ".git" not in out_path.resolve().parts, out_path
    body = out_path.read_text()
    assert "# Review package:" in body
    assert "first commit subject" in body
    assert "second commit subject" in body
    assert "## Commits" in body
    assert "## Files changed" in body
    assert "## Diff" in body
    assert "-original line" in body
    assert "+changed line" in body


def test_packet_dir_shared_across_worktrees(tmp_path):
    """The property .git/…/ultra had and we must keep: the implementer's isolated
    worktree and the reviewer's main checkout resolve the SAME scratch dir. Derive
    it from --git-common-dir's parent, never from the CWD/worktree root."""
    repo, base, head = make_repo(tmp_path)
    # A linked worktree off the same repo (detached HEAD at `head`, so it does
    # not collide with main's checked-out branch).
    wt = tmp_path / "linked-wt"
    git(repo, "worktree", "add", "--detach", str(wt), head)

    p_main = run_script(repo, base, head)
    p_wt = run_script(wt, base, head)
    assert p_main.returncode == 0, p_main.stderr
    assert p_wt.returncode == 0, p_wt.stderr

    main_path = pathlib.Path(p_main.stdout.strip().splitlines()[-1]).resolve()
    wt_path = pathlib.Path(p_wt.stdout.strip().splitlines()[-1]).resolve()
    # Both runs land in the SAME shared .superpowers/ultra directory.
    assert main_path.parent == wt_path.parent, (main_path, wt_path)
    assert main_path.parent.name == "ultra"
    assert main_path.parent.parent.name == ".superpowers"
    assert ".git" not in main_path.parts, main_path
    assert ".git" not in wt_path.parts, wt_path


def test_review_package_honors_explicit_outfile(tmp_path):
    repo, base, head = make_repo(tmp_path)
    out = tmp_path / "explicit.diff"
    p = run_script(repo, base, head, str(out))
    assert p.returncode == 0, p.stderr
    assert out.exists()
    assert p.stdout.strip().splitlines()[-1] == str(out)
    assert "## Diff" in out.read_text()


def test_review_package_rejects_missing_args(tmp_path):
    repo, base, _ = make_repo(tmp_path)
    p = run_script(repo, base)            # HEAD missing
    assert p.returncode == 2
    assert "usage" in p.stderr.lower()


def test_review_package_rejects_bad_rev(tmp_path):
    repo, base, _ = make_repo(tmp_path)
    p = run_script(repo, base, "nope-not-a-rev")
    assert p.returncode == 2
    assert "HEAD" in p.stderr
