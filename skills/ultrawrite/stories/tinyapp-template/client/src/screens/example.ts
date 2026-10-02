/** A text box's example, worded so it reads as an example and never as text
 * already typed (#1506): "eggs" is drawn "e.g. eggs". The spec keeps the raw
 * word, which the arranger matches on, so the prefix is added only here, where
 * the box is drawn; an example already worded "e.g. …" is left as it is.
 */
const PREFIX = 'e.g. '

export const asExample = (v: string | null | undefined): string | undefined =>
  v ? (v.startsWith(PREFIX) ? v : PREFIX + v) : undefined
