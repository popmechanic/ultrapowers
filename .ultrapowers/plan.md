# The checker catches the author's slips, computes the route, and every Jev question lives in one file

**Grammar:** claims-v1
**Claim:** When I sign a plan, the checker itself refuses the slips the author used to catch by eye and tells me which way to run the plan, every question Jev is asked lives in one file, and Jev reads two more of the author's calls on the record without deciding anything. (elicited)
**Summary:** This moves five things the plan author checked by hand into the plan checker, which now refuses a plan that breaks them, and has the checker work out which way to run a plan instead of the author. It exists because those hand checks and that route were calls a program can make exactly, and because Jev's questions were split across two files. You get plans that cannot slip past on those five points, a route you can trust, one place to read every question Jev is asked, and two new Jev readings on the record that change nothing until they have been measured.

**Goal:** The authoring half of the operator's 2026-09-29 decisions: five `grammar:` refusals in `plan_check.py`, a computed `ROUTING fact:` line, one question file (`factory/questions.json`), a note on the story kinds nothing reads yet, and two record-only Jev readings (`desired_state` in `check_provenance.py`, `about_product` in `jev_checks.ts`).
**Tech Stack:** Python 3 (the plan checker, provenance), Bun + TypeScript (the authoring Jev client), JSON, Markdown
**Spec:** none — operator decisions 2026-09-29 (the authoring half; the engine half is a sibling plan on `factory/flock/*`, `factory/policy.json`, `factory/record.mjs`, `factory/audit.mjs` and `fleet/*`, none of which this plan touches)

## Global Constraints

- No probe or test reaches the real network: every Jev call in a `Run:` goes to the local stand-in `tests/jev_standin.py` or to the closed port `http://127.0.0.1:9`.
- `factory/flock/engine.mjs` is not edited; it reads `sets.flock_step`, `sets.flock_resolve` and `sets.flock_release` by name, and those three sets stay byte-for-byte what they are.
- A stories-v1 plan is checked by `stories_check` alone: none of the new refusals or the `ROUTING fact:` line applies to it.
- Check: python3 -m pytest -q

### Task 1: A local stand-in Jev and a one-question entry for the laptop

**Type:** implementation

**Files:**
- Create: `tests/jev_standin.py`
- Create: `skills/ultrawrite/stories/ask.ts`

**Claim:** The authoring scripts can ask Jev any one question from the question file, and every probe of them runs against a local stand-in instead of the network. (derived)
Machine: M1. `echo '{"task":"x"}' | python3 tests/jev_standin.py 0.8 -- bun skills/ultrawrite/stories/ask.ts flock_release blocker` exits 0 and prints exactly `{"noul":0.8}` on stdout. M2. With Jev unreachable (`TYPESAFE_BASE_URL=http://127.0.0.1:9` and a key in `$ULTRAPOWERS_HOME/typesafe.env`), `bun skills/ultrawrite/stories/ask.ts flock_release blocker` exits 0 and prints exactly `{"noul":null}`. M3. `python3 tests/jev_standin.py 0.8 --log <file> -- <the M1 command>` writes one JSON line per request it received to `<file>`: exactly one line here, whose `questions` object has exactly the one key `blocker` and whose `state` equals `{"task":"x"}`. M4. `bun skills/ultrawrite/stories/ask.ts no_such_set blocker` exits 2 and prints nothing on stdout.

**Authorized-by:** operator decisions 2026-09-29 (the handoff is computed; two record-only Jev questions; probes never hit the real network)

**Interfaces:**
- Consumes: none
- Produces: `ask.ts <set> <question>`

