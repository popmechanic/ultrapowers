/**
 * fleet/tests/test_setup_script_evidence.mjs — the exam for the first-boot
 * setup script carrying the operator's evidence repository (#1395).
 *
 * The VM learns where its record lives from the setup script alone: the boot
 * reads `$FLEET_HOME/fleet-evidence-repo` (`FLEET_HOME` is `/home/exedev`, the
 * setup script's `$HOME`). Legs:
 *
 *   (g) [M7] `renderSetupScript({ run: '7', evidence: 'ops/evidence', ... })`
 *       carries exactly the line
 *       `printf '%s\n' 'ops/evidence' >"$HOME/fleet-evidence-repo"`, once, and
 *       is at most `SETUP_SCRIPT_BUDGET_BYTES` long; an `evidence` that is
 *       absent, or is not `<owner>/<repo>` (it lands inside a single-quoted
 *       shell literal), throws.
 */

import assert from 'node:assert/strict'

import { SETUP_SCRIPT_BUDGET_BYTES, readFleetFiles, renderSetupScript } from '../setup-script.mjs'

const LINE = `printf '%s\\n' 'ops/evidence' >"$HOME/fleet-evidence-repo"`

// (g) [M7] the line, byte for byte, within the budget
{
  const script = renderSetupScript({ run: '7', evidence: 'ops/evidence', ...readFleetFiles() })
  const lines = script.split('\n')
  assert.equal(lines.filter((l) => l === LINE).length, 1,
    `(g) [M7] the script carries the line ${JSON.stringify(LINE)} exactly once`)
  const bytes = Buffer.byteLength(script, 'utf8')
  assert.ok(bytes <= SETUP_SCRIPT_BUDGET_BYTES,
    `(g) [M7] the script is ${bytes} bytes, within the ${SETUP_SCRIPT_BUDGET_BYTES}-byte budget`)
  // The line sits beside the bootstrap and the unit, before the run starts.
  const at = lines.indexOf(LINE)
  const start = lines.findIndex((l) => l.startsWith('systemctl --user start'))
  assert.ok(at >= 0 && start > at, '(g) [M7] the evidence line is written before the run is started')

  const other = renderSetupScript({ run: '7', evidence: 'someone/else.repo', ...readFleetFiles() })
  assert.ok(other.split('\n').includes(`printf '%s\\n' 'someone/else.repo' >"$HOME/fleet-evidence-repo"`),
    '(g) [M7] the repository named is the one handed in')
}

// (g) [M7] absent or malformed: a throw, never a script
{
  const files = readFleetFiles()
  for (const evidence of [undefined, null, '', 'ops', 'ops/', '/evidence', 'ops/evidence/x',
    "ops/evi'dence", 'ops/evi dence', 'ops/$(id)', 'ops/..', 42]) {
    assert.throws(() => renderSetupScript({ run: '7', evidence, ...files }),
      /evidence/,
      `(g) [M7] evidence ${JSON.stringify(evidence)} is refused`)
  }
  assert.throws(() => renderSetupScript({ run: '7', ...files }), /evidence/,
    '(g) [M7] a render with no evidence key at all is refused')
}

console.log('ALL TESTS PASSED')
