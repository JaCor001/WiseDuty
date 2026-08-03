/**
 * CAR 700.28(5) — when a flight crew member is considered acclimatized.
 *
 * Maximum FDP tables in 700.28(2)–(4) use the start of the FDP in the member’s
 * **acclimatized** local time (AC 700-047: start time is predicated on
 * acclimatized time), not the wall clock at the departure airport when the
 * member has not yet re-acclimatized after a time-zone shift.
 *
 * 700.28(5): acclimatized to the new local time zone if required rests have been
 * provided and the member has spent:
 *   (a) 72 h in the same zone, when |local − last acclimatized| < 4 h; or
 *   (b) 96 h in the same zone, when the difference is ≥ 4 h; or
 *   (c) 24 h in the same zone for each hour of difference.
 * The first of (a)/(b) or (c) that is met is enough (whichever requires fewer hours).
 *
 * 700.28(7): for Canadian operations, zones are Pacific, Mountain, Central,
 * Eastern, and Atlantic (including Newfoundland and Labrador) — so NL is not
 * a half-zone difference from Atlantic for this subsection.
 */
import type { DutyEvent } from './types'
import { hoursBetweenTimeZones } from './time'

const H = 3_600_000
const ZONE_EPS = 0.05

/** Canadian zone bands for CAR 700.28(7). */
export type CanadianZoneBand = 'PAC' | 'MTN' | 'CEN' | 'EAS' | 'ATL'

/**
 * Map common IANA zones used in the app to Canadian bands.
 * Non-Canadian / unmapped zones return null → use raw UTC offset difference.
 */
export function canadianZoneBand(tz: string): CanadianZoneBand | null {
  const z = tz.trim()
  // Pacific
  if (
    z === 'America/Vancouver' ||
    z === 'America/Whitehorse' ||
    z === 'America/Los_Angeles' ||
    z === 'America/Tijuana' ||
    z === 'America/Dawson' ||
    z === 'America/Fort_Nelson'
  ) {
    return 'PAC'
  }
  // Mountain
  if (
    z === 'America/Edmonton' ||
    z === 'America/Yellowknife' ||
    z === 'America/Denver' ||
    z === 'America/Phoenix' ||
    z === 'America/Boise' ||
    z === 'America/Cambridge_Bay' ||
    z === 'America/Inuvik' ||
    z === 'America/Creston'
  ) {
    return 'MTN'
  }
  // Central
  if (
    z === 'America/Winnipeg' ||
    z === 'America/Regina' ||
    z === 'America/Chicago' ||
    z === 'America/Mexico_City' ||
    z === 'America/Rankin_Inlet' ||
    z === 'America/Resolute' ||
    z === 'America/Swift_Current'
  ) {
    return 'CEN'
  }
  // Eastern
  if (
    z === 'America/Toronto' ||
    z === 'America/Montreal' ||
    z === 'America/Nipigon' ||
    z === 'America/Thunder_Bay' ||
    z === 'America/Iqaluit' ||
    z === 'America/Pangnirtung' ||
    z === 'America/New_York' ||
    z === 'America/Detroit' ||
    z === 'America/Indiana/Indianapolis' ||
    z === 'America/Kentucky/Louisville' ||
    z === 'America/Cancun'
  ) {
    return 'EAS'
  }
  // Atlantic (includes NL per 700.28(7))
  if (
    z === 'America/Halifax' ||
    z === 'America/Moncton' ||
    z === 'America/Glace_Bay' ||
    z === 'America/Goose_Bay' ||
    z === 'America/Blanc-Sablon' ||
    z === 'America/St_Johns' || // Newfoundland grouped with Atlantic
    z === 'America/Puerto_Rico' ||
    z === 'Atlantic/Bermuda'
  ) {
    return 'ATL'
  }
  return null
}

const BAND_ORDER: CanadianZoneBand[] = ['PAC', 'MTN', 'CEN', 'EAS', 'ATL']

