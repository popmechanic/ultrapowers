/**
 * fleet/tests/test_kata_hub_fed.mjs — the exam for "The hub runs Kata 0.18 and
 * has a pass-through path for a spoke's own token" (derived; #983 / Kata
 * v0.18.0 release notes).
 *
 * This file is the Proof's `Test: fleet/tests/test_kata_hub_fed.mjs`. Every
 * relative import is written for THIS directory: `../` is the repository's
 * `fleet/`, `./` is `fleet/tests/`.
 *
 * The legs, each naming the Machine clause it comes from:
 *
 *   (a) [M1] `fleet/kata-hub-setup.sh`'s text carries `KATA_VERSION=0.18.0`,
 *       the `kata_0.18.0_linux_amd64.tar.gz` asset, the
 *       `releases/download/v0.18.0/` base, a `sha256sum -c` verification line,
 *       and no occurrence of `0.17` anywhere in the file.
 *   (b) [M2] `FED_INTEGRATION` is `kata-sync`; `fedAddVerb(url)` and
 *       `fedAddVerbAttach(url)` equal the clause's strings EXACTLY (the
 *       attach twin swapping `--attach tag:fleet` in for `--policy
 *       'tag:fleet'`); neither string carries `--bearer`, `--header` or
 *       `--no-auth`.
 *   (c) [M3] driving `kataHub()` with a fake `exec` whose lobby integrations
 *       listing names only `kata` issues `fedAddVerb`'s string exactly once;
 *       the same build with a listing naming `kata` AND `kata-sync` issues it
 *       zero times; and `renderHubSetupScript` over the repository's own
 *       template and unit stays within `HUB_SETUP_BUDGET_BYTES`.
 *
 * The build in (c) is driven far enough to complete — the hub's VM row and
 * its `kata` integration are already in place (so no `new`/`share port`/`kata`
 * add verb is needed), and the fake exec answers every VM-side ssh command it
 * issues — because the Machine clause is about what the FULL build issues,
 * not about a narrower seam. Nothing here spawns a real process; the fake
 * `exec` never runs `ssh`, `gh` or `curl`, matching `_lobby_helpers.mjs`'s own
 * rule.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  FED_INTEGRATION,
  HUB_INTEGRATION,
  HUB_SETUP_BUDGET_BYTES,
  HUB_VM,
  fedAddVerb,
  fedAddVerbAttach,
  kataHub,
  readHubFiles,
  renderHubSetupScript
} from '../kata-hub.mjs'
import { answer, cleanup, makeExec, sshRule, tempDir, vmRow, vmsPayload } from './_lobby_helpers.mjs'

const FLEET_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// ── (a) [M1] the setup script's version, as text ────────────────────────────
{
  const text = fs.readFileSync(path.join(FLEET_DIR, 'kata-hub-setup.sh'), 'utf8')
  assert.ok(text.includes('KATA_VERSION=0.18.0'), '(a) [M1] KATA_VERSION=0.18.0 is a literal in the script')
  assert.ok(text.includes('kata_0.18.0_linux_amd64.tar.gz'), '(a) [M1] the asset names 0.18.0')
  assert.ok(text.includes('releases/download/v0.18.0/'), '(a) [M1] the base URL names v0.18.0')
  assert.ok(/sha256sum -c/.test(text), '(a) [M1] the asset is verified with a sha256sum -c line')
  assert.ok(!text.includes('0.17'), '(a) [M1] no occurrence of 0.17 remains in the script')
}

// ── (b) [M2] the fed integration's name and its two verbs ──────────────────
{
  const URL = 'https://h.example'
  const COMMENT = "kata hub federation transport — passes Authorization through"
  const expectedPolicy =
    `integrations add http-proxy --name kata-sync --target ${URL} --peer ` +
    `--comment '${COMMENT}' --policy 'tag:fleet'`
  const expectedAttach =
    `integrations add http-proxy --name kata-sync --target ${URL} --peer ` +
    `--comment '${COMMENT}' --attach tag:fleet`

  assert.equal(FED_INTEGRATION, 'kata-sync', '(b) [M2] FED_INTEGRATION is kata-sync')
  assert.equal(fedAddVerb(URL), expectedPolicy, '(b) [M2] fedAddVerb answers the clause\'s string exactly')
  assert.equal(
    fedAddVerbAttach(URL), expectedAttach,
    '(b) [M2] fedAddVerbAttach swaps --attach tag:fleet in for --policy \'tag:fleet\''
  )
  for (const [label, verb] of [['fedAddVerb', fedAddVerb(URL)], ['fedAddVerbAttach', fedAddVerbAttach(URL)]]) {
    for (const forbidden of ['--bearer', '--header', '--no-auth']) {
      assert.ok(!verb.includes(forbidden), `(b) [M2] ${label} carries no ${forbidden}`)
    }
  }
}

// ── (c) [M3] the build issues fedAddVerb once, or not at all ───────────────

const HUB_URL = 'https://kata-hub-vm.exe.xyz'

/** `kata`, and `kata-sync` too when `fedListed` — the lobby's own listing. */
const integrationsListing = (fedListed) => answer([
  { name: HUB_INTEGRATION, attachments: [] },
  ...(fedListed ? [{ name: FED_INTEGRATION, attachments: [] }] : [])
])

