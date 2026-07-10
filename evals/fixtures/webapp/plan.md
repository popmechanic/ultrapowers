# Linkboard Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Acceptance:** suite — eval fixture; the committed `node --test tests/` suite is the check.

**Goal:** A link-sharing board: an HTTP JSON API over an in-memory store, plus a static page. Node ≥20 built-ins only (`node:http`, `node:test`, `node:crypto`) — no npm dependencies.

**Tech Stack:** Node ≥20, ESM (`"type": "module"`). Run the suite with `npm test` from the repo root. Every test file starts its own server on port 0 and reads the bound port — never hard-code ports.

---

### Task 1: In-memory link store

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `src/store.js`
- Test: `tests/store.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `createStore()` returning `{ add({url, title}) -> link, list() -> link[], get(id) -> link|undefined }`; a `link` is `{id: string, url: string, title: string, createdAt: string}` with `id` from `crypto.randomUUID()` and `createdAt` an ISO-8601 string

- [ ] **Step 1: Write failing tests** for `createStore()`:
  - `add({url, title})` returns a link with a unique `id`, the given `url`/`title`, and an ISO-8601 `createdAt`.
  - `list()` returns links in insertion order; empty store returns `[]`.
  - `get(id)` returns the matching link; unknown id returns `undefined`.
- [ ] **Step 2: Implement** `createStore()` in `src/store.js` to make the tests pass.
- [ ] **Step 3: Run** `npm test` and confirm green; commit.

### Task 2: HTTP app factory

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `src/app.js`
- Test: `tests/app.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `createApp(handlers) -> http.Server`, where `handlers` is `{ 'METHOD /path': (req, res, body) => void }`; the factory parses the JSON request body (invalid JSON → 400 `{"error": "invalid json"}`), routes exact-match `METHOD /path` keys, and returns 404 `{"error": "not found"}` for unmatched routes

- [ ] **Step 1: Write failing tests** for `createApp(handlers)`:
  - A registered `GET /ping` handler is invoked and can respond 200.
  - An unregistered path returns 404 with body `{"error": "not found"}`.
  - A POST with malformed JSON body returns 400 with body `{"error": "invalid json"}`.
  - Tests listen on port 0 and read the bound port from `server.address()`.
- [ ] **Step 2: Implement** `createApp` in `src/app.js` using `node:http` only.
- [ ] **Step 3: Run** `npm test` and confirm green; commit.

### Task 3: Link validation module

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `src/validate.js`
- Test: `tests/validate.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `validateLink(input) -> {ok: true, value: {url, title}} | {ok: false, error: string}`; rejects non-object input, missing/non-string/empty `url` or `title`, `url` not parseable by `new URL()`, and `url` schemes other than http/https; trims whitespace on both fields

- [ ] **Step 1: Write failing tests** for `validateLink`:
  - Valid http/https input passes with trimmed fields.
  - Each rejection case above returns `{ok: false}` with a non-empty `error` string.
  - `ftp://example.com` is rejected (scheme), `"not a url"` is rejected (parse).
- [ ] **Step 2: Implement** `validateLink` in `src/validate.js`.
- [ ] **Step 3: Run** `npm test` and confirm green; commit.

### Task 4: REST API endpoints

**Type:** implementation
**Depends-on:** 1, 2, 3

**Files:**
- Create: `src/api.js`
- Test: `tests/api.test.js`

**Interfaces:**
- Consumes: `createStore()` (Task 1), `createApp(handlers)` (Task 2), `validateLink(input)` (Task 3)
- Produces: `createServer() -> http.Server` wiring `GET /links` (200, JSON array), `POST /links` (201 with the created link; 422 `{"error": <validation error>}` on invalid input), `GET /` (200, `text/html`, the static page from the module that serves the board UI)

- [ ] **Step 1: Write failing tests** for `createServer()` over real HTTP (port 0):
  - `GET /links` on a fresh server returns 200 and `[]`.
  - `POST /links` with `{"url": "https://example.com", "title": "Example"}` returns 201 and the created link; a following `GET /links` includes it.
  - `POST /links` with `{"url": "ftp://x", "title": ""}` returns 422 with an `error` string.
- [ ] **Step 2: Implement** `createServer` in `src/api.js` composing the three consumed modules.
- [ ] **Step 3: Run** `npm test` and confirm green; commit.

### Task 5: Static board page

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `src/page.js`
- Test: `tests/page.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `renderPage() -> string` returning a complete HTML document (`<!doctype html>`, a `<title>` of `linkboard`, a `<ul id="links">`, and an inline `<script>` that fetches `/links` and appends an `<li>` with an `<a>` per link)

- [ ] **Step 1: Write failing tests** for `renderPage()`:
  - Output starts with `<!doctype html>` (case-insensitive).
  - Output contains `<title>linkboard</title>`, `id="links"`, and `fetch('/links')`.
- [ ] **Step 2: Implement** `renderPage` in `src/page.js` (template literal; no filesystem reads).
- [ ] **Step 3: Run** `npm test` and confirm green; commit.

### Task 6: End-to-end flow test

**Type:** implementation
**Depends-on:** 4, 5

**Files:**
- Create: `tests/e2e.test.js`

**Interfaces:**
- Consumes: `createServer()` (Task 4), `renderPage()` (Task 5)
- Produces: nothing (test-only task)

- [ ] **Step 1: Write the end-to-end test** against a real server on port 0:
  - `GET /` returns 200 with `content-type` starting `text/html` and the body containing `id="links"`.
  - POST two valid links, then `GET /links` returns both in insertion order.
  - The full suite (`npm test`) passes with every test file green.
- [ ] **Step 2: Run** `npm test`; fix nothing outside this file (a failure elsewhere is a prior task's bug — report it); commit.
