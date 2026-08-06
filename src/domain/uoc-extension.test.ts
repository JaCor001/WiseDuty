import { describe, expect, it } from 'vitest'
import {
  assessUocExtension,
  buildFdpExtensionPhasePrompt,
  classifyFdpExtensionPhase,
  DEFAULT_UOC_EXTENSION_CAP_H,
  maxUocExtensionHours,
  uocExtensionRestImplications,
  UOC_EMPTY_ANSWERS,
} from './uoc-extension'
import type { DutyEvent } from './types'
import { zonedWallTime } from './time'

const TZ = 'America/Toronto'

function dutyAt(start: Date, end: Date): DutyEvent {
  return {
    id: 'd1',
    title: 'Flight Duty',
    type: 'duty',
    start,
    end,
    acclTZ: TZ,
    operatingSectors: 1,
  }
}

describe('maxUocExtensionHours', () => {
  it('maps crew configs to 700.63 caps', () => {
    expect(maxUocExtensionHours('single_pilot')).toBe(1)
    expect(maxUocExtensionHours('two_pilot')).toBe(2)
    expect(maxUocExtensionHours('augmented_1_flight')).toBe(3)
    expect(maxUocExtensionHours('augmented_2_3_flights')).toBe(2)
  })
})

describe('assessUocExtension', () => {
  it('allows when UOC conditions met and need ≤ cap', () => {
    const r = assessUocExtension({
      actualHours: 14,
      maxFdpHours: 13,
      rdpLimiting: false,
      answers: {
        uocTimingOk: true,
        crewConsulted: true,
        picAgrees: true,
        crewConfig: 'two_pilot',
      },
    })
    expect(r.neededExtensionHours).toBeCloseTo(1, 5)
    expect(r.maxExtensionHours).toBe(2)
    expect(r.allowed).toBe(true)
  })

  it('rejects when UOC timing fails', () => {
    const r = assessUocExtension({
      actualHours: 14,
      maxFdpHours: 13,
      rdpLimiting: false,
      answers: {
        ...UOC_EMPTY_ANSWERS,
        uocTimingOk: false,
      },
    })
    expect(r.allowed).toBe(false)
    expect(r.summary).toMatch(/timing/i)
  })

  it('rejects when not all crew consent', () => {
    const r = assessUocExtension({
      actualHours: 14,
      maxFdpHours: 13,
      rdpLimiting: false,
      answers: {
        uocTimingOk: true,
        crewConsulted: false,
        picAgrees: null,
        crewConfig: null,
      },
    })
    expect(r.allowed).toBe(false)
    expect(r.summary).toMatch(/crew consent/i)
  })

  it('blocks free extension when RDP is limiting and over', () => {
    const r = assessUocExtension({
      actualHours: 14,
      maxFdpHours: 12,
      rdpLimiting: true,
      answers: {
        uocTimingOk: true,
        crewConsulted: true,
        picAgrees: true,
        crewConfig: 'two_pilot',
      },
    })
    expect(r.allowed).toBe(false)
    expect(r.summary).toMatch(/RDP/i)
  })
})

