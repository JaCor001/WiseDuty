import { describe, expect, it } from 'vitest'
import {
  applyAvailabilityRemovals,
  applyReserveStartAdjustments,
  dutyTakesPlaceOnAvailability,
  planPostDutyOverlapFix,
} from './schedule-overlap'
import type { DutyEvent } from './types'
import { zonedWallTime } from './time'
import { restIdForDuty } from './events'

const TZ = 'America/Toronto'

function duty(
  id: string,
  start: Date,
  end: Date,
  extra?: Partial<DutyEvent>,
): DutyEvent {
  return {
    id,
    title: 'Flight Duty',
    type: 'duty',
    start,
    end,
    acclTZ: TZ,
    ...extra,
  }
}

function rest(dutyId: string, start: Date, end: Date): DutyEvent {
  return {
    id: restIdForDuty(dutyId),
    title: 'Required Rest (12h)',
    type: 'rest',
    start,
    end,
    acclTZ: TZ,
    baseRestType: '12h',
    requiredRestHours: 12,
  }
}

function reserve(id: string, start: Date, end: Date): DutyEvent {
  return {
    id,
    title: 'Home Reserve',
    type: 'reserve',
    start,
    end,
    acclTZ: TZ,
    workFactor: 0.33,
  }
}

function standby(id: string, start: Date, end: Date): DutyEvent {
  return {
    id,
    title: 'Airport Standby',
    type: 'standby',
    start,
    end,
    acclTZ: TZ,
    workFactor: 1,
  }
}

/** Prior RAP ending at report — marks the FDP as a call-out from reserve. */
function calloutRap(report: Date, hoursBefore = 4): DutyEvent {
  const start = new Date(report.getTime() - hoursBefore * 3_600_000)
  return reserve('rap-prior', start, report)
}

describe('dutyTakesPlaceOnAvailability', () => {
  it('true with stored rapStart (handoff menu)', () => {
    const report = zonedWallTime(TZ, 2026, 8, 4, 10, 0)
    const d = duty('d1', report, zonedWallTime(TZ, 2026, 8, 4, 18, 0), {
      rapStart: zonedWallTime(TZ, 2026, 8, 4, 6, 0),
    })
    expect(dutyTakesPlaceOnAvailability(d, [d])).toBe(true)
  })

  it('true when FDP overlaps an existing reserve bar', () => {
    const d = duty(
      'd1',
      zonedWallTime(TZ, 2026, 8, 4, 10, 0),
      zonedWallTime(TZ, 2026, 8, 4, 18, 0),
    )
    const r = reserve(
      'rsv',
      zonedWallTime(TZ, 2026, 8, 4, 6, 0),
      zonedWallTime(TZ, 2026, 8, 4, 20, 0),
    )
    expect(dutyTakesPlaceOnAvailability(d, [r, d])).toBe(true)
  })

  it('true when prior reserve ends at report (call-out)', () => {
    const report = zonedWallTime(TZ, 2026, 8, 4, 10, 0)
    const d = duty('d1', report, zonedWallTime(TZ, 2026, 8, 4, 18, 0))
    const rap = calloutRap(report)
    expect(dutyTakesPlaceOnAvailability(d, [rap, d])).toBe(true)
  })

  it('false for standalone FDP with no availability link', () => {
    const d = duty(
      'd1',
      zonedWallTime(TZ, 2026, 8, 4, 10, 0),
      zonedWallTime(TZ, 2026, 8, 4, 18, 0),
    )
    const later = reserve(
      'rsv',
      zonedWallTime(TZ, 2026, 8, 4, 20, 0),
      zonedWallTime(TZ, 2026, 8, 5, 6, 0),
    )
    expect(dutyTakesPlaceOnAvailability(d, [d, later])).toBe(false)
  })
})

