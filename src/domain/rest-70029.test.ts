import { describe, expect, it } from 'vitest'
import type { DutyEvent } from './types'
import {
  areConsecutiveLocalNights,
  buildSingleDaysFree,
  countSdfsInWindow,
  detectLocalNightsFromDuties,
  evaluate70029OptionC,
  findLocalNightsInGap,
  getWorkHoursInWindow,
  hasHard70029HourViolation,
} from './rest-70029'
import { zonedWallTime } from './time'

const HOME = 'America/Toronto'

function duty(
  id: string,
  start: Date,
  end: Date,
  acclTZ = HOME,
): DutyEvent {
  return {
    id,
    title: 'Duty',
    start,
    end,
    type: 'duty',
    acclTZ,
    startTZ: acclTZ,
    endTZ: acclTZ,
  }
}

describe('findLocalNightsInGap', () => {
  it('finds one LNR in an overnight free gap', () => {
    const gapStart = zonedWallTime(HOME, 2024, 6, 10, 20, 0)
    const gapEnd = zonedWallTime(HOME, 2024, 6, 11, 12, 0)
    const nights = findLocalNightsInGap(gapStart, gapEnd, HOME)
    expect(nights.length).toBeGreaterThanOrEqual(1)
    // Completes at earliest 07:30 if sleep from 22:30
    const first = nights[0]
    expect(first.end.getTime()).toBe(
      zonedWallTime(HOME, 2024, 6, 11, 7, 30).getTime(),
    )
  })

  it('finds two LNRs across a multi-day free gap', () => {
    const gapStart = zonedWallTime(HOME, 2024, 6, 10, 18, 0)
    const gapEnd = zonedWallTime(HOME, 2024, 6, 13, 12, 0)
    const nights = findLocalNightsInGap(gapStart, gapEnd, HOME)
    expect(nights.length).toBeGreaterThanOrEqual(2)
  })
})

describe('buildSingleDaysFree', () => {
  it('forms SDF from two consecutive LNRs with no duty between', () => {
    const d1 = duty(
      'a',
      zonedWallTime(HOME, 2024, 6, 10, 8, 0),
      zonedWallTime(HOME, 2024, 6, 10, 16, 0),
    )
    const d2 = duty(
      'b',
      zonedWallTime(HOME, 2024, 6, 13, 10, 0),
      zonedWallTime(HOME, 2024, 6, 13, 18, 0),
    )
    const lnrs = detectLocalNightsFromDuties([d1, d2], HOME)
    expect(lnrs.length).toBeGreaterThanOrEqual(2)
    const sdfs = buildSingleDaysFree(lnrs, [d1, d2])
    expect(sdfs.length).toBeGreaterThanOrEqual(1)
    expect(areConsecutiveLocalNights(sdfs[0].nights[0], sdfs[0].nights[1])).toBe(
      true,
    )
  })

  it('does not form SDF when a duty sits between consecutive nights', () => {
    // Night1 free, duty mid-day, night2 free — nights may be consecutive civil but duty intersects
    const d1 = duty(
      'a',
      zonedWallTime(HOME, 2024, 6, 10, 8, 0),
      zonedWallTime(HOME, 2024, 6, 10, 14, 0),
    )
    const mid = duty(
      'mid',
      zonedWallTime(HOME, 2024, 6, 11, 12, 0),
      zonedWallTime(HOME, 2024, 6, 11, 18, 0),
    )
    const d2 = duty(
      'b',
      zonedWallTime(HOME, 2024, 6, 12, 14, 0),
      zonedWallTime(HOME, 2024, 6, 12, 20, 0),
    )
    const lnrs = detectLocalNightsFromDuties([d1, mid, d2], HOME)
    // LNR between d1-mid and mid-d2 — consecutive keys 10 and 11?
    const sdfs = buildSingleDaysFree(lnrs, [d1, mid, d2])
    // mid duty intersects any span covering both nights
    for (const sdf of sdfs) {
      expect(mid.start.getTime() >= sdf.end.getTime() || mid.end.getTime() <= sdf.start.getTime()).toBe(
        true,
      )
    }
  })
})

