import { describe, expect, it } from 'vitest'
import {
  getMaxDutyFromTable,
  getMaxFdpHours,
  getMinRestHours,
  getWeeklyDutyHours,
  wouldExceedWeeklyLimit,
  computeLocalNightRest,
  eventsOverlap,
  isEarlyDuty,
  isLateDuty,
  isNightDuty,
  isDisruptiveTransition,
  getDutyMarkers,
  dutyHasEarlyMarker,
  dutyHasLateMarker,
  dutyHasNightMarker,
  bestLocalNightWindowHours,
  markerBarAnchor,
} from './regulations'
import type { DutyEvent } from './types'
import { getZonedTimeParts, zonedWallTime } from './time'

const TZ = 'UTC'

/** Build a Date at wall-clock time in TZ (UTC for tests). */
function at(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi = 0,
  tz = TZ,
): Date {
  return zonedWallTime(tz, y, mo, d, h, mi)
}

function duty(
  id: string,
  start: Date,
  end: Date,
  acclTZ = TZ,
): DutyEvent {
  return {
    id,
    title: 'Duty',
    start,
    end,
    type: 'duty',
    acclTZ,
  }
}

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
    const inside = mk(
      'a',
      new Date('2024-06-14T08:00:00'),
      new Date('2024-06-14T12:00:00'),
    )
    const partial = mk(
      'b',
      new Date('2024-06-08T00:00:00'),
      new Date('2024-06-08T20:00:00'),
    )
    const hours = getWeeklyDutyHours([inside, partial], windowEnd)
    expect(hours).toBeGreaterThanOrEqual(4)
    expect(hours).toBe(4 + 8)
  })

  it('detects weekly limit breach against rolling window ending at duty end', () => {
    const start = new Date('2024-06-15T08:00:00')
    const end = new Date('2024-06-15T18:00:00')
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
    expect(wouldExceedWeeklyLimit(heavy, start, end)).toBe(true)
    expect(wouldExceedWeeklyLimit(prior, start, end)).toBe(false)
  })
})

describe('TC Early / Late / Night predicates', () => {
  it('Early: begins 02:00–06:59 only', () => {
    expect(isEarlyDuty(at(2024, 6, 10, 1, 59), 'TC', TZ)).toBe(false)
    expect(isEarlyDuty(at(2024, 6, 10, 2, 0), 'TC', TZ)).toBe(true)
    expect(isEarlyDuty(at(2024, 6, 10, 5, 30), 'TC', TZ)).toBe(true)
    expect(isEarlyDuty(at(2024, 6, 10, 6, 59), 'TC', TZ)).toBe(true)
    expect(isEarlyDuty(at(2024, 6, 10, 7, 0), 'TC', TZ)).toBe(false)
  })

  it('Late: ends 00:00–01:59 only', () => {
    expect(isLateDuty(at(2024, 6, 10, 0, 0), 'TC', TZ)).toBe(true)
    expect(isLateDuty(at(2024, 6, 10, 1, 30), 'TC', TZ)).toBe(true)
    expect(isLateDuty(at(2024, 6, 10, 1, 59), 'TC', TZ)).toBe(true)
    expect(isLateDuty(at(2024, 6, 10, 2, 0), 'TC', TZ)).toBe(false)
    expect(isLateDuty(at(2024, 6, 10, 23, 0), 'TC', TZ)).toBe(false)
  })

  it('Night: start 13:00–01:59 and duty reaches 02:00 (not same-day afternoon)', () => {
    // Same-day afternoon/evening — NOT night
    expect(
      isNightDuty(at(2024, 6, 10, 14, 0), at(2024, 6, 10, 22, 0), 'TC', TZ),
    ).toBe(false)
    expect(
      isNightDuty(at(2024, 6, 10, 13, 0), at(2024, 6, 10, 20, 0), 'TC', TZ),
    ).toBe(false)
    expect(
      isNightDuty(at(2024, 6, 10, 18, 0), at(2024, 6, 10, 23, 30), 'TC', TZ),
    ).toBe(false)

    // Classic overnight — night
    expect(
      isNightDuty(at(2024, 6, 10, 22, 0), at(2024, 6, 11, 6, 0), 'TC', TZ),
    ).toBe(true)
    expect(
      isNightDuty(at(2024, 6, 10, 14, 0), at(2024, 6, 11, 2, 30), 'TC', TZ),
    ).toBe(true)
    expect(
      isNightDuty(at(2024, 6, 10, 13, 0), at(2024, 6, 11, 2, 0), 'TC', TZ),
    ).toBe(true)

    // Ends 01:30 next day — Late territory, not Night
    expect(
      isNightDuty(at(2024, 6, 10, 14, 0), at(2024, 6, 11, 1, 30), 'TC', TZ),
    ).toBe(false)

    // Start 01:00 end 08:00 same day — Night
    expect(
      isNightDuty(at(2024, 6, 10, 1, 0), at(2024, 6, 10, 8, 0), 'TC', TZ),
    ).toBe(true)

    // Early morning start 02:30 — Early, not Night
    expect(
      isNightDuty(at(2024, 6, 10, 2, 30), at(2024, 6, 10, 10, 0), 'TC', TZ),
    ).toBe(false)
  })
})

