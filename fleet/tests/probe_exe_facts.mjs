import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { EXE_HOST, defaultExec, parseJson } from '../lobby.mjs'

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
    says: 'exe.dev does not reserve a deleted VM\'s name: a new VM may take it' },
  { id: 'refused-verbs',
    says: 'integrations attach and detach are the grant verbs and there is no integrations policy verb: help integrations lists attach and detach and no policy (#1434; the earlier reading attached a nonexistent name, which fails whatever the model)' },
])

const two = (n) => String(n).padStart(2, '0')

const runStampOf = (now) => {
  const d = now instanceof Date ? now : new Date(now)
  return `${d.getUTCFullYear()}${two(d.getUTCMonth() + 1)}${two(d.getUTCDate())}${two(d.getUTCHours())}${two(d.getUTCMinutes())}`
}

const dateOf = (now) => (now instanceof Date ? now : new Date(now)).toISOString().slice(0, 10)

const sha16 = (text) => createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex').slice(0, 16)

const FLAG_LINE = /^[ \t]+(--[A-Za-z0-9-]+)/gm

const helpFlags = (stdout) => {
  const flags = []
  for (const match of String(stdout ?? '').matchAll(FLAG_LINE)) {
    if (!flags.includes(match[1])) flags.push(match[1])
  }
  return flags
}

export const probeExeFacts = async ({ exec, log = console.log, now = new Date() } = {}) => {
  const date = dateOf(now)
  const runStamp = runStampOf(now)
  const T = `probe-exe-facts-${runStamp}`

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

  const copy1 = `${T}-copy1`
  const copy2 = `${T}-copy2`
  let copy1Created = false
  let copy2Created = false
  let fact10
  if (!tCreated) {
    fact10 = unreadable(`${T} was never created`)
  } else {
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

  const intHelp = await send('help integrations')
  const verbs = new Set([...String(intHelp.stdout ?? '').matchAll(/^\s+([a-z-]+)\s+-\s/gm)].map((m) => m[1]))
  const fact12 = intHelp.code !== 0
    ? unreadable(`help integrations exited ${intHelp.code ?? 'none'}`)
    : verbs.has('attach') && verbs.has('detach') && !verbs.has('policy')
      ? holds(`help integrations lists attach and detach and no policy`)
      : drift(`help integrations lists ${JSON.stringify([...verbs])}`)

  const toRemove = []
  if (copy1Created) toRemove.push(copy1)
  if (copy2Created) toRemove.push(copy2)
  if (tCreated) toRemove.push(T)

  const leftBehind = []
  for (const name of toRemove) {
    const rm = await send(`rm ${name}`)
    if (rm.code !== 0) leftBehind.push(name)
  }

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
      fact11 = drift(`new --name ${T} … failed (exit ${again.code}) — the name is reserved`)
    } else {
      const rmAgain = await send(`rm ${T}`)
      if (rmAgain.code !== 0) leftBehind.push(T)
      fact11 = holds(`new --name ${T} … exited 0 — the name was not reserved`)
    }
  }

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

const main = async () => {
  const { exit } = await probeExeFacts({ exec: defaultExec })
  process.exit(exit)
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main()
}