/**
 * Absolute zone difference in hours for 700.28(5).
 * When both zones map to Canadian bands, use whole-band steps (1 h per band)
 * so e.g. St. John's vs Halifax is 0, not 0.5.
 */
export function acclimatizationZoneDiffHours(
  tzA: string,
  tzB: string,
  at: Date,
): number {
  if (tzA === tzB) return 0
  const a = canadianZoneBand(tzA)
  const b = canadianZoneBand(tzB)
  if (a && b) {
    return Math.abs(BAND_ORDER.indexOf(a) - BAND_ORDER.indexOf(b))
  }
  return hoursBetweenTimeZones(tzA, tzB, at)
}

/**
 * Hours of continuous presence required before re-acclimatizing to a new zone.
 * min( path (a) or (b), path (c) ).
 */
export function hoursRequiredToAcclimatize(zoneDiffHours: number): number {
  const abs = Math.abs(zoneDiffHours)
  if (abs <= ZONE_EPS) return 0
  // (c) 24 h per hour of difference (ceil so 0.5 → 1)
  const hoursOfDiff = Math.max(1, Math.ceil(abs - ZONE_EPS))
  const pathC = 24 * hoursOfDiff
  // (a) < 4 h → 72; (b) ≥ 4 h → 96
  const pathAB = abs < 4 - ZONE_EPS ? 72 : 96
  return Math.min(pathAB, pathC)
}

export function dutyReportLocationTZ(
  duty: Pick<DutyEvent, 'startTZ' | 'acclTZ' | 'endTZ'>,
  fallback: string,
): string {
  return duty.startTZ || duty.acclTZ || fallback
}

export function dutyReleaseLocationTZ(
  duty: Pick<DutyEvent, 'endTZ' | 'acclTZ' | 'startTZ'>,
  fallback: string,
): string {
  return duty.endTZ || duty.acclTZ || duty.startTZ || fallback
}

export interface AcclimatizationResolution {
  /** Zone used for 700.28 table start hour and E/L/N classification. */
  acclTZ: string
  /** Physical report location zone (departure / start). */
  localTZ: string
  zoneDiffHours: number
  hoursInLocal: number
  hoursRequired: number
  /** True if local zone is (or just became) the acclimatized zone. */
  acclimatizedToLocal: boolean
  reason: string
}

/**
 * Resolve acclimatized TZ at the start of an FDP given home base and prior duties.
 *
 * Walks prior duties chronologically, tracking continuous time spent at the
 * layover/release location. Until enough time is spent in a new zone per
 * 700.28(5), the member remains acclimatized to the previous zone — so a
 * multi-city pairing with a different layover each night keeps using the
 * last acclimatized clock for Max FDP (not each night’s local airport clock).
 */
