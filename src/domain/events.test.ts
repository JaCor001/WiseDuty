import { describe, expect, it } from 'vitest'
import {
  lastFdpArrivalIcao,
  maybeBuildLnrBetween,
  phantomDisruptiveRestExtension,
  recomputeAfterDutyChange,
  recomputeAfterDutyDelete,
  recomputeLocalNightRests,
  recomputeScheduleCompliance,
  removeDutyAndRelated,
  restIdForDuty,
  stripAllLnr,
} from './events'
import type { DutyEvent } from './types'
import { zonedWallTime } from './time'

const TZ = 'UTC'
const HOME = 'America/Toronto'

function at(y: number, mo: number, d: number, h: number, mi = 0): Date {
  return zonedWallTime(TZ, y, mo, d, h, mi)
}

function duty(id: string, start: Date, end: Date): DutyEvent {
  return { id, title: 'Duty', start, end, type: 'duty', acclTZ: TZ }
}

function earlyHome(id: string, day: number): DutyEvent {
  return {
    id,
    title: 'Duty',
    start: zonedWallTime(HOME, 2024, 6, day, 4, 0),
    end: zonedWallTime(HOME, 2024, 6, day, 12, 0),
    type: 'duty',
    acclTZ: HOME,
    startTZ: HOME,
    endTZ: HOME,
  }
}

describe('lastFdpArrivalIcao', () => {
  it('returns last flight arrival of the latest prior FDP', () => {
    const d1: DutyEvent = {
      id: 'd1',
      title: 'Duty',
      type: 'duty',
      start: at(2026, 7, 10, 8),
      end: at(2026, 7, 10, 16),
      acclTZ: TZ,
      flights: [
        {
          id: 'f1',
          depIcao: 'CYUL',
          arrIcao: 'CYYZ',
          dep: at(2026, 7, 10, 9),
          arr: at(2026, 7, 10, 10),
          isDeadhead: false,
        },
        {
          id: 'f2',
          depIcao: 'CYYZ',
          arrIcao: 'CYVR',
          dep: at(2026, 7, 10, 12),
          arr: at(2026, 7, 10, 15),
          isDeadhead: false,
        },
      ],
    }
    const d2: DutyEvent = {
      id: 'd2',
      title: 'Duty',
      type: 'duty',
      start: at(2026, 7, 11, 8),
      end: at(2026, 7, 11, 14),
      acclTZ: TZ,
      flights: [
        {
          id: 'f3',
          depIcao: 'CYVR',
          arrIcao: 'CYYC',
          dep: at(2026, 7, 11, 9),
          arr: at(2026, 7, 11, 11),
          isDeadhead: false,
        },
      ],
    }
    expect(lastFdpArrivalIcao([d1, d2])).toBe('CYYC')
    expect(lastFdpArrivalIcao([d1, d2], { excludeId: 'd2' })).toBe('CYVR')
  })

  it('returns undefined when no flight legs exist', () => {
    expect(lastFdpArrivalIcao([duty('x', at(2026, 7, 1, 8), at(2026, 7, 1, 16))])).toBe(
      undefined,
    )
  })
})

