import { describe, expect, it } from 'vitest'
import {
  acclimatizationZoneDiffHours,
  hoursRequiredToAcclimatize,
  resolveAcclimatizedTZ,
  restampDutyAcclimatization,
} from './acclimatization'
import { deriveFdpFromFlights } from './fdp-from-flights'
import type { DutyEvent, FlightLeg } from './types'
import { zonedWallTime } from './time'

const HOME = 'America/Toronto'
const YVR = 'America/Vancouver'
const YYC = 'America/Edmonton'

function duty(
  id: string,
  start: Date,
  end: Date,
  startTZ: string,
  endTZ: string,
  acclTZ = HOME,
): DutyEvent {
  return {
    id,
    title: 'Duty',
    type: 'duty',
    start,
    end,
    startTZ,
    endTZ,
    acclTZ,
  }
}

function leg(
  partial: Partial<FlightLeg> &
    Pick<FlightLeg, 'depIcao' | 'arrIcao' | 'dep' | 'arr'>,
): FlightLeg {
  return {
    id: partial.id || 'x',
    isDeadhead: false,
    ...partial,
  }
}

describe('hoursRequiredToAcclimatize (CAR 700.28(5))', () => {
  it('is 0 in the same zone', () => {
    expect(hoursRequiredToAcclimatize(0)).toBe(0)
  })

  it('uses min of 72h (a) and 24h×diff (c) when < 4 h', () => {
    // 1 h → min(72, 24) = 24 via (c)
    expect(hoursRequiredToAcclimatize(1)).toBe(24)
    // 3 h → min(72, 72) = 72
    expect(hoursRequiredToAcclimatize(3)).toBe(72)
  })

  it('uses min of 96h (b) and 24h×diff (c) when ≥ 4 h', () => {
    // 4 h → min(96, 96) = 96
    expect(hoursRequiredToAcclimatize(4)).toBe(96)
    // 5 h → min(96, 120) = 96 via (b)
    expect(hoursRequiredToAcclimatize(5)).toBe(96)
  })
})

describe('canadian zone bands (700.28(7))', () => {
  it('treats Newfoundland as Atlantic with Halifax', () => {
    const at = new Date('2026-07-15T12:00:00Z')
    expect(
      acclimatizationZoneDiffHours(
        'America/Halifax',
        'America/St_Johns',
        at,
      ),
    ).toBe(0)
  })

  it('counts Toronto–Vancouver as 3 Canadian bands', () => {
    const at = new Date('2026-07-15T12:00:00Z')
    expect(acclimatizationZoneDiffHours(HOME, YVR, at)).toBe(3)
  })
})

