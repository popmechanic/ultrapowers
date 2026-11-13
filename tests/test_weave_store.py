"""The weave store (factory/flock/weave_store.py): main's memory, on real git repositories."""
import json
import os
import subprocess
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "factory", "flock"))
import weave_store as S  # noqa: E402

M = S.M


@pytest.fixture(autouse=True)
def plain_git(monkeypatch):
    # the laptop's own git config (signing, hooks, templates) stays out
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", os.devnull)
    monkeypatch.setenv("GIT_CONFIG_SYSTEM", os.devnull)
    for k, v in {**S.IDENTITY}.items():
        monkeypatch.setenv(k, v)


def sh(repo, *args):
    return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True).stdout.strip()


def commit(repo, files, msg="c"):
    """One commit writing `files` ({path: text | bytes | None to delete}); its sha."""
    for path, content in files.items():
        f = os.path.join(str(repo), path)
        if content is None:
            os.remove(f)
            continue
        os.makedirs(os.path.dirname(f), exist_ok=True)
        with open(f, "wb") as fh:
            fh.write(content if isinstance(content, bytes) else content.encode())
    sh(repo, "add", "-A")
    sh(repo, "commit", "-q", "-m", msg)
    return sh(repo, "rev-parse", "HEAD")


def new_repo(path):
    subprocess.run(["git", "init", "-q", "-b", "main", str(path)], check=True)
    return path


def lines(*xs):
    return "\n".join(xs) + "\n"


# a history that makes a diff choose: a repeated line, a delete, the same text put back, a move
HISTORY = [
    {"a.txt": lines("one", "two", "three", "", "four"), "b.txt": lines("x", "y")},
    {"a.txt": lines("one", "TWO", "three", "", "four", "five")},
    {"a.txt": lines("one", "three", "", "four", "five"), "b.txt": lines("x", "y", "z")},
    {"a.txt": lines("zero", "one", "two", "three", "", "", "five", "four"), "c/new.txt": lines("n")},
    {"b.txt": None, "a.txt": lines("zero", "one", "two", "three", "", "five", "four", "")},
]


def history(repo):
    return [commit(repo, files, "c%d" % i) for i, files in enumerate(HISTORY)]


def visible(mem, path):
    return "\n".join(M.current_lines(mem.states[path]))


def test_a_replayed_weave_shows_gits_text_and_is_stored_once(tmp_path):
    repo = new_repo(tmp_path / "r")
    shas = history(repo)
    S.genesis(str(repo), shas[0])
    mem = S.resolve(str(repo), shas[-1])
    assert visible(mem, "a.txt") == HISTORY[4]["a.txt"]
    assert M.current_lines(mem.states["b.txt"]) == []          # deleted: every line is still there, hidden
    assert [e[0] for e in M.deserialize_state(mem.states["b.txt"])] == ["x", "y", "z", ""]
    assert S.verify(str(repo), mem) == []
    before = sh(repo, "rev-parse", S.REF)
    again = S.resolve(str(repo), shas[-1])
    assert again.states == mem.states and sh(repo, "rev-parse", S.REF) == before


def test_replaying_in_two_hops_writes_the_same_entry_as_one(tmp_path):
    one, two = new_repo(tmp_path / "one"), tmp_path / "two"
    shas = history(one)
    S.genesis(str(one), shas[0])
    subprocess.run(["git", "clone", "-q", str(one), str(two)], check=True)
    sh(two, "fetch", "-q", "origin", "%s:%s" % (S.REF, S.REF))
    S.resolve(str(one), shas[4])
    S.resolve(str(two), shas[2])
    S.resolve(str(two), shas[4])
    tree = sh(one, "rev-parse", shas[4] + "^{tree}")
    a, b = S.entries(str(one))[tree], S.entries(str(two))[tree]
    assert sh(one, "rev-parse", a + "^{tree}") == sh(two, "rev-parse", b + "^{tree}")


