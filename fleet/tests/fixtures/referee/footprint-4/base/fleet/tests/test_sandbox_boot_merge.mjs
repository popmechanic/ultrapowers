import assert from 'node:assert/strict'
import fs from 'node:fs'

const src = fs.readFileSync(new URL('../sandbox-boot.sh', import.meta.url), 'utf8')
assert.ok(src.includes('set -euo pipefail'), 'the script is strict')
assert.ok(src.includes('main "$@"'), 'the script calls main')
