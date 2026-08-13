"""Central registry: route table, plugin registration, and config defaults.

This module is the app's single assembly point: `bootstrap()` builds a
fresh Router + Store, wires the base CRUD/report routes, and returns an
App. It is also this fixture's deliberate contention point — four
independent feature tasks each extend it, and none of them depends on any
other:

  - a config block: two new keys added to DEFAULT_CONFIG, near its
    existing neighbors;
  - a hook or format registration in the "feature wiring" section below,
    which runs once at import time.

Hooks are the extension seam so features never need to edit bootstrap()'s
body: they append callables to one of the module-level hook lists instead.
No feature task adds a new route — every route this app will ever serve is
already registered below; a feature either intercepts an existing route's
dispatch (a hook) or fills in a lookup table an existing route already
reads (EXPORT_FORMATS for /export).

  PRE_CREATE_HOOKS   fn(store, config, fields) -> fields
                     Runs in append order before a record is created. May
                     raise to reject the create. May transform `fields`
                     (e.g. strip/normalize a value) by returning a new dict.

  POST_CREATE_HOOKS  fn(store, config, record) -> None
                     Runs in append order after a record is created and
                     assigned an id. Return value ignored.

  DISPATCH_HOOKS     fn(store, config, method, path, kwargs) -> None
                     Runs in append order before EVERY dispatch (not just
                     creates). May raise to reject the call before the
                     router sees it. Return value ignored.

  EXPORT_FORMATS     name -> fn(records) -> str
                     Consulted by the pre-wired /export route; not a hook
                     list, a lookup table a feature fills in.
"""
from app.router import Router
from app.storage import Store
from app import report


DEFAULT_CONFIG = {
    "app_name": "eventboard",
    "max_records": 10000,
    "default_category": "uncategorized",
    # --- feature config blocks land below, one per feature task ---
}


PRE_CREATE_HOOKS = []
POST_CREATE_HOOKS = []
DISPATCH_HOOKS = []
EXPORT_FORMATS = {}

PLUGINS = {}


def register_plugin(name, fn):
    """Register a named plugin callable. Raises ValueError if the name is
    already taken — plugin names are a flat global namespace."""
    if name in PLUGINS:
        raise ValueError("plugin already registered: %s" % name)
    PLUGINS[name] = fn
    return fn


class App:
    """The assembled app: a router bound to a store and merged config."""

    def __init__(self, router, store, config):
        self.router = router
        self.store = store
        self.config = config

    def call(self, method, path, **kwargs):
        for hook in DISPATCH_HOOKS:
            hook(self.store, self.config, method, path, kwargs)
        return self.router.dispatch(method, path, **kwargs)


def _create_record(store, config, fields):
    for hook in PRE_CREATE_HOOKS:
        fields = hook(store, config, fields)
    fields = dict(fields)
    fields.setdefault("category", config["default_category"])
    record = store.create(fields)
    for hook in POST_CREATE_HOOKS:
        hook(store, config, record)
    return record


def _get_record(store, config, id):
    return store.get(id)


def _delete_record(store, config, id):
    return store.delete(id)


def _list_records(store, config, **predicate):
    return store.filter(**predicate)


def _report(store, config):
    return report.render_report(store.all())


def _export(store, config, fmt=None):
    fmt = fmt or config.get("export_default_format", "csv")
    enabled = config.get("export_formats_enabled", list(EXPORT_FORMATS))
    if fmt not in enabled or fmt not in EXPORT_FORMATS:
        raise ValueError("unknown export format: %s" % fmt)
    return EXPORT_FORMATS[fmt](store.all())


def bootstrap(config=None):
    """Assemble a fresh App: DEFAULT_CONFIG overridden by `config`, a new
    Store, and a Router with the base routes registered. Every bootstrap()
    call gets its own Router/Store; the hook lists above are shared module
    state (features register into them once, at import time)."""
    merged = dict(DEFAULT_CONFIG)
    if config:
        merged.update(config)
    store = Store()
    router = Router()
    router.register("POST", "/records",
                     lambda **kw: _create_record(store, merged, kw))
    router.register("GET", "/records/{id}",
                     lambda id: _get_record(store, merged, id))
    router.register("DELETE", "/records/{id}",
                     lambda id: _delete_record(store, merged, id))
    router.register("GET", "/records",
                     lambda **kw: _list_records(store, merged, **kw))
    router.register("GET", "/report",
                     lambda: _report(store, merged))
    router.register("GET", "/export",
                     lambda fmt=None: _export(store, merged, fmt))
    return App(router, store, merged)


# --- feature wiring -------------------------------------------------------
# Each feature task imports its module here and registers it into exactly
# one of the hook lists / EXPORT_FORMATS above. This section only ever
# grows by appending a new import + a new registration line; no existing
# line is edited by a later feature.
