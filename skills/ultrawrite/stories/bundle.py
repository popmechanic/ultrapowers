#!/usr/bin/env python3
"""A signed page's bundle: page.json, cards.json, store.js, sketch.js and
steps.jsonl in one directory. The store's fingerprint is taken here."""
import hashlib
import json
import os

import steps as steps_mod

KINDS = ("behaviour", "preserve", "look")


def load_bundle(d):
    d = str(d)
    with open(os.path.join(d, "page.json"), encoding="utf-8") as fh:
        page = json.load(fh)
    with open(os.path.join(d, "cards.json"), encoding="utf-8") as fh:
        cards = json.load(fh)
    with open(os.path.join(d, "store.js"), "rb") as fh:
        store_bytes = fh.read()
    sketch_path = os.path.join(d, "sketch.js")
    sketch_text = open(sketch_path, encoding="utf-8").read() if os.path.exists(sketch_path) else ""
    steps_path = os.path.join(d, "steps.jsonl")
    rows = steps_mod.load_steps(steps_path) if os.path.exists(steps_path) else []
    return {"dir": d, "page": page, "cards": cards, "steps": rows,
            "store_text": store_bytes.decode("utf-8"),
            "store_sha256": hashlib.sha256(store_bytes).hexdigest(),
            "sketch_text": sketch_text}
