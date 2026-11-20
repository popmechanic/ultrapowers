// The screen parts a run added (#1491): the lines of a TinyApp's client/src/screens/draws.json
// in the landed snapshot that its base did not have, each with the role it draws and the props
// that name it, for the PR's `### New screen parts`. Pure; text that is not a parts list adds nothing.
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
