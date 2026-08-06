import { describe, expect, it } from 'vitest'
import {
  buildPreferredHostMap,
} from './marker-layout'
import { buildScheduleLayout } from './calendar-day-layout'
import type { DutyEvent } from './types'
import type { DisplaySdf } from './rest-70029'
import { startOfDayInTimeZone, zonedWallTime } from './time'

const TZ = 'America/Toronto'

function restSdf(): DutyEvent {
  // Structural free-day rest covering nights Jul 10–11 (matches user case shape)
  return {
    id: 'rest-sdf',
    title: 'Required Rest — SDF (2× local night, 700.29)',
    type: 'rest',
    start: new Date('2026-07-10T22:00:00.000Z'), // 18:00 Toronto EDT
    end: new Date('2026-07-12T11:30:00.000Z'), // 07:30 Toronto
    restRule: 'CAR 700.29',
    requiredLocalNights: 2,
    isLocalNightRest: true,
    restKind: 'sdf_structure',
  }
}

function matchingDisplaySdf(): DisplaySdf {
  return {
    sdf: {
      start: new Date('2026-07-11T02:30:00.000Z'), // 22:30 Toronto Jul 10
      end: new Date('2026-07-12T11:30:00.000Z'), // 07:30 Toronto Jul 12
      acclTZ: TZ,
      nights: [
        {
          start: new Date('2026-07-11T02:30:00.000Z'),
          end: new Date('2026-07-11T11:30:00.000Z'),
          windowKey: '2026-07-10',
          acclTZ: TZ,
        },
        {
          start: new Date('2026-07-12T02:30:00.000Z'),
          end: new Date('2026-07-12T11:30:00.000Z'),
          windowKey: '2026-07-11',
          acclTZ: TZ,
        },
      ],
    },
    reasons: ['load_bearing'],
  }
}

describe('calendar-day-layout near-midnight stamps', () => {
  it('shows the end stamp when rest ends a few minutes after midnight', () => {
    // Mirrors user case: rest 12:04 → 00:04 next day (Toronto)
    const rest: DutyEvent = {
      id: 'rest-near-midnight',
      title: 'Required Rest (12h)',
      type: 'rest',
      start: new Date('2026-07-15T16:04:00.000Z'), // 12:04 EDT
      end: new Date('2026-07-16T04:04:00.000Z'), // 00:04 EDT next day
      restRule: 'CAR 700.40',
      restKind: 'base',
      requiredRestHours: 12,
    }
    const days = [
      startOfDayInTimeZone(new Date('2026-07-15T12:00:00.000Z'), TZ),
      startOfDayInTimeZone(new Date('2026-07-16T12:00:00.000Z'), TZ),
    ]
    const hostMap = buildPreferredHostMap(
      [{ id: rest.id, start: rest.start, end: rest.end }],
      TZ,
    )
    const { byKey } = buildScheduleLayout(
      days,
      days[0],
      [rest],
      [],
      TZ,
      'TC',
      TZ,
      hostMap,
      [],
      [],
    )
    const jul15 = byKey.get('2026-07-15')!
    const jul16 = byKey.get('2026-07-16')!
    expect(jul15).toBeTruthy()
    expect(jul16).toBeTruthy()

    // Start on the 15th
    const startStamps = jul15.timeStamps.filter((t) =>
      t.eventIds.includes(rest.id),
    )
    expect(startStamps.some((t) => t.label.includes('12:04') || t.atMs === rest.start.getTime())).toBe(
      true,
    )

    // End on the 16th even though the bar is only ~4 minutes (~0.28% width)
    const endStamps = jul16.timeStamps.filter((t) =>
      t.eventIds.includes(rest.id),
    )
    expect(endStamps.length).toBeGreaterThanOrEqual(1)
    expect(endStamps.some((t) => t.atMs === rest.end.getTime())).toBe(true)
    // Anchor near left edge of the end day (just after midnight; edge pad clamps ~2%)
    expect(endStamps[0].anchorLeftPct).toBeLessThanOrEqual(3)
  })
})

