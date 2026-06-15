import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const A = require("../skills/ultrapowers/viewer/audit_project.js");

let failed = 0;
const J = (x) => JSON.stringify(x);
function eq(actual, expected, msg) {
  if (J(actual) !== J(expected)) { failed++; console.error("FAIL", msg, "\n  got", J(actual), "\n  exp", J(expected)); }
}
function ok(cond, msg) { if (!cond) { failed++; console.error("FAIL", msg); } }

// assistant text
let r = A.projectAgent([{ type: "assistant", content: [{ type: "text", text: "hello" }] }]);
eq(r.events, [{ kind: "text", text: "hello", truncated: 0 }], "assistant text");

// tool_use with object input (live path)
r = A.projectAgent([{ type: "assistant", content: [{ type: "tool_use", name: "Read", input: { file: "a.js" } }] }]);
eq(r.events[0].kind, "tool_use", "tool_use kind");
eq(r.events[0].name, "Read", "tool_use name");
ok(r.events[0].input.includes("a.js"), "tool_use object input stringified");

// tool_use with string input (embed path) — must NOT double-encode
r = A.projectAgent([{ type: "assistant", content: [{ type: "tool_use", name: "Bash", input: "pytest -q" }] }]);
eq(r.events[0].input, "pytest -q", "tool_use string input used as-is");

// tool_result as string
r = A.projectAgent([{ type: "user", content: [{ type: "tool_result", content: "240 lines" }] }]);
eq(r.events, [{ kind: "tool_result", result: "240 lines", truncated: 0 }], "tool_result string");

// tool_result as array of text blocks
r = A.projectAgent([{ type: "user", content: [{ type: "tool_result", content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] }] }]);
eq(r.events[0].result, "a b", "tool_result array joined");

// unknown block type surfaced, not dropped
r = A.projectAgent([{ type: "assistant", content: [{ type: "thinking", text: "x" }] }]);
eq(r.events[0].kind, "unknown", "unknown block kind");
eq(r.events[0].blockType, "thinking", "unknown block type carried");

// truncation + remainder count
const big = "x".repeat(A.CAPS.text + 50);
r = A.projectAgent([{ type: "assistant", content: [{ type: "text", text: big }] }]);
eq(r.events[0].text.length, A.CAPS.text, "text capped at CAPS.text");
eq(r.events[0].truncated, 50, "truncated remainder counted");

// parseLines: malformed line skipped, version captured, attachment dropped
const text = [
  J({ type: "assistant", version: "2.1.177", message: { content: [{ type: "text", text: "hi" }] } }),
  "not json {{{",
  J({ type: "attachment", version: "2.1.177", message: { content: [] } }),
].join("\n");
const p = A.parseLines(text);
eq(p.unparsed, 1, "one malformed line counted");
eq(p.versions, ["2.1.177"], "version captured");
eq(A.projectAgent(p.entries).events, [{ kind: "text", text: "hi", truncated: 0 }], "parseLines->project drops attachment");

// user string content becomes a text block
const p2 = A.parseLines(J({ type: "user", message: { content: "the task prompt" } }));
eq(A.projectAgent(p2.entries).events, [{ kind: "text", text: "the task prompt", truncated: 0 }], "user string content -> text");

// summaryLine glyphs
eq(A.summaryLine({ kind: "tool_use", name: "Bash", input: "pytest -q" }), "⚙ Bash(pytest -q)", "summaryLine tool_use");
eq(A.summaryLine({ kind: "unknown", blockType: "thinking" }), "‹unrecognized block: thinking›", "summaryLine unknown");

if (failed) { console.error(failed + " FAILED"); process.exit(1); }
console.log("ALL TESTS PASSED");