**Context:** Two small tools that sibling tasks of this plan run in their probes.
- **`skills/ultrawrite/stories/ask.ts <set> <question>`** (Bun): reads the whole of stdin as JSON — that is the Jev `state` — loads `factory/questions.json` (path relative to the script: `join(import.meta.dir, '..', '..', '..', 'factory', 'questions.json')`), takes `sets[<set>].questions[<question>]`, asks it through `defaultAsk` from `./jev` with `questions = {<question>: <that object>}`, and prints `JSON.stringify({noul: noul(answers, <question>)})` from `./jev`'s `noul` — so a failed call (no key, a refused socket, a 4xx) prints `{"noul":null}` and still exits 0. An unknown set or question, a wrong argument count, or stdin that is not JSON prints a usage or error line on stderr, nothing on stdout, and exits 2. `jev.ts` reads `TYPESAFE_BASE_URL` (default `https://api.typesafe.ai`) and the key from `$ULTRAPOWERS_HOME/typesafe.env` (default `~/.ultrapowers`); do not change `jev.ts`.
- **`tests/jev_standin.py <noul> [--log <file>] -- <command...>`** (Python 3 standard library only; pytest does not collect it — the name does not start `test_`): starts an HTTP server on `127.0.0.1`, port 0 (the OS picks), makes a fresh temporary directory holding `typesafe.env` with the line `TYPESAFE_API_KEY=standin-key`, and runs `<command...>` with `TYPESAFE_BASE_URL=http://127.0.0.1:<port>` and `ULTRAPOWERS_HOME=<that directory>` added to the environment. The child inherits stdin, stdout and stderr; the stand-in prints nothing on stdout itself and exits with the child's exit code, after shutting the server down and removing the directory. It answers `POST /v1/systemone` with status 200 and `{"answers": {<every key of the request's "questions">: {"noul": <noul as a float>}}}`, and anything else with 404. With `--log <file>` it appends each received request body, as one compact JSON line, to `<file>`. It must serve requests while the child runs (a thread), and serve several at once (`ThreadingHTTPServer`), since `jev_checks.ts` sends its requests concurrently.
- The reply shape the Bun client (`factory/jev-client.mjs`) accepts is exactly the one `fleet/tests/jev_calls_probe.mjs` serves: `{answers}` with each answer `{noul: <number>}`.

**Proof:**
- Run: out=$(echo '{"task":"x"}' | python3 tests/jev_standin.py 0.8 -- bun skills/ultrawrite/stories/ask.ts flock_release blocker) && test "$out" = '{"noul":0.8}' [M1]
- Run: d=$(mktemp -d) && printf 'TYPESAFE_API_KEY=k\n' > $d/typesafe.env && out=$(echo '{}' | TYPESAFE_BASE_URL=http://127.0.0.1:9 ULTRAPOWERS_HOME=$d bun skills/ultrawrite/stories/ask.ts flock_release blocker) && test "$out" = '{"noul":null}' [M2]
- Run: d=$(mktemp -d) && echo '{"task":"x"}' | python3 tests/jev_standin.py 0.8 --log $d/log -- bun skills/ultrawrite/stories/ask.ts flock_release blocker > /dev/null && python3 -c "import json,sys; rows=[json.loads(l) for l in open(sys.argv[1]) if l.strip()]; assert len(rows) == 1 and list(rows[0]['questions']) == ['blocker'] and rows[0]['state'] == {'task': 'x'}, rows" $d/log [M3]
- Run: out=$(bun skills/ultrawrite/stories/ask.ts no_such_set blocker < /dev/null); test $? = 2 && test -z "$out" [M4]
- Legs: (a) through the stand-in answering 0.8 the entry exits 0 and prints exactly the one JSON line [M1]; (b) against a closed port it exits 0 and prints exactly the null line [M2]; (c) the log holds exactly one request asking only `blocker` with the stdin state [M3]; (d) an unknown set exits exactly 2 with empty stdout [M4].

**Stale-if:**
- path-exists: `skills/ultrawrite/stories/ask.ts`

### Task 2: One question file

**Type:** implementation

**Files:**
- Modify: `factory/questions.json`
- Delete: `skills/ultrawrite/stories/questions.json`
- Modify: `skills/ultrawrite/stories/jev_checks.ts`
- Modify: `skills/ultrawrite/stories/gate_jev.ts`
- Modify: `skills/ultrawrite/stories/policy.json`

**Claim:** Every question Jev is asked lives in one file, each set saying when it is asked, who reads it and how to turn it off. (derived)
Machine: M1. In `factory/questions.json`, the sets `authoring_ambiguity`, `authoring_coherence`, `authoring_content_branch`, `authoring_decompose`, `authoring_gate`, `authoring_link`, `authoring_map`, `authoring_near_miss`, `authoring_redundancy` and `authoring_surprise` carry, under `questions`, exactly the questions the stories file carried under those ten group names — the sha256 of `json.dumps({g: sets['authoring_' + g]['questions'] for g in the ten groups}, sort_keys=True)` is `43426b94660a356d56b0a12c84c424e7c0c16c4f580d243016a53e9694e9d0e0` — and the three sets `flock_step`, `flock_resolve` and `flock_release` are unchanged: the sha256 of `json.dumps` of those three, `sort_keys=True`, is `83d1a1934a80e012f1f56f4816918fb283d83c6a8c03aa564779c81604c07226`. M2. Exactly 13 sets are named `authoring_…`, and every one carries `when`, `reader`, `rollback`, `state`, `provenance` and `calibrated` equal to `false`; `authoring_gate`'s `reader` is `skills/ultrawrite/stories/gate_jev.ts`. M3. `skills/ultrawrite/stories/questions.json` does not exist. M4. `authoring_routing.questions.risk`, `authoring_desired_state.questions.desired_state` and `authoring_about_product.questions.about_product` each have `type` `noul` and the `instructions.question` strings the Context gives, byte for byte. M5. `skills/ultrawrite/stories/policy.json`'s `flag_at` carries `routing_risk` 0.5 and `about_product` 0.5.

**Authorized-by:** operator decisions 2026-09-29 (one question file; the handoff is computed; two record-only Jev questions)

**Interfaces:**
- Consumes: none
- Produces: `authoring_routing`
- Produces: `authoring_desired_state`
- Produces: `authoring_about_product`

**Context:** `factory/questions.json` is `{"version", "about", "sets": {flock_step, flock_resolve, flock_release}}`; `factory/flock/engine.mjs` (lines 158–164) reads the three flock sets by name, so adding sets leaves it alone. Append thirteen sets after `flock_release`, in this order, each `{"when", "reader", "rollback", "state", "provenance", "calibrated": false, "questions": {...}}`.
- **The ten moved sets.** For each top-level group `G` of `skills/ultrawrite/stories/questions.json` (every key but `version` and `about`), the set `authoring_G` whose `questions` is that group's object unchanged — every question object byte-equal as JSON; no question text changes. `state` lists the keys the reader sends: ambiguity `["ask","sentences"]`; coherence `["piece"]`; near_miss `["piece","story","story_steps","near_miss"]`; content_branch `["store_module","actions"]`; redundancy `["pieces"]`; surprise `["ask","assumption"]`; map `["summary","audience","piece","other_purposes"]`; decompose `["audience","summary","plan","built_before"]`; gate `["claim","clauses","probes","legs"]`; link `["audience","summary","link"]`. `reader` is `skills/ultrawrite/stories/jev_checks.ts` for all but gate, whose reader is `skills/ultrawrite/stories/gate_jev.ts`. `when` names the stage (gate: "At each proof-gate round, beside the agent reader"; the others: "At jev_checks.ts --stage <stage>" for the stage that asks it — ambiguity at understanding and bundle, surprise at understanding, map and one_need at map, decompose at decompose, the rest at bundle). `rollback`: "skills/ultrawrite/stories/policy.json flag_at: flags off, the author's own read decides". `provenance`: "moved from skills/ultrawrite/stories/questions.json (authoring-questions-v2), 2026-09-29".
- **The three new sets**, each question `{"type": "noul", "instructions": {"question": …, "context": …}, "criteria": {"true": …, "false": …}}`:
  - `authoring_routing`, question `risk`: question "Does `plan` change a high-stakes surface (auth, payments, migrations, data integrity, a public API, or loops, cursors, pagination, budgets or termination logic), or behaviour that is hard to verify by reading?"; context "`plan` is an implementation plan: its tasks, each with its title, its claim (what it promises and the numbered machine clauses that restate it) and the files it touches."; criteria true "It touches a high-stakes surface or behaviour hard to verify by reading", false "Every change is low-stakes and easy to verify by reading". `when` "At plan_check.py --base, once per plan, for its ROUTING fact line"; `reader` "skills/ultrapowers/scripts/plan_check.py"; `rollback` "risk unread: the branch is computed without it, and the line says so"; `state` `["plan"]`.
  - `authoring_desired_state`, question `desired_state`: question "Does `sentence` say what should be true after the change, rather than what is wrong today?"; context "`issue_body` is a GitHub issue's text; `sentence` is the sentence a plan quotes from it as its promise."; criteria true "It says what should be true after the change", false "It describes what is wrong today". `when` "At check_provenance.py, once per quoted Claim whose issue resolves"; `reader` "skills/ultrawrite/scripts/check_provenance.py"; `rollback` "no reading: the author's own read decides"; `state` `["issue_body","sentence"]`.
  - `authoring_about_product`, question `about_product`: question "Is `assumption` about what the app does, who uses it or how it looks?"; context "`assumption` is something the author assumed while planning an app and labelled technical, a choice the person using the app would not see."; criteria true "It is about what the app does, who uses it or how it looks", false "It is a technical choice the person using the app would never see". `when` "At jev_checks.ts --stage understanding, once per assumption the author labelled technical"; `reader` "skills/ultrawrite/stories/jev_checks.ts"; `rollback` "flag off: the author's own read decides"; `state` `["assumption"]`.
  All three `provenance`: "operator decisions 2026-09-29".
- Rewrite `factory/questions.json`'s `about` so it no longer says the file holds three Flock sets: it holds the Flock's sets and the authoring sets, each naming its reader and rollback. Leave `version` as it is.
- **Readers.** `jev_checks.ts` line 17 builds its `Q` from the sets: `Q[G] = sets['authoring_' + G].questions` for the ten groups, so every `Q.ambiguity.two_apps`-style use below it reads as before. `gate_jev.ts` line 15 reads `sets.authoring_gate.questions`. Both resolve the file as `join(import.meta.dir, '..', '..', '..', 'factory', 'questions.json')`. Delete `skills/ultrawrite/stories/questions.json`.
- **Policy.** Add `"routing_risk": 0.5` and `"about_product": 0.5` to `flag_at` in `skills/ultrawrite/stories/policy.json`; the file is already `"experiment": true` at `n` 0 with its rollback named, which covers both.
- The existing probes `fleet/tests/jev_calls_probe.mjs` and `fleet/tests/gate_jev_probe.mjs` drive both readers against a stand-in and must stay green; this plan edits neither.

**Proof:**
- Run: python3 -c "import json,hashlib; s=json.load(open('factory/questions.json'))['sets']; G=['ambiguity','coherence','content_branch','decompose','gate','link','map','near_miss','redundancy','surprise']; h=lambda o: hashlib.sha256(json.dumps(o, sort_keys=True).encode()).hexdigest(); assert h({g: s['authoring_' + g]['questions'] for g in G}) == '43426b94660a356d56b0a12c84c424e7c0c16c4f580d243016a53e9694e9d0e0'; assert h({k: s[k] for k in ('flock_step','flock_resolve','flock_release')}) == '83d1a1934a80e012f1f56f4816918fb283d83c6a8c03aa564779c81604c07226'" [M1]
- Run: python3 -c "import json; s=json.load(open('factory/questions.json'))['sets']; a=[k for k in s if k.startswith('authoring_')]; assert len(a) == 13, a; assert all({'when','reader','rollback','state','provenance'} <= set(s[k]) and s[k].get('calibrated') is False for k in a); assert s['authoring_gate']['reader'] == 'skills/ultrawrite/stories/gate_jev.ts'" [M2]
- Run: test ! -e skills/ultrawrite/stories/questions.json [M3]
- Run: python3 -c "import json; s=json.load(open('factory/questions.json'))['sets']; q=lambda k, n: s[k]['questions'][n]; assert all(q(k, n)['type'] == 'noul' for k, n in (('authoring_routing','risk'),('authoring_desired_state','desired_state'),('authoring_about_product','about_product'))); assert q('authoring_routing','risk')['instructions']['question'] == 'Does ' + chr(96) + 'plan' + chr(96) + ' change a high-stakes surface (auth, payments, migrations, data integrity, a public API, or loops, cursors, pagination, budgets or termination logic), or behaviour that is hard to verify by reading?'; assert q('authoring_desired_state','desired_state')['instructions']['question'] == 'Does ' + chr(96) + 'sentence' + chr(96) + ' say what should be true after the change, rather than what is wrong today?'; assert q('authoring_about_product','about_product')['instructions']['question'] == 'Is ' + chr(96) + 'assumption' + chr(96) + ' about what the app does, who uses it or how it looks?'" [M4]
- Run: python3 -c "import json; f=json.load(open('skills/ultrawrite/stories/policy.json'))['flag_at']; assert f['routing_risk'] == 0.5 and f['about_product'] == 0.5, f" [M5]
- Run: node fleet/tests/jev_calls_probe.mjs bundle | grep -q 'JEV CALLS bundle OK'
- Run: node fleet/tests/jev_calls_probe.mjs understanding | grep -q 'JEV CALLS understanding OK'
- Run: node fleet/tests/gate_jev_probe.mjs record | grep -q 'GATE JEV record OK'
- Legs: (a) the ten moved sets hash to the stories file's frozen digest and the three flock sets to theirs [M1]; (b) exactly 13 authoring sets, each with the six keys and `calibrated` false, and the gate set names its reader [M2]; (c) the stories question file is absent [M3]; (d) the three new questions are `noul` with their exact question strings [M4]; (e) both thresholds read 0.5 [M5].

**Stale-if:**
- path-absent: `skills/ultrawrite/stories/questions.json`

### Task 3: The handoff route is computed and printed

**Type:** implementation

**Files:**
- Modify: `skills/ultrapowers/scripts/plan_check.py`
- Modify: `skills/ultrawrite/SKILL.md`
- Modify: `tests/conftest.py`
- Create: `tests/fixtures/routing/plan.md`
- Create: `tests/fixtures/routing/plan.gate-verdicts.json`

**Claim:** When a plan is checked against its base, I am shown the route it recommends and the three signals behind it, computed rather than worked out by hand, and a record naming a different route is pointed out without refusing the plan. (derived)
Machine: M1. Through a stand-in Jev answering 0.9, `python3 skills/ultrapowers/scripts/plan_check.py --base . tests/fixtures/routing/plan.md` prints the line `ROUTING fact: T=3, width 2, risk 0.90, branch risk`. M2. Answering 0.1, it prints `ROUTING fact: T=3, width 2, risk 0.10, branch width`. M3. With Jev unreachable, it prints `ROUTING fact: T=3, width 2, risk unread, branch width (computed without risk)`. M4. Answering 0.1, stdout carries the line `ROUTING fact: recorded branch inline differs from the computed branch width` (the fixture's record names branch `inline`), and no stdout line starting `grammar:` names `routing.branch`. M5. With Jev unreachable, no stdout line contains `differs from the computed branch`. M6. `skills/ultrawrite/SKILL.md`'s `## Execution handoff` section carries the sentence the Context gives.

