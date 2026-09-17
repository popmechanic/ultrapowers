/**
 * fleet/tests/test_setup_script.mjs — the exam for "The sandbox installs celld
 * 0.5.0 by digest, and the run's services raise the file limit" (#1094).
 *
 * This file is the Proof's `Test: fleet/tests/test_setup_script.mjs`, written
 * where the Proof names it, and its `Guard:` as well — it stays at this path.
 * Every relative read is written for THIS directory: `../` is the repository's
 * `fleet/`, so the documents and the two shell files are read from beside this
 * file's own location. The exam spawns nothing and opens no socket; it imports
 * the module and reads text, and prints `ALL TESTS PASSED` on its last line,
 * which is what `tests/test_fleet_suite.py` reads.
 *
 * The Machine clauses under test, restated:
 *
 *   M1 — `fleet/setup-script.mjs` exports `CELLD_VERSION` equal to `0.5.0` and
 *        `CELLD_SHA256` equal to
 *        `1039eee3737bb432ca0cd399fc55cc0aab4e653b2beae26009e455fea4e5334c`,
 *        and what `renderSetupScript({ run, bootstrap, unit })` returns carries,
 *        in this order and each on its own line: `status booting "setup: celld"`,
 *        a `curl -fsSL` line whose URL is
 *        `https://github.com/denoland/celld/releases/download/v0.5.0/celld-x86_64-unknown-linux-gnu.gz`,
 *        a line that pipes `<CELLD_SHA256>  <asset>` into `sha256sum -c -`, a
 *        `gzip -dc` line, and
 *        `sudo -n install -m 0755 celld /usr/local/bin/celld` — the whole stanza
 *        after the line `status booting "setup: kata"` and before the line
 *        `status booting "setup: fleet files"`; and no line of the script runs
 *        `install.sh`, `gh attestation`, or writes under `/usr/local/lib/fleet`
 *        for celld.
 *   M2 — `renderSetupScript({ run: '1', ...readFleetFiles() })` returns without
 *        throwing and the UTF-8 byte length of what it returns is at most
 *        `SETUP_SCRIPT_BUDGET_BYTES`, which is still `9216`.
 *   M3 — `fleet/fleet-run@.service` carries the line `LimitNOFILE=524288` in its
 *        `[Service]` section, and `fleet/sandbox-boot.sh`'s engine
 *        `fleet_systemd_run` invocation — the one whose unit is
 *        `fleet-engine-$RUN_N` — carries `-p LimitNOFILE=524288` beside its
 *        `-p MemoryMax=40G`.
 *   M4 — `fleet/CONTRACT.md`'s setup-script bullet lists celld 0.5.0 among the
 *        toolchain it installs, with the words `sha256sum -c` and
 *        `/usr/local/bin/celld`, and its engine `systemd-run` line carries
 *        `-p LimitNOFILE=524288`; `fleet/RUNBOOK.md`'s `## Traps` section
 *        carries a `**The sandbox's runtime.**` group whose bullets say that
 *        celld's memory thresholds read root cgroup paths an exe VM does not
 *        have, so `CELLD_MAX_RSS_MB` is set per instance, that `celld dev` binds
 *        a second, internal listener so a task passes
 *        `--internal-listen 127.0.0.1:<port>`, and that teardown is SIGTERM then
 *        a wait for the port because a hard kill holds it.
 *
 * The Proof legs, in the Proof's own order, and where each is answered below:
 *
 *   (a) [M1] `CELLD_VERSION` is exactly `0.5.0` and `CELLD_SHA256` is exactly
 *            the 64-hex digest above; the rendered script for run `1` contains
 *            each of the five stanza lines of M1 as whole lines, their indices
 *            strictly increasing, the first of them after the index of
 *            `status booting "setup: kata"` and the last before the index of
 *            `status booting "setup: fleet files"`; and the script has no line
 *            containing `install.sh`, no line containing `gh attestation`, and
 *            no line that both contains `celld` and contains
 *            `/usr/local/lib/fleet`
 *   (b) [M2] `renderSetupScript({ run: '1', ...readFleetFiles() })` returns a
 *            string, `Buffer.byteLength(script, 'utf8')` is at most
 *            `SETUP_SCRIPT_BUDGET_BYTES`, and `SETUP_SCRIPT_BUDGET_BYTES` is
 *            `9216`; and a render with a `unit` padded by 9216 bytes of comment
 *            throws with a message naming the budget, which is what fails when
 *            the stanza grows past it
 *   (c) [M3] the text of `fleet/fleet-run@.service` has the line
 *            `LimitNOFILE=524288` after its `[Service]` line, and the text of
 *            `fleet/sandbox-boot.sh`, from the line containing
 *            `--unit=fleet-engine-$RUN_N` to the next line containing
 *            `run-main.mjs`, joined with spaces, contains both
 *            `-p MemoryMax=40G` and `-p LimitNOFILE=524288`; a copy of the unit
 *            text with that line removed makes the same check fail
 *   (d) [M4] the first three `Run:` lines of the Proof, re-encoded here as reads
 *            of the same two documents: the contract's setup-script bullet, read
 *            from its own heading to the bootstrap bullet, names `celld 0.5.0`,
 *            `sha256sum -c` and `/usr/local/bin/celld` in that order; the
 *            contract's engine line carries `-p LimitNOFILE=524288` directly
 *            after `-p MemorySwapMax=0`; and the runbook's Traps section, from
 *            `## Traps` to `## Capacity`, carries the `The sandbox's runtime.`
 *            label followed by `CELLD_MAX_RSS_MB`,
 *            `--internal-listen 127.0.0.1:<port>` and `SIGTERM` in that order
 *
 * Two readings worth writing down, because a later session would otherwise have
 * to reconstruct them:
 *
 *   — M1 spells the third stanza line as `<CELLD_SHA256>  <asset>` piped into
 *     `sha256sum -c -`. The digest is what is pinned (the Context: it is a
 *     literal in the script, verified once on the laptop at each bump, because
 *     the release carries no sums file and `gh attestation` needs a token the
 *     sandbox does not hold); `<asset>` is a placeholder for whatever local name
 *     the download lands under, so the check below holds the digest and the pipe
 *     and leaves the asset token free.
 *   — leg (b) pins the pad at 9216 bytes of comment AND the thrown message at
 *     the budget. A pad that size carries the render past the platform's 10240
 *     ceiling as well, so the assertion holds the BUDGET's guard to being the
 *     one that answers — the message names `9216`, not the ceiling.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  CELLD_SHA256,
  CELLD_VERSION,
  SETUP_SCRIPT_BUDGET_BYTES,
  readFleetFiles,
  renderSetupScript,
} from '../setup-script.mjs'

/** `fleet/`, read from this file's own location and never from the cwd. */
const FLEET_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const readFleet = (name) => fs.readFileSync(path.join(FLEET_DIR, name), 'utf8')