describe('resolveAcclimatizedTZ multi-layover pairing', () => {
  it('keeps home acclimatization after one westbound overnight layover', () => {
    // Day 1: YYZ → YVR, release evening Vancouver
    const d1start = zonedWallTime(HOME, 2026, 7, 10, 8, 0)
    const d1end = zonedWallTime(YVR, 2026, 7, 10, 12, 0) // ~15:00 EDT / 12:00 PDT
    const d1 = duty('d1', d1start, d1end, HOME, YVR)

    // Day 2 morning report YVR after ~16 h layover — still < 72 h → accl Toronto
    const d2report = zonedWallTime(YVR, 2026, 7, 11, 6, 0)
    const res = resolveAcclimatizedTZ({
      homeBaseTZ: HOME,
      priorDuties: [d1],
      at: d2report,
      localTZ: YVR,
    })

    expect(res.acclTZ).toBe(HOME)
    expect(res.acclimatizedToLocal).toBe(false)
    expect(res.hoursRequired).toBe(72) // 3 h zone diff
    expect(res.hoursInLocal).toBeGreaterThan(10)
    expect(res.hoursInLocal).toBeLessThan(72)
  })

  it('re-acclimatizes after 72 h in the new zone (< 4 h diff)', () => {
    const d1start = zonedWallTime(HOME, 2026, 7, 1, 8, 0)
    const d1end = zonedWallTime(YVR, 2026, 7, 1, 12, 0)
    const d1 = duty('d1', d1start, d1end, HOME, YVR)

    // Still in Vancouver 80 h later
    const later = new Date(d1end.getTime() + 80 * 3_600_000)
    const res = resolveAcclimatizedTZ({
      homeBaseTZ: HOME,
      priorDuties: [d1],
      at: later,
      localTZ: YVR,
    })
    expect(res.acclTZ).toBe(YVR)
    expect(res.acclimatizedToLocal).toBe(true)
  })

  it('does not jump to each night’s layover zone on a multi-city trip', () => {
    // Night 1 YVR, night 2 YYC — both short stays; stay on Toronto accl
    const d1 = duty(
      'd1',
      zonedWallTime(HOME, 2026, 7, 10, 7, 0),
      zonedWallTime(YVR, 2026, 7, 10, 11, 0),
      HOME,
      YVR,
    )
    const d2 = duty(
      'd2',
      zonedWallTime(YVR, 2026, 7, 11, 6, 0),
      zonedWallTime(YYC, 2026, 7, 11, 10, 0),
      YVR,
      YYC,
    )
    const d3report = zonedWallTime(YYC, 2026, 7, 12, 5, 30)
    const res = resolveAcclimatizedTZ({
      homeBaseTZ: HOME,
      priorDuties: [d1, d2],
      at: d3report,
      localTZ: YYC,
    })
    expect(res.acclTZ).toBe(HOME)
    expect(res.acclimatizedToLocal).toBe(false)
  })
})

describe('Max FDP uses acclimatized hour not dep local', () => {
  it('early local Vancouver report still uses Toronto table row when not re-acclimatized', () => {
    // Prior: arrived YVR previous day
    const prior = duty(
      'd1',
      zonedWallTime(HOME, 2026, 7, 10, 8, 0),
      zonedWallTime(YVR, 2026, 7, 10, 12, 0),
      HOME,
      YVR,
    )
    // Report ~05:00 Vancouver local = 08:00 Toronto
    // If wrongly used Vancouver 05:00 → max 11 h; Toronto 08:00 → max 13 h (≥50, 1 sector)
    const dep = zonedWallTime(YVR, 2026, 7, 11, 6, 0) // report 05:00 with 60 min buffer
    // Use CYVR→CYYC for airports
    const r = deriveFdpFromFlights({
      flights: [
        leg({
          id: '1',
          depIcao: 'CYVR',
          arrIcao: 'CYYC',
          dep,
          arr: zonedWallTime(YYC, 2026, 7, 11, 9, 0),
        }),
      ],
      regulator: 'TC',
      homeBaseTZ: HOME,
      priorDuties: [prior],
    })
    expect(r.ok).toBe(true)
    expect(r.acclTZ).toBe(HOME)
    // Local hour at report (dep−60m) is ~05 Vancouver; acclimatized ~08 Toronto
    expect(r.localStartHour).toBe(5)
    expect(r.acclimatizedStartHour).toBe(8)
    expect(r.maxFdpHours).toBe(13) // 07–12 slot, not early 05:00 row
  })
})

describe('restampDutyAcclimatization', () => {
  it('writes acclTZ on each duty from the walk', () => {
    const d1 = duty(
      'd1',
      zonedWallTime(HOME, 2026, 7, 10, 8, 0),
      zonedWallTime(YVR, 2026, 7, 10, 12, 0),
      HOME,
      YVR,
      'UTC', // stale
    )
    const d2 = duty(
      'd2',
      zonedWallTime(YVR, 2026, 7, 11, 6, 0),
      zonedWallTime(YVR, 2026, 7, 11, 14, 0),
      YVR,
      YVR,
      'UTC',
    )
    const out = restampDutyAcclimatization([d1, d2], HOME)
    const o1 = out.find((e) => e.id === 'd1')!
    const o2 = out.find((e) => e.id === 'd2')!
    expect(o1.acclTZ).toBe(HOME)
    expect(o2.acclTZ).toBe(HOME)
  })
})
