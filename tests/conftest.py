import os
import tempfile

os.environ["ULTRAPOWERS_HOME"] = tempfile.mkdtemp(prefix="ultrapowers-home-")

BRIDGE = "test_fleet_suite.py"


def pytest_collection_modifyitems(session, config, items):
    bridge = [item for item in items if item.fspath.basename == BRIDGE]
    if bridge:
        items[:] = bridge + [item for item in items
                             if item.fspath.basename != BRIDGE]
