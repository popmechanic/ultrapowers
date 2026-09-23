// fleet/tests/probe_exe_facts.mjs — the fleet's twelve exe.dev lobby facts,
// re-read against the live lobby, one line per fact, each stamped with the
// digest that is the only version marker exe.dev exposes.
//
// NOT named test_*.mjs on purpose: `tests/test_fleet_suite.py` globs
// `test_*.mjs`, so the suite never runs this and CI never spends a real VM.
// It is a LIVE MEASUREMENT (fleet/tests/PROBES.md) and is run by hand on the
// laptop, where the ssh seam to exe.dev lives:
//
//     node fleet/tests/probe_exe_facts.mjs
//
// WHY IT EXISTS. Every lobby fact in fleet/RUNBOOK.md's §Traps under "Tags,
// keys and names" and "Reading the lobby" was learned from a run that died on
// it, and fleet/doctor.mjs's verb-drift row re-reads each verb's FLAG set —
// nothing in the tree re-reads a BEHAVIOUR. exe.dev exposes no version verb,
// no --version, no version header, no changelog and no change notification
// (Shelley, exe.dev's assistant, 2026-09-23), so the one thing every line
// here is stamped with is the digest of `help all --json`'s own stdout and
// the UTC date the reading was taken.
//
// THE THROWAWAY VMS. Fact 6 (new-no-positionals) creates one VM,
// `probe-exe-facts-<stamp>`; fact 10 (cp-copies-tags) makes two copies of it.
// All three are removed at the end, the last mutating verbs the probe issues
// — `rm <name>` once per VM it created — and a failing `rm` is named as left
// behind rather than lost silently.
//
// THE REFUSAL. Before any mutating verb the probe reads `ls --json`, and a
// `fleet-r*` VM already listed there means a fleet run is live: it refuses
// to create a throwaway beside it, issues no `new`, and exits 2.
//
// HOW A FACT IS SCORED. Each fact issues the lobby verb(s) its recorded
// reading names and compares what came back against that reading. `holds`
// means the answer is in the same shape/class as recorded; `DRIFT` means it
// is not (a refusal that started succeeding, a shape the lobby stopped
// answering); a verb whose `exec` threw or answered no exit code at all is
// `UNREADABLE` — never scored as drift, since nothing was actually read.
//
// Exit: 0 every fact holds; 1 at least one drift or unreadable fact;
// 2 the lobby was unreachable, a live run's VM was listed, or the cleanup
// left a throwaway VM behind.

import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { EXE_HOST, defaultExec, parseJson } from '../lobby.mjs'

/**
 * The twelve facts, in the order every run logs them — NOT the order they are
 * read in: fact 11 (rm-reserves-name) is read last of all, after the cleanup,
 * while fact 12 (refused-verbs) is read before it. `says` is the reading the
 * fleet holds today, quoted back on a DRIFT or UNREADABLE line, and the ids
 * are the shared literal `fleet/CONTRACT.md`'s `exe.dev facts (measured)`
 * list carries row for row.
 */
export const FACTS = Object.freeze([
  { id: 'help-all-digest',
    says: 'help all --json is JSON with a commands array; its sha256 is the only version marker exe.dev exposes (Shelley, 2026-09-23)' },
  { id: 'ls-json-shape',
    says: 'ls --json is {shared_vms, vms}; read .vms[] only; rows carry vm_name, ssh_dest, ssh_host, status' },
  { id: 'billing-plan-json',
    says: 'billing plan --json carries max_cpus, max_memory_gb, tier and plan — the pool the launcher sizes against' },
  { id: 'help-verb-flags',
    says: 'help <verb> prints an Options: block, one flag per line, which is what the doctor\'s verb-drift row diffs' },
  { id: 'error-on-stdout',
    says: 'a lobby error comes back on stdout with exit 1 and no envelope' },
  { id: 'new-no-positionals',
    says: 'new takes no positionals; a spaced --comment travels inside one ssh argument with its quotes intact, or the lobby reads the tail as positionals' },
  { id: 'comment-200-bytes',
    says: 'the VM comment holds 200 bytes' },
  { id: 'share-port-single',
    says: 'share port sets the VM\'s single proxy_port; a second call replaces it' },
  { id: 'tag-add-remove',
    says: 'tag adds and tag -d removes a tag; tag -d of a tag an integration policy names detaches that integration at once (not re-measured: the probe carries no policy-scoped tag)' },
  { id: 'cp-copies-tags',
    says: 'cp copies tags by default; --copy-tags=false makes a copy with none' },
  { id: 'rm-reserves-name',
    says: 'exe.dev reserves a deleted VM\'s name for good' },
  { id: 'refused-verbs',
    says: 'new --integration, integrations attach and integrations detach are refused since 2026-09-11; the policy is the only grant' },
])

