"""A stand-in for the plan compiler."""


def compile_plan(text):
    return {"tasks": [line for line in text.splitlines() if line.startswith("### Task")]}
