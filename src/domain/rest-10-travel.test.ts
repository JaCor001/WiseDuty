import { describe, expect, it } from 'vitest'
import {
  applyTenPlusTravelIfRestCompressed,
  previewTenPlusTravelCompression,
  recomputeAfterDutyChange,
  restIdForDuty,
} from './events'
import { eventsOverlap, getDutyMarkers, markerChipLabel } from './regulations'
import type { DutyEvent } from './types'
import { zonedWallTime } from './time'

const HOME = 'America/Toronto'

function duty(id: string, start: Date, end: Date): DutyEvent {
  return {
    id,
    title: 'Duty',
    type: 'duty',
    start,
    end,
    acclTZ: HOME,
    startTZ: HOME,
    endTZ: HOME,
  }
}

describe('applyTenPlusTravelIfRestCompressed', () => {
  it('converts previous 12 h rest to 10+travel when next FDP leaves ~11 h gap', () => {
    // Day 1: 08:00–18:00 → 12 h rest would run to 06:00 next day
    const d1 = duty(
      'd1',
      zonedWallTime(HOME, 2026, 7, 10, 8, 0),
      zonedWallTime(HOME, 2026, 7, 10, 18, 0),
    )
    // Day 2: report 05:00 → only 11 h rest (10–12 band)
    const d2 = duty(
      'd2',
      zonedWallTime(HOME, 2026, 7, 11, 5, 0),
      zonedWallTime(HOME, 2026, 7, 11, 14, 0),
    )

    let events = recomputeAfterDutyChange(
      [d1],
      d1,
      'TC',
      HOME,
      HOME,
      '12h',
    )
    events = recomputeAfterDutyChange(events, d2, 'TC', HOME, HOME, '12h')

    // Sanity: new duty overlaps the prior 12 h rest bar
    const priorRest = events.find((e) => e.id === restIdForDuty('d1'))!
    expect(eventsOverlap(priorRest.start, priorRest.end, d2.start, d2.end)).toBe(
      true,
    )

    const { events: next, notice } = applyTenPlusTravelIfRestCompressed(
      events,
      'd2',
      'TC',
      HOME,
      HOME,
    )

    expect(notice).not.toBeNull()
    expect(notice!.gapHours).toBeCloseTo(11, 1)
    expect(notice!.previousDutyId).toBe('d1')

    const rest = next.find((e) => e.id === restIdForDuty('d1'))
    expect(rest?.baseRestType).toBe('10+travel')
    expect(rest?.requiredRestHours).toBe(10)
    expect(rest?.violated).toBeFalsy()
    expect(getDutyMarkers(rest!, 'TC', HOME, true, true)).toEqual(['R10'])
    expect(markerChipLabel('R10')).toBe('10R')

    // After conversion, rest no longer collides with the following duty
    expect(
      eventsOverlap(rest!.start, rest!.end, d2.start, d2.end),
    ).toBe(false)
    expect(next.find((e) => e.id === 'd2')?.violated).toBeFalsy()
  })

  it('does not convert when gap is still ≥ 12 h', () => {
    const d1 = duty(
      'd1',
      zonedWallTime(HOME, 2026, 7, 10, 8, 0),
      zonedWallTime(HOME, 2026, 7, 10, 18, 0),
    )
    const d2 = duty(
      'd2',
      zonedWallTime(HOME, 2026, 7, 11, 8, 0), // 14 h gap
      zonedWallTime(HOME, 2026, 7, 11, 16, 0),
    )
    let events = recomputeAfterDutyChange([d1], d1, 'TC', HOME, HOME, '12h')
    events = recomputeAfterDutyChange(events, d2, 'TC', HOME, HOME, '12h')
    const { notice } = applyTenPlusTravelIfRestCompressed(
      events,
      'd2',
      'TC',
      HOME,
      HOME,
    )
    expect(notice).toBeNull()
  })

  it('does not convert when gap is under 10 h (illegal for 10+travel)', () => {
    const d1 = duty(
      'd1',
      zonedWallTime(HOME, 2026, 7, 10, 8, 0),
      zonedWallTime(HOME, 2026, 7, 10, 18, 0),
    )
    const d2 = duty(
      'd2',
      zonedWallTime(HOME, 2026, 7, 11, 3, 0), // 9 h gap
      zonedWallTime(HOME, 2026, 7, 11, 12, 0),
    )
    let events = recomputeAfterDutyChange([d1], d1, 'TC', HOME, HOME, '12h')
    events = recomputeAfterDutyChange(events, d2, 'TC', HOME, HOME, '12h')
    const { notice, events: next } = applyTenPlusTravelIfRestCompressed(
      events,
      'd2',
      'TC',
      HOME,
      HOME,
    )
    expect(notice).toBeNull()
    const rest = next.find((e) => e.id === restIdForDuty('d1'))
    expect(rest?.baseRestType).not.toBe('10+travel')
  })

  it('clears a stale violated flag on the following duty after conversion', () => {
    const d1 = duty(
      'd1',
      zonedWallTime(HOME, 2026, 7, 10, 8, 0),
      zonedWallTime(HOME, 2026, 7, 10, 18, 0),
    )
    const d2: DutyEvent = {
      ...duty(
        'd2',
        zonedWallTime(HOME, 2026, 7, 11, 5, 0),
        zonedWallTime(HOME, 2026, 7, 11, 14, 0),
      ),
      violated: true, // set by legacy “overlaps rest” confirm path
    }
    let events = recomputeAfterDutyChange([d1], d1, 'TC', HOME, HOME, '12h')
    events = recomputeAfterDutyChange(events, d2, 'TC', HOME, HOME, '12h')
    // recompute preserves duty.violated
    expect(events.find((e) => e.id === 'd2')?.violated).toBe(true)

    const { events: next, notice } = applyTenPlusTravelIfRestCompressed(
      events,
      'd2',
      'TC',
      HOME,
      HOME,
    )
    expect(notice).not.toBeNull()
    expect(next.find((e) => e.id === 'd2')?.violated).toBe(false)
  })
})

