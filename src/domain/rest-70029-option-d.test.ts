import { describe, expect, it } from 'vitest'
import type { DutyEvent } from './types'
import {
  evaluate70029,
  firstInstantWorkExceeds60,
  getWorkHoursInWindow,
  hasHard70029HourViolation,
  optionDSwitchIsTimely,
} from './rest-70029'
import { freeBlockForLocalNights, freeEventFromProposal, proposeFreeBlocks } from './free-time-planner'
import { zonedWallTime } from './time'

const HOME = 'America/Toronto'

function duty(
  id: string,
  start: Date,
  end: Date,
): DutyEvent {
  return {
    id,
    title: 'Duty',
    start,
    end,
    type: 'duty',
    acclTZ: HOME,
    startTZ: HOME,
    endTZ: HOME,
  }
}

function free(id: string, start: Date, end: Date): DutyEvent {
  return {
    id,
    title: 'Free',
    start,
    end,
    type: 'free',
    acclTZ: HOME,
    workFactor: 0,
    freePurpose: 'manual',
  }
}

function reserve(id: string, start: Date, end: Date): DutyEvent {
  return {
    id,
    title: 'Reserve',
    start,
    end,
    type: 'reserve',
    acclTZ: HOME,
    workFactor: 0.33,
  }
}

describe('Option D eligibility', () => {
  it('finds 5-LNR block inside long free stretch', () => {
    const events = [
      duty(
        'a',
        zonedWallTime(HOME, 2024, 5, 1, 8, 0),
        zonedWallTime(HOME, 2024, 5, 1, 16, 0),
      ),
      free(
        'f',
        zonedWallTime(HOME, 2024, 5, 1, 16, 0),
        zonedWallTime(HOME, 2024, 5, 8, 12, 0), // >120 h free
      ),
      duty(
        'b',
        zonedWallTime(HOME, 2024, 5, 8, 14, 0),
        zonedWallTime(HOME, 2024, 5, 8, 20, 0),
      ),
    ]
    const report = evaluate70029(events, HOME, 'TC', 'auto')
    expect(report.fiveLnrBlocks.length).toBeGreaterThanOrEqual(1)
    expect(report.lnrs.length).toBeGreaterThanOrEqual(5)
  })

  it('blocks >60 h without Option D block under auto', () => {
    const duties: DutyEvent[] = []
    for (let day = 1; day <= 6; day++) {
      duties.push(
        duty(
          `d${day}`,
          zonedWallTime(HOME, 2024, 6, day, 7, 0),
          zonedWallTime(HOME, 2024, 6, day, 18, 0), // 11 h × 6 = 66 h
        ),
      )
    }
    const report = evaluate70029(duties, HOME, 'TC', 'auto')
    expect(hasHard70029HourViolation(report)).toBe(true)
    expect(
      report.violations.some(
        (v) =>
          v.code === 'option_d_not_eligible' ||
          v.code === 'work_60_in_168' ||
          v.code === 'option_d_switch_too_late',
      ),
    ).toBe(true)
  })

  it('flags early duty under forced Option D even when work ≤ 60 h', () => {
    // Single early FDP — work << 60, but settings force D → ELN constraint applies
    const events = [
      duty(
        'early',
        zonedWallTime(HOME, 2024, 6, 10, 5, 0),
        zonedWallTime(HOME, 2024, 6, 10, 12, 0),
      ),
    ]
    const report = evaluate70029(events, HOME, 'TC', 'D')
    expect(
      report.violations.some((v) => v.code === 'option_d_eln_assigned'),
    ).toBe(true)
  })

  it('flags FDP over 12 h under forced Option D', () => {
    const events = [
      duty(
        'long',
        zonedWallTime(HOME, 2024, 6, 10, 8, 0),
        zonedWallTime(HOME, 2024, 6, 10, 21, 0), // 13 h
      ),
    ]
    const report = evaluate70029(events, HOME, 'TC', 'D')
    expect(
      report.violations.some((v) => v.code === 'option_d_fdp_over_12'),
    ).toBe(true)
  })

  it('detects first moment work exceeds 60 h in rolling 168 h', () => {
    const duties: DutyEvent[] = []
    for (let day = 1; day <= 6; day++) {
      duties.push(
        duty(
          `d${day}`,
          zonedWallTime(HOME, 2024, 6, day, 7, 0),
          zonedWallTime(HOME, 2024, 6, day, 18, 0),
        ),
      )
    }
    const first = firstInstantWorkExceeds60(
      duties,
      zonedWallTime(HOME, 2024, 6, 10, 0, 0),
    )
    expect(first).not.toBeNull()
    // 5 × 11 = 55 ≤ 60; 6 × 11 = 66 > 60 → first exceedance is end of day 6
    expect(first!.getTime()).toBe(
      zonedWallTime(HOME, 2024, 6, 6, 18, 0).getTime(),
    )
  })

  it('optionDSwitchIsTimely fails when 5-LNR block ends after first >60 h', () => {
    const events: DutyEvent[] = []
    for (let day = 1; day <= 6; day++) {
      events.push(
        duty(
          `d${day}`,
          zonedWallTime(HOME, 2024, 6, day, 7, 0),
          zonedWallTime(HOME, 2024, 6, day, 18, 0),
        ),
      )
    }
    events.push(
      free(
        'late-free',
        zonedWallTime(HOME, 2024, 6, 6, 18, 0),
        zonedWallTime(HOME, 2024, 6, 13, 12, 0),
      ),
    )
    const report = evaluate70029(events, HOME, 'TC', 'auto')
    expect(report.fiveLnrBlocks.length).toBeGreaterThanOrEqual(1)
    const upTo = zonedWallTime(HOME, 2024, 6, 13, 12, 0)
    const switchCheck = optionDSwitchIsTimely(
      report.fiveLnrBlocks,
      events,
      upTo,
    )
    expect(switchCheck.firstOver60).not.toBeNull()
    expect(switchCheck.ok).toBe(false)
    // Full evaluate at forced D after late free should still hard-fail
    const reportD = evaluate70029(events, HOME, 'TC', 'D')
    expect(hasHard70029HourViolation(reportD)).toBe(true)
    expect(
      reportD.violations.some(
        (v) =>
          v.code === 'option_d_switch_too_late' ||
          v.code === 'option_d_not_eligible' ||
          v.code === 'option_d_eln_assigned', // early 07:00 starts
      ),
    ).toBe(true)
  })
})

