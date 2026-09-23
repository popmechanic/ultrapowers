/**
 * fleet/tests/test_probe_exe_facts.mjs — the exam for `probe_exe_facts.mjs`:
 * the twelve exe.dev lobby facts, re-read one line per fact against a fake
 * lobby, with a stamp, a tally and three exit codes.
 *
 * Every relative import is written for THIS directory: the probe under exam
 * is the file beside this one, `./probe_exe_facts.mjs`. This file imports no
 * sibling `test_*.mjs` (`fleet/tests/_helpers.mjs`'s hermetic sweep forbids
 * it) and needs `./_helpers.mjs` for nothing — the fake lobby below is a
 * plain in-memory function, no socket opened and no process spawned.
 *
 * WHAT IS CHECKED, and where:
 *
 *   M1  FACTS is the twelve `{id, says}` rows in Context's order, frozen; a
 *       run against a fake lobby whose every answer matches the recorded
 *       reading logs the header line, one `holds` line per fact in FACTS
 *       order, the `PROBE:` tally, and resolves `{exit: 0, stamp, results}`.
 *   M2  a single differing answer (the ls-json-shape example Context itself
 *       names: `ls --json` answering an object with no `vms` array on its
 *       very first read) makes that one line `DRIFT`, every other line still
 *       `holds`, the tally counts it, and `exit` is 1; a `help all --json`
 *       answering non-zero names the lobby unreachable, logs no `FACT` line,
 *       and `exit` is 2.
 *   M3  a `fleet-r*` row already in `ls --json` makes the probe log the
 *       refusal, issue no `new`, and exit 2 before any other verb; a `rm`
 *       that answers non-zero is named left behind and forces exit 2 even
 *       though every fact still held.
 *   M4  importing the probe makes no request and starts no process (the
 *       `main` guard), and `fleet/tests/PROBES.md` lists it.
 *
 * THE FAKE LOBBY. `makeFakeLobby()` answers by the verb line exe.dev would
 * see, stateful for `ls --json` — the VMs the fake has been told to create,
 * their comment, tags and proxy_port — reflecting exactly the twelve
 * recorded readings Context spells. `everCreated` never forgets a name once
 * minted, which is what makes `rm-reserves-name` hold on a bare `new` for
 * `T` after the cleanup removed it.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PROBES_MD = path.join(HERE, 'PROBES.md')

const FACT_IDS = [
  'help-all-digest',
  'ls-json-shape',
  'billing-plan-json',
  'help-verb-flags',
  'error-on-stdout',
  'new-no-positionals',
  'comment-200-bytes',
  'share-port-single',
  'tag-add-remove',
  'cp-copies-tags',
  'rm-reserves-name',
  'refused-verbs',
]

const NOW = new Date('2026-09-23T16:00:00.000Z')
const DATE = '2026-09-23'

const HELP_ALL_JSON = { commands: [{ name: 'new' }, { name: 'ls' }, { name: 'rm' }, { name: 'comment' }] }

const HELP_NEW_TEXT = [
  'Command: new',
  '',
  'Usage: new [options]',
  '',
  'Options:',
  '  --name <name>            VM name',
  '  --tag <tag>              tag to attach',
  '  --comment <text>         assignment comment',
  '  --cpu <n>                vCPUs',
  '  --memory <size>          memory, e.g. 8GB',
  '  --setup-script <path>    script to run on boot',
  '  --json                   JSON output',
  '',
].join('\n')

// ════════════════════════════════════════════════════════════════════════════
// The fake lobby: one scripted exe.dev, answering by the verb line it saw
// ════════════════════════════════════════════════════════════════════════════

/**
 * `helpAllCode` — a non-zero `help all --json` (leg (d)). `lsFirstBad` — the
 * FIRST `ls --json` answers an object with no `.vms[]` array, exactly the
 * drift M2 names, and every later `ls --json` answers the real state (leg
 * (c)). `preseedFleetRun` — a `fleet-r*` row already in every `ls --json`
 * (leg (e)). `rmFails` — the one VM name whose `rm` answers non-zero,
 * left in place (leg (g)).
 */
