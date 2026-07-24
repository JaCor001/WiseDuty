import { describe, expect, it } from 'vitest'
import {
  getMaxDutyFromTable,
  getMaxFdpHours,
  getMinRestHours,
  getWeeklyDutyHours,
  wouldExceedWeeklyLimit,
  computeLocalNightRest,
  eventsOverlap,
} from './regulations'
import type { DutyEvent } from './types'

describe('getMaxDutyFromTable (CAR 705)', () => {
  it('returns 13 for mid-morning low sectors', () => {
    expect(getMaxDutyFromTable(8, 2, '<30')).toBe(13)
  })

  it('returns lower limit for late night start', () => {
    expect(getMaxDutyFromTable(0, 2, '<30')).toBe(9)
    expect(getMaxDutyFromTable(23, 2, '<30')).toBe(10)
  })

  it('uses higher sector groups', () => {
    expect(getMaxDutyFromTable(8, 15, '<30')).toBe(12)
    expect(getMaxDutyFromTable(8, 20, '<30')).toBe(11)
  })
})

describe('getMaxFdpHours by regulator', () => {
  it('uses table for TC and fixed for others', () => {
    expect(getMaxFdpHours('TC', 8, 1, '<30')).toBe(13)
    expect(getMaxFdpHours('EASA', 8, 1, '<30')).toBe(13)
    expect(getMaxFdpHours('FAA', 8, 1, '<30')).toBe(14)
    expect(getMaxFdpHours('Australia', 8, 1, '<30')).toBe(14)
  })
})

describe('getMinRestHours', () => {
  it('is 12 for TC/EASA and 10 otherwise', () => {
    expect(getMinRestHours('TC')).toBe(12)
    expect(getMinRestHours('EASA')).toBe(12)
    expect(getMinRestHours('FAA')).toBe(10)
    expect(getMinRestHours('Australia')).toBe(10)
  })
})

describe('weekly duty window', () => {
  const mk = (id: string, start: Date, end: Date): DutyEvent => ({
    id,
    title: 'Duty',
    start,
    end,
    type: 'duty',
  })

  it('counts partial overlap in the last 168 hours', () => {
    const windowEnd = new Date('2024-06-15T12:00:00')
    // Duty entirely inside window: 4 hours
    const inside = mk(
      'a',
      new Date('2024-06-14T08:00:00'),
      new Date('2024-06-14T12:00:00'),
    )
    // Duty that only partially overlaps (starts before window)
    const partial = mk(
      'b',
      new Date('2024-06-08T00:00:00'),
      new Date('2024-06-08T20:00:00'),
    )
    // Old containment logic would miss partial if end > windowEnd requirements fail
    const hours = getWeeklyDutyHours([inside, partial], windowEnd)
    expect(hours).toBeGreaterThanOrEqual(4)
    // 7 days before windowEnd is 2024-06-08T12:00 — partial ends at 20:00 so 8h overlap
    expect(hours).toBe(4 + 8)
  })

  it('detects weekly limit breach against rolling window ending at duty end', () => {
    const start = new Date('2024-06-15T08:00:00')
    const end = new Date('2024-06-15T18:00:00') // 10h
    const prior: DutyEvent[] = [
      mk(
        'p',
        new Date('2024-06-14T00:00:00'),
        new Date('2024-06-14T12:00:00'),
      ),
    ]
    const heavy: DutyEvent[] = []
    for (let i = 0; i < 6; i++) {
      heavy.push(
        mk(
          `d${i}`,
          new Date(2024, 5, 10 + i, 0, 0),
          new Date(2024, 5, 10 + i, 10, 0),
        ),
      )
    }
    // 6 * 10 = 60 already at limit; adding more should exceed
    expect(wouldExceedWeeklyLimit(heavy, start, end)).toBe(true)
    expect(wouldExceedWeeklyLimit(prior, start, end)).toBe(false)
  })
})

describe('computeLocalNightRest', () => {
  it('flags short gap as violated', () => {
    const prevEnd = new Date(2024, 5, 10, 23, 0)
    const nextStart = new Date(2024, 5, 11, 5, 0) // 6h gap
    const r = computeLocalNightRest(prevEnd, nextStart)
    expect(r.violated).toBe(true)
  })
})

describe('eventsOverlap', () => {
  it('treats endpoint touch as non-overlap', () => {
    const a0 = new Date('2024-01-01T08:00:00')
    const a1 = new Date('2024-01-01T12:00:00')
    const b0 = new Date('2024-01-01T12:00:00')
    const b1 = new Date('2024-01-01T16:00:00')
    expect(eventsOverlap(a0, a1, b0, b1)).toBe(false)
    expect(eventsOverlap(a0, a1, new Date('2024-01-01T11:00:00'), b1)).toBe(
      true,
    )
  })
})