describe('maybeBuildLnrBetween / recomputeLocalNightRests', () => {
  it('builds LNR for Late → Early (not only Night → Early)', () => {
    const late = duty('l', at(2024, 6, 10, 18, 0), at(2024, 6, 11, 1, 0))
    const early = duty('e', at(2024, 6, 11, 5, 0), at(2024, 6, 11, 12, 0))
    const lnr = maybeBuildLnrBetween(late, early, 'TC', TZ, [late, early])
    expect(lnr).not.toBeNull()
    expect(lnr!.isLocalNightRest).toBe(true)
    // Short gap → violated
    expect(lnr!.violated).toBe(true)
    expect(lnr!.title).toMatch(/not met/i)
    expect(lnr!.title).toMatch(/700\.4/)
  })

  it('labels compliant LNR without violation wording', () => {
    const night = duty('n', at(2024, 6, 10, 22, 0), at(2024, 6, 11, 6, 0))
    const early = duty('e', at(2024, 6, 13, 5, 0), at(2024, 6, 13, 12, 0))
    const lnr = maybeBuildLnrBetween(night, early, 'TC', TZ, [night, early])
    expect(lnr).not.toBeNull()
    expect(lnr!.violated).toBe(false)
    expect(lnr!.title).toBe('Local Night Rest (CAR 700.41)')
  })

  it('builds LNR for Early → Night', () => {
    const early = duty('e', at(2024, 6, 10, 5, 0), at(2024, 6, 10, 12, 0))
    const night = duty('n', at(2024, 6, 10, 22, 0), at(2024, 6, 11, 6, 0))
    const lnr = maybeBuildLnrBetween(early, night, 'TC', TZ, [early, night])
    expect(lnr).not.toBeNull()
  })

  it('does not build LNR for normal day → day', () => {
    const a = duty('a', at(2024, 6, 10, 9, 0), at(2024, 6, 10, 15, 0))
    const b = duty('b', at(2024, 6, 11, 9, 0), at(2024, 6, 11, 15, 0))
    expect(maybeBuildLnrBetween(a, b, 'TC', TZ, [a, b])).toBeNull()
  })

  it('strips legacy separate LNR bars but keeps duty-linked rests', () => {
    const night = duty('n', at(2024, 6, 10, 22, 0), at(2024, 6, 11, 6, 0))
    const early = duty('e', at(2024, 6, 13, 5, 0), at(2024, 6, 13, 12, 0))
    const withStale: DutyEvent[] = [
      night,
      early,
      {
        id: 'stale-lnr',
        title: 'Local Night Rest',
        start: night.end,
        end: early.start,
        type: 'rest',
        isLocalNightRest: true,
        violated: true,
      },
      {
        id: restIdForDuty('n'),
        title: 'Required Rest',
        start: night.end,
        end: at(2024, 6, 11, 18, 0),
        type: 'rest',
        isLocalNightRest: true,
        restKind: 'lnr_disruptive',
        restRule: 'CAR 700.41',
        requiredLocalNights: 1,
      },
    ]
    const next = recomputeLocalNightRests(withStale, 'TC', TZ)
    expect(next.some((e) => e.id === 'stale-lnr')).toBe(false)
    expect(next.some((e) => e.id === restIdForDuty('n'))).toBe(true)
    expect(stripAllLnr(next).every((e) => e.id.endsWith('-rest') || e.type === 'duty')).toBe(
      true,
    )
  })
})

