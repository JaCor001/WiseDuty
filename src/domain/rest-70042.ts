/**
 * CAR 700.42 — Rest periods · time zone differences
 * 700.42(1) FDP ends away from home base → longer clock rest (11 / 14 h)
 * 700.42(2) FDP starts away and ends at home base → 13 h or 1–3 local nights
 *
 * CAR 700.51 — Consecutive FDPs that touch the WOCL (02:00–05:59 acclimatized):
 * after three consecutive such FDPs, one local night’s rest is required.
 */
import type { DutyEvent, Regulator, RestKind, RestRuleCode, RestType } from './types'
import {
  bestLocalNightWindowHours,
  getMinRestHours,
} from './regulations'
import {
  getMinutesInTZ,
  hoursBetweenTimeZones,
  zonedWallTimeOnDay,
} from './time'

const ZONE_EPS = 0.05 // hours — treat tiny offsets as same zone
const FOUR_H = 4
const TEN_H = 10

export interface TimeZoneRestPlan {
  /** Minimum clock rest hours after this duty. */
  restHours: number
  /** Local nights required before next duty (700.42(2) / 700.51); 0 if clock-only. */
  localNights: number
  restKind: RestKind
  restRule: RestRuleCode
  why: string
  zoneDiffHours: number
  timeAwayHours: number | null
  endsAtHome: boolean
  endsAway: boolean
  startsAway: boolean
  woclOnReturn: boolean
  /** Trailing consecutive WOCL-touching FDPs ending at this duty (700.51). */
  consecutiveWoclDuties: number
}

function nearlyEqual(a: number, b: number, eps = ZONE_EPS): boolean {
  return Math.abs(a - b) <= eps
}

export function sameZone(tzA: string, tzB: string, at: Date): boolean {
  return hoursBetweenTimeZones(tzA, tzB, at) <= ZONE_EPS
}

export function dutyStartLocationTZ(
  duty: DutyEvent,
  fallback: string,
): string {
  return duty.startTZ || duty.acclTZ || fallback
}

export function dutyEndLocationTZ(duty: DutyEvent, fallback: string): string {
  return duty.endTZ || duty.acclTZ || fallback
}

export function dutyAcclTZ(duty: DutyEvent, fallback: string): string {
  return duty.acclTZ || fallback
}

/**
 * WOCL = 02:00–05:59 acclimatized. True if any part of [start, end) overlaps WOCL
 * on any civil day the duty spans.
 */
export function fdpTouchesWocl(
  start: Date,
  end: Date,
  acclTZ: string,
): boolean {
  if (end.getTime() <= start.getTime()) return false
  // Sample along the duty
  const stepMs = 30 * 60 * 1000
  for (let t = start.getTime(); t < end.getTime(); t += stepMs) {
    const m = getMinutesInTZ(new Date(t), acclTZ)
    if (m >= 2 * 60 && m < 6 * 60) return true
  }
  // Also check WOCL windows that intersect the duty
  for (let dayOffset = -1; dayOffset <= 3; dayOffset++) {
    const woclStart = zonedWallTimeOnDay(start, acclTZ, 2, 0, dayOffset)
    const woclEnd = zonedWallTimeOnDay(start, acclTZ, 6, 0, dayOffset)
    if (
      woclStart.getTime() < end.getTime() &&
      woclEnd.getTime() > start.getTime()
    ) {
      const o0 = Math.max(start.getTime(), woclStart.getTime())
      const o1 = Math.min(end.getTime(), woclEnd.getTime())
      if (o1 > o0) return true
    }
  }
  return false
}

/**
 * How many consecutive duties ending at `duty` each touch the WOCL
 * (working backward until a non-WOCL duty). Used for CAR 700.51.
 */
export function countTrailingWoclDuties(
  allDuties: DutyEvent[],
  duty: DutyEvent,
  globalAcclTZ: string,
): number {
  const duties = [...allDuties]
    .filter((e) => e.type === 'duty')
    .sort((a, b) => a.start.getTime() - b.start.getTime())
  if (!duties.some((d) => d.id === duty.id)) {
    duties.push(duty)
    duties.sort((a, b) => a.start.getTime() - b.start.getTime())
  }
  const idx = duties.findIndex((d) => d.id === duty.id)
  if (idx < 0) return 0

  let count = 0
  for (let i = idx; i >= 0; i--) {
    const d = duties[i]
    const tz = dutyAcclTZ(d, globalAcclTZ)
    if (fdpTouchesWocl(d.start, d.end, tz)) {
      count++
    } else {
      break
    }
  }
  return count
}

/**
 * Count how many distinct acclimatized local-night windows (≥9 h inside
 * 22:30–09:30) fit inside [gapStart, gapEnd].
 */