describe('planPostDutyOverlapFix', () => {
  it('plans reserve start push when on-reserve FDP rest overlaps next reserve', () => {
    // Call-out duty ends 10:00; 12 h rest → 22:00; next reserve 14:00–06:00 → start to 22:00
    const report = zonedWallTime(TZ, 2026, 8, 4, 6, 0)
    const d = duty('d1', report, zonedWallTime(TZ, 2026, 8, 4, 10, 0), {
      rapStart: zonedWallTime(TZ, 2026, 8, 4, 2, 0),
    })
    const rst = rest(
      'd1',
      zonedWallTime(TZ, 2026, 8, 4, 10, 0),
      zonedWallTime(TZ, 2026, 8, 4, 22, 0),
    )
    const r = reserve(
      'rsv',
      zonedWallTime(TZ, 2026, 8, 4, 14, 0),
      zonedWallTime(TZ, 2026, 8, 5, 6, 0),
    )
    const plan = planPostDutyOverlapFix([d, rst, r], 'd1')
    expect(plan.reserveAdjustments).toHaveLength(1)
    expect(plan.reserveAdjustments[0].newStart.getTime()).toBe(
      zonedWallTime(TZ, 2026, 8, 4, 22, 0).getTime(),
    )
    expect(plan.reserveAdjustments[0].end.getTime()).toBe(r.end.getTime())
    expect(plan.messages.join(' ')).toMatch(/adjust the start of the next reserve/i)
    expect(plan.markDutyViolated).toBe(false)
  })

  it('does not slide next reserve when FDP is not on availability — treats as assignment conflict', () => {
    const d = duty(
      'd1',
      zonedWallTime(TZ, 2026, 8, 4, 6, 0),
      zonedWallTime(TZ, 2026, 8, 4, 10, 0),
    )
    const rst = rest(
      'd1',
      zonedWallTime(TZ, 2026, 8, 4, 10, 0),
      zonedWallTime(TZ, 2026, 8, 4, 22, 0),
    )
    const r = reserve(
      'rsv',
      zonedWallTime(TZ, 2026, 8, 4, 14, 0),
      zonedWallTime(TZ, 2026, 8, 5, 6, 0),
    )
    const plan = planPostDutyOverlapFix([d, rst, r], 'd1')
    expect(plan.reserveAdjustments).toHaveLength(0)
    expect(plan.removePeerIds).toHaveLength(0)
    expect(plan.markDutyViolated).toBe(true)
    expect(plan.messages.join(' ')).toMatch(/Contact your company/i)
    expect(plan.messages.join(' ')).toMatch(/assignment/i)
  })

  it('does not move next assignment; marks violated and messages contact company', () => {
    const d = duty(
      'd1',
      zonedWallTime(TZ, 2026, 8, 4, 10, 0),
      zonedWallTime(TZ, 2026, 8, 4, 18, 0),
    )
    const next = duty(
      'd2',
      zonedWallTime(TZ, 2026, 8, 4, 16, 0),
      zonedWallTime(TZ, 2026, 8, 4, 22, 0),
    )
    const plan = planPostDutyOverlapFix([d, next], 'd1')
    expect(plan.reserveAdjustments).toHaveLength(0)
    expect(plan.markDutyViolated).toBe(true)
    expect(plan.messages.join(' ')).toMatch(/Contact your company/i)
    expect(plan.messages.join(' ')).toMatch(/assignment/i)
  })

  it('treats standby like reserve when FDP is on standby: moves start later, keeps end', () => {
    const report = zonedWallTime(TZ, 2026, 8, 4, 6, 0)
    // Prior standby ends at report (call-out) — FDP is on availability
    const sbyPrior = standby(
      'sby-prior',
      zonedWallTime(TZ, 2026, 8, 4, 2, 0),
      report,
    )
    const d = duty('d1', report, zonedWallTime(TZ, 2026, 8, 4, 10, 0))
    const rst = rest(
      'd1',
      zonedWallTime(TZ, 2026, 8, 4, 10, 0),
      zonedWallTime(TZ, 2026, 8, 4, 22, 0),
    )
    const sby = standby(
      'sby',
      zonedWallTime(TZ, 2026, 8, 4, 14, 0),
      zonedWallTime(TZ, 2026, 8, 5, 6, 0),
    )
    const plan = planPostDutyOverlapFix([sbyPrior, d, rst, sby], 'd1')
    expect(plan.reserveAdjustments).toHaveLength(1)
    expect(plan.reserveAdjustments[0].peerType).toBe('standby')
    expect(plan.reserveAdjustments[0].id).toBe('sby')
    expect(plan.reserveAdjustments[0].newStart.getTime()).toBe(
      zonedWallTime(TZ, 2026, 8, 4, 22, 0).getTime(),
    )
    expect(plan.reserveAdjustments[0].end.getTime()).toBe(sby.end.getTime())
    expect(plan.markDutyViolated).toBe(false)
    expect(plan.messages.join(' ')).toMatch(/standby/i)
    expect(plan.messages.join(' ')).toMatch(/adjust the start/i)

    const next = applyReserveStartAdjustments([sby], plan.reserveAdjustments)
    expect(next[0].type).toBe('standby')
    expect(next[0].start.getTime()).toBe(
      zonedWallTime(TZ, 2026, 8, 4, 22, 0).getTime(),
    )
    expect(next[0].end.getTime()).toBe(sby.end.getTime())
  })

  it('suggests 10+travel when on-reserve 12 h floor slides later than 10 h would', () => {
    // Release 10:00; 12 h → 22:00 slide; 10 h → 20:00 slide; reserve long enough
    const report = zonedWallTime(TZ, 2026, 8, 4, 6, 0)
    const d = duty('d1', report, zonedWallTime(TZ, 2026, 8, 4, 10, 0), {
      rapStart: zonedWallTime(TZ, 2026, 8, 4, 2, 0),
    })
    const rst = rest(
      'd1',
      zonedWallTime(TZ, 2026, 8, 4, 10, 0),
      zonedWallTime(TZ, 2026, 8, 4, 22, 0),
    )
    const r = reserve(
      'rsv',
      zonedWallTime(TZ, 2026, 8, 4, 14, 0),
      zonedWallTime(TZ, 2026, 8, 5, 6, 0),
    )
    const plan = planPostDutyOverlapFix([d, rst, r], 'd1')
    expect(plan.tryRestType10Travel).toBe(true)
    expect(plan.reserveAdjustments[0]?.newStart.getTime()).toBe(
      zonedWallTime(TZ, 2026, 8, 4, 22, 0).getTime(),
    )
  })

  it('ignores prior reserve that ends at report (callout) as a peer to slide', () => {
    const report = zonedWallTime(TZ, 2026, 8, 4, 10, 25)
    const d = duty('d1', report, zonedWallTime(TZ, 2026, 8, 4, 22, 25))
    const prior = reserve(
      'rap',
      zonedWallTime(TZ, 2026, 8, 4, 6, 0),
      report,
    )
    const plan = planPostDutyOverlapFix([prior, d], 'd1')
    expect(plan.reserveAdjustments).toHaveLength(0)
    expect(plan.messages).toHaveLength(0)
    // Still recognized as on-availability for any later peer
    expect(dutyTakesPlaceOnAvailability(d, [prior, d])).toBe(true)
  })

  it('applyReserveStartAdjustments only moves start and records dependency', () => {
    const r = reserve(
      'rsv',
      zonedWallTime(TZ, 2026, 8, 4, 8, 0),
      zonedWallTime(TZ, 2026, 8, 4, 18, 0),
    )
    const newStart = zonedWallTime(TZ, 2026, 8, 4, 14, 0)
    const next = applyReserveStartAdjustments([r], [
      {
        id: 'rsv',
        scheduledStart: r.start,
        oldStart: r.start,
        newStart,
        end: r.end,
        peerType: 'reserve',
        drivingDutyId: 'd1',
      },
    ])
    expect(next[0].start.getTime()).toBe(newStart.getTime())
    expect(next[0].end.getTime()).toBe(r.end.getTime())
    expect(next[0].scheduledStart?.getTime()).toBe(r.start.getTime())
    expect(next[0].startDependsOnDutyId).toBe('d1')
  })

  it('re-slides linked reserve earlier when 12 h rest ends earlier (not before scheduledStart)', () => {
    const scheduled = zonedWallTime(TZ, 2026, 8, 4, 18, 0)
    // Early arrival: release 08:00, 12 h rest → 20:00 (was later)
    const d = duty(
      'd1',
      zonedWallTime(TZ, 2026, 8, 4, 4, 0),
      zonedWallTime(TZ, 2026, 8, 4, 8, 0),
      { rapStart: zonedWallTime(TZ, 2026, 8, 4, 0, 0) },
    )
    const rst = rest(
      'd1',
      zonedWallTime(TZ, 2026, 8, 4, 8, 0),
      zonedWallTime(TZ, 2026, 8, 4, 20, 0),
    )
    // Currently slid to 22:00 from a previous later rest
    const r: DutyEvent = {
      ...reserve(
        'rsv',
        zonedWallTime(TZ, 2026, 8, 4, 22, 0),
        zonedWallTime(TZ, 2026, 8, 5, 6, 0),
      ),
      scheduledStart: scheduled,
      startDependsOnDutyId: 'd1',
    }
    const plan = planPostDutyOverlapFix([d, rst, r], 'd1')
    expect(plan.reserveAdjustments).toHaveLength(1)
    expect(plan.reserveAdjustments[0].newStart.getTime()).toBe(
      zonedWallTime(TZ, 2026, 8, 4, 20, 0).getTime(),
    )
    expect(
      plan.reserveAdjustments[0].newStart.getTime(),
    ).toBeGreaterThanOrEqual(scheduled.getTime())
  })

  it('restores linked reserve to scheduledStart when protected rest ends before it', () => {
    const scheduled = zonedWallTime(TZ, 2026, 8, 4, 20, 0)
    // Release 06:00, 12 h rest → 18:00 — before scheduled 20:00
    const d = duty(
      'd1',
      zonedWallTime(TZ, 2026, 8, 4, 4, 0),
      zonedWallTime(TZ, 2026, 8, 4, 6, 0),
      { rapStart: zonedWallTime(TZ, 2026, 8, 4, 0, 0) },
    )
    const rst = rest(
      'd1',
      zonedWallTime(TZ, 2026, 8, 4, 6, 0),
      zonedWallTime(TZ, 2026, 8, 4, 18, 0),
    )
    const r: DutyEvent = {
      ...reserve(
        'rsv',
        zonedWallTime(TZ, 2026, 8, 4, 22, 0),
        zonedWallTime(TZ, 2026, 8, 5, 6, 0),
      ),
      scheduledStart: scheduled,
      startDependsOnDutyId: 'd1',
    }
    const plan = planPostDutyOverlapFix([d, rst, r], 'd1')
    expect(plan.reserveAdjustments).toHaveLength(1)
    expect(plan.reserveAdjustments[0].newStart.getTime()).toBe(
      scheduled.getTime(),
    )
    expect(plan.reserveAdjustments[0].clearDependency).toBe(true)
  })

  it('cancels next reserve when on-reserve clearance would push start past end', () => {
    // Duty/rest runs until 20:00; next reserve is only 14:00–18:00
    const d = duty(
      'd1',
      zonedWallTime(TZ, 2026, 8, 4, 6, 0),
      zonedWallTime(TZ, 2026, 8, 4, 14, 0),
      { rapStart: zonedWallTime(TZ, 2026, 8, 4, 2, 0) },
    )
    const rst = rest(
      'd1',
      zonedWallTime(TZ, 2026, 8, 4, 14, 0),
      zonedWallTime(TZ, 2026, 8, 4, 20, 0),
    )
    const r = reserve(
      'rsv',
      zonedWallTime(TZ, 2026, 8, 4, 14, 0),
      zonedWallTime(TZ, 2026, 8, 4, 18, 0),
    )
    const plan = planPostDutyOverlapFix([d, rst, r], 'd1')
    expect(plan.removePeerIds).toEqual(['rsv'])
    expect(plan.reserveAdjustments).toHaveLength(0)
    expect(plan.messages.join(' ')).toMatch(/cancelled/i)
    expect(plan.messages.join(' ')).toMatch(/Notify your company/i)
    expect(plan.markDutyViolated).toBe(false)

    const next = applyAvailabilityRemovals([d, rst, r], plan.removePeerIds)
    expect(next.find((e) => e.id === 'rsv')).toBeUndefined()
    expect(next).toHaveLength(2)
  })

  it('never slides reserve start earlier than release + 12 h without reduced-rest consent', () => {
    // Release 10:00; rest bar only 10 h (10→20) but policy is 12 h unless allowed
    const d = duty(
      'd1',
      zonedWallTime(TZ, 2026, 8, 4, 6, 0),
      zonedWallTime(TZ, 2026, 8, 4, 10, 0),
      { rapStart: zonedWallTime(TZ, 2026, 8, 4, 2, 0) },
    )
    const rst: DutyEvent = {
      ...rest(
        'd1',
        zonedWallTime(TZ, 2026, 8, 4, 10, 0),
        zonedWallTime(TZ, 2026, 8, 4, 20, 0),
      ),
      baseRestType: '10+travel',
      requiredRestHours: 10,
    }
    const r = reserve(
      'rsv',
      zonedWallTime(TZ, 2026, 8, 4, 14, 0),
      zonedWallTime(TZ, 2026, 8, 5, 2, 0),
    )
    // Without allowReducedRest: floor is 12 h → 22:00 even if rest bar ends 20:00
    // But restAlreadyReduced is true because baseRestType is 10+travel...
    // Use 12h rest bar that is short incorrectly — actually use rest without 10+travel
    // but shorter? Rest ends 20:00 (10h) while baseRestType stays 12h (inconsistent schedule)
    const rst12short: DutyEvent = {
      ...rest(
        'd1',
        zonedWallTime(TZ, 2026, 8, 4, 10, 0),
        zonedWallTime(TZ, 2026, 8, 4, 20, 0),
      ),
      baseRestType: '12h',
      requiredRestHours: 12,
    }
    const plan12 = planPostDutyOverlapFix([d, rst12short, r], 'd1', {
      allowReducedRest: false,
    })
    // Protected floor: max(rest.end 20:00, release+12h 22:00) = 22:00
    expect(plan12.reserveAdjustments[0]?.newStart.getTime()).toBe(
      zonedWallTime(TZ, 2026, 8, 4, 22, 0).getTime(),
    )

    const plan10 = planPostDutyOverlapFix([d, rst, r], 'd1', {
      allowReducedRest: true,
    })
    // With reduced rest allowed and rest ends 20:00: slide to 20:00
    expect(plan10.reserveAdjustments[0]?.newStart.getTime()).toBe(
      zonedWallTime(TZ, 2026, 8, 4, 20, 0).getTime(),
    )
  })

  it('offers tryRestType10Travel when 12 h floor cancels but 10 h would only slide', () => {
    const d = duty(
      'd1',
      zonedWallTime(TZ, 2026, 8, 4, 8, 0),
      zonedWallTime(TZ, 2026, 8, 4, 12, 0),
      { rapStart: zonedWallTime(TZ, 2026, 8, 4, 4, 0) },
    )
    // Rest 12 h → ends 00:00 next day; reserve only until 23:00 same day → cancel at 12h
    const rst = rest(
      'd1',
      zonedWallTime(TZ, 2026, 8, 4, 12, 0),
      zonedWallTime(TZ, 2026, 8, 5, 0, 0),
    )
    const r = reserve(
      'rsv',
      zonedWallTime(TZ, 2026, 8, 4, 18, 0),
      zonedWallTime(TZ, 2026, 8, 4, 23, 0),
    )
    const plan = planPostDutyOverlapFix([d, rst, r], 'd1', {
      allowReducedRest: false,
    })
    expect(plan.tryRestType10Travel).toBe(true)
    // Default plan still protects 12 h → cancel
    expect(plan.removePeerIds).toContain('rsv')

    const plan10 = planPostDutyOverlapFix([d, rst, r], 'd1', {
      allowReducedRest: true,
    })
    // 10 h from 12:00 = 22:00 < 23:00 end → slide not cancel
    expect(plan10.removePeerIds).not.toContain('rsv')
    expect(plan10.reserveAdjustments[0]?.newStart.getTime()).toBe(
      zonedWallTime(TZ, 2026, 8, 4, 22, 0).getTime(),
    )
  })
})
