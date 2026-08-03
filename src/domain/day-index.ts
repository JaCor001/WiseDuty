/**
 * Day-keyed event index for O(1) day lookups (Phase 3 optim).
 * Full regulatory recompute is unchanged — this only speeds layout / queries.
 */
import type { DutyEvent } from './types'
import {
  addCivilDaysInTimeZone,
  startOfDayInTimeZone,
  toDateInputValueInTZ,
} from './time'

/**
 * Build map: calendar dayKey (YYYY-MM-DD in `calendarTZ`) → events overlapping that day.
 * An event on [start, end) is listed on every civil day that intersects the interval.
 */
export function buildEventsByDayKey(
  events: DutyEvent[],
  calendarTZ: string,
): Map<string, DutyEvent[]> {
  const map = new Map<string, DutyEvent[]>()
  for (const e of events) {
    if (isNaN(e.start.getTime()) || isNaN(e.end.getTime())) continue
    if (e.end.getTime() <= e.start.getTime()) continue

    const first = startOfDayInTimeZone(e.start, calendarTZ)
    // Last civil day that still contains a point of [start, end)
    const lastInstant = new Date(e.end.getTime() - 1)
    const last = startOfDayInTimeZone(lastInstant, calendarTZ)

    let day = first
    for (let i = 0; i < 400; i++) {
      const key = toDateInputValueInTZ(day, calendarTZ)
      const list = map.get(key)
      if (list) list.push(e)
      else map.set(key, [e])
      if (day.getTime() >= last.getTime()) break
      day = addCivilDaysInTimeZone(day, calendarTZ, 1)
    }
  }
  return map
}

/** Events on a civil day from a prebuilt index (fallback empty). */
export function eventsOnDayKey(
  index: Map<string, DutyEvent[]>,
  dayKey: string,
): DutyEvent[] {
  return index.get(dayKey) ?? []
}
