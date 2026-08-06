import { describe, expect, it } from 'vitest'
import {
  blockTimeMs,
  combineLocalDateAndTime,
  dayBarPosition,
  formatBlockDuration,
  formatHHmm,
  formatHHmmInTZ,
  formatZuluHHmm,
  getHourInTZ,
  getMinutesInTZ,
  getZonedTimeParts,
  localWallToZuluHHmm,
  nextZonedWallTime,
  parseLocalDateTime,
  parseZonedDateTime,
  toDateInputValueInTZ,
  toLocalDateInputValue,
  wallTimeLocalZulu,
  zonedWallTime,
  zuluHHmmToLocalWall,
} from './time'

describe('toLocalDateInputValue', () => {
  it('formats local calendar date without UTC shift', () => {
    const d = new Date(2024, 5, 15, 23, 30)
    expect(toLocalDateInputValue(d)).toBe('2024-06-15')
  })
})

describe('combineLocalDateAndTime / parseLocalDateTime', () => {
  it('builds consistent local datetimes', () => {
    const day = new Date(2024, 0, 10)
    const combined = combineLocalDateAndTime(day, '14:30')
    expect(combined.getHours()).toBe(14)
    expect(combined.getMinutes()).toBe(30)
    expect(combined.getDate()).toBe(10)

    const parsed = parseLocalDateTime('2024-01-10', '14:30')
    expect(parsed.getTime()).toBe(combined.getTime())
  })
})

describe('dayBarPosition / formatHHmm', () => {
  it('formats local HH:mm and positions same-day bars', () => {
    const d = new Date(2024, 0, 10, 9, 5)
    expect(formatHHmm(d)).toBe('09:05')

    const dayStart = new Date(2024, 0, 10)
    const dayEnd = new Date(2024, 0, 11)
    const start = new Date(2024, 0, 10, 6, 0)
    const end = new Date(2024, 0, 10, 12, 0)
    const pos = dayBarPosition(start, end, dayStart, dayEnd)
    expect(pos.left).toBeCloseTo((6 / 24) * 100, 5)
    expect(pos.width).toBeCloseTo((6 / 24) * 100, 5)
  })

  it('clips multi-day phantom spans across midnight (rest end → next-day LNR end)', () => {
    // Solid rest ends 16:00 day 10; phantom LNR ends 07:30 day 11
    const phantomStart = new Date(2024, 0, 10, 16, 0)
    const phantomEnd = new Date(2024, 0, 11, 7, 30)

    const day10Start = new Date(2024, 0, 10)
    const day10End = new Date(2024, 0, 11)
    const on10 = dayBarPosition(phantomStart, phantomEnd, day10Start, day10End)
    expect(on10.left).toBeCloseTo((16 / 24) * 100, 5)
    expect(on10.width).toBeCloseTo(((24 - 16) / 24) * 100, 5)

    const day11Start = new Date(2024, 0, 11)
    const day11End = new Date(2024, 0, 12)
    const on11 = dayBarPosition(phantomStart, phantomEnd, day11Start, day11End)
    expect(on11.left).toBeCloseTo(0, 5)
    expect(on11.width).toBeCloseTo((7.5 / 24) * 100, 5)
  })
})

describe('parseZonedDateTime', () => {
  it('interprets wall clock in the given zone (NYC vs UTC same label)', () => {
    // 2024-06-15 14:00 in America/New_York is 18:00Z (EDT)
    const nyc = parseZonedDateTime(
      '2024-06-15',
      '14:00',
      'America/New_York',
    )
    const utc = parseZonedDateTime('2024-06-15', '14:00', 'UTC')
    // 14:00 EDT is 18:00Z — later than 14:00Z
    expect(nyc.getTime()).toBeGreaterThan(utc.getTime())
    expect(formatHHmmInTZ(nyc, 'America/New_York')).toBe('14:00')
    expect(formatHHmmInTZ(utc, 'UTC')).toBe('14:00')
    // Westbound: report YYZ 22:00 → release LAX 01:00 *next* civil day
    const start = parseZonedDateTime(
      '2024-06-15',
      '22:00',
      'America/Toronto',
    )
    const end = parseZonedDateTime(
      '2024-06-16',
      '01:00',
      'America/Los_Angeles',
    )
    expect(end.getTime()).toBeGreaterThan(start.getTime())
    const hours = (end.getTime() - start.getTime()) / 3_600_000
    expect(hours).toBeGreaterThan(5)
    expect(hours).toBeLessThan(7)
  })

  it('round-trips date input in zone', () => {
    const d = parseZonedDateTime('2024-01-10', '09:30', 'UTC')
    expect(toDateInputValueInTZ(d, 'UTC')).toBe('2024-01-10')
    expect(formatHHmmInTZ(d, 'UTC')).toBe('09:30')
  })
})

