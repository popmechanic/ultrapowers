"""Runtime superpowers compatibility preflight, invoked by SKILL.md Step 1.

Resolves the active superpowers (enabledPlugins + installed_plugins.json), checks
the shared contract manifest against each active install, and exits:
  0          — all contract tokens present (prints an `advisory:` line if the
               version differs from TESTED_AGAINST), OR superpowers is not
               installed/resolvable (prints a skip notice).
  non-zero   — a contract token ultrapowers depends on is missing; prints exactly
               which token, in which file, and why."""
import argparse
import pathlib
import sys

# Co-located scripts: Python puts this file's dir on sys.path[0] at runtime.
from resolve_superpowers import resolve_active
from superpowers_contract import check, TESTED_AGAINST


def main(claude_home, project):
    res = resolve_active(claude_home, project)
    active = res["active"]
    if not active:
        print("superpowers not installed/resolvable — skipping compat check "
              "(the workflow path does not depend on live superpowers).")
        return 0
    if res["ambiguous"]:
        print(f"note: {len(active)} enabled superpowers installs found — checking each.")
    broken = []
    for inst in active:
        rep = check(inst["installPath"])
        label = f"{inst['version']} ({inst['marketplace']})"
        if not rep.ok:
            broken.append((inst, rep))
        elif inst["version"] != TESTED_AGAINST:
            print(f"advisory: validated against superpowers {TESTED_AGAINST}; "
                  f"you have {label}; all {rep.checked} contract tokens present.")
    if broken:
        for inst, rep in broken:
            print(f"CONTRACT BREAK: superpowers {inst['version']} "
                  f"({inst['marketplace']}) at {inst['installPath']}")
            for e in rep.missing:
                tok = e.get("token") or " | ".join(e.get("any_of", [])) or "(file must exist)"
                print(f"  - MISSING [{e['rel']}] {tok!r} — {e['why']}")
        return 1
    return 0


def _cli():
    ap = argparse.ArgumentParser()
    ap.add_argument("--claude-home", default=str(pathlib.Path.home() / ".claude"))
    ap.add_argument("--project", default=".")
    a = ap.parse_args()
    return main(a.claude_home, a.project)


if __name__ == "__main__":
    sys.exit(_cli())
