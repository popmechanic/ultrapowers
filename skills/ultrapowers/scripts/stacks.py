#!/usr/bin/env python3
"""A Stack is what the plugin knows about one kind of target app. TinyApp is
the only one. The laptop half lives here, and TinyApp's probe runner is
factory/stack/tinyapp/check.ts; the state reader, the lint and step replay are
sub-project 2's and raise until then."""


class Stack:
    name = None
    grammar = None
    bootstrap = None

    def detect(self, paths):
        raise NotImplementedError

    def parse_plan(self, text):
        raise NotImplementedError

    def run_probe(self, plan_path, clause, copy_dir):
        raise NotImplementedError("the state-probe runner is story-planning sub-project 2")

    def state_of(self, copy_dir):
        raise NotImplementedError("reading app state is story-planning sub-project 2")

    def lint(self, copy_dir):
        raise NotImplementedError("the state lint is story-planning sub-project 2")


class TinyAppStack(Stack):
    name = "tinyapp"
    grammar = "stories-v1"
    bootstrap = "bun install"

    def detect(self, paths):
        paths = set(paths)
        return "package.json" in paths and any(p.endswith("wrangler.jsonc") for p in paths)

    def parse_plan(self, text):
        import stories_parse
        return stories_parse.parse_stories_text(text)

    def run_probe(self, plan_path, clause, copy_dir):
        import json
        import os
        import subprocess
        check = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..",
                             "factory", "stack", "tinyapp", "check.ts")
        r = subprocess.run(["bun", os.path.abspath(check), "--plan", plan_path, "--clause", clause,
                            "--copy", copy_dir, "--json"], capture_output=True, text=True)
        return json.loads(r.stdout.strip().splitlines()[-1])


STACKS = {"tinyapp": TinyAppStack()}


def stack_for(name):
    return STACKS.get(name)