describe('getDutyMarkers (independent E/L/N)', () => {
  it('can show both E and L on a long duty', () => {
    const e = duty(
      'x',
      at(2024, 6, 10, 5, 0),
      at(2024, 6, 11, 1, 0),
    )
    const markers = getDutyMarkers(e, 'TC', TZ, true, true)
    expect(markers).toContain('E')
    expect(markers).toContain('L')
    expect(markers).not.toContain('N')
  })

  it('does not mark afternoon duty as N', () => {
    const e = duty(
      'a',
      at(2024, 6, 10, 14, 0),
      at(2024, 6, 10, 22, 0),
    )
    expect(getDutyMarkers(e, 'TC', TZ, true, true)).toEqual([])
  })

  it('marks overnight as N once on end day', () => {
    const e = duty(
      'n',
      at(2024, 6, 10, 22, 0),
      at(2024, 6, 11, 6, 0),
    )
    // Both start+end true only on same-day cells; overnight end day:
    expect(getDutyMarkers(e, 'TC', TZ, false, true)).toEqual(['N'])
    // Start day only — no N (single marker per duty on release day)
    expect(getDutyMarkers(e, 'TC', TZ, true, false)).toEqual([])
    expect(getDutyMarkers(e, 'TC', TZ, false, false)).toEqual([])
  })

  it('same-day night shows one N when start and end are that day', () => {
    const e = duty(
      'n',
      at(2024, 6, 10, 1, 0),
      at(2024, 6, 10, 8, 0),
    )
    expect(getDutyMarkers(e, 'TC', TZ, true, true)).toEqual(['N'])
  })

  it('Early only on start day; Late only on end day', () => {
    const early = duty(
      'e',
      at(2024, 6, 10, 5, 0),
      at(2024, 6, 10, 12, 0),
    )
    expect(getDutyMarkers(early, 'TC', TZ, true, true)).toEqual(['E'])
    expect(getDutyMarkers(early, 'TC', TZ, false, true)).toEqual([])

    const late = duty(
      'l',
      at(2024, 6, 10, 18, 0),
      at(2024, 6, 11, 1, 0),
    )
    expect(getDutyMarkers(late, 'TC', TZ, true, false)).toEqual([])
    expect(getDutyMarkers(late, 'TC', TZ, false, true)).toEqual(['L'])
  })

  it('anchors E to bar start and L/N to bar end', () => {
    expect(markerBarAnchor('E')).toBe('start')
    expect(markerBarAnchor('L')).toBe('end')
    expect(markerBarAnchor('N')).toBe('end')
    expect(markerBarAnchor('LNR')).toBe('center')
  })
})