**Authorized-by:** operator decisions 2026-09-29 (the handoff is computed)

**Interfaces:**
- Consumes: `authoring_routing`
- Consumes: `ask.ts <set> <question>`
- Produces: `ROUTING fact:`

**Context:** Under `--base` only, whatever the verdict, `plan_check.py` prints one `ROUTING fact:` line after the `BASE fact:`/`STALE fact:`/`GREEN-AT-BASE fact:` lines and before the `AUTHORING fact:` line; a plan the parser refuses and a stories-v1 plan (which returns early) print none.
- **The signals.** `T` is the number of implementation tasks (`len(result["tasks"])` from `plan_parse.parse_plan_full`). `width` is the size of the largest wave in `result["launch_waves"]` — two tasks share a Kahn layer exactly when neither reaches the other, so a wave of 2 or more is the "≥2 tasks with no derived edge between them" of ultrawrite §Execution handoff. `risk` is one Jev reading of the question `authoring_routing` / `risk` in `factory/questions.json` (added by a sibling task), asked by running `bun <repo>/skills/ultrawrite/stories/ask.ts authoring_routing risk` (the path resolved from `plan_check.py`'s own location, `Path(__file__).resolve().parents[2] / "ultrawrite/stories/ask.ts"`) with the state `{"plan": {"tasks": [{"title": …, "claim": …, "files": […]}]}}` — each implementation task's heading title, its full Claim slot text and its `files` — as JSON on stdin, a 45-second timeout, and stdout parsed as `{"noul": <number|null>}`. The entry prints `{"noul":0.9}` for a reading and `{"noul":null}` for a failed call. Any failure — no `bun`, a missing `ask.ts` (the launcher runs a copy of `plan_check.py` fetched at the engine sha, with nothing beside it), a timeout, a non-zero exit, output that is not that JSON, a null — is risk `unread`. Ask once per run.
- **The branch**, first match wins: risk read and `≥ flag_at.routing_risk` of `skills/ultrawrite/stories/policy.json` (0.5, added by a sibling task) → `risk`; `width ≥ 2` and `T ≥ 3` → `width`; `T ≤ 2` → `inline`; else `subagent`. Risk prints as two decimals (`0.90`); unread prints `risk unread` and the line ends ` (computed without risk)`. The exact shapes: `ROUTING fact: T=3, width 2, risk 0.90, branch risk` and `ROUTING fact: T=3, width 2, risk unread, branch width (computed without risk)`.
- **The mismatch line, never a refusal** (operator, 2026-09-29: a risk reading near 0.5 can flip between two checks, so a mismatch must not block a plan). Under `--base`, when risk was read and the record's `authoring.routing.branch` is one of the four branches but not the computed one, `plan_check.py` prints one more line right after the `ROUTING fact:` line: `ROUTING fact: recorded branch <recorded> differs from the computed branch <branch>`. It adds no violation and changes no exit code. With risk unread there is no such line. Without `--base` nothing changes. Reuse the one reading for both lines.
- **The fixture** `tests/fixtures/routing/plan.md`: a claims-v1 plan (H1, `**Grammar:** claims-v1`, a `**Claim:** … (elicited)` header line) of three implementation tasks, each with the six body slots and a Stale-if of `path-exists: tests/fixtures/routing/never-there.md` (which never holds, so no STALE refusal): task 1 `Produces:` `make_widget(n: int) -> Widget`, task 3 `Consumes:` the same, task 2 neither, and no `Run:` naming another task's file — so `launch_waves` is `[[1, 2], [3]]`. `tests/fixtures/routing/plan.gate-verdicts.json` is `{"tasks": {}, "tally": {}, "authoring": {"minutes": 1, "probes": 0, "routing": {"branch": "inline", "lane": "inline"}, "questions": []}}` — its missing verdicts draw gate refusals, which is fine: the probes read only the lines they name.
- **The suite stays hermetic.** Every `--base` exam in `tests/test_plan_check.py` now runs `ask.ts`; on a laptop holding a real key that would call TypeSafe. In `tests/conftest.py`, set `os.environ["ULTRAPOWERS_HOME"]` to a fresh empty temporary directory at import, so no pytest run finds a key and every reading is a quick null. Keep its collection hook as it is.
- **SKILL.md** — in `## Execution handoff`, directly after the three signal bullets (T, parallel width, risk), add this sentence as its own paragraph, wrapped at spaces only: "Since 2026-09-29 the author computes none of these signals: `plan_check.py --base` prints them, and the branch, on one `ROUTING fact:` line, and the author reads that line." Keep the first-match rule and the three options as they are; the author writes the line's branch into the record's `routing.branch`. Extend `plan_check.py`'s module docstring with the new line and refusal. A sibling task edits `## Self-review` and the Context-slot bullet of the same file — stay out of those.

**Proof:**
- Run: python3 tests/jev_standin.py 0.9 -- python3 skills/ultrapowers/scripts/plan_check.py --base . tests/fixtures/routing/plan.md | grep -qxF 'ROUTING fact: T=3, width 2, risk 0.90, branch risk' [M1]
- Run: python3 tests/jev_standin.py 0.1 -- python3 skills/ultrapowers/scripts/plan_check.py --base . tests/fixtures/routing/plan.md | grep -qxF 'ROUTING fact: T=3, width 2, risk 0.10, branch width' [M2]
- Run: d=$(mktemp -d) && printf 'TYPESAFE_API_KEY=k\n' > $d/typesafe.env && TYPESAFE_BASE_URL=http://127.0.0.1:9 ULTRAPOWERS_HOME=$d python3 skills/ultrapowers/scripts/plan_check.py --base . tests/fixtures/routing/plan.md | grep -qxF 'ROUTING fact: T=3, width 2, risk unread, branch width (computed without risk)' [M3]
- Run: out=$(python3 tests/jev_standin.py 0.1 -- python3 skills/ultrapowers/scripts/plan_check.py --base . tests/fixtures/routing/plan.md); echo "$out" | grep -qxF 'ROUTING fact: recorded branch inline differs from the computed branch width' && ! echo "$out" | grep -q '^grammar:.*routing.branch' [M4]
- Run: d=$(mktemp -d) && printf 'TYPESAFE_API_KEY=k\n' > $d/typesafe.env && out=$(TYPESAFE_BASE_URL=http://127.0.0.1:9 ULTRAPOWERS_HOME=$d python3 skills/ultrapowers/scripts/plan_check.py --base . tests/fixtures/routing/plan.md); echo "$out" | grep -q '^ROUTING fact:' && ! echo "$out" | grep -qF 'differs from the computed branch' [M5]
- Run: sed -n '/^## Execution handoff/,/^## Self-review/p' skills/ultrawrite/SKILL.md | tr '\n' ' ' | tr -s ' ' | grep -q 'the author computes none of these signals: .plan_check.py --base. prints them, and the branch, on one .ROUTING fact:. line, and the author reads that line' [M6]
- Run: python3 skills/ultrapowers/scripts/plan_check.py evals/fixtures/stories/todo/.ultrapowers/plan.md | grep -qx 'PLAN OK'
- Legs: (a) a 0.9 reading prints the risk-branch line exactly [M1]; (b) a 0.1 reading prints the width-branch line exactly [M2]; (c) an unreachable Jev prints the unread line exactly [M3]; (d) a 0.1 reading points out the record's `inline` against the computed `width`, and refuses nothing on it [M4]; (e) unread, a ROUTING line prints and no mismatch line does [M5]; (f) the handoff section carries the sentence [M6].

**Stale-if:**
- path-exists: `tests/fixtures/routing/plan.md`

### Task 4: Jev reads whether a quoted Claim says what should be true

**Type:** implementation

**Files:**
- Modify: `skills/ultrawrite/scripts/check_provenance.py`
- Create: `tests/fixtures/provenance/plan.md`

**Claim:** When a plan quotes an issue as its promise, Jev's reading of whether the quote says what should be true after the change is printed and kept on the record, and it never refuses the plan. (derived)
Machine: M1. Through a stand-in Jev answering 0.8, `check_provenance.py <copy of tests/fixtures/provenance/plan.md> --gh 'echo Every widget answers its size.'` exits 0 and prints the line `JEV desired_state: 0.80 — plan-level claim quotes #1`. M2. Answering 0.1 it still exits 0 and prints a line starting `provenance: ok`. M3. After the 0.8 run, the copy's sibling `plan.gate-verdicts.json` carries a `jev_readings` list with exactly one row, whose `question` is `desired_state`, `subject` is `plan-level claim` and `noul` is 0.8. M4. With Jev unreachable it exits 0 and prints no line starting `JEV desired_state`.

**Authorized-by:** operator decisions 2026-09-29 (two record-only Jev questions: desired_state)

**Interfaces:**
- Consumes: `authoring_desired_state`
- Consumes: `ask.ts <set> <question>`
- Produces: none

**Context:** `check_provenance.py` already fetches each quoted issue's body (`issue_body`, through `--gh`) and string-matches the operator sentence. For every quoted Claim — plan-level and task-level — whose issue body resolved and whose sentence is verbatim in it, ask the question `authoring_desired_state` / `desired_state` of `factory/questions.json` (added by a sibling task) by running `bun <repo>/skills/ultrawrite/stories/ask.ts authoring_desired_state desired_state` (path from the script's own location: `Path(__file__).resolve().parents[1] / "stories/ask.ts"`) with `{"issue_body": <the body>, "sentence": <the folded sentence>}` as JSON on stdin and a 45-second timeout; its stdout is `{"noul": <number|null>}`. Any failure (no `bun`, a timeout, a non-zero exit, unparseable output, a null) is no reading: print nothing for it and record nothing.
- A reading prints one line, `JEV desired_state: <noul, two decimals> — <subject> quotes #<N>`, where the subject is `plan-level claim` or `task <id> claim`, and appends one row `{"question": "desired_state", "subject": <subject>, "issue": <N as an int>, "noul": <the number>, "date": <UTC YYYY-MM-DD>}` to a top-level `jev_readings` list in the plan's sibling `<stem>.gate-verdicts.json` — created as `{"jev_readings": [...]}` when the file does not exist, every other key left as it was (`plan_check.py` tolerates extra keys). The reading never changes the exit code or the failure lines: it is record-only, beside the author's own read.
- **The fixture** `tests/fixtures/provenance/plan.md`: a claims-v1 plan whose header is `**Grammar:** claims-v1` then `**Claim:** Every widget answers its size. (quoted from #1)`, and one implementation task with the six body slots, a `(derived)` Claim and `**Authorized-by:** #1`. The fake `--gh 'echo Every widget answers its size.'` prints that sentence followed by the arguments `issue view 1 --json body -q .body`, so the body resolves and holds the sentence verbatim. The probes copy the fixture into a fresh temporary directory first, so the record is written there and never beside the committed fixture.

**Proof:**
- Run: d=$(mktemp -d) && cp tests/fixtures/provenance/plan.md $d/ && out=$(python3 tests/jev_standin.py 0.8 -- python3 skills/ultrawrite/scripts/check_provenance.py $d/plan.md --gh 'echo Every widget answers its size.') && echo "$out" | grep -qxF 'JEV desired_state: 0.80 — plan-level claim quotes #1' [M1]
- Run: d=$(mktemp -d) && cp tests/fixtures/provenance/plan.md $d/ && out=$(python3 tests/jev_standin.py 0.1 -- python3 skills/ultrawrite/scripts/check_provenance.py $d/plan.md --gh 'echo Every widget answers its size.') && echo "$out" | grep -q '^provenance: ok' && echo "$out" | grep -qxF 'JEV desired_state: 0.10 — plan-level claim quotes #1' [M2]
- Run: d=$(mktemp -d) && cp tests/fixtures/provenance/plan.md $d/ && python3 tests/jev_standin.py 0.8 -- python3 skills/ultrawrite/scripts/check_provenance.py $d/plan.md --gh 'echo Every widget answers its size.' > /dev/null && python3 -c "import json,sys; r=json.load(open(sys.argv[1]))['jev_readings']; assert len(r) == 1 and r[0]['question'] == 'desired_state' and r[0]['subject'] == 'plan-level claim' and r[0]['noul'] == 0.8, r" $d/plan.gate-verdicts.json [M3]
- Run: d=$(mktemp -d) && cp tests/fixtures/provenance/plan.md $d/ && printf 'TYPESAFE_API_KEY=k\n' > $d/typesafe.env && out=$(TYPESAFE_BASE_URL=http://127.0.0.1:9 ULTRAPOWERS_HOME=$d python3 skills/ultrawrite/scripts/check_provenance.py $d/plan.md --gh 'echo Every widget answers its size.') && echo "$out" | grep -q '^provenance: ok' && ! echo "$out" | grep -q '^JEV desired_state' [M4]
- Legs: (a) a 0.8 reading exits 0 and prints the exact line [M1]; (b) a low reading still exits 0 with the ok line [M2]; (c) the record gains exactly one `desired_state` row with the subject and reading [M3]; (d) unreachable, it exits 0 and prints no reading line [M4].

**Stale-if:**
- path-exists: `tests/fixtures/provenance/plan.md`

### Task 5: Jev flags a technical label that may hide a product assumption

**Type:** implementation

**Files:**
- Modify: `skills/ultrawrite/stories/jev_checks.ts`
- Create: `tests/fixtures/about_product/product.json`

**Claim:** When the author labels an assumption technical, Jev reads whether it is really about the app, and a high reading is flagged to the author as possibly hidden from the surprise check, on the record and never deciding. (derived)
Machine: M1. Through a stand-in Jev answering 0.8, `bun skills/ultrawrite/stories/jev_checks.ts <copy of tests/fixtures/about_product> --stage understanding` exits 0 and prints the line `JEV flag: assumption "todos are saved in a SQLite table" is labelled technical but reads as about the product (about_product 0.80); the label may hide it from the surprise check`. M2. Answering 0.2, it exits 0 and no line contains `is labelled technical but reads as about the product`. M3. After the 0.8 run, the copy's `product.json` `readings` carry exactly one row whose `question` is `about_product`, with `stage` `understanding`, `subject` `todos are saved in a SQLite table`, `noul` 0.8 and `flagged` true.

**Authorized-by:** operator decisions 2026-09-29 (two record-only Jev questions: about_product)

**Interfaces:**
- Consumes: `authoring_about_product`
- Produces: none

**Context:** In `jev_checks.ts`'s `understanding` stage (the function `understanding`), the surprise question is asked only of assumptions with `about === 'product' && by === 'author'`. Add one read per assumption with `about === 'technical' && by === 'author'`: through the stage's own `one(...)` reader (so the reading lands in `product.readings` like every other, stage `understanding`), state `{assumption: <its text>}`, questions `{about_product: <sets.authoring_about_product.questions.about_product of factory/questions.json>}`, label `technical assumption "<text>"`, subject the text. A sibling task moves the question file and rebuilds this script's `Q` from `factory/questions.json`'s `authoring_*` sets; read this question from that file's `sets.authoring_about_product.questions.about_product`. The threshold is `flag_at.about_product` of `skills/ultrawrite/stories/policy.json` (0.5, added by that sibling): a reading `≥` it pushes onto `out.flags` exactly `JEV flag: assumption "<text>" is labelled technical but reads as about the product (about_product <two decimals>); the label may hide it from the surprise check`. It never becomes a `DOUBT:` and never refuses: the author acts on it. The `JEV read:` summary line counts it as a flag like any other.
- **The fixture** `tests/fixtures/about_product/product.json`: a copy of `skills/ultrawrite/catalog/todo-tags/product.json` whose `understanding.assumed` gains one entry `{"text": "todos are saved in a SQLite table", "about": "technical", "state": "decided", "by": "author"}`, still passing `checkProduct` (the script exits 2 with one line per problem otherwise). The stage rewrites `product.json`, so the probes copy the fixture directory into a fresh temporary directory first.
- `fleet/tests/jev_calls_probe.mjs understanding` reads `skills/ultrawrite/catalog/todo-tags`, whose assumptions are all the operator's and about the product, so it sends no new request and must stay green.

**Proof:**
- Run: d=$(mktemp -d) && cp tests/fixtures/about_product/product.json $d/ && out=$(python3 tests/jev_standin.py 0.8 -- bun skills/ultrawrite/stories/jev_checks.ts $d --stage understanding) && echo "$out" | grep -qxF 'JEV flag: assumption "todos are saved in a SQLite table" is labelled technical but reads as about the product (about_product 0.80); the label may hide it from the surprise check' [M1]
- Run: d=$(mktemp -d) && cp tests/fixtures/about_product/product.json $d/ && out=$(python3 tests/jev_standin.py 0.2 -- bun skills/ultrawrite/stories/jev_checks.ts $d --stage understanding) && echo "$out" | grep -q '^JEV read:' && ! echo "$out" | grep -qF 'is labelled technical but reads as about the product' [M2]
- Run: d=$(mktemp -d) && cp tests/fixtures/about_product/product.json $d/ && python3 tests/jev_standin.py 0.8 -- bun skills/ultrawrite/stories/jev_checks.ts $d --stage understanding > /dev/null && python3 -c "import json,sys; r=[x for x in json.load(open(sys.argv[1]))['readings'] if x['question'] == 'about_product']; assert len(r) == 1 and r[0]['stage'] == 'understanding' and r[0]['subject'] == 'todos are saved in a SQLite table' and r[0]['noul'] == 0.8 and r[0]['flagged'] is True, r" $d/product.json [M3]
- Run: node fleet/tests/jev_calls_probe.mjs understanding | grep -q 'JEV CALLS understanding OK'
- Legs: (a) a 0.8 reading exits 0 and prints the exact flag line [M1]; (b) a 0.2 reading exits 0 and prints no such flag [M2]; (c) the product record holds exactly one `about_product` reading with its stage, subject, value and flag [M3].

**Stale-if:**
- path-exists: `tests/fixtures/about_product/product.json`

### Task 6: The checker refuses five slips the author used to catch by eye

**Type:** implementation

**Files:**
- Modify: `skills/ultrapowers/scripts/plan_check.py`
- Modify: `tests/test_plan_check.py`
- Modify: `skills/ultrawrite/SKILL.md`
- Create: `tests/fixtures/plan_check_slips/good.md`
- Create: `tests/fixtures/plan_check_slips/good.gate-verdicts.json`

**Claim:** A claims-v1 plan with any of five slips the author used to catch by eye is refused when it is checked, and a plan without them still checks out. (derived)
Machine: M1. `good.md` with its `**Authorized-by:**` line removed prints `grammar: task 1: the body must carry Claim, Authorized-by, Interfaces, Context, Proof and Stale-if, each once, non-empty, in that order`. M2. `good.md` with the sentence `Two.` put at the head of its Summary prints `grammar: header: the **Summary:** paragraph has 4 sentences; it carries exactly three`. M3. `good.md` with its `**Closes:**` line moved below `**Tech Stack:**` prints `grammar: header: the **Closes:** line sits directly under the **Goal:** paragraph`. M4. `good.md` with a `~~~` fence added under its task's Context line prints `grammar: task 1: a code fence outside the Proof slot`, and with one added under its `**Tech Stack:**` line prints `grammar: header: a code fence above the first task`. M5. `good.md` with ` (3 runs, 2026-09-22)` appended to its task's Context line prints `grammar: task 1: Context cites a dated reading without n= — (3 runs, 2026-09-22)`. M6. `plan_check.py tests/fixtures/plan_check_slips/good.md` exits 0 and prints `PLAN OK` as its first line. M7. `skills/ultrawrite/SKILL.md`'s `## Self-review` section says `refuses five slips outright, so this list leaves them out` and no longer carries `Every task carries all six slots`, `fence sits in Proof`, `sits directly under` or `paragraph of three sentences`, and the file no longer carries `nothing enforces it`. M8. `tests/test_plan_check.py` collects at least 6 tests whose names start `test_slips_`.

**Authorized-by:** operator decisions 2026-09-29 (plan_check refuses five mechanical self-review slips)

**Interfaces:**
- Consumes: none
- Produces: `slip_violations(text, tasks)`

**Context:** Add `slip_violations(text, tasks)` to `plan_check.py` and sum it into `main`'s `violations` on the claims-v1 path only — a stories-v1 plan returns earlier through `stories_check` and must stay untouched. Every line is a `grammar:` refusal. Build on `plan_parse`'s own scanners: `_fence_aware_lines`, `_header_lines` (the `(line, fenced)` pairs above the first task heading — fenced is True for a fence marker and everything inside one), `_split_plan`, `SLOT_RE`, `_slot_name`.
- **(a) Six slots.** For each task, the slot labels on its unfenced body lines (after the heading), in order, must be exactly `claim, authorized-by, interfaces, context, proof, stale-if` (each once), and each slot's text — the label line's remainder plus the lines to the next label, stripped — non-empty. Else one line: `grammar: task <id>: the body must carry Claim, Authorized-by, Interfaces, Context, Proof and Stale-if, each once, non-empty, in that order`.
- **(b) Summary.** The header's `**Summary:**` paragraph — that line's remainder plus the following lines up to the first blank line, joined with single spaces. Absent, nothing is said. Its sentences: split the text at every run of whitespace that follows `.`, `!` or `?` (optionally followed by any of `)`, `"`, `'` or `]`) and precedes an uppercase letter, a digit, `"`, `(`, a backtick or `[`; the non-empty pieces are the sentences — as a regex, `(?<=[.!?])["')\]]*\s+(?=[A-Z0-9"(\x60\[])`. Not exactly three: `grammar: header: the **Summary:** paragraph has <k> sentences; it carries exactly three`.
- **(c) Closes.** A header line starting `**Closes:**` whose preceding lines, back to the first blank line or line starting `**`, do not begin at a line starting `**Goal:**` — i.e. the Goal line and its wrapped continuation lines are directly above it: `grammar: header: the **Closes:** line sits directly under the **Goal:** paragraph`.
- **(d) Fences.** Any fenced line in the header: one line `grammar: header: a code fence above the first task`. Any fenced line in a task body outside its Proof slot (before the first slot label, or inside any other slot): one line per task, `grammar: task <id>: a code fence outside the Proof slot`. A fence in Proof is legal. Fenced lines in an `##` section outside every task: one line, `grammar: a code fence outside every task`.
- **(e) Readings.** In the Summary paragraph and in each task's Context slot text (joined on single spaces), every innermost parenthesised span `\(([^()]*)\)` that contains a date `\b20\d\d-\d\d-\d\d\b` and a count `(?<![-\d])\d+\s+(?:[a-z-]+\s+)?(?:runs?|plans?|tasks?|readings?|calls?|products?|dispatches|sittings?|landings?|rounds?)(?![-\w])` and no `\bn\s*=` is one line: `grammar: task <id>: Context cites a dated reading without n= — (<span>)` or `grammar: header: the **Summary:** cites a dated reading without n= — (<span>)`. The rule is narrow on purpose: a dated count in parentheses is how this repo cites a reading, and the author measured it at 0 hits on every 2026-09-29 plan and 5 on the older ones, each a real reading (n=5 hits over every plan in docs/superpowers/plans, read 2026-09-29).
- **The fixture** `tests/fixtures/plan_check_slips/good.md` must pass all five and print `PLAN OK` with its record: H1; `**Grammar:** claims-v1`; `**Claim:** … (elicited)`; directly under it `**Summary:**` of exactly three sentences, one carrying `(n=2 runs, 2026-09-22)`; a blank line; `**Goal:** …` on one line; directly under it `**Closes:** #1`; `**Tech Stack:** …` on one line. One task, `**Type:** implementation`, one `- Modify:` path, the six slots in order, each non-empty and each label with its text on the label's own line (Authorized-by on exactly one line); its Context on one line carrying `(n=1 run, 2026-09-22)`; its Proof a `- Run: true [M1]`, a `~~~` fenced block of one line, and a `- Legs:` bullet citing `[M1]`; Stale-if `path-exists: tests/fixtures/plan_check_slips/never-there.md`. Sign it with `python3 skills/ultrawrite/scripts/extract_gate_input.py tests/fixtures/plan_check_slips/good.md --task 1` → `{"tasks": {"1": {"hash": <its hash>, "verdict": "pass", "reason": "fixture"}}, "tally": {"dispatched": 1, "rejected": 0}}`. The probes derive each slip from it with `python3 -c` and `re.sub`, so keep those anchors: the Summary line starts `**Summary:** `, the Context line starts `**Context:**`, the Closes line is the only `**Closes:**` line.
- **Tests.** In `tests/test_plan_check.py`, one test per rule, each named `test_slips_…` (at least six: one per rule plus the good fixture), in the file's own style (a plan string, a subprocess, the exact line).
- **SKILL.md** (`skills/ultrawrite/SKILL.md`) — `## Self-review`: remove the five mechanical halves and keep the rest: the first bullet keeps only "no checkbox steps"; the Summary bullet drops "of three sentences directly under that Claim" and keeps the register; the Stale-if bullet drops "every fence sits in Proof"; the Closes bullet keeps only "names only the target repository's issues"; the n= bullet stays. Add, as the section's first line after its opening paragraph, a sentence containing, on one line or wrapped at spaces, `refuses five slips outright, so this list leaves them out`, naming the five (six slots each once, non-empty and in order; a three-sentence Summary; Closes directly under Goal; a fence only in Proof; a dated reading in a Context or the Summary with `n=`). In the Context-slot bullet of `## Task shape` (about line 195), "a fence elsewhere is the author's own to catch — nothing enforces it" becomes a sentence saying `plan_check.py` refuses it. In §The proof gate's paragraph beginning "`plan_check.py` sits on `plan_parse.py`", add the five slips to what it refuses. A sibling task adds a sentence to `## Execution handoff` of the same file — stay out of that section.

**Proof:**
- Run: d=$(mktemp -d) && python3 -c "import re,sys; t=open(sys.argv[1]).read(); t=re.sub(r'(?m)^\*\*Authorized-by:\*\*.*\n', '', t); print(t, end='')" tests/fixtures/plan_check_slips/good.md > $d/p.md && python3 skills/ultrapowers/scripts/plan_check.py $d/p.md | grep -qF 'grammar: task 1: the body must carry Claim, Authorized-by, Interfaces, Context, Proof and Stale-if, each once, non-empty, in that order' [M1]
- Run: d=$(mktemp -d) && python3 -c "import re,sys; t=open(sys.argv[1]).read(); t=re.sub(r'(?m)^\*\*Summary:\*\* ', '**Summary:** Two. ', t); print(t, end='')" tests/fixtures/plan_check_slips/good.md > $d/p.md && python3 skills/ultrapowers/scripts/plan_check.py $d/p.md | grep -qF 'grammar: header: the **Summary:** paragraph has 4 sentences; it carries exactly three' [M2]
- Run: d=$(mktemp -d) && python3 -c "import re,sys; t=open(sys.argv[1]).read(); t=re.sub(r'(?m)^\*\*Closes:\*\*.*\n', '', t); t=re.sub(r'(?m)^(\*\*Tech Stack:\*\*.*\n)', r'\1**Closes:** #1\n', t); print(t, end='')" tests/fixtures/plan_check_slips/good.md > $d/p.md && python3 skills/ultrapowers/scripts/plan_check.py $d/p.md | grep -qF 'grammar: header: the **Closes:** line sits directly under the **Goal:** paragraph' [M3]
- Run: d=$(mktemp -d) && python3 -c "import re,sys; t=open(sys.argv[1]).read(); t=re.sub(r'(?m)^(\*\*Context:\*\*.*)$', r'\1\n~~~\nx\n~~~', t); print(t, end='')" tests/fixtures/plan_check_slips/good.md > $d/p.md && python3 skills/ultrapowers/scripts/plan_check.py $d/p.md | grep -qF 'grammar: task 1: a code fence outside the Proof slot' [M4]
- Run: d=$(mktemp -d) && python3 -c "import re,sys; t=open(sys.argv[1]).read(); t=re.sub(r'(?m)^(\*\*Tech Stack:\*\*.*)$', r'\1\n~~~\nx\n~~~', t); print(t, end='')" tests/fixtures/plan_check_slips/good.md > $d/p.md && python3 skills/ultrapowers/scripts/plan_check.py $d/p.md | grep -qF 'grammar: header: a code fence above the first task' [M4]
- Run: d=$(mktemp -d) && python3 -c "import re,sys; t=open(sys.argv[1]).read(); t=re.sub(r'(?m)^(\*\*Context:\*\*.*)$', r'\1 (3 runs, 2026-09-22)', t); print(t, end='')" tests/fixtures/plan_check_slips/good.md > $d/p.md && python3 skills/ultrapowers/scripts/plan_check.py $d/p.md | grep -qF 'grammar: task 1: Context cites a dated reading without n= — (3 runs, 2026-09-22)' [M5]
- Run: out=$(python3 skills/ultrapowers/scripts/plan_check.py tests/fixtures/plan_check_slips/good.md) && test "$(echo "$out" | head -1)" = 'PLAN OK' [M6]
- Run: s=$(sed -n '/^## Self-review/,$p' skills/ultrawrite/SKILL.md | tr '\n' ' ' | tr -s ' ') && echo "$s" | grep -qF 'refuses five slips outright, so this list leaves them out' && ! echo "$s" | grep -qF 'Every task carries all six slots' && ! echo "$s" | grep -qF 'fence sits in Proof' && ! echo "$s" | grep -qF 'sits directly under' && ! echo "$s" | grep -qF 'paragraph of three sentences' && ! grep -qF 'nothing enforces it' skills/ultrawrite/SKILL.md [M7]
- Run: test "$(python3 -m pytest --collect-only -q tests/test_plan_check.py -k test_slips_ | grep -c '::test_slips_')" -ge 6 [M8]
- Run: python3 skills/ultrapowers/scripts/plan_check.py evals/fixtures/stories/todo/.ultrapowers/plan.md | grep -qx 'PLAN OK'
- Legs: (a) a missing slot prints the six-slot refusal [M1]; (b) a four-sentence Summary prints the count refusal with 4 [M2]; (c) a Closes line off the Goal prints the placement refusal [M3]; (d) a fence under Context and a fence in the header each print their refusal [M4]; (e) a dated count without n= in a Context prints the reading refusal naming the span [M5]; (f) the clean fixture exits 0 with `PLAN OK` first [M6]; (g) the Self-review section carries the new sentence and none of the four old phrases, and the file drops "nothing enforces it" [M7]; (h) at least six `test_slips_` tests collect [M8].

**Stale-if:**
- path-exists: `tests/fixtures/plan_check_slips/good.md`

### Task 7: A note that two story kinds and the numbers are declared but unread

**Type:** implementation

**Files:**
- Modify: `skills/ultrawrite/stories/bundle.ts`
- Modify: `skills/ultrapowers/scripts/stories_parse.py`

**Claim:** Anyone reading where the story kinds and the numbers are defined is told they are the declared shape for a checker still owed, which nothing reads yet. (derived)
Machine: M1. In `skills/ultrawrite/stories/bundle.ts` the line directly above `export const KINDS` is `// preserve and look are the declared shape for the Numbers checker still owed; nothing reads them yet.`, and the line directly above the `numbers?:` field of `Page` ends with `// numbers is the declared shape for the Numbers checker still owed; nothing reads it yet.` M2. In `skills/ultrapowers/scripts/stories_parse.py` the line directly above `KINDS = ` is `# preserve and look are the declared shape for the Numbers checker still owed; nothing reads them yet.`, and the line directly above `elif bm and section == "numbers":` ends with `# numbers is the declared shape for the Numbers checker still owed; nothing reads it yet.`

**Authorized-by:** operator decisions 2026-09-29 (story kinds note)

**Interfaces:**
- Consumes: none
- Produces: none

**Context:** Comments only; no code changes. `KINDS` lists `behaviour`, `preserve` and `look`, and `page.numbers` carries `{id, sentence, measure, target}`: the parser accepts both, and no checker acts on a `preserve` or `look` kind or on a number yet — the Numbers checker is owed. In `bundle.ts`, `export const KINDS` is at line 9 and `numbers?:` at line 29 inside `export type Page`; indent the second comment like the field. In `stories_parse.py`, `KINDS = (` is at line 16 and `elif bm and section == "numbers":` at line 114; indent the second comment like the `elif`.

**Proof:**
- Run: grep -B1 '^export const KINDS' skills/ultrawrite/stories/bundle.ts | head -1 | grep -qxF '// preserve and look are the declared shape for the Numbers checker still owed; nothing reads them yet.' && grep -B1 'numbers?: {id: string' skills/ultrawrite/stories/bundle.ts | head -1 | grep -q '// numbers is the declared shape for the Numbers checker still owed; nothing reads it yet\.$' [M1]
- Run: grep -B1 '^KINDS = ' skills/ultrapowers/scripts/stories_parse.py | head -1 | grep -qxF '# preserve and look are the declared shape for the Numbers checker still owed; nothing reads them yet.' && grep -B1 'elif bm and section == "numbers":' skills/ultrapowers/scripts/stories_parse.py | head -1 | grep -q '# numbers is the declared shape for the Numbers checker still owed; nothing reads it yet\.$' [M2]
- Run: python3 -m pytest -q tests/test_stories_parse.py
- Legs: (a) both comment lines sit directly above their definitions in the TypeScript bundle loader [M1]; (b) both sit directly above theirs in the Python parser [M2].

**Stale-if:**
- path-absent: `skills/ultrapowers/scripts/stories_parse.py`
