# Unified Agent Visualization Implementation Plan

> **For agentic workers:** Parallel execution: use `ultrapowers:ultrapowers` (this plan carries ultraplan markers). Sequential fallback: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the blog post's three ad-hoc visuals with one consistent left-to-right fan-out/fan-in agent grammar (animated via a dependency-free seekable timeline engine), and add a capture script that exports the animations as looping GIF+MP4 for JS-free platforms.

**Architecture:** All animation lives inline in `docs/superpowers-ultrapowers-evals.html` as deterministic, seekable timelines — pure functions of elapsed ms — driven by `requestAnimationFrame` for readers and by a `window.__seek` hook (enabled with `?capture`) for frame-exact export. Three figure changes (new anatomy figure, rebuilt race figure on real run data, redrawn fixture thumbnails) plus a standalone Python capture script using Playwright + ffmpeg.

**Tech Stack:** Vanilla JS + inline SVG (no libraries), pytest for static/structural tests (mirroring `tests/test_viewer.py` conventions, including `node --check` for embedded JS), Playwright + ffmpeg for media export (export run is a manual task).

**Spec:** `docs/superpowers/specs/2026-06-12-unified-agent-visualization-design.md`

**Measured data baked into figures (provenance — `/tmp/eval-runs/` is ephemeral, these numbers are now canonical here):**

- Serial run `mixed-A-1`: launch 22:37:39, wall clock 2786 s = 46.4 min. Task completions (final review-fix commit per task, minutes from launch): T1 6.5, T2 12.8, T3 17.7, T4 23.9, T5 30.8, T6 42.6.
- Waves run `mixed-B-1`: wall clock 1015 s = 16.9 min; t0 = final-merge epoch 1781248472 − 1015 s (aligns exactly). Wave 1 (tasks 1+4): commits 6.73/6.83, merged 8.7. Wave 2 (tasks 2+3): commits 9.70/9.75, merged 10.75. Wave 3 (task 5): fast-forward 11.9. Wave 4 (task 6): commit 15.25, merged 16.9.
- Task names: 1 user schema · 2 payload validation · 3 serialization · 4 in-memory store · 5 handlers · 6 router.
- Pixel mapping: time axis x = 40 + minutes × (600 / 46.4) in a 680-wide viewBox.

---

### Task 1: Seekable animation engine + viz CSS in the post

**Type:** implementation
**Depends-on:** none

**Files:**
- Modify: `docs/superpowers-ultrapowers-evals.html`
- Create: `tests/test_post_visuals.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_post_visuals.py`:

```python
"""Blog-post visuals: seekable viz engine + unified agent-grammar figures.

Static/structural tests in the style of test_viewer.py: string assertions
on the HTML plus node --check on every embedded <script> block.
"""
import pathlib
import re
import shutil
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]
POST = ROOT / "docs/superpowers-ultrapowers-evals.html"


def html():
    return POST.read_text()


def scripts():
    return re.findall(r"<script>(.*?)</script>", html(), re.S)


def test_engine_present():
    h = html()
    assert "function Figure(" in h
    assert "__vizRegister" in h
    assert "getPointAtLength" in h
    assert "stroke-dashoffset" in h


def test_capture_hook_gated_on_query():
    h = html()
    assert "window.__seek" in h
    assert "window.__figDuration" in h
    assert re.search(r"capture", h), "capture query flag missing"


def test_capture_mode_disables_autoplay():
    # in capture mode figures must render(0) and never observe/play
    h = html()
    assert "CAPTURE" in h
    assert "IntersectionObserver" in h


def test_reduced_motion_renders_final_state():
    assert "prefers-reduced-motion" in html()


def test_viz_css_classes_defined():
    h = html()
    for cls in [".vlbl", ".vnum", ".vclk", ".viz svg"]:
        assert cls in h, f"missing CSS for {cls}"


def test_all_scripts_parse():
    node = shutil.which("node")
    if not node:
        import pytest
        pytest.skip("node not available")
    for i, js in enumerate(scripts()):
        f = POST.parent / f".tmp-script-{i}.js"
        f.write_text(js)
        try:
            subprocess.run([node, "--check", str(f)], check=True,
                           capture_output=True, text=True)
        finally:
            f.unlink()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest tests/test_post_visuals.py -q`
Expected: FAIL — `test_engine_present`, `test_capture_hook_gated_on_query`, `test_capture_mode_disables_autoplay`, `test_viz_css_classes_defined` fail (engine not yet added). `test_all_scripts_parse` and `test_reduced_motion_renders_final_state` may already pass — that's fine.

- [ ] **Step 3: Add the viz CSS**

In `docs/superpowers-ultrapowers-evals.html`, immediately before the closing `</style>` tag, add:

```css
  /* ---------- viz engine (unified agent grammar) ---------- */
  .viz svg { display: block; width: 100%; height: auto; }
  .vlbl { font-family: var(--sans); font-size: 12px; fill: var(--ink-faint); }
  .vnum { font-family: var(--sans); font-size: 11px; fill: var(--ink-soft); }
  .vclk { font-family: var(--mono); font-size: 12px; fill: var(--ink-soft); }
```

- [ ] **Step 4: Add the engine script**

Immediately before the existing `<script>` tag near the end of the file (the one beginning `(function () {` / `"use strict";` / `/* ---- race replay ---- */`), add a new separate script block:

