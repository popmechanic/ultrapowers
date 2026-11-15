# docs/

`docs/superpowers/` — specs, plans and release notes — is **untracked on purpose** (#544,
operator decision 2026-09-02): it is listed in `.git/info/exclude`, so a fresh clone and a
fleet sandbox find only this file and `docs/assets/` here.

A plan reaches the fleet only as the one commit the launcher pushes to the evidence
repository, never by a path under `docs/`. Tests that need a plan read frozen copies under
`tests/fixtures/plans/`.
