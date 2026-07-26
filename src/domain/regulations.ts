import type { AvgSectorTime, DutyEvent, Regulator } from './types'
import {
  defaultWorkFactor,
  isWorkEvent,
  MAX_WEEKLY_DUTY_HOURS,
} from './types'
import {
  getHourInTZ,
  getMinutesInTZ,
  getZonedTimeParts,
  hoursBetweenTimeZones,
  nextZonedWallTime,
  zonedWallTimeOnDay,
} from './time'

type SectorGroupKey = string
type TimeSlotKey = string

const FDP_TABLE: Record<
  AvgSectorTime,
  Record<SectorGroupKey, Record<TimeSlotKey, number>>
> = {
  '<30': {
    '1-11': {
      '24-03': 9,
      '04-04': 10,
      '05-05': 11,
      '06-06': 12,
      '07-12': 13,
      '13-16': 12.5,
      '17-21': 12,
      '22-22': 11,
      '23-23': 10,
    },
    '12-17': {
      '24-03': 9,
      '04-04': 9,
      '05-05': 10,
      '06-06': 11,
      '07-12': 12,
      '13-16': 11.5,
      '17-21': 11,
      '22-22': 10,
      '23-23': 9,
    },
    '18+': {
      '24-03': 9,
      '04-04': 9,
      '05-05': 9,
      '06-06': 10,
      '07-12': 11,
      '13-16': 10.5,
      '17-21': 10,
      '22-22': 9,
      '23-23': 9,
    },
  },
  '30-50': {
    '1-7': {
      '24-03': 9,
      '04-04': 10,
      '05-05': 11,
      '06-06': 12,
      '07-12': 13,
      '13-16': 12.5,
      '17-21': 12,
      '22-22': 11,
      '23-23': 10,
    },
    '8-11': {
      '24-03': 9,
      '04-04': 9,
      '05-05': 10,
      '06-06': 11,
      '07-12': 12,
      '13-16': 11.5,
      '17-21': 11,
      '22-22': 10,
      '23-23': 9,
    },
    '12+': {
      '24-03': 9,
      '04-04': 9,
      '05-05': 9,
      '06-06': 10,
      '07-12': 11,
      '13-16': 10.5,
      '17-21': 10,
      '22-22': 9,
      '23-23': 9,
    },
  },
  '>=50': {
    '1-4': {
      '24-03': 9,
      '04-04': 10,
      '05-05': 11,
      '06-06': 12,
      '07-12': 13,
      '13-16': 12.5,
      '17-21': 12,
      '22-22': 11,
      '23-23': 10,
    },
    '5-6': {
      '24-03': 9,
      '04-04': 9,
      '05-05': 10,
      '06-06': 11,
      '07-12': 12,
      '13-16': 11.5,
      '17-21': 11,
      '22-22': 10,
      '23-23': 9,
    },
    '7+': {
      '24-03': 9,
      '04-04': 9,
      '05-05': 9,
      '06-06': 10,
      '07-12': 11,
      '13-16': 10.5,
      '17-21': 10,
      '22-22': 9,
      '23-23': 9,
    },
  },
}

function getSectorGroup(sectors: number, avg: AvgSectorTime): string {
  if (avg === '<30') {
    if (sectors <= 11) return '1-11'
    if (sectors <= 17) return '12-17'
    return '18+'
  }
  if (avg === '30-50') {
    if (sectors <= 7) return '1-7'
    if (sectors <= 11) return '8-11'
    return '12+'
  }
  if (sectors <= 4) return '1-4'
  if (sectors <= 6) return '5-6'
  return '7+'
}

function getTimeSlot(startHour: number): TimeSlotKey {
  const h = startHour === 24 ? 0 : startHour
  if (h >= 0 && h <= 3) return '24-03'
  if (h === 4) return '04-04'
  if (h === 5) return '05-05'
  if (h === 6) return '06-06'
  if (h >= 7 && h <= 12) return '07-12'
  if (h >= 13 && h <= 16) return '13-16'
  if (h >= 17 && h <= 21) return '17-21'
  if (h === 22) return '22-22'
  return '23-23'
}

/** CAR 705 FDP table lookup (hours). */
export function getMaxDutyFromTable(
  startHour: number,
  sectors: number,
  avg: AvgSectorTime,
): number {
  const group = getSectorGroup(sectors, avg)
  const slot = getTimeSlot(startHour)
  return FDP_TABLE[avg]?.[group]?.[slot] ?? 9
}

