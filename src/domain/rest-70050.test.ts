import { describe, expect, it } from 'vitest'
import {
  computeSplitDutyExtension,
  nightMinutesInBreak,
} from './rest-70050'
import { parseZonedDateTime } from './time'

const TZ = 'America/Toronto'

describe('nightMinutesInBreak', () => {
  it('counts full break inside 00:00–05:59 as night', () => {
    const start = parseZonedDateTime('2026-08-03', '01:00', TZ)
    const end = parseZonedDateTime('2026-08-03', '03:00', TZ)
    expect(nightMinutesInBreak(start, end, TZ)).toBeCloseTo(120, 5)
  })

  it('counts full break in afternoon as day (0 night)', () => {
    const start = parseZonedDateTime('2026-08-03', '14:00', TZ)
    const end = parseZonedDateTime('2026-08-03', '16:00', TZ)
    expect(nightMinutesInBreak(start, end, TZ)).toBeCloseTo(0, 5)
  })

  it('prorates break straddling 06:00', () => {
    const start = parseZonedDateTime('2026-08-03', '05:00', TZ)
    const end = parseZonedDateTime('2026-08-03', '07:00', TZ)
    // 05:00–06:00 night, 06:00–07:00 day
    expect(nightMinutesInBreak(start, end, TZ)).toBeCloseTo(60, 5)
  })
})

describe('computeSplitDutyExtension (CAR 700.50)', () => {
  it('60 min night break → +0.25 h (15 min at 100%)', () => {
    const start = parseZonedDateTime('2026-08-03', '02:00', TZ)
    const end = parseZonedDateTime('2026-08-03', '03:00', TZ)
    const r = computeSplitDutyExtension({
      breakStart: start,
      breakEnd: end,
      acclTZ: TZ,
    })
    expect(r.ok).toBe(true)
    expect(r.breakHours).toBeCloseTo(1, 5)
    expect(r.netHours).toBeCloseTo(0.25, 5)
    expect(r.extensionHours).toBeCloseTo(0.25, 5)
  })

  it('60 min day break → +0.125 h (7.5 min at 50%)', () => {
    const start = parseZonedDateTime('2026-08-03', '14:00', TZ)
    const end = parseZonedDateTime('2026-08-03', '15:00', TZ)
    const r = computeSplitDutyExtension({
      breakStart: start,
      breakEnd: end,
      acclTZ: TZ,
    })
    expect(r.ok).toBe(true)
    expect(r.netHours).toBeCloseTo(0.25, 5)
    expect(r.extensionHours).toBeCloseTo(0.125, 5)
  })

  it('3 h night break → +2.25 h after −45 min at 100%', () => {
    const start = parseZonedDateTime('2026-08-03', '01:00', TZ)
    const end = parseZonedDateTime('2026-08-03', '04:00', TZ)
    const r = computeSplitDutyExtension({
      breakStart: start,
      breakEnd: end,
      acclTZ: TZ,
    })
    expect(r.ok).toBe(true)
    expect(r.breakHours).toBeCloseTo(3, 5)
    expect(r.netHours).toBeCloseTo(2.25, 5)
    expect(r.extensionHours).toBeCloseTo(2.25, 5)
  })

  it('UOC replan forces 50% even at night', () => {
    const start = parseZonedDateTime('2026-08-03', '01:00', TZ)
    const end = parseZonedDateTime('2026-08-03', '04:00', TZ)
    const r = computeSplitDutyExtension({
      breakStart: start,
      breakEnd: end,
      acclTZ: TZ,
      unforeseenReplan: true,
    })
    expect(r.ok).toBe(true)
    expect(r.extensionHours).toBeCloseTo(1.125, 5) // 2.25 * 0.5
    expect(r.creditRateLabel).toMatch(/UOC/i)
  })

  it('rejects break under 60 minutes', () => {
    const start = parseZonedDateTime('2026-08-03', '14:00', TZ)
    const end = parseZonedDateTime('2026-08-03', '14:45', TZ)
    const r = computeSplitDutyExtension({
      breakStart: start,
      breakEnd: end,
      acclTZ: TZ,
    })
    expect(r.ok).toBe(false)
    expect(r.extensionHours).toBe(0)
    expect(r.error).toMatch(/60/)
  })

  it('prorates extension when break straddles night and day', () => {
    // 05:00–07:00 = 2 h; 1 h night + 1 h day; net = 1.25 h
    // ext = 1.25 * (0.5*1 + 0.5*0.5) = 1.25 * 0.75 = 0.9375
    const start = parseZonedDateTime('2026-08-03', '05:00', TZ)
    const end = parseZonedDateTime('2026-08-03', '07:00', TZ)
    const r = computeSplitDutyExtension({
      breakStart: start,
      breakEnd: end,
      acclTZ: TZ,
    })
    expect(r.ok).toBe(true)
    expect(r.nightHours).toBeCloseTo(1, 5)
    expect(r.dayHours).toBeCloseTo(1, 5)
    expect(r.netHours).toBeCloseTo(1.25, 5)
    expect(r.extensionHours).toBeCloseTo(0.9375, 5)
  })
})
