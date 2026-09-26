# A killed run gets a recorded end

**Grammar:** claims-v1
**Claim:** A run killed mid-flight gets a recorded end: its evidence reads `failed`, never `running` forever. (quoted from #1314)
**Summary:** This gives a run that dies before it finishes a proper ending in its record, written by the janitor. It exists because runs killed mid-flight went on saying they were running for days, and the Run Room counted them as live. You get a record you can trust: every run ends done, parked or failed, and a dead run's evidence is kept and tagged like any other finished run.

**Goal:** A close-out step that writes `failed` onto the record of a run no fleet VM carries any more, then hands it to the existing branches-to-tags sweep; and a janitor pass that finds such runs on the repositories it already reads and closes them out.
**Closes:** #1314
**Tech Stack:** Node 22 ESM; `gh api` and the lobby through the existing exec seam.
Spec: #1314.

## Global Constraints

- The janitor and the close-out run no `git` of their own and clone nothing; every read and write goes through the exec seam (`gh api`, the lobby), as `fleet/janitor.mjs` does today.
- A run a fleet VM still carries is never closed out: that run is the VM's, and the janitor's existing death path owns it.

### Task 1: The close-out

**Type:** implementation

**Files:**
- Create: `fleet/close-out.mjs`

**Claim:** A run no VM carries whose record still says it is live is closed out as `failed`. (derived)
Machine: M1. `closeOut({ exec, target: 'o/r', run: 3, now })`, with no fleet VM carrying run 3 and the evidence branch's page at `state: 'running'`, issues one `gh api -X PUT` of `repos/o/r/contents/.ultrapowers/runs/3/status.json` on `branch=ultra/evidence-run-3` whose content is the page with `state` `failed`, `error` `reaped before the run recorded its end` and `updatedAt` the `now` given, as ISO. M2. With a fleet VM whose comment carries `run=3` and `target=o/r`, it issues no PUT. M3. With the page at `state: 'done'`, it issues no PUT.

**Authorized-by:** #1314 (desired state: the janitor writes the final `status.json`, then tags the run as publish does)

**Interfaces:**
- Consumes: none
- Produces: `closeOut({ exec, target, run, now, dryRun }) -> { target, run, state, closed, reason }`

**Context:** `fleet/close-out.mjs` exports `closeOut` and runs as `node fleet/close-out.mjs <owner>/<repo> <N> [--dry-run]`, printing one line. It must not import `fleet/janitor.mjs`, which will import it. Take its helpers from `fleet/lobby.mjs` (`listVms`, `parseComment`, `evidenceBranchFor`, `parseJson`, `defaultExec`, `Refusal`, `runCli`), or copy the two small ones it needs. The janitor's `readContentsAt` and `ghPut` show the shapes.

The steps:
(1) `listVms(exec)`. If any row's comment carries `run=<N>` and `target=<target>`, answer `{ closed: false, reason: 'a fleet VM still carries this run' }`.
(2) Read the page with `gh api repos/<target>/contents/.ultrapowers/runs/<N>/status.json?ref=ultra/evidence-run-<N>`. The answer is the contents envelope: base64 `content` plus `sha`. No envelope answers `{ closed: false, reason: 'no evidence branch page' }`. A `state` outside `booting`, `running`, `publishing` answers `{ closed: false, reason: 'not live' }`.
(3) Write the page back, every other cell kept, with `state: 'failed'`, `error: 'reaped before the run recorded its end'` and `updatedAt: now().toISOString()`. The write is one `gh api -X PUT repos/<target>/contents/.ultrapowers/runs/<N>/status.json -f branch=ultra/evidence-run-<N> -f message=<msg> -f content=<base64> -f sha=<sha>`.
(4) Run the existing sweep for that target, `retire({ argv: ['--target', target], exec })` from `fleet/retire.mjs`. It reads the page now saying `failed`, tags `ultra/plan/run-<N>` and `ultra/evidence/run-<N>`, verifies both and deletes the two branches, exactly as publish's `record_tags` does.
`dryRun` does (1) and (2), then answers what it would do and writes nothing. Answer `{ target, run, state: <the page's state before>, closed: true }` when written. The kata hub is not touched.

**Proof:**
- Run: node --input-type=module -e "import { closeOut } from './fleet/close-out.mjs'; const page = { state: 'running', updatedAt: '2026-09-13T00:00:00Z', run: 3 }; const puts = []; const exec = async (cmd, argv) => { const a = argv.join(' '); if (cmd === 'ssh') return { code: 0, stdout: JSON.stringify({ vms: [] }), stderr: '' }; if (cmd === 'gh' && argv.includes('PUT')) { puts.push(argv); return { code: 0, stdout: '{}', stderr: '' } } if (cmd === 'gh' && a.includes('status.json?ref=ultra/evidence-run-3')) return { code: 0, stdout: JSON.stringify({ content: Buffer.from(JSON.stringify(page)).toString('base64'), sha: 'b10b' }), stderr: '' }; return { code: 1, stdout: '', stderr: 'not found' } }; await closeOut({ exec, target: 'o/r', run: 3, now: () => new Date('2026-09-26T12:00:00Z') }); const p = puts.filter((x) => x.includes('repos/o/r/contents/.ultrapowers/runs/3/status.json')); const c = JSON.parse(Buffer.from(p[0].find((x) => x.startsWith('content=')).slice(8), 'base64').toString()); process.exit(p.length === 1 && p[0].includes('branch=ultra/evidence-run-3') && c.state === 'failed' && c.error === 'reaped before the run recorded its end' && c.updatedAt === '2026-09-26T12:00:00.000Z' && c.run === 3 ? 0 : 1)" [M1]
- Run: node --input-type=module -e "import { closeOut } from './fleet/close-out.mjs'; const page = { state: 'running', updatedAt: '2026-09-13T00:00:00Z' }; const puts = []; const exec = async (cmd, argv) => { const a = argv.join(' '); if (cmd === 'ssh') return { code: 0, stdout: JSON.stringify({ vms: [{ vm_name: 'fleet-r3-2609130000-ab12', ssh_dest: 'x', comment: 'run=3 plan=' + 'a'.repeat(40) + ' target=o/r base=' + 'b'.repeat(40) + ' engine=' + 'c'.repeat(40) }] }), stderr: '' }; if (cmd === 'gh' && argv.includes('PUT')) { puts.push(argv); return { code: 0, stdout: '{}', stderr: '' } } if (cmd === 'gh' && a.includes('status.json')) return { code: 0, stdout: JSON.stringify({ content: Buffer.from(JSON.stringify(page)).toString('base64'), sha: 'b10b' }), stderr: '' }; return { code: 1, stdout: '', stderr: 'not found' } }; await closeOut({ exec, target: 'o/r', run: 3, now: () => new Date('2026-09-26T12:00:00Z') }); process.exit(puts.length === 0 ? 0 : 1)" [M2]
- Run: node --input-type=module -e "import { closeOut } from './fleet/close-out.mjs'; const page = { state: 'done', updatedAt: '2026-09-13T00:00:00Z' }; const puts = []; const exec = async (cmd, argv) => { const a = argv.join(' '); if (cmd === 'ssh') return { code: 0, stdout: JSON.stringify({ vms: [] }), stderr: '' }; if (cmd === 'gh' && argv.includes('PUT')) { puts.push(argv); return { code: 0, stdout: '{}', stderr: '' } } if (cmd === 'gh' && a.includes('status.json')) return { code: 0, stdout: JSON.stringify({ content: Buffer.from(JSON.stringify(page)).toString('base64'), sha: 'b10b' }), stderr: '' }; return { code: 1, stdout: '', stderr: 'not found' } }; await closeOut({ exec, target: 'o/r', run: 3, now: () => new Date('2026-09-26T12:00:00Z') }); process.exit(puts.length === 0 ? 0 : 1)" [M3]
- Legs: (a) an orphaned live run's page is put back once on its evidence branch, failed, with the error, the given time and its other cells kept [M1]; (b) a run a VM still carries gets no write [M2]; (c) a finished run gets no write [M3].

**Stale-if:**
- path-exists: `fleet/close-out.mjs`

### Task 2: The janitor closes out orphaned runs

**Type:** implementation

**Files:**
- Modify: `fleet/janitor.mjs`

**Claim:** The janitor's ordinary pass closes out a dead run whose VM is already gone. (derived)
Machine: M1. A `janitor({ exec, kata: null, now })` pass whose fleet holds one VM carrying run 5 of `o/r`, on a target whose `ultra/evidence-run-` branches are runs 3 and 5, with run 3's branch page at `state: 'running'` last updated 13 days before `now`, issues exactly one contents PUT, on `branch=ultra/evidence-run-3`, and lists run 3 in its result's `closedOut`. M2. The same pass with `--dry-run` issues no PUT and still lists run 3 in `closedOut`.

**Authorized-by:** #1314 (why the janitor: it already reads every fleet VM and the run's record together, so no new writer is added)

**Interfaces:**
- Consumes: `closeOut({ exec, target, run, now, dryRun }) -> { target, run, state, closed, reason }`
- Produces: `closedOut`

**Context:** After the row loop, and beside #724's branch report (`closedUnmergedBranches`), the pass reads each target the rows named for orphans: `gh api repos/<target>/git/matching-refs/heads/ultra/evidence-run-`, one read per target, each entry's `ref` being `refs/heads/ultra/evidence-run-<N>`. For every run N no row of this pass names with that target, it reads the branch page (`?ref=ultra/evidence-run-<N>`). If the state is `booting`, `running` or `publishing` and `updatedAt` is older than `--age` (default 1 h), it calls `closeOut({ exec, target, run: N, now, dryRun })` from `fleet/close-out.mjs`. It pushes `{ target, run, state, closed }` onto a new result key `closedOut`, `closed` false under `--dry-run`, and renders one line per entry: `closed out run=<N> target=<t> <state> → failed` (`would close out …` under `--dry-run`). A run no VM carries whose page is finished, or live but younger than `--age`, is left alone. The existing death path, for a live record whose VM is still listed and whose unit is dead, is unchanged, and so is every read order before this one. The header comment's list of what the janitor writes gains this write. `kata: null` means no hub: every row reads from the evidence.

**Proof:**
- Run: node --input-type=module -e "import { janitor } from './fleet/janitor.mjs'; const env = (o) => ({ code: 0, stdout: JSON.stringify({ content: Buffer.from(JSON.stringify(o)).toString('base64'), sha: 'b10b' }), stderr: '' }); const puts = []; const exec = async (cmd, argv) => { const a = argv.join(' '); if (cmd === 'ssh') return { code: 0, stdout: JSON.stringify({ vms: [{ vm_name: 'fleet-r5-2609261100-ab12', ssh_dest: 'x', comment: 'run=5 plan=' + 'a'.repeat(40) + ' target=o/r base=' + 'b'.repeat(40) + ' engine=' + 'c'.repeat(40) }] }), stderr: '' }; if (cmd === 'gh' && argv.includes('PUT')) { puts.push(argv); return { code: 0, stdout: '{}', stderr: '' } } if (cmd === 'gh' && a.includes('matching-refs/heads/ultra/evidence-run-')) return { code: 0, stdout: JSON.stringify([{ ref: 'refs/heads/ultra/evidence-run-3' }, { ref: 'refs/heads/ultra/evidence-run-5' }]), stderr: '' }; if (cmd === 'gh' && a.includes('runs/5/status.json')) return env({ state: 'done', updatedAt: '2026-09-26T11:50:00Z' }); if (cmd === 'gh' && a.includes('runs/3/status.json?ref=ultra/evidence-run-3')) return env({ state: 'running', updatedAt: '2026-09-13T00:00:00Z' }); if (cmd === 'gh' && a.includes('matching-refs')) return { code: 0, stdout: '[]', stderr: '' }; return { code: 1, stdout: '', stderr: 'not found' } }; const r = await janitor({ argv: [], exec, kata: null, now: () => new Date('2026-09-26T12:00:00Z') }); const p = puts.filter((x) => x.some((y) => y.includes('contents/.ultrapowers/runs/'))); process.exit(p.length === 1 && p[0].includes('branch=ultra/evidence-run-3') && (r.closedOut || []).map((c) => c.run).join() === '3' ? 0 : 1)" [M1]
- Run: node --input-type=module -e "import { janitor } from './fleet/janitor.mjs'; const env = (o) => ({ code: 0, stdout: JSON.stringify({ content: Buffer.from(JSON.stringify(o)).toString('base64'), sha: 'b10b' }), stderr: '' }); const puts = []; const exec = async (cmd, argv) => { const a = argv.join(' '); if (cmd === 'ssh') return { code: 0, stdout: JSON.stringify({ vms: [{ vm_name: 'fleet-r5-2609261100-ab12', ssh_dest: 'x', comment: 'run=5 plan=' + 'a'.repeat(40) + ' target=o/r base=' + 'b'.repeat(40) + ' engine=' + 'c'.repeat(40) }] }), stderr: '' }; if (cmd === 'gh' && argv.includes('PUT')) { puts.push(argv); return { code: 0, stdout: '{}', stderr: '' } } if (cmd === 'gh' && a.includes('matching-refs/heads/ultra/evidence-run-')) return { code: 0, stdout: JSON.stringify([{ ref: 'refs/heads/ultra/evidence-run-3' }, { ref: 'refs/heads/ultra/evidence-run-5' }]), stderr: '' }; if (cmd === 'gh' && a.includes('runs/5/status.json')) return env({ state: 'done', updatedAt: '2026-09-26T11:50:00Z' }); if (cmd === 'gh' && a.includes('runs/3/status.json?ref=ultra/evidence-run-3')) return env({ state: 'running', updatedAt: '2026-09-13T00:00:00Z' }); if (cmd === 'gh' && a.includes('matching-refs')) return { code: 0, stdout: '[]', stderr: '' }; return { code: 1, stdout: '', stderr: 'not found' } }; const r = await janitor({ argv: ['--dry-run'], exec, kata: null, now: () => new Date('2026-09-26T12:00:00Z') }); process.exit(puts.length === 0 && (r.closedOut || []).map((c) => c.run).join() === '3' ? 0 : 1)" [M2]
- Legs: (a) the orphaned live run 3 gets exactly one page write on its own evidence branch and is listed, while run 5, which a VM carries, gets none [M1]; (b) a dry run writes nothing and still lists run 3 [M2].

**Stale-if:**
- path-absent: `fleet/janitor.mjs`
