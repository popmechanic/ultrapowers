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
    # Raised +25% at 0.3.1 by operator decision. The reason is in that release's
    # commit body, which is the only sanctioned way to move these numbers (#366
    # Amendment 7: "raise it only by writing the new number AND its reason into
    # the release commit body ... it can never stall a release — which is the
    # failure mode that makes an unreachable ceiling worse than none").
    #
    # That failure mode had arrived. On fleet run-31 the ultraplan ceiling stood
    # at 3038 against a 3037-word file — ONE word of headroom — and the sense
    # pass over runs 24-32 (#455) recorded both halves of the damage: the
    # ratchet "blocks the two doc fixes this same run created", and, given an
    # arithmetically impossible budget, an implementer "paid the budget by
    # rewriting five unrelated passages — deleting a normative rule".
    #
    # NOTE the asymmetry, because it says what these numbers really are: they
    # were frozen at whatever each file happened to weigh, not designed. The
    # ultrapowers ceiling was 1000 against a 354-word file — 65% free, binding
    # on nothing — because Phase 0 cut the file and the ceiling never followed.
    # Only the ultraplan number was ever a real constraint.
    "skills/ultrapowers/SKILL.md": 1250,  # raised 2026-08-31 (0.3.1) from 1000
    "skills/ultraplan/SKILL.md": 3798,    # raised 2026-08-31 (0.3.1) from 3038
}


def test_skill_word_ceilings():
    for rel, ceiling in CEILINGS.items():
        words = len((ROOT / rel).read_text().split())
        assert words <= ceiling, (
            f"{rel} is {words} words, over its pinned ceiling {ceiling}. "
            "Pay for growth with deletion elsewhere, or (release-only) raise N "
            "in the chore(release) commit body naming what pays for it.")
