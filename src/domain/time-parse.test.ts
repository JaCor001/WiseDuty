import { describe, expect, it } from 'vitest'
import {
  addDaysToDateInputValue,
  formatTimeDisplay,
  isOvernightDutyPeriod,
  overnightAutoEndDate,
  parseFlexibleTime,
  parseHHmmToMinutes,
} from './time'

describe('parseFlexibleTime', () => {
  it('parses 24h digit blocks', () => {
    expect(parseFlexibleTime('2030')).toBe('20:30')
    expect(parseFlexibleTime('0930')).toBe('09:30')
    expect(parseFlexibleTime('20:30')).toBe('20:30')
    expect(parseFlexibleTime('20')).toBe('20:00')
    expect(parseFlexibleTime('9')).toBe('09:00')
    expect(parseFlexibleTime('930')).toBe('09:30')
  })

  it('parses 12h with am/pm without spaces', () => {
    expect(parseFlexibleTime('0930am')).toBe('09:30')
    expect(parseFlexibleTime('830pm')).toBe('20:30')
    expect(parseFlexibleTime('8:30pm')).toBe('20:30')
    expect(parseFlexibleTime('12am')).toBe('00:00')
    expect(parseFlexibleTime('12pm')).toBe('12:00')
    expect(parseFlexibleTime('12:00 AM')).toBe('00:00')
    expect(parseFlexibleTime('930a')).toBe('09:30')
    expect(parseFlexibleTime('8p')).toBe('20:00')
  })

  it('maps 24h digits for display conversion', () => {
    expect(formatTimeDisplay('20:30', '12h')).toBe('8:30 PM')
    expect(formatTimeDisplay('20:30', '24h')).toBe('20:30')
    expect(formatTimeDisplay('09:30', '12h')).toBe('9:30 AM')
  })

  it('returns null for garbage', () => {
    expect(parseFlexibleTime('abc')).toBeNull()
    expect(parseFlexibleTime('2560')).toBeNull()
    expect(parseFlexibleTime('12:99')).toBeNull()
  })
})

describe('overnight duty helpers', () => {
  it('parses HH:mm to minutes', () => {
    expect(parseHHmmToMinutes('22:30')).toBe(22 * 60 + 30)
    expect(parseHHmmToMinutes('bad')).toBeNull()
  })

  it('adds days to date input values', () => {
    expect(addDaysToDateInputValue('2024-06-10', 1)).toBe('2024-06-11')
    expect(addDaysToDateInputValue('2024-06-30', 1)).toBe('2024-07-01')
  })

  it('auto end date only when end clock is before start and end still same day', () => {
    expect(
      overnightAutoEndDate('2024-06-10', '22:00', '2024-06-10', '06:00'),
    ).toBe('2024-06-11')
    expect(
      overnightAutoEndDate('2024-06-10', '22:00', '2024-06-11', '06:00'),
    ).toBeNull()
    expect(
      overnightAutoEndDate('2024-06-10', '08:00', '2024-06-10', '16:00'),
    ).toBeNull()
  })

  it('detects overnight when end day is later or clock crosses midnight', () => {
    expect(
      isOvernightDutyPeriod('2024-06-10', '22:00', '2024-06-11', '06:00'),
    ).toBe(true)
    expect(
      isOvernightDutyPeriod('2024-06-10', '08:00', '2024-06-10', '16:00'),
    ).toBe(false)
  })
})
