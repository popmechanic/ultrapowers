/** Draws each catalog entry with the 1st-Pouf component it is named for.
 *
 * ActionButton, ActionCheckbox and ActionSelect run their card action through the page's
 * handler (`useActions().handlers[action]`, which answers true or false) and
 * emit only on true, so a spec's `on` draft writes run after the action
 * succeeded. Actions take `args` rather than an `on` binding because inside
 * action params json-render 0.21.0 resolves `$item` to a state path, while
 * inside props it resolves to the item's value.
 */
import { defineRegistry, useActions, useBoundProp } from '@json-render/react'
import { useState } from 'react'
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Empty,
  Eyebrow,
  Field,
  Grid,
  Heading,
  Input,
  Row,
  Select,
  Separator,
  Stack,
  Text,
} from '../pouf'
import { baseCatalog } from './catalog'
import { asExample } from './example'

const u = <T,>(v: T | null | undefined): T | undefined => v ?? undefined

function useRun(action: string, args: Record<string, unknown> | null | undefined) {
  const { handlers } = useActions()
  const [busy, setBusy] = useState(false)
  const run = async (more: Record<string, unknown> = {}): Promise<boolean> => {
    const handler = handlers[action]
    if (!handler) return false
    setBusy(true)
    try {
      return (await handler({ ...(args ?? {}), ...more })) === true
    } finally {
      setBusy(false)
    }
  }
  return { run, busy }
}

export const { registry } = defineRegistry(baseCatalog, {
  components: {
    Stack: ({ props, children }) => <Stack gap={u(props.gap)}>{children}</Stack>,
    Row: ({ props, children }) => (
      <Row gap={u(props.gap)} align={u(props.align)} justify={u(props.justify)} wrap={u(props.wrap)}>
        {children}
      </Row>
    ),
    Grid: ({ props, children }) => (
      <Grid cols={u(props.cols)} gap={u(props.gap)}>
        {children}
      </Grid>
    ),
    Card: ({ props, children }) => (
      <Card variant={u(props.variant)} motion={u(props.motion)}>
        {children}
      </Card>
    ),
    Heading: ({ props }) => <Heading level={u(props.level)}>{props.text}</Heading>,
    Eyebrow: ({ props }) => (
      <span data-part="text">
        <Eyebrow>{props.text}</Eyebrow>
      </span>
    ),
    // A line of text is a line of its own wherever it sits: 1st-Pouf's Text is a
    // span, so two of them placed straight in a Card would run together. The
    // reading parts carry data-part="text": the checker and the preview count a
    // story's text lines among them only, as storyui names them from draws.json,
    // so a picker's face that happens to read "Ann" is not a line.
    Text: ({ props }) => (
      <div className="min-w-0" data-part="text">
        <Text
          size={u(props.size)}
          muted={u(props.muted)}
          num={u(props.num)}
          mono={u(props.mono)}
          truncate={u(props.truncate)}
        >
          {props.text}
        </Text>
      </div>
    ),
    Badge: ({ props }) => (
      <span data-part="text">
        <Badge tone={u(props.tone)}>{props.text}</Badge>
      </span>
    ),
    Empty: ({ props }) => <Empty title={props.title}>{u(props.text)}</Empty>,
    Separator: () => <Separator />,
    ActionButton: ({ props, emit }) => {
      const { run, busy } = useRun(props.action, props.args)
      return (
        <Button
          tone={u(props.tone)}
          variant={u(props.variant)}
          size={u(props.size)}
          label={u(props.name)}
          loading={busy}
          onClick={async () => {
            if (await run()) emit('press')
          }}
        >
          {props.label}
        </Button>
      )
    },
    ActionCheckbox: ({ props, emit }) => {
      const { run, busy } = useRun(props.action, props.args)
      return (
        <Checkbox
          label={props.label}
          checked={!!props.checked}
          disabled={busy}
          onChange={async () => {
            if (await run()) emit('change')
          }}
        />
      )
    },
    ActionSelect: ({ props, emit }) => {
      const { run, busy } = useRun(props.action, props.args)
      const options = props.options.map((row) => ({ value: String(row.id ?? ''), label: String(row[props.optionLabel] ?? '') }))
      // Its words show above it, as a text box's do; they are also its accessible name.
      return (
        <Field label={props.label}>
          {(id, describedBy) => (
            <Select
              id={id}
              describedBy={describedBy}
              label={props.label}
              placeholder={u(props.placeholder)}
              value={props.value ?? ''}
              options={options}
              disabled={busy}
              onChange={async (v) => {
                if (await run({ [props.pick]: v })) emit('change')
              }}
            />
          )}
        </Field>
      )
    },
    DraftInput: ({ props, bindings }) => {
      const [value, setValue] = useBoundProp<string>(u(props.value), bindings?.value)
      return (
        <Field label={props.label}>
          {(id, describedBy) => (
            <Input
              id={id}
              describedBy={describedBy}
              label={props.label}
              placeholder={asExample(props.placeholder)}
              value={value ?? ''}
              onChange={setValue}
            />
          )}
        </Field>
      )
    },
    DraftNumber: ({ props, bindings }) => {
      const [value, setValue] = useBoundProp<number | string>(u(props.value), bindings?.value)
      const write = (text: string) => {
        const n = Number(text)
        setValue(text.trim() !== '' && Number.isFinite(n) ? n : '')
      }
      return (
        <Field label={props.label}>
          {(id, describedBy) => (
            <Input
              id={id}
              describedBy={describedBy}
              label={props.label}
              placeholder={asExample(props.placeholder)}
              type="number"
              inputMode="numeric"
              value={value == null || value === '' ? '' : String(value)}
              onChange={write}
            />
          )}
        </Field>
      )
    },
  },
})
