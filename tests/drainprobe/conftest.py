"""Make `probecli` importable: the drainprobe package lives under
evals/drainprobe/ (measurement payload, not shipped code), so it is not on
sys.path when pytest runs from the repo root."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "evals" / "drainprobe"))