const makeFakeLobby = ({
  helpAllCode = 0, lsFirstBad = false, preseedFleetRun = null, rmFails = null,
} = {}) => {
  const calls = []
  const unrouted = []
  const vms = new Map()      // name -> { comment, tags: Set, proxy_port }
  const everCreated = new Set()
  let lsCalls = 0

  const answer = (code, stdout, stderr = '') => ({ code, stdout, stderr })
  const ok = (payload) => answer(0, JSON.stringify(payload))
  const refuse = (message) => answer(1, message)

  const lsPayload = () => {
    const rows = [...vms.entries()].map(([name, vm]) => ({
      vm_name: name,
      ssh_dest: `${name}.ssh`,
      ssh_host: `${name}.host`,
      status: 'running',
      comment: vm.comment,
      tags: [...vm.tags],
      proxy_port: vm.proxy_port,
    }))
    if (preseedFleetRun) {
      rows.push({ vm_name: preseedFleetRun, ssh_dest: 'x', ssh_host: 'x', status: 'running' })
    }
    return { shared_vms: [], vms: rows }
  }

  const request = async (remote) => {
    calls.push(remote)

    if (remote === 'help all --json') {
      return helpAllCode === 0 ? ok(HELP_ALL_JSON) : answer(helpAllCode, '', 'exe.dev unreachable')
    }
    if (remote === 'ls --json') {
      lsCalls += 1
      if (lsFirstBad && lsCalls === 1) return ok({ not_vms: [] })
      return ok(lsPayload())
    }
    if (remote === 'billing plan --json') {
      return ok({ max_cpus: 8, max_memory_gb: 16, tier: 'pro', plan: 'team' })
    }
    if (remote === 'help new') {
      return answer(0, HELP_NEW_TEXT)
    }

    let m
    if ((m = /^comment (\S+) (\S+)$/.exec(remote))) {
      const [, name, text] = m
      if (!vms.has(name)) return refuse(`Error: no such VM: ${name}`)
      if (text.length > 200) return refuse('Error: comment exceeds 200 bytes')
      vms.get(name).comment = text
      return ok({ ok: true })
    }
    if ((m = /^new --name (\S+) --cpu 1 --memory 2GB --comment '(.*)'$/.exec(remote))) {
      const [, name, comment] = m
      if (everCreated.has(name)) return refuse(`Error: name reserved: ${name}`)
      everCreated.add(name)
      vms.set(name, { comment, tags: new Set(), proxy_port: null })
      return ok({ ok: true, vm_name: name })
    }
    if ((m = /^new --name (\S+) --cpu 1 --memory 2GB$/.exec(remote))) {
      const [, name] = m
      if (everCreated.has(name)) return refuse(`Error: name reserved: ${name}`)
      everCreated.add(name)
      vms.set(name, { comment: '', tags: new Set(), proxy_port: null })
      return ok({ ok: true, vm_name: name })
    }
    if ((m = /^share port (\S+) (\d+)$/.exec(remote))) {
      const [, name, port] = m
      if (!vms.has(name)) return refuse(`Error: no such VM: ${name}`)
      vms.get(name).proxy_port = Number(port)
      return ok({ ok: true })
    }
    if ((m = /^tag -d (\S+) (\S+)$/.exec(remote))) {
      const [, name, tag] = m
      if (!vms.has(name)) return refuse(`Error: no such VM: ${name}`)
      vms.get(name).tags.delete(tag)
      return ok({ ok: true })
    }
    if ((m = /^tag (\S+) (\S+)$/.exec(remote))) {
      const [, name, tag] = m
      if (!vms.has(name)) return refuse(`Error: no such VM: ${name}`)
      vms.get(name).tags.add(tag)
      return ok({ ok: true })
    }
    if ((m = /^cp (\S+) (\S+) --copy-tags=false$/.exec(remote))) {
      const [, from, to] = m
      if (!vms.has(from)) return refuse(`Error: no such VM: ${from}`)
      everCreated.add(to)
      vms.set(to, { comment: vms.get(from).comment, tags: new Set(), proxy_port: null })
      return ok({ ok: true, vm_name: to })
    }
    if ((m = /^cp (\S+) (\S+)$/.exec(remote))) {
      const [, from, to] = m
      if (!vms.has(from)) return refuse(`Error: no such VM: ${from}`)
      everCreated.add(to)
      vms.set(to, { comment: vms.get(from).comment, tags: new Set(vms.get(from).tags), proxy_port: null })
      return ok({ ok: true, vm_name: to })
    }
    if ((m = /^rm (\S+)$/.exec(remote))) {
      const [, name] = m
      if (!vms.has(name)) return refuse(`Error: no such VM: ${name}`)
      if (rmFails === name) return refuse(`Error: could not remove ${name}`)
      vms.delete(name)
      return ok({ ok: true })
    }
    if (/^integrations (attach|detach) /.test(remote)) {
      return refuse('Error: integrations attach/detach are refused since 2026-09-11')
    }

    unrouted.push(remote)
    return refuse(`Error: no route for ${remote}`)
  }

  return {
    exec: async (cmd, argv) => request(argv[1]),
    calls,
    unrouted,
    vms,
  }
}

