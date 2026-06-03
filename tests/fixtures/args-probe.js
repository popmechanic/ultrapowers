// tests/fixtures/args-probe.js
//
// One-time gating probe for the args-population risk (see
// skills/ultrapowers/references/workflow-template.md "Args-population note").
//
// Launch via the real /ultrapowers install path with, e.g.:
//   args = { waves: [[{ id: 'probe' }]] }
//
// Expected on success: { argsSeen: ['waves', ...], wavesType: 'array' }
// If it returns argsSeen: null or wavesType: 'undefined', `args` is NOT
// populating in this environment — switch SKILL.md to the temp-file fallback
// before relying on the committed workflow.

export const meta = {
  name: 'args-probe',
  description: 'Probe whether args populates inside a committed workflow.',
  phases: [{ title: 'Probe' }],
}

phase('Probe')

// Mirror workflow.js: args may arrive as an object or a JSON string.
let A = (typeof args !== 'undefined') ? args : undefined
const rawType = typeof args
if (typeof A === 'string') {
  try { A = JSON.parse(A) } catch (e) { A = { __parseError: e.message } }
}

const seen = (A && typeof A === 'object') ? Object.keys(A) : null
const wavesType = (A && Array.isArray(A.waves)) ? 'array' : typeof (A ? A.waves : undefined)

return { rawType, argsSeen: seen, wavesType }
