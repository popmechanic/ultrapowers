"""eventboard: a tiny HTTP-less request-routed event-tracking service.

Package layout:
  router.py    - method+path dispatch table
  storage.py   - in-memory record store
  report.py    - plain-text summary renderer
  registry.py  - config defaults, plugin registration, app bootstrap (the
                 fixture's shared hot file: every feature extends it)
"""