```html
<script>
(function () {
  "use strict";
  /* viz engine: deterministic, seekable timelines for the orchestration
     figures. Every figure is a list of segments; render(t) is a pure
     function of elapsed ms, so rAF drives it live and the capture
     harness drives it frame-by-frame via window.__seek. Markup defaults
     to the completed state so no-JS readers see finished figures. */
  var RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var CAPTURE = /[?&]capture(=|&|$)/.test(location.search);
  var FIGS = {};
  function $(id) { return document.getElementById(id); }
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function easeInOut(p) { return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; }

  function Figure(id) {
    this.el = $(id);
    this.segs = [];
    this.duration = 0;
    this.playing = false;
  }
  Figure.prototype.seg = function (t0, dur, fn) {
    this.segs.push({ t0: t0, dur: dur, fn: fn });
    this.duration = Math.max(this.duration, t0 + dur);
    return this;
  };
  Figure.prototype.carve = function (t0, dur, pathId, dotId, marks, ease) {
    var path = $(pathId), dot = dotId && $(dotId);
    var L = path.getTotalLength();
    var ms = (marks || []).map(function (m) {
      return { x: m.x, el: $(m.id), fill: m.fill, pending: m.pending };
    });
    path.setAttribute("stroke-dasharray", String(L));
    return this.seg(t0, dur, function (p) {
      if (ease) p = ease(p);
      path.setAttribute("stroke-dashoffset", String(L * (1 - p)));
      var pt = path.getPointAtLength(L * p);
      if (dot) {
        dot.setAttribute("cx", String(pt.x));
        dot.setAttribute("cy", String(pt.y));
        dot.style.opacity = p > 0 && p < 1 ? "1" : "0";
      }
      ms.forEach(function (m) {
        m.el.style.fill = p > 0 && pt.x >= m.x ? m.fill : m.pending;
      });
    });
  };
  Figure.prototype.fill = function (t0, id, color, pending) {
    var el = $(id);
    return this.seg(t0, 60, function (p) {
      el.style.fill = p >= 1 ? color : pending;
    });
  };
  Figure.prototype.fade = function (t0, id) {
    var el = $(id);
    return this.seg(t0, 400, function (p) { el.style.opacity = String(p); });
  };
  Figure.prototype.pulse = function (t0, id, r0, dr) {
    var el = $(id);
    return this.seg(t0, 650, function (p) {
      el.setAttribute("r", String(r0 + p * dr));
      el.setAttribute("opacity", String(p > 0 && p < 1 ? (1 - p) * 0.8 : 0));
    });
  };
  Figure.prototype.render = function (t) {
    this.segs.forEach(function (s) { s.fn(clamp01((t - s.t0) / s.dur)); });
  };
  Figure.prototype.play = function () {
    if (this.playing) return;
    var self = this, start = null;
    this.playing = true;
    requestAnimationFrame(function step(ts) {
      if (start === null) start = ts;
      var t = ts - start;
      self.render(Math.min(t, self.duration));
      if (t < self.duration) requestAnimationFrame(step);
      else self.playing = false;
    });
  };

  window.__vizRegister = function (id, replayId, build) {
    var fig = new Figure(id);
    build(fig, easeInOut);
    FIGS[id] = fig;
    if (CAPTURE) { fig.render(0); return fig; }
    if (RM) { fig.render(fig.duration); return fig; }
    fig.render(0);
    var btn = replayId && $(replayId);
    if (btn) btn.addEventListener("click", function () { fig.play(); });
    if ("IntersectionObserver" in window) {
      var seen = false;
      new IntersectionObserver(function (entries, obs) {
        if (!seen && entries[0].isIntersecting) {
          seen = true; fig.play(); obs.disconnect();
        }
      }, { threshold: 0.45 }).observe(fig.el);
    } else {
      fig.play();
    }
    return fig;
  };
  if (CAPTURE) {
    window.__seek = function (id, t) { FIGS[id].render(t); };
    window.__figDuration = function (id) { return FIGS[id].duration; };
  }
})();
</script>
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_post_visuals.py -q`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers-ultrapowers-evals.html tests/test_post_visuals.py
git commit -m "post: add seekable viz engine and grammar CSS"
```

---

### Task 2: Anatomy figure (the labeled teaching diagram)

**Type:** implementation
**Depends-on:** 1

**Files:**
- Modify: `docs/superpowers-ultrapowers-evals.html`
- Modify: `tests/test_post_visuals.py`

Visual grammar reminder (self-contained): time flows left→right; gray `#8a8a8a` = integration branch; green `#047857` = workers; terracotta `#c2410c` = independent reviewers; purple `#7c3aed` = merge agent; hollow node = pending (fill `var(--paper-warm)`), filled = committed; the square is the human gate. Markup defaults to the **completed** state (no-JS readers see the finished figure); the engine's `render(0)` hides everything before play.

- [ ] **Step 1: Add the failing tests**

Append to `tests/test_post_visuals.py`:

```python
def test_anatomy_figure_present():
    h = html()
    assert 'id="fig-anatomy"' in h
    for label in ["worktrees — one isolated copy each", "one agent per task",
                  "independent review", "merge agent · Haiku", "your gate",
                  "integration branch", "Sonnet", "Opus"]:
        assert label in h, f"anatomy label missing: {label}"


def test_anatomy_has_human_gate_square():
    # the single square in the grammar is the human gate
    assert 'id="an-gate"' in html()


def test_script_ids_exist_in_markup():
    h = html()
    ids = set()
    for js in scripts():
        ids |= set(re.findall(r'"((?:an|rc)-[a-z0-9]+)"', js))
    for tok in sorted(ids):
        assert f'id="{tok}"' in h, f"script references missing element id {tok}"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest tests/test_post_visuals.py -q`
Expected: FAIL on `test_anatomy_figure_present` and `test_anatomy_has_human_gate_square` ("fig-anatomy" not found).

- [ ] **Step 3: Insert the anatomy figure markup**

In `docs/superpowers-ultrapowers-evals.html`, find the paragraph ending `...with an independent reviewer checking each one's work before it merges.</p>` and insert immediately after it (before the existing `<figure class="panel">` that holds the old race):

