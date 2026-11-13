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