export function countFullLocalNightsInGap(
  gapStart: Date,
  gapEnd: Date,
  tz: string,
): number {
  if (gapEnd.getTime() <= gapStart.getTime()) return 0
  let count = 0
  for (let dayOffset = -1; dayOffset <= 21; dayOffset++) {
    const windowStart = zonedWallTimeOnDay(gapStart, tz, 22, 30, dayOffset)
    const windowEnd = zonedWallTimeOnDay(windowStart, tz, 9, 30, 1)
    // Window must not start before the gap in a way that can't reach 9h
    const overlapStart = Math.max(gapStart.getTime(), windowStart.getTime())
    const overlapEnd = Math.min(gapEnd.getTime(), windowEnd.getTime())
    if (overlapEnd > overlapStart) {
      const hours = (overlapEnd - overlapStart) / (1000 * 60 * 60)
      if (hours >= 9 - 1e-9) count++
    }
  }
  return count
}

/**
 * Instant when the Nth full local night after `after` ends (09:30 of that night).
 * Used to size the required rest bar for multi-LNR.
 */
export function endOfNthLocalNightAfter(
  after: Date,
  tz: string,
  n: number,
): Date {
  if (n <= 0) return after
  let found = 0
  for (let dayOffset = 0; dayOffset <= 30; dayOffset++) {
    const windowStart = zonedWallTimeOnDay(after, tz, 22, 30, dayOffset)
    const windowEnd = zonedWallTimeOnDay(windowStart, tz, 9, 30, 1)
    const restStart = Math.max(after.getTime(), windowStart.getTime())
    const hours = (windowEnd.getTime() - restStart) / (1000 * 60 * 60)
    if (hours >= 9 - 1e-9) {
      found++
      if (found >= n) return windowEnd
    }
  }
  return new Date(after.getTime() + n * 24 * 60 * 60 * 1000)
}

/**
 * Estimate time away from home base ending at `returnDuty`.
 * Leaves home at the start of the first duty after the last duty that ended at home,
 * or at the first duty start if none ended at home.
 */
export function estimateTimeAwayHours(
  dutiesSorted: DutyEvent[],
  returnDuty: DutyEvent,
  homeBaseTZ: string,
  fallbackTZ: string,
): number {
  const idx = dutiesSorted.findIndex((d) => d.id === returnDuty.id)
  const list = idx >= 0 ? dutiesSorted.slice(0, idx + 1) : [...dutiesSorted, returnDuty]
  let leaveTime: Date | null = null

  for (let i = 0; i < list.length; i++) {
    const d = list[i]
    if (d.id === returnDuty.id) break
    const endLoc = dutyEndLocationTZ(d, fallbackTZ)
    if (sameZone(endLoc, homeBaseTZ, d.end)) {
      // Next duty after this home release is departure (or return duty itself)
      const next = list[i + 1]
      leaveTime = next ? next.start : d.end
    }
  }

  if (!leaveTime) {
    // Never ended at home in history — use start of earliest duty in trip
    const first = list[0]
    leaveTime = first?.start ?? returnDuty.start
  }

  return Math.max(
    0,
    (returnDuty.end.getTime() - leaveTime.getTime()) / (1000 * 60 * 60),
  )
}

function baseRestHours(regulator: Regulator, restType: RestType): number {
  if (restType === '10+travel') return 10
  return getMinRestHours(regulator)
}

/**
 * Compute required rest after a duty under 700.40 + 700.42 (TC only for 700.42).
 */
