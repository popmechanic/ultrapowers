#!/usr/bin/env python3
"""Build the preview page from a bundle: the store module and the sketch are
inlined as scopes (no blob or data URLs, which the artifact's CSP may block),
TinyBase comes from the import map, and page.json rides as data.

    build_preview.py <bundle> <out.html>"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "stories"))
from bundle import load_bundle  # noqa: E402

IMPORT_RE = re.compile(r"^import\s*\{([^}]*)\}\s*from\s*['\"]tinybase['\"];?[ \t]*$", re.M)
ANY_IMPORT_RE = re.compile(r"^\s*import\s", re.M)
EXPORT_RE = re.compile(r"^export\s+(?=(const|function|let|class|async)\b)", re.M)


class BuildError(Exception):
    pass


def module_body(src, exports):
    names = []
    for m in IMPORT_RE.finditer(src):
        names += [n.strip() for n in m.group(1).split(",") if n.strip()]
    body = IMPORT_RE.sub("", src)
    if ANY_IMPORT_RE.search(body):
        raise BuildError("only `import {…} from 'tinybase'` is allowed in a store or sketch module")
    body = EXPORT_RE.sub("", body)
    for e in exports:
        if not re.search(r"\b(const|function|let|class)\s+%s\b" % re.escape(e), body):
            raise BuildError("the module does not export %s" % e)
    head = "const { %s } = TB;\n" % ", ".join(names) if names else ""
    return "(() => {\n%s%s\nreturn { %s };\n})()" % (head, body, ", ".join(exports))


def build(bundle_dir, out_html):
    b = load_bundle(bundle_dir)
    with open(os.path.join(HERE, "template.html"), encoding="utf-8") as fh:
        html = fh.read()
    page = json.dumps(b["page"], indent=1, ensure_ascii=False).replace("</", "<\\/")
    html = (html.replace("__TITLE__", b["page"]["title"])
                .replace("__PAGE_JSON__", page)
                .replace("__STORE_MODULE__", module_body(b["store_text"], ["TOOLS", "makeStore"]))
                .replace("__SKETCH_MODULE__", module_body(b["sketch_text"], ["render"])))
    with open(out_html, "w", encoding="utf-8") as fh:
        fh.write(html)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: build_preview.py <bundle> <out.html>")
    try:
        build(sys.argv[1], sys.argv[2])
    except BuildError as exc:
        sys.exit("build_preview: " + str(exc))
