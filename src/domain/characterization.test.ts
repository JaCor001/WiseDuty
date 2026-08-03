/**
 * Characterization / golden fixtures (Phase 0 optim).
 *
 * Freeze regulatory outcomes for fixed schedules so later optim work cannot
 * silently drop rest rebuilds, markers, or 700.29 evaluation.
 *
 * Pipeline under test always:
 *   mutate → recomputeScheduleCompliance → 10+travel → evaluate70029
 */
import { describe, expect, it } from 'vitest'
import {
  applyScheduleMutation,
  type ScheduleContext,
} from './schedule-pipeline'
import { restIdForDuty } from './events'
import { getDutyMarkers } from './regulations'
import { deriveFdpFromFlights } from './fdp-from-flights'
import type { DutyEvent, FlightLeg } from './types'
import { DEFAULT_DUTY_TIMING_BUFFERS } from './types'
import { zonedWallTime } from './time'

const HOME = 'America/Toronto'

const ctx: ScheduleContext = {
  regulator: 'TC',
  homeBaseTZ: HOME,
  globalAcclTZ: HOME,
  timeFreeOption: 'auto',
}

function duty(
  id: string,
  start: Date,
  end: Date,
  extra: Partial<DutyEvent> = {},
): DutyEvent {
  return {
    id,
    title: 'Duty',
    type: 'duty',
    start,
    end,
    acclTZ: HOME,
    startTZ: HOME,
    endTZ: HOME,
    ...extra,
  }
}

function leg(
  partial: Partial<FlightLeg> &
    Pick<FlightLeg, 'depIcao' | 'arrIcao' | 'dep' | 'arr'>,
): FlightLeg {
  return {
    id: partial.id || 'leg',
    isDeadhead: false,
    ...partial,
  }
}

/** Stable snapshot of managed rests for golden comparison. */
function restSnapshot(events: DutyEvent[]) {
  return events
    .filter((e) => e.type === 'rest' && e.id.endsWith('-rest'))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((e) => ({
      id: e.id,
      startMs: e.start.getTime(),
      endMs: e.end.getTime(),
      hours: e.requiredRestHours ?? null,
      nights: e.requiredLocalNights ?? 0,
      base: e.baseRestType ?? null,
      rule: e.restRule ?? null,
      kind: e.restKind ?? null,
      violated: !!e.violated,
      markers: getDutyMarkers(e, 'TC', HOME, true, true),
    }))
}

function dutyMarkerSnapshot(events: DutyEvent[]) {
  return events
    .filter((e) => e.type === 'duty')
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .map((e) => ({
      id: e.id,
      markers: getDutyMarkers(e, 'TC', HOME, true, true),
    }))
}

function violationCodes(
  report: { violations: Array<{ code: string }> },
): string[] {
  return report.violations.map((v) => v.code).sort()
}

describe('characterization: single home-base FDP', () => {
  it('builds 12 h clock rest and RR marker', () => {
    const d1 = duty(
      'char-d1',
      zonedWallTime(HOME, 2026, 6, 10, 8, 0),
      zonedWallTime(HOME, 2026, 6, 10, 16, 0),
    )
    const { events, report70029 } = applyScheduleMutation(
      [],
      { type: 'upsert_duty', duty: d1, restType: '12h' },
      ctx,
    )

    const rests = restSnapshot(events)
    expect(rests).toHaveLength(1)
    expect(rests[0].id).toBe(restIdForDuty('char-d1'))
    expect(rests[0].hours).toBe(12)
    expect(rests[0].base).toBe('12h')
    expect(rests[0].markers).toEqual(['RR'])
    expect(rests[0].violated).toBe(false)

    // Isolated single duty: no hard 700.29 hour breach expected
    expect(violationCodes(report70029)).not.toContain('work_60_in_168')
  })
})