describe('phantomDisruptiveRestExtension (700.41 what-if)', () => {
  it('after early duty alone, phantom extends to one LNR end', () => {
    const early: DutyEvent = {
      id: 'e',
      title: 'Duty',
      start: zonedWallTime(HOME, 2024, 6, 10, 5, 0),
      end: zonedWallTime(HOME, 2024, 6, 10, 12, 0),
      type: 'duty',
      acclTZ: HOME,
      startTZ: HOME,
      endTZ: HOME,
    }
    const state = recomputeScheduleCompliance([early], 'TC', HOME, HOME)
    const rest = state.find((e) => e.id === restIdForDuty('e'))!
    expect(rest.requiredLocalNights ?? 0).toBe(0)
    const phantom = phantomDisruptiveRestExtension(
      early,
      rest,
      'TC',
      HOME,
      null,
    )
    expect(phantom).not.toBeNull()
    // Release 12:00 → earliest LNR completes 07:30 next day
    expect(phantom!.end.getTime()).toBe(
      zonedWallTime(HOME, 2024, 6, 11, 7, 30).getTime(),
    )
    expect(phantom!.end.getTime()).toBeGreaterThan(rest.end.getTime())
    expect(phantom!.thisDutyLabel).toBe('early')
    expect(phantom!.ifNextLabel).toMatch(/night or late/i)
  })

  it('after night duty alone, phantom is for early next', () => {
    const night: DutyEvent = {
      id: 'n',
      title: 'Duty',
      start: zonedWallTime(HOME, 2024, 6, 10, 18, 0),
      end: zonedWallTime(HOME, 2024, 6, 11, 4, 0),
      type: 'duty',
      acclTZ: HOME,
      startTZ: HOME,
      endTZ: HOME,
    }
    const state = recomputeScheduleCompliance([night], 'TC', HOME, HOME)
    const rest = state.find((e) => e.id === restIdForDuty('n'))!
    const phantom = phantomDisruptiveRestExtension(
      night,
      rest,
      'TC',
      HOME,
      null,
    )
    expect(phantom).not.toBeNull()
    expect(phantom!.thisDutyLabel).toBe('night')
    expect(phantom!.ifNextLabel).toBe('early')
    expect(phantom!.end.getTime()).toBeGreaterThan(rest.end.getTime())
    expect(phantom!.reason).toMatch(/Because this duty is night/i)
    expect(phantom!.reason).toMatch(/if the next duty is early/i)
  })

  it('no phantom when next duty already triggers real 700.41 LNR', () => {
    const night: DutyEvent = {
      id: 'n',
      title: 'Duty',
      start: zonedWallTime(HOME, 2024, 6, 10, 22, 0),
      end: zonedWallTime(HOME, 2024, 6, 11, 6, 0),
      type: 'duty',
      acclTZ: HOME,
      startTZ: HOME,
      endTZ: HOME,
    }
    const early: DutyEvent = {
      id: 'e',
      title: 'Duty',
      start: zonedWallTime(HOME, 2024, 6, 13, 5, 0),
      end: zonedWallTime(HOME, 2024, 6, 13, 12, 0),
      type: 'duty',
      acclTZ: HOME,
      startTZ: HOME,
      endTZ: HOME,
    }
    const state = recomputeScheduleCompliance([night, early], 'TC', HOME, HOME)
    const restN = state.find((e) => e.id === restIdForDuty('n'))!
    expect(restN.restRule).toBe('CAR 700.41')
    const phantom = phantomDisruptiveRestExtension(
      night,
      restN,
      'TC',
      HOME,
      early,
    )
    expect(phantom).toBeNull()
  })

  it('no phantom after plain day duty', () => {
    const day: DutyEvent = {
      id: 'd',
      title: 'Duty',
      start: zonedWallTime(HOME, 2024, 6, 10, 9, 0),
      end: zonedWallTime(HOME, 2024, 6, 10, 17, 0),
      type: 'duty',
      acclTZ: HOME,
      startTZ: HOME,
      endTZ: HOME,
    }
    const state = recomputeScheduleCompliance([day], 'TC', HOME, HOME)
    const rest = state.find((e) => e.id === restIdForDuty('d'))!
    expect(
      phantomDisruptiveRestExtension(day, rest, 'TC', HOME, null),
    ).toBeNull()
  })
})

describe('single rest per FDP (merged LNR)', () => {
  it('creates one rest bar after disruptive night with 700.41 LNR, not two', () => {
    // Night duty: start evening, end morning
    const n: DutyEvent = {
      id: 'n',
      title: 'Duty',
      start: zonedWallTime(HOME, 2024, 6, 10, 22, 0),
      end: zonedWallTime(HOME, 2024, 6, 11, 6, 0),
      type: 'duty',
      acclTZ: HOME,
      startTZ: HOME,
      endTZ: HOME,
    }
    // Early two days later so gap can fit LNR + 12h
    const e: DutyEvent = {
      id: 'e',
      title: 'Duty',
      start: zonedWallTime(HOME, 2024, 6, 13, 5, 0),
      end: zonedWallTime(HOME, 2024, 6, 13, 12, 0),
      type: 'duty',
      acclTZ: HOME,
      startTZ: HOME,
      endTZ: HOME,
    }
    const state = recomputeScheduleCompliance([n, e], 'TC', HOME, HOME)
    const rests = state.filter((x) => x.type === 'rest')
    // One rest per duty only
    expect(rests).toHaveLength(2)
    expect(rests.every((r) => r.id.endsWith('-rest'))).toBe(true)
    const restN = rests.find((r) => r.id === restIdForDuty('n'))!
    expect(restN.restRule).toBe('CAR 700.41')
    expect(restN.requiredLocalNights).toBe(1)
    // No floating auto-LNR
    expect(rests.some((r) => !r.id.endsWith('-rest'))).toBe(false)
  })

  it('ends LNR rest at earliest next-FDP time (e.g. 07:30), not always 09:30', () => {
    // Release 22:00 → 9 h from 22:30 completes at 07:30; 12 h clock ends 10:00
    // so final end = max(10:00, 07:30) = 10:00 when only clock wins...
    // Use 10+travel base so clock is 10h → 08:00; LNR 07:30 → end 08:00 still clock.
    // Pure LNR sizing: restHours 0 not possible. Check earliestLocalNightsRestEnd via plan:
    // Release after short day 18:00 with 12h → 06:00 next; LNR needs 07:30 → end 07:30.
    const d: DutyEvent = {
      id: 'd',
      title: 'Duty',
      start: zonedWallTime(HOME, 2024, 6, 10, 8, 0),
      end: zonedWallTime(HOME, 2024, 6, 10, 18, 0),
      type: 'duty',
      acclTZ: HOME,
      startTZ: HOME,
      endTZ: HOME,
    }
    // Force 700.51 with three earlys including this as third
    const a = earlyHome('a', 8)
    const b = earlyHome('b', 9)
    // d is day duty not WOCL — use third early instead
    const c = earlyHome('c', 10)
    const state = recomputeScheduleCompliance([a, b, c], 'TC', HOME, HOME)
    const restC = state.find((e) => e.id === restIdForDuty('c'))!
    expect(restC.requiredLocalNights).toBe(1)
    // Release 12:00 → LNR window 22:30→07:30 next = earliest LNR end 07:30
    // Clock 12h from 12:00 = 00:00 next day; LNR 07:30 wins → end at 07:30
    const endParts = {
      h: restC.end.getHours(), // browser local — bad for TZ
    }
    void endParts
    void d
    // Use zoned comparison via rest duration vs known wall times
    const expectedEarliest = zonedWallTime(HOME, 2024, 6, 11, 7, 30)
    // end should be >= 07:30 Jun 11 and equal to max(12h from noon, 07:30)
    // noon + 12h = midnight Jun 11; max(midnight, 07:30) = 07:30 Jun 11
    expect(restC.end.getTime()).toBe(expectedEarliest.getTime())
  })
})

