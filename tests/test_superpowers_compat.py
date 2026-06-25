"""Superpowers upstream-drift tripwire — GA-flipped.

Drift detection runs against the LIVE active superpowers, resolved exactly as the
runtime preflight resolves it, using the shared contract manifest. It skips when
no superpowers cache is present (e.g. CI), so the deterministic signal there comes
from the checker's own unit tests (tests/test_superpowers_contract.py) and the
single-source assertion below."""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "skills/ultrapowers/scripts"))
import resolve_superpowers as rs  # noqa: E402
import superpowers_contract as sc  # noqa: E402

import pytest

CLAUDE_HOME = pathlib.Path.home() / ".claude"


def _active():
    return rs.resolve_active(CLAUDE_HOME, ROOT)["active"]


@pytest.mark.skipif(not _active(), reason="no active superpowers cache on this machine (e.g. CI)")
def test_live_superpowers_satisfies_contract():
    failures = []
    for inst in _active():
        rep = sc.check(inst["installPath"])
        if not rep.ok:
            for m in rep.missing:
                tok = m.get("token") or " | ".join(m.get("any_of", [])) or "(must exist)"
                failures.append(f"{inst['version']} [{m['rel']}] {tok!r} — {m['why']}")
    assert not failures, (
        "active superpowers is missing contract tokens ultrapowers depends on:\n"
        + "\n".join(failures)
        + "\n\nRe-audit SKILL.md Steps 1/5/6 and the re-bake sources, then update "
        "MANIFEST/TESTED_AGAINST in skills/ultrapowers/scripts/superpowers_contract.py.")


def test_manifest_is_the_single_token_source():
    """This suite must not carry a parallel inline token list — it asserts only via
    the shared MANIFEST. Guards against the duplicate-source drift the repo forbids."""
    this = pathlib.Path(__file__).read_text()
    # The only place a literal contract token may live is superpowers_contract.py.
    assert "MANIFEST" in this and "sc.check" in this
    # Guard: the old hand-maintained list variable must be gone.
    # Spelled via concatenation so the bare identifier does not appear in this file
    # and trip the assertion's self-read.
    _banned = "HANDOFF" + "_SKILLS"
    assert _banned not in this  # the old hand-maintained list is gone


def test_tested_against_is_a_released_version():
    # Sanity: TESTED_AGAINST is a concrete x.y.z, not a dev snapshot label.
    parts = sc.TESTED_AGAINST.split(".")
    assert len(parts) == 3 and all(p.isdigit() for p in parts)
