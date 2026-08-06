/**
 * Shift duty form payloads by civil calendar days (clone-to-date).
 * Preserves wall-clock times in each field's timezone (DST-safe).
 */
import { getAirportByIcao } from './airports'
import type {
  AvgSectorTime,
  DutyType,
  EventKind,
  FlightLeg,
  RestType,
  SplitDutyBreak,
} from './types'
import {
  getZonedTimeParts,
  zonedCivilDate,
  zonedWallTime,
} from './time'

/** Shift an absolute instant by N civil days, keeping wall time in `tz`. */
export function shiftWallTimeByCivilDays(
  date: Date,
  tz: string,
  dayDelta: number,
): Date {
  if (!Number.isFinite(dayDelta) || dayDelta === 0) {
    return new Date(date.getTime())
  }
  const p = getZonedTimeParts(date, tz)
  const d = zonedCivilDate(date, tz, dayDelta)
  return zonedWallTime(tz, d.year, d.month, d.day, p.hour, p.minute)
}

function airportTz(icao: string | undefined, fallback: string): string {
  if (!icao) return fallback
  return getAirportByIcao(icao)?.tz || fallback
}

export interface CloneableDutySlice {
  start: Date
  end: Date
  acclTZ?: string
  startTZ?: string
  endTZ?: string
  locationIcao?: string
  operatingEnd?: Date
  flights?: FlightLeg[]
  reportOverridden?: boolean
  releaseOverridden?: boolean
  operatingSectors?: number
  positioningSectors?: number
  avgSectorTime?: AvgSectorTime
  endsWithPositioning?: boolean
  positioningAgreed?: boolean
  title?: string
  type?: DutyType
  eventKind?: EventKind
  splitBreak?: SplitDutyBreak
  /** CAR 700.70 RAP start for RDP when FDP was called from reserve. */
  rapStart?: Date
}

export interface CloneablePrefixReserve {
  eventKind: EventKind
  start: Date
  end: Date
  locationIcao?: string
}

export interface CloneableFormPayload {
  eventKind: EventKind
  prefixReserve?: CloneablePrefixReserve
  duty: CloneableDutySlice
  restType: RestType
}

function shiftFlightLeg(
  leg: FlightLeg,
  dayDelta: number,
  fallbackTz: string,
): FlightLeg {
  const depTz = airportTz(leg.depIcao, fallbackTz)
  const arrTz = airportTz(leg.arrIcao, depTz)
  return {
    ...leg,
    dep: shiftWallTimeByCivilDays(leg.dep, depTz, dayDelta),
    arr: shiftWallTimeByCivilDays(leg.arr, arrTz, dayDelta),
  }
}

/** Shift duty start/end/flights/operatingEnd by civil day delta. */
export function shiftCloneableDuty(
  duty: CloneableDutySlice,
  dayDelta: number,
): CloneableDutySlice {
  if (!Number.isFinite(dayDelta) || dayDelta === 0) {
    return {
      ...duty,
      start: new Date(duty.start.getTime()),
      end: new Date(duty.end.getTime()),
      operatingEnd: duty.operatingEnd
        ? new Date(duty.operatingEnd.getTime())
        : undefined,
      rapStart: duty.rapStart
        ? new Date(duty.rapStart.getTime())
        : undefined,
      flights: duty.flights?.map((f) => ({
        ...f,
        dep: new Date(f.dep.getTime()),
        arr: new Date(f.arr.getTime()),
      })),
      splitBreak: duty.splitBreak
        ? {
            ...duty.splitBreak,
            start: new Date(duty.splitBreak.start.getTime()),
            end: new Date(duty.splitBreak.end.getTime()),
          }
        : undefined,
    }
  }

  const fallback =
    duty.startTZ || duty.acclTZ || airportTz(duty.locationIcao, 'UTC')
  const startTz = duty.startTZ || fallback
  const endTz = duty.endTZ || fallback
  const splitTz =
    airportTz(duty.splitBreak?.locationIcao, endTz) || endTz

  return {
    ...duty,
    start: shiftWallTimeByCivilDays(duty.start, startTz, dayDelta),
    end: shiftWallTimeByCivilDays(duty.end, endTz, dayDelta),
    operatingEnd: duty.operatingEnd
      ? shiftWallTimeByCivilDays(duty.operatingEnd, endTz, dayDelta)
      : undefined,
    rapStart: duty.rapStart
      ? shiftWallTimeByCivilDays(duty.rapStart, startTz, dayDelta)
      : undefined,
    flights: duty.flights?.map((f) => shiftFlightLeg(f, dayDelta, fallback)),
    splitBreak: duty.splitBreak
      ? {
          ...duty.splitBreak,
          start: shiftWallTimeByCivilDays(
            duty.splitBreak.start,
            splitTz,
            dayDelta,
          ),
          end: shiftWallTimeByCivilDays(duty.splitBreak.end, splitTz, dayDelta),
        }
      : undefined,
  }
}

/** Shift a full form submit payload for clone-to-date. */
export function shiftEventFormPayload<T extends CloneableFormPayload>(
  payload: T,
  dayDelta: number,
): T {
  if (!Number.isFinite(dayDelta) || dayDelta === 0) {
    return {
      ...payload,
      duty: shiftCloneableDuty(payload.duty, 0),
      prefixReserve: payload.prefixReserve
        ? {
            ...payload.prefixReserve,
            start: new Date(payload.prefixReserve.start.getTime()),
            end: new Date(payload.prefixReserve.end.getTime()),
          }
        : undefined,
    }
  }

  const duty = shiftCloneableDuty(payload.duty, dayDelta)
  let prefixReserve = payload.prefixReserve
  if (prefixReserve) {
    const rsvTz = airportTz(
      prefixReserve.locationIcao,
      duty.startTZ || duty.acclTZ || 'UTC',
    )
    prefixReserve = {
      ...prefixReserve,
      start: shiftWallTimeByCivilDays(prefixReserve.start, rsvTz, dayDelta),
      end: shiftWallTimeByCivilDays(prefixReserve.end, rsvTz, dayDelta),
    }
  }

  return {
    ...payload,
    duty,
    prefixReserve,
  }
}
