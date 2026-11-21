import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export function screenSpec(): unknown {
  const file = join(import.meta.dir, '..', 'screen.json')
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
}

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