/** The task's own words, as constants, so every check below reads against them. */
const VERSION = '0.5.0'
const DIGEST = '1039eee3737bb432ca0cd399fc55cc0aab4e653b2beae26009e455fea4e5334c'
const ASSET_URL =
  `https://github.com/denoland/celld/releases/download/v${VERSION}/celld-x86_64-unknown-linux-gnu.gz`
const OPEN_LINE = 'status booting "setup: celld"'
const INSTALL_LINE = 'sudo -n install -m 0755 celld /usr/local/bin/celld'
const KATA_LINE = 'status booting "setup: kata"'
const FILES_LINE = 'status booting "setup: fleet files"'
const BUDGET = 9216
const LIMIT_LINE = 'LimitNOFILE=524288'

// ── a. [M1] the two constants, the stanza, and what the script must not do ──
{
  assert.equal(CELLD_VERSION, VERSION, '(a) [M1] CELLD_VERSION is exactly 0.5.0')
  assert.equal(CELLD_SHA256, DIGEST, '(a) [M1] CELLD_SHA256 is exactly the laptop\'s 64-hex digest')

  const script = renderSetupScript({ run: '1', ...readFleetFiles() })
  const lines = script.split('\n')
  const at = (what, pred) => {
    const i = lines.findIndex(pred)
    assert.ok(i >= 0, `(a) [M1] the rendered script carries ${what} on a line of its own`)
    return i
  }

  // The five stanza lines. The first and the last are whole lines, verbatim; the
  // three between are the lines M1 describes by what they run — the exact URL,
  // the exact digest piped into `sha256sum -c -`, and `gzip -dc`.
  const open = at(`the line \`${OPEN_LINE}\``, (l) => l.trim() === OPEN_LINE)
  const curl = at(
    `a \`curl -fsSL\` line whose URL is ${ASSET_URL}`,
    (l) => l.includes('curl -fsSL') && l.includes(ASSET_URL)
  )
  const sums = at(
    'a line piping `<CELLD_SHA256>  <asset>` into `sha256sum -c -`',
    (l) => new RegExp(`${DIGEST}\\s+\\S+[^|]*\\|\\s*sha256sum -c -`).test(l)
  )
  const gunzip = at('a `gzip -dc` line', (l) => l.includes('gzip -dc'))
  const install = at(`the line \`${INSTALL_LINE}\``, (l) => l.trim() === INSTALL_LINE)

  assert.ok(open < curl, '(a) [M1] the `setup: celld` status line comes before the curl line')
  assert.ok(curl < sums, '(a) [M1] the curl line comes before the `sha256sum -c -` line')
  assert.ok(sums < gunzip, '(a) [M1] the sums line comes before the `gzip -dc` line')
  assert.ok(gunzip < install, '(a) [M1] the `gzip -dc` line comes before the install line')

  const kata = at(`the line \`${KATA_LINE}\``, (l) => l.trim() === KATA_LINE)
  const files = at(`the line \`${FILES_LINE}\``, (l) => l.trim() === FILES_LINE)
  assert.ok(kata < open, '(a) [M1] the whole stanza comes after `status booting "setup: kata"`')
  assert.ok(
    install < files,
    '(a) [M1] the whole stanza comes before `status booting "setup: fleet files"`'
  )

  const carrying = (pred) => lines.filter(pred)
  assert.deepEqual(
    carrying((l) => l.includes('install.sh')), [],
    '(a) [M1] no line of the script runs `install.sh` — its rollback symlinks are worthless on a one-run VM'
  )
  assert.deepEqual(
    carrying((l) => l.includes('gh attestation')), [],
    '(a) [M1] no line of the script runs `gh attestation` — the sandbox holds no token'
  )
  assert.deepEqual(
    carrying((l) => l.includes('celld') && l.includes('/usr/local/lib/fleet')), [],
    '(a) [M1] no line writes celld under `/usr/local/lib/fleet` — that path is the immutable bootstrap'
  )
}