describe('classifyFdpExtensionPhase', () => {
  // Report 08:00, max 13 h → extension starts 21:00, ends 23:00 (+2 h)
  const report = zonedWallTime(TZ, 2026, 8, 4, 8, 0)
  const release = zonedWallTime(TZ, 2026, 8, 4, 22, 0) // 14 h forecast
  const d = dutyAt(report, release)
  const maxFdpHours = 13
  const actualHours = 14

  it('defaults cap to 2 h (two-pilot)', () => {
    expect(DEFAULT_UOC_EXTENSION_CAP_H).toBe(2)
  })

  it('phase future before Max FDP is reached', () => {
    const now = zonedWallTime(TZ, 2026, 8, 4, 20, 0) // 1 h before max end
    const w = classifyFdpExtensionPhase(d, {
      maxFdpHours,
      actualHours,
      now,
    })
    expect(w.phase).toBe('future')
    expect(w.hoursUntilStart).toBeCloseTo(1, 5)
    expect(w.extensionCapHours).toBe(2)
    expect(w.neededExtensionHours).toBeCloseTo(1, 5)
  })

  it('phase active during the +2 h extension window', () => {
    const now = zonedWallTime(TZ, 2026, 8, 4, 21, 30)
    const w = classifyFdpExtensionPhase(d, {
      maxFdpHours,
      actualHours,
      now,
    })
    expect(w.phase).toBe('active')
    expect(w.hoursUntilEnd).toBeCloseTo(1.5, 5)
  })

  it('phase ended after Max FDP + 2 h', () => {
    const now = zonedWallTime(TZ, 2026, 8, 4, 23, 30)
    const w = classifyFdpExtensionPhase(d, {
      maxFdpHours,
      actualHours,
      now,
    })
    expect(w.phase).toBe('ended')
    expect(w.hoursSinceEnd).toBeCloseTo(0.5, 5)
  })
})

describe('uocExtensionRestImplications', () => {
  it('mentions 700.63 rest increase and operator notice', () => {
    const lines = uocExtensionRestImplications({
      neededExtensionHours: 1.25,
      extensionCapHours: 2,
    })
    expect(lines.some((l) => /700\.63\(3\)/i.test(l))).toBe(true)
    expect(lines.some((l) => /700\.63\(4\)/i.test(l))).toBe(true)
    expect(lines.some((l) => /rest/i.test(l))).toBe(true)
  })
})

describe('buildFdpExtensionPhasePrompt', () => {
  const report = zonedWallTime(TZ, 2026, 8, 4, 8, 0)
  const d = dutyAt(report, zonedWallTime(TZ, 2026, 8, 4, 22, 0))

  it('future → choice with Got it / guidelines / refuse', () => {
    const w = classifyFdpExtensionPhase(d, {
      maxFdpHours: 13,
      actualHours: 12.7,
      now: zonedWallTime(TZ, 2026, 8, 4, 20, 0),
    })
    const p = buildFdpExtensionPhasePrompt({
      phase: w.phase,
      limitKind: 'FDP',
      assessmentMessage: 'Near max.',
      remainingLabel: '18 min',
      window: w,
    })
    expect(p.kind).toBe('choice')
    expect(p.choices.map((c) => c.id).sort()).toEqual(
      ['got_it', 'guidelines', 'refuse'].sort(),
    )
    expect(p.message).toMatch(/contact your company/i)
  })

  it('active → alert that UOC extension is required', () => {
    const w = classifyFdpExtensionPhase(d, {
      maxFdpHours: 13,
      actualHours: 14,
      now: zonedWallTime(TZ, 2026, 8, 4, 21, 30),
    })
    const p = buildFdpExtensionPhasePrompt({
      phase: w.phase,
      limitKind: 'FDP',
      assessmentMessage: 'Over max.',
      remainingLabel: '',
      window: w,
    })
    expect(p.kind).toBe('alert')
    expect(p.title).toMatch(/required/i)
    expect(p.message).toMatch(/extension is required/i)
    expect(p.message).toMatch(/contact your company/i)
  })

  it('ended → rest implications and past extension notice', () => {
    const w = classifyFdpExtensionPhase(d, {
      maxFdpHours: 13,
      actualHours: 14,
      now: zonedWallTime(TZ, 2026, 8, 5, 1, 0),
    })
    const p = buildFdpExtensionPhasePrompt({
      phase: w.phase,
      limitKind: 'FDP',
      assessmentMessage: 'Over max.',
      remainingLabel: '',
      window: w,
    })
    expect(p.kind).toBe('alert')
    expect(p.message).toMatch(/extension was required/i)
    expect(p.message).toMatch(/rest implications/i)
    expect(p.message).toMatch(/700\.63\(3\)/)
    expect(p.message).toMatch(/contact your company/i)
  })
})