/**
 * Every VM-side ssh command (`onVm` in kata-hub.mjs) answers success, so the
 * build's two waits resolve on their first poll — except `is-active`, which
 * must answer `active` for the second wait to resolve at all.
 */
const vmSideRule = () => ({
  when: (cmd, argv) => cmd === 'ssh' && argv[1] === 'BatchMode=yes',
  answer: (cmd, argv) => {
    const command = String(argv[5] ?? '')
    return command === 'systemctl is-active kata.service' ? answer('active\n') : answer('')
  }
})

/**
 * Drive one full `kataHub()` build. The hub's VM and its `kata` integration
 * already exist, so the build skips straight past `new`/`share port`/`kata`'s
 * own add verb and reaches whatever checks the `kata-sync` listing.
 */
async function driveBuild ({ fedListed }) {
  const home = tempDir('fleet-kata-hub-fed-')
  const rows = [vmRow(HUB_VM, { https_url: HUB_URL })]
  const exec = makeExec({
    rules: [
      sshRule('integrations list --json', integrationsListing(fedListed)),
      sshRule(`ls ${HUB_VM} --json`, vmsPayload(rows)),
      vmSideRule()
    ]
  })
  await kataHub({ exec, sleep: async () => {}, home, env: {} })
  cleanup(home)
  return exec
}

{
  const fedVerb = fedAddVerb(HUB_URL)

  const noFed = await driveBuild({ fedListed: false })
  const issuedNoFed = noFed.lobby().filter((line) => line === fedVerb)
  assert.equal(
    issuedNoFed.length, 1,
    `(c) [M3] fedAddVerb's verb is issued exactly once when kata-sync is absent from the listing, ` +
    `got ${issuedNoFed.length} among:\n${noFed.lobby().join('\n')}`
  )

  const withFed = await driveBuild({ fedListed: true })
  const issuedWithFed = withFed.lobby().filter((line) => line === fedVerb)
  assert.equal(
    issuedWithFed.length, 0,
    `(c) [M3] and not at all once kata-sync is already listed, ` +
    `got ${issuedWithFed.length} among:\n${withFed.lobby().join('\n')}`
  )
}

// ── (c) [M3] the rendered script stays inside the fleet's own budget ───────
{
  const rendered = renderHubSetupScript(readHubFiles())
  const bytes = Buffer.byteLength(rendered, 'utf8')
  assert.ok(
    bytes <= HUB_SETUP_BUDGET_BYTES,
    `(c) [M3] the rendered hub setup script is ${bytes} bytes; the budget is ${HUB_SETUP_BUDGET_BYTES}`
  )
}

console.log('ALL TESTS PASSED')
