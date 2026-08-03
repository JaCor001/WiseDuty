import { describe, expect, it } from 'vitest'
import {
  buildPreferredHostMap,
} from './marker-layout'
import { buildScheduleLayout } from './calendar-day-layout'
import type { DutyEvent } from './types'
import type { DisplaySdf } from './rest-70029'
import { startOfDayInTimeZone } from './time'

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
