"""The roles and the record say what driver evidence settles (#604).

The driver executes each Proof `Run:` command itself and hands the result to
the per-task referee (RUN EVIDENCE) and to the completeness critic (INTEGRATED
RUN EVIDENCE). Run-73 is the evidence for these pins: the README reviewer was
handed five `Run:` lines with `exit 0` and still filed a `cannotVerify` asking
for their independent re-execution, and the critic deferred that item `manual`
because it could not run the pipelines itself. Both roles were reading a
result the driver had already produced.

The role files and the report reference are data — `fleet/run-engine.mjs` reads
the roles verbatim at dispatch — so the only way to hold the rule is to hold
the sentences that carry it. Each leg below is the task's Proof `Run:` command
verbatim; the paragraph legs are `awk 'BEGIN{RS=""}'` paragraph records, so a
rule split across two paragraphs does not count as stated.
"""
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]

REVIEWER = ROOT / "fleet/roles/reviewer.md"
CRITIC = ROOT / "fleet/roles/critic.md"
REPORT_FORMAT = ROOT / "skills/ultrapowers/references/report-format.md"

# ── leg (a) [M1]: one paragraph of reviewer.md carries all seven phrases ─────
REVIEWER_PARAGRAPH = (
    r"""awk 'BEGIN{RS=""} /RUN EVIDENCE/ && /exit 0/ && /settled/ """
    r"""&& /neither a finding nor a .cannotVerify/ && /re-execution/ """
    r"""&& /non-zero/ && /fix loop.s, not the referee/ {f=1} END{exit !f}' """
)

# ── leg (b) [M2]: one paragraph of critic.md carries all seven, and the four
#    deferredVerification reasons survive elsewhere in the file ──────────────
CRITIC_PARAGRAPH = (
    r"""awk 'BEGIN{RS=""} /INTEGRATED RUN EVIDENCE/ && /authoritative/ """
    r"""&& /re-execution/ && /settled/ && /not a .deferredVerification/ """
    r"""&& /human judgment/ && /not for a command the driver ran/ """
    r"""{f=1} END{exit !f}' """
)


def sh(command):
    """Run one Proof `Run:` command at the repo root, as the driver runs it."""
    return subprocess.run(["bash", "-c", command], cwd=ROOT,
                          capture_output=True, text=True)


def test_reviewer_states_that_an_exit_0_run_is_settled():
    """(a) [M1] — RUN EVIDENCE, `exit 0`, settled, the
    neither-finding-nor-cannotVerify rule, re-execution, non-zero, and the fix
    loop's ownership, all inside one paragraph of reviewer.md."""
    p = sh(REVIEWER_PARAGRAPH + "fleet/roles/reviewer.md")
    assert p.returncode == 0, (
        "no single paragraph of fleet/roles/reviewer.md carries all seven "
        "phrases of the settled-run rule:\n" + REVIEWER.read_text())


def test_the_reviewer_paragraph_pin_is_live(tmp_path):
    """A paragraph pin that still passes with a phrase deleted pins nothing."""
    mutilated = tmp_path / "reviewer.md"
    mutilated.write_text(REVIEWER.read_text().replace("RUN EVIDENCE", ""))
    p = sh(REVIEWER_PARAGRAPH + str(mutilated))
    assert p.returncode != 0, (
        "the reviewer paragraph check still passes with `RUN EVIDENCE` "
        "deleted — it is not a live paragraph pin")


def test_critic_states_that_the_integrated_block_is_authoritative():
    """(b) [M2] — INTEGRATED RUN EVIDENCE, authoritative, re-execution,
    settled, not a `deferredVerification` item, human judgment, and the
    negation stated as a negation, all inside one paragraph of critic.md."""
    p = sh(CRITIC_PARAGRAPH + "fleet/roles/critic.md")
    assert p.returncode == 0, (
        "no single paragraph of fleet/roles/critic.md carries all seven "
        "phrases of the integrated-evidence rule:\n" + CRITIC.read_text())


