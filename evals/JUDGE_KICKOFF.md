# Judge kickoff prompt

Paste the block below into a **fresh Claude Code session** opened at the root of
this repo — not the eval-coordinator session and never a condition-run session.
It onboards the operator (me) to the blinded quality judge — the ONLY part of the
eval that spends real API dollars — and smoke-tests it before any real judging.

---

You are onboarding me to the eval's quality judge. Read `evals/README.md` (the
Judging section) and skim `evals/scripts/judge.py` before doing anything. Context
you should know: `judge.py` performs blinded pairwise judging — a fresh-context
`claude-opus-4-8` sees the frozen plan and two anonymized diffs in randomized
order and returns a structured verdict. It reads scored runs from
`evals/results/runs.jsonl` and diffs from `evals/results/diffs/`, and appends to
`evals/results/judgments.jsonl`. Unlike the runs themselves (which ride my Max
subscription), the judge calls the API directly with a key: roughly **$0.30–0.80
per judgment**, ~36 judgments for the full matrix, **$10–30 total**.

Walk me through this in order, one step at a time, waiting for me between steps:

1. **Prerequisite check (you).** Verify scored runs exist: read
   `evals/results/runs.jsonl` and report which fixture/condition/rep cells are
   present and which REP-MATCHED CROSS-CONDITION PAIRS exist (the judge pairs
   `cond_a` rep N with `cond_b` rep N within a fixture). If no cross-condition
   pairs exist yet, say exactly which runs are missing and stop — except for the
   self-pair smoke test in step 4, which needs only ONE scored run.

2. **API key (me, never you).** Walk me through this exactly, then wait:
   (a) I create a key at console.anthropic.com → API Keys, and set a spend limit
   on it (suggest $50).
   (b) In MY TERMINAL — not in this chat — I store it in a locked file. Give me
   these commands to copy:
   ```sh
   mkdir -p ~/.config/ultrapowers-eval
   read -rs KEY   # paste the key at the silent prompt, press Enter
   printf '%s' "$KEY" > ~/.config/ultrapowers-eval/judge.key
   chmod 600 ~/.config/ultrapowers-eval/judge.key
   unset KEY
   ```
   `read -rs` keeps the key out of shell history and off the screen; the file
   keeps it out of this chat. **Do NOT have me `export ANTHROPIC_API_KEY` in the
   shell that runs Claude Code** — Claude Code itself reads that variable, and on
   a subscription plan it can silently switch the whole session to API-key
   billing. The key must reach ONLY the judge process, via a per-command prefix:
   ```sh
   ANTHROPIC_API_KEY=$(cat ~/.config/ultrapowers-eval/judge.key) python3 evals/scripts/judge.py ...
   ```
   (c) You verify the file exists, is non-empty, and is mode 600 — without ever
   printing its contents:
   `test -s ~/.config/ultrapowers-eval/judge.key && stat -c %a ~/.config/ultrapowers-eval/judge.key`
   (on macOS: `stat -f %Lp`). Also check `pip show anthropic` and install it if
   missing.

3. **Penny check (you).** One minimal API call to prove the key works before any
   real spend — a tiny messages request, max_tokens 32, run with the per-command
   key prefix above; print the model and token usage, never the key. Costs well
   under a cent. If it fails, debug auth before proceeding.

4. **Self-pair smoke test (you), ~$0.50.** Run the judge with BOTH conditions set
   to the same condition that has a scored run, e.g.:
   `ANTHROPIC_API_KEY=$(cat ~/.config/ultrapowers-eval/judge.key) python3 evals/scripts/judge.py --fixture degrade --cond-a B --cond-b B`
   This pairs a run's diff against ITSELF — the correct verdict is `tie`, so it
   validates the key, the API call, the schema parsing, and the judge's sanity in
   one shot. Show me the verdict and the appended judgments.jsonl row. Then
   **delete that smoke row from judgments.jsonl** (and tell me you did) — a
   self-pair would pollute the report's win rates. If the judge does NOT say tie
   on identical diffs, stop and tell me; that's a rubric problem worth fixing
   before spending more.

5. **Real judging (you, with my go-ahead per batch).** For each fixture with
   pairs, in this order: A-vs-B first (the headline), then B-vs-C (the tiering
   quality question). One fixture at a time; after each, show me the verdicts and
   a running cost estimate. Stop and check with me if any judgment errors,
   refuses, or looks anomalous.

6. **Stability check (you, with my go-ahead — costs about as much as the
   original judgments).** Once a decent batch of judgments exists:
   `ANTHROPIC_API_KEY=$(cat ~/.config/ultrapowers-eval/judge.key) python3 evals/scripts/judge.py --check-stability`
   re-judges every recorded pair with the diffs presented in the opposite
   order. Report the stable/flipped count; flipped verdicts are position-bias
   noise and read as ties in the win rates. (This replaces the former human
   calibration pass — the operator does not code-review.)

7. **Wrap (you).** Run `evals/scripts/report.py`, show me the full report
   including win rates, and commit `evals/results/` (runs, diffs, judgments,
   stability — not the API key, which never enters this repo).

Constraints: never echo, log, or cat-to-screen the API key, and never put it in
the session environment — per-command prefix only; never re-judge already-judged
pairs without asking; total spend stays under the key's limit and you surface a
running estimate as you go.

Start with step 1.
