import { describe, expect, it } from 'vitest'
import {
  computeRdpFdpLimit,
  earlyRapNoContactExtensionHours,
  evaluateRdpForDuty,
  evaluateRdpForReserve,
  findContinuousRapStart,
  getMaxRdpHoursFromRapStartHour,
} from './rest-70070'
import type { DutyEvent } from './types'
import { zonedWallTime } from './time'

const TZ = 'America/Toronto'

describe('getMaxRdpHoursFromRapStartHour (CAR 700.70(7))', () => {
  it('returns 18 h for RAP starts 02:00–17:59', () => {
    for (const h of [2, 5, 8, 12, 17]) {
      expect(getMaxRdpHoursFromRapStartHour(h).maxRdpHours).toBe(18)
    }
  })

  it('returns 17 h for RAP start 18:xx', () => {
    expect(getMaxRdpHoursFromRapStartHour(18).maxRdpHours).toBe(17)
  })

  it('returns 16 h for RAP starts 19–20', () => {
    expect(getMaxRdpHoursFromRapStartHour(19).maxRdpHours).toBe(16)
    expect(getMaxRdpHoursFromRapStartHour(20).maxRdpHours).toBe(16)
  })

  it('returns 15 h for RAP starts 21–22', () => {
    expect(getMaxRdpHoursFromRapStartHour(21).maxRdpHours).toBe(15)
    expect(getMaxRdpHoursFromRapStartHour(22).maxRdpHours).toBe(15)
  })

  it('returns 14 h for RAP starts 23:00–01:59', () => {
    expect(getMaxRdpHoursFromRapStartHour(23).maxRdpHours).toBe(14)
    expect(getMaxRdpHoursFromRapStartHour(0).maxRdpHours).toBe(14)
    expect(getMaxRdpHoursFromRapStartHour(1).maxRdpHours).toBe(14)
  })
})

