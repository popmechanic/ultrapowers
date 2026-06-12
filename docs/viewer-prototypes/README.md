# Swarm viewer theme prototypes

Generated artifacts — one file per theme, all baked from the same demo DAG
(`evals/fixtures/mixed/plan.md`, the 6-task diamond). Open any file in a
browser; the depiction plays immediately, click to replay.

Regenerate after template or theme changes:

```sh
python3 skills/ultrapowers/scripts/render_viewer.py evals/fixtures/mixed/plan.md \
    --out docs/viewer-prototypes --title "Apistub Users API" --all
```

Theme descriptions live in `skills/ultrapowers/viewer/README.md`.