describe('characterization: compressed rest → 10+travel', () => {
  it('converts prior rest to R10 when next duty leaves ~11 h gap', () => {
    const d1 = duty(
      'c-d1',
      zonedWallTime(HOME, 2026, 6, 10, 8, 0),
      zonedWallTime(HOME, 2026, 6, 10, 18, 0),
    )
    let events = applyScheduleMutation(
      [],
      { type: 'upsert_duty', duty: d1, restType: '12h' },
      ctx,
    ).events

    const d2 = duty(
      'c-d2',
      zonedWallTime(HOME, 2026, 6, 11, 5, 0),
      zonedWallTime(HOME, 2026, 6, 11, 14, 0),
    )
    const result = applyScheduleMutation(
      events,
      { type: 'upsert_duty', duty: d2, restType: '12h' },
      ctx,
    )

    expect(result.notices.map((n) => n.kind)).toContain('ten_plus_travel')
    const rest = restSnapshot(result.events).find(
      (r) => r.id === restIdForDuty('c-d1'),
    )
    expect(rest).toBeDefined()
    expect(rest!.base).toBe('10+travel')
    expect(rest!.hours).toBe(10)
    expect(rest!.markers).toEqual(['R10'])
    expect(rest!.violated).toBe(false)
  })
})

describe('characterization: early/night markers', () => {
  it('tags early duty start in acclimatized home TZ', () => {
    const early = duty(
      'e-d1',
      zonedWallTime(HOME, 2026, 6, 15, 4, 0),
      zonedWallTime(HOME, 2026, 6, 15, 12, 0),
    )
    const { events } = applyScheduleMutation(
      [],
      { type: 'upsert_duty', duty: early, restType: '12h' },
      ctx,
    )
    const marks = dutyMarkerSnapshot(events)
    expect(marks[0].markers).toContain('E')
  })
})

describe('characterization: flight-derived max FDP', () => {
  it('uses acclimatized start for table max (not raw dep-local alone)', () => {
    // Single local pairing at home: report ~07 local → table row for ≥50 / 1 sector
    const dep = zonedWallTime(HOME, 2026, 6, 20, 8, 0)
    const arr = zonedWallTime(HOME, 2026, 6, 20, 10, 0)
    const r = deriveFdpFromFlights({
      flights: [
        leg({
          id: '1',
          depIcao: 'CYYZ',
          arrIcao: 'CYUL',
          dep,
          arr,
        }),
      ],
      buffers: DEFAULT_DUTY_TIMING_BUFFERS,
      regulator: 'TC',
      homeBaseTZ: HOME,
      priorDuties: [],
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.maxFdpHours).toBeGreaterThanOrEqual(9)
    expect(r.operatingSectors).toBe(1)
    expect(r.acclTZ).toBeTruthy()
  })
})

describe('characterization: pipeline always evaluates 700.29 after mutate', () => {
  it('returns a report object even when schedule is empty after delete', () => {
    const d1 = duty(
      'solo',
      zonedWallTime(HOME, 2026, 6, 1, 9, 0),
      zonedWallTime(HOME, 2026, 6, 1, 17, 0),
    )
    const withDuty = applyScheduleMutation(
      [],
      { type: 'upsert_duty', duty: d1, restType: '12h' },
      ctx,
    )
    const empty = applyScheduleMutation(
      withDuty.events,
      { type: 'delete_duty', dutyId: 'solo' },
      ctx,
    )
    expect(empty.events.filter((e) => e.type === 'duty')).toHaveLength(0)
    expect(empty.report70029).toMatchObject({
      violations: expect.any(Array),
      displaySdfs: expect.any(Array),
    })
  })
})

describe('characterization: golden rest end times (stable ms)', () => {
  it('12 h rest after 16:00 release ends at 04:00 next day home', () => {
    const d1 = duty(
      'g-d1',
      zonedWallTime(HOME, 2026, 6, 10, 8, 0),
      zonedWallTime(HOME, 2026, 6, 10, 16, 0),
    )
    const { events } = applyScheduleMutation(
      [],
      { type: 'upsert_duty', duty: d1, restType: '12h' },
      ctx,
    )
    const rest = events.find((e) => e.id === restIdForDuty('g-d1'))!
    const expectedEnd = zonedWallTime(HOME, 2026, 6, 11, 4, 0)
    expect(rest.end.getTime()).toBe(expectedEnd.getTime())
    expect(rest.start.getTime()).toBe(d1.end.getTime())
  })
})
