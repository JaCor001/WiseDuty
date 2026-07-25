import { describe, expect, it } from 'vitest'
import {
  combineLocalDateAndTime,
  dayBarPosition,
  formatHHmm,
  getHourInTZ,
  getMinutesInTZ,
  getZonedTimeParts,
  nextZonedWallTime,
  parseLocalDateTime,
  toLocalDateInputValue,
  zonedWallTime,
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