describe('computeRdpFdpLimit — AC 700-047 §4.84 examples', () => {
  it('FDP table is limiting when RAP and report are both 08:00 (max FDP 13 h < RDP 18 h)', () => {
    // AC ex (i): RAP 08:00, FDP 08:00, 1–4 sectors ≥50 → max FDP 13 h; RDP 18 h
    const rapStart = zonedWallTime(TZ, 2026, 7, 11, 8, 0)
    const report = zonedWallTime(TZ, 2026, 7, 11, 8, 0)
    const r = computeRdpFdpLimit({
      rapStart,
      report,
      acclTZ: TZ,
      maxFdpTableHours: 13,
      extendedMaxFdpHours: 13,
    })
    expect(r.baseMaxRdpHours).toBe(18)
    expect(r.elapsedRapToReportHours).toBeCloseTo(0, 5)
    expect(r.remainingRdpForFdpHours).toBeCloseTo(18, 5)
    expect(r.limitingMaxFdpHours).toBe(13)
    expect(r.limitingSource).toBe('fdp_70028')
  })

  it('RDP is limiting when late callout leaves less than table max FDP', () => {
    // AC ex (ii): RAP 08:00, FDP starts 20:00, table would allow 12 h → 08:00 next day
    // but RDP must end 02:00 (08:00+18) → remaining for FDP = 6 h
    const rapStart = zonedWallTime(TZ, 2026, 7, 11, 8, 0)
    const report = zonedWallTime(TZ, 2026, 7, 11, 20, 0)
    const r = computeRdpFdpLimit({
      rapStart,
      report,
      acclTZ: TZ,
      maxFdpTableHours: 12,
      extendedMaxFdpHours: 12,
    })
    expect(r.maxRdpHours).toBe(18)
    expect(r.elapsedRapToReportHours).toBeCloseTo(12, 5)
    expect(r.remainingRdpForFdpHours).toBeCloseTo(6, 5)
    expect(r.limitingMaxFdpHours).toBeCloseTo(6, 5)
    expect(r.limitingSource).toBe('rdp_70070')
  })

  it('700.70(10) notice escape uses 700.28 only', () => {
    const rapStart = zonedWallTime(TZ, 2026, 7, 11, 8, 0)
    const report = zonedWallTime(TZ, 2026, 7, 11, 20, 0)
    const r = computeRdpFdpLimit({
      rapStart,
      report,
      acclTZ: TZ,
      maxFdpTableHours: 12,
      extendedMaxFdpHours: 12,
      notice24hEscape: true,
    })
    expect(r.limitingMaxFdpHours).toBe(12)
    expect(r.limitingSource).toBe('notice_24h_escape')
  })

  it('split duty on reserve adds +2 h to max RDP (700.50(5))', () => {
    const rapStart = zonedWallTime(TZ, 2026, 7, 11, 8, 0)
    const report = zonedWallTime(TZ, 2026, 7, 11, 20, 0)
    const r = computeRdpFdpLimit({
      rapStart,
      report,
      acclTZ: TZ,
      maxFdpTableHours: 12,
      extendedMaxFdpHours: 13.5, // e.g. table + split extension
      splitDutyOnReserve: true,
    })
    expect(r.maxRdpHours).toBe(20) // 18 + 2
    expect(r.remainingRdpForFdpHours).toBeCloseTo(8, 5) // 20 - 12
    // min(13.5, 8) = 8
    expect(r.limitingMaxFdpHours).toBeCloseTo(8, 5)
    expect(r.limitingSource).toBe('rdp_70070')
  })

  it('evening RAP uses tighter 14–17 h bands', () => {
    // RAP 22:00 → max RDP 15 h
    const rapStart = zonedWallTime(TZ, 2026, 7, 11, 22, 0)
    const report = zonedWallTime(TZ, 2026, 7, 12, 2, 0) // +4 h
    const r = computeRdpFdpLimit({
      rapStart,
      report,
      acclTZ: TZ,
      maxFdpTableHours: 11,
      extendedMaxFdpHours: 11,
    })
    expect(r.baseMaxRdpHours).toBe(15)
    expect(r.remainingRdpForFdpHours).toBeCloseTo(11, 5)
    expect(r.limitingSource).toBe('fdp_70028')
  })
})

describe('earlyRapNoContactExtensionHours (700.70(9))', () => {
  it('AC example: RAP 04:00, no contact before 06:00 → +1 h', () => {
    const rapStart = zonedWallTime(TZ, 2026, 7, 11, 4, 0)
    const ext = earlyRapNoContactExtensionHours(rapStart, TZ, null)
    expect(ext).toBeCloseTo(1, 5) // 50% of 2 h in 02–06
  })

  it('returns 0 when RAP starts outside 02:00–05:59', () => {
    const rapStart = zonedWallTime(TZ, 2026, 7, 11, 8, 0)
    expect(earlyRapNoContactExtensionHours(rapStart, TZ)).toBe(0)
  })

  it('returns 0 when contacted during early window', () => {
    const rapStart = zonedWallTime(TZ, 2026, 7, 11, 4, 0)
    const contact = zonedWallTime(TZ, 2026, 7, 11, 5, 0)
    expect(earlyRapNoContactExtensionHours(rapStart, TZ, contact)).toBe(0)
  })
})

