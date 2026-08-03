import { describe, expect, it } from 'vitest'
import {
  shiftEventFormPayload,
  shiftWallTimeByCivilDays,
} from './clone-event'
import { parseZonedDateTime, toDateInputValueInTZ } from './time'

const TZ = 'America/Toronto'

describe('shiftWallTimeByCivilDays', () => {
  it('keeps wall-clock time when shifting +1 day', () => {
    const start = parseZonedDateTime('2026-08-03', '08:00', TZ)
    const shifted = shiftWallTimeByCivilDays(start, TZ, 1)
    expect(toDateInputValueInTZ(shifted, TZ)).toBe('2026-08-04')
    expect(shifted.getTime()).toBe(
      parseZonedDateTime('2026-08-04', '08:00', TZ).getTime(),
    )
  })

  it('preserves overnight span relative days', () => {
    const end = parseZonedDateTime('2026-08-04', '02:00', TZ)
    const shifted = shiftWallTimeByCivilDays(end, TZ, 2)
    expect(toDateInputValueInTZ(shifted, TZ)).toBe('2026-08-06')
  })

  it('returns a copy when dayDelta is 0', () => {
    const start = parseZonedDateTime('2026-08-03', '08:00', TZ)
    const shifted = shiftWallTimeByCivilDays(start, TZ, 0)
    expect(shifted.getTime()).toBe(start.getTime())
    expect(shifted).not.toBe(start)
  })
})

describe('shiftEventFormPayload', () => {
  it('shifts reserve start/end by civil days', () => {
    const payload = {
      eventKind: 'airport_reserve' as const,
      restType: '12h' as const,
      duty: {
        start: parseZonedDateTime('2026-08-03', '08:00', TZ),
        end: parseZonedDateTime('2026-08-03', '18:00', TZ),
        acclTZ: TZ,
        startTZ: TZ,
        endTZ: TZ,
        locationIcao: 'CYUL',
        eventKind: 'airport_reserve' as const,
      },
    }
    const shifted = shiftEventFormPayload(payload, 3)
    expect(toDateInputValueInTZ(shifted.duty.start, TZ)).toBe('2026-08-06')
    expect(toDateInputValueInTZ(shifted.duty.end, TZ)).toBe('2026-08-06')
    expect(shifted.duty.start.getTime()).toBe(
      parseZonedDateTime('2026-08-06', '08:00', TZ).getTime(),
    )
    expect(shifted.duty.end.getTime()).toBe(
      parseZonedDateTime('2026-08-06', '18:00', TZ).getTime(),
    )
  })

  it('shifts flight legs, report, release, and prefix reserve together', () => {
    const dep = parseZonedDateTime('2026-08-03', '10:00', TZ)
    const arr = parseZonedDateTime('2026-08-03', '12:00', 'America/Halifax')
    const report = parseZonedDateTime('2026-08-03', '09:00', TZ)
    const release = parseZonedDateTime('2026-08-03', '12:30', 'America/Halifax')
    const rsvStart = parseZonedDateTime('2026-08-03', '06:00', TZ)
    const rsvEnd = parseZonedDateTime('2026-08-03', '09:00', TZ)

    const payload = {
      eventKind: 'flight_duty' as const,
      restType: '12h' as const,
      prefixReserve: {
        eventKind: 'airport_reserve' as const,
        start: rsvStart,
        end: rsvEnd,
        locationIcao: 'CYUL',
      },
      duty: {
        start: report,
        end: release,
        acclTZ: TZ,
        startTZ: TZ,
        endTZ: 'America/Halifax',
        eventKind: 'flight_duty' as const,
        flights: [
          {
            id: 'leg-1',
            depIcao: 'CYUL',
            arrIcao: 'CYHZ',
            dep,
            arr,
            isDeadhead: false,
          },
        ],
      },
    }

    const shifted = shiftEventFormPayload(payload, 1)
    expect(toDateInputValueInTZ(shifted.duty.start, TZ)).toBe('2026-08-04')
    expect(toDateInputValueInTZ(shifted.duty.end, 'America/Halifax')).toBe(
      '2026-08-04',
    )
    expect(toDateInputValueInTZ(shifted.duty.flights![0].dep, TZ)).toBe(
      '2026-08-04',
    )
    expect(
      toDateInputValueInTZ(shifted.duty.flights![0].arr, 'America/Halifax'),
    ).toBe('2026-08-04')
    expect(
      toDateInputValueInTZ(shifted.prefixReserve!.start, TZ),
    ).toBe('2026-08-04')
    expect(toDateInputValueInTZ(shifted.prefixReserve!.end, TZ)).toBe(
      '2026-08-04',
    )
  })
})
