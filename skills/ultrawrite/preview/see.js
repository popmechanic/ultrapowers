// What a person can see and use on the sketch, named the way Chromium's
// accessibility tree names it: the role, the accessible name, and how many.
// The checker asks Chromium for the same pairs (Page.count), so a builder may
// restyle the screen but not rename what is on it.
const ROLE = { BUTTON: 'button', H1: 'heading', H2: 'heading', H3: 'heading', H4: 'heading', H5: 'heading', H6: 'heading', TEXTAREA: 'textbox' }
const TEXT_TYPES = ['', 'text', 'search', 'email', 'url', 'tel']

export function roleOf (el) {
  if (el.getAttribute('role')) return el.getAttribute('role')
  if (el.tagName === 'INPUT') {
    const t = (el.getAttribute('type') || '').toLowerCase()
    if (t === 'checkbox') return 'checkbox'
    if (TEXT_TYPES.includes(t)) return 'textbox'
    return null
  }
  if (el.tagName === 'A') return el.hasAttribute('href') ? 'link' : null
  return ROLE[el.tagName] || null
}

export function nameOf (el) {
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim()
  const label = clean(el.getAttribute('aria-label'))
  if (label) return label
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return clean(el.getAttribute('placeholder'))
  return clean(el.textContent)
}

export function findAll (root, role, name) {
  return [...root.querySelectorAll('*')].filter((el) => roleOf(el) === role && nameOf(el) === name)
}

function countRoles (els) {
  const counts = new Map()
  for (const el of els) {
    const role = roleOf(el)
    const name = role && nameOf(el)
    if (!role || !name) continue
    const key = role + '\u0000' + name
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  return [...counts].map(([k, count]) => { const [role, name] = k.split('\u0000'); return { role, name, count } })
    .sort((a, b) => (a.role < b.role ? -1 : a.role > b.role ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

export function seeOf (root) {
  return countRoles(root.querySelectorAll('*'))
}

// What a person can see and use inside one piece of the sketch: only the
// elements inside a container whose data-mark starts with `<piece>:` (the
// sketch convention — catalog sketches mark `todo:add`, `todo:list`,
// `tag:panel`). A control outside every one of that piece's containers is not
// included, so a builder's screen never inflates or borrows another piece's
// count.
export function seeOfPiece (root, piece) {
  const prefix = piece + ':'
  const containers = [...root.querySelectorAll('[data-mark]')]
    .filter((el) => (el.getAttribute('data-mark') || '').startsWith(prefix))
  const seen = new Set()
  for (const container of containers) {
    for (const el of container.querySelectorAll('*')) seen.add(el)
  }
  return countRoles(seen)
}