export function getMaxFdpHours(
  regulator: Regulator,
  acclimatizedStartHour: number,
  sectors: number,
  avg: AvgSectorTime,
): number {
  if (regulator === 'TC') {
    return getMaxDutyFromTable(acclimatizedStartHour, sectors, avg)
  }
  if (regulator === 'EASA') return 13
  return 14 // FAA / Australia baseline used in app today
}

/**
 * Soft ceiling for form warnings: longest FDP still conceivably legal under the
 * regime when stacking the most permissive provisions the app does not fully
 * model (augmented crew + rest facilities, split duty extensions, ULR, UOC /
 * commander discretion).
 *
 * Not a substitute for the sector/start-time table (`getMaxFdpHours`).
 *
 * Approximate sources:
 * - TC CAR 700.60 Class 1 rest facility / multi-pilot augmentation (~18 h)
 *   and 700.62 ultra-long-range operations (into the ~20 h range)
 * - EASA ORO.FTL augmented + commander's discretion (~17–18 h)
 * - FAA Part 117 augmented with Class 1 rest facility (~19 h)
 * - CASA CAO 48.1 extended multi-crew operations (~18 h)
 */
export function getAbsoluteMaxFdpHours(regulator: Regulator): number {
  switch (regulator) {
    case 'TC':
      return 20
    case 'EASA':
      return 18
    case 'FAA':
      return 19
    case 'Australia':
      return 18
    default:
      return 20
  }
}

/** Highest value in the unaugmented CAR 705 table (for reference / tests). */
export function getUnaugmentedTableMaxFdpHours(): number {
  let max = 0
  for (const avg of Object.keys(FDP_TABLE) as AvgSectorTime[]) {
    for (const group of Object.values(FDP_TABLE[avg])) {
      for (const hours of Object.values(group)) {
        if (hours > max) max = hours
      }
    }
  }
  return max
}

export function getMinRestHours(regulator: Regulator): number {
  return regulator === 'TC' || regulator === 'EASA' ? 12 : 10
}

/**
 * Sum duty hours overlapping the 168-hour window ending at `windowEnd`.
 * Uses overlap math (not full containment).
 */
export function getWeeklyDutyHours(
  events: DutyEvent[],
  windowEnd: Date,
  excludeEventId?: string,
): number {
  const windowStart = new Date(windowEnd.getTime() - 7 * 24 * 60 * 60 * 1000)
  // Weighted hours of work (duty/standby 100%, reserve 33%) — CAR 700.29(3)
  return events
    .filter((e) => isWorkEvent(e) && e.id !== excludeEventId)
    .reduce((total, e) => {
      const factor = e.workFactor ?? defaultWorkFactor(e.type)
      if (factor <= 0) return total
      const overlapStart = Math.max(e.start.getTime(), windowStart.getTime())
      const overlapEnd = Math.min(e.end.getTime(), windowEnd.getTime())
      if (overlapEnd <= overlapStart) return total
      return (
        total +
        ((overlapEnd - overlapStart) / (1000 * 60 * 60)) * factor
      )
    }, 0)
}

/**
 * True if adding [start, end] would push the rolling 168h window ending at `end`
 * over the weekly limit (partial overlaps counted).
 */
export function wouldExceedWeeklyLimit(
  events: DutyEvent[],
  start: Date,
  end: Date,
  excludeEventId?: string,
): boolean {
  const windowStart = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000)
  const prior = getWeeklyDutyHours(events, end, excludeEventId)
  const overlapStart = Math.max(start.getTime(), windowStart.getTime())
  const overlapEnd = Math.min(end.getTime(), end.getTime())
  const newHours =
    overlapEnd > overlapStart
      ? (overlapEnd - overlapStart) / (1000 * 60 * 60)
      : 0
  return prior + newHours > MAX_WEEKLY_DUTY_HOURS
}

/** Legacy helper retained for non-TC rough windows (hours). */
export function getNightWindow(regulator: Regulator): {
  nightStart: number
  nightEnd: number
} {
  const nightStart =
    regulator === 'EASA' || regulator === 'Australia'
      ? 0
      : regulator === 'FAA'
        ? 1
        : 2
  const nightEnd = regulator === 'Australia' ? 5 : 6
  return { nightStart, nightEnd }
}

/** Calendar chips: duty classification + rest requirement markers. */
export type DutyMarker =
  | 'E'
  | 'L'
  | 'N'
  | 'LNR'
  | 'LNR2'
  | 'LNR3'
  | 'RR'
  | 'SDF'

