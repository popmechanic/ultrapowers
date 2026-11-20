"""The story preview (skills/ultrawrite/stories/preview.ts and preview/, #1532): a pick names
its piece and the old shape still lands, a malformed path answers 400 not 500, plays run one at
a time, and the page names elements the way the browser checker does. The server legs need bun
and an offline-installable app; the naming leg needs the checker's own browser."""
import json
import os
import shutil
import subprocess
import time
import urllib.error
import urllib.request

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STORIES = os.path.join(ROOT, "skills/ultrawrite/stories")
PREVIEW = os.path.join(STORIES, "preview.ts")
TODO = os.path.join(ROOT, "skills/ultrawrite/catalog/todo")


@pytest.fixture(scope="module")
def bun():
    if not shutil.which("bun"):
        pytest.skip("bun is not installed")


def run_bun(script, cwd=ROOT):
    r = subprocess.run(["bun", "-e", script], cwd=cwd, capture_output=True, text=True, timeout=300)
    assert r.returncode == 0, r.stderr[-2000:]
    return json.loads(r.stdout.strip().splitlines()[-1])


def test_feedback_record_takes_a_pick_with_its_piece_and_the_old_shape(bun):
    got = run_bun("""
import {feedbackRecord} from %s;
console.log(JSON.stringify([
  feedbackRecord({chose: 'B', piece: 'todo', kind: 'pick'}),
  feedbackRecord({kind: 'pick', chose: 'A'}),
  feedbackRecord({kind: 'pick', piece: 7, chose: 'A'}),
  feedbackRecord({kind: 'pick', piece: 'todo', chose: 'A', extra: 1}),
]));
""" % json.dumps(PREVIEW))
    assert json.dumps(got[0]) == '{"kind": "pick", "piece": "todo", "chose": "B"}'
    assert got[1] == {"kind": "pick", "chose": "A"}
    assert got[2] is None
    assert got[3] is None


def test_plays_run_one_at_a_time(bun):
    got = run_bun("""
import {inTurn} from %s;
const log = [];
const job = (name, ms, fail) => () => new Promise((ok, no) => {
  log.push(name + ' start');
  setTimeout(() => { log.push(name + ' end'); fail ? no(new Error(name)) : ok(name); }, ms);
});
const a = inTurn(job('a', 40, true)).catch((e) => 'refused ' + e.message);
const b = inTurn(job('b', 5));
const c = inTurn(job('c', 1));
console.log(JSON.stringify({log, answers: await Promise.all([a, b, c])}));
""" % json.dumps(os.path.join(STORIES, "preview/play.ts")))
    assert got["log"] == ["a start", "a end", "b start", "b end", "c start", "c end"]
    assert got["answers"] == ["refused a", "b", "c"]


