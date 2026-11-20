/** The page's screens, read at build time.
 *
 * Imported as Bun macros (`with {type: 'macro'}`): the bundler runs them and
 * inlines what they answer.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** The page's screen: client/src/screen.json
 * (`{root, elements, public?}`), or null when the app has none. An app built
 * before the one-screen page has no screen.json and keeps its per-piece specs,
 * which pieceSpecs() reads.
 */
export function screenSpec(): unknown {
  const file = join(import.meta.dir, '..', 'screen.json')
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
}

/** Every piece's screen, for an app with no screen.json: the page carries
 * each client/src/pieces/<piece>.json as a json-render spec and no pieces
 * index is generated. In the order client/src/screens/order.json names (the build order,
 * written by scaffold and compile), then any other piece by file name; `{}` when
 * there is no pieces directory.
 * A spec is `{root, elements, state?}` plus an optional `"public": true`.
 */
export function pieceSpecs(): Record<string, unknown> {
  const dir = join(import.meta.dir, '..', 'pieces')
  if (!existsSync(dir)) return {}
  const names = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -'.json'.length)).sort()
  const orderFile = join(import.meta.dir, 'order.json')
  const order: unknown = existsSync(orderFile) ? JSON.parse(readFileSync(orderFile, 'utf8')).pieces : []
  const first = Array.isArray(order) ? order.map(String).filter((n) => names.includes(n)) : []
  const specs: Record<string, unknown> = {}
  for (const name of [...first, ...names.filter((n) => !first.includes(n))]) {
    specs[name] = JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8'))
  }
  return specs
}