function acclTZFor(event: DutyEvent, globalAcclTZ: string): string {
  return event.acclTZ || globalAcclTZ
}

/**
 * TC Early duty: begins between 02:00 and 06:59 acclimatized local time.
 * AC 700-047 §2.3(b).
 */
export function isEarlyDuty(
  start: Date,
  regulator: Regulator,
  tz: string,
): boolean {
  const m = getMinutesInTZ(start, tz)
  if (regulator === 'TC') {
    return m >= 2 * 60 && m <= 6 * 60 + 59
  }
  // Placeholder non-TC: starts before 06:00
  return m < 6 * 60
}

/**
 * TC Late duty: ends between midnight and 01:59 acclimatized local time.
 * AC 700-047 §2.3(d).
 */
export function isLateDuty(
  end: Date,
  regulator: Regulator,
  tz: string,
): boolean {
  const m = getMinutesInTZ(end, tz)
  if (regulator === 'TC') {
    return m >= 0 && m <= 1 * 60 + 59
  }
  // Placeholder non-TC: ends after 22:00
  return m > 22 * 60
}

/**
 * TC Night duty: begins between 13:00 and 01:59 and ends after 01:59
 * (duty still on at/after 02:00 acclimatized — i.e. passes the 01:59 overnight boundary).
 * AC 700-047 §2.3(f).
 *
 * Same-day afternoon/evening duties (e.g. 14:00–22:00) are NOT night duties.
 */
export function isNightDuty(
  start: Date,
  end: Date,
  regulator: Regulator,
  tz: string,
): boolean {
  if (end.getTime() <= start.getTime()) return false

  if (regulator === 'TC') {
    const startM = getMinutesInTZ(start, tz)
    const startInWindow = startM >= 13 * 60 || startM < 2 * 60
    if (!startInWindow) return false

    // Duty must reach 02:00 acclimatized (ends after 01:59 of the overnight period).
    const twoAm = nextZonedWallTime(start, tz, 2, 0, true)
    // If start is already at/after 02:00 same civil morning, nextZonedWallTime(..., inclusive)
    // returns that 02:00 only when start < 02:00 same day... For start 01:00, twoAm is 02:00 same day.
    // For start 14:00, twoAm is 02:00 next calendar day.
    // For start 03:00 (not in window) we already returned false.
    return end.getTime() >= twoAm.getTime()
  }

  // Placeholder non-TC: rough WOCL-style overlap using hour windows
  const { nightStart, nightEnd } = getNightWindow(regulator)
  const startH = getHourInTZ(start, tz)
  const endH = getHourInTZ(end, tz)
  return startH < nightEnd && endH > nightStart
}

export function dutyHasEarlyMarker(
  event: DutyEvent,
  regulator: Regulator,
  globalAcclTZ: string,
): boolean {
  if (event.type !== 'duty') return false
  return isEarlyDuty(event.start, regulator, acclTZFor(event, globalAcclTZ))
}

export function dutyHasLateMarker(
  event: DutyEvent,
  regulator: Regulator,
  globalAcclTZ: string,
): boolean {
  if (event.type !== 'duty') return false
  return isLateDuty(event.end, regulator, acclTZFor(event, globalAcclTZ))
}

export function dutyHasNightMarker(
  event: DutyEvent,
  regulator: Regulator,
  globalAcclTZ: string,
): boolean {
  if (event.type !== 'duty') return false
  const tz = acclTZFor(event, globalAcclTZ)
  return isNightDuty(event.start, event.end, regulator, tz)
}

/**
 * CAR 700.41(2): disruptive-schedule LNR does not apply when the member is at a
 * location whose local time differs by more than 4 hours from the last location
 * where they were acclimatized.
 *
 * Without a separate “location TZ” field, we use each duty’s `acclTZ` as the best
 * available zone reference: |offset(prev accl) − offset(next accl)| at the start
 * of the next duty. Same zone → never exempt (typical home-base ops).
 */
export function isDisruptiveScheduleExempt(
  previous: DutyEvent,
  next: DutyEvent,
  globalAcclTZ: string,
): boolean {
  const prevTz = acclTZFor(previous, globalAcclTZ)
  const nextTz = acclTZFor(next, globalAcclTZ)
  if (prevTz === nextTz) return false
  // Evaluate at the later duty’s report time (when the member is “at” that location).
  return hoursBetweenTimeZones(prevTz, nextTz, next.start) > 4
}

