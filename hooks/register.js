// Intent tray mod: Claude shows a screen through the show_screen tool, the
// operator picks a version and adds notes in a pane beside the chat (or in
// the preview page, which appends to .ultrapowers/feedback.jsonl), and Send
// hands everything to Claude as one prompt holding a ```json block.

const PANE = { id: "intent-tray", title: "Intent tray", rows: 10 };
const FEEDBACK = ".ultrapowers/feedback.jsonl";
const FENCE = "`".repeat(3);

let screen = null; // { name, stage, versions }
let pick = null;
let notes = []; // { kind, target?, note }
let taken = 0; // feedback lines already taken into the tray
let cwd = "";

async function save($) {
  await $.store.set("tray", { screen, pick, notes, taken });
  $.ui.invalidate();
}

function empty() {
  pick = null;
  notes = [];
}

function hasContent() {
  return Boolean(screen || pick || notes.length);
}

function feedbackPath() {
  return cwd ? `${cwd.replace(/\/+$/, "")}/${FEEDBACK}` : FEEDBACK;
}

// "element: note" is an element note; text without a colon is a view note.
function parseNote(text) {
  const s = String(text || "").trim();
  if (!s) return null;
  const i = s.indexOf(":");
  if (i < 0) return { kind: "view", note: s };
  const target = s.slice(0, i).trim();
  const note = s.slice(i + 1).trim();
  if (!target) return note ? { kind: "view", note } : null;
  if (!note) return null;
  return { kind: "element", target, note };
}

function record(n) {
  return n.kind === "view"
    ? { kind: "view", note: n.note }
    : { kind: n.kind, target: n.target, note: n.note };
}

async function addNote($, text) {
  const n = parseNote(text);
  if (!n) return;
  notes.push(n);
  await save($);
}

async function choose($, version) {
  pick = version;
  await save($);
}

async function send($) {
  const recs = [];
  if (pick != null) recs.push({ kind: "pick", screen: screen ? screen.name : "", chose: pick });
  for (const n of notes) recs.push(record(n));
  if (!recs.length) return;
  const name = screen ? screen.name : "the screen";
  const text =
    `Feedback from the intent tray on ${name}:\n\n` +
    `${FENCE}json\n${JSON.stringify(recs)}\n${FENCE}`;
  empty();
  await save($);
  await $.prompt.submit({ text });
}

async function clear($) {
  empty();
  await save($);
}

async function openTray($) {
  await $.ui.open({ ...PANE, focus: true });
}

async function readFeedback($) {
  let text;
  try {
    text = await $.fs.read(feedbackPath());
  } catch {
    return;
  }
  const lines = String(text).split("\n").filter((l) => l.trim());
  if (lines.length < taken) taken = 0; // the file was replaced
  if (lines.length === taken) return;
  for (const line of lines.slice(taken)) {
    let r;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    if (!r || typeof r !== "object") continue;
    if (r.kind === "pick") {
      if (r.chose != null) pick = String(r.chose);
    } else if (r.note != null && String(r.note).trim()) {
      const note = String(r.note);
      if (r.target != null && String(r.target).trim()) {
        const kind = r.kind === "region" || r.kind === "view" ? r.kind : "element";
        notes.push(kind === "view" ? { kind, note } : { kind, target: String(r.target), note });
      } else {
        notes.push({ kind: "view", note });
      }
    }
  }
  taken = lines.length;
  await save($);
}

function noteLabel(n) {
  return n.kind === "view" ? `[view] ${n.note}` : `[${n.kind}] ${n.target}: ${n.note}`;
}