// ── Small readings of an answer ─────────────────────────────────────────────

const two = (n) => String(n).padStart(2, '0')

/** `YYYYMMDDHHMM` from `now`, UTC — the throwaway's stamp. */
const runStampOf = (now) => {
  const d = now instanceof Date ? now : new Date(now)
  return `${d.getUTCFullYear()}${two(d.getUTCMonth() + 1)}${two(d.getUTCDate())}${two(d.getUTCHours())}${two(d.getUTCMinutes())}`
}

/** `YYYY-MM-DD` from `now`, UTC — the date every line is stamped with. */
const dateOf = (now) => (now instanceof Date ? now : new Date(now)).toISOString().slice(0, 10)

/** The first 16 hex characters of the sha256 of `text`'s bytes. */
const sha16 = (text) => createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex').slice(0, 16)

const FLAG_LINE = /^[ \t]+(--[A-Za-z0-9-]+)/gm

/** The `Options:` block's flags, as `fleet/doctor.mjs`'s `helpFlags` reads them. */
const helpFlags = (stdout) => {
  const flags = []
  for (const match of String(stdout ?? '').matchAll(FLAG_LINE)) {
    if (!flags.includes(match[1])) flags.push(match[1])
  }
  return flags
}

// ── The probe ────────────────────────────────────────────────────────────────

/**
 * Re-measure all twelve facts against `exec` and write one line per fact
 * through `log`. `exec` is the seam `fleet/lobby.mjs` defines —
 * `(cmd, argv, options?) => Promise<{ code, stdout, stderr }>`, never
 * rejecting — driven raw rather than through `lobby(exec, remote)`: several
 * facts need the exact stdout/stderr split and the exact exit code a caught
 * `LobbyError` does not keep. Every verb is issued as
 * `exec('ssh', [EXE_HOST, '<verb line>'])`, one string argument after the
 * host, exactly as `fleet/lobby.mjs`'s `lobby` does.
 *
 * Resolves `{ exit, stamp, results }`.
 */
