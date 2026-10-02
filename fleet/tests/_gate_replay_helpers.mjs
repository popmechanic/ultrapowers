// Pure scoring for gate_jev_replay_probe.mjs (#1528); the sim is test_gate_jev_replay.mjs.

// the verdict most of the reads agree on, or null
export const majority = (vs) => ['fail', 'pass'].find((v) => vs.filter((x) => x === v).length * 2 > vs.length) ?? null

// Every recorded round the replay reads, 1-based by position. A round where agent and jev both read:
// both `fail` is `agreed`; a labelled disagreement is `other` unless jev read `fail`, else `wrong` (agent
// was right) or `right` (jev was).
export function replayRounds(rec) {
  const out = []
  for (const [task, t] of Object.entries(rec?.tasks ?? {})) {
    const rounds = Array.isArray(t?.gate_rounds) ? t.gate_rounds : []
    rounds.forEach((r, i) => {
      if (!r || r.agent == null || r.jev == null) return
      let side = null
      if (r.agent === 'fail' && r.jev === 'fail') side = 'agreed'
      else if (r.agent !== r.jev && r.right) side = r.jev !== 'fail' ? 'other' : r.right === 'agent' ? 'wrong' : r.right === 'jev' ? 'right' : null
      if (side) out.push({ task, round: i + 1, r, side })
    })
  }
  return out
}

// `evaluate(item)` returns the reads of one item; wrong/right/agreed count the fails, *Pass/rightFail what they read now
export function score(items, evaluate) {
  const s = { wrong: 0, wrongPass: 0, right: 0, rightFail: 0, agreed: 0, agreedPass: 0 }
  for (const item of items) {
    const m = majority(evaluate(item))
    if (item.side === 'wrong') { s.wrong++; if (m === 'pass') s.wrongPass++ }
    else if (item.side === 'right') { s.right++; if (m === 'fail') s.rightFail++ }
    else if (item.side === 'agreed') { s.agreed++; if (m === 'pass') s.agreedPass++ }
  }
  return s
}

// 2 nothing replayable; 0 only when the controls hold, no agreed fail now passes and two thirds of the wrong fails do
export function exitCode(s, controlsOk) {
  if (s.wrong + s.agreed === 0) return 2
  return controlsOk && s.agreedPass === 0 && s.wrongPass * 3 >= s.wrong * 2 ? 0 : 1
}

export function summary(s, dates, controlsOk) {
  return `gate-jev replay: n=${s.wrong + s.right + s.agreed} rounds (${dates}), wrong fails now pass ${s.wrongPass} of ${s.wrong}, `
    + `right fails now fail ${s.rightFail} of ${s.right}, agreed fails now pass ${s.agreedPass} of ${s.agreed}, `
    + `controls ${controlsOk ? 'ok' : 'NOT OK'}`
}