def test_a_replayed_line_names_the_commit_that_wrote_it(tmp_path):
    repo = new_repo(tmp_path / "r")
    shas = history(repo)
    S.genesis(str(repo), shas[0])
    mem = S.resolve(str(repo), shas[1])
    state = M.deserialize_state(mem.states["a.txt"])
    by_text = {e[0]: k for e, k in zip(state, S.W.line_keys(state))}
    assert mem.auth["a.txt"][by_text["TWO"]] == {"@c:" + shas[1][:12]}
    assert by_text["one"] not in mem.auth["a.txt"]             # a genesis line has no author: it reads as base
    assert mem.dels["a.txt"][by_text["two"]] == {"@c:" + shas[1][:12]}


def test_a_path_that_was_ever_binary_is_never_woven(tmp_path):
    repo = new_repo(tmp_path / "r")
    c0 = commit(repo, {"a.txt": lines("one"), "img": lines("text for now")})
    S.genesis(str(repo), c0)
    c1 = commit(repo, {"img": b"\xff\xfe\x00binary", "a.txt": lines("one", "two")})
    c2 = commit(repo, {"img": lines("text again")})
    mem = S.resolve(str(repo), c2)
    assert mem.unwoven == {"img"} and "img" not in mem.states and "a.txt" in mem.states
    assert c1 != c2


def test_a_commit_older_than_the_store_has_no_memory(tmp_path):
    repo = new_repo(tmp_path / "r")
    shas = history(repo)
    S.genesis(str(repo), shas[2])
    assert S.resolve(str(repo), shas[1]) is None
    assert S.resolve(str(repo), shas[3]) is not None


def test_a_stored_weave_that_is_not_gits_text_is_drift(tmp_path):
    repo = new_repo(tmp_path / "r")
    shas = history(repo)
    mem = S.Memory(sh(repo, "rev-parse", shas[1] + "^{tree}"))
    mem.states["a.txt"] = M.initial_state(["not", "what", "git", "holds"])
    mem.dirty.add("a.txt")
    S.write_entry(str(repo), mem, "run")
    with pytest.raises(S.Drift) as e:
        S.resolve(str(repo), shas[1])
    assert e.value.paths == ["a.txt"]


def two_sandboxes(tmp_path):
    seed = new_repo(tmp_path / "seed")
    shas = history(seed)
    origin = tmp_path / "origin.git"
    subprocess.run(["git", "clone", "-q", "--bare", str(seed), str(origin)], check=True)
    a, b = tmp_path / "a", tmp_path / "b"
    for d in (a, b):
        subprocess.run(["git", "clone", "-q", str(origin), str(d)], check=True)
    return origin, a, b, shas


def test_two_sandboxes_replaying_one_commit_push_one_entry_and_no_fork(tmp_path):
    origin, a, b, shas = two_sandboxes(tmp_path)
    assert S.open_store(str(a), shas[0], "origin").via == "genesis"
    S.open_store(str(b), shas[3], "origin")
    S.sync(str(a), "origin")                       # a has the beginning; b has not pushed its replay yet
    S.resolve(str(a), shas[3])
    assert S.push(str(a), "origin") == {"pushed": True, "forks": []}
    assert S.push(str(b), "origin") == {"pushed": True, "forks": []}
    remote = S.entries(str(origin))
    assert set(remote) == {sh(origin, "rev-parse", s + "^{tree}") for s in (shas[0], shas[3])}
    assert sh(origin, "rev-list", "--count", S.REF) == "2"


def test_entries_for_different_trees_both_reach_the_remote(tmp_path):
    origin, a, b, shas = two_sandboxes(tmp_path)
    S.open_store(str(a), shas[0], "origin")
    S.open_store(str(b), shas[0], "origin")
    S.resolve(str(a), shas[2])
    S.resolve(str(b), shas[4])
    assert S.push(str(a), "origin")["pushed"] and S.push(str(b), "origin")["pushed"]
    assert len(S.entries(str(origin))) == 3


