import { describe, expect, it } from 'vitest'
import {
  applyScheduleMutation,
  recomputeSchedule,
  type ScheduleContext,
} from './schedule-pipeline'
import { restIdForDuty } from './events'
import type { DutyEvent } from './types'
import { zonedWallTime } from './time'
import { hasHard70029HourViolation } from './rest-70029'

const HOME = 'America/Toronto'

const ctx: ScheduleContext = {
  regulator: 'TC',
  homeBaseTZ: HOME,
  globalAcclTZ: HOME,
  timeFreeOption: 'auto',
}

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

describe('applyScheduleMutation (pipeline order)', () => {
  it('upsert_duty runs full recompute and attaches a rest bar', () => {
    const d1 = duty(
      'd1',
      zonedWallTime(HOME, 2026, 7, 10, 8, 0),
      zonedWallTime(HOME, 2026, 7, 10, 16, 0),
    )
    const { events, report70029, notices } = applyScheduleMutation(
      [],
      { type: 'upsert_duty', duty: d1, restType: '12h' },
      ctx,
    )
    expect(events.some((e) => e.id === 'd1' && e.type === 'duty')).toBe(true)
    expect(events.some((e) => e.id === restIdForDuty('d1'))).toBe(true)
    expect(report70029).toBeDefined()
    expect(report70029.violations).toBeDefined()
    expect(notices).toEqual([])
  })

  it('upsert_duty with compression emits ten_plus_travel notice', () => {
    const d1 = duty(
      'd1',
      zonedWallTime(HOME, 2026, 7, 10, 8, 0),
      zonedWallTime(HOME, 2026, 7, 10, 18, 0),
    )
    let state = applyScheduleMutation(
      [],
      { type: 'upsert_duty', duty: d1, restType: '12h' },
      ctx,
    ).events
    // ~11 h gap → 10+travel band
    const d2 = duty(
      'd2',
      zonedWallTime(HOME, 2026, 7, 11, 5, 0),
      zonedWallTime(HOME, 2026, 7, 11, 14, 0),
    )
    const result = applyScheduleMutation(
      state,
      { type: 'upsert_duty', duty: d2, restType: '12h', applyTenPlusTravel: true },
      ctx,
    )
    expect(result.notices.some((n) => n.kind === 'ten_plus_travel')).toBe(true)
    const rest = result.events.find((e) => e.id === restIdForDuty('d1'))
    expect(rest?.baseRestType).toBe('10+travel')
  })

  it('delete_duty removes duty and managed rest then recomputes', () => {
    const d1 = duty(
      'd1',
      zonedWallTime(HOME, 2026, 7, 10, 8, 0),
      zonedWallTime(HOME, 2026, 7, 10, 16, 0),
    )
    const d2 = duty(
      'd2',
      zonedWallTime(HOME, 2026, 7, 12, 8, 0),
      zonedWallTime(HOME, 2026, 7, 12, 16, 0),
    )
    let state = applyScheduleMutation(
      [],
      { type: 'upsert_duty', duty: d1, restType: '12h' },
      ctx,
    ).events
    state = applyScheduleMutation(
      state,
      { type: 'upsert_duty', duty: d2, restType: '12h' },
      ctx,
    ).events
    const after = applyScheduleMutation(
      state,
      { type: 'delete_duty', dutyId: 'd1' },
      ctx,
    )
    expect(after.events.some((e) => e.id === 'd1')).toBe(false)
    expect(after.events.some((e) => e.id === restIdForDuty('d1'))).toBe(false)
    expect(after.events.some((e) => e.id === 'd2')).toBe(true)
    expect(after.report70029).toBeDefined()
  })

  it('replace_schedule full recompute for import-style loads', () => {
    const d1 = duty(
      'imp1',
      zonedWallTime(HOME, 2026, 8, 1, 9, 0),
      zonedWallTime(HOME, 2026, 8, 1, 17, 0),
    )
    const { events, report70029 } = applyScheduleMutation(
      [],
      { type: 'replace_schedule', events: [d1] },
      ctx,
    )
    expect(events.filter((e) => e.type === 'duty')).toHaveLength(1)
    expect(events.some((e) => e.id === restIdForDuty('imp1'))).toBe(true)
    expect(hasHard70029HourViolation(report70029)).toBe(false)
  })

  it('recomputeSchedule evaluates 700.29 after rest rebuild', () => {
    const d1 = duty(
      'd1',
      zonedWallTime(HOME, 2026, 7, 10, 8, 0),
      zonedWallTime(HOME, 2026, 7, 10, 16, 0),
    )
    const seeded = applyScheduleMutation(
      [],
      { type: 'upsert_duty', duty: d1, restType: '12h' },
      ctx,
    ).events
    const again = recomputeSchedule(seeded, ctx)
    expect(again.events.length).toBeGreaterThanOrEqual(seeded.length)
    expect(again.report70029.resolvedOption).toBeDefined()
  })

  it('replace_schedule with applyTenPlusTravelAll compresses each gap', () => {
    const d1 = duty(
      'b1',
      zonedWallTime(HOME, 2026, 7, 10, 8, 0),
      zonedWallTime(HOME, 2026, 7, 10, 18, 0),
    )
    const d2 = duty(
      'b2',
      zonedWallTime(HOME, 2026, 7, 11, 5, 0),
      zonedWallTime(HOME, 2026, 7, 11, 14, 0),
    )
    const result = applyScheduleMutation(
      [],
      {
        type: 'replace_schedule',
        events: [d1, d2],
        applyTenPlusTravelAll: true,
      },
      ctx,
    )
    expect(result.notices.some((n) => n.kind === 'ten_plus_travel')).toBe(true)
    expect(
      result.events.find((e) => e.id === restIdForDuty('b1'))?.baseRestType,
    ).toBe('10+travel')
  })
})