describe('CAR 700.41 disruptive transitions', () => {
  it('requires LNR for Late → Early', () => {
    const late = duty(
      'l',
      at(2024, 6, 10, 18, 0),
      at(2024, 6, 11, 1, 0),
    )
    const early = duty(
      'e',
      at(2024, 6, 11, 5, 0),
      at(2024, 6, 11, 12, 0),
    )
    expect(dutyHasLateMarker(late, 'TC', TZ)).toBe(true)
    expect(dutyHasNightMarker(late, 'TC', TZ)).toBe(false)
    expect(dutyHasEarlyMarker(early, 'TC', TZ)).toBe(true)
    expect(isDisruptiveTransition(late, early, 'TC', TZ)).toBe(true)
  })

  it('requires LNR for Night → Early', () => {
    const night = duty(
      'n',
      at(2024, 6, 10, 22, 0),
      at(2024, 6, 11, 6, 0),
    )
    const early = duty(
      'e',
      at(2024, 6, 12, 5, 0),
      at(2024, 6, 12, 12, 0),
    )
    expect(isDisruptiveTransition(night, early, 'TC', TZ)).toBe(true)
  })

  it('requires LNR for Early → Night and Early → Late', () => {
    const early = duty(
      'e',
      at(2024, 6, 10, 5, 0),
      at(2024, 6, 10, 12, 0),
    )
    const night = duty(
      'n',
      at(2024, 6, 10, 22, 0),
      at(2024, 6, 11, 6, 0),
    )
    const late = duty(
      'l',
      at(2024, 6, 10, 18, 0),
      at(2024, 6, 11, 1, 0),
    )
    expect(isDisruptiveTransition(early, night, 'TC', TZ)).toBe(true)
    expect(isDisruptiveTransition(early, late, 'TC', TZ)).toBe(true)
  })

  it('does not flag Early → normal day duty', () => {
    const early = duty(
      'e',
      at(2024, 6, 10, 5, 0),
      at(2024, 6, 10, 12, 0),
    )
    const day = duty(
      'd',
      at(2024, 6, 10, 14, 0),
      at(2024, 6, 10, 20, 0),
    )
    expect(isDisruptiveTransition(early, day, 'TC', TZ)).toBe(false)
  })
})

describe('computeLocalNightRest (acclimatized LNR)', () => {
  it('flags short gap as violated', () => {
    const prevEnd = at(2024, 6, 10, 23, 0)
    const nextStart = at(2024, 6, 11, 5, 0) // 6h gap
    const r = computeLocalNightRest(prevEnd, nextStart, TZ, 12)
    expect(r.violated).toBe(true)
    expect(r.gapHours).toBeLessThan(12)
  })

  it('passes when gap includes ≥9h in 22:30–09:30 and ≥12h total', () => {
    // Rest 20:00 → 10:00 next day = 14h; window 22:30–09:30 = 11h overlap
    const prevEnd = at(2024, 6, 10, 20, 0)
    const nextStart = at(2024, 6, 11, 10, 0)
    const r = computeLocalNightRest(prevEnd, nextStart, TZ, 12)
    expect(r.gapHours).toBe(14)
    expect(r.nightWindowHours).toBeGreaterThanOrEqual(9)
    expect(r.violated).toBe(false)
  })

  it('fails when gap is long but misses local night window', () => {
    // Rest entirely daytime: 10:00 → 23:00 = 13h, little 22:30–09:30 overlap
    const prevEnd = at(2024, 6, 10, 10, 0)
    const nextStart = at(2024, 6, 10, 23, 0)
    const r = computeLocalNightRest(prevEnd, nextStart, TZ, 12)
    expect(r.gapHours).toBe(13)
    expect(r.nightWindowHours).toBeLessThan(9)
    expect(r.violated).toBe(true)
  })

  it('does not use invented 00:30 / 07:30 hard gates', () => {
    // Starts after 00:30 and ends before 07:30 but still 9h+ in window if gap is 22:30–07:45? 
    // Rest 00:45 → 10:00: overlap with 22:30–09:30 is 00:45–09:30 = 8.75h < 9 → violate on night hours
    // Rest 22:00 → 08:00: 10h gap, window 22:30–08:00 = 9.5h, ends 08:00 (< old minEnd 07:30 false)
    const prevEnd = at(2024, 6, 10, 22, 0)
    const nextStart = at(2024, 6, 11, 8, 0)
    const r = computeLocalNightRest(prevEnd, nextStart, TZ, 10)
    expect(r.nightWindowHours).toBeGreaterThanOrEqual(9)
    expect(r.violated).toBe(false)
  })

  it('evaluates window in acclimatized TZ not browser local', () => {
    // Fixed UTC instants that are 22:30–09:30 in America/Toronto (EDT = UTC-4 in June)
    // 22:30 Toronto = 02:30 UTC next calendar day... June 10 22:30 EDT = June 11 02:30 UTC
    const tz = 'America/Toronto'
    const prevEnd = zonedWallTime(tz, 2024, 6, 10, 20, 0)
    const nextStart = zonedWallTime(tz, 2024, 6, 11, 10, 0)
    const hours = bestLocalNightWindowHours(prevEnd, nextStart, tz)
    expect(hours).toBeGreaterThanOrEqual(9)
    const r = computeLocalNightRest(prevEnd, nextStart, tz, 12)
    expect(r.violated).toBe(false)
    // Confirm zoned parts
    expect(getZonedTimeParts(prevEnd, tz).hour).toBe(20)
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
