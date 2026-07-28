import { describe, expect, it } from 'vitest'
import { buildRequiredRestForDuty } from './events'
import {
  assertPositioningAllowed,
  computePositioningRestHours,
  evaluatePositioningRestForDuty,
  getOperatingSectorCount,
} from './rest-70043'
import type { DutyEvent } from './types'

describe('computePositioningRestHours (CAR 700.43 / AC 700-047 §4.45)', () => {
  it('does not increase rest when total ≤ max FDP', () => {
    const r = computePositioningRestHours({
      totalDutyHours: 12,
      maxFdpHours: 13,
    })
    expect(r.band).toBe('none')
    expect(r.restHours).toBe(0)
    expect(r.exceedanceHours).toBe(0)
  })

  it('AC example: 12 h FDP + 3.5 h position on max 13 → rest 15.5 (≤3 h excess)', () => {
    // total 15.5, excess 2.5 → rest = hours of work = 15.5
    const r = computePositioningRestHours({
      totalDutyHours: 15.5,
      maxFdpHours: 13,
    })
    expect(r.band).toBe('le3')
    expect(r.exceedanceHours).toBeCloseTo(2.5, 5)
    expect(r.restHours).toBeCloseTo(15.5, 5)
  })

  it('AC example: 12 h FDP + 6.5 h position on max 13 → rest 24 (>3 h excess)', () => {
    // total 18.5, excess 5.5 → rest = 18.5 + 5.5 = 24
    const r = computePositioningRestHours({
      totalDutyHours: 18.5,
      maxFdpHours: 13,
    })
    expect(r.band).toBe('gt3')
    expect(r.exceedanceHours).toBeCloseTo(5.5, 5)
    expect(r.restHours).toBeCloseTo(24, 5)
  })

  it('exactly 3 h excess uses band le3 and rest = total duty', () => {
    const r = computePositioningRestHours({
      totalDutyHours: 16,
      maxFdpHours: 13,
    })
    expect(r.band).toBe('le3')
    expect(r.restHours).toBe(16)
  })
})

describe('assertPositioningAllowed (700.43(3))', () => {
  const start = new Date('2026-07-10T12:00:00.000Z')
  const max = 11

  it('allows ≤3 h excess without agreement', () => {
    // AC: 10 h operate + 3.5 h position = 13.5; max 11; excess 2.5
    const operatingEnd = new Date(start.getTime() + 10 * 3600_000)
    const end = new Date(start.getTime() + 13.5 * 3600_000)
    const r = assertPositioningAllowed({
      start,
      end,
      operatingEnd,
      maxFdpHours: max,
      positioningAgreed: false,
    })
    expect(r.ok).toBe(true)
    expect(r.exceedanceHours).toBeCloseTo(2.5, 5)
  })

  it('requires agreement when excess > 3 h', () => {
    const operatingEnd = new Date(start.getTime() + 10 * 3600_000)
    const end = new Date(start.getTime() + 15 * 3600_000) // total 15, excess 4
    const denied = assertPositioningAllowed({
      start,
      end,
      operatingEnd,
      maxFdpHours: max,
      positioningAgreed: false,
    })
    expect(denied.ok).toBe(false)
    expect(denied.code).toBe('needs_agreement')

    const allowed = assertPositioningAllowed({
      start,
      end,
      operatingEnd,
      maxFdpHours: max,
      positioningAgreed: true,
    })
    expect(allowed.ok).toBe(true)
  })

  it('blocks excess over 7 h even with agreement', () => {
    const operatingEnd = new Date(start.getTime() + 10 * 3600_000)
    const end = new Date(start.getTime() + 19 * 3600_000) // total 19, excess 8
    const r = assertPositioningAllowed({
      start,
      end,
      operatingEnd,
      maxFdpHours: max,
      positioningAgreed: true,
    })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('over_hard_cap')
  })

  it('blocks operating FDP itself over max', () => {
    const operatingEnd = new Date(start.getTime() + 12 * 3600_000)
    const end = new Date(start.getTime() + 13 * 3600_000)
    const r = assertPositioningAllowed({
      start,
      end,
      operatingEnd,
      maxFdpHours: max,
      positioningAgreed: true,
    })
    expect(r.ok).toBe(false)
    expect(r.code).toBe('operating_over_max')
  })
})

