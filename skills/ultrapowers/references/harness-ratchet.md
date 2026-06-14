# The harness ratchet

New harness topologies are *born dynamic* and *live frozen*. The promotion
path, modeled on how `waves.js` itself was built, debugged, and pinned:

1. **Born dynamic.** Prototype the topology as an improvised dynamic workflow,
   confined to read-only work or to fixture repositories. Nothing real is
   mutated.
2. **Candidate.** Commit the prototype under
   `skills/ultrapowers/harnesses/candidates/<name>.js` with a fixture suite and
   an args-validation preflight (the probe pattern). A candidate is launchable
   ONLY against fixture repositories; it carries no `<name>.harness.json`
   manifest, so the registry-integrity test treats it as unregistered.
3. **Promotion.** A candidate becomes a registered harness only when ALL hold:
   fixture end-to-end run green; a prompt-pinning (drift) test added if it bakes
   any discipline; args contract documented; the harness source reviewed by a
   human; and a `<name>.harness.json` manifest added. Promotion is a normal
   reviewed commit.
4. **Life.** A registered harness changes only via the same review + re-pin
   procedure — the re-bake discipline, generalized to the whole library.

The registry-integrity test (`tests/test_harness_registry.py`) enforces the
structural half: every manifest names a real harness whose `meta.name` matches,
with existing fixtures and drift test, and no candidate carries a manifest.
