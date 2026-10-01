/** The screens catalog: which 1st-Pouf pieces a screen may name, and their props.
 *
 * A screen is a json-render spec over this catalog. Its props mirror each
 * 1st-Pouf component's own variant props, so the registry hands them straight
 * through and `tsc` refuses a value 1st-Pouf would not accept.
 *
 * This file imports no React and no 1st-Pouf, so it loads in Bun with no DOM.
 */
import { defineCatalog } from '@json-render/core'
import { schema } from '@json-render/react/schema'
import { z } from 'zod'

const tone = z.enum(['pink', 'purple', 'blue', 'mint', 'yellow', 'orange', 'up', 'down', 'warn', 'info', 'idle'])
const gap = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)])

export const components = {
  Stack: {
    props: z.object({ gap: gap.nullish() }),
    slots: ['default'],
    description: 'A vertical stack of children.',
  },
  Row: {
    props: z.object({
      gap: gap.nullish(),
      align: z.enum(['center', 'top']).nullish(),
      justify: z.enum(['start', 'center', 'between', 'end']).nullish(),
      wrap: z.boolean().nullish(),
    }),
    slots: ['default'],
    description: 'A horizontal row of children.',
  },
  Grid: {
    props: z.object({
      cols: z.union([z.literal(2), z.literal(3), z.literal(4), z.literal('sidebar')]).nullish(),
      gap: gap.nullish(),
    }),
    slots: ['default'],
    description: 'A grid of children; one column on narrow screens.',
  },
  Card: {
    props: z.object({
      variant: z.enum(['default', 'flush', 'tight']).nullish(),
      motion: z.enum(['none', 'lift', 'tilt-left', 'tilt-right']).nullish(),
    }),
    slots: ['default'],
    description: 'A puffy surface holding its children.',
  },
  Heading: {
    props: z.object({
      text: z.string(),
      level: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullish(),
    }),
    slots: [],
    description: 'A heading, level 1 to 3.',
  },
  Eyebrow: {
    props: z.object({ text: z.string() }),
    slots: [],
    description: 'A small uppercase label above a section.',
  },
  Text: {
    props: z.object({
      text: z.string(),
      size: z.enum(['sm', 'md']).nullish(),
      muted: z.boolean().nullish(),
      num: z.boolean().nullish(),
      mono: z.boolean().nullish(),
      truncate: z.boolean().nullish(),
    }),
    slots: [],
    description: 'A run of body text.',
  },
  Badge: {
    props: z.object({ text: z.string(), tone: tone.nullish() }),
    slots: [],
    description: 'A small toned pill label.',
  },
  Empty: {
    props: z.object({ title: z.string(), text: z.string().nullish() }),
    slots: [],
    description: 'What a list shows when it has nothing in it.',
  },
  Separator: {
    props: z.object({}),
    slots: [],
    description: 'A thin horizontal rule.',
  },
  ActionButton: {
    props: z.object({
      label: z.string(),
      name: z.string().nullish(),
      action: z.string(),
      args: z.record(z.string(), z.unknown()).nullish(),
      tone: tone.nullish(),
      variant: z.enum(['solid', 'quiet']).nullish(),
      size: z.enum(['sm', 'md', 'lg']).nullish(),
    }),
    slots: [],
    description:
      'A button that runs the app action `action` with `args`; only when it succeeds does it emit "press". `name` is its accessible name when the label alone is not enough.',
  },
  ActionCheckbox: {
    props: z.object({
      label: z.string(),
      checked: z.boolean().nullish(),
      action: z.string(),
      args: z.record(z.string(), z.unknown()).nullish(),
    }),
    slots: [],
    description:
      'A checkbox showing `checked`; toggling it runs the app action `action` with `args`, and only when it succeeds does it emit "change".',
  },
  DraftInput: {
    props: z.object({
      label: z.string(),
      value: z.string().nullish(),
      placeholder: z.string().nullish(),
    }),
    slots: [],
    description: 'A text input whose `value` is bound with $bindState to a path under /draft/.',
  },
}

/** json-render's built-in actions; a screen may use them to write under /draft/ only. */
export const BUILT_IN = ['setState', 'pushState', 'removeState', 'validateForm']

/** The catalog for a store whose actions are `tools`, in their order. */
export function catalogFor(tools: { name: string; description: string }[]) {
  const actions: Record<string, { params: z.ZodType; description: string }> = {}
  for (const t of tools) actions[t.name] = { params: z.record(z.string(), z.unknown()), description: t.description }
  return defineCatalog(schema, { components, actions })
}

/** The catalog with no actions, which the registry draws. */
export const baseCatalog = defineCatalog(schema, { components, actions: {} })