describe('findContinuousRapStart', () => {
  function reserve(
    id: string,
    start: Date,
    end: Date,
  ): DutyEvent {
    return {
      id,
      title: 'Reserve',
      type: 'reserve',
      start,
      end,
      acclTZ: TZ,
    }
  }

  it('finds reserve covering report', () => {
    const rapStart = zonedWallTime(TZ, 2026, 7, 11, 8, 0)
    const rapEnd = zonedWallTime(TZ, 2026, 7, 11, 22, 0)
    const report = zonedWallTime(TZ, 2026, 7, 11, 20, 0)
    const found = findContinuousRapStart(
      [reserve('r1', rapStart, rapEnd)],
      report,
    )
    expect(found?.getTime()).toBe(rapStart.getTime())
  })

  it('finds reserve that ends at report (handoff shortened)', () => {
    const rapStart = zonedWallTime(TZ, 2026, 7, 11, 8, 0)
    const report = zonedWallTime(TZ, 2026, 7, 11, 16, 0)
    const found = findContinuousRapStart(
      [reserve('r1', rapStart, report)],
      report,
    )
    expect(found?.getTime()).toBe(rapStart.getTime())
  })

  it('links reserve that ends at call time hours before report', () => {
    // User model: RAP started 08:00, company called at 10:00 → bar ends 10:00,
    // report is 20:00. RDP still uses RAP start 08:00 (not call time).
    const rapStart = zonedWallTime(TZ, 2026, 7, 11, 8, 0)
    const callTime = zonedWallTime(TZ, 2026, 7, 11, 10, 0)
    const report = zonedWallTime(TZ, 2026, 7, 11, 20, 0)
    const found = findContinuousRapStart(
      [reserve('r1', rapStart, callTime)],
      report,
    )
    expect(found?.getTime()).toBe(rapStart.getTime())
  })

  it('ignores standby (700.71, not RDP)', () => {
    const start = zonedWallTime(TZ, 2026, 7, 11, 8, 0)
    const end = zonedWallTime(TZ, 2026, 7, 11, 22, 0)
    const report = zonedWallTime(TZ, 2026, 7, 11, 12, 0)
    const found = findContinuousRapStart(
      [
        {
          id: 's1',
          title: 'Standby',
          type: 'standby',
          start,
          end,
          acclTZ: TZ,
        },
      ],
      report,
    )
    expect(found).toBeNull()
  })
})

describe('evaluateRdpForDuty / evaluateRdpForReserve (user schedule shape)', () => {
  it('links Aug 4 RAP 06:00–10:25 to FDP 10:25–22:25 even without stored rapStart', () => {
    // Live schedule: reserve ends at report; duty has no rapStart field yet
    const rapStart = zonedWallTime(TZ, 2026, 8, 4, 6, 0)
    const report = zonedWallTime(TZ, 2026, 8, 4, 10, 25)
    const release = zonedWallTime(TZ, 2026, 8, 4, 22, 25)
    const reserve: DutyEvent = {
      id: 'rsv',
      title: 'Airport Reserve',
      type: 'reserve',
      start: rapStart,
      end: report,
      acclTZ: TZ,
    }
    const duty: DutyEvent = {
      id: 'fdp',
      title: 'Flight Duty',
      type: 'duty',
      start: report,
      end: release,
      acclTZ: TZ,
      startTZ: TZ,
      endTZ: TZ,
      operatingSectors: 1,
      positioningSectors: 1,
      avgSectorTime: '>=50',
    }
    const schedule = [reserve, duty]
    const rdp = evaluateRdpForDuty(duty, schedule, {
      regulator: 'TC',
      globalAcclTZ: TZ,
      homeBaseTZ: TZ,
    })
    expect(rdp).not.toBeNull()
    expect(rdp!.maxRdpHours).toBe(18) // RAP 06:00 → 02–17 band
    expect(rdp!.elapsedRapToReportHours).toBeCloseTo(4.4167, 2)
    expect(rdp!.remainingRdpForFdpHours).toBeCloseTo(18 - 4.4167, 1)
    // Table ~13 h at 10:xx; remaining RDP ~13.58 → 700.28 usually limiting
    expect(rdp!.fdpTableLimitHours).toBeGreaterThanOrEqual(12)
    expect(rdp!.limitingMaxFdpHours).toBe(
      Math.min(rdp!.fdpTableLimitHours, rdp!.remainingRdpForFdpHours),
    )

    const fromRsv = evaluateRdpForReserve(reserve, schedule, {
      regulator: 'TC',
      globalAcclTZ: TZ,
      homeBaseTZ: TZ,
    })
    expect(fromRsv?.duty.id).toBe('fdp')
    expect(fromRsv?.rdp.limitingMaxFdpHours).toBe(rdp!.limitingMaxFdpHours)
  })
})