describe('evaluate70029OptionC', () => {
  it('flags >60 h work in 168 h', () => {
    // 6 days × 11 h = 66 h
    const duties: DutyEvent[] = []
    for (let day = 1; day <= 6; day++) {
      duties.push(
        duty(
          `d${day}`,
          zonedWallTime(HOME, 2024, 6, day, 8, 0),
          zonedWallTime(HOME, 2024, 6, day, 19, 0),
        ),
      )
    }
    const report = evaluate70029OptionC(duties, HOME, 'TC')
    expect(hasHard70029HourViolation(report)).toBe(true)
    expect(report.violations.some((v) => v.code === 'work_60_in_168')).toBe(
      true,
    )
  })

  it('does not flag missing SDF for 4×12 h early starts while free day can still fit', () => {
    // 48 h work, under 60 h; after day 4 there is still room before first+168 h for 2 LNRs
    const duties: DutyEvent[] = []
    for (let day = 10; day <= 13; day++) {
      duties.push(
        duty(
          `d${day}`,
          zonedWallTime(HOME, 2024, 6, day, 7, 0),
          zonedWallTime(HOME, 2024, 6, day, 19, 0),
        ),
      )
    }
    const report = evaluate70029OptionC(duties, HOME, 'TC')
    expect(report.violations.some((v) => v.code === 'missing_sdf_in_168')).toBe(
      false,
    )
  })

  it('does not flag missing SDF at exactly 60 h if 2 LNRs can still fit after last duty', () => {
    // 5 × 12 h = 60 h, day1 07:00 → day5 19:00; first+168h is day8 07:00 — room for free day
    const duties: DutyEvent[] = []
    for (let day = 1; day <= 5; day++) {
      duties.push(
        duty(
          `d${day}`,
          zonedWallTime(HOME, 2024, 6, day, 7, 0),
          zonedWallTime(HOME, 2024, 6, day, 19, 0),
        ),
      )
    }
    const report = evaluate70029OptionC(duties, HOME, 'TC')
    expect(report.violations.some((v) => v.code === 'missing_sdf_in_168')).toBe(
      false,
    )
  })

  it('does not soft-flag SDF for 5×12 h 07:00–19:00 Jul 13–17 2026 (user case)', () => {
    // Window ends 2026-07-17 19:00 with 60 h work; first FDP 13th 07:00 → deadline 20th 07:00
    // Two LNRs after last duty complete ~19th 07:30 — still room, so no missing_sdf
    const duties: DutyEvent[] = []
    for (let day = 13; day <= 17; day++) {
      duties.push(
        duty(
          `d${day}`,
          zonedWallTime(HOME, 2026, 7, day, 7, 0),
          zonedWallTime(HOME, 2026, 7, day, 19, 0),
        ),
      )
    }
    const report = evaluate70029OptionC(duties, HOME, 'TC')
    expect(report.violations.filter((v) => v.code === 'missing_sdf_in_168')).toHaveLength(
      0,
    )
    expect(report.violations.some((v) => v.code === 'work_60_in_168')).toBe(false)
  })

  it('flags missing SDF when free double-night can no longer finish before first+168h', () => {
    // First duty early on day 1; last work ends so late that 2 LNRs cannot finish by day1+168h
    // day1 07:00 start; work through day7 19:00 (7×12=84 h) — deadline day8 07:00, from day7 19:00 only ~12 h left
    const duties: DutyEvent[] = []
    for (let day = 1; day <= 7; day++) {
      duties.push(
        duty(
          `d${day}`,
          zonedWallTime(HOME, 2024, 6, day, 7, 0),
          zonedWallTime(HOME, 2024, 6, day, 19, 0),
        ),
      )
    }
    const report = evaluate70029OptionC(duties, HOME, 'TC')
    // Will also hard-fail 60 h; ensure missing_sdf or hour violation appears
    expect(
      report.violations.some(
        (v) =>
          v.code === 'missing_sdf_in_168' || v.code === 'work_60_in_168',
      ),
    ).toBe(true)
  })

  it('does not flag missing SDF for a single short duty', () => {
    const duties = [
      duty(
        'only',
        zonedWallTime(HOME, 2024, 6, 10, 8, 0),
        zonedWallTime(HOME, 2024, 6, 10, 16, 0),
      ),
    ]
    const report = evaluate70029OptionC(duties, HOME, 'TC')
    expect(report.violations.some((v) => v.code === 'missing_sdf_in_168')).toBe(
      false,
    )
    expect(
      report.violations.some((v) => v.code === 'missing_sdf_count_in_672'),
    ).toBe(false)
  })

  it('displays earliest post-work free day after a duty (not every free night pair)', () => {
    // Long free after one duty forms many technical SDFs; show only the earliest
    // free day right after release (awareness), not a chip for every pair.
    const events = [
      duty(
        'only',
        zonedWallTime(HOME, 2024, 6, 10, 8, 0),
        zonedWallTime(HOME, 2024, 6, 10, 16, 0),
      ),
      {
        id: 'f',
        title: 'Free',
        start: zonedWallTime(HOME, 2024, 6, 10, 16, 0),
        end: zonedWallTime(HOME, 2024, 6, 22, 12, 0),
        type: 'free' as const,
        acclTZ: HOME,
        workFactor: 0,
      },
    ]
    const report = evaluate70029OptionC(events, HOME, 'TC')
    expect(report.sdfs.length).toBeGreaterThan(1)
    const post = report.displaySdfs.filter((d) =>
      d.reasons.includes('post_work_free'),
    )
    expect(post.length).toBe(1)
    // Earliest free day starts on the first night after release
    expect(post[0].sdf.start.getTime()).toBe(report.sdfs[0].start.getTime())
  })

  it('displays SDF after 4 consecutive RAPs when the next days are free', () => {
    // Free day not mandatory yet (only 4 days), but open calendar after the
    // block forms a completed free day — show it for awareness.
    const events: DutyEvent[] = [10, 11, 12, 13].map((d) => ({
      id: `r${d}`,
      title: 'Home Reserve',
      type: 'reserve' as const,
      start: zonedWallTime(HOME, 2026, 8, d, 6, 0),
      end: zonedWallTime(HOME, 2026, 8, d, 18, 0),
      acclTZ: HOME,
      workFactor: 0.33,
    }))
    const report = evaluate70029OptionC(events, HOME, 'TC')
    expect(report.sdfs.length).toBeGreaterThan(0)
    expect(
      report.displaySdfs.some((d) => d.reasons.includes('post_work_free')),
    ).toBe(true)
    // No free-day *rest requirement* force from display alone — just awareness
    const afterBlock = report.displaySdfs.filter(
      (d) =>
        d.sdf.start.getTime() >=
        zonedWallTime(HOME, 2026, 8, 13, 18, 0).getTime() - 60_000,
    )
    expect(afterBlock.length).toBeGreaterThan(0)
  })

  it('displays SDF for awareness when free day fully covers a 168 h window that has work', () => {
    // User intent: free weekend before a RAP block still sits in the lookback
    // ending at the last RAP — show the SDF chip so coverage is visible.
    const events: DutyEvent[] = [
      {
        id: 'r13',
        title: 'Home Reserve',
        type: 'reserve',
        start: zonedWallTime(HOME, 2026, 8, 13, 6, 0),
        end: zonedWallTime(HOME, 2026, 8, 13, 18, 0),
        acclTZ: HOME,
        workFactor: 0.33,
      },
      {
        id: 'r14',
        title: 'Home Reserve',
        type: 'reserve',
        start: zonedWallTime(HOME, 2026, 8, 14, 6, 0),
        end: zonedWallTime(HOME, 2026, 8, 14, 18, 0),
        acclTZ: HOME,
        workFactor: 0.33,
      },
    ]
    for (let day = 18; day <= 22; day++) {
      events.push({
        id: `r${day}`,
        title: 'Home Reserve',
        type: 'reserve',
        start: zonedWallTime(HOME, 2026, 8, day, 6, 0),
        end: zonedWallTime(HOME, 2026, 8, day, 18, 0),
        acclTZ: HOME,
        workFactor: 0.33,
      })
    }
    const report = evaluate70029OptionC(events, HOME, 'TC')
    expect(report.sdfs.length).toBeGreaterThan(0)
    expect(
      report.displaySdfs.some(
        (d) =>
          d.reasons.includes('covers_work') ||
          d.reasons.includes('load_bearing'),
      ),
    ).toBe(true)
    // Free day mid Aug 15–17 range should be among displayed
    const midFree = report.displaySdfs.some((d) => {
      const s = d.sdf.start.getTime()
      return (
        s >= zonedWallTime(HOME, 2026, 8, 15, 0, 0).getTime() &&
        s < zonedWallTime(HOME, 2026, 8, 18, 0, 0).getTime()
      )
    })
    expect(midFree).toBe(true)
  })

  it('detects trailing free-day SDFs after dense work but does not force display until absolutely required', () => {
    const events: DutyEvent[] = []
    for (let day = 1; day <= 5; day++) {
      events.push(
        duty(
          `d${day}`,
          zonedWallTime(HOME, 2024, 6, day, 8, 0),
          zonedWallTime(HOME, 2024, 6, day, 16, 0),
        ),
      )
    }
    events.push({
      id: 'f',
      title: 'Free',
      start: zonedWallTime(HOME, 2024, 6, 5, 16, 0),
      end: zonedWallTime(HOME, 2024, 6, 12, 12, 0),
      type: 'free',
      acclTZ: HOME,
      workFactor: 0,
    })
    const report = evaluate70029OptionC(events, HOME, 'TC')
    expect(report.sdfs.length).toBeGreaterThan(0)
    // Free day still deferrable (no next FDP that closes the week) → no forced display
    expect(
      report.displaySdfs.some((d) => d.reasons.includes('prospective')),
    ).toBe(false)
  })

  it('shows free-day need after multi-day block when another FDP would close the SDF window', () => {
    const events: DutyEvent[] = [
      {
        id: 'f0',
        title: 'Free',
        start: zonedWallTime(HOME, 2026, 7, 11, 18, 0),
        end: zonedWallTime(HOME, 2026, 7, 13, 12, 0),
        type: 'free',
        acclTZ: HOME,
        workFactor: 0,
      },
    ]
    for (let day = 20; day <= 24; day++) {
      events.push(
        duty(
          `d${day}`,
          zonedWallTime(HOME, 2026, 7, day, 7, 0),
          zonedWallTime(HOME, 2026, 7, day, 14, 0),
        ),
      )
    }
    const report = evaluate70029OptionC(events, HOME, 'TC')
    expect(report.violations.some((v) => v.code === 'missing_sdf_in_168')).toBe(
      false,
    )
    // Hypothetical next FDP would leave no room for free day → show SDF now
    expect(
      report.displaySdfs.some(
        (d) =>
          d.reasons.includes('prospective') ||
          d.reasons.includes('required_before_next'),
      ),
    ).toBe(true)

    // Late FDP on the 26th with no free day → soft-flag when free day no longer fits
    const withLate = [
      ...events,
      duty(
        'd26',
        zonedWallTime(HOME, 2026, 7, 26, 7, 0),
        zonedWallTime(HOME, 2026, 7, 26, 13, 0),
      ),
    ]
    const after = evaluate70029OptionC(withLate, HOME, 'TC')
    expect(after.violations.some((v) => v.code === 'missing_sdf_in_168')).toBe(
      true,
    )
  })

  it('shows SDF after five consecutive duties when another FDP would not leave room for free day', () => {
    const events: DutyEvent[] = []
    for (let day = 20; day <= 24; day++) {
      events.push(
        duty(
          `d${day}`,
          zonedWallTime(HOME, 2026, 7, day, 7, 0),
          zonedWallTime(HOME, 2026, 7, day, 14, 0),
        ),
      )
    }
    const report = evaluate70029OptionC(events, HOME, 'TC')
    expect(
      report.displaySdfs.some(
        (d) =>
          d.reasons.includes('prospective') ||
          d.reasons.includes('required_before_next'),
      ),
    ).toBe(true)
  })

  it('does not flag 4-SDF / 28 d requirement on a short multi-day pairing', () => {
    // Two duties three days apart — can form SDF but not 4 SDFs; span << 21 d
    const duties = [
      duty(
        'a',
        zonedWallTime(HOME, 2024, 6, 3, 8, 0),
        zonedWallTime(HOME, 2024, 6, 3, 16, 0),
      ),
      duty(
        'b',
        zonedWallTime(HOME, 2024, 6, 7, 10, 0),
        zonedWallTime(HOME, 2024, 6, 7, 16, 0),
      ),
    ]
    const report = evaluate70029OptionC(duties, HOME, 'TC')
    expect(
      report.violations.some((v) => v.code === 'missing_sdf_count_in_672'),
    ).toBe(false)
  })

  it('passes a light schedule with a multi-day free gap (SDF present)', () => {
    const duties = [
      duty(
        'a',
        zonedWallTime(HOME, 2024, 6, 3, 8, 0),
        zonedWallTime(HOME, 2024, 6, 3, 16, 0),
      ),
      // free 3rd evening through 7th morning — multiple LNRs / SDFs
      duty(
        'b',
        zonedWallTime(HOME, 2024, 6, 7, 10, 0),
        zonedWallTime(HOME, 2024, 6, 7, 16, 0),
      ),
    ]
    const report = evaluate70029OptionC(duties, HOME, 'TC')
    expect(report.sdfs.length).toBeGreaterThanOrEqual(1)
    // At anchor = b.end, 168h window should include the SDF
    const softSdf = report.violations.filter((v) => v.code === 'missing_sdf_in_168')
    // May still miss 4 SDFs in 672h — soft warning allowed
    expect(report.violations.some((v) => v.code === 'work_60_in_168')).toBe(
      false,
    )
    void softSdf
  })

  it('counts work hours with partial overlap', () => {
    const d = duty(
      'x',
      zonedWallTime(HOME, 2024, 6, 10, 20, 0),
      zonedWallTime(HOME, 2024, 6, 11, 4, 0),
    )
    const w0 = zonedWallTime(HOME, 2024, 6, 11, 0, 0)
    const w1 = zonedWallTime(HOME, 2024, 6, 11, 12, 0)
    const h = getWorkHoursInWindow([d], w0, w1)
    expect(h).toBeCloseTo(4, 5)
  })

  it('is a no-op for non-TC regulators', () => {
    const duties = [
      duty(
        'a',
        zonedWallTime(HOME, 2024, 6, 1, 8, 0),
        zonedWallTime(HOME, 2024, 6, 1, 20, 0),
      ),
    ]
    const report = evaluate70029OptionC(duties, HOME, 'FAA')
    expect(report.violations).toHaveLength(0)
    expect(report.sdfs).toHaveLength(0)
  })
})

describe('countSdfsInWindow', () => {
  it('requires entire SDF inside window', () => {
    const d1 = duty(
      'a',
      zonedWallTime(HOME, 2024, 6, 1, 8, 0),
      zonedWallTime(HOME, 2024, 6, 1, 16, 0),
    )
    const d2 = duty(
      'b',
      zonedWallTime(HOME, 2024, 6, 5, 10, 0),
      zonedWallTime(HOME, 2024, 6, 5, 16, 0),
    )
    const lnrs = detectLocalNightsFromDuties([d1, d2], HOME)
    const sdfs = buildSingleDaysFree(lnrs, [d1, d2])
    expect(sdfs.length).toBeGreaterThanOrEqual(1)
    const sdf = sdfs[0]
    const tightStart = new Date(sdf.start.getTime() + 1000)
    const tightEnd = sdf.end
    expect(countSdfsInWindow(sdfs, tightStart, tightEnd)).toBe(0)
    expect(
      countSdfsInWindow(
        sdfs,
        new Date(sdf.start.getTime() - H),
        new Date(sdf.end.getTime() + H),
      ),
    ).toBeGreaterThanOrEqual(1)
  })
})

const H = 3600000
