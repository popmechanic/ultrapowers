#!/usr/bin/env python3
"""Validate a Claude Code SKILL.md: frontmatter + reference integrity."""
import re, sys, pathlib

def validate(skill_dir: pathlib.Path):
    errors = []
    skill_md = skill_dir / "SKILL.md"
    if not skill_md.exists():
        return [f"{skill_md} not found"]
    text = skill_md.read_text()
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", text, re.DOTALL)
    if not m:
        return ["SKILL.md missing YAML frontmatter (--- ... ---)"]
    fm, body = m.group(1), m.group(2)
    fields = dict(re.findall(r"^([A-Za-z0-9_-]+):\s*(.*)$", fm, re.MULTILINE))
    if not fields.get("name"):
        errors.append("frontmatter: missing 'name'")
    desc = fields.get("description", "")
    if len(desc) < 20:
        errors.append("frontmatter: missing or trivial 'description'")
    for ref in re.findall(r"references/([A-Za-z0-9_\-/]+\.md)", body):
        if not (skill_dir / "references" / ref).exists():
            errors.append(f"missing referenced file: references/{ref}")
    return errors

if __name__ == "__main__":
    target = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path.cwd()
    errs = validate(target)
    if errs:
        print("\n".join(errs)); sys.exit(1)
    print("skill ok"); sys.exit(0)
