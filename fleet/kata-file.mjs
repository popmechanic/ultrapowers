/**
 * Filing a run on the kata hub: the project, the run issue and one issue per
 * task, moved out of `fleet/launch.mjs` (#1277). `fileRunOnHub` is the one
 * export; the plan readers and the sandbox url are its own.
 */

import crypto from 'node:crypto'

import { Refusal, kataProjectFor } from './lobby.mjs'

/** The url the SANDBOX reaches the hub at — the `kata` http-proxy attached by
 *  `tag:fleet` — written into the record regardless of the laptop's own route,
 *  because the record's reader is the engine on the sandbox and never the
 *  laptop. */
const KATA_SANDBOX_URL = 'https://kata.int.exe.xyz'

/** The plan's H1: the text after `# ` on the first such line, `''` when none. */
const planTitleOf = (planText) => /^# (.*)$/m.exec(planText)?.[1]?.trim() ?? ''
/** The plan's `**Claim:**` line, whole — the run issue's body. `''` when none. */
const planClaimOf = (planText) =>
  planText.split('\n').find((line) => line.startsWith('**Claim:**'))?.trim() ?? ''
/**
 * The numbers of the plan's one `**Closes:**` line — the first such line
 * before the first `### ` heading, which is the line the sandbox's
 * `plan_closes` reads — as integers, `[]` when the plan has none.
 */
