/**
 * CAR 700.43 — Rest period after positioning (deadhead) following an FDP.
 * AC 700-047 §§4.45–4.47.
 *
 * When FDP + post-FDP positioning exceeds the 700.28 max FDP:
 *  (a) exceedance ≤ 3 h → rest = hours of work (total duty)
 *  (b) exceedance > 3 h → rest = hours of work + exceedance
 * Never shorter than 700.40 (callers max with other rest plans).
 * Exceedance > 3 h requires crew agreement; hard cap +7 h (700.43(3)).
 */
import type { AvgSectorTime, DutyEvent, Regulator } from './types'
import { getMaxFdpHours } from './regulations'
import { getHourInTZ } from './time'
import { dutyAcclTZ } from './rest-70042'

export const POSITIONING_SOFT_EXCESS_H = 3
export const POSITIONING_HARD_EXCESS_H = 7

export type PositioningRestBand = 'none' | 'le3' | 'gt3'

export interface PositioningRestResult {
  /** Clock rest hours required by 700.43(1); 0 if rule does not apply. */
  restHours: number
  exceedanceHours: number
  band: PositioningRestBand
  totalDutyHours: number
  maxFdpHours: number
  operatingHours: number
  positioningHours: number
  why: string
}

export interface PositioningAllowedResult {
  ok: boolean
  code?:
    | 'operating_over_max'
    | 'needs_agreement'
    | 'over_hard_cap'
    | 'invalid_operating_end'
    | 'no_positioning'
  detail?: string
  exceedanceHours: number
  totalDutyHours: number
  maxFdpHours: number
  operatingHours: number
  positioningHours: number
}

function hoursBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / (1000 * 60 * 60)
}

/**
 * 700.43(1) rest from total duty vs max FDP.
 * Does not enforce agreement / +7 — use assertPositioningAllowed for that.
 */
export function computePositioningRestHours(opts: {
  totalDutyHours: number
  maxFdpHours: number
}): PositioningRestResult {
  const total = opts.totalDutyHours
  const max = opts.maxFdpHours
  const base: Omit<PositioningRestResult, 'restHours' | 'exceedanceHours' | 'band' | 'why'> = {
    totalDutyHours: total,
    maxFdpHours: max,
    operatingHours: 0,
    positioningHours: 0,
  }

  if (!(total > 0) || !(max > 0) || total <= max + 1e-9) {
    return {
      ...base,
      restHours: 0,
      exceedanceHours: 0,
      band: 'none',
      why: 'Total duty does not exceed the maximum flight duty period; CAR 700.43 does not increase rest.',
    }
  }

  const exceedance = total - max
  if (exceedance <= POSITIONING_SOFT_EXCESS_H + 1e-9) {
    return {
      ...base,
      restHours: total,
      exceedanceHours: exceedance,
      band: 'le3',
      why: `FDP plus positioning (${formatH(total)} h) exceeds max FDP (${formatH(max)} h) by ${formatH(exceedance)} h (≤ 3 h). CAR 700.43(1)(a): required rest equals hours of work = ${formatH(total)} h.`,
    }
  }

  const rest = total + exceedance
  return {
    ...base,
    restHours: rest,
    exceedanceHours: exceedance,
    band: 'gt3',
    why: `FDP plus positioning (${formatH(total)} h) exceeds max FDP (${formatH(max)} h) by ${formatH(exceedance)} h (> 3 h). CAR 700.43(1)(b): required rest equals hours of work plus the exceedance = ${formatH(total)} + ${formatH(exceedance)} = ${formatH(rest)} h. Crew agreement required under 700.43(3); exceedance must not exceed 7 h.`,
  }
}

function formatH(h: number): string {
  return Number.isInteger(h) || Math.abs(h - Math.round(h)) < 1e-6
    ? String(Math.round(h * 10) / 10)
    : h.toFixed(1)
}

/**
 * Validate trailing positioning against 700.28 / 700.43(3).
 * Operating FDP alone must not exceed max; total may exceed by ≤7 h (agreement if >3).
 */