export function computeTimeZoneRestPlan(
  duty: DutyEvent,
  allDuties: DutyEvent[],
  regulator: Regulator,
  homeBaseTZ: string,
  globalAcclTZ: string,
  restType: RestType = '12h',
): TimeZoneRestPlan {
  const base = baseRestHours(regulator, restType)
  const startLoc = dutyStartLocationTZ(duty, globalAcclTZ)
  const endLoc = dutyEndLocationTZ(duty, globalAcclTZ)
  const accl = dutyAcclTZ(duty, globalAcclTZ)

  const endsAtHome = sameZone(endLoc, homeBaseTZ, duty.end)
  const endsAway = !endsAtHome
  const startsAway = !sameZone(startLoc, homeBaseTZ, duty.start)

  // Zone shift during this FDP (start location vs end location)
  const zoneDiffStartEnd = hoursBetweenTimeZones(startLoc, endLoc, duty.end)
  // Zone shift vs home for return rules
  const zoneDiffStartHome = hoursBetweenTimeZones(startLoc, homeBaseTZ, duty.start)

  let restHours = base
  let localNights = 0
  let restKind: RestKind = 'base'
  let restRule: RestRuleCode = 'CAR 700.40'
  let why = `Base rest ${base} h under CAR 700.40 (${restType === '10+travel' ? '10 h + travel / hotel' : 'standard minimum'}).`
  let timeAwayHours: number | null = null
  let woclOnReturn = false
  let consecutiveWoclDuties = 0

  if (regulator !== 'TC') {
    return {
      restHours,
      localNights,
      restKind,
      restRule,
      why,
      zoneDiffHours: zoneDiffStartEnd,
      timeAwayHours,
      endsAtHome,
      endsAway,
      startsAway,
      woclOnReturn,
      consecutiveWoclDuties,
    }
  }

  // --- 700.42(1): ends away from home base ---
  if (endsAway) {
    if (nearlyEqual(zoneDiffStartEnd, FOUR_H)) {
      restHours = Math.max(restHours, 11)
      restKind = 'tz_away'
      restRule = 'CAR 700.42(1)'
      why = `FDP ends away from home base (${endLoc.replace(/_/g, ' ')}); local time at start (${startLoc.replace(/_/g, ' ')}) differs by ~4 h from end → minimum 11 h in suitable accommodation (CAR 700.42(1)(a)). Applied over base ${base} h.`
    } else if (zoneDiffStartEnd > FOUR_H) {
      restHours = Math.max(restHours, 14)
      restKind = 'tz_away'
      restRule = 'CAR 700.42(1)'
      why = `FDP ends away from home base; local time differs by ${zoneDiffStartEnd.toFixed(1)} h (>4 h) between start and end locations → minimum 14 h in suitable accommodation (CAR 700.42(1)(b)). Applied over base ${base} h.`
    } else {
      why = `FDP ends away from home base but zone difference start→end is ${zoneDiffStartEnd.toFixed(1)} h (<4 h), so CAR 700.42(1) does not increase rest; base CAR 700.40 (${base} h) applies.`
    }
  }

  // --- 700.42(2): starts away, ends at home ---
  if (startsAway && endsAtHome) {
    const duties = [...allDuties]
      .filter((e) => e.type === 'duty')
      .sort((a, b) => a.start.getTime() - b.start.getTime())
    // Ensure current duty is in the list for time-away walk
    if (!duties.some((d) => d.id === duty.id)) {
      duties.push(duty)
      duties.sort((a, b) => a.start.getTime() - b.start.getTime())
    }

    timeAwayHours = estimateTimeAwayHours(
      duties,
      duty,
      homeBaseTZ,
      globalAcclTZ,
    )
    woclOnReturn = fdpTouchesWocl(duty.start, duty.end, accl)
    const zd = zoneDiffStartHome

    if (nearlyEqual(zd, FOUR_H) && timeAwayHours > 36) {
      restHours = Math.max(restHours, 13)
      restKind = 'tz_return_hours'
      restRule = 'CAR 700.42(2)'
      localNights = 0
      why = `Return to home base: start location differs by ~4 h from home and time away ≈ ${timeAwayHours.toFixed(0)} h (>36 h) → minimum 13 consecutive hours rest (CAR 700.42(2)(a)).`
    } else if (zd > FOUR_H && zd <= TEN_H + ZONE_EPS) {
      if (timeAwayHours <= 60 && !woclOnReturn) {
        localNights = Math.max(localNights, 1)
        restKind = 'tz_return_lnr'
        restRule = 'CAR 700.42(2)'
        why = `Return to home base: zone difference ${zd.toFixed(1)} h (4–10 h), time away ≈ ${timeAwayHours.toFixed(0)} h (≤60 h), return FDP does not touch WOCL → 1 local night’s rest before next duty (CAR 700.42(2)(b)(i)).`
      } else {
        localNights = Math.max(localNights, 2)
        restKind = 'tz_return_lnr'
        restRule = 'CAR 700.42(2)'
        why = `Return to home base: zone difference ${zd.toFixed(1)} h (4–10 h); time away ≈ ${timeAwayHours.toFixed(0)} h${timeAwayHours > 60 ? ' (>60 h)' : ''}${woclOnReturn ? '; return FDP touches WOCL (02:00–05:59 acclimatized)' : ''} → 2 local nights’ rest before next duty (CAR 700.42(2)(b)(ii)).`
      }
    } else if (zd > TEN_H) {
      if (timeAwayHours <= 60) {
        localNights = Math.max(localNights, 2)
        restKind = 'tz_return_lnr'
        restRule = 'CAR 700.42(2)'
        why = `Return to home base: zone difference ${zd.toFixed(1)} h (>10 h), time away ≈ ${timeAwayHours.toFixed(0)} h (≤60 h) → 2 local nights’ rest (CAR 700.42(2)(c)(i)).`
      } else {
        localNights = Math.max(localNights, 3)
        restKind = 'tz_return_lnr'
        restRule = 'CAR 700.42(2)'
        why = `Return to home base: zone difference ${zd.toFixed(1)} h (>10 h), time away ≈ ${timeAwayHours.toFixed(0)} h (>60 h) → 3 local nights’ rest (CAR 700.42(2)(c)(ii)).`
      }
    } else if (!endsAway) {
      // started away but small zone gap vs home and not the 4h+36h case
      why = `Return to home base with zone difference ${zd.toFixed(1)} h from start location; CAR 700.42(2) multi-LNR / 13 h thresholds not met. Base rest ${restHours} h applies${restRule !== 'CAR 700.40' ? ` (also ${restRule})` : ''}.`
    }

    // Multi-LNR still needs a rest bar at least as long as end of Nth night
    // Clock floor remains restHours for 700.40 / 700.42(1) stacking
  }

  // --- 700.51: three consecutive FDPs that touch WOCL → one local night’s rest ---
  consecutiveWoclDuties = countTrailingWoclDuties(
    allDuties,
    duty,
    globalAcclTZ,
  )
  if (consecutiveWoclDuties >= 3) {
    const priorNights = localNights
    localNights = Math.max(localNights, 1)
    const woclWhy = `This is the ${consecutiveWoclDuties}${ordinalSuffix(consecutiveWoclDuties)} consecutive flight duty period that touches the WOCL (02:00–05:59 acclimatized). CAR 700.51 requires one local night’s rest (≥9 h inside 22:30–09:30) at the end of the third such duty before the next FDP.`

    if (priorNights < 1) {
      // 700.51 is the reason local night(s) are required
      restKind = 'wocl_consecutive'
      restRule = 'CAR 700.51'
      why = woclWhy
    } else {
      // Already required nights (e.g. 700.42(2)); keep the stricter multi-LNR rule
      // but record that 700.51 is also satisfied by the same rest.
      why = `${why} Additionally: ${woclWhy}`
    }
  }

  return {
    restHours,
    localNights,
    restKind,
    restRule,
    why,
    zoneDiffHours: startsAway && endsAtHome ? zoneDiffStartHome : zoneDiffStartEnd,
    timeAwayHours,
    endsAtHome,
    endsAway,
    startsAway,
    woclOnReturn,
    consecutiveWoclDuties,
  }
}