// ── The runner ───────────────────────────────────────────────────────────────

const failures = []
const test = async (name, fn) => {
  try {
    await fn()
  } catch (err) {
    failures.push({ name, err })
  }
}

const factLines = (lines) => lines.filter((line) => line.startsWith('FACT '))
const idsOf = (lines) => factLines(lines).map((line) => (line.match(/^FACT ([^:]+):/) || [])[1])
const diagnose = (lobby) => `${lobby.calls.length} call(s): ${lobby.calls.slice(0, 12).join(' | ')}` +
  (lobby.unrouted.length ? `; UNROUTED: ${lobby.unrouted.join(' | ')}` : '')

const run = async (opts) => {
  const lobby = makeFakeLobby(opts)
  const lines = []
  const result = await probeExeFacts({ exec: lobby.exec, log: (l) => lines.push(l), now: NOW })
  return { lobby, lines, result }
}

// ════════════════════════════════════════════════════════════════════════════
// (a) [M4] the import — first, before anything spawns
// ════════════════════════════════════════════════════════════════════════════

const idleLobby = makeFakeLobby()
let mod
await test('(a) [M4] importing the probe makes no request', async () => {
  mod = await import('./probe_exe_facts.mjs')
  assert.equal(typeof mod.probeExeFacts, 'function',
    '(a) [M1] fleet/tests/probe_exe_facts.mjs exports probeExeFacts({ exec, log, now })')
  assert.ok(Array.isArray(mod.FACTS), '(a) [M1] fleet/tests/probe_exe_facts.mjs exports FACTS')
  assert.equal(idleLobby.calls.length, 0,
    '(a) [M4] a fake lobby handed nowhere sees no call after the import resolves')
  const src = fs.readFileSync(path.join(HERE, 'probe_exe_facts.mjs'), 'utf8')
  assert.match(src, /process\.argv\[1\]/, '(a) [M4] the module guards its main on process.argv[1]')
  assert.match(src, /import\.meta\.url/, '(a) [M4] the same guard compares it against import.meta.url')
})

const { probeExeFacts, FACTS } = mod

// ════════════════════════════════════════════════════════════════════════════
// (b) [M1] FACTS: the twelve ids, in order, frozen
// ════════════════════════════════════════════════════════════════════════════

await test('(b) [M1] FACTS is the twelve {id, says} rows, in order, frozen', () => {
  assert.ok(Object.isFrozen(FACTS), '(b) [M1] FACTS is frozen')
  assert.deepEqual(FACTS.map((f) => f.id), FACT_IDS, '(b) [M1] FACTS.map(f => f.id) equals the twelve ids in order')
  for (const fact of FACTS) {
    assert.equal(typeof fact.says, 'string', `(b) [M1] ${fact.id} carries a says string`)
    assert.ok(fact.says.trim().length > 0, `(b) [M1] ${fact.id}'s says is not empty`)
  }
})

// ════════════════════════════════════════════════════════════════════════════
// (c) [M1] the all-holds run: header, twelve holds lines in order, tally, exit 0
// ════════════════════════════════════════════════════════════════════════════

