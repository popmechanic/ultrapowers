import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Z = require("../skills/ultrapowers/viewer/swarm_zoom.js");

let failed = 0;
const ok = (c, m) => { if (!c) { failed++; console.error("FAIL", m); } };

const z = Z.create();
ok(z.level() === "macro", "starts at macro");
ok(z.crumbs().length === 1 && z.crumbs()[0].level === "macro", "macro crumb only");

z.toMeso("4");
ok(z.level() === "meso" && z.focus().task === "4", "toMeso sets meso + task");
const mc = z.crumbs();
ok(mc.length === 2 && mc[1].label === "T4" && mc[1].level === "meso", "meso crumb is T4");

z.toMicro("4", "a1");
ok(z.level() === "micro" && z.focus().agentId === "a1", "toMicro sets micro + agent");
ok(z.crumbs().length === 3 && z.crumbs()[2].level === "micro", "micro adds a third crumb");

ok(z.out() === "meso", "out: micro -> meso");
ok(z.focus().agentId === null, "out clears the agent when leaving micro");
ok(z.out() === "macro", "out: meso -> macro");
ok(z.out() === "macro", "out at macro stays macro (idempotent)");
ok(z.focus().task === null, "macro clears the task");

z.toMicro("7", "b2");           // jump straight to micro
ok(z.level() === "micro" && z.focus().task === "7", "direct toMicro ok");
z.reset();
ok(z.level() === "macro" && z.focus().task === null, "reset -> macro");

console.log(failed === 0 ? "ALL TESTS PASSED" : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
