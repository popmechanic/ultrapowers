"""The launch line on the page names only flags the engine has (task 2).

`SKILL.md` §Client tells the operator to run `fleet/drive-one.mjs` with a
specific set of flags. When the page and the engine drift apart — a flag
renamed, a flag documented before it shipped — the drive dies at argument
parsing with `unknown flag`, two hops away, after the plan has been staged.
Run-59 lost a launch that way: the documented engine pin selected a commit
whose `drive-one.mjs` answered `unknown flag --target`.

This pin makes that class inexpressible: every `--flag` token on the launch
line has to appear in the string `usage()` returns. It reads `usage()` without
importing anything — the function body is a concatenation of string literals,
so a regex over the file's text is enough, and the pin costs no node process.

`ULTRAPOWERS_SKILL_MD` overrides which `SKILL.md` is read, so the exam can
point this file at a mutated copy and watch it fail.

Offline: reads two committed files.
"""
import os
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
SKILL_ENV = "ULTRAPOWERS_SKILL_MD"
SKILL_DEFAULT = ROOT / "skills/ultrapowers/SKILL.md"
DRIVE_ONE = ROOT / "fleet/drive-one.mjs"

# The launch line is the one that invokes the driver; the exam mutates that
# same line, so it is found by what it runs rather than by where it sits.
DRIVER_INVOCATION = "node fleet/drive-one.mjs"

# `--flag`, not `---` and not the tail of a word: the line also carries paths
# and a redirect.
FLAG_RE = re.compile(r"(?<![\w-])--([A-Za-z][A-Za-z0-9-]*)")

# `export const usage = () =>` followed by single-quoted literals joined by `+`.
USAGE_HEAD_RE = re.compile(r"\busage\s*=\s*\(\s*\)\s*=>")
USAGE_PART_RE = re.compile(r"\s*'((?:[^'\\]|\\.)*)'\s*(\+)?")


def skill_md_path():
    """The `SKILL.md` this run pins — the environment's, or the repository's."""
    override = os.environ.get(SKILL_ENV)
    return pathlib.Path(override) if override else SKILL_DEFAULT


def read(path):
    assert path.is_file(), f"{path} not found"
    return path.read_text(encoding="utf-8")


def launch_line(path):
    """The single `SKILL.md` line that invokes `fleet/drive-one.mjs`."""
    lines = [
        line.strip()
        for line in read(path).splitlines()
        if DRIVER_INVOCATION in line
    ]
    assert len(lines) == 1, (
        f"expected exactly one `{DRIVER_INVOCATION}` line in {path}, found "
        f"{len(lines)}: {lines!r}"
    )
    return lines[0]


def launch_flags(path):
    """Every `--flag` the launch line names, in the order it names them."""
    seen, out = set(), []
    for name in FLAG_RE.findall(launch_line(path)):
        if name not in seen:
            seen.add(name)
            out.append("--" + name)
    return out


def usage_string():
    """What `fleet/drive-one.mjs`'s `usage()` returns, read as text."""
    text = read(DRIVE_ONE)
    head = USAGE_HEAD_RE.search(text)
    assert head, (
        f"{DRIVE_ONE} has no `usage = () =>` definition to read the flag "
        "vocabulary from"
    )
    parts, pos = [], head.end()
    while True:
        part = USAGE_PART_RE.match(text, pos)
        assert part, (
            f"{DRIVE_ONE}'s `usage()` is not a concatenation of single-quoted "
            f"literals at offset {pos}: {text[pos:pos + 80]!r}"
        )
        parts.append(part.group(1))
        pos = part.end()
        if not part.group(2):
            break
    return "".join(parts)


def test_usage_reads_as_a_flag_vocabulary():
    """The regex read of `usage()` produces the driver's usage line."""
    usage = usage_string()
    assert usage.startswith("usage: node fleet/drive-one.mjs"), (
        "`usage()` did not read back as a usage line; got: " + repr(usage)
    )
    assert "--target" in usage, (
        "`usage()` read back without `--target`, so the vocabulary this pin "
        "checks against is not the driver's: " + repr(usage)
    )


def test_launch_line_names_at_least_the_required_flags():
    """The launch line carries flags at all — an empty read would pass the
    pin below without checking anything."""
    flags = launch_flags(skill_md_path())
    for required in ("--target", "--base"):
        assert required in flags, (
            f"the launch line does not carry `{required}`: {flags!r}"
        )


def test_every_launch_line_flag_exists_in_the_engine():
    """Every `--flag` the page's launch line names appears in `usage()`."""
    path = skill_md_path()
    usage = usage_string()
    flags = launch_flags(path)
    unknown = [flag for flag in flags if flag not in usage]
    assert not unknown, (
        f"{path} names {len(unknown)} flag(s) `fleet/drive-one.mjs` does not "
        "have: " + ", ".join(unknown) + "\nlaunch line:\n"
        + launch_line(path) + "\nusage():\n" + usage
    )