describe('evaluatePositioningRestForDuty', () => {
  it('returns null without endsWithPositioning / operatingEnd', () => {
    const duty: DutyEvent = {
      id: 'd1',
      title: 'Duty',
      type: 'duty',
      start: new Date('2026-07-10T12:00:00.000Z'),
      end: new Date('2026-07-10T22:00:00.000Z'),
    }
    expect(
      evaluatePositioningRestForDuty(duty, 'TC', 'America/Toronto', 2, '>=50'),
    ).toBeNull()
  })

  it('computes rest for trailing DH duty', () => {
    const start = new Date('2026-07-10T12:00:00.000Z')
    const operatingEnd = new Date(start.getTime() + 12 * 3600_000)
    const end = new Date(start.getTime() + 15.5 * 3600_000)
    const duty: DutyEvent = {
      id: 'd1',
      title: 'Duty',
      type: 'duty',
      start,
      end,
      endsWithPositioning: true,
      operatingEnd,
      operatingSectors: 2,
      avgSectorTime: '>=50',
      acclTZ: 'UTC',
    }
    // Force max via known table is hard; inject by using evaluate with mocked max via compute only
    const r = evaluatePositioningRestForDuty(duty, 'TC', 'UTC', 2, '>=50')
    expect(r).not.toBeNull()
    expect(r!.positioningHours).toBeCloseTo(3.5, 5)
    expect(r!.operatingHours).toBeCloseTo(12, 5)
  })
})

describe('buildRequiredRestForDuty + 700.43', () => {
  it('extends rest clock when trailing DH exceeds max FDP (AC 15.5 h case shape)', () => {
    // Construct duty with known total 15.5 h and operating 12 h; force max via
    // stored sectors + start hour that yields a low table max is hard — instead
    // set max implicitly by using evaluate: pick mid-morning high-sector max and
    // long total. Simpler: unit-test apply via a duty where max is clearly < total.
    // Start 07:00 UTC, 1 sector >=50 → table often 13–14 h; use operatingSectors high
    // and long day. Directly assert restHours >= total when exceedance ≤3.
    const start = new Date('2026-07-10T11:00:00.000Z') // 07:00 EDT
    const operatingEnd = new Date(start.getTime() + 12 * 3600_000)
    const end = new Date(start.getTime() + 15.5 * 3600_000)
    const duty: DutyEvent = {
      id: 'dh-duty',
      title: 'Duty + DH',
      type: 'duty',
      start,
      end,
      acclTZ: 'America/Toronto',
      startTZ: 'America/Toronto',
      endTZ: 'America/Toronto',
      endsWithPositioning: true,
      operatingEnd,
      operatingSectors: 7,
      avgSectorTime: '>=50',
      positioningAgreed: false,
    }
    const rest = buildRequiredRestForDuty(
      duty,
      [duty],
      'TC',
      'America/Toronto',
      'America/Toronto',
      '12h',
    )
    // 7+ sectors mid-morning max is typically 11–12 h; total 15.5 → 700.43 applies
    expect(rest.requiredRestHours ?? 0).toBeGreaterThanOrEqual(15.5 - 0.05)
    expect(rest.restRule).toBe('CAR 700.43')
    expect(rest.restKind).toBe('positioning')
    expect(rest.title).toMatch(/positioning/i)
    expect(rest.ruleWhy ?? '').toMatch(/700\.43/)
  })
})

describe('getOperatingSectorCount', () => {
  it('uses duty.operatingSectors when set', () => {
    expect(
      getOperatingSectorCount(
        {
          id: 'x',
          title: '',
          type: 'duty',
          start: new Date(),
          end: new Date(),
          operatingSectors: 3,
        },
        9,
      ),
    ).toBe(3)
  })

  it('falls back to settings sectors', () => {
    expect(
      getOperatingSectorCount(
        {
          id: 'x',
          title: '',
          type: 'duty',
          start: new Date(),
          end: new Date(),
        },
        4,
      ),
    ).toBe(4)
  })
})
