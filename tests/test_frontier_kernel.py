"""Vendored manyana kernel: pin, parse-compatibility, and upstream-suite wrap."""
import ast
import hashlib
import io
import sys
from contextlib import redirect_stdout
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VENDOR = ROOT / "skills" / "ultrapowers" / "kernel" / "vendor"
sys.path.insert(0, str(VENDOR))
import manyana

PATCHED_SHA256 = "3c8ba319bb286aac0ca8f2d7ac355e2610eafa290d2f1e46c7eb5ff562220004"


def test_vendor_pin():
    data = (VENDOR / "manyana.py").read_bytes()
    assert hashlib.sha256(data).hexdigest() == PATCHED_SHA256, (
        "vendored manyana.py changed without updating the pin; "
        "see skills/ultrapowers/kernel/vendor/PROVENANCE.md for the re-vendor procedure"
    )


def test_vendor_parses_pre_312():
    # Guard the compatibility claim itself: the file must be plain pre-3.12 syntax.
    ast.parse((VENDOR / "manyana.py").read_text())


def test_provenance_records_pin():
    text = (VENDOR / "PROVENANCE.md").read_text()
    assert PATCHED_SHA256 in text
    assert "bd77d480e7649f239c42d10a5e64565ee064dd08" in text


def test_upstream_suite_passes():
    # manyana's own runner: every module-level callable named test* is a test.
    failures = []
    ran = []
    for name in sorted(dir(manyana)):
        if name.startswith("test") and callable(getattr(manyana, name)):
            fn = getattr(manyana, name)
            if fn.__code__.co_argcount == 0:
                ran.append(name)
                try:
                    with redirect_stdout(io.StringIO()):
                        fn()
                except Exception as exc:  # noqa: BLE001 - collecting all failures
                    failures.append(f"{name}: {exc!r}")
    assert not failures, failures
    # 18 zero-arg test* functions at the pinned revision (2 param'd helpers are
    # invoked by their parents): guards the wrap against a silently-empty sweep
    # if a future re-vendor changes the naming convention.
    assert len(ran) == 18, ran


def test_kernel_api_roundtrip():
    state = manyana.initial_state(["hello", "world"])
    assert manyana.current_lines(state) == ["hello", "world"]
    state2 = manyana.update_state(state, ["hello", "brave", "world"])
    assert manyana.current_lines(state2) == ["hello", "brave", "world"]
    merged, annotated = manyana.merge_states(state2, state2)
    assert manyana.current_lines(merged) == ["hello", "brave", "world"]
    assert annotated == manyana.current_lines(merged)  # no conflict -> identical
