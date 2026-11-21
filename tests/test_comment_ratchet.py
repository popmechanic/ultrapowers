import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]


def test_no_file_gains_a_comment():
    run = subprocess.run([sys.executable, str(REPO_ROOT / "lint" / "comments.py")],
                         capture_output=True, text=True)
    assert run.returncode == 0, run.stdout + run.stderr


def test_the_lexer_sees_comments_and_not_strings(tmp_path):
    sys.path.insert(0, str(REPO_ROOT / "lint"))
    import comments
    src = ("const a = '// no'; // yes\n"
           "const b = `x ${ {c: 1}.c } // no`;\n"
           "const r = /\\/\\/ no/g; /* yes\n yes */\n"
           "// @ts-ignore\n")
    assert [(s, e) for s, e, _ in comments.js_comments(src)
            if not comments.PRAGMA.match(_)] == [(1, 1), (3, 4)]
