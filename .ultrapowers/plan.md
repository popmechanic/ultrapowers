# Jev reads every proof-gate round beside the agent reader, on the record only

**Grammar:** claims-v1
**Claim:** Every proof-gate round records what Jev would have said beside the agent reader's verdict, and one command reads how often the two agreed. (elicited)
**Summary:** Today each task of a plan gets a full agent reader at the proof gate, about a minute and a whole agent's tokens per round, for a judgment Jev could make in a second: does each clause state a checkable fact, would a probe catch it false, and does a leg contradict its clause. This asks Jev those three questions at every gate round, next to the agent's verdict, and adds a reading that counts their agreement across plans. Nothing switches: this is an experiment (n=0), the agent reader still decides, and the rollback is dropping the one gate paragraph that runs it.

**Goal:** `skills/ultrawrite/stories/gate_jev.ts` — one Jev request per gate diet, a verdict in code, `--record` into the plan's gate record beside the agent's verdict, and `--agreement` over a directory of records; the questions and thresholds beside the authoring ones; one paragraph in §The proof gate.
**Tech Stack:** Bun + TypeScript, JSON, Markdown
**Spec:** none — the whole-codebase review of 2026-09-29 (the proof gate, both the ultrapowers and ultrawrite readings' Jev candidate 1); operator pick 2026-09-29 ("Proof gate on Jev")

## Global Constraints

- The agent reader, its question, and the gate record's `hash`, `verdict` and `reason` per task are unchanged; `plan_check.py` reads what it reads today.
- Check: python3 -m pytest -q

### Task 1: The Jev gate reader and its agreement reading

**Type:** implementation

**Files:**
- Create: `skills/ultrawrite/stories/gate_jev.ts`
- Create: `skills/ultrawrite/stories/jev.ts`
- Modify: `skills/ultrawrite/stories/jev_checks.ts`
- Modify: `skills/ultrawrite/stories/questions.json`
- Modify: `skills/ultrawrite/stories/policy.json`
- Create: `fleet/tests/gate_jev_probe.mjs`

**Claim:** Every proof-gate round records what Jev would have said beside the agent reader's verdict, and one command reads how often the two agreed. (derived)
Machine: M1. `node fleet/tests/gate_jev_probe.mjs record` prints `GATE JEV record OK` and exits 0. The case runs `gate_jev.ts <diet> --record <rec> --agent pass` against a stand-in Jev, on a diet for task `3` with hash `h1` whose Machine line numbers `M1` and `M2`. The stand-in answers every `fact:` question 0.9, every `caught:` question 0.1 and `contradiction` 0.1. The case checks four things:
- exactly one request was made, asking exactly the question ids `fact:M1`, `caught:M1`, `fact:M2`, `caught:M2` and `contradiction`;
- that request's state `clauses` is two entries with ids `M1` and `M2`;
- stdout is one JSON line whose `verdict` is `fail`;
- the record's `tasks["3"]` keeps its seeded `hash`, `verdict` and `reason`, and gains `gate_rounds` equal to one entry with `hash` `h1`, `agent` `pass` and `jev` `fail`.

M2. `node fleet/tests/gate_jev_probe.mjs agreement` prints `GATE JEV agreement OK` and exits 0. The case runs `gate_jev.ts --agreement <dir>` over two records:
- one whose task `1` has `gate_rounds` agent/jev `pass`/`pass` then `fail`/`pass`;
- one whose task `1` has `fail`/`fail`.

It checks that stdout is exactly `gate-jev: n=2 plans, 3 rounds, agree 2, jev-only fail 0, agent-only fail 1`. M3. `skills/ultrawrite/stories/questions.json` carries a `gate` set whose questions `fact`, `caught` and `contradiction` are each of `type` `noul`, and `skills/ultrawrite/stories/policy.json`'s `flag_at` carries `gate_fact` `0.5`, `gate_caught_below` `0.5` and `gate_contradiction` `0.5`.

**Authorized-by:** the whole-codebase review of 2026-09-29 (Jev candidate 1 in the ultrapowers and ultrawrite readings); operator pick 2026-09-29

**Interfaces:**
- Consumes: none
- Produces: `gate_jev.ts <diet.json> [--record <gate-verdicts.json> --agent pass|fail]`
- Produces: `gate_jev.ts --agreement <dir>`

**Context:** The gate reader's input is `extract_gate_input.py`'s JSON (the "diet"): `{task, claim, proof, hash, base}`.
- `claim` is the task's Claim sentence, then a `Machine:` line whose clauses are numbered `M1. … M2. …`.
- `proof` is the Proof slot's text: `- Run: <command> [M1, M2]` lines (the trailing tag names the clauses a probe proves; an untagged `Run:` is a guard), then one `- Legs: (a) … [M1]; (b) … [M2].` line.

**`gate_jev.ts <diet>`** makes one Jev request. Its state is:
- `claim`: the sentence before `Machine:`;
- `clauses`: `[{id: 'M1', text}, …]`, from splitting the Machine line on `M<n>. `;
- `probes`: `[{command, proves: ['M1', …]}]`;
- `legs`: `[{text, cites: ['M1', …]}]`.

Its questions come from `questions.json`'s new `gate` set, one pair per clause plus one for the task:
- `fact:<id>`: "Does `clauses[i].text` state a computable fact: an exit code, a recorded argv, a byte-exact string, a count, an ordering of events, or that something is gone, unchanged or exactly so many?"
- `caught:<id>`: "Would at least one command in `probes` fail if `clauses[i].text` were false?"
- `contradiction`: "Does any entry of `legs` say something the clause it cites rules out?"

Question text names `clauses[i]` with `i` filled in, as `jev_checks.ts`'s `at()` already does. The verdict is computed in code, from `policy.json` `flag_at`: `fail` when any clause has `fact ≥ gate_fact` and `caught < gate_caught_below`, or when `contradiction ≥ gate_contradiction`; else `pass`. A null reply is verdict `null`. It prints one JSON line: `{task, hash, verdict, clauses: [{id, fact, caught}], contradiction}`.

**`--record <file> --agent pass|fail`** also appends `{hash, agent, jev: verdict}` to `tasks[<task>].gate_rounds` in that gate record. It creates the task entry or the array if absent, and touches no other key. `plan_check.py` tolerates extra keys in a task's entry.

**`--agreement <dir>`** reads every `*.gate-verdicts.json` in the directory. Over every `gate_rounds` entry whose `jev` is not null, it prints `gate-jev: n=<records with at least one such entry> plans, <entries> rounds, agree <agent == jev>, jev-only fail <jev fail, agent pass>, agent-only fail <agent fail, jev pass>`.

**The shared client.** Move `key()` and the client setup out of `jev_checks.ts`'s `defaultAsk` into `stories/jev.ts`, and import it in both scripts. The setup is `makeJevClient` from `factory/jev-client.mjs`, with `TYPESAFE_BASE_URL` defaulting to `https://api.typesafe.ai`, the bearer from `$ULTRAPOWERS_HOME/typesafe.env`, and a 30 s timeout. `jev_checks.ts`'s behaviour is unchanged, and `fleet/tests/jev_calls_probe.mjs` (all four cases) must stay green.

**The probe `fleet/tests/gate_jev_probe.mjs`** is unbridged, in the shape of `fleet/tests/jev_calls_probe.mjs`:
- It starts a `node:http` stand-in on `127.0.0.1` port 0, which records each request and answers each question id by its prefix.
- It writes a temp `ULTRAPOWERS_HOME/typesafe.env` holding `TYPESAFE_API_KEY=fake-key`.
- It runs `bun skills/ultrawrite/stories/gate_jev.ts …` with `TYPESAFE_BASE_URL` set to the stand-in.
- The case is `argv[2]`, `record` or `agreement`. It prints `GATE JEV <case> OK`, or names what differed and exits 1.

**Proof:**
- Run: node fleet/tests/gate_jev_probe.mjs record [M1]
- Run: node fleet/tests/gate_jev_probe.mjs agreement [M2]
- Run: node -e "const q=JSON.parse(require('fs').readFileSync('skills/ultrawrite/stories/questions.json','utf8')).gate; const p=JSON.parse(require('fs').readFileSync('skills/ultrawrite/stories/policy.json','utf8')).flag_at; process.exit(q && ['fact','caught','contradiction'].every((k)=>q[k]&&q[k].type==='noul') && p.gate_fact===0.5 && p.gate_caught_below===0.5 && p.gate_contradiction===0.5 ? 0 : 1)" [M3]
- Run: node fleet/tests/jev_calls_probe.mjs bundle
- Legs: (a) one request carries the five questions over the parsed clauses, a caught-less fact yields `fail`, and the round is recorded beside the agent's verdict without touching the rest of the record [M1]; (b) three rounds over two plans are counted exactly [M2]; (c) the three questions and three thresholds exist [M3].

**Stale-if:**
- path-absent: `skills/ultrawrite/stories/jev_checks.ts`

### Task 2: The proof gate runs Jev beside each reader

**Type:** implementation

**Files:**
- Modify: `skills/ultrawrite/SKILL.md`

**Claim:** Every proof-gate round records what Jev would have said beside the agent reader's verdict. (derived)
Machine: M1. The `## The proof gate` section of `skills/ultrawrite/SKILL.md` (up to the next `## ` heading) contains `gate_jev.ts`, `--agent`, `--agreement`, `experiment` and `rollback`.

**Authorized-by:** operator pick 2026-09-29 ("Proof gate on Jev")

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** Add one paragraph to §The proof gate, after the paragraph on dispatching readers per task. It says:
- When each reader's verdict returns, the author runs `bun $UW/../stories/gate_jev.ts <the same diet file> --record <plan-stem>.gate-verdicts.json --agent <that verdict>` (`$UW` is the section's own scripts path).
- The call is record-only: Jev decides nothing, and the agent's verdict is the gate.
- A release reads `bun $UW/../stories/gate_jev.ts --agreement docs/superpowers/plans` and carries its line in the notes.
- It is an `experiment` at n=0. No default flips until 5 plans' readings exist, and its `rollback` is dropping this paragraph.

Keep the rest of the section as it is. The laptop's key is `~/.ultrapowers/typesafe.env`, which the section may name.

**Proof:**
- Run: python3 -c "t=open('skills/ultrawrite/SKILL.md').read(); i=t.index('## The proof gate'); j=t.find('\n## ', i+1); s=t[i:j if j>0 else len(t)]; assert all(w in s for w in ('gate_jev.ts','--agent','--agreement','experiment','rollback'))" [M1]
- Run: python3 skills/ultrapowers/scripts/validate_skill.py skills/ultrawrite
- Legs: (a) the gate section names the command, both of its modes, and the experiment with its rollback [M1].

**Stale-if:**
- path-absent: `skills/ultrawrite/SKILL.md`
