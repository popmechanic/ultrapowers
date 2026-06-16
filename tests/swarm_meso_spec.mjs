import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const L = require("../skills/ultrapowers/viewer/swarm_layout.js");

let failed = 0;
const ok = (c, m) => { if (!c) { failed++; console.error("FAIL", m); } };
const finite = o => Number.isFinite(o.x) && Number.isFinite(o.y);

// A — lean review, no fix, merged
const a = L.buildMeso({
  commits: [{ sha: "aaa", subject: "test: red" }, { sha: "bbb", subject: "feat: green" }],
  agents: [{ role: "impl" }, { role: "review" }],
  merged: true,
});
ok(a.commits.length === 2 && a.commits.every(c => c.role === "impl"), "A: 2 impl commits, none fix");
ok(a.gates.length === 1 && a.gates[0].kind === "lean", "A: one lean gate");
ok(a.merge && finite(a.merge), "A: merge node present (merged)");
ok(finite(a.fork) && a.fork.y < a.commits[0].y, "A: fork above first commit");
ok(a.commits[0].y < a.commits[1].y, "A: commits ordered top->down");
ok(a.commits[1].y < a.merge.y, "A: merge below the last commit");
ok([a.fork, ...a.commits, ...a.gates, a.merge].every(finite), "A: all coords finite");
ok(a.width > 0 && a.height > 0, "A: positive bounds");

// B — adversarial review + a fix round, not merged
const b = L.buildMeso({
  commits: [{ sha: "1", subject: "red" }, { sha: "2", subject: "green" }, { sha: "3", subject: "fix" }],
  agents: [{ role: "impl" }, { role: "review" }, { role: "review" }, { role: "impl" }],
  merged: false,
});
ok(b.commits.filter(c => c.role === "fix").length === 1, "B: last commit tinted fix");
ok(b.commits[2].role === "fix" && b.commits[0].role === "impl", "B: fix is the LAST commit");
ok(b.gates.length === 2 && b.gates.every(g => g.kind === "adversarial"), "B: two adversarial gates");
ok(b.gates[0].lane !== b.gates[1].lane, "B: adversarial gates on different lanes");
ok(b.merge === null, "B: no merge node (unmerged)");

// C — explicit reviewDepth override + zero commits edge case
const c = L.buildMeso({ commits: [], agents: [{ role: "impl" }], merged: false, reviewDepth: "lean" });
ok(Array.isArray(c.commits) && c.commits.length === 0, "C: no commits ok");
ok(c.gates.length === 0, "C: no review agent => no gate even with reviewDepth hint");
ok(c.width > 0 && c.height > 0 && finite(c.fork), "C: still a valid box");

console.log(failed === 0 ? "ALL TESTS PASSED" : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