function drawPane($, e) {
  const { Box, Text, Button, Input } = $.ui.resolve(e);
  const versions = (screen && screen.versions) || [];
  const head = screen
    ? `${screen.name}${screen.stage ? ` (${screen.stage})` : ""}`
    : "No screen shown";
  const top = [
    Text({ key: "screen", children: [head + (pick != null ? `  picked: ${pick}` : "")] }),
    ...versions.map((v, i) =>
      Button({
        key: `pick-${v}`,
        hotkey: i < 9 ? String(i + 1) : undefined,
        onPress: () => choose($, v),
        children: [pick === v ? `[${v}]` : v],
      })
    ),
  ];
  const rows = notes.map((n, i) =>
    Box({
      key: `note-${i}`,
      flexDirection: "row",
      children: [
        Text({ key: `text-${i}`, children: [noteLabel(n)] }),
        Button({
          key: `drop-${i}`,
          onPress: async () => {
            notes.splice(i, 1);
            await save($);
          },
          children: ["x"],
        }),
      ],
    })
  );
  return Box({
    key: "tray",
    flexDirection: "column",
    children: [
      Box({ key: "top", flexDirection: "row", children: top }),
      Input({
        key: "view-note",
        autoFocus: true,
        placeholder: "element: note, or a note on the whole view",
        onSubmit: (text) => addNote($, text),
      }),
      Box({
        key: "actions",
        flexDirection: "row",
        children: [
          Button({ key: "send", hotkey: "s", onPress: () => send($), children: ["Send"] }),
          Button({ key: "clear", hotkey: "c", onPress: () => clear($), children: ["Clear"] }),
        ],
      }),
      Box({
        key: "notes",
        flexDirection: "column",
        children: rows.length ? rows : [Text({ key: "none", children: ["No notes yet"] })],
      }),
    ],
  });
}

function drawBand($, e) {
  const { Box, Text, Button } = $.ui.resolve(e);
  const count = notes.length + (pick != null ? 1 : 0);
  const label = `Intent tray: ${screen ? screen.name : "feedback"}, ${count} item${count === 1 ? "" : "s"}`;
  return Box({
    key: "band",
    flexDirection: "row",
    children: [
      Text({ key: "band-label", children: [label] }),
      Button({ key: "band-note", hotkey: "1", onPress: () => openTray($), children: ["Add note"] }),
      Button({ key: "band-send", hotkey: "2", onPress: () => send($), children: ["Send"] }),
      Button({ key: "band-clear", hotkey: "3", onPress: () => clear($), children: ["Clear"] }),
    ],
  });
}

export function register(on) {
  on("session.start", async ($, e, next) => {
    cwd = (e && e.cwd) || "";
    const saved = await $.store.get("tray");
    if (saved && typeof saved === "object") {
      screen = saved.screen || null;
      pick = saved.pick != null ? saved.pick : null;
      notes = Array.isArray(saved.notes) ? saved.notes : [];
      taken = Number(saved.taken) || 0;
    }
    await $.command.register({ name: "tray", description: "Open the intent tray", immediate: true });
    await $.command.register({
      name: "note",
      description: "Add a note to the intent tray: /note <element>: <note>, or /note <note>",
      argumentHint: "[element: note]",
      immediate: true,
    });
    await $.tool.register({
      name: "show_screen",
      description:
        "Show the operator a screen in the intent tray so they can pick a version and add notes; then wait for their feedback.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Name of the screen" },
          stage: { type: "string", description: "What this round is about" },
          versions: { type: "array", items: { type: "string" }, description: "Version labels to pick from" },
        },
        required: ["name"],
      },
    });
    $.clock.every(1000, () => readFeedback($));
    return next(e);
  });

  // A registered command is answered by a command.run hook; CommandSpec has no callback field.
  on("command.run", { command: "tray" }, async ($) => {
    await openTray($);
    return {};
  });

  on("command.run", { command: "note" }, async ($, e) => {
    const before = notes.length;
    await addNote($, e.args);
    return notes.length > before
      ? { text: `Added to the intent tray (${notes.length} ${notes.length === 1 ? "note" : "notes"})` }
      : { text: "Usage: /note <element>: <note>, or /note <note> for the whole view" };
  });

  on("tool.call", { tool: "mcp__ultrapowers__show_screen" }, async ($, e, next) => {
    const input = (e && (e.input || e.args)) || e || {};
    const name = String(input.name || e.name || "Screen");
    const stage = input.stage != null ? String(input.stage) : e.stage != null ? String(e.stage) : "";
    const raw = Array.isArray(input.versions) ? input.versions : Array.isArray(e.versions) ? e.versions : [];
    screen = { name, stage, versions: raw.map(String) };
    empty();
    await save($);
    await $.ui.open(PANE);
    return {
      result:
        `Showing "${name}" in the intent tray${screen.versions.length ? ` with versions ${screen.versions.join(", ")}` : ""}. ` +
        "Wait for the operator's feedback: it arrives as their next message with a json block of picks and notes.",
    };
  });

  on("ui.render", { component: "Pane", requestId: "intent-tray" }, async ($, e) => drawPane($, e));

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    if (!hasContent()) return next(e);
    return drawBand($, e);
  });
}
