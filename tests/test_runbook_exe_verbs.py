"""Pin: the RUNBOOK only instructs exe.dev verbs that `fleet/provision.mjs`
attests, or that `fleet/exe-verbs.json` allow-lists with a named verifier, an
ISO date and a how (#453 option 1, "Pin the verb list").

The RUNBOOK is executable prose an operator pastes at a live account. A verb
that no test exercises and no human has run is a line that fails at 3am on a
stuck sandbox, so every verb it issues is either covered by the provision tests
or carries an attestation here. JSON has no comment syntax, so the three
fields per entry ARE the comment.

Offline: reads only the two committed files.
"""
import datetime
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
RUNBOOK = ROOT / "fleet/RUNBOOK.md"
PROVISION = ROOT / "fleet/provision.mjs"
ALLOWLIST = ROOT / "fleet/exe-verbs.json"

# `ssh exe.dev "<verb> …"` or `ssh exe.dev '<verb> …'`. The verb is the first
# token after the opening quote, so `billing usage` and `billing plan` are one
# verb and `rm a b --json` is one verb. Not re.DOTALL: an unclosed quote must
# not swallow the following lines.
_SSH_EXE = re.compile(r"""ssh\s+exe\.dev\s+(["'])(.+?)\1""")

REQUIRED_FIELDS = ("verifiedBy", "on", "how")


def exe_verbs(text):
    """Every distinct exe.dev verb issued in `text`."""
    verbs = set()
    for _, command in _SSH_EXE.findall(text):
        tokens = command.split()
        if tokens:
            verbs.add(tokens[0])
    return verbs


def runbook_verbs():
    return exe_verbs(RUNBOOK.read_text())


def provision_verbs():
    return exe_verbs(PROVISION.read_text())


def allowlist():
    return json.loads(ALLOWLIST.read_text())


def unattested(verbs, attested):
    return sorted(verbs - set(attested))


# (a)
def test_every_runbook_verb_is_attested():
    attested = provision_verbs() | set(allowlist())
    assert unattested(runbook_verbs(), attested) == []


# (b)
def test_extractor_reads_both_quote_styles_and_flags_unknown_verbs():
    fixture = (
        'Run `ssh exe.dev "frobnicate x --json"` first, then\n'
        "`ssh exe.dev 'zorp'` to finish.\n"
    )
    assert exe_verbs(fixture) == {"frobnicate", "zorp"}
    attested = provision_verbs() | set(allowlist())
    assert unattested(exe_verbs(fixture), attested) == ["frobnicate", "zorp"]


# (c)
def test_allowlist_entries_are_complete_and_do_not_duplicate_provision():
    entries = allowlist()
    assert entries, "the allow-list is not empty at BASE"
    attested_by_provision = provision_verbs()
    for verb, entry in entries.items():
        assert set(entry) == set(REQUIRED_FIELDS), verb
        for field in REQUIRED_FIELDS:
            assert isinstance(entry[field], str) and entry[field].strip(), (verb, field)
        # `on` is an ISO date, not prose: it must be readable as a date.
        assert datetime.date.fromisoformat(entry["on"]), verb
        assert verb not in attested_by_provision, verb


# (d)
def test_provision_attests_exactly_cp_and_rm():
    assert provision_verbs() == {"cp", "rm"}


# (e)
def test_the_runbook_extractor_finds_the_whole_verb_list():
    """A regex that matched nothing would green leg (a) for free."""
    assert len(runbook_verbs()) >= 8
