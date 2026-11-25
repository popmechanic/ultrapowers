const PANE = { id: "intent-tray", title: "Intent tray", rows: 10 };
const FEEDBACK = ".ultrapowers/feedback.jsonl";
const FENCE = "`".repeat(3);

const GONE_KEPT = 500;

let pick = null;
let piece = null;
let notes = [];
let gone = [];
let offset = 0;
let mark = "";
let cwd = "";
let sending = false;
const changed = new Set();

function trayKey() {
  return `tray:${cwd.replace(/\/+$/, "")}`;
}

let made = 0;
function newId() {
  made += 1;
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${made}`;
}

function withId(n) {
  return typeof n.id === "string" ? n : { ...n, id: `v0:${JSON.stringify(record(n))}` };
}

function notesOf(v) {
  return Array.isArray(v) ? v.filter((n) => n && typeof n === "object").map(withId) : [];
}

function merge(held) {
  if (!held || typeof held !== "object") return;
  const left = new Set([...(Array.isArray(held.gone) ? held.gone.map(String) : []), ...gone]);
  gone = [...left].slice(-GONE_KEPT);
  if (!changed.has("pick")) {
    pick = held.pick != null ? held.pick : null;
    piece = held.piece != null ? held.piece : null;
  }
  const byId = new Map();
  for (const n of [...notesOf(held.notes), ...notes]) if (!left.has(n.id) && !byId.has(n.id)) byId.set(n.id, n);
  notes = [...byId.values()];
  if (held.mark === mark && Number(held.offset) > offset) offset = Number(held.offset);
}

async function save($) {
  merge(await $.store.get(trayKey()));
  changed.clear();
  await $.store.set(trayKey(), { pick, piece, notes, gone, offset, mark });
  $.ui.invalidate();
}

function drop(ids) {
  const out = new Set(ids);
  if (!out.size) return;
  notes = notes.filter((n) => !out.has(n.id));
  gone = [...gone.filter((id) => !out.has(id)), ...out].slice(-GONE_KEPT);
}

function setPick(version, of = null) {
  pick = version;
  piece = version == null ? null : of;
  changed.add("pick");
}

function empty() {
  setPick(null);
  drop(notes.map((n) => n.id));
}

function hasContent() {
  return Boolean(pick || notes.length);
}

function feedbackPath() {
  return cwd ? `${cwd.replace(/\/+$/, "")}/${FEEDBACK}` : FEEDBACK;
}

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
  notes.push({ id: newId(), ...n });
  await save($);
}

function pickRecord() {
  const r = { kind: "pick", screen: "" };
  if (piece != null) r.piece = piece;
  r.chose = pick;
  return r;
}

async function send($) {
  if (sending) return;
  sending = true;
  try {
    await save($);
    const sent = { pick, piece, ids: notes.map((n) => n.id) };
    const recs = [];
    if (pick != null) recs.push(pickRecord());
    for (const n of notes) recs.push(record(n));
    if (!recs.length) return;
    const text =
      "Feedback from the intent tray on the screen:\n\n" +
      `${FENCE}json\n${JSON.stringify(recs)}\n${FENCE}`;
    let entered;
    try {
      entered = await $.prompt.submit({ text });
    } catch {
      return;
    }
    if (!entered || entered.drop != null) return;
    if (pick === sent.pick && piece === sent.piece) setPick(null);
    drop(sent.ids);
    await save($);
  } finally {
    sending = false;
  }
}

async function clear($) {
  empty();
  await save($);
}

async function openTray($) {
  await $.ui.open({ ...PANE, focus: true });
}

async function wholeLines($) {
  let text;
  try {
    text = await $.fs.read(feedbackPath());
  } catch {
    return null;
  }
  const bytes = new TextEncoder().encode(String(text));
  return bytes.subarray(0, bytes.lastIndexOf(10) + 1);
}

function markOf(bytes) {
  const end = bytes.indexOf(10);
  return end < 0 ? "" : new TextDecoder().decode(bytes.subarray(0, end));
}

async function readFeedback($) {
  const bytes = await wholeLines($);
  if (!bytes) return;
  const now = markOf(bytes);
  if (now !== mark || bytes.length < offset) {
    mark = now;
    offset = 0;
  }
  const held = await $.store.get(trayKey());
  if (held && typeof held === "object" && held.mark === mark && Number(held.offset) > offset) {
    offset = Number(held.offset);
  }
  if (bytes.length <= offset) return;
  const lines = new TextDecoder().decode(bytes.subarray(offset)).split("\n").filter((l) => l.trim());
  for (const line of lines) {
    let r;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    if (!r || typeof r !== "object") continue;
    if (r.kind === "pick") {
      if (r.chose != null) setPick(String(r.chose), r.piece != null ? String(r.piece) : null);
    } else if (r.note != null && String(r.note).trim()) {
      const note = String(r.note);
      const id = newId();
      if (r.target != null && String(r.target).trim()) {
        const kind = r.kind === "region" || r.kind === "view" ? r.kind : "element";
        notes.push(kind === "view" ? { id, kind, note } : { id, kind, target: String(r.target), note });
      } else {
        notes.push({ id, kind: "view", note });
      }
    }
  }
  offset = bytes.length;
  await save($);
}

function noteLabel(n) {
  return n.kind === "view" ? `[view] ${n.note}` : `[${n.kind}] ${n.target}: ${n.note}`;
}

function drawPane($, e) {
  const { Box, Text, Button, Input } = $.ui.resolve(e);
  const top = [
    Text({ key: "screen", children: ["No screen shown" + (pick != null ? `  picked: ${piece != null ? `${piece} ` : ""}${pick}` : "")] }),
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
            drop([n.id]);
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
  const label = `Intent tray: feedback, ${count} item${count === 1 ? "" : "s"}`;
  return Box({
    key: "band",
    flexDirection: "row",
    children: [
      Text({ key: "band-label", children: [label] }),
      Button({ key: "band-note", hotkey: "n", onPress: () => openTray($), children: ["Add note"] }),
      Button({ key: "band-send", hotkey: "s", onPress: () => send($), children: ["Send"] }),
      Button({ key: "band-clear", hotkey: "c", onPress: () => clear($), children: ["Clear"] }),
    ],
  });
}

export function register(on) {
  on("session.start", async ($, e, next) => {
    cwd = (e && e.cwd) || "";
    const saved = await $.store.get(trayKey());
    if (!saved || typeof saved !== "object") {
      const bytes = await wholeLines($);
      offset = bytes?.length ?? 0;
      mark = bytes ? markOf(bytes) : "";
      await save($);
    } else {
      pick = saved.pick != null ? saved.pick : null;
      piece = saved.piece != null ? saved.piece : null;
      notes = notesOf(saved.notes);
      gone = Array.isArray(saved.gone) ? saved.gone.map(String).slice(-GONE_KEPT) : [];
      offset = Number(saved.offset) || 0;
      if (typeof saved.mark === "string") {
        mark = saved.mark;
      } else {
        const bytes = await wholeLines($);
        mark = bytes ? markOf(bytes) : "";
      }
    }
    await $.command.register({ name: "tray", description: "Open the intent tray", immediate: true });
    await $.command.register({
      name: "note",
      description: "Add a note to the intent tray: /note <element>: <note>, or /note <note>",
      argumentHint: "[element: note]",
      immediate: true,
    });
    $.clock.every(1000, () => readFeedback($));
    return next(e);
  });

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

  on("ui.render", { component: "Pane", requestId: "intent-tray" }, async ($, e) => drawPane($, e));

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    if (!hasContent()) return next(e);
    return drawBand($, e);
  });
}
