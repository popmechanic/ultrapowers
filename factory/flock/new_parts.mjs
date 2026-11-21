export const DRAWS = 'client/src/screens/draws.json'

function partsOf (text) {
  if (typeof text !== 'string') return {}
  try {
    const p = JSON.parse(text).parts
    return p && typeof p === 'object' && !Array.isArray(p) ? p : {}
  } catch { return {} }
}

export function newParts (baseText, landedText) {
  const before = partsOf(baseText)
  return Object.entries(partsOf(landedText))
    .filter(([name]) => !(name in before))
    .map(([name, line]) => ({
      part: name,
      role: line && typeof line.role === 'string' ? line.role : null,
      name: line && Array.isArray(line.name) ? line.name.map(String) : []
    }))
}