// ── b. [M2] the render still fits the fleet's own budget ────────────────────
{
  assert.equal(SETUP_SCRIPT_BUDGET_BYTES, BUDGET, '(b) [M2] the budget is still 9216 bytes')

  const files = readFleetFiles()
  const script = renderSetupScript({ run: '1', ...files })
  assert.equal(typeof script, 'string', '(b) [M2] the render for run 1 returns a string')
  const bytes = Buffer.byteLength(script, 'utf8')
  assert.ok(
    bytes <= SETUP_SCRIPT_BUDGET_BYTES,
    `(b) [M2] the render for run 1 is ${bytes} UTF-8 bytes, at most the budget's ${BUDGET}`
  )

  // The control: the guard the stanza would trip if it grew. A unit padded by a
  // budget's worth of comment cannot render, and the refusal names the budget.
  const padded = { ...files, unit: `${files.unit}\n${'#'.repeat(BUDGET)}\n` }
  let thrown = null
  try {
    renderSetupScript({ run: '1', ...padded })
  } catch (err) {
    thrown = err
  }
  assert.ok(thrown, '(b) [M2] a unit padded by 9216 bytes of comment cannot be rendered')
  assert.ok(
    String(thrown.message).includes(String(BUDGET)),
    `(b) [M2] the refusal names the budget, got: ${thrown.message}`
  )
}

