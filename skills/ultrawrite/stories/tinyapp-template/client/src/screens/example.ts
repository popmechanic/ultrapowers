const PREFIX = 'e.g. '

export const asExample = (v: string | null | undefined): string | undefined =>
  v ? (v.startsWith(PREFIX) ? v : PREFIX + v) : undefined