```html
<figure class="panel viz" id="fig-anatomy">
  <svg viewBox="0 0 680 240" role="img" aria-label="Anatomy of one wave: the integration branch forks into three isolated worktrees, a Sonnet worker carves each lane to its commit, an Opus reviewer carves the rest of the lane, a Haiku merge agent lands all three back on the trunk, and the run stops at a square human gate.">
    <text id="an-lbwt" class="vlbl" x="160" y="44" text-anchor="middle">worktrees — one isolated copy each</text>
    <text id="an-lbag" class="vlbl" x="330" y="44" text-anchor="middle">one agent per task</text>
    <text id="an-lbag2" class="vnum" x="330" y="60" text-anchor="middle">Sonnet</text>
    <text id="an-lbrv" class="vlbl" x="465" y="44" text-anchor="middle">independent review</text>
    <text id="an-lbrv2" class="vnum" x="465" y="60" text-anchor="middle">Opus</text>
    <path id="an-t1" d="M30,130 H120" fill="none" stroke="#8a8a8a" stroke-width="1.5"/>
    <path id="an-wk1" d="M120,130 C150,130 155,70 190,70 H330" fill="none" stroke="#047857" stroke-width="1.5"/>
    <path id="an-wk2" d="M120,130 H330" fill="none" stroke="#047857" stroke-width="1.5"/>
    <path id="an-wk3" d="M120,130 C150,130 155,190 190,190 H330" fill="none" stroke="#047857" stroke-width="1.5"/>
    <path id="an-rv1" d="M330,70 H420 C455,70 460,130 482,130" fill="none" stroke="#c2410c" stroke-width="1.3"/>
    <path id="an-rv2" d="M330,130 H482" fill="none" stroke="#c2410c" stroke-width="1.3"/>
    <path id="an-rv3" d="M330,190 H420 C455,190 460,130 482,130" fill="none" stroke="#c2410c" stroke-width="1.3"/>
    <path id="an-t2" d="M482,130 H592" fill="none" stroke="#8a8a8a" stroke-width="1.5"/>
    <circle cx="120" cy="130" r="3.5" fill="#8a8a8a"/>
    <circle id="an-n1" cx="330" cy="70" r="5.5" stroke="#047857" stroke-width="1.2" style="fill:#047857"/>
    <circle id="an-n2" cx="330" cy="130" r="5.5" stroke="#047857" stroke-width="1.2" style="fill:#047857"/>
    <circle id="an-n3" cx="330" cy="190" r="5.5" stroke="#047857" stroke-width="1.2" style="fill:#047857"/>
    <circle id="an-mn" cx="482" cy="130" r="7" stroke="#7c3aed" stroke-width="1.5" style="fill:#7c3aed"/>
    <circle id="an-pulse" cx="482" cy="130" r="7" fill="none" stroke="#7c3aed" opacity="0"/>
    <rect id="an-gate" x="592" y="123" width="14" height="14" rx="2" stroke="#8a8a8a" stroke-width="1.5" style="fill:#8a8a8a"/>
    <circle id="an-dt1" r="5" fill="#8a8a8a" style="opacity:0"/>
    <circle id="an-dt2" r="5" fill="#8a8a8a" style="opacity:0"/>
    <circle id="an-dw1" r="5" fill="#047857" style="opacity:0"/>
    <circle id="an-dw2" r="5" fill="#047857" style="opacity:0"/>
    <circle id="an-dw3" r="5" fill="#047857" style="opacity:0"/>
    <circle id="an-dr1" r="4" fill="none" stroke="#c2410c" stroke-width="1.5" style="opacity:0"/>
    <circle id="an-dr2" r="4" fill="none" stroke="#c2410c" stroke-width="1.5" style="opacity:0"/>
    <circle id="an-dr3" r="4" fill="none" stroke="#c2410c" stroke-width="1.5" style="opacity:0"/>
    <text class="vlbl" x="30" y="152">integration branch</text>
    <line id="an-lbmgl" x1="482" y1="142" x2="482" y2="208" stroke="#8a8a8a" stroke-width="0.6" stroke-dasharray="2 3"/>
    <text id="an-lbmg" class="vlbl" x="482" y="222" text-anchor="middle">merge agent · Haiku</text>
    <text id="an-lbgt" class="vlbl" x="599" y="160" text-anchor="middle">your gate</text>
  </svg>
  <button class="replay" id="an-replay" type="button">▶ Replay</button>
  <figcaption>One wave, anatomized. The integration branch forks into isolated worktrees; a worker agent (Sonnet) carves each task to its commit; an independent reviewer (Opus) finishes each lane; the merge agent (Haiku) lands every piece back on the trunk; and the run halts at the square — the gate where it waits for you. You pay for brilliance only where brilliance matters.</figcaption>
</figure>
```

- [ ] **Step 4: Add the anatomy timeline script**

Immediately after the engine `<script>` block added in Task 1 (and before the original post script), add:

```html
<script>
(function () {
  "use strict";
  var G = "#047857", P = "#7c3aed", GY = "#8a8a8a", PEND = "var(--paper-warm)";
  window.__vizRegister("fig-anatomy", "an-replay", function (f, ease) {
    f.carve(0, 600, "an-t1", "an-dt1", null, ease);
    f.fade(600, "an-lbwt");
    f.carve(600, 1500, "an-wk1", "an-dw1", [{ x: 329, id: "an-n1", fill: G, pending: PEND }], ease);
    f.carve(600, 1800, "an-wk2", "an-dw2", [{ x: 329, id: "an-n2", fill: G, pending: PEND }], ease);
    f.carve(600, 1650, "an-wk3", "an-dw3", [{ x: 329, id: "an-n3", fill: G, pending: PEND }], ease);
    f.fade(2100, "an-lbag");
    f.fade(2100, "an-lbag2");
    f.fade(2100, "an-lbrv");
    f.fade(2100, "an-lbrv2");
    f.carve(2100, 1100, "an-rv1", "an-dr1", null, ease);
    f.carve(2400, 1250, "an-rv2", "an-dr2", null, ease);
    f.carve(2250, 1000, "an-rv3", "an-dr3", null, ease);
    f.fill(3650, "an-mn", P, PEND);
    f.pulse(3650, "an-pulse", 7, 18);
    f.fade(3650, "an-lbmg");
    f.fade(3650, "an-lbmgl");
    f.carve(4300, 600, "an-t2", "an-dt2", null, ease);
    f.fill(4900, "an-gate", GY, PEND);
    f.fade(4900, "an-lbgt");
  });
})();
</script>
```