def test_two_beginnings_end_as_one(tmp_path):
    origin, a, b, shas = two_sandboxes(tmp_path)
    S.genesis(str(b), shas[2])                     # b begins a store and has not pushed it
    assert S.open_store(str(a), shas[0], "origin").via == "genesis"
    mem = S.open_store(str(b), shas[2], "origin")  # b meets a's beginning: its own is dropped
    assert mem.via == "replay" and "a.txt" in mem.states
    S.push(str(b), "origin")
    vias = [json.loads(sh(origin, "show", e + ":meta.json"))["via"] for e in S.entries(str(origin)).values()]
    assert sorted(vias) == ["genesis", "replay"]


def test_the_cli_opens_a_store_and_says_what_it_holds(tmp_path):
    repo = new_repo(tmp_path / "r")
    shas = history(repo)
    cli = [sys.executable, os.path.join(ROOT, "factory", "flock", "weave_store.py")]
    first = json.loads(subprocess.run([*cli, "open", "--repo", str(repo), "--commit", shas[0]], capture_output=True, text=True, check=True).stdout)
    assert first == {"memory": True, "tree": sh(repo, "rev-parse", shas[0] + "^{tree}"), "via": "genesis", "stored": 0, "unwoven": 0}
    later = json.loads(subprocess.run([*cli, "open", "--repo", str(repo), "--commit", shas[4]], capture_output=True, text=True, check=True).stdout)
    assert later["via"] == "replay" and later["stored"] == 3


# ── stage 2: a run starts from the store and lands into it; the catch-up joins real weaves ──

BODY = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"]


def flock_run(repo, base, run, edits):
    """What the engine does around the keeper, by hand: the tree checked out at `base`, the keeper
    seeded from its text and then from main's memory, each agent's rewrite published, the join's
    text committed, and that commit's entry stored. Returns (commit, memory answer, store answer, keeper)."""
    sh(repo, "checkout", "-q", "--detach", base)
    k = S.W.Keeper()
    k.r_base(str(repo), sh(repo, "ls-files").split("\n"))
    answer = k.r_memory(str(repo), base)
    for agent, task, path, text in edits:
        k.r_rewrite(agent, path, text, task=task)
        k.r_publish(agent)
    m = k.r_merged()
    assert m["conflicts"] == []
    sha = commit(repo, {p: (m["files"][p] if m["exists"][p] else None) for p in m["files"]}, "run-%s" % run)
    return sha, answer, k.r_store(str(repo), sha, run=run), k


def labels(repo, commit_sha, path):
    mem = S.resolve(str(repo), commit_sha)
    return {l for who in mem.auth.get(path, {}).values() for l in who}


def test_a_run_lands_its_weave_and_the_next_run_starts_from_it(tmp_path):
    repo = new_repo(tmp_path / "r")
    c0 = commit(repo, {"a.txt": lines(*BODY), "b.txt": lines("untouched")})
    one, began, stored, _ = flock_run(repo, c0, "1", [("A", "2", "a.txt", lines("ALPHA", *BODY[1:]))])
    assert began["memory"] and began["via"] == "genesis" and began["installed"] == 0
    assert stored["stored"] and stored["paths"] == 1 and stored["tree"] == sh(repo, "rev-parse", one + "^{tree}")
    assert labels(repo, one, "a.txt") == {"@r1:2"}
    two, began, stored, k = flock_run(repo, one, "2", [("A", "5", "a.txt", lines("ALPHA", *BODY[1:-1], "THETA"))])
    assert began["via"] == "run" and began["installed"] == 1
    # inside run 2 a line run 1 wrote reads as base: only this run's own lines have a peer's name
    assert k.r_authors_keyed("B", "a.txt")["authors"][0] == "base"
    assert stored["stored"] and labels(repo, two, "a.txt") == {"@r1:2", "@r2:5"}
    mem = S.resolve(str(repo), two)
    assert sorted(mem.states) == ["a.txt"] and S.verify(str(repo), mem) == []


