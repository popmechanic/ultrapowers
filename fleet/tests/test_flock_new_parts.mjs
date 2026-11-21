#!/usr/bin/env node
import { newParts } from '../../factory/flock/new_parts.mjs'

const fails = []
const assert = (ok, why) => { if (!ok) fails.push(why) }
const draws = (parts) => JSON.stringify({ about: 'x', parts })

const base = draws({ Heading: { role: 'heading', name: ['text'] } })
const landed = draws({ Heading: { role: 'heading', name: ['text'] }, Status: { role: 'status', name: ['label'] }, Meter: { role: null } })
const got = newParts(base, landed)
assert(JSON.stringify(got) === JSON.stringify([
  { part: 'Status', role: 'status', name: ['label'] },
  { part: 'Meter', role: null, name: [] },
]), `added parts: ${JSON.stringify(got)}`)
assert(newParts(base, base).length === 0, 'an unchanged list adds nothing')
assert(newParts(null, base).length === 1, 'a base with no draws.json: every landed line is new')
assert(newParts(base, 'not json').length === 0 && newParts(base, null).length === 0, 'unreadable landed text adds nothing')

if (fails.length) { for (const f of fails) console.log(`FAIL ${f}`); process.exit(1) }
console.log('ALL TESTS PASSED')