describe('calendar-day-layout flight legs', () => {
  it('draws darker flight segments inside a duty bar', () => {
    const duty: DutyEvent = {
      id: 'd1',
      title: 'Duty',
      type: 'duty',
      start: new Date('2026-07-10T12:00:00.000Z'), // 08:00 Toronto
      end: new Date('2026-07-10T22:00:00.000Z'), // 18:00 Toronto
      acclTZ: TZ,
      startTZ: TZ,
      endTZ: TZ,
      flights: [
        {
          id: 'f1',
          depIcao: 'CYYZ',
          arrIcao: 'CYUL',
          dep: new Date('2026-07-10T13:00:00.000Z'),
          arr: new Date('2026-07-10T14:30:00.000Z'),
          isDeadhead: false,
        },
        {
          id: 'f2',
          depIcao: 'CYUL',
          arrIcao: 'CYYZ',
          dep: new Date('2026-07-10T18:00:00.000Z'),
          arr: new Date('2026-07-10T19:30:00.000Z'),
          isDeadhead: true,
        },
      ],
    }
    const days = [startOfDayInTimeZone(new Date('2026-07-10T12:00:00.000Z'), TZ)]
    const hostMap = buildPreferredHostMap(
      [{ id: duty.id, start: duty.start, end: duty.end }],
      TZ,
    )
    const { byKey } = buildScheduleLayout(
      days,
      days[0],
      [duty],
      [],
      TZ,
      'TC',
      TZ,
      hostMap,
      [],
      [],
    )
    const day = [...byKey.values()][0]
    const dutyBars = day.bars.filter((b) => b.className.includes('duty'))
    const flightBars = day.bars.filter((b) => b.className.includes('flight-leg'))
    expect(dutyBars.length).toBe(1)
    expect(flightBars.length).toBe(2)
    expect(flightBars.some((b) => b.className.includes('flight-leg--dh'))).toBe(
      true,
    )
    expect(flightBars[0].title).toContain('CYYZ→CYUL')
  })
})

describe('calendar-day-layout SDF dedupe', () => {
  it('shows one SDF chip when structural rest already covers a displaySdf', () => {
    const rest = restSdf()
    const display = matchingDisplaySdf()
    const events: DutyEvent[] = [rest]
    const restIntervals = [{ id: rest.id, start: rest.start, end: rest.end }]
    const sdfIntervals = [
      {
        id: `sdf-${display.sdf.start.toISOString()}-0`,
        start: display.sdf.start,
        end: display.sdf.end,
      },
    ]
    const hostMap = buildPreferredHostMap(
      [...restIntervals, ...sdfIntervals],
      TZ,
    )
    const days = [
      startOfDayInTimeZone(new Date('2026-07-10T12:00:00.000Z'), TZ),
      startOfDayInTimeZone(new Date('2026-07-11T12:00:00.000Z'), TZ),
      startOfDayInTimeZone(new Date('2026-07-12T12:00:00.000Z'), TZ),
    ]
    const { byKey } = buildScheduleLayout(
      days,
      days[0],
      events,
      [display],
      TZ,
      'TC',
      TZ,
      hostMap,
      [],
      [],
    )

    const allSdf = [...byKey.values()].flatMap((d) =>
      d.markers.filter((m) => m.type === 'SDF'),
    )
    expect(allSdf).toHaveLength(1)
    // Enriched with displaySdf sheet metadata (not a bare rest-only chip)
    expect(allSdf[0].sheet).toBe('sdf')
    expect(allSdf[0].sdfStartMs).toBe(display.sdf.start.getTime())
    expect(allSdf[0].sdfReasons).toEqual(['load_bearing'])
    // Still tied to the structural rest event id
    expect(allSdf[0].eventId).toBe(rest.id)
  })

  it('still shows a standalone displaySdf when no structural rest covers it', () => {
    const display = matchingDisplaySdf()
    const sdfId = `sdf-${display.sdf.start.toISOString()}-0`
    const hostMap = buildPreferredHostMap(
      [{ id: sdfId, start: display.sdf.start, end: display.sdf.end }],
      TZ,
    )
    const days = [
      startOfDayInTimeZone(new Date('2026-07-10T12:00:00.000Z'), TZ),
      startOfDayInTimeZone(new Date('2026-07-11T12:00:00.000Z'), TZ),
      startOfDayInTimeZone(new Date('2026-07-12T12:00:00.000Z'), TZ),
    ]
    const { byKey } = buildScheduleLayout(
      days,
      days[0],
      [],
      [display],
      TZ,
      'TC',
      TZ,
      hostMap,
      [],
      [],
    )
    const allSdf = [...byKey.values()].flatMap((d) =>
      d.markers.filter((m) => m.type === 'SDF'),
    )
    expect(allSdf).toHaveLength(1)
    expect(allSdf[0].eventId).toBe(sdfId)
    expect(allSdf[0].sheet).toBe('sdf')
  })
})