await test('(c) [M1] against a lobby answering every recorded reading, every fact holds', async () => {
  const { lobby, lines, result } = await run({})
  assert.match(lines[0], /^lobby [0-9a-f]{16} — sha256 of help all --json, read 2026-09-23$/,
    `(c) [M1] the first line is the lobby's stamp line — got: ${JSON.stringify(lines[0])}`)
  const facts = factLines(lines)
  assert.equal(facts.length, 12, `(c) [M1] one FACT line per fact — got ${facts.length}. ${diagnose(lobby)}`)
  assert.deepEqual(idsOf(lines), FACT_IDS, '(c) [M1] one FACT line per id, in FACTS order, and no other id')
  for (const line of facts) {
    assert.match(line, /^FACT [^:]+: holds — .+\(lobby [0-9a-f]{16}, 2026-09-23\)$/,
      `(c) [M1] every FACT line reads holds and carries the stamp — got: ${line}`)
  }
  const probeLine = lines.find((l) => l.startsWith('PROBE:'))
  assert.equal(probeLine, 'PROBE: 12 facts, 0 drift, 0 unreadable',
    `(c) [Claim] the tally line — got: ${JSON.stringify(probeLine)}. ${diagnose(lobby)}`)
  assert.equal(result.exit, 0, `(c) [M1] exit is 0 when every fact holds — got ${result.exit}. ${diagnose(lobby)}`)
  assert.equal(result.stamp, lines[0].match(/^lobby ([0-9a-f]{16})/)[1], '(c) [M1] result.stamp is the header\'s own stamp')
  assert.deepEqual(result.results.map((r) => r.id), FACT_IDS, '(c) [M1] results carries one row per fact, in order')
})

// ════════════════════════════════════════════════════════════════════════════
// (d) [M2] one differing answer — ls --json with no vms array — is one DRIFT
// ════════════════════════════════════════════════════════════════════════════

await test('(d) [M2] ls --json answering no vms array on its first read is one DRIFT line, exit 1', async () => {
  const { lobby, lines, result } = await run({ lsFirstBad: true })
  const facts = factLines(lines)
  assert.equal(facts.length, 12, `(d) [M2] still one FACT line per fact — got ${facts.length}. ${diagnose(lobby)}`)
  const drifted = facts.filter((l) => l.startsWith('FACT ls-json-shape:'))
  assert.equal(drifted.length, 1, '(d) [M2] one line for ls-json-shape')
  assert.match(drifted[0], /^FACT ls-json-shape: DRIFT — .+, recorded .+ \(lobby [0-9a-f]{16}, 2026-09-23\)$/,
    `(d) [M2] the drift line names what was read and what was recorded — got: ${drifted[0]}`)
  const others = facts.filter((l) => !l.startsWith('FACT ls-json-shape:'))
  const notHolds = others.filter((l) => !/^FACT [^:]+: holds\b/.test(l))
  assert.deepEqual(notHolds, [], `(d) [M2] every other FACT line still reads holds — got: ${notHolds.join(' | ')}. ${diagnose(lobby)}`)
  assert.equal(result.exit, 1, `(d) [M2] exit is 1 when a fact drifts — got ${result.exit}`)
  const probeLine = lines.find((l) => l.startsWith('PROBE:'))
  assert.equal(probeLine, 'PROBE: 12 facts, 1 drift, 0 unreadable', `(d) [Claim] the tally counts the one drift — got: ${probeLine}`)
})

// ════════════════════════════════════════════════════════════════════════════
// (e) [M2] help all --json answering non-zero: unreachable, no FACT line, exit 2
// ════════════════════════════════════════════════════════════════════════════

await test('(e) [M2] a non-zero help all --json names the lobby unreachable and reads no fact', async () => {
  const { lobby, lines, result } = await run({ helpAllCode: 3 })
  assert.ok(lines.length > 0, '(e) [M2] the probe writes a first line even when the lobby cannot be read')
  assert.match(lines[0], /unreachable/i, `(e) [M2] the first line names the lobby unreachable — got: ${JSON.stringify(lines[0])}`)
  assert.ok(lines[0].includes('3'), `(e) [M2] and carries the exit code it read — got: ${JSON.stringify(lines[0])}`)
  assert.deepEqual(factLines(lines), [], `(e) [M2] no FACT line is written — got: ${factLines(lines).join(' | ')}`)
  assert.equal(result.exit, 2, `(e) [M2] exit is 2 when the lobby could not be read — got ${result.exit}`)
  assert.equal(result.stamp, null, '(e) [M2] no stamp when the lobby was unreachable')
  assert.equal(lobby.calls.length, 1, `(e) [M2] no verb beyond help all --json is issued — ${diagnose(lobby)}`)
})