(Reviewer carve start times = each worker's end: 600+1500=2100, 600+1800=2400, 600+1650=2250. Merge fires when the slowest reviewer ends: max(3200, 3650, 3250) = 3650.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_post_visuals.py -q`
Expected: all PASS (including `test_script_ids_exist_in_markup` and `test_all_scripts_parse`).

- [ ] **Step 6: Visual check**

Run: `open docs/superpowers-ultrapowers-evals.html` and confirm: anatomy figure plays once on scroll; replay button works; labels fade in with their phases; the gate square fills last.

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers-ultrapowers-evals.html tests/test_post_visuals.py
git commit -m "post: add labeled anatomy figure (worktrees, tiers, merge agent, gate)"
```

---

### Task 3: Race figure on real run data (replaces the Gantt blocks)

**Type:** implementation
**Depends-on:** 2

**Files:**
- Modify: `docs/superpowers-ultrapowers-evals.html`
- Modify: `tests/test_post_visuals.py`

Visual grammar reminder (self-contained): shared time axis, x = 40 + minutes × (600/46.4); **linear motion, no easing — distance is time**. Blue `#1d4ed8` = serial worker, green `#047857` = wave workers, purple `#7c3aed` = merge nodes, gray `#8a8a8a` = structure; pending fill `var(--paper-warm)`. Markup defaults to completed state. All coordinates below derive from the measured timestamps in the plan header.

- [ ] **Step 1: Add the failing tests**

Append to `tests/test_post_visuals.py`:

```python
def test_race_figure_uses_real_run_data():
    h = html()
    assert 'id="fig-race"' in h
    assert "mixed-A-1" in h and "mixed-B-1" in h, "figcaption must cite run ids"
    # node x for the 42.6-min serial task-6 completion: 40 + 42.6*600/46.4
    assert 'cx="590.9"' in h
    # waves final merge at 16.9 min: 40 + 16.9*600/46.4
    assert 'cx="258.6"' in h


def test_race_figcaption_maps_task_names():
    h = html()
    for name in ["user schema", "payload validation", "serialization",
                 "in-memory store", "handlers", "router"]:
        assert name in h, f"task-name mapping missing: {name}"


def test_old_gantt_race_removed():
    h = html()
    assert 'class="track serial"' not in h
    assert "@keyframes grow" not in h
    assert 'id="replayBtn"' not in h
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest tests/test_post_visuals.py -q`
Expected: FAIL on all three new tests.

- [ ] **Step 3: Replace the race figure markup**

Delete the entire old race `<figure class="panel">` block — from `<figure class="panel">` containing `<div class="race" id="race"` through its closing `</figure>` (including the `▶ Replay the race` button and the old figcaption). Insert in its place:

```html
<figure class="panel viz" id="fig-race">
  <!-- Exact replay of two scored runs. mixed-A-1 (serial): launch 22:37:39,
       task completions 6.5/12.8/17.7/23.9/30.8/42.6 min, report 46.4 min.
       mixed-B-1 (waves): wave1 merged 8.7, wave2 10.75, wave3 ff 11.9,
       wave4 16.9 min. x = 40 + min*600/46.4. -->
  <svg viewBox="0 0 680 240" role="img" aria-label="Race on one shared time axis: the real serial run carves one line through six task nodes to 46.4 minutes while the real wave run fans out and back in four times and finishes at 16.9 minutes, every node at its measured commit time.">
    <text class="vlbl" x="40" y="30">Serial</text>
    <text id="rc-sclk" class="vclk" x="640" y="30" text-anchor="end">46.4 min</text>
    <path id="rc-sp" d="M40,52 H640" fill="none" stroke="#1d4ed8" stroke-width="1.5"/>
    <circle id="rc-s1" cx="124" cy="52" r="5" stroke="#1d4ed8" stroke-width="1" style="fill:#1d4ed8"/>
    <circle id="rc-s2" cx="205.5" cy="52" r="5" stroke="#1d4ed8" stroke-width="1" style="fill:#1d4ed8"/>
    <circle id="rc-s3" cx="268.9" cy="52" r="5" stroke="#1d4ed8" stroke-width="1" style="fill:#1d4ed8"/>
    <circle id="rc-s4" cx="349" cy="52" r="5" stroke="#1d4ed8" stroke-width="1" style="fill:#1d4ed8"/>
    <circle id="rc-s5" cx="438.3" cy="52" r="5" stroke="#1d4ed8" stroke-width="1" style="fill:#1d4ed8"/>
    <circle id="rc-s6" cx="590.9" cy="52" r="5" stroke="#1d4ed8" stroke-width="1" style="fill:#1d4ed8"/>
    <text class="vnum" x="124" y="40" text-anchor="middle">1</text>
    <text class="vnum" x="205.5" y="40" text-anchor="middle">2</text>
    <text class="vnum" x="268.9" y="40" text-anchor="middle">3</text>
    <text class="vnum" x="349" y="40" text-anchor="middle">4</text>
    <text class="vnum" x="438.3" y="40" text-anchor="middle">5</text>
    <text class="vnum" x="590.9" y="40" text-anchor="middle">6</text>
    <circle id="rc-sd" r="4.5" fill="#1d4ed8" style="opacity:0"/>
    <text class="vlbl" x="40" y="110">Waves</text>
    <text id="rc-wclk" class="vclk" x="640" y="110" text-anchor="end">16.9 min</text>
    <circle cx="40" cy="150" r="3" fill="#8a8a8a"/>
    <path id="rc-w1t" d="M40,150 C52,150 55,124 70,124 H132 C145,124 148,150 152.5,150" fill="none" stroke="#047857" stroke-width="1.5"/>
    <path id="rc-w1b" d="M40,150 C52,150 55,176 70,176 H132 C145,176 148,150 152.5,150" fill="none" stroke="#047857" stroke-width="1.5"/>
    <path id="rc-w2t" d="M152.5,150 C158,150 159,137 164,137 H169 C175,137 176,150 179,150" fill="none" stroke="#047857" stroke-width="1.5"/>
    <path id="rc-w2b" d="M152.5,150 C158,150 159,163 164,163 H169 C175,163 176,150 179,150" fill="none" stroke="#047857" stroke-width="1.5"/>
    <path id="rc-w3" d="M179,150 C183,150 184,143 187,143 H188.5 C191.5,143 192.3,150 193.7,150" fill="none" stroke="#047857" stroke-width="1.5"/>
    <path id="rc-w4" d="M193.7,150 C200,150 202,138 210,138 H242 C252,138 254,150 258.6,150" fill="none" stroke="#047857" stroke-width="1.5"/>
    <circle id="rc-n1" cx="126.6" cy="124" r="4" stroke="#047857" stroke-width="1" style="fill:#047857"/>
    <circle id="rc-n4" cx="127.9" cy="176" r="4" stroke="#047857" stroke-width="1" style="fill:#047857"/>
    <circle id="rc-n2" cx="166" cy="137" r="4" stroke="#047857" stroke-width="1" style="fill:#047857"/>
    <circle id="rc-n3" cx="165.4" cy="163" r="4" stroke="#047857" stroke-width="1" style="fill:#047857"/>
    <circle id="rc-n5" cx="188" cy="143" r="4" stroke="#047857" stroke-width="1" style="fill:#047857"/>
    <circle id="rc-n6" cx="237.2" cy="138" r="4" stroke="#047857" stroke-width="1" style="fill:#047857"/>
    <text class="vnum" x="126.6" y="112" text-anchor="middle">1</text>
    <text class="vnum" x="127.9" y="194" text-anchor="middle">4</text>
    <text class="vnum" x="166" y="126" text-anchor="middle">2</text>
    <text class="vnum" x="165.4" y="180" text-anchor="middle">3</text>
    <text class="vnum" x="188" y="131" text-anchor="middle">5</text>
    <text class="vnum" x="237.2" y="127" text-anchor="middle">6</text>
    <circle id="rc-m1" cx="152.5" cy="150" r="3.5" stroke="#7c3aed" stroke-width="1" style="fill:#7c3aed"/>
    <circle id="rc-m2" cx="179" cy="150" r="3.5" stroke="#7c3aed" stroke-width="1" style="fill:#7c3aed"/>
    <circle id="rc-m3" cx="193.7" cy="150" r="3.5" stroke="#7c3aed" stroke-width="1" style="fill:#7c3aed"/>
    <circle id="rc-m4" cx="258.6" cy="150" r="3.5" stroke="#7c3aed" stroke-width="1" style="fill:#7c3aed"/>
    <circle id="rc-p1" cx="152.5" cy="150" r="4" fill="none" stroke="#7c3aed" opacity="0"/>
    <circle id="rc-p2" cx="179" cy="150" r="4" fill="none" stroke="#7c3aed" opacity="0"/>
    <circle id="rc-p3" cx="258.6" cy="150" r="4" fill="none" stroke="#7c3aed" opacity="0"/>
    <circle id="rc-d1" r="4.5" fill="#047857" style="opacity:0"/>
    <circle id="rc-d2" r="4.5" fill="#047857" style="opacity:0"/>
    <circle id="rc-d3" r="4.5" fill="#047857" style="opacity:0"/>
    <circle id="rc-d4" r="4.5" fill="#047857" style="opacity:0"/>
    <circle id="rc-d5" r="4.5" fill="#047857" style="opacity:0"/>
    <circle id="rc-d6" r="4.5" fill="#047857" style="opacity:0"/>
    <line id="rc-guide" x1="258.6" y1="42" x2="258.6" y2="190" stroke="#8a8a8a" stroke-width="1" stroke-dasharray="3 4"/>
    <text id="rc-gtxt" class="vlbl" x="266" y="84">waves finish — serial is still on task 3</text>
    <g stroke="#8a8a8a" opacity="0.6">
      <line x1="40" y1="196" x2="40" y2="202"/><line x1="169.3" y1="196" x2="169.3" y2="202"/>
      <line x1="298.6" y1="196" x2="298.6" y2="202"/><line x1="427.9" y1="196" x2="427.9" y2="202"/>
      <line x1="557.2" y1="196" x2="557.2" y2="202"/>
    </g>
    <line x1="40" y1="199" x2="640" y2="199" stroke="#8a8a8a" opacity="0.35"/>
    <text class="vlbl" x="40" y="220" text-anchor="middle">0</text>
    <text class="vlbl" x="169.3" y="220" text-anchor="middle">10</text>
    <text class="vlbl" x="298.6" y="220" text-anchor="middle">20</text>
    <text class="vlbl" x="427.9" y="220" text-anchor="middle">30</text>
    <text class="vlbl" x="557.2" y="220" text-anchor="middle">40 min</text>
  </svg>
  <button class="replay" id="rc-replay" type="button">▶ Replay the race</button>
  <figcaption>An exact replay of the two scored runs on one time axis — every node sits at its measured commit timestamp. Serial is run <code>mixed-A-1</code> (46.4 min); waves is run <code>mixed-B-1</code> (16.9 min), same frozen plan. Tasks: 1 user schema · 2 payload validation · 3 serialization · 4 in-memory store · 5 handlers · 6 router. Purple dots are the merge agent landing each wave; the tail of each green lane after its node is review-and-merge time.</figcaption>
</figure>
```

- [ ] **Step 4: Add the race timeline script**

Immediately after the anatomy `<script>` block from Task 2, add:

```html
<script>
(function () {
  "use strict";
  var B = "#1d4ed8", G = "#047857", P = "#7c3aed", PEND = "var(--paper-warm)";
  var MS = 8000 / 46.4; // playback ms per measured minute (8 s total)
  window.__vizRegister("fig-race", "rc-replay", function (f) {
    function clock(id, capMin, final) {
      var el = document.getElementById(id);
      f.seg(0, capMin * MS, function (p) {
        el.textContent = p >= 1 ? final : Math.floor(capMin * p) + " min";
      });
    }
    clock("rc-sclk", 46.4, "46.4 min");
    clock("rc-wclk", 16.9, "16.9 min");
    f.carve(0, 8000, "rc-sp", "rc-sd", [
      { x: 124, id: "rc-s1", fill: B, pending: PEND },
      { x: 205.5, id: "rc-s2", fill: B, pending: PEND },
      { x: 268.9, id: "rc-s3", fill: B, pending: PEND },
      { x: 349, id: "rc-s4", fill: B, pending: PEND },
      { x: 438.3, id: "rc-s5", fill: B, pending: PEND },
      { x: 590.9, id: "rc-s6", fill: B, pending: PEND }
    ]);
    f.carve(0, 8.7 * MS, "rc-w1t", "rc-d1", [{ x: 126.6, id: "rc-n1", fill: G, pending: PEND }]);
    f.carve(0, 8.7 * MS, "rc-w1b", "rc-d2", [{ x: 127.9, id: "rc-n4", fill: G, pending: PEND }]);
    f.fill(8.7 * MS, "rc-m1", P, PEND);
    f.pulse(8.7 * MS, "rc-p1", 4, 12);
    f.carve(8.7 * MS, 2.05 * MS, "rc-w2t", "rc-d3", [{ x: 166, id: "rc-n2", fill: G, pending: PEND }]);
    f.carve(8.7 * MS, 2.05 * MS, "rc-w2b", "rc-d4", [{ x: 165.4, id: "rc-n3", fill: G, pending: PEND }]);
    f.fill(10.75 * MS, "rc-m2", P, PEND);
    f.pulse(10.75 * MS, "rc-p2", 4, 12);
    f.carve(10.75 * MS, 1.15 * MS, "rc-w3", "rc-d5", [{ x: 188, id: "rc-n5", fill: G, pending: PEND }]);
    f.fill(11.9 * MS, "rc-m3", P, PEND);
    f.carve(11.9 * MS, 5 * MS, "rc-w4", "rc-d6", [{ x: 237.2, id: "rc-n6", fill: G, pending: PEND }]);
    f.fill(16.9 * MS, "rc-m4", P, PEND);
    f.pulse(16.9 * MS, "rc-p3", 4, 12);
    f.fade(16.9 * MS, "rc-guide");
    f.fade(16.9 * MS, "rc-gtxt");
  });
})();
</script>
```

(No ease argument anywhere: motion is linear because horizontal distance is measured time.)

- [ ] **Step 5: Remove the old race CSS and JS**

In the `<style>` block:
- Delete every rule under `/* ---------- waves animation ---------- */` whose selector starts with `.race` (`.race`, `.race .lane-label`, `.race .track`, `.race .block`, `.race.played .block`, `.race .serial .block`, `.race .waves .block`, `.race .clock`) and delete `@keyframes grow`.
- Keep `.replay` and its `@media (hover: hover)` rule — the new figures reuse it.
- In the `@media (prefers-reduced-motion: reduce)` block that contains `.race .block, .race.played .block { animation: none; transform: scaleX(1); }`, delete that declaration but keep `.replay { display: none; }`.

In the original post `<script>` (the IIFE at the bottom): delete the `/* ---- race replay ---- */` section — from `var race = document.getElementById("race");` through the `else { play(); }` closing of its IntersectionObserver fallback — leaving the trade-off explorer code intact.

- [ ] **Step 6: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_post_visuals.py -q`
Expected: all PASS.

- [ ] **Step 7: Visual check**

Run: `open docs/superpowers-ultrapowers-evals.html` and confirm: both lanes start together; the waves lane finishes at the dashed guide while the serial dot is around task 3; counters count up in minutes; replay works; the trade-off explorer below still works.

- [ ] **Step 8: Commit**

```bash
git add docs/superpowers-ultrapowers-evals.html tests/test_post_visuals.py
git commit -m "post: rebuild race figure from measured run data on shared time axis"
```

---

### Task 4: Fixture thumbnails in the unified grammar

**Type:** implementation
**Depends-on:** 3

**Files:**
- Modify: `docs/superpowers-ultrapowers-evals.html`
- Modify: `tests/test_post_visuals.py`

Static completed-state miniatures (no animation), inline colors (green `#047857` lanes/nodes, purple `#7c3aed` merges, gray `#8a8a8a` trunk; degrade's ghost fan is dashed gray at 0.4 opacity). All four use `viewBox="0 0 160 80"`, rendered at `width="88" height="44"`.

- [ ] **Step 1: Add the failing tests**

Append to `tests/test_post_visuals.py`:

```python
def test_thumbnails_use_unified_grammar():
    h = html()
    assert h.count('class="mini"') == 4, "expected four grammar miniatures"
    assert 'stroke-dasharray="3 3"' in h, "degrade ghost fan missing"
    assert ".dag circle" not in h and ".dag path" not in h, "old .dag CSS lingers"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest tests/test_post_visuals.py -q`
Expected: FAIL on `test_thumbnails_use_unified_grammar`.

- [ ] **Step 3: Replace the four thumbnail SVGs**

In the `wide` fixture's `<summary>`, replace its `<svg class="dag" ...>...</svg>` with:

```html
<svg class="mini" width="88" height="44" viewBox="0 0 160 80" aria-hidden="true">
  <path d="M10,40 H20 M140,40 H150" stroke="#8a8a8a" stroke-width="1.5" fill="none"/>
  <path d="M20,40 C30,40 31,12 42,12 H118 C129,12 130,40 140,40 M20,40 C30,40 31,23 42,23 H118 C129,23 130,40 140,40 M20,40 C30,40 31,34 42,34 H118 C129,34 130,40 140,40 M20,40 C30,40 31,46 42,46 H118 C129,46 130,40 140,40 M20,40 C30,40 31,57 42,57 H118 C129,57 130,40 140,40 M20,40 C30,40 31,68 42,68 H118 C129,68 130,40 140,40" stroke="#047857" stroke-width="1.6" fill="none"/>
  <circle cx="20" cy="40" r="2.5" fill="#8a8a8a"/>
  <circle cx="80" cy="12" r="3.5" fill="#047857"/><circle cx="80" cy="23" r="3.5" fill="#047857"/>
  <circle cx="80" cy="34" r="3.5" fill="#047857"/><circle cx="80" cy="46" r="3.5" fill="#047857"/>
  <circle cx="80" cy="57" r="3.5" fill="#047857"/><circle cx="80" cy="68" r="3.5" fill="#047857"/>
  <circle cx="140" cy="40" r="4" fill="#7c3aed"/>
</svg>
```

In the `chained` fixture's `<summary>`, replace its `<svg class="dag" ...>...</svg>` with:

```html
<svg class="mini" width="88" height="44" viewBox="0 0 160 80" aria-hidden="true">
  <path d="M10,40 H20 M140,40 H150" stroke="#8a8a8a" stroke-width="1.5" fill="none"/>
  <path d="M20,40 Q32,16 44,40 M44,40 Q56,16 68,40 M68,40 Q80,16 92,40 M92,40 Q104,16 116,40 M116,40 Q128,16 140,40" stroke="#047857" stroke-width="1.6" fill="none"/>
  <circle cx="20" cy="40" r="2.5" fill="#8a8a8a"/>
  <circle cx="32" cy="28" r="3.2" fill="#047857"/><circle cx="56" cy="28" r="3.2" fill="#047857"/>
  <circle cx="80" cy="28" r="3.2" fill="#047857"/><circle cx="104" cy="28" r="3.2" fill="#047857"/>
  <circle cx="128" cy="28" r="3.2" fill="#047857"/>
  <circle cx="44" cy="40" r="2" fill="#7c3aed"/><circle cx="68" cy="40" r="2" fill="#7c3aed"/>
  <circle cx="92" cy="40" r="2" fill="#7c3aed"/><circle cx="116" cy="40" r="2" fill="#7c3aed"/>
  <circle cx="140" cy="40" r="4" fill="#7c3aed"/>
</svg>
```

In the `mixed` fixture's `<summary>`, replace its `<svg class="dag" ...>...</svg>` with:

```html
<svg class="mini" width="88" height="44" viewBox="0 0 160 80" aria-hidden="true">
  <path d="M10,40 H20 M144,40 H150" stroke="#8a8a8a" stroke-width="1.5" fill="none"/>
  <path d="M20,40 C27,40 28,26 35,26 H51 C60,26 62,40 66,40 M20,40 C27,40 28,54 35,54 H51 C60,54 62,40 66,40 M66,40 C72,40 73,28 79,28 H91 C99,28 101,40 104,40 M66,40 C72,40 73,52 79,52 H91 C99,52 101,40 104,40 M104,40 Q114,22 124,40 M124,40 Q134,22 144,40" stroke="#047857" stroke-width="1.6" fill="none"/>
  <circle cx="20" cy="40" r="2.5" fill="#8a8a8a"/>
  <circle cx="43" cy="26" r="3.5" fill="#047857"/><circle cx="43" cy="54" r="3.5" fill="#047857"/>
  <circle cx="85" cy="28" r="3.5" fill="#047857"/><circle cx="85" cy="52" r="3.5" fill="#047857"/>
  <circle cx="114" cy="31" r="3.2" fill="#047857"/><circle cx="134" cy="31" r="3.2" fill="#047857"/>
  <circle cx="66" cy="40" r="2.5" fill="#7c3aed"/><circle cx="104" cy="40" r="2.5" fill="#7c3aed"/>
  <circle cx="124" cy="40" r="2" fill="#7c3aed"/><circle cx="144" cy="40" r="4" fill="#7c3aed"/>
</svg>
```

In the `degrade` fixture's `<summary>`, replace its `<svg class="dag" ...>...</svg>` with:

```html
<svg class="mini" width="88" height="44" viewBox="0 0 160 80" aria-hidden="true">
  <path d="M22,40 C32,40 34,16 48,16 H112 C126,16 128,40 138,40 M22,40 C32,40 34,64 48,64 H112 C126,64 128,40 138,40" stroke="#8a8a8a" stroke-width="1.2" fill="none" stroke-dasharray="3 3" opacity="0.4"/>
  <path d="M10,40 H22 M138,40 H150" stroke="#8a8a8a" stroke-width="1.5" fill="none"/>
  <path d="M22,40 Q51,16 80,40 M80,40 Q109,16 138,40" stroke="#047857" stroke-width="1.6" fill="none"/>
  <circle cx="22" cy="40" r="2.5" fill="#8a8a8a"/>
  <circle cx="51" cy="28" r="3.5" fill="#047857"/><circle cx="109" cy="28" r="3.5" fill="#047857"/>
  <circle cx="80" cy="40" r="2.5" fill="#7c3aed"/>
  <circle cx="138" cy="40" r="4" fill="#7c3aed"/>
</svg>
```

- [ ] **Step 4: Update the thumbnail CSS**

In the `<style>` block, replace:

```css
  .dag { flex-shrink: 0; }
  .dag circle { fill: var(--ink-soft); }
  .dag path, .dag line { stroke: var(--ink-faint); stroke-width: 1.5; fill: none; }
```

with:

```css
  .mini { flex-shrink: 0; }
```

- [ ] **Step 5: Update the degrade card description**

In the degrade fixture's `<span class="fixsub">`, change `two tasks that collide — testing graceful failure` to `two tasks that collide — the fan it refused to run`. (The dashed ghost fan in the icon is the declined parallel plan; the description should point at it.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_post_visuals.py -q`
Expected: all PASS.

- [ ] **Step 7: Prose consistency check**

Run: `grep -n "diagrams up top\|race\b\|Gantt" docs/superpowers-ultrapowers-evals.html`
Confirm remaining prose references still make sense against the new figures ("Read the time column against the diagrams up top" should still refer to the fixture thumbnails — it does). Fix any sentence that references the deleted Gantt blocks.

- [ ] **Step 8: Commit**

```bash
git add docs/superpowers-ultrapowers-evals.html tests/test_post_visuals.py
git commit -m "post: redraw fixture thumbnails in unified grammar (incl. degrade ghost fan)"
```

---

### Task 5: GIF/MP4 capture script

**Type:** implementation
**Depends-on:** none

**Files:**
- Create: `docs/scripts/render_post_media.py`
- Create: `tests/test_render_post_media.py`

The script's browser/ffmpeg path is exercised by the manual export task (Task 7); these tests cover the pure logic only and must not require playwright or ffmpeg. The capture contract (defined in the spec, implemented by Task 1): loading the post with `?capture` exposes `window.__seek(figId, tMs)` and `window.__figDuration(figId)`, and disables autoplay. Figure ids: `fig-anatomy`, `fig-race`.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_render_post_media.py`:

```python
"""Capture script: pure-logic tests (no browser, no ffmpeg)."""
import importlib.util
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "docs/scripts/render_post_media.py"


def load():
    spec = importlib.util.spec_from_file_location("rpm", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_frame_times_cover_duration_and_hold():
    mod = load()
    times = mod.frame_times(1000, fps=30, hold_s=2.0)
    assert times[0] == 0
    assert max(times) == 1000
    assert all(b >= a for a, b in zip(times, times[1:])), "not monotonic"
    assert times.count(1000.0) >= 60, "expected >=2s of hold frames at 30fps"


def test_gif_cmd_is_palette_optimized_loop():
    mod = load()
    cmd = mod.gif_cmd(pathlib.Path("/tmp/frames"), 30, pathlib.Path("/tmp/o.gif"))
    joined = " ".join(cmd)
    assert cmd[0] == "ffmpeg"
    assert "palettegen" in joined and "paletteuse" in joined
    assert "-loop" in cmd and cmd[cmd.index("-loop") + 1] == "0"


def test_mp4_cmd_is_x_compatible():
    mod = load()
    cmd = mod.mp4_cmd(pathlib.Path("/tmp/frames"), 30, pathlib.Path("/tmp/o.mp4"))
    joined = " ".join(cmd)
    assert "yuv420p" in joined and "+faststart" in joined and "libx264" in joined


def test_default_figs_match_post_contract():
    mod = load()
    assert mod.FIGS == ["fig-anatomy", "fig-race"]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest tests/test_render_post_media.py -q`
Expected: FAIL — script file does not exist.

- [ ] **Step 3: Write the capture script**

Create `docs/scripts/render_post_media.py`:

```python
#!/usr/bin/env python3
"""Render the post's animated figures to looping GIF + MP4 for cross-posting.

The post, loaded with ?capture, exposes window.__seek(figId, tMs) and
window.__figDuration(figId) and disables autoplay; this script steps each
figure's deterministic timeline frame by frame — no screen recording.

Requires: pip install playwright && playwright install chromium; ffmpeg on PATH.

Usage:
  python3 docs/scripts/render_post_media.py            # both figures
  python3 docs/scripts/render_post_media.py --fig fig-race --fps 30 --scale 2
"""
import argparse
import pathlib
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
POST = ROOT / "docs" / "superpowers-ultrapowers-evals.html"
OUT = ROOT / "docs" / "media"
FIGS = ["fig-anatomy", "fig-race"]


def frame_times(duration_ms, fps=30, hold_s=2.0):
    """Timestamps 0..duration at fps, then hold_s of completed-state frames."""
    step = 1000.0 / fps
    times = []
    t = 0.0
    while t < duration_ms:
        times.append(t)
        t += step
    times.append(float(duration_ms))
    times.extend([float(duration_ms)] * int(round(hold_s * fps)))
    return times


def gif_cmd(frames_dir, fps, out_path):
    return [
        "ffmpeg", "-y", "-framerate", str(fps),
        "-i", str(frames_dir / "%05d.png"),
        "-vf", "split[a][b];[a]palettegen=stats_mode=diff[p];"
               "[b][p]paletteuse=dither=bayer:bayer_scale=4",
        "-loop", "0", str(out_path),
    ]


def mp4_cmd(frames_dir, fps, out_path):
    return [
        "ffmpeg", "-y", "-framerate", str(fps),
        "-i", str(frames_dir / "%05d.png"),
        "-vf", "crop=trunc(iw/2)*2:trunc(ih/2)*2",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18",
        "-movflags", "+faststart", str(out_path),
    ]


def capture(figs, fps, scale):
    from playwright.sync_api import sync_playwright
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport={"width": 760, "height": 1200},
                                device_scale_factor=scale)
        page.goto(POST.resolve().as_uri() + "?capture")
        page.wait_for_function("typeof window.__seek === 'function'")
        for fig in figs:
            duration = page.evaluate("window.__figDuration(%r)" % fig)
            el = page.locator("#" + fig)
            el.scroll_into_view_if_needed()
            with tempfile.TemporaryDirectory() as td:
                frames = pathlib.Path(td)
                for i, t in enumerate(frame_times(duration, fps)):
                    page.evaluate("window.__seek(%r, %f)" % (fig, t))
                    el.screenshot(path=str(frames / ("%05d.png" % i)))
                subprocess.run(gif_cmd(frames, fps, OUT / (fig + ".gif")),
                               check=True, capture_output=True)
                subprocess.run(mp4_cmd(frames, fps, OUT / (fig + ".mp4")),
                               check=True, capture_output=True)
            print("wrote", OUT / (fig + ".gif"), "and", OUT / (fig + ".mp4"))
        browser.close()


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--fig", nargs="*", default=FIGS,
                    help="figure element ids to render (default: all)")
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--scale", type=int, default=2,
                    help="device scale factor (2 = retina-sharp text)")
    args = ap.parse_args()
    capture(args.fig, args.fps, args.scale)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_render_post_media.py -q`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/scripts/render_post_media.py tests/test_render_post_media.py
git commit -m "post: add GIF/MP4 capture script for animated figures"
```

---

### Task 6: Full-suite verification

**Type:** gate
**Depends-on:** 1, 2, 3, 4, 5

Run: `python3 -m pytest tests/ -q`
Expected: every test passes (the pre-existing suite plus `test_post_visuals.py` and `test_render_post_media.py`). No test may be skipped except the documented node-availability skips.

---

### Task 7: Export media and review

**Type:** manual
**Depends-on:** 6

Owner steps (needs a browser-capable machine, Playwright, and ffmpeg):

1. One-time setup if needed: `pip install playwright && playwright install chromium`; confirm `ffmpeg -version` works (else `brew install ffmpeg`).
2. Run: `python3 docs/scripts/render_post_media.py`
3. Open `docs/media/fig-anatomy.gif` and `docs/media/fig-race.gif` — verify: figures play smoothly, hold ~2 s on the completed state, loop cleanly, text legible at feed size, no clipped edges.
4. Open the post in a browser one final time (normal, no `?capture`): scroll-triggered playback, replay buttons, and the trade-off explorer all work; check once with reduced motion enabled (figures appear completed, no autoplay).
5. Commit the media: `git add docs/media && git commit -m "post: rendered GIF/MP4 exports of animated figures"`

---

## Self-review notes

- Spec coverage: grammar/engine (Task 1), anatomy with tier labels (Task 2), real-data race + old Gantt removal (Task 3), thumbnails + `.dag` removal + prose check (Task 4), capture script (Task 5), export pass (Task 7). Trade-off explorer intentionally untouched (spec non-goal).
- Measured coordinates in Tasks 2–3 match the provenance table in the header (x = 40 + min × 600/46.4: 6.5→124, 12.8→205.5, 17.7→268.9, 23.9→349, 30.8→438.3, 42.6→590.9, 16.9→258.6).
- Engine API used by Tasks 2–3 (`carve(t0, dur, pathId, dotId, marks, ease)`, `fill`, `fade`, `pulse`, `seg`, `__vizRegister(id, replayId, build)`) matches the Task 1 definition exactly; every dot element is unique per carve so seeks stay order-independent.
- Same-file tasks (1→2→3→4) are explicitly chained via Depends-on; Task 5 touches disjoint files and can run in wave 1.