describe('recomputeScheduleCompliance (order-independent 700.51)', () => {
  it('adds 700.51 LNR on duty 3 after duties entered out of chronological order', () => {
    // Entry order: day 10, day 12, then day 11 (middle) — full recompute must flag day 12.
    const d1 = earlyHome('1', 10)
    const d3 = earlyHome('3', 12)
    const d2 = earlyHome('2', 11)

    let state: DutyEvent[] = []
    state = recomputeAfterDutyChange(state, d1, 'TC', HOME, HOME, '12h')
    state = recomputeAfterDutyChange(state, d3, 'TC', HOME, HOME, '12h')
    // After only 2 WOCL duties, neither should require 700.51
    expect(
      state.find((e) => e.id === restIdForDuty('3'))?.restRule,
    ).not.toBe('CAR 700.51')

    state = recomputeAfterDutyChange(state, d2, 'TC', HOME, HOME, '12h')
    const rest3 = state.find((e) => e.id === restIdForDuty('3'))
    expect(rest3).toBeDefined()
    expect(rest3!.restRule).toBe('CAR 700.51')
    expect(rest3!.requiredLocalNights).toBe(1)
    expect(rest3!.isLocalNightRest).toBe(true)
  })

  it('removes 700.51 LNR when a consecutive WOCL duty is deleted', () => {
    const d1 = earlyHome('1', 10)
    const d2 = earlyHome('2', 11)
    const d3 = earlyHome('3', 12)

    let state = recomputeScheduleCompliance(
      [d1, d2, d3],
      'TC',
      HOME,
      HOME,
    )
    expect(
      state.find((e) => e.id === restIdForDuty('3'))?.restRule,
    ).toBe('CAR 700.51')

    // Delete middle duty → only 2 consecutive WOCL remain → waive 700.51
    state = recomputeAfterDutyDelete(
      removeDutyAndRelated(state, d2),
      'TC',
      HOME,
      HOME,
    )
    const rest3 = state.find((e) => e.id === restIdForDuty('3'))
    expect(rest3).toBeDefined()
    expect(rest3!.restRule).not.toBe('CAR 700.51')
    expect(rest3!.requiredLocalNights ?? 0).toBe(0)
    expect(rest3!.isLocalNightRest).toBeFalsy()

    // Delete first of three also waives if only two remain... already two.
    // Rebuild three, delete first:
    state = recomputeScheduleCompliance([d1, d2, d3], 'TC', HOME, HOME)
    state = recomputeAfterDutyDelete(
      removeDutyAndRelated(state, d1),
      'TC',
      HOME,
      HOME,
    )
    expect(
      state.find((e) => e.id === restIdForDuty('3'))?.restRule,
    ).not.toBe('CAR 700.51')
  })

  it('removes 700.51 when the third WOCL duty itself is deleted', () => {
    const d1 = earlyHome('1', 10)
    const d2 = earlyHome('2', 11)
    const d3 = earlyHome('3', 12)
    let state = recomputeScheduleCompliance([d1, d2, d3], 'TC', HOME, HOME)
    state = recomputeAfterDutyDelete(
      removeDutyAndRelated(state, d3),
      'TC',
      HOME,
      HOME,
    )
    expect(state.find((e) => e.id === restIdForDuty('3'))).toBeUndefined()
    expect(
      state.find((e) => e.id === restIdForDuty('2'))?.restRule,
    ).not.toBe('CAR 700.51')
  })
})