describe('calendar-day-layout day status color', () => {
  it('does not purple-tint empty days that only host an awareness SDF', () => {
    const display = matchingDisplaySdf()
    const sdfId = `sdf-${display.sdf.start.toISOString()}-0`
    const hostMap = buildPreferredHostMap(
      [{ id: sdfId, start: display.sdf.start, end: display.sdf.end }],
      TZ,
    )
    const days = [
      startOfDayInTimeZone(new Date('2026-07-10T12:00:00.000Z'), TZ),
      startOfDayInTimeZone(new Date('2026-07-11T12:00:00.000Z'), TZ),
      startOfDayInTimeZone(new Date('2026-07-12T12:00:00.000Z'), TZ),
    ]
    const { byKey } = buildScheduleLayout(
      days,
      days[0],
      [],
      [display],
      TZ,
      'TC',
      TZ,
      hostMap,
      [],
      [],
    )
    for (const d of byKey.values()) {
      expect(d.status).toBe('white')
    }
  })

  it('purples only full civil days blocked by required rest', () => {
    // Free-day rest: Jul 10 18:00 → Jul 12 07:30 Toronto — only Jul 11 is fully blocked
    const rest = restSdf()
    const days = [
      startOfDayInTimeZone(new Date('2026-07-10T12:00:00.000Z'), TZ),
      startOfDayInTimeZone(new Date('2026-07-11T12:00:00.000Z'), TZ),
      startOfDayInTimeZone(new Date('2026-07-12T12:00:00.000Z'), TZ),
    ]
    const hostMap = buildPreferredHostMap(
      [{ id: rest.id, start: rest.start, end: rest.end }],
      TZ,
    )
    const { byKey } = buildScheduleLayout(
      days,
      days[0],
      [rest],
      [],
      TZ,
      'TC',
      TZ,
      hostMap,
      [],
      [],
    )
    expect(byKey.get('2026-07-10')?.status).toBe('white') // rest only evening
    expect(byKey.get('2026-07-11')?.status).toBe('amber') // full day inside rest
    expect(byKey.get('2026-07-12')?.status).toBe('white') // rest ends 07:30
  })

  it('does not purple a partial overnight 12 h rest day', () => {
    // Rest 18:00 → 06:00 next day — neither day is fully blocked
    const rest: DutyEvent = {
      id: 'r12',
      title: 'Required Rest (12h)',
      type: 'rest',
      start: new Date('2026-08-10T22:00:00.000Z'), // 18:00 EDT
      end: new Date('2026-08-11T10:00:00.000Z'), // 06:00 EDT
      restRule: 'CAR 700.40',
    }
    const days = [
      startOfDayInTimeZone(new Date('2026-08-10T12:00:00.000Z'), TZ),
      startOfDayInTimeZone(new Date('2026-08-11T12:00:00.000Z'), TZ),
    ]
    const hostMap = buildPreferredHostMap(
      [{ id: rest.id, start: rest.start, end: rest.end }],
      TZ,
    )
    const { byKey } = buildScheduleLayout(
      days,
      days[0],
      [rest],
      [],
      TZ,
      'TC',
      TZ,
      hostMap,
      [],
      [],
    )
    expect(byKey.get('2026-08-10')?.status).toBe('white')
    expect(byKey.get('2026-08-11')?.status).toBe('white')
  })

  it('does not purple a day that mixes reserve with rest', () => {
    const rest: DutyEvent = {
      id: 'r-rest',
      title: 'Required Rest after reserve',
      type: 'rest',
      start: new Date('2026-08-10T22:00:00.000Z'),
      end: new Date('2026-08-11T10:00:00.000Z'),
      restRule: 'CAR 700.40',
    }
    const reserve: DutyEvent = {
      id: 'rsv',
      title: 'Home Reserve',
      type: 'reserve',
      start: new Date('2026-08-10T10:00:00.000Z'),
      end: new Date('2026-08-10T22:00:00.000Z'),
      workFactor: 0.33,
    }
    const day = startOfDayInTimeZone(new Date('2026-08-10T12:00:00.000Z'), TZ)
    const hostMap = buildPreferredHostMap(
      [
        { id: reserve.id, start: reserve.start, end: reserve.end },
        { id: rest.id, start: rest.start, end: rest.end },
      ],
      TZ,
    )
    const { byKey } = buildScheduleLayout(
      [day],
      day,
      [reserve, rest],
      [],
      TZ,
      'TC',
      TZ,
      hostMap,
      [],
      [],
    )
    expect(byKey.get('2026-08-10')?.status).toBe('white')
  })
})

