export const majority = (vs) => ['fail', 'pass'].find((v) => vs.filter((x) => x === v).length * 2 > vs.length) ?? null

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

export function exitCode(s, controlsOk) {
  if (s.wrong + s.agreed === 0) return 2
  return controlsOk && s.agreedPass === 0 && s.wrongPass * 3 >= s.wrong * 2 ? 0 : 1
}

export function summary(s, dates, controlsOk) {
  return `gate-jev replay: n=${s.wrong + s.right + s.agreed} rounds (${dates}), wrong fails now pass ${s.wrongPass} of ${s.wrong}, `
    + `right fails now fail ${s.rightFail} of ${s.right}, agreed fails now pass ${s.agreedPass} of ${s.agreed}, `
    + `controls ${controlsOk ? 'ok' : 'NOT OK'}`
}
