"""Every frozen fixture plan must compile under the enforcing compiler. Until
#544 this globbed `docs/superpowers/plans/`; that directory is untracked now (the
plan rides the run assignment), so the corpus is the frozen copy under
`tests/fixtures/plans/`. A marked plan is one carrying Depends-on markers."""
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
COMPILER = ROOT / "skills/ultrapowers/scripts/compile_plan.py"
PLANS = sorted((ROOT / "tests/fixtures/plans").glob("*.md"))


def _is_marked(text):
    return "Depends-on:" in text


def test_every_marked_plan_compiles():
    failures = []
    for plan in PLANS:
        text = plan.read_text()
        if not _is_marked(text):
            continue
        r = subprocess.run([sys.executable, str(COMPILER), str(plan)],
                           capture_output=True, text=True)
        if r.returncode != 0:
            tail = r.stderr.strip().splitlines()[-1] if r.stderr.strip() else "exit " + str(r.returncode)
            failures.append(f"{plan.name}: {tail}")
    assert not failures, "marked plans that do not compile:\n" + "\n".join(failures)