describe('recomputeScheduleCompliance (700.29 SDF → 2×LNR rest)', () => {
  function dayDuty(id: string, day: number, y = 2026, mo = 7): DutyEvent {
    return {
      id,
      title: 'Duty',
      start: zonedWallTime(HOME, y, mo, day, 7, 0),
      end: zonedWallTime(HOME, y, mo, day, 14, 0),
      type: 'duty',
      acclTZ: HOME,
      startTZ: HOME,
      endTZ: HOME,
    }
  }

  it('after five consecutive FDPs, shows SDF rest when another FDP would leave no room for free day', () => {
    // Open end — hypothetical next morning would close the free-day window → SDF rest like RR
    const duties = [20, 21, 22, 23, 24].map((d) => dayDuty(`d${d}`, d))
    const state = recomputeScheduleCompliance(duties, 'TC', HOME, HOME)
    const restLast = state.find((e) => e.id === restIdForDuty('d24'))!
    expect(restLast.restRule).toBe('CAR 700.29')
    expect(restLast.requiredLocalNights).toBe(2)
    expect(restLast.title).toMatch(/SDF/)
    // Earliest free day from day 24 14:00 → 07:30 day 26
    expect(restLast.end.getTime()).toBe(
      zonedWallTime(HOME, 2026, 7, 26, 7, 30).getTime(),
    )
    // Mid-block rest stays ordinary
    const rest23 = state.find((e) => e.id === restIdForDuty('d23'))!
    expect(rest23.restRule).not.toBe('CAR 700.29')
  })

  it('extends rest to SDF when gap to next is short and free day cannot wait after next', () => {
    const duties = [20, 21, 22, 23, 24].map((d) => dayDuty(`d${d}`, d))
    duties.push(dayDuty('d25', 25))
    const state = recomputeScheduleCompliance(duties, 'TC', HOME, HOME)
    const rest24 = state.find((e) => e.id === restIdForDuty('d24'))!
    expect(rest24.restRule).toBe('CAR 700.29')
    expect(rest24.requiredLocalNights).toBe(2)
    expect(rest24.end.getTime()).toBe(
      zonedWallTime(HOME, 2026, 7, 26, 7, 30).getTime(),
    )
  })

  it('keeps SDF rest when later FDP is scheduled after free day (gap still needs free day)', () => {
    // 5 consecutive days, then duty two days after free day would end — SDF must stay
    const block = [13, 14, 15, 16, 17].map((day) => ({
      id: `b${day}`,
      title: 'Duty',
      start: zonedWallTime(HOME, 2026, 7, day, 6, 0),
      end: zonedWallTime(HOME, 2026, 7, day, 18, 0),
      type: 'duty' as const,
      acclTZ: HOME,
      startTZ: HOME,
      endTZ: HOME,
    }))
    const later = {
      id: 'later',
      title: 'Duty',
      start: zonedWallTime(HOME, 2026, 7, 21, 7, 0),
      end: zonedWallTime(HOME, 2026, 7, 21, 13, 0),
      type: 'duty' as const,
      acclTZ: HOME,
      startTZ: HOME,
      endTZ: HOME,
    }
    const state = recomputeScheduleCompliance([...block, later], 'TC', HOME, HOME)
    const rest17 = state.find((e) => e.id === restIdForDuty('b17'))!
    expect(rest17.restRule).toBe('CAR 700.29')
    expect(rest17.requiredLocalNights).toBe(2)
    // Free day from Jul 17 18:00 → earliest end Jul 19 07:30
    expect(rest17.end.getTime()).toBe(
      zonedWallTime(HOME, 2026, 7, 19, 7, 30).getTime(),
    )
    // Later duty is after free day — rest is met, not violated
    expect(rest17.violated).toBeFalsy()
  })

  it('does not force free day between consecutive days when free day still fits after next FDP', () => {
    const block = [13, 14, 15, 16, 17].map((day) => ({
      id: `b${day}`,
      title: 'Duty',
      start: zonedWallTime(HOME, 2026, 7, day, 6, 0),
      end: zonedWallTime(HOME, 2026, 7, day, 17, 0),
      type: 'duty' as const,
      acclTZ: HOME,
      startTZ: HOME,
      endTZ: HOME,
    }))
    block[4] = {
      id: 'b17',
      title: 'Duty',
      start: zonedWallTime(HOME, 2026, 7, 17, 7, 0),
      end: zonedWallTime(HOME, 2026, 7, 17, 15, 0),
      type: 'duty',
      acclTZ: HOME,
      startTZ: HOME,
      endTZ: HOME,
    }
    const later = dayDuty('later', 21)
    const state = recomputeScheduleCompliance([...block, later], 'TC', HOME, HOME)
    const rest16 = state.find((e) => e.id === restIdForDuty('b16'))!
    expect(rest16.restRule).not.toBe('CAR 700.29')
    expect(rest16.requiredLocalNights ?? 0).toBe(0)
    expect(rest16.end.getTime()).toBeLessThanOrEqual(
      zonedWallTime(HOME, 2026, 7, 17, 7, 0).getTime(),
    )
  })

  it('does not attach SDF rest after a single short duty', () => {
    const d = dayDuty('only', 20)
    const state = recomputeScheduleCompliance([d], 'TC', HOME, HOME)
    const rest = state.find((e) => e.id === restIdForDuty('only'))!
    expect(rest.restRule).not.toBe('CAR 700.29')
    expect(rest.requiredLocalNights ?? 0).toBe(0)
  })

  it('does not attach SDF rest when a free day already covers the 168 h window', () => {
    const free: DutyEvent = {
      id: 'f',
      title: 'Free',
      start: zonedWallTime(HOME, 2026, 7, 17, 18, 0),
      end: zonedWallTime(HOME, 2026, 7, 19, 12, 0),
      type: 'free',
      acclTZ: HOME,
      workFactor: 0,
    }
    const duties = [20, 21, 22].map((d) => dayDuty(`d${d}`, d))
    const state = recomputeScheduleCompliance(
      [free, ...duties],
      'TC',
      HOME,
      HOME,
    )
    const restLast = state.find((e) => e.id === restIdForDuty('d22'))!
    expect(restLast.restRule).not.toBe('CAR 700.29')
    expect(restLast.requiredLocalNights ?? 0).toBeLessThan(2)
  })

  it('upgrades 700.51 LNR to 2 nights when next FDP blocks free day and structure is due', () => {
    const duties = [20, 21, 22, 23, 24].map((day) => ({
      id: `e${day}`,
      title: 'Duty',
      start: zonedWallTime(HOME, 2026, 7, day, 4, 0),
      end: zonedWallTime(HOME, 2026, 7, day, 12, 0),
      type: 'duty' as const,
      acclTZ: HOME,
      startTZ: HOME,
      endTZ: HOME,
    }))
    duties.push({
      id: 'e25',
      title: 'Duty',
      start: zonedWallTime(HOME, 2026, 7, 25, 4, 0),
      end: zonedWallTime(HOME, 2026, 7, 25, 12, 0),
      type: 'duty',
      acclTZ: HOME,
      startTZ: HOME,
      endTZ: HOME,
    })
    const state = recomputeScheduleCompliance(duties, 'TC', HOME, HOME)
    const rest24 = state.find((e) => e.id === restIdForDuty('e24'))!
    expect(rest24.requiredLocalNights).toBe(2)
    expect(rest24.restRule).toBe('CAR 700.29')
  })
})
