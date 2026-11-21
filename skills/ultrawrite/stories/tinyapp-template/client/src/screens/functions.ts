import type { ComputedFunction } from '@json-render/core'

const text = (v: unknown) => (v === undefined || v === null ? '' : String(v))

const lookup: ComputedFunction = ({ rows, id, column }) => {
  if (!Array.isArray(rows)) return ''
  const row = rows.find((r) => r && typeof r === 'object' && (r as Record<string, unknown>).id === id) as Record<string, unknown> | undefined
  return row ? text(row[String(column)]) : ''
}

const format: ComputedFunction = ({ template, ...args }) =>
  text(template).replace(/\$\{([^}]+)\}/g, (_m, name: string) => text(args[name]))

const rowsWhere: ComputedFunction = ({ rows, where }) => {
  if (!Array.isArray(rows)) return []
  const want = where && typeof where === 'object' ? (where as Record<string, unknown>) : {}
  return rows.filter(
    (r) =>
      r &&
      typeof r === 'object' &&
      Object.keys(want).every((k) => String((r as Record<string, unknown>)[k] ?? '') === String(want[k])),
  )
}

const sum: ComputedFunction = ({ rows, column }) => {
  if (!Array.isArray(rows)) return 0
  let total = 0
  for (const r of rows) {
    const cell = r && typeof r === 'object' ? (r as Record<string, unknown>)[String(column)] : undefined
    const n = text(cell).trim() === '' ? NaN : Number(cell)
    if (Number.isFinite(n)) total += n
  }
  return total
}

const count: ComputedFunction = (args) => (rowsWhere(args) as unknown[]).length

const words: ComputedFunction = ({ value, words: said }) => {
  const key = text(value)
  const table = said && typeof said === 'object' ? (said as Record<string, unknown>) : {}
  return Object.prototype.hasOwnProperty.call(table, key) ? text(table[key]) : key
}

export const functions: Record<string, ComputedFunction> = { lookup, format, rowsWhere, sum, count, words }