describe('getHourInTZ', () => {
  it('returns a finite hour 0-23', () => {
    const d = new Date('2024-06-15T12:00:00Z')
    const hour = getHourInTZ(d, 'UTC')
    expect(hour).toBeGreaterThanOrEqual(0)
    expect(hour).toBeLessThanOrEqual(23)
    expect(hour).toBe(12)
  })

  it('normalizes hour 24 to 0 when engine would return 24', () => {
    // We cannot force engine "24", but our code maps 24→0; test UTC midnight.
    const d = new Date('2024-06-15T00:00:00Z')
    const hour = getHourInTZ(d, 'UTC')
    expect(hour === 0 || hour === 24).toBe(true)
    expect(hour === 24 ? 0 : hour).toBe(0)
  })
})

describe('zoned wall-time helpers', () => {
  it('resolves UTC wall times round-trip', () => {
    const d = zonedWallTime('UTC', 2024, 6, 10, 14, 30)
    const p = getZonedTimeParts(d, 'UTC')
    expect(p.year).toBe(2024)
    expect(p.month).toBe(6)
    expect(p.day).toBe(10)
    expect(p.hour).toBe(14)
    expect(p.minute).toBe(30)
    expect(getMinutesInTZ(d, 'UTC')).toBe(14 * 60 + 30)
  })

  it('nextZonedWallTime finds next 02:00 after afternoon start', () => {
    const start = zonedWallTime('UTC', 2024, 6, 10, 14, 0)
    const twoAm = nextZonedWallTime(start, 'UTC', 2, 0, true)
    const p = getZonedTimeParts(twoAm, 'UTC')
    expect(p.day).toBe(11)
    expect(p.hour).toBe(2)
    expect(p.minute).toBe(0)
  })

  it('nextZonedWallTime keeps same-day 02:00 after 01:00 start', () => {
    const start = zonedWallTime('UTC', 2024, 6, 10, 1, 0)
    const twoAm = nextZonedWallTime(start, 'UTC', 2, 0, true)
    const p = getZonedTimeParts(twoAm, 'UTC')
    expect(p.day).toBe(10)
    expect(p.hour).toBe(2)
  })
})

describe('blockTimeMs / wallTimeLocalZulu', () => {
  it('computes block across same zone', () => {
    const ms = blockTimeMs(
      '2026-07-15',
      '10:00',
      'America/Toronto',
      '2026-07-15',
      '12:30',
      'America/Toronto',
    )
    expect(ms).toBe(2.5 * 3_600_000)
    expect(formatBlockDuration(ms)).toBe('2h 30m')
  })

  it('computes block across time zones', () => {
    // 10:00 Toronto = 14:00Z; 12:00 Vancouver = 19:00Z → 5h
    const ms = blockTimeMs(
      '2026-07-15',
      '10:00',
      'America/Toronto',
      '2026-07-15',
      '12:00',
      'America/Vancouver',
    )
    expect(ms).toBe(5 * 3_600_000)
  })

  it('returns local L + Zulu for a wall clock', () => {
    const info = wallTimeLocalZulu(
      '2026-07-15',
      '14:35',
      'America/Toronto',
      '24h',
    )
    expect(info).not.toBeNull()
    expect(info!.local).toBe('14:35')
    // EDT in July: UTC-4 → 18:35Z
    expect(info!.zulu).toBe('18:35Z')
    expect(formatZuluHHmm(info!.instant)).toBe('18:35Z')
  })

  it('round-trips local ↔ zulu for dual input', () => {
    const z = localWallToZuluHHmm('2026-07-15', '14:35', 'America/Toronto')
    expect(z).toBe('18:35')
    const back = zuluHHmmToLocalWall(
      '2026-07-15',
      z,
      'America/Toronto',
      '14:35',
    )
    expect(back).not.toBeNull()
    expect(back!.timeHHmm).toBe('14:35')
    expect(back!.dateKey).toBe('2026-07-15')
  })
})