describe('Reserve work factor', () => {
  it('counts reserve at 33%', () => {
    const start = zonedWallTime(HOME, 2024, 6, 10, 8, 0)
    const end = zonedWallTime(HOME, 2024, 6, 10, 20, 0) // 12 h clock
    const r = reserve('r1', start, end)
    const hours = getWorkHoursInWindow(
      [r],
      zonedWallTime(HOME, 2024, 6, 10, 0, 0),
      zonedWallTime(HOME, 2024, 6, 11, 0, 0),
    )
    expect(hours).toBeCloseTo(12 * 0.33, 5)
  })
})

describe('free-time planner', () => {
  it('proposes SDF free block for dense short-rest schedule', () => {
    const duties: DutyEvent[] = []
    for (let day = 1; day <= 5; day++) {
      duties.push(
        duty(
          `d${day}`,
          zonedWallTime(HOME, 2024, 6, day, 8, 0),
          zonedWallTime(HOME, 2024, 6, day, 16, 0),
        ),
      )
    }
    const props = proposeFreeBlocks(duties, HOME, 'C')
    expect(props.length).toBeGreaterThanOrEqual(1)
    expect(props.some((p) => p.purpose === 'sdf')).toBe(true)
  })

  it('sizes free block for 2 LNRs without forcing 09:30 end only', () => {
    const from = zonedWallTime(HOME, 2024, 6, 10, 18, 0)
    const { end } = freeBlockForLocalNights(from, HOME, 2)
    expect(end.getTime()).toBeGreaterThan(from.getTime())
    // Two nights: second completes ~07:30 on day 12
    const expected = zonedWallTime(HOME, 2024, 6, 12, 7, 30)
    expect(end.getTime()).toBe(expected.getTime())
  })

  it('builds free event from proposal', () => {
    const p = proposeFreeBlocks(
      [
        duty(
          'a',
          zonedWallTime(HOME, 2024, 6, 1, 8, 0),
          zonedWallTime(HOME, 2024, 6, 1, 16, 0),
        ),
      ],
      HOME,
      'C',
    )[0]
    if (!p) return
    const ev = freeEventFromProposal(p, HOME)
    expect(ev.type).toBe('free')
    expect(ev.workFactor).toBe(0)
  })
})