// ════════════════════════════════════════════════════════════════════════════
// (f) [M3] a fleet-r* VM already listed: the refusal, no new, exit 2
// ════════════════════════════════════════════════════════════════════════════

await test('(f) [M3] a listed fleet-r* VM makes the probe refuse before any mutating verb', async () => {
  const { lobby, lines, result } = await run({ preseedFleetRun: 'fleet-r9-2609231600-abcd' })
  assert.ok(lines.some((l) => l.includes('fleet-r9-2609231600-abcd') && /refusing to create a throwaway beside a live run/.test(l)),
    `(f) [M3] a line names the live VM and refuses — got: ${JSON.stringify(lines)}`)
  assert.deepEqual(factLines(lines), [], '(f) [M3] no FACT line is written on a refusal')
  assert.ok(!lobby.calls.some((c) => /^new /.test(c)), `(f) [M3] no new is issued — ${diagnose(lobby)}`)
  assert.equal(result.exit, 2, `(f) [M3] exit is 2 on the refusal — got ${result.exit}`)
})

// ════════════════════════════════════════════════════════════════════════════
// (g) [M3] a failing rm names the VM left behind, exit 2, even with every fact holding
// ════════════════════════════════════════════════════════════════════════════

await test('(g) [M3] a rm answering non-zero leaves that VM named as left behind, exit 2', async () => {
  // A failing rm on a COPY, not on T itself: T is removed cleanly, so
  // rm-reserves-name still reads a plain holds and the leg isolates the one
  // thing under test — the cleanup's own failure, not a twelfth fact's.
  const { lobby, lines, result } = await run({ rmFails: 'probe-exe-facts-202609231600-copy1' })
  const facts = factLines(lines)
  assert.equal(facts.length, 12, `(g) [M3] every fact is still read — got ${facts.length}. ${diagnose(lobby)}`)
  const notHolds = facts.filter((l) => !/^FACT [^:]+: holds\b/.test(l))
  assert.deepEqual(notHolds, [], `(g) [M3] every FACT line still reads holds — a failed cleanup is not a fact's drift — got: ${notHolds.join(' | ')}`)
  const last = lines[lines.length - 1]
  assert.ok(last.includes('probe-exe-facts-202609231600-copy1') && /left behind/.test(last),
    `(g) [M3] the last line names the VM left behind — got: ${JSON.stringify(last)}`)
  assert.equal(result.exit, 2, `(g) [M3] exit is 2 when the cleanup left a VM behind — got ${result.exit}`)
  // The cleanup issues one rm per VM it created, in order, before the fact-11 check.
  const rmCalls = lobby.calls.filter((c) => /^rm /.test(c))
  assert.deepEqual(rmCalls, [
    'rm probe-exe-facts-202609231600-copy1',
    'rm probe-exe-facts-202609231600-copy2',
    'rm probe-exe-facts-202609231600',
  ], `(g) [M3] one rm per created VM, copies then the throwaway — got: ${JSON.stringify(rmCalls)}`)
})

// ════════════════════════════════════════════════════════════════════════════
// (h) [M4] PROBES.md lists the probe, its cost, its refusal and its exits
// ════════════════════════════════════════════════════════════════════════════

await test('(h) [M4] PROBES.md names the probe with its cost and its exits', () => {
  const joined = fs.readFileSync(PROBES_MD, 'utf8').split('\n').join(' ')
  assert.match(joined, /probe_exe_facts\.mjs/, '(h) [M4] PROBES.md names probe_exe_facts.mjs')
  assert.match(joined, /throwaway.*fleet-r.*launch\.mjs.*exit/,
    '(h) [M4] PROBES.md names the throwaway cost, the fleet-r refusal, fleet/launch.mjs and the exits')
})

// ── The verdict ─────────────────────────────────────────────────────────────

if (failures.length > 0) {
  for (const { name, err } of failures) {
    console.error(`FAILED ${name}\n  ${err?.message ?? err}`)
  }
  console.error(`${failures.length} failing leg${failures.length === 1 ? '' : 's'}`)
  process.exit(1)
}

console.log('ALL TESTS PASSED')
