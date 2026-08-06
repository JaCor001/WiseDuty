import { describe, expect, it } from 'vitest'
import {
  evaluateFdpNearMaxLimit,
  fdpHoursForNearLimit,
  fdpLimitDialogTone,
  shouldPromptFdpLimitDialog,
  FDP_AMBER_THRESHOLD_H,
  FDP_APPROACHING_THRESHOLD_H,
  FDP_NEAR_MAX_THRESHOLD_H,
  formatDurationHMin,
} from './fdp-near-limit'
import type { DutyEvent } from './types'
import { zonedWallTime } from './time'

const TZ = 'America/Toronto'

function duty(start: Date, end: Date, extra?: Partial<DutyEvent>): DutyEvent {
  return {
    id: 'd1',
    title: 'Flight Duty',
    type: 'duty',
    start,
    end,
    acclTZ: TZ,
    startTZ: TZ,
    endTZ: TZ,
    operatingSectors: 1,
    avgSectorTime: '>=50',
    ...extra,
  }
}

describe('evaluateFdpNearMaxLimit', () => {
  it('marks near (marker) when within 1.5 h but dialog ok until 30 min', () => {
    // Morning ~13 h max; 12 h duty → ~1 h remaining → near marker, not approach dialog
    const start = zonedWallTime(TZ, 2026, 8, 4, 8, 0)
    const end = zonedWallTime(TZ, 2026, 8, 4, 20, 0)
    const r = evaluateFdpNearMaxLimit(duty(start, end), {
      regulator: 'TC',
      globalAcclTZ: TZ,
    })
    expect(r.maxFdpHours).toBeGreaterThanOrEqual(12)
    expect(r.actualHours).toBeCloseTo(12, 5)
    expect(r.remainingHours).toBeLessThanOrEqual(FDP_NEAR_MAX_THRESHOLD_H)
    expect(r.near).toBe(true)
    if (r.remainingHours > FDP_APPROACHING_THRESHOLD_H) {
      expect(r.status).toBe('ok')
    }
  })

  it('status approaching when remaining ≤ 30 min', () => {
    // Force remaining ~0.4 h via long duty under a known max
    // 8:00 start 1 sector >=50 → 13 h max; end at 20:40 → 12.67 h, remaining ~0.33 h
    const start = zonedWallTime(TZ, 2026, 8, 4, 8, 0)
    const end = zonedWallTime(TZ, 2026, 8, 4, 20, 40)
    const r = evaluateFdpNearMaxLimit(duty(start, end), {
      regulator: 'TC',
      globalAcclTZ: TZ,
    })
    expect(r.remainingHours).toBeLessThanOrEqual(
      FDP_APPROACHING_THRESHOLD_H + 0.05,
    )
    expect(r.status).toBe('approaching')
    expect(r.message).toMatch(/approaching Max FDP/i)
    expect(r.remainingLabel.length).toBeGreaterThan(0)
  })

  it('status exceeded when past max', () => {
    const start = zonedWallTime(TZ, 2026, 8, 4, 8, 0)
    const end = zonedWallTime(TZ, 2026, 8, 4, 22, 0) // 14 h > 13
    const r = evaluateFdpNearMaxLimit(duty(start, end), {
      regulator: 'TC',
      globalAcclTZ: TZ,
    })
    expect(r.status).toBe('exceeded')
    expect(r.near).toBe(true)
    expect(r.message).toMatch(/exceeds Max FDP/i)
  })

  it('does not flag short duties', () => {
    const start = zonedWallTime(TZ, 2026, 8, 4, 8, 0)
    const end = zonedWallTime(TZ, 2026, 8, 4, 14, 0)
    const r = evaluateFdpNearMaxLimit(duty(start, end), {
      regulator: 'TC',
      globalAcclTZ: TZ,
    })
    expect(r.status).toBe('ok')
    expect(r.near).toBe(false)
  })

  it('uses operating end for trailing DH', () => {
    const start = zonedWallTime(TZ, 2026, 8, 4, 8, 0)
    const opEnd = zonedWallTime(TZ, 2026, 8, 4, 20, 40)
    const end = zonedWallTime(TZ, 2026, 8, 4, 23, 0)
    const d = duty(start, end, {
      endsWithPositioning: true,
      operatingEnd: opEnd,
    })
    expect(fdpHoursForNearLimit(d)).toBeCloseTo(12 + 40 / 60, 2)
  })

  it('formats duration labels', () => {
    expect(formatDurationHMin(0.5)).toBe('30 min')
    expect(formatDurationHMin(1.5)).toMatch(/1 h/)
  })

  it('dialog tone: amber within 1 h, red within 30 min or over', () => {
    expect(
      fdpLimitDialogTone({ status: 'ok', remainingHours: 0.9 }),
    ).toBe('amber')
    expect(
      fdpLimitDialogTone({ status: 'approaching', remainingHours: 0.4 }),
    ).toBe('danger')
    expect(
      fdpLimitDialogTone({ status: 'exceeded', remainingHours: -0.5 }),
    ).toBe('danger')
  })

  it('prompts from 1 h remaining through over-max', () => {
    expect(
      shouldPromptFdpLimitDialog({
        status: 'ok',
        remainingHours: FDP_AMBER_THRESHOLD_H,
        maxFdpHours: 13,
      }),
    ).toBe(true)
    expect(
      shouldPromptFdpLimitDialog({
        status: 'ok',
        remainingHours: 1.2,
        maxFdpHours: 13,
      }),
    ).toBe(false)
    expect(
      shouldPromptFdpLimitDialog({
        status: 'exceeded',
        remainingHours: -1,
        maxFdpHours: 13,
      }),
    ).toBe(true)
  })

  it('auto-links RAP from schedule when rapStart is not stored (reserve handoff)', () => {
    // Late call-out: RAP 08:00, report 16:00 → 8 h elapsed.
    // Max RDP (RAP 02–17) = 18 h → 10 h left for FDP (RDP limiting vs 700.28).
    // 9 h 45 min FDP → within 30 min of RDP max; without link, not near 700.28.
    const rapStart = zonedWallTime(TZ, 2026, 8, 4, 8, 0)
    const report = zonedWallTime(TZ, 2026, 8, 4, 16, 0)
    const release = zonedWallTime(TZ, 2026, 8, 5, 1, 45) // 9 h 45 min
    const reserve: DutyEvent = {
      id: 'rsv1',
      title: 'Reserve',
      type: 'reserve',
      start: rapStart,
      end: zonedWallTime(TZ, 2026, 8, 4, 15, 0), // call-out before report
      acclTZ: TZ,
    }
    const fdp = duty(report, release) // no rapStart stored
    const withLink = evaluateFdpNearMaxLimit(fdp, {
      regulator: 'TC',
      globalAcclTZ: TZ,
      allEvents: [reserve, fdp],
    })
    const withoutLink = evaluateFdpNearMaxLimit(fdp, {
      regulator: 'TC',
      globalAcclTZ: TZ,
    })
    // Without schedule, only 700.28 applies — 9.75 h is not near table max
    expect(withoutLink.rdpLimiting).toBe(false)
    expect(withoutLink.status).toBe('ok')
    expect(withoutLink.near).toBe(false)
    // With linked RAP, RDP is tighter and duty approaches that limit
    expect(withLink.rdpLimiting).toBe(true)
    expect(withLink.limitKind).toBe('RDP')
    expect(withLink.maxFdpHours).toBeLessThan(withoutLink.maxFdpHours)
    expect(withLink.near).toBe(true)
    expect(withLink.status).toBe('approaching')
  })
})
