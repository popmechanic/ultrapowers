# Todos

**Grammar:** stories-v1
**Stack:** tinyapp
**Plan-id:** p1
**Kind:** behaviour
**Summary:** A list of things you mean to do. It exists so nothing you meant to do gets forgotten. You add a thing, tick it when it is done, and delete it when it no longer matters.
**Store:** `client/src/store.js` sha256:30d52f6d7cffdb93b01519f76d2cdd559bb3154e1ec2d928497b5b7a55d1bc02

## Stories

- S1: You type "buy milk" and press Add; "buy milk" appears in the list, not ticked.
- S2: You tick "buy milk"; it shows as done and stays in the list.
- S3: You press Add with nothing typed; nothing is added.
- S4: You delete "buy milk"; it is gone from the list.

### Task 1: The todo piece

**Piece:** todo
**Depends-on-pieces:** none
**Files:**
- Create: `client/src/pieces/todo.ts`
**Purpose:** Remember the things you mean to do until you have done them.
**Actions:**
- `addTodo` — Add a todo with this text; it starts not done.; refuses: blank text
- `completeTodo` — Mark this todo as done.; refuses: a todo that does not exist
- `deleteTodo` — Remove this todo from the list.; refuses: a todo that does not exist
**Stories:**
- S1: You type "buy milk" and press Add; "buy milk" appears in the list, not ticked.
- S2: You tick "buy milk"; it shows as done and stays in the list.
- S3: You press Add with nothing typed; nothing is added.
- S4: You delete "buy milk"; it is gone from the list.
**Proof:**
```probe
{"clause":"S1.1","do":[{"type":{"name":"New todo","role":"textbox","text":"buy milk"}},{"click":{"name":"Add","role":"button"}}],"expect":[{"cell":"text","eq":"buy milk","row":"0","table":"todos"}],"given":[],"holds_before":false,"judge":null,"layer":"ui","see":[{"count":1,"name":"Add","role":"button"},{"count":1,"name":"Delete buy milk","role":"button"},{"count":1,"name":"buy milk","role":"checkbox"},{"count":1,"name":"New todo","role":"textbox"}]}
```
```probe
{"clause":"S2.2","do":[{"click":{"name":"buy milk","role":"checkbox"}}],"expect":[{"cell":"completed","eq":true,"row":"0","table":"todos"}],"given":[{"args":{"text":"buy milk"},"tool":"addTodo"}],"holds_before":false,"judge":null,"layer":"ui","see":[{"count":1,"name":"Add","role":"button"},{"count":1,"name":"Delete buy milk","role":"button"},{"count":1,"name":"buy milk","role":"checkbox"},{"count":1,"name":"New todo","role":"textbox"}]}
```
```probe
{"clause":"S3.1","do":[{"click":{"name":"Add","role":"button"}}],"expect":[{"unchanged":true}],"given":[],"holds_before":true,"judge":null,"layer":"ui","see":[{"count":1,"name":"Add","role":"button"},{"count":1,"name":"New todo","role":"textbox"}]}
```
```probe
{"clause":"S4.2","do":[{"click":{"name":"Delete buy milk","role":"button"}}],"expect":[{"absent":true,"row":"0","table":"todos"}],"given":[{"args":{"text":"buy milk"},"tool":"addTodo"}],"holds_before":false,"judge":null,"layer":"ui","see":[{"count":1,"name":"Add","role":"button"},{"count":1,"name":"New todo","role":"textbox"}]}
```