describe('previewTenPlusTravelCompression', () => {
  it('detects legal 10+travel when adding a duty that overlaps prior rest', () => {
    const d1 = duty(
      'd1',
      zonedWallTime(HOME, 2026, 7, 10, 8, 0),
      zonedWallTime(HOME, 2026, 7, 10, 18, 0),
    )
    const schedule = recomputeAfterDutyChange(
      [d1],
      d1,
      'TC',
      HOME,
      HOME,
      '12h',
    )
    const d2 = duty(
      'd2',
      zonedWallTime(HOME, 2026, 7, 11, 5, 0),
      zonedWallTime(HOME, 2026, 7, 11, 14, 0),
    )
    const priorRest = schedule.find((e) => e.id === restIdForDuty('d1'))!
    expect(eventsOverlap(priorRest.start, priorRest.end, d2.start, d2.end)).toBe(
      true,
    )

    const notice = previewTenPlusTravelCompression(
      schedule,
      d2,
      'TC',
      HOME,
      HOME,
      '12h',
    )
    expect(notice).not.toBeNull()
    expect(notice!.previousDutyId).toBe('d1')
    expect(notice!.gapHours).toBeCloseTo(11, 1)
  })

  it('returns null when overlap is illegal even with 10+travel', () => {
    const d1 = duty(
      'd1',
      zonedWallTime(HOME, 2026, 7, 10, 8, 0),
      zonedWallTime(HOME, 2026, 7, 10, 18, 0),
    )
    const schedule = recomputeAfterDutyChange(
      [d1],
      d1,
      'TC',
      HOME,
      HOME,
      '12h',
    )
    const d2 = duty(
      'd2',
      zonedWallTime(HOME, 2026, 7, 11, 3, 0), // 9 h
      zonedWallTime(HOME, 2026, 7, 11, 12, 0),
    )
    expect(
      previewTenPlusTravelCompression(schedule, d2, 'TC', HOME, HOME, '12h'),
    ).toBeNull()
  })

  it('returns null for non-TC regulators', () => {
    const d1 = duty(
      'd1',
      zonedWallTime(HOME, 2026, 7, 10, 8, 0),
      zonedWallTime(HOME, 2026, 7, 10, 18, 0),
    )
    const schedule = recomputeAfterDutyChange(
      [d1],
      d1,
      'FAA',
      HOME,
      HOME,
      '12h',
    )
    const d2 = duty(
      'd2',
      zonedWallTime(HOME, 2026, 7, 11, 5, 0),
      zonedWallTime(HOME, 2026, 7, 11, 14, 0),
    )
    expect(
      previewTenPlusTravelCompression(schedule, d2, 'FAA', HOME, HOME, '12h'),
    ).toBeNull()
  })
})
