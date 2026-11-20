/** The `$computed` functions a screen may call, passed to every JSONUIProvider.
 *
 * A row shows only its own cells, so a row that names another table's row (a
 * tag naming its todo) reads that row's text through `lookup`, and `format`
 * puts the pieces of a label together (#1524):
 *
 *   {$computed: 'format', args: {template: 'Remove ${name} from ${todoId.text}',
 *     name: {$item: 'name'},
 *     'todoId.text': {$computed: 'lookup', args: {rows: {$state: '/tables/todos'}, id: {$item: 'todoId'}, column: 'text'}}}}
 */
import type { ComputedFunction } from '@json-render/core'

const text = (v: unknown) => (v === undefined || v === null ? '' : String(v))

/** One cell of the row whose id is `id` in `rows` (a table as the screen state holds it), or ''. */
const lookup: ComputedFunction = ({ rows, id, column }) => {
  if (!Array.isArray(rows)) return ''
  const row = rows.find((r) => r && typeof r === 'object' && (r as Record<string, unknown>).id === id) as Record<string, unknown> | undefined
  return row ? text(row[String(column)]) : ''
}

/** `template` with each `${name}` replaced by the arg of that name. */
const format: ComputedFunction = ({ template, ...args }) =>
  text(template).replace(/\$\{([^}]+)\}/g, (_m, name: string) => text(args[name]))

/** The rows of `rows`, in order, whose every `where` cell equals theirs (a picker's options). */
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

export const functions: Record<string, ComputedFunction> = { lookup, format, rowsWhere }
