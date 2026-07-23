import type { AvgSectorTime, DutyEvent, Regulator } from './types'
import { MAX_WEEKLY_DUTY_HOURS } from './types'
import { getHourInTZ } from './time'

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
  return events
    .filter((e) => e.type === 'duty' && e.id !== excludeEventId)
    .reduce((total, e) => {
      const overlapStart = Math.max(e.start.getTime(), windowStart.getTime())
      const overlapEnd = Math.min(e.end.getTime(), windowEnd.getTime())
      if (overlapEnd <= overlapStart) return total
      return total + (overlapEnd - overlapStart) / (1000 * 60 * 60)
    }, 0)
}

export function wouldExceedWeeklyLimit(
  events: DutyEvent[],
  start: Date,
  end: Date,
  excludeEventId?: string,
): boolean {
  const duration = (end.getTime() - start.getTime()) / (1000 * 60 * 60)
  const prior = getWeeklyDutyHours(events, start, excludeEventId)
  return prior + duration > MAX_WEEKLY_DUTY_HOURS
}

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

export type DutyMarker = 'E' | 'L' | 'N' | 'LNR'

export function getDutyMarkers(
  event: DutyEvent,
  regulator: Regulator,
  globalAcclTZ: string,
  isStartOnDay: boolean,
  isEndOnDay: boolean,
): DutyMarker[] {
  if (event.type === 'rest' && event.isLocalNightRest) {
    return ['LNR']
  }
  if (event.type !== 'duty') return []

  const tz = event.acclTZ || globalAcclTZ
  const acclimatizedStartHour = getHourInTZ(event.start, tz)
  const acclimatizedEndHour = getHourInTZ(event.end, tz)
  const { nightStart, nightEnd } = getNightWindow(regulator)
  const markers: DutyMarker[] = []

  if (
    isStartOnDay &&
    ((regulator === 'TC' &&
      acclimatizedStartHour >= 2 &&
      acclimatizedStartHour < 7) ||
      (regulator !== 'TC' && acclimatizedStartHour < 6))
  ) {
    markers.push('E')
  } else if (
    isEndOnDay &&
    ((regulator === 'TC' &&
      acclimatizedEndHour >= 0 &&
      acclimatizedEndHour < 2) ||
      (regulator !== 'TC' && acclimatizedEndHour > 22))
  ) {
    markers.push('L')
  } else if (
    isEndOnDay &&
    ((regulator === 'TC' &&
      (acclimatizedStartHour >= 13 || acclimatizedStartHour < 2) &&
      acclimatizedEndHour > 1) ||
      (regulator !== 'TC' &&
        acclimatizedStartHour < nightEnd &&
        acclimatizedEndHour > nightStart))
  ) {
    markers.push('N')
  }

  return markers
}

export function dutyHasNightMarker(
  event: DutyEvent,
  regulator: Regulator,
  globalAcclTZ: string,
): boolean {
  const tz = event.acclTZ || globalAcclTZ
  const acclimatizedStartHour = getHourInTZ(event.start, tz)
  const acclimatizedEndHour = getHourInTZ(event.end, tz)
  const { nightStart, nightEnd } = getNightWindow(regulator)
  if (regulator === 'TC') {
    return (
      (acclimatizedStartHour >= 13 || acclimatizedStartHour < 2) &&
      acclimatizedEndHour > 1
    )
  }
  return acclimatizedStartHour < nightEnd && acclimatizedEndHour > nightStart
}

export function dutyHasEarlyMarker(
  event: DutyEvent,
  regulator: Regulator,
  globalAcclTZ: string,
): boolean {
  const tz = event.acclTZ || globalAcclTZ
  const hour = getHourInTZ(event.start, tz)
  if (regulator === 'TC') return hour >= 2 && hour < 7
  return hour < 6
}

export interface LocalNightRestResult {
  start: Date
  end: Date
  violated: boolean
}

/**
 * Build local night rest between a prior duty with N and a following duty with E.
 * Uses the gap between duties (lnrStart = previous end, lnrEnd = next start).
 */
export function computeLocalNightRest(
  previousDutyEnd: Date,
  nextDutyStart: Date,
): LocalNightRestResult {
  const lnrStart = previousDutyEnd
  const lnrEnd = nextDutyStart
  const duration =
    (lnrEnd.getTime() - lnrStart.getTime()) / (1000 * 60 * 60)

  const nightStart = new Date(
    previousDutyEnd.getFullYear(),
    previousDutyEnd.getMonth(),
    previousDutyEnd.getDate(),
    22,
    30,
  )
  const nightEnd = new Date(
    nextDutyStart.getFullYear(),
    nextDutyStart.getMonth(),
    nextDutyStart.getDate(),
    9,
    30,
  )
  const overlapStart = Math.max(lnrStart.getTime(), nightStart.getTime())
  const overlapEnd = Math.min(lnrEnd.getTime(), nightEnd.getTime())
  const nightDuration =
    overlapEnd > overlapStart
      ? (overlapEnd - overlapStart) / (1000 * 60 * 60)
      : 0

  let violated = false
  if (duration < 12) violated = true
  if (nightDuration < 9) violated = true

  const maxStart = new Date(
    previousDutyEnd.getFullYear(),
    previousDutyEnd.getMonth(),
    previousDutyEnd.getDate(),
    0,
    30,
  )
  if (lnrStart > maxStart) violated = true

  const minEnd = new Date(
    nextDutyStart.getFullYear(),
    nextDutyStart.getMonth(),
    nextDutyStart.getDate(),
    7,
    30,
  )
  if (lnrEnd < minEnd) violated = true

  return { start: lnrStart, end: lnrEnd, violated }
}

export function eventsOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  return !(aEnd <= bStart || aStart >= bEnd)
}
