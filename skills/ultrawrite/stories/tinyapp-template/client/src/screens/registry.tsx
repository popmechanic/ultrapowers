/** Draws each catalog entry with the 1st-Pouf component it is named for.
 *
 * ActionButton and ActionCheckbox run their card action through the page's
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
  Grid,
  Heading,
  Input,
  Row,
  Separator,
  Stack,
  Text,
} from '../pouf'
import { baseCatalog } from './catalog'

const u = <T,>(v: T | null | undefined): T | undefined => v ?? undefined

function useRun(action: string, args: Record<string, unknown> | null | undefined) {
  const { handlers } = useActions()
  const [busy, setBusy] = useState(false)
  const run = async (): Promise<boolean> => {
    const handler = handlers[action]
    if (!handler) return false
    setBusy(true)
    try {
      return (await handler(args ?? {})) === true
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
    Eyebrow: ({ props }) => <Eyebrow>{props.text}</Eyebrow>,
    Text: ({ props }) => (
      <Text
        size={u(props.size)}
        muted={u(props.muted)}
        num={u(props.num)}
        mono={u(props.mono)}
        truncate={u(props.truncate)}
      >
        {props.text}
      </Text>
    ),
    Badge: ({ props }) => <Badge tone={u(props.tone)}>{props.text}</Badge>,
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
    DraftInput: ({ props, bindings }) => {
      const [value, setValue] = useBoundProp<string>(u(props.value), bindings?.value)
      return (
        <Input
          label={props.label}
          placeholder={u(props.placeholder)}
          value={value ?? ''}
          onChange={setValue}
        />
      )
    },
  },
})
