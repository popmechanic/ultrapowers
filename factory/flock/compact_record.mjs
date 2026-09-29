// The compact record: what each tested snapshot changed, as a unified diff against the previous
// tested snapshot (base for the first) that `git apply` accepts, and the weave's ops with file
// texts as fingerprints. No file text is copied whole into the record: a snapshot is replayed by
// applying the rows' patches in order onto base. The 512 KB cap over all patches is about ten
// times the largest changed text measured (54,027 bytes, n=2 runs, 2026-09-28).
import crypto from 'node:crypto'

export const PATCH_LIMIT = 524288
const CONTEXT = 3

const sha1 = (x) => crypto.createHash('sha1').update(x).digest('hex')

// Lines with their terminators kept, so a last line without '\n' compares unequal to one with it.
function lines (text) {
  const out = text.match(/[^\n]*\n|[^\n]+$/g)
  return out || []
}

function hunkLine (mark, l) {
  return l.endsWith('\n') ? mark + l : mark + l + '\n\\ No newline at end of file\n'
}

// One hunk around the region between the common prefix and the common suffix.
function hunk (a, b) {
  let pre = 0
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++
  let suf = 0
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++
  if (pre === a.length && pre === b.length) return ''
  const s0 = pre - Math.min(pre, CONTEXT)
  const tail = Math.min(suf, CONTEXT)
  const aEnd = a.length - suf + tail; const bEnd = b.length - suf + tail
  const oldN = aEnd - s0; const newN = bEnd - s0
  let out = `@@ -${oldN ? s0 + 1 : s0},${oldN} +${newN ? s0 + 1 : s0},${newN} @@\n`
  for (let i = s0; i < pre; i++) out += hunkLine(' ', a[i])
  for (let i = pre; i < a.length - suf; i++) out += hunkLine('-', a[i])
  for (let i = pre; i < b.length - suf; i++) out += hunkLine('+', b[i])
  for (let i = a.length - suf; i < aEnd; i++) out += hunkLine(' ', a[i])
  return out
}

// A unified diff of one path from `before` to `after` (null: absent).
export function fileDiff (p, before, after) {
  if (before === after) return ''
  const head = `diff --git a/${p} b/${p}\n`
  if (before === null) {
    return head + 'new file mode 100644\n' + (after === '' ? '' : `--- /dev/null\n+++ b/${p}\n` + hunk([], lines(after)))
  }
  if (after === null) {
    return head + 'deleted file mode 100644\n' + (before === '' ? '' : `--- a/${p}\n+++ /dev/null\n` + hunk(lines(before), []))
  }
  return head + `--- a/${p}\n+++ b/${p}\n` + hunk(lines(before), lines(after))
}

// snapshots: [{snap, t, files, exists}]; baseFiles: {path: text}; weaveOpsLines: the raw
// weave-ops.jsonl lines. Answers the contents of snapshots.jsonl and weave-ops.digest.jsonl.
export function compactRecord (snapshots, baseFiles, weaveOpsLines) {
  let bytes = 0
  let prev = { ...baseFiles }; let prevSnap = 'base'
  const rows = snapshots.map((s) => {
    const changed = []; const deleted = []
    const tree = {}
    for (const p of Object.keys(baseFiles)) tree[p] = baseFiles[p]
    for (const p of Object.keys(s.files)) {
      if (s.exists[p]) tree[p] = s.files[p]; else delete tree[p]
    }
    for (const p of Object.keys(baseFiles)) if (s.exists && p in s.exists && !s.exists[p]) delete tree[p]
    for (const p of Object.keys(s.files).sort()) {
      if (!s.exists[p]) continue
      const text = s.files[p]
      if (p in baseFiles && baseFiles[p] === text) continue
      changed.push({ path: p, sha1: sha1(text), bytes: Buffer.byteLength(text, 'utf8') })
    }
    for (const p of Object.keys(baseFiles).sort()) if (!(p in tree)) deleted.push(p)
    let patch = ''
    for (const p of [...new Set([...Object.keys(prev), ...Object.keys(tree)])].sort()) {
      patch += fileDiff(p, p in prev ? prev[p] : null, p in tree ? tree[p] : null)
    }
    const n = Buffer.byteLength(patch, 'utf8')
    const row = { snap: s.snap, t: s.t, from: prevSnap, changed, deleted }
    if (bytes + n <= PATCH_LIMIT) { row.patch = patch; bytes += n } else { row.patch = null; row.truncated = true }
    prev = tree; prevSnap = s.snap
    return JSON.stringify(row)
  })
  const ops = weaveOpsLines.filter(Boolean).map((l) => {
    const o = JSON.parse(l)
    if (o.op === 'base' && Array.isArray(o.paths)) {
      const { paths, ...rest } = o
      return JSON.stringify({ ...rest, paths_count: paths.length })
    }
    if (typeof o.content !== 'string') return l
    const { content, ...rest } = o
    return JSON.stringify({ ...rest, content_sha1: sha1(content), content_bytes: Buffer.byteLength(content, 'utf8') })
  })
  return {
    snapshots: rows.map((r) => r + '\n').join(''),
    digest: ops.map((r) => r + '\n').join(''),
  }
}