export const probeExeFacts = async ({ exec, log = console.log, now = new Date() } = {}) => {
  const date = dateOf(now)
  const runStamp = runStampOf(now)
  const T = `probe-exe-facts-${runStamp}`

  /** One lobby verb. A thrown `exec` or a non-numeric `code` reads as `code:
   *  null` — unreadable, never scored as a drift. */
  const send = async (remote) => {
    try {
      const res = await exec('ssh', [EXE_HOST, remote])
      const code = res && typeof res.code === 'number' ? res.code : null
      return { code, stdout: String((res && res.stdout) ?? ''), stderr: String((res && res.stderr) ?? '') }
    } catch (err) {
      return { code: null, stdout: '', stderr: String(err?.message ?? err) }
    }
  }

  const readJson = (res) => (res.code === 0 ? parseJson(res.stdout) : null)
  const vmRow = (payload, name) => {
    const rows = Array.isArray(payload?.vms) ? payload.vms : []
    return rows.find((row) => row?.vm_name === name) ?? null
  }

  const HOLDS = 'holds'
  const DRIFT = 'DRIFT'
  const UNREADABLE = 'UNREADABLE'
  const holds = (read) => ({ verdict: HOLDS, read })
  const drift = (read) => ({ verdict: DRIFT, read })
  const unreadable = (read) => ({ verdict: UNREADABLE, read })

  // ── fact 1: help all --json — the lobby's reachability, and the digest ────
  const helpAll = await send('help all --json')
  if (helpAll.code !== 0) {
    log(`lobby unreachable — help all --json answered ${helpAll.code === null ? 'no exit code' : `exit ${helpAll.code}`}`)
    return { exit: 2, stamp: null, results: [] }
  }
  const stamp = sha16(helpAll.stdout)
  log(`lobby ${stamp} — sha256 of help all --json, read ${date}`)

  const helpAllJson = parseJson(helpAll.stdout)
  const fact1 = Array.isArray(helpAllJson?.commands)
    ? holds(`help all --json is JSON with ${helpAllJson.commands.length} command(s) under commands[]`)
    : drift(helpAllJson ? 'help all --json parsed but carries no commands array' : 'help all --json did not parse as JSON')

  // ── fact 2 and the M3 refusal — ls --json, before any mutating verb ───────
  const ls1 = await send('ls --json')
  const ls1Json = readJson(ls1)
  const vms1 = Array.isArray(ls1Json?.vms) ? ls1Json.vms : []

  const liveRun = vms1.find((row) => typeof row?.vm_name === 'string' && row.vm_name.startsWith('fleet-r'))
  if (liveRun) {
    log(`${liveRun.vm_name} is a live run's VM — refusing to create a throwaway beside a live run`)
    return { exit: 2, stamp, results: [] }
  }

  const fact2 = ls1.code !== 0
    ? unreadable(`ls --json answered ${ls1.code === null ? 'no exit code' : `exit ${ls1.code}`}`)
    : !Array.isArray(ls1Json?.vms)
      ? drift('ls --json answered no .vms[] array')
      : !Array.isArray(ls1Json?.shared_vms)
        ? drift('ls --json answered no .shared_vms[] array')
        : holds(`ls --json is {shared_vms, vms}; ${vms1.length} row(s) under .vms[]`)

  // ── fact 3: billing plan --json ────────────────────────────────────────────
  const billing = await send('billing plan --json')
  const billingJson = readJson(billing)
  const BILLING_KEYS = ['max_cpus', 'max_memory_gb', 'tier', 'plan']
  const fact3 = billing.code === null
    ? unreadable('billing plan --json gave no answer')
    : billing.code !== 0
      ? drift(`billing plan --json failed (exit ${billing.code})`)
      : (() => {
          const missing = BILLING_KEYS.filter((key) => !billingJson || !(key in billingJson))
          return missing.length === 0
            ? holds('billing plan --json carries max_cpus, max_memory_gb, tier and plan')
            : drift(`billing plan --json is missing ${missing.join(', ')}`)
        })()

  // ── fact 4: help new — the Options: block the doctor's verb-drift reads ──
  const helpNew = await send('help new')
  const WANT_FLAGS = ['--comment', '--name', '--setup-script', '--tag', '--cpu', '--memory']
  const fact4 = helpNew.code === null
    ? unreadable('help new gave no answer')
    : helpNew.code !== 0
      ? drift(`help new failed (exit ${helpNew.code})`)
      : (() => {
          const found = helpFlags(helpNew.stdout)
          const missing = WANT_FLAGS.filter((flag) => !found.includes(flag))
          return missing.length === 0
            ? holds(`help new's Options: block lists ${WANT_FLAGS.join(', ')}`)
            : drift(`help new's Options: block is missing ${missing.join(', ')}`)
        })()

  // ── fact 5: a lobby error on stdout, no envelope ──────────────────────────
  const badVm = `no-such-vm-${runStamp}`
  const errCheck = await send(`comment ${badVm} probe`)
  const fact5 = errCheck.code === null
    ? unreadable(`comment ${badVm} probe gave no answer`)
    : errCheck.code === 0
      ? drift(`comment ${badVm} probe exited 0`)
      : (() => {
          const trimmed = errCheck.stdout.trim()
          if (trimmed === '') return drift(`comment ${badVm} probe exited ${errCheck.code} with empty stdout`)
          if (parseJson(errCheck.stdout) !== null) return drift(`comment ${badVm} probe's stdout parsed as JSON`)
          return holds(`comment ${badVm} probe exited ${errCheck.code} with non-empty, non-JSON stdout`)
        })()

  // ── fact 6: new — no positionals, a spaced --comment survives whole ──────
  const comment6 = `probe exe facts ${runStamp}`
  const newT = await send(`new --name ${T} --cpu 1 --memory 2GB --comment '${comment6}'`)
  let tCreated = false
  let fact6
  if (newT.code === null) {
    fact6 = unreadable(`new --name ${T} … gave no answer`)
  } else if (newT.code !== 0) {
    fact6 = drift(`new --name ${T} … failed (exit ${newT.code})`)
  } else {
    tCreated = true
    const ls2 = await send('ls --json')
    const row = vmRow(readJson(ls2), T)
    fact6 = row && row.comment === comment6
      ? holds(`new --name ${T} … created it and ls --json reads the comment whole`)
      : drift(row ? `ls --json reads comment ${JSON.stringify(row.comment)}` : `ls --json does not list ${T}`)
  }

  // ── fact 7: the 200-byte comment ceiling ──────────────────────────────────
  let fact7
  if (!tCreated) {
    fact7 = unreadable(`${T} was never created`)
  } else {
    const over = 'x'.repeat(201)
    const atLimit = 'x'.repeat(200)
    const long = await send(`comment ${T} ${over}`)
    const short = await send(`comment ${T} ${atLimit}`)
    if (long.code === null || short.code === null) {
      fact7 = unreadable(`comment <201 bytes> exited ${long.code ?? 'none'}, <200 bytes> exited ${short.code ?? 'none'}`)
    } else if (long.code !== 0 && short.code === 0) {
      fact7 = holds(`comment <201 bytes> failed (exit ${long.code}), <200 bytes> exited 0`)
    } else {
      fact7 = drift(`comment <201 bytes> exited ${long.code}, <200 bytes> exited ${short.code}`)
    }
  }

  // ── fact 8: share port — one proxy_port, replaced ─────────────────────────
  let fact8
  if (!tCreated) {
    fact8 = unreadable(`${T} was never created`)
  } else {
    const s1 = await send(`share port ${T} 8080`)
    const row1 = vmRow(readJson(await send('ls --json')), T)
    const s2 = await send(`share port ${T} 9090`)
    const row2 = vmRow(readJson(await send('ls --json')), T)
    if (s1.code === null || s2.code === null) {
      fact8 = unreadable(`share port 8080 exited ${s1.code ?? 'none'}, share port 9090 exited ${s2.code ?? 'none'}`)
    } else if (s1.code === 0 && s2.code === 0 && row1?.proxy_port === 8080 && row2?.proxy_port === 9090) {
      fact8 = holds('share port 8080 then 9090 leaves proxy_port 9090')
    } else {
      fact8 = drift(`proxy_port read ${row1?.proxy_port ?? 'none'} then ${row2?.proxy_port ?? 'none'}`)
    }
  }

  // ── fact 9: tag / tag -d ───────────────────────────────────────────────────
  const tagName = `probe-exe-${runStamp}`
  let fact9
  if (!tCreated) {
    fact9 = unreadable(`${T} was never created`)
  } else {
    const add = await send(`tag ${T} ${tagName}`)
    const rowA = vmRow(readJson(await send('ls --json')), T)
    const hasTag = Array.isArray(rowA?.tags) && rowA.tags.includes(tagName)
    const del = await send(`tag -d ${T} ${tagName}`)
    const rowB = vmRow(readJson(await send('ls --json')), T)
    const tagGone = !(Array.isArray(rowB?.tags) && rowB.tags.includes(tagName))
    if (add.code === null || del.code === null) {
      fact9 = unreadable(`tag exited ${add.code ?? 'none'}, tag -d exited ${del.code ?? 'none'}`)
    } else if (add.code === 0 && hasTag && del.code === 0 && tagGone) {
      fact9 = holds(`tag ${tagName} added it and tag -d removed it`)
    } else {
      fact9 = drift(`tag read tags ${JSON.stringify(rowA?.tags ?? null)}, tag -d read tags ${JSON.stringify(rowB?.tags ?? null)}`)
    }
  }

  // ── fact 10: cp — copies tags by default, --copy-tags=false makes none ───
  const copy1 = `${T}-copy1`
  const copy2 = `${T}-copy2`
  let copy1Created = false
  let copy2Created = false
  let fact10
  if (!tCreated) {
    fact10 = unreadable(`${T} was never created`)
  } else {
    // Fact 9 removed the tag; put it back so cp has something to copy.
    await send(`tag ${T} ${tagName}`)
    const cp1 = await send(`cp ${T} ${copy1}`)
    if (cp1.code === 0) copy1Created = true
    const rowC1 = vmRow(readJson(await send('ls --json')), copy1)
    const copy1HasTag = Array.isArray(rowC1?.tags) && rowC1.tags.includes(tagName)
    const cp2 = await send(`cp ${T} ${copy2} --copy-tags=false`)
    if (cp2.code === 0) copy2Created = true
    const rowC2 = vmRow(readJson(await send('ls --json')), copy2)
    const copy2NoTags = !Array.isArray(rowC2?.tags) || rowC2.tags.length === 0
    await send(`tag -d ${T} ${tagName}`)
    if (cp1.code === null || cp2.code === null) {
      fact10 = unreadable(`cp ${T} ${copy1} exited ${cp1.code ?? 'none'}, cp --copy-tags=false exited ${cp2.code ?? 'none'}`)
    } else if (cp1.code === 0 && copy1HasTag && cp2.code === 0 && copy2NoTags) {
      fact10 = holds(`cp ${T} ${copy1} copied ${tagName}; cp --copy-tags=false made ${copy2} with no tags`)
    } else {
      fact10 = drift(`${copy1} tags read ${JSON.stringify(rowC1?.tags ?? null)}; ${copy2} tags read ${JSON.stringify(rowC2?.tags ?? null)}`)
    }
  }

  // ── fact 12: refused verbs — read before the cleanup ──────────────────────
  const badIntegration = `no-such-integration-${runStamp}`
  const attach = await send(`integrations attach ${badIntegration}`)
  const detach = await send(`integrations detach ${badIntegration}`)
  const fact12 = attach.code === null || detach.code === null
    ? unreadable(`integrations attach exited ${attach.code ?? 'none'}, integrations detach exited ${detach.code ?? 'none'}`)
    : attach.code !== 0 && detach.code !== 0
      ? holds(`integrations attach and integrations detach both refused (exit ${attach.code}, ${detach.code})`)
      : drift(`integrations attach exited ${attach.code}, integrations detach exited ${detach.code}`)

  // ── cleanup: one `rm` per VM the run created ──────────────────────────────
  const toRemove = []
  if (copy1Created) toRemove.push(copy1)
  if (copy2Created) toRemove.push(copy2)
  if (tCreated) toRemove.push(T)

  const leftBehind = []
  for (const name of toRemove) {
    const rm = await send(`rm ${name}`)
    if (rm.code !== 0) leftBehind.push(name)
  }

  // ── fact 11: rm reserves the name — read last, after the cleanup ─────────
  let fact11
  if (!tCreated) {
    fact11 = unreadable(`${T} was never created`)
  } else if (leftBehind.includes(T)) {
    fact11 = unreadable(`${T} was not removed`)
  } else {
    const again = await send(`new --name ${T} --cpu 1 --memory 2GB`)
    if (again.code === null) {
      fact11 = unreadable(`new --name ${T} gave no answer`)
    } else if (again.code !== 0) {
      fact11 = holds(`new --name ${T} … failed (exit ${again.code}) — the name is reserved`)
    } else {
      // Unexpectedly succeeded: it made a VM, so it is counted in the cleanup.
      const rmAgain = await send(`rm ${T}`)
      if (rmAgain.code !== 0) leftBehind.push(T)
      fact11 = drift(`new --name ${T} … exited 0 — the name was not reserved`)
    }
  }

  // ── the FACT lines, in FACTS order, and the tally ─────────────────────────
  const byId = {
    'help-all-digest': fact1,
    'ls-json-shape': fact2,
    'billing-plan-json': fact3,
    'help-verb-flags': fact4,
    'error-on-stdout': fact5,
    'new-no-positionals': fact6,
    'comment-200-bytes': fact7,
    'share-port-single': fact8,
    'tag-add-remove': fact9,
    'cp-copies-tags': fact10,
    'rm-reserves-name': fact11,
    'refused-verbs': fact12,
  }

  const results = []
  let driftCount = 0
  let unreadableCount = 0
  for (const fact of FACTS) {
    const { verdict, read } = byId[fact.id]
    if (verdict === DRIFT) driftCount += 1
    else if (verdict === UNREADABLE) unreadableCount += 1
    const line = verdict === HOLDS
      ? `FACT ${fact.id}: holds — ${read} (lobby ${stamp}, ${date})`
      : `FACT ${fact.id}: ${verdict} — ${read}, recorded ${fact.says} (lobby ${stamp}, ${date})`
    log(line)
    results.push({ id: fact.id, verdict, read, line })
  }

  log(`PROBE: ${FACTS.length} facts, ${driftCount} drift, ${unreadableCount} unreadable`)

  let exit = (driftCount > 0 || unreadableCount > 0) ? 1 : 0
  if (leftBehind.length > 0) {
    for (const name of leftBehind) {
      log(`PROBE: ${name} left behind — rm ${name} answered non-zero`)
    }
    exit = 2
  }

  return { exit, stamp, results }
}

// ── The hand run ────────────────────────────────────────────────────────────
//
// Guarded exactly as `fleet/janitor.mjs` and `probe_kata_facts.mjs` guard
// their own: nothing below runs on an import, so an import issues no ssh and
// starts no process.

const main = async () => {
  const { exit } = await probeExeFacts({ exec: defaultExec })
  process.exit(exit)
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main()
}
