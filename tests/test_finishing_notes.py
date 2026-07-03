import pathlib
ROOT = pathlib.Path(__file__).resolve().parents[1]
NOTES = ROOT / "skills/ultrapowers/references/finishing-notes.md"
SKILL = ROOT / "skills/ultrapowers/SKILL.md"
FMT = ROOT / "skills/ultrapowers/references/report-format.md"


def test_finishing_notes_cover_merge_method_and_deploy_scope():
    assert NOTES.exists()
    txt = NOTES.read_text().lower()
    assert "squash" in txt and ("merge method" in txt or "allow_squash_merge" in txt) and "rebase" in txt
    assert "deploy target" in txt and ("rev-list" in txt or "far ahead" in txt)


def test_finishing_notes_are_referenced_not_orphaned():
    assert "finishing-notes.md" in SKILL.read_text()
    assert "finishing-notes.md" in FMT.read_text()


def test_finishing_notes_define_the_deferred_verification_checklist():
    text = NOTES.read_text()
    assert "deferredVerification" in text
    for status in ("closed", "still-open", "needs-human"):
        assert status in text
    # tracking-only contract: the checklist must not authorize new actions
    assert "authorizes no new autonomous actions" in text