function ordinalSuffix(n: number): string {
  const j = n % 10
  const k = n % 100
  if (j === 1 && k !== 11) return 'st'
  if (j === 2 && k !== 12) return 'nd'
  if (j === 3 && k !== 13) return 'rd'
  return 'th'
}

/**
 * Planned rest interval after duty for calendar bar + violation checks.
 */
export function plannedRestInterval(
  dutyEnd: Date,
  plan: TimeZoneRestPlan,
  acclTZ: string,
): { start: Date; end: Date } {
  const start = dutyEnd
  let endByHours = new Date(dutyEnd.getTime() + plan.restHours * 60 * 60 * 1000)
  if (plan.localNights > 0) {
    const endByNights = endOfNthLocalNightAfter(
      dutyEnd,
      acclTZ,
      plan.localNights,
    )
    if (endByNights.getTime() > endByHours.getTime()) {
      endByHours = endByNights
    }
  }
  return { start, end: endByHours }
}

/**
 * Whether the gap until next duty satisfies the plan (clock + local nights).
 */
export function restPlanSatisfied(
  plan: TimeZoneRestPlan,
  restStart: Date,
  nextDutyStart: Date | null,
  acclTZ: string,
): { ok: boolean; detail: string } {
  const gapEnd = nextDutyStart ?? new Date(restStart.getTime() + 30 * 24 * 3600 * 1000)
  const gapHours =
    (gapEnd.getTime() - restStart.getTime()) / (1000 * 60 * 60)

  if (plan.localNights > 0) {
    const nights = countFullLocalNightsInGap(restStart, gapEnd, acclTZ)
    if (nights < plan.localNights) {
      return {
        ok: false,
        detail: `Only ${nights} full local night(s) in rest gap; ${plan.localNights} required (${plan.restRule}). Best night-window overlap sample: ${bestLocalNightWindowHours(restStart, gapEnd, acclTZ).toFixed(1)} h.`,
      }
    }
  }

  if (gapHours + 1e-9 < plan.restHours) {
    return {
      ok: false,
      detail: `Rest gap ${gapHours.toFixed(1)} h is shorter than required ${plan.restHours} h (${plan.restRule}).`,
    }
  }

  return { ok: true, detail: plan.why }
}
