#!/usr/bin/env python3
"""Extract per-model token usage for one eval run from Claude Code transcripts.

Covers all three places usage hides:
  1. Main-loop API calls: `message.usage` on assistant (and ai-title etc.)
     events, deduplicated by message id (streaming can emit several events
     per id; the last one wins).
  2. Task-tool subagents: `toolUseResult.usage` on the dispatching user
     event, attributed to `toolUseResult.resolvedModel` (deduped by agentId).
  3. Workflow-engine subagents: separate agent-*.jsonl files under the
     session directory (rule 1 applied to each).

Cache accounting: writes at 1.25x input (flat, regardless of TTL), reads at
0.1x. Validated 2026-06-11 against the Claude Code client's own session cost
display: mixed-A-1 reproduced the displayed $36.23 to the cent, with
per-model token totals matching the display. (The API price sheet bills 1h
writes at 2.0x; the client display does not, and the display is our
definition of API-equivalent.)

Usage:
  extract_tokens.py <session.jsonl> [more.jsonl ...]
Globs agent-*.jsonl under each session's sidecar directory automatically.
CAUTION: a session that enters a worktree continues in a second project
directory (-<run>--claude-worktrees-<name>); pass BOTH jsonl files.
"""
import glob
import json
import pathlib
import sys

PRICES = {  # $ per million tokens: (input, output)
    "fable": (10.0, 50.0),
    "opus": (5.0, 25.0),
    "sonnet": (3.0, 15.0),
    "haiku": (1.0, 5.0),
}


def tier(model):
    for k in PRICES:
        if k in (model or ""):
            return k
    return "fable"  # session default


def add(acc, model, u):
    cc = u.get("cache_creation_input_tokens") or 0
    split = u.get("cache_creation") or {}
    cc_5m = split.get("ephemeral_5m_input_tokens")
    cc_1h = split.get("ephemeral_1h_input_tokens")
    if cc_5m is None and cc_1h is None:
        cc_5m, cc_1h = cc, 0
    a = acc.setdefault(tier(model), {"in": 0, "out": 0, "cc_5m": 0, "cc_1h": 0, "cr": 0})
    a["in"] += u.get("input_tokens") or 0
    a["out"] += u.get("output_tokens") or 0
    a["cc_5m"] += cc_5m or 0
    a["cc_1h"] += cc_1h or 0
    a["cr"] += u.get("cache_read_input_tokens") or 0


def harvest_file(path, acc):
    by_msg = {}    # message id -> (model, usage); last event wins
    by_agent = {}  # agentId -> (model, usage); last event wins
    anon = 0
    with open(path) as f:
        for line in f:
            try:
                d = json.loads(line)
            except json.JSONDecodeError:
                continue
            msg = d.get("message") or {}
            if isinstance(msg, dict) and msg.get("usage"):
                key = msg.get("id")
                if key is None:
                    anon += 1
                    key = f"anon-{path}-{anon}"
                by_msg[key] = (msg.get("model"), msg["usage"])
            tr = d.get("toolUseResult")
            if isinstance(tr, dict) and isinstance(tr.get("usage"), dict):
                key = tr.get("agentId") or f"anon-agent-{path}-{len(by_agent)}"
                by_agent[key] = (tr.get("resolvedModel"), tr["usage"])
    for model, u in by_msg.values():
        add(acc, model, u)
    for model, u in by_agent.values():
        add(acc, model, u)


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    acc = {}
    files = []
    for arg in sys.argv[1:]:
        p = pathlib.Path(arg)
        files.append(p)
        sidecar = p.with_suffix("")  # <session>/ directory next to <session>.jsonl
        files.extend(pathlib.Path(x) for x in glob.glob(f"{sidecar}/**/agent-*.jsonl", recursive=True))
    for p in files:
        harvest_file(p, acc)

    print(f"{len(files)} transcript file(s)")
    total = 0.0
    for model, a in sorted(acc.items()):
        p_in, p_out = PRICES[model]
        cc = a["cc_5m"] + a["cc_1h"]
        eff_in = a["in"] + 1.25 * cc + 0.1 * a["cr"]
        usd = eff_in / 1e6 * p_in + a["out"] / 1e6 * p_out
        total += usd
        print(f"{model:7s} in={a['in']:>10,} cw={cc:>9,} "
              f"cr={a['cr']:>11,} out={a['out']:>8,}  eff_in={eff_in:>12,.0f}  ${usd:.2f}")
    print(f"TOTAL ${total:.2f}")


if __name__ == "__main__":
    main()