/**
 * CAR 700.41 disruptive schedule: LNR between (late|night)↔early transitions.
 * (a) late or night ends, then early begins
 * (b) early ends, then late or night begins
 * Exempt under 700.41(2) when zone offset gap > 4 h (see isDisruptiveScheduleExempt).
 */
export function isDisruptiveTransition(
  previous: DutyEvent,
  next: DutyEvent,
  regulator: Regulator,
  globalAcclTZ: string,
): boolean {
  if (previous.type !== 'duty' || next.type !== 'duty') return false

  if (
    regulator === 'TC' &&
    isDisruptiveScheduleExempt(previous, next, globalAcclTZ)
  ) {
    return false
  }

  const prevTz = acclTZFor(previous, globalAcclTZ)
  const nextTz = acclTZFor(next, globalAcclTZ)

  const prevE = isEarlyDuty(previous.start, regulator, prevTz)
  const prevL = isLateDuty(previous.end, regulator, prevTz)
  const prevN = isNightDuty(previous.start, previous.end, regulator, prevTz)

  const nextE = isEarlyDuty(next.start, regulator, nextTz)
  const nextL = isLateDuty(next.end, regulator, nextTz)
  const nextN = isNightDuty(next.start, next.end, regulator, nextTz)

  const prevLateOrNight = prevL || prevN
  const nextLateOrNight = nextL || nextN

  return (prevLateOrNight && nextE) || (prevE && nextLateOrNight)
}

/**
 * UI markers for a calendar day cell — at most one chip per marker type per duty.
 *
 * Day gating (each type appears on a single intuitive day):
 * - E (Early): start day only — about report time
 * - L (Late): end day only — about release 00:00–01:59
 * - N (Night): end day only — about release after 01:59 / overnight character
 *   (same-day night: start === end day → one N)
 *
 * Day keys use acclimatized civil day when `dayKeyAccl` is provided;
 * otherwise caller-provided isStartOnDay / isEndOnDay.
 */
export function getDutyMarkers(
  event: DutyEvent,
  regulator: Regulator,
  globalAcclTZ: string,
  isStartOnDay: boolean,
  isEndOnDay: boolean,
  /** Optional YYYY-MM-DD in acclimatized TZ for the cell being rendered. */
  dayKeyAccl?: string,
): DutyMarker[] {
  if (event.type === 'rest') {
    const nights = event.requiredLocalNights ?? 0
    // Free-day rest (700.29) — show as SDF, not generic 2×LNR
    if (event.restRule === 'CAR 700.29' && nights >= 2) return ['SDF']
    if (nights >= 3) return ['LNR3']
    if (nights === 2) return ['LNR2']
    if (event.isLocalNightRest || nights === 1) return ['LNR']
    // Required clock rest (700.40 / 700.42 hours)
    return ['RR']
  }
  if (event.type !== 'duty') return []

  const tz = acclTZFor(event, globalAcclTZ)
  const startParts = getZonedTimeParts(event.start, tz)
  const endParts = getZonedTimeParts(event.end, tz)

  let showStart = isStartOnDay
  let showEnd = isEndOnDay
  if (dayKeyAccl) {
    showStart = startParts.dayKey === dayKeyAccl
    showEnd = endParts.dayKey === dayKeyAccl
  }

  const markers: DutyMarker[] = []
  if (showStart && isEarlyDuty(event.start, regulator, tz)) {
    markers.push('E')
  }
  if (showEnd && isLateDuty(event.end, regulator, tz)) {
    markers.push('L')
  }
  // Night is a whole-duty property; show once on the end (release) day only.
  if (showEnd && isNightDuty(event.start, event.end, regulator, tz)) {
    markers.push('N')
  }

  return markers
}

/** Horizontal anchor for a marker relative to its duty bar in the day cell. */
export type MarkerBarAnchor = 'start' | 'end' | 'center'

export function markerBarAnchor(type: DutyMarker): MarkerBarAnchor {
  if (type === 'E') return 'start'
  if (type === 'L' || type === 'N') return 'end'
  return 'center' // LNR / LNR2 / LNR3 / RR / SDF
}

/** Short chip label for calendar. */
export function markerChipLabel(type: DutyMarker, violated?: boolean): string {
  if (type === 'LNR') return violated ? 'LNR!' : 'LNR'
  if (type === 'LNR2') return violated ? '2×LNR!' : '2×LNR'
  if (type === 'LNR3') return violated ? '3×LNR!' : '3×LNR'
  if (type === 'RR') return violated ? 'RR!' : 'RR'
  if (type === 'SDF') return violated ? 'SDF!' : 'SDF'
  return type
}