describe('calendar-day-layout ≈MAX marker tone', () => {
  it('uses amber class when within soft near-max band', () => {
    // 08:00–20:00 ≈ 12 h / 13 h max → ~1 h remaining → amber
    const d: DutyEvent = {
      id: 'near-amber',
      title: 'Flight Duty',
      type: 'duty',
      start: zonedWallTime(TZ, 2026, 8, 4, 8, 0),
      end: zonedWallTime(TZ, 2026, 8, 4, 20, 0),
      acclTZ: TZ,
      startTZ: TZ,
      endTZ: TZ,
      operatingSectors: 1,
      avgSectorTime: '>=50',
    }
    const day = startOfDayInTimeZone(zonedWallTime(TZ, 2026, 8, 4, 12, 0), TZ)
    const hostMap = buildPreferredHostMap(
      [{ id: d.id, start: d.start, end: d.end }],
      TZ,
    )
    const { byKey } = buildScheduleLayout(
      [day],
      day,
      [d],
      [],
      TZ,
      'TC',
      TZ,
      hostMap,
      [],
      [],
    )
    const near = byKey.get('2026-08-04')?.markers.find((m) => m.type === 'NEAR')
    expect(near).toBeTruthy()
    expect(near!.className).toContain('NEAR-amber')
    expect(near!.className).not.toContain('NEAR-danger')
    expect(near!.label).toMatch(/MAX/)
  })

  it('uses danger class and MAX! when past max FDP', () => {
    // 08:00–22:00 = 14 h > 13 h max
    const d: DutyEvent = {
      id: 'near-danger',
      title: 'Flight Duty',
      type: 'duty',
      start: zonedWallTime(TZ, 2026, 8, 4, 8, 0),
      end: zonedWallTime(TZ, 2026, 8, 4, 22, 0),
      acclTZ: TZ,
      startTZ: TZ,
      endTZ: TZ,
      operatingSectors: 1,
      avgSectorTime: '>=50',
    }
    const day = startOfDayInTimeZone(zonedWallTime(TZ, 2026, 8, 4, 12, 0), TZ)
    const hostMap = buildPreferredHostMap(
      [{ id: d.id, start: d.start, end: d.end }],
      TZ,
    )
    const { byKey } = buildScheduleLayout(
      [day],
      day,
      [d],
      [],
      TZ,
      'TC',
      TZ,
      hostMap,
      [],
      [],
    )
    const near = byKey.get('2026-08-04')?.markers.find((m) => m.type === 'NEAR')
    expect(near).toBeTruthy()
    expect(near!.className).toContain('NEAR-danger')
    expect(near!.label).toBe('MAX!')
  })
})