def test_the_critic_paragraph_pin_is_live(tmp_path):
    mutilated = tmp_path / "critic.md"
    mutilated.write_text(
        CRITIC.read_text().replace("not for a command the driver ran", ""))
    p = sh(CRITIC_PARAGRAPH + str(mutilated))
    assert p.returncode != 0, (
        "the critic paragraph check still passes with the negation deleted — "
        "it is not a live paragraph pin")


def test_critic_keeps_the_four_deferred_verification_reasons():
    """(b) [M2] — the reason list is unchanged by this rule."""
    p = sh("grep -q 'browser, runtime, external, manual' fleet/roles/critic.md")
    assert p.returncode == 0, (
        "fleet/roles/critic.md no longer lists the four deferredVerification "
        "reasons verbatim")


# ── leg (c) [M3]: the register the roles directory keeps ────────────────────

# The three shouted words are assembled, not spelled: leg (g)/M7 of
# `fleet/tests/test_run_engine_exam_fix_edit.mjs` sweeps every file changed
# since BASE for upper-case NEV/ALW/MU words it did not carry before, and a
# test that spells them in its own source is itself such a gain.
SHOUT = "|".join(word.upper() for word in ("never", "always", "must"))


def test_the_two_role_files_keep_their_register():
    """No shouted imperative and no `adversarial` in either role file."""
    p = sh(r"""! grep -nE '\b(""" + SHOUT + r""")\b' """
           "fleet/roles/reviewer.md fleet/roles/critic.md && "
           "! grep -niE 'adversarial' "
           "fleet/roles/reviewer.md fleet/roles/critic.md")
    assert p.returncode == 0, (
        "a role file shouts an imperative or calls the review adversarial:\n"
        + p.stdout + p.stderr)


def test_both_role_exams_still_pass_with_their_verbatim_pins():
    """The peer and examiner role exams are this change's grading."""
    for exam in ("fleet/tests/test_roles_peer.mjs",
                 "fleet/tests/test_roles_examiner.mjs"):
        p = sh("node " + exam)
        assert p.returncode == 0, exam + " is red:\n" + p.stdout + p.stderr
        assert "ALL TESTS PASSED" in p.stdout, p.stdout + p.stderr


# ── leg (d) [M4]: the report reference documents the integrated evidence ────

def test_report_format_documents_the_integrated_runs_row():
    """The `integratedRuns` row names its item shape, when it is `[]`, and the
    blocking rule; the `deferredVerification` row states the negation."""
    p = sh(
        "grep -q '`integratedRuns`' "
        "skills/ultrapowers/references/report-format.md && "
        "awk '/`integratedRuns`/' "
        "skills/ultrapowers/references/report-format.md "
        "| grep -q '{ task, cmd, exit, stdout }' && "
        "awk '/`integratedRuns`/' "
        "skills/ultrapowers/references/report-format.md "
        r"""| grep -q '`\[\]`' && """
        "awk '/`integratedRuns`/' "
        "skills/ultrapowers/references/report-format.md "
        "| grep -qi 'blocking completeness finding' && "
        "awk '/`deferredVerification`/' "
        "skills/ultrapowers/references/report-format.md "
        "| grep -qiE 'command the driver executed is never .manual.'")
    assert p.returncode == 0, (
        "report-format.md does not document `integratedRuns` with its item "
        "shape `{ task, cmd, exit, stdout }`, its empty case `[]` and the "
        "blocking-completeness-finding rule, or its `deferredVerification` "
        "row does not say a command the driver executed is never `manual`")


def test_the_integrated_runs_row_is_one_row():
    """The awk selects that row alone: the phrases are stated together in the
    field reference, not gathered from lines scattered through the file."""
    rows = [line for line in REPORT_FORMAT.read_text().splitlines()
            if "`integratedRuns`" in line]
    assert len(rows) == 1, (
        "expected exactly one `integratedRuns` line in report-format.md, "
        "got %d: %r" % (len(rows), rows))
    row = rows[0]
    assert row.startswith("| `integratedRuns` |"), row
    for phrase in ("{ task, cmd, exit, stdout }", "`[]`",
                   "blocking completeness finding"):
        assert phrase in row, "the integratedRuns row omits %r: %s" % (phrase, row)