def two_runs_from_one_base(tmp_path, mine, theirs):
    repo = new_repo(tmp_path / "r")
    c0 = commit(repo, {"a.txt": lines(*BODY)})
    landed, _, _, _ = flock_run(repo, c0, "1", [("A", "1", "a.txt", theirs)])   # this one reaches main first
    run, _, _, _ = flock_run(repo, c0, "2", [("A", "1", "a.txt", mine)])
    return repo, landed, run


def test_the_catch_up_joins_two_runs_on_their_own_lines(tmp_path):
    repo, landed, run = two_runs_from_one_base(tmp_path, lines(*BODY[:-1], "THETA"), lines("ALPHA", *BODY[1:]))
    answer, mem = S.join(str(repo), run, landed)
    want = lines("ALPHA", *BODY[1:-1], "THETA")
    assert answer == {"joined": True, "conflicts": [], "files": {"a.txt": want}, "paths": ["a.txt"]}
    sh(repo, "checkout", "-q", "--detach", landed)
    head = commit(repo, {"a.txt": want}, "caught up")
    S.settle(str(repo), head, S.Memory.from_json(json.loads(json.dumps(mem.to_json()))))
    assert labels(repo, head, "a.txt") == {"@r1:1", "@r2:1"}


def test_the_catch_up_names_a_conflict_on_one_line(tmp_path):
    repo, landed, run = two_runs_from_one_base(tmp_path, lines("MINE", *BODY[1:]), lines("THEIRS", *BODY[1:]))
    answer, _ = S.join(str(repo), run, landed)
    assert answer["joined"] and answer["conflicts"] == ["a.txt"]


def test_a_run_with_no_entry_is_not_joined(tmp_path):
    repo = new_repo(tmp_path / "r")
    c0 = commit(repo, {"a.txt": lines(*BODY)})
    S.genesis(str(repo), c0)
    c1 = commit(repo, {"a.txt": lines("ALPHA", *BODY[1:])})
    sh(repo, "checkout", "-q", "--detach", c0)
    by_hand = commit(repo, {"a.txt": lines(*BODY, "iota")})
    entries_before = S.entries(str(repo))
    assert S.join(str(repo), by_hand, c1) == ({"joined": False, "reason": "no-run-entry"}, None)
    assert S.entries(str(repo)) == entries_before


def test_a_file_deleted_on_main_and_made_again_by_a_run_keeps_its_old_lines(tmp_path):
    repo = new_repo(tmp_path / "r")
    c0 = commit(repo, {"a.txt": lines(*BODY), "b.txt": lines("old one", "old two")})
    S.genesis(str(repo), c0)
    c1 = commit(repo, {"b.txt": None})
    sha, began, stored, _ = flock_run(repo, c1, "3", [("A", "1", "b.txt", lines("new"))])
    assert began["installed"] == 0 and stored["stored"]
    state = M.deserialize_state(S.resolve(str(repo), sha).states["b.txt"])
    assert sorted(e[0] for e in state if e[3] % 2 == 0) == ["", "old one", "old two"]
    assert M.current_lines(S.resolve(str(repo), sha).states["b.txt"]) == ["new", ""]


def test_a_join_that_is_not_the_commits_text_stores_nothing(tmp_path):
    repo = new_repo(tmp_path / "r")
    c0 = commit(repo, {"a.txt": lines(*BODY)})
    sh(repo, "checkout", "-q", "--detach", c0)
    k = S.W.Keeper()
    k.r_base(str(repo), ["a.txt"])
    k.r_memory(str(repo), c0)
    k.r_rewrite("A", "a.txt", lines("ALPHA", *BODY[1:]), task="1")
    k.r_publish("A")
    other = commit(repo, {"a.txt": lines("SOMETHING ELSE", *BODY[1:])})
    assert k.r_store(str(repo), other, run="4") == {"stored": False, "reason": "drift", "paths": ["a.txt"]}
    assert sh(repo, "rev-parse", other + "^{tree}") not in S.entries(str(repo))
