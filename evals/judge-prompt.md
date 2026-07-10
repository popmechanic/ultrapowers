You are judging two independent implementations of the same approved plan.
You do not know which one produced which. Labels X and Y are arbitrary.

THE PLAN:
{plan}

DIFF X:
{diff_x}

DIFF Y:
{diff_y}

For each diff, list every defect you find: spec requirements not met, bugs,
missing or vacuous tests, scope creep. Cite file:line evidence from the diff
for every defect. Then state a verdict.

Return ONLY a JSON object:
{"defectsX": [{"detail": "...", "evidence": "file:line"}],
 "defectsY": [{"detail": "...", "evidence": "file:line"}],
 "verdict": "X" | "Y" | "tie",
 "reason": "one sentence"}
