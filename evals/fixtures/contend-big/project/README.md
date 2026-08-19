# eventboard

A tiny, HTTP-less request-routed event-tracking service used as a plan
fixture. There is no real network layer: `App.call(method, path, **kwargs)`
plays the role an HTTP request would, dispatching through `app/router.py`
to a handler backed by `app/storage.py`'s in-memory record store.

## Layout

- `app/router.py` — method+path dispatch table.
- `app/storage.py` — in-memory CRUD record store.
- `app/report.py` — plain-text totals-by-category summary renderer.
- `app/registry.py` — config defaults, plugin/hook registration, and
  `bootstrap()`, which assembles a fresh `App`. This is the shared hot
  file every feature below extends.

## Base routes

- `POST /records` — create a record from keyword fields; `category`
  defaults to `config["default_category"]`.
- `GET /records/{id}` — fetch one record.
- `DELETE /records/{id}` — delete one record.
- `GET /records` — list records, optionally filtered by keyword equality.
- `GET /report` — render the base plain-text report.

## Run the suite

```bash
python3 -m pytest tests/ -q
```

## Extending `app/registry.py`

A feature never edits `bootstrap()`'s body. It:

1. adds its own two-key config block to `DEFAULT_CONFIG`;
2. imports its module in the "feature wiring" section at the bottom of
   the file and registers into exactly one of `PRE_CREATE_HOOKS`,
   `POST_CREATE_HOOKS`, `DISPATCH_HOOKS`, or `EXPORT_FORMATS`.

See `app/registry.py`'s module docstring for each hook's exact signature.
