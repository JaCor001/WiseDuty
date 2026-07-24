import type { DutyEvent, RestType, StoredDutyEvent } from './types'
import {
  computeLocalNightRest,
  dutyHasEarlyMarker,
  dutyHasNightMarker,
  eventsOverlap,
} from './regulations'
import type { Regulator } from './types'

export function serializeEvents(events: DutyEvent[]): StoredDutyEvent[] {
  return events.map((e) => ({
    id: e.id,
    title: e.title,
    start: e.start.toISOString(),
    end: e.end.toISOString(),
    type: e.type,
    acclTZ: e.acclTZ,
    violated: e.violated,
    isLocalNightRest: e.isLocalNightRest,
  }))
}

export function deserializeEvents(stored: StoredDutyEvent[]): DutyEvent[] {
  return stored
    .map((e) => ({
      id: e.id,
      title: e.title,
      start: new Date(e.start),
      end: new Date(e.end),
      type: e.type,
      acclTZ: e.acclTZ,
      violated: e.violated,
      isLocalNightRest: e.isLocalNightRest,
    }))
    .filter((e) => !isNaN(e.start.getTime()) && !isNaN(e.end.getTime()))
}

export function createId(suffix = ''): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID() + suffix
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}${suffix}`
}

export function restIdForDuty(dutyId: string): string {
  return `${dutyId}-rest`
}

export function findDutiesOnDate(events: DutyEvent[], date: Date): DutyEvent[] {
  const key = date.toDateString()
  return events.filter(
    (e) => e.type === 'duty' && e.start.toDateString() === key,
  )
}

/** First duty that starts on this local calendar day (legacy single-duty UI). */
export function findDutyOnDate(
  events: DutyEvent[],
  date: Date,
): DutyEvent | undefined {
  return findDutiesOnDate(events, date)[0]
}

export function eventsOnLocalDay(
  events: DutyEvent[],
  date: Date,
): DutyEvent[] {
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const dayEnd = new Date(dayStart)
  dayEnd.setDate(dayEnd.getDate() + 1)
  return events.filter((e) => e.start < dayEnd && e.end > dayStart)
}

export function removeDutyAndRelated(
  events: DutyEvent[],
  duty: DutyEvent,
): DutyEvent[] {
  const restId = restIdForDuty(duty.id)
  return events.filter((e) => {
    if (e.id === duty.id || e.id === restId) return false
    if (
      e.isLocalNightRest &&
      (e.start.getTime() === duty.end.getTime() ||
        e.end.getTime() === duty.start.getTime())
    ) {
      return false
    }
    return true
  })
}

export function buildRestEvent(
  dutyId: string,
  restStart: Date,
  restHours: number,
  restType: RestType,
): DutyEvent {
  const end = new Date(restStart.getTime() + restHours * 60 * 60 * 1000)
  return {
    id: restIdForDuty(dutyId),
    title:
      restType === '10+travel' ? 'Required Rest (10+travel)' : 'Required Rest',
    start: restStart,
    end,
    type: 'rest',
  }
}

/**
 * If previous duty has N and next has E, create an LNR event spanning the gap.
 */
export function maybeBuildLnrBetween(
  previous: DutyEvent,
  next: DutyEvent,
  regulator: Regulator,
  globalAcclTZ: string,
  existingDuties: DutyEvent[],
): DutyEvent | null {
  if (previous.type !== 'duty' || next.type !== 'duty') return null
  if (!dutyHasNightMarker(previous, regulator, globalAcclTZ)) return null
  if (!dutyHasEarlyMarker(next, regulator, globalAcclTZ)) return null

  const result = computeLocalNightRest(previous.end, next.start)
  let violated = result.violated

  const overlapsDuty = existingDuties.some(
    (e) =>
      e.type === 'duty' &&
      e.id !== previous.id &&
      e.id !== next.id &&
      eventsOverlap(result.start, result.end, e.start, e.end),
  )
  if (overlapsDuty) violated = true

  return {
    id: createId('-lnr'),
    title: 'Local Night Rest',
    start: result.start,
    end: result.end,
    type: 'rest',
    isLocalNightRest: true,
    violated,
  }
}

export function findPreviousDuty(
  events: DutyEvent[],
  beforeStart: Date,
  excludeId?: string,
): DutyEvent | undefined {
  return events
    .filter(
      (e) =>
        e.type === 'duty' &&
        e.id !== excludeId &&
        e.end.getTime() <= beforeStart.getTime(),
    )
    .sort((a, b) => b.end.getTime() - a.end.getTime())[0]
}

export function findNextDuty(
  events: DutyEvent[],
  afterEnd: Date,
  excludeId?: string,
): DutyEvent | undefined {
  return events
    .filter(
      (e) =>
        e.type === 'duty' &&
        e.id !== excludeId &&
        e.start.getTime() >= afterEnd.getTime(),
    )
    .sort((a, b) => a.start.getTime() - b.start.getTime())[0]
}

export function stripLnrTouching(
  events: DutyEvent[],
  dutyStart: Date,
  dutyEnd: Date,
): DutyEvent[] {
  return events.filter(
    (e) =>
      !(
        e.isLocalNightRest &&
        (e.start.getTime() === dutyEnd.getTime() ||
          e.end.getTime() === dutyStart.getTime())
      ),
  )
}
