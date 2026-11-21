export function looseEnds(beliefs, text) {
  const items = []
  for (const b of beliefs || []) {
    if (!b || b.by === 'host' || !b.path) continue
    const item = { id: b.id, by: b.by }
    if (b.task !== undefined) item.task = b.task
    item.about = b.about
    item.claim = b.claim
    item.path = b.path
    if (b.stale === undefined) {
      item.state = 'unchecked'
    } else {
      item.stale = b.stale
      const content = text(b.path)
      item.state = content === undefined ? 'unchecked' : typeof content === 'string' && content.includes(b.stale) ? 'open' : 'resolved'
    }
    items.push(item)
  }
  return items
}
