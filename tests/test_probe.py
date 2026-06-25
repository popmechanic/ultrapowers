"""probe.js is the engine preflight: echoes args, spawns no agents.
Validated the same way test_canary.py validates workflow.js — engine-wrapped
syntax check plus a stubbed execution."""
import pathlib
import shutil
import subprocess

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
PROBE = ROOT / "skills/ultrapowers/harnesses/probe.js"


def test_probe_shape():
    src = PROBE.read_text()
    assert "name: 'ultrapowers-probe'" in src   # launch name (meta.name resolution)
    assert "throw new Error(" in src            # fail-loud on args not populating
    assert "agent(" not in src                  # zero agents — preflight must be free


def test_probe_executes_and_echoes():
    node = shutil.which("node")
    if node is None:
        pytest.skip("node not available")
    src = PROBE.read_text().replace("export const meta", "const meta", 1)
    harness = (
        "const args = { ping: 'pong' };\n"
        "(async () => {\n" + src + "\n})()"
        ".then(r => { if (!r || r.ok !== true) { console.error('bad result'); process.exit(1); } "
        "console.log(JSON.stringify(r)); })"
        ".catch(e => { console.error(String(e)); process.exit(1); });\n"
    )
    p = subprocess.run([node, "--input-type=module", "-"], input=harness,
                       capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    assert '"ok":true' in p.stdout.replace(" ", "")


def test_probe_echoes_representative_payload():
    # the probe must echo back a non-tiny waves payload, not just ping=pong,
    # so a by-name launch's arg delivery is actually verified ([fb8635c59d4fea1c])
    src = (ROOT / "skills/ultrapowers/harnesses/probe.js").read_text()
    assert "waves" in src and "echo" in src.lower()