export function resolveAcclimatizedTZ(opts: {
  homeBaseTZ: string
  /** Duties that end strictly before `at` (or all duties excluding the one being built). */
  priorDuties: DutyEvent[]
  /** Report / FDP start instant. */
  at: Date
  /** Local time zone at report (usually first dep airport). */
  localTZ: string
}): AcclimatizationResolution {
  const home = opts.homeBaseTZ || 'UTC'
  const localTZ = opts.localTZ || home
  const at = opts.at

  let acclTZ = home
  // Continuous presence in a physical zone (for re-acclimatization clock).
  let presentTZ = home
  // Assume long presence at home before first duty (already acclimatized).
  let presentSince = new Date(at.getTime() - 365 * 24 * H)

  const prior = [...opts.priorDuties]
    .filter((d) => d.type === 'duty' && !isNaN(d.start.getTime()))
    .filter((d) => d.start.getTime() < at.getTime())
    .sort((a, b) => a.start.getTime() - b.start.getTime())

  const tryAcclimatize = (
    candidateLocal: string,
    hoursPresent: number,
    instant: Date,
  ) => {
    const diff = acclimatizationZoneDiffHours(acclTZ, candidateLocal, instant)
    const required = hoursRequiredToAcclimatize(diff)
    if (required <= 0 || hoursPresent + ZONE_EPS >= required) {
      if (acclTZ !== candidateLocal) {
        acclTZ = candidateLocal
      }
    }
  }

  for (const d of prior) {
    const startLoc = dutyReportLocationTZ(d, home)
    const endLoc = dutyReleaseLocationTZ(d, home)

    // Time already spent at report location before this FDP
    if (presentTZ === startLoc) {
      const hoursPresent =
        (d.start.getTime() - presentSince.getTime()) / H
      tryAcclimatize(startLoc, hoursPresent, d.start)
    } else {
      // Arrived at a new report location without prior continuous presence
      tryAcclimatize(startLoc, 0, d.start)
    }

    // After release: present at end location
    if (endLoc === presentTZ) {
      // Still same city — presence continues from presentSince
    } else {
      presentTZ = endLoc
      presentSince = d.end
    }

    // If long enough after this duty ends before next, re-acclimatization is
    // evaluated at the next duty’s start (or at `at` below). Also allow
    // re-acclimatization mid-layover only when we evaluate at next report.
  }

  // Evaluate at the new FDP start
  let hoursInLocal = 0
  if (presentTZ === localTZ) {
    hoursInLocal = Math.max(0, (at.getTime() - presentSince.getTime()) / H)
  }

  const zoneDiffHours = acclimatizationZoneDiffHours(acclTZ, localTZ, at)
  const hoursRequired = hoursRequiredToAcclimatize(zoneDiffHours)
  const before = acclTZ
  tryAcclimatize(localTZ, hoursInLocal, at)
  const acclimatizedToLocal =
    acclimatizationZoneDiffHours(acclTZ, localTZ, at) <= ZONE_EPS

  let reason: string
  if (acclimatizedToLocal) {
    if (before !== acclTZ) {
      reason = `Re-acclimatized to ${localTZ.replace(/_/g, ' ')} after ${hoursInLocal.toFixed(0)} h in zone (CAR 700.28(5); required ${hoursRequired} h for ${zoneDiffHours.toFixed(0)} h zone difference).`
    } else {
      reason = `Acclimatized to report location ${localTZ.replace(/_/g, ' ')} (CAR 700.28(5)).`
    }
  } else {
    reason = `Still acclimatized to ${acclTZ.replace(/_/g, ' ')} — only ${hoursInLocal.toFixed(0)} h at ${localTZ.replace(/_/g, ' ')} (need ${hoursRequired} h for ${zoneDiffHours.toFixed(0)} h zone difference under CAR 700.28(5)). Max FDP uses acclimatized clock, not departure local.`
  }

  return {
    acclTZ,
    localTZ,
    zoneDiffHours,
    hoursInLocal,
    hoursRequired,
    acclimatizedToLocal,
    reason,
  }
}

/**
 * Stamp each duty’s `acclTZ` from home base + chronological 700.28(5) walk.
 * Does not alter rest events or non-duty types.
 */
export function restampDutyAcclimatization(
  events: DutyEvent[],
  homeBaseTZ: string,
): DutyEvent[] {
  const duties = events
    .filter((e) => e.type === 'duty')
    .sort((a, b) => a.start.getTime() - b.start.getTime())

  const stamped = new Map<string, string>()
  const prior: DutyEvent[] = []

  for (const d of duties) {
    const localTZ = dutyReportLocationTZ(d, homeBaseTZ)
    const res = resolveAcclimatizedTZ({
      homeBaseTZ,
      priorDuties: prior,
      at: d.start,
      localTZ,
    })
    stamped.set(d.id, res.acclTZ)
    prior.push({ ...d, acclTZ: res.acclTZ })
  }

  return events.map((e) => {
    if (e.type !== 'duty') return e
    const accl = stamped.get(e.id) || homeBaseTZ
    return e.acclTZ === accl ? e : { ...e, acclTZ: accl }
  })
}