// ── c. [M3] the unit and the engine's transient unit raise RLIMIT_NOFILE ────
{
  // The same predicate the leg names, so the negative control below runs it
  // against a copy of the unit text rather than against a second reading of it.
  const unitRaisesLimit = (text) => {
    const lines = text.split('\n')
    const service = lines.findIndex((l) => l.trim() === '[Service]')
    if (service < 0) return false
    return lines.slice(service + 1).some((l) => l.trim() === LIMIT_LINE)
  }

  const unit = readFleet('fleet-run@.service')
  assert.ok(
    unitRaisesLimit(unit),
    `(c) [M3] fleet-run@.service carries \`${LIMIT_LINE}\` after its [Service] line`
  )
  const withoutLine = unit.split('\n').filter((l) => l.trim() !== LIMIT_LINE).join('\n')
  assert.equal(
    unitRaisesLimit(withoutLine), false,
    '(c) [M3] the same check fails on a copy of the unit with that line removed'
  )

  const boot = readFleet('sandbox-boot.sh').split('\n')
  const start = boot.findIndex((l) => l.includes('--unit=fleet-engine-$RUN_N'))
  assert.ok(start >= 0, '(c) [M3] sandbox-boot.sh carries the engine `--unit=fleet-engine-$RUN_N`')
  const end = boot.findIndex((l, i) => i > start && l.includes('run-main.mjs'))
  assert.ok(end > start, '(c) [M3] that invocation reaches a `run-main.mjs` line')
  const invocation = boot.slice(start, end + 1).join(' ')
  assert.ok(
    invocation.includes('-p MemoryMax=40G'),
    '(c) [M3] the engine invocation still carries `-p MemoryMax=40G`'
  )
  assert.ok(
    invocation.includes(`-p ${LIMIT_LINE}`),
    `(c) [M3] the engine invocation carries \`-p ${LIMIT_LINE}\` beside it`
  )
}

// ── d. [M4] the contract and the runbook say so ─────────────────────────────
{
  /** The `sed -n '/from/,/to/p' … | tr '\n' ' '` of the Proof's `Run:` lines. */
  const section = (text, from, to) => {
    const lines = text.split('\n')
    const start = lines.findIndex((l) => from.test(l))
    if (start < 0) return ''
    const rest = lines.slice(start + 1)
    const end = rest.findIndex((l) => to.test(l))
    return (end < 0 ? lines.slice(start) : lines.slice(start, start + 1 + end + 1)).join(' ')
  }

  const contract = readFleet('CONTRACT.md')
  const setupBullet = section(contract, /^- \*\*Setup script \(generated by/, /^- \*\*Bootstrap/)
  assert.ok(
    /celld 0\.5\.0.*sha256sum -c.*\/usr\/local\/bin\/celld/.test(setupBullet),
    "(d) [M4] the contract's setup-script bullet names `celld 0.5.0`, then `sha256sum -c`, then `/usr/local/bin/celld`"
  )

  const engineLine =
    'unit=fleet-engine-<N> --pipe --wait --collect -p MemoryMax=40G -p MemorySwapMax=0 -p LimitNOFILE=524288'
  assert.ok(
    contract.includes(engineLine),
    `(d) [M4] the contract's engine line reads \`${engineLine}\``
  )

  const runbook = readFleet('RUNBOOK.md')
  const traps = section(runbook, /^## Traps/, /^## Capacity/)
  assert.ok(
    /The sandbox's runtime\..*CELLD_MAX_RSS_MB.*--internal-listen 127\.0\.0\.1:<port>.*SIGTERM/.test(traps),
    "(d) [M4] the runbook's Traps section carries `The sandbox's runtime.` and then, in order, `CELLD_MAX_RSS_MB`, `--internal-listen 127.0.0.1:<port>` and `SIGTERM`"
  )
}

console.log('ALL TESTS PASSED')