@pytest.fixture(scope="module")
def server(bun, tmp_path_factory):
    base = tmp_path_factory.mktemp("preview")
    app = str(base / "app")
    bundle = str(base / "bundle")
    shutil.copytree(TODO, bundle)
    subprocess.run(["bun", os.path.join(STORIES, "scaffold.ts"), bundle, app],
                   check=True, capture_output=True, text=True)
    r = subprocess.run(["bun", "install", "--offline"], cwd=app, capture_output=True, text=True, timeout=300)
    if r.returncode:
        pytest.skip("bun install --offline failed: " + r.stderr.strip()[-200:])
    feedback = str(base / "feedback.jsonl")
    proc = subprocess.Popen(["bun", PREVIEW, bundle, "--app", app, "--port", "0", "--feedback", feedback],
                            cwd=str(base), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    try:
        lines = []
        deadline = time.time() + 120
        url = None
        while time.time() < deadline:
            line = proc.stdout.readline()
            if not line:
                break
            lines.append(line)
            if line.startswith("PREVIEW http://"):
                url = line.split(" ", 1)[1].strip().rstrip("/")
                break
        assert url, "the preview did not start (the page did not build?):\n" + "".join(lines)[-2000:]
        yield {"url": url, "feedback": feedback}
    finally:
        proc.kill()
        proc.wait(timeout=10)


def request(url, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method="GET" if body is None else "POST",
                                 headers={} if body is None else {"content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code


def test_the_server_writes_a_pick_with_its_piece(server):
    assert request(server["url"] + "/feedback", {"kind": "pick", "piece": "todo", "chose": "B"}) == 204
    assert request(server["url"] + "/feedback", {"kind": "pick", "chose": "A"}) == 204
    assert request(server["url"] + "/feedback", {"kind": "pick", "chose": "A", "screen": "x"}) == 400
    with open(server["feedback"]) as f:
        assert f.read().splitlines() == ['{"kind":"pick","piece":"todo","chose":"B"}', '{"kind":"pick","chose":"A"}']


def test_a_malformed_path_answers_400(server):
    assert request(server["url"] + "/%E0") == 400
    assert request(server["url"] + "/no-such-file.js") == 404


NAMES_PAGE = """<!doctype html><html><body>
<main>Main text</main><nav>Nav text</nav><form>Form text</form>
<ul><li>Item one</li><li tabindex="0">Item two</li></ul>
<table><tr><th>Head</th></tr><tr><td>Cell</td></tr><tr tabindex="0"><td>Row two</td></tr></table>
<h2>Heading</h2><button>Btn</button><a href="#x">Lnk</a><section aria-label="Sec">Section text</section>
<div role="switch">Sw</div><div role="tab">Tb</div><div role="tooltip">Tip</div><div role="menuitem">Mi</div>
<div role="radio">Rd</div><div role="checkbox">Cb</div><div role="article">Art</div><div role="status">St</div>
<div role="dialog">Dlg</div><div role="group">Grp</div><div role="listitem">Li3</div>
<header>Hdr</header><footer>Ftr</footer><aside>Asd</aside><div title="Tt" role="note">Nt</div>
<label>Due <input type="text"></label>
<script src="/names.js"></script></body></html>"""

CASES = [["main", "Main text"], ["navigation", "Nav text"], ["form", "Form text"], ["list", "Item one Item two"],
         ["listitem", "Item one"], ["listitem", "Item two"], ["table", "Head Cell Row two"], ["row", "Cell"], ["columnheader", "Head"],
         ["row", "Row two"], ["cell", "Cell"], ["heading", "Heading"], ["button", "Btn"], ["link", "Lnk"],
         ["region", "Sec"], ["switch", "Sw"], ["tab", "Tb"], ["tooltip", "Tip"], ["menuitem", "Mi"],
         ["radio", "Rd"], ["checkbox", "Cb"], ["article", "Art"], ["status", "St"], ["dialog", "Dlg"],
         ["group", "Grp"], ["listitem", "Li3"], ["banner", "Hdr"], ["contentinfo", "Ftr"],
         ["complementary", "Asd"], ["note", "Tt"], ["note", "Nt"], ["textbox", "Due"]]


def test_the_page_names_elements_the_way_the_checker_does(bun, tmp_path):
    """Each (role, name) counted by preview/names.ts and by the checker's Chrome must agree.
    Names only: Chrome's own role mapping (an <img> is `image`, a table with no header is a
    layout table with no cells) is not what this leg reads."""
    browser = os.path.join(ROOT, "factory/stack/tinyapp/browser.ts")
    entry = tmp_path / "entry.ts"
    entry.write_text("import * as n from %s;\n(window as any).__names = n;\n"
                     % json.dumps(os.path.join(STORIES, "preview/names.ts")))
    script = """
import {existsSync} from 'node:fs';
import {launchBrowser} from %(browser)s;
const built = await Bun.build({entrypoints: [%(entry)s], format: 'iife'});
const js = await built.outputs[0].text();
const html = %(html)s;
const srv = Bun.serve({port: 0, hostname: '127.0.0.1', fetch: (req) => new URL(req.url).pathname === '/names.js'
  ? new Response(js, {headers: {'content-type': 'text/javascript'}})
  : new Response(html, {headers: {'content-type': 'text/html'}})});
const origin = `http://127.0.0.1:${srv.port}`;
let b;
try { b = await launchBrowser(); } catch (e) { console.log(JSON.stringify({skip: String(e)})); process.exit(0); }
try {
  const p = await b.openUrl({url: origin + '/', origin, clock: '2026-01-01T00:00:00Z'});
  for (let i = 0; i < 100 && !(await p.evaluate('!!window.__names')); i++) await Bun.sleep(50);
  const out = [];
  for (const [role, name] of %(cases)s) {
    const ours = await p.evaluate(`[...document.querySelectorAll('*')].filter((e) => __names.roleOf(e) === ${JSON.stringify(role)} && __names.nameOf(e) === ${JSON.stringify(name)}).length`);
    out.push([role, name, ours, await p.count({role, name})]);
  }
  await p.close();
  console.log(JSON.stringify({out}));
} finally { await b.close(); srv.stop(); }
""" % {"browser": json.dumps(browser), "entry": json.dumps(str(entry)), "html": json.dumps(NAMES_PAGE),
       "cases": json.dumps(CASES)}
    got = run_bun(script)
    if "skip" in got:
        pytest.skip("no browser for the checker: " + got["skip"])
    differ = [c for c in got["out"] if c[2] != c[3]]
    assert differ == [], "role, name, names.ts count, checker count: %r" % differ
