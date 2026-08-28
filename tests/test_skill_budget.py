"""Release-pinned word ceilings for the complexity-ratcheted SKILL.md files
(#248). The ratchet contract: each N is the file's word count at the release
that set it; a release that shrinks the file lowers its N; N is NEVER raised
without the `chore(release)` commit body stating the new N and what pays for
it (this repo's release artifact — there are no separate release notes).
Plans state per-task shrink budgets as DELTAS (see ultraplan SKILL.md
"Shrink budgets"); this pin owns the absolutes."""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]

# file -> ceiling N (word count == len(text.split()), identical to wc -w)
CEILINGS = {
    "skills/ultrapowers/SKILL.md": 1000,  # set 2026-08-28 (One Driver Phase 0, #371 bar row 1)
    "skills/ultraplan/SKILL.md": 3038,    # set 2026-08-28 (0.2.26, One Driver Phase 0 — sealing step deleted)
}


def test_skill_word_ceilings():
    for rel, ceiling in CEILINGS.items():
        words = len((ROOT / rel).read_text().split())
        assert words <= ceiling, (
            f"{rel} is {words} words, over its pinned ceiling {ceiling}. "
            "Pay for growth with deletion elsewhere, or (release-only) raise N "
            "in the chore(release) commit body naming what pays for it.")
