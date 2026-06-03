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

const seen = (typeof args !== 'undefined' && args) ? Object.keys(args) : null
const wavesType = (typeof args !== 'undefined' && args && Array.isArray(args.waves))
  ? 'array'
  : typeof (typeof args !== 'undefined' && args ? args.waves : undefined)

return { argsSeen: seen, wavesType }