const planClosesOf = (planText) => {
  for (const line of planText.split('\n')) {
    if (line.startsWith('### ')) break
    if (!line.startsWith('**Closes:**')) continue
    return [...line.matchAll(/#(\d+)/g)].map((m) => Number(m[1]))
  }
  return []
}

/**
 * The 40 hex `git hash-object` prints for a text — computed in-process, so
 * nothing here has to exec git to learn the identity of a plan. A blob's sha1
 * is taken over the header `blob <byte length>\0` and then the bytes; the
 * length is the BYTE length, which is why `Buffer.byteLength` and not `.length`.
 *
 * It is the plan's identity in an `Idempotency-Key`: the same plan text is the
 * same sha is the same key is the same issue, and a plan whose text changed is
 * a new sha and a new set of issues.
 */
const planBlobSha = (text) => {
  const s = String(text ?? '')
  return crypto.createHash('sha1')
    .update('blob ' + Buffer.byteLength(s) + '\0')
    .update(s)
    .digest('hex')
}

/**
 * The run, filed on the hub for one run number: the tasks of the parse made
 * for `run-<n>` (`compilePlanForRun`), one project `<owner>-<repo>` —
 * the TARGET's, not this number's, so every run against one repository files
 * into one project and a name the hub already holds answers the project that is
 * there — one run issue carrying the plan's title, Claim line and Closes
 * numbers, one issue per task in wave order whose run and wave are PATCHED on
 * after the create and whose `parent` is the run issue, one `blocks` link per
 * dependency edge created ON the task that blocks, and then one `getIssue` per
 * task and one for the run — the revisions THOSE answer are the record's,
 * because nothing here assumes which side of a link kata re-revisions. The
 * answer is the `.ultrapowers/kata.json` object, keys in the order the contract
 * spells: `url`, `project`, `run`, `tasks`.
 *
 * FILING THE SAME PLAN TWICE FILES IT ONCE. Every create carries an
 * `Idempotency-Key` — `<target>:<plan sha>:task-<id>` for a task, `…:run-<n>`
 * for the run — and kata fingerprints that key together with the create's
 * fields, so the create body must be the same on every launch of one plan
 * text or the replay is a 409 `idempotency_mismatch`. That is why a task's
 * create carries only `{task, plan}` and no links: `run` and `wave`
 * move with the run number, and initial links are in the
 * fingerprint too. They arrive instead as the metadata patch and the `parent`
 * link that follow, which a second launch simply re-applies to the issue the
 * key answered. The patch reads the issue first because an idempotent replay
 * answers the ORIGINAL revision (the issue is already past it, linked), and a
 * stale `If-Match` is a 412; the metadata endpoint merges per key, so a patch
 * of `{run, wave}` leaves `{task, plan}` where they are. The
 * `parent` link carries `replace: true` because a second parent is otherwise a
 * 409 `parent_already_set` — a refiled task moves under the new run issue
 * rather than refusing. Hub behaviour measured against kata v0.17.2 on
 * 2026-09-14.
 *
 * A task row is `{uid, short_id, revision}`, in that order (#963). The
 * `short_id` is the create answer's — `MUTATION_KEYS` in `fleet/kata-client.mjs`
 * projects it, so the launcher already holds it here — and it is the ONLY place
 * it can come from: the dispatch `getIssue` the engine makes projects
 * `ISSUE_KEYS`, which has no `short_id`, so a row that does not carry one leaves
 * every worker of that task with no `KATA_REF` and no issue to write to. Hence
 * the refusal below rather than a row without it: a run whose workers cannot
 * name their issue is not a run this launcher files. The run's own row stays
 * `{uid, revision}` — no label resolves to it, so nothing reads a short id
 * there.
 *
 * Every hub call goes through `call`, which turns a throw into the launch's
 * LobbyError naming the method; the missing `short_id` is the launch's own
 * refusal. The sheets are `compiled` — the launch's one parse, handed in
 * rather than run again here; a bumped push files the same parse under the
 * number it got.
 */
async function fileRunOnHub ({ hub, call, planText, target, base, n, compiled }) {
  const stamp = `run-${n}`
  const waves = compiled?.waves ?? []
  const edges = compiled?.edges ?? []

  const planSha = planBlobSha(planText)
  const keyFor = (suffix) => `${target}:${planSha}:${suffix}`

  const name = kataProjectFor(target)
  const project = await call('createProject', () => hub.createProject(name))
  const runIssue = await call('createIssue', () => hub.createIssue(project.id, {
    title: `${stamp}: ${planTitleOf(planText)}`,
    body: planClaimOf(planText),
    metadata: { run: n, target, base, closes: planClosesOf(planText), plan: planSha },
    idempotencyKey: keyFor(`run-${n}`),
    // A relaunch of a plan the fleet already drove differs from that run's
    // open issue only by N in the title, and the hub's duplicate scorer refuses
    // it (#1008). Run numbers make the title distinct by construction, so the
    // create says so; the task creates below stay byte-identical, since theirs
    // is the body the idempotency key is fingerprinted with.
    forceNew: true
  }))
  const tasks = []
  for (const [index, wave] of waves.entries()) {
    for (const entry of wave) {
      const id = String(entry.id)
      const issue = await call('createIssue', () => hub.createIssue(project.id, {
        title: `task ${id}: ${entry.title ?? ''}`,
        body: '',
        metadata: { task: id, plan: planSha },
        idempotencyKey: keyFor(`task-${id}`)
      }))
      const shortId = issue?.short_id
      if (typeof shortId !== 'string' || shortId === '') {
        throw new Refusal(
          `launch: kata createIssue for task ${id} answered no short_id — ` +
          'the worker reference `<project>#<short id>` cannot be written and no ' +
          'record was filed'
        )
      }
      // This number's half of the issue, applied rather than created: read for
      // the revision the patch needs (a replay answers the create's, not the
      // issue's), merge the run's own metadata on, and move the parent.
      const read = await call('getIssue', () => hub.getIssue(issue.uid))
      await call('patchMetadata', () => hub.patchMetadata(project.id, issue.uid, {
        run: n, wave: index + 1
      }, read.revision))
      await call('link', () => hub.link(project.id, issue.uid, {
        type: 'parent', to_ref: runIssue.uid, replace: true
      }))
      tasks.push({ id, uid: issue.uid, shortId })
    }
  }
  const uidOf = new Map(tasks.map((t) => [t.id, t.uid]))
  for (const edge of edges) {
    const from = uidOf.get(String(edge.from))
    const to = uidOf.get(String(edge.to))
    if (!from || !to) {
      throw new Refusal(`launch: plan_parse.py for ${stamp} names an edge ${edge.from} -> ${edge.to} between tasks it did not list`)
    }
    await call('link', () => hub.link(project.id, from, { type: 'blocks', to_ref: to }))
  }
  const record = {
    url: KATA_SANDBOX_URL,
    project: { id: project.id, uid: project.uid, name: project.name },
    run: null,
    tasks: {}
  }
  for (const t of tasks) {
    const read = await call('getIssue', () => hub.getIssue(t.uid))
    record.tasks[t.id] = { uid: t.uid, short_id: t.shortId, revision: read.revision }
  }
  const readRun = await call('getIssue', () => hub.getIssue(runIssue.uid))
  record.run = { uid: runIssue.uid, revision: readRun.revision }
  return record
}

export { fileRunOnHub }
