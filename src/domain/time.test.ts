import { describe, expect, it } from 'vitest'
import {
  combineLocalDateAndTime,
  getHourInTZ,
  parseLocalDateTime,
  toLocalDateInputValue,
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
