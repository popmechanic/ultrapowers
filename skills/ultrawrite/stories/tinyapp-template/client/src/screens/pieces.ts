/** Every piece's screen, read at build time.
 *
 * Imported as a Bun macro (`with {type: 'macro'}`): the bundler runs
 * pieceSpecs() and inlines what it answers, so the page carries each
 * client/src/pieces/<piece>.json as a json-render spec and no pieces index
 * is generated. Sorted by file name; `{}` when there is no pieces directory.
 * A spec is `{root, elements, state?}` plus an optional `"public": true`.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export function pieceSpecs(): Record<string, unknown> {
  const dir = join(import.meta.dir, '..', 'pieces')
  if (!existsSync(dir)) return {}
  const specs: Record<string, unknown> = {}
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    specs[file.slice(0, -'.json'.length)] = JSON.parse(readFileSync(join(dir, file), 'utf8'))
  }
  return specs
}
