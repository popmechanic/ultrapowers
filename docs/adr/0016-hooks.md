# 0016. The plugin hooks

Status: accepted (2026-11-21)  
Governs: `hooks/keep_working.sh`, `hooks/register.js`, `hooks/session_start.sh`

Recovered from the code comments removed by `/delete-comment` on 2026-11-21: each entry is a
decision the code cannot show on its own. Symbols are named; line numbers are not.

## Intent tray host constraints

- ~~**hooks/register.js canRun** — The Claude Desktop app gives mods no $.process, so hooks/register.js checks for it (canRun) and draws the Open screen button only where a process can be spawned.~~ Struck 2026-11-25, superseded by 0018.
- ~~**hooks/register.js LOCAL_URL** — The preview URL handed to show_screen comes from the model, so hooks/register.js keeps and opens it only when it matches http://127.0.0.1:<port>/ or http://localhost:<port>/ (LOCAL_URL); any other URL is dropped and the tool result says so.~~ Struck 2026-11-25, superseded by 0018.
- ~~**hooks/register.js openScreen** — openScreen in hooks/register.js runs `open <url>` and falls back to `xdg-open` when that fails, because on Debian `open` is openvt rather than a URL opener.~~ Struck 2026-11-25, superseded by 0018.
- **hooks/register.js register (command.run)** — In the Claude Code mod API a CommandSpec has no callback field, so hooks/register.js registers /tray and /note with $.command.register and answers them through command.run hooks filtered by command name.

## Intent tray sync

- **hooks/register.js GONE_KEPT** — hooks/register.js keeps the ids of notes that were sent, cleared or dropped (the gone list, capped at GONE_KEPT = 500) and merges it across sessions, so a session holding an older copy of the tray cannot bring those notes back.
- **hooks/register.js changed, merge** — hooks/register.js tracks whether this session set the pick since its last save; when merging what other sessions stored, a pick this session set keeps its value, otherwise the stored value stands.
- **hooks/register.js merge** — merge in hooks/register.js folds in what other sessions in the same repo stored: their notes join this session's except any id on the shared gone list, and their pick stands unless this session changed its own since its last save; the feedback offset only moves forward within the same file mark.

## Intent tray feedback file

- **hooks/register.js mark, markOf** — hooks/register.js records the first whole line of .ultrapowers/feedback.jsonl (mark) together with the byte offset already consumed. A different first line, or a file shorter than the offset, means the file was replaced, and the tray rereads it from the start.
- **hooks/register.js session.start** — When a repo has no stored tray, hooks/register.js sets the feedback offset to the end of .ultrapowers/feedback.jsonl at session start, so lines written before the repo's first tray session are not imported as new notes.

## Intent tray protocol

- **hooks/register.js** — The intent tray mod in hooks/register.js collects the operator's notes in a pane beside the chat, through /note, and from the records a page appends to .ultrapowers/feedback.jsonl. Send hands everything to Claude as one prompt containing a ```json block of pick and note records.

## Keep working stop hook

- **hooks/keep_working.sh** — Sessions using ultrawrite or ultrapowers spend most of their time waiting on Monitors, background Agents or sandbox runs, and an agent whose last call is a background dispatch ends its turn, leaving the operator to ask for more work by hand. hooks/keep_working.sh, a Stop hook, blocks the first stop of a turn while background tasks are running or pending, listing them and asking what else is productive; a second stop (`stop_hook_active`) or a stop with nothing in flight is allowed silently, so it can never loop.

## Plan routing hook

- **hooks/session_start.sh** — hooks/session_start.sh injects the plan-routing rule (author plans with ultrawrite, offer /ultrapowers at handoff) as session context via SessionStart stdout, because relying on the model noticing the ultrawrite skill description at the plan-writing moment is probabilistic, not reliable.