/** Why an auto LNR failed quality checks (700.40 / 700.41). */
export type LnrViolationReason =
  | 'short_rest'
  | 'insufficient_night_window'
  | 'duty_overlap'

export interface LocalNightRestResult {
  start: Date
  end: Date
  violated: boolean
  /** Hours of rest gap that fall inside a 22:30–09:30 accl window (best window). */
  nightWindowHours: number
  /** Total rest gap hours. */
  gapHours: number
  reasons: LnrViolationReason[]
}

/**
 * Best overlap (hours) between rest gap [gapStart, gapEnd] and any
 * acclimatized 22:30→09:30 local-night window that intersects the gap.
 * TC local night's rest: ≥9 hours inside 22:30–09:30 (AC 700-047 §2.3(e)).
 */
export function bestLocalNightWindowHours(
  gapStart: Date,
  gapEnd: Date,
  tz: string,
): number {
  if (gapEnd.getTime() <= gapStart.getTime()) return 0

  let best = 0
  // Check windows anchored on civil days from day before gap start through gap end.
  for (let dayOffset = -1; dayOffset <= 3; dayOffset++) {
    const windowStart = zonedWallTimeOnDay(gapStart, tz, 22, 30, dayOffset)
    // 09:30 is on the following civil morning relative to that 22:30
    const windowEnd = zonedWallTimeOnDay(windowStart, tz, 9, 30, 1)
    const overlapStart = Math.max(gapStart.getTime(), windowStart.getTime())
    const overlapEnd = Math.min(gapEnd.getTime(), windowEnd.getTime())
    if (overlapEnd > overlapStart) {
      const hours = (overlapEnd - overlapStart) / (1000 * 60 * 60)
      if (hours > best) best = hours
    }
  }
  return best
}

/**
 * Evaluate local night rest for the gap between two duties (700.41 + 700.40).
 * - LNR quality: ≥9 h inside 22:30–09:30 acclimatized
 * - Base rest: gap ≥ min rest hours for regulator (700.40), when provided
 * Uses acclimatized TZ — not browser local.
 */
export function computeLocalNightRest(
  previousDutyEnd: Date,
  nextDutyStart: Date,
  tz: string,
  minRestHours = 12,
): LocalNightRestResult {
  const lnrStart = previousDutyEnd
  const lnrEnd = nextDutyStart
  const gapHours =
    (lnrEnd.getTime() - lnrStart.getTime()) / (1000 * 60 * 60)
  const nightWindowHours = bestLocalNightWindowHours(lnrStart, lnrEnd, tz)

  const reasons: LnrViolationReason[] = []
  if (gapHours < minRestHours) reasons.push('short_rest')
  if (nightWindowHours < 9) reasons.push('insufficient_night_window')

  return {
    start: lnrStart,
    end: lnrEnd,
    violated: reasons.length > 0,
    nightWindowHours,
    gapHours,
    reasons,
  }
}

/** Human-readable LNR failure summary for alerts / tooltips. */
export function formatLnrViolationMessage(
  reasons: LnrViolationReason[],
  opts?: { gapHours?: number; nightWindowHours?: number; minRestHours?: number },
): string {
  if (reasons.length === 0) {
    return 'Local night rest meets CAR 700.41 requirements.'
  }
  const parts: string[] = []
  if (reasons.includes('short_rest')) {
    const min = opts?.minRestHours
    const gap = opts?.gapHours
    if (min != null && gap != null) {
      parts.push(
        `rest gap ${gap.toFixed(1)} h is shorter than the minimum ${min} h (CAR 700.40)`,
      )
    } else {
      parts.push('rest gap is shorter than the minimum rest period (CAR 700.40)')
    }
  }
  if (reasons.includes('insufficient_night_window')) {
    const nw = opts?.nightWindowHours
    if (nw != null) {
      parts.push(
        `only ${nw.toFixed(1)} h falls inside 22:30–09:30 acclimatized (need ≥9 h local night’s rest, CAR 700.41)`,
      )
    } else {
      parts.push(
        'less than 9 h falls inside 22:30–09:30 acclimatized (CAR 700.41 local night’s rest)',
      )
    }
  }
  if (reasons.includes('duty_overlap')) {
    parts.push('another duty overlaps the rest gap')
  }
  return `Local night rest required but not met: ${parts.join('; ')}.`
}

export function eventsOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  return !(aEnd <= bStart || aStart >= bEnd)
}