export function assertPositioningAllowed(opts: {
  start: Date
  end: Date
  operatingEnd: Date
  maxFdpHours: number
  positioningAgreed?: boolean
}): PositioningAllowedResult {
  const { start, end, operatingEnd, maxFdpHours, positioningAgreed } = opts
  const totalDutyHours = hoursBetween(start, end)
  const operatingHours = hoursBetween(start, operatingEnd)
  const positioningHours = hoursBetween(operatingEnd, end)

  if (!(operatingEnd.getTime() > start.getTime())) {
    return {
      ok: false,
      code: 'invalid_operating_end',
      detail: `Operating release must be after report time (got report ${start.toLocaleString()}, operating ${operatingEnd.toLocaleString()}, final ${end.toLocaleString()}). Enter operating release as wall clock in the end-location time zone (same as final End), after report and before deadhead arrival.`,
      exceedanceHours: 0,
      totalDutyHours,
      maxFdpHours,
      operatingHours,
      positioningHours,
    }
  }

  if (operatingEnd.getTime() > end.getTime()) {
    return {
      ok: false,
      code: 'invalid_operating_end',
      detail: `Operating release is after final release / deadhead arrival (operating ${operatingEnd.toLocaleString()}, final ${end.toLocaleString()}). Set it to engines-off of the last operating flight — strictly before the deadhead ends.`,
      exceedanceHours: 0,
      totalDutyHours,
      maxFdpHours,
      operatingHours,
      positioningHours,
    }
  }

  if (positioningHours <= 1e-9) {
    return {
      ok: false,
      code: 'no_positioning',
      detail:
        'Operating release matches final release, so deadhead duration is zero. Set operating release to the end of the last operating flight (before deadhead arrival).',
      exceedanceHours: 0,
      totalDutyHours,
      maxFdpHours,
      operatingHours,
      positioningHours,
    }
  }

  if (operatingHours > maxFdpHours + 1e-9) {
    return {
      ok: false,
      code: 'operating_over_max',
      detail: `Operating FDP (${formatH(operatingHours)} h) exceeds the table maximum (${formatH(maxFdpHours)} h). Only post-FDP positioning may extend total duty under CAR 700.43.`,
      exceedanceHours: Math.max(0, totalDutyHours - maxFdpHours),
      totalDutyHours,
      maxFdpHours,
      operatingHours,
      positioningHours,
    }
  }

  const exceedanceHours = Math.max(0, totalDutyHours - maxFdpHours)
  if (exceedanceHours <= 1e-9) {
    return {
      ok: true,
      exceedanceHours: 0,
      totalDutyHours,
      maxFdpHours,
      operatingHours,
      positioningHours,
    }
  }

  if (exceedanceHours > POSITIONING_HARD_EXCESS_H + 1e-9) {
    return {
      ok: false,
      code: 'over_hard_cap',
      detail: `Total duty exceeds max FDP by ${formatH(exceedanceHours)} h; CAR 700.43(3) caps positioning exceedance at 7 hours.`,
      exceedanceHours,
      totalDutyHours,
      maxFdpHours,
      operatingHours,
      positioningHours,
    }
  }

  if (
    exceedanceHours > POSITIONING_SOFT_EXCESS_H + 1e-9 &&
    !positioningAgreed
  ) {
    return {
      ok: false,
      code: 'needs_agreement',
      detail: `Total duty exceeds max FDP by ${formatH(exceedanceHours)} h (> 3 h). CAR 700.43(3) requires flight crew member agreement to the extended positioning.`,
      exceedanceHours,
      totalDutyHours,
      maxFdpHours,
      operatingHours,
      positioningHours,
    }
  }

  return {
    ok: true,
    exceedanceHours,
    totalDutyHours,
    maxFdpHours,
    operatingHours,
    positioningHours,
  }
}

/** Operating sector count for 700.28 table (excludes positioning). */
export function getOperatingSectorCount(
  duty: DutyEvent,
  fallbackSectors: number,
): number {
  if (duty.operatingSectors != null && duty.operatingSectors >= 1) {
    return duty.operatingSectors
  }
  return Math.max(1, fallbackSectors)
}

export function getMaxFdpForDuty(
  duty: DutyEvent,
  regulator: Regulator,
  globalAcclTZ: string,
  fallbackSectors: number,
  fallbackAvg: AvgSectorTime,
): number {
  const accl = dutyAcclTZ(duty, globalAcclTZ)
  const startHour = getHourInTZ(duty.start, accl)
  const sectors = getOperatingSectorCount(duty, fallbackSectors)
  const avg = duty.avgSectorTime ?? fallbackAvg
  return getMaxFdpHours(regulator, startHour, sectors, avg)
}

/**
 * Full 700.43 evaluation for a duty that ends with positioning.
 * Returns null if the duty does not carry the required fields.
 */
export function evaluatePositioningRestForDuty(
  duty: DutyEvent,
  regulator: Regulator,
  globalAcclTZ: string,
  fallbackSectors: number,
  fallbackAvg: AvgSectorTime,
): PositioningRestResult | null {
  if (regulator !== 'TC') return null
  if (!duty.endsWithPositioning || !duty.operatingEnd) return null
  if (duty.type !== 'duty') return null

  const maxFdp = getMaxFdpForDuty(
    duty,
    regulator,
    globalAcclTZ,
    fallbackSectors,
    fallbackAvg,
  )
  const totalDutyHours = hoursBetween(duty.start, duty.end)
  const operatingHours = hoursBetween(duty.start, duty.operatingEnd)
  const positioningHours = hoursBetween(duty.operatingEnd, duty.end)

  const core = computePositioningRestHours({
    totalDutyHours,
    maxFdpHours: maxFdp,
  })

  return {
    ...core,
    operatingHours,
    positioningHours,
    why:
      core.band === 'none'
        ? `Trailing positioning ${formatH(positioningHours)} h after operating release; total duty ${formatH(totalDutyHours)} h is within max FDP ${formatH(maxFdp)} h. CAR 700.43 does not increase rest beyond 700.40 / 700.42.`
        : `${core.why} Operating FDP ${formatH(operatingHours)} h; positioning ${formatH(positioningHours)} h; total duty ${formatH(totalDutyHours)} h.`,
  }
}
