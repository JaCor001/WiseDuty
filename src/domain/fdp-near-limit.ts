/**
 * Near-max / over-max FDP advisories.
 * Max = 700.28 table + split, limited by 700.70 RDP when linked.
 *
 * - Marker (≈MAX): within 1 h 30 of max (visual early warning)
 * - Approaching dialog: within 30 min of max (still under)
 * - Exceeded dialog: past max (action required)
 */
import type { DutyEvent, Regulator } from './types'
import { getHourInTZ } from './time'
import { getMaxFdpHours } from './regulations'
import { computeSplitDutyExtensionFromBreak } from './rest-70050'
import { computeRdpFdpLimit, findLinkedRapStart } from './rest-70070'

/** Calendar marker: within this many hours of Max FDP. */
export const FDP_NEAR_MAX_THRESHOLD_H = 1.5
/** Acknowledge dialog when within this many hours of Max FDP (still under). */
export const FDP_APPROACHING_THRESHOLD_H = 0.5
/**
 * Soft advisory dialog band (amber chrome): within this many hours of Max FDP
 * but still above the 30 min “approaching” red band.
 */
export const FDP_AMBER_THRESHOLD_H = 1

export type FdpLimitStatus = 'ok' | 'approaching' | 'exceeded'

/** Visual severity for AppDialog chrome (matches ≈MAX amber / delete red). */
export type FdpDialogTone = 'amber' | 'danger'

export interface FdpNearMaxResult {
  /** Dialog-level status (30 min / over). */
  status: FdpLimitStatus
  /** True when within 1 h 30 of max or over (calendar marker). */
  near: boolean
  actualHours: number
  maxFdpHours: number
  remainingHours: number
  /** True when 700.70 RDP is the tighter limit. */
  rdpLimiting: boolean
  /** Short label for titles: FDP or RDP */
  limitKind: 'FDP' | 'RDP'
  message: string
  /** Human remaining / overage label. */
  remainingLabel: string
}

function hoursBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 3_600_000
}

export function fdpHoursForNearLimit(duty: DutyEvent): number {
  if (
    duty.endsWithPositioning &&
    duty.operatingEnd &&
    !isNaN(duty.operatingEnd.getTime())
  ) {
    return hoursBetween(duty.start, duty.operatingEnd)
  }
  return hoursBetween(duty.start, duty.end)
}

export function resolveDutyMaxFdpHours(
  duty: DutyEvent,
  opts: {
    regulator: Regulator
    globalAcclTZ: string
    homeBaseTZ?: string
    allEvents?: DutyEvent[]
  },
): { maxFdpHours: number; rdpLimiting: boolean } {
  if (duty.type !== 'duty') return { maxFdpHours: 0, rdpLimiting: false }
  const accl = duty.acclTZ || opts.globalAcclTZ
  const startHour = getHourInTZ(duty.start, accl)
  const sectors =
    duty.operatingSectors != null && duty.operatingSectors >= 1
      ? duty.operatingSectors
      : 1
  const avg = duty.avgSectorTime ?? '>=50'
  const table = getMaxFdpHours(opts.regulator, startHour, sectors, avg)

  let splitExt = 0
  if (duty.splitBreak && opts.regulator === 'TC') {
    const ext = computeSplitDutyExtensionFromBreak(duty.splitBreak, accl)
    if (ext.ok) splitExt = ext.extensionHours
  }
  const extended = table + splitExt

  if (opts.regulator !== 'TC') {
    return { maxFdpHours: extended, rdpLimiting: false }
  }

  // Prefer stored RAP start; fall back to linking a prior reserve on the schedule
  // (reserve→FDP handoff and older duties without rapStart).
  const rapStart =
    duty.rapStart && !isNaN(duty.rapStart.getTime())
      ? duty.rapStart
      : opts.allEvents
        ? findLinkedRapStart(opts.allEvents, duty.start, {
            excludeId: duty.id,
          })
        : null
  if (rapStart) {
    const rdp = computeRdpFdpLimit({
      rapStart,
      report: duty.start,
      acclTZ: accl,
      maxFdpTableHours: table,
      extendedMaxFdpHours: extended,
      splitDutyOnReserve: splitExt > 0,
    })
    return {
      maxFdpHours: rdp.limitingMaxFdpHours,
      rdpLimiting: rdp.limitingSource === 'rdp_70070',
    }
  }

  return { maxFdpHours: extended, rdpLimiting: false }
}

/** Format hours as "1 h 24 min" or "36 min". */
export function formatDurationHMin(hours: number): string {
  const abs = Math.abs(hours)
  const totalMin = Math.round(abs * 60)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h <= 0) return `${m} min`
  if (m === 0) return `${h} h`
  return `${h} h ${m} min`
}

export function evaluateFdpNearMaxLimit(
  duty: DutyEvent,
  opts: {
    regulator: Regulator
    globalAcclTZ: string
    homeBaseTZ?: string
    /** Full schedule — used to auto-link RAP (700.70) when duty.rapStart is missing. */
    allEvents?: DutyEvent[]
    markerThresholdHours?: number
    approachingThresholdHours?: number
  },
): FdpNearMaxResult {
  const markerTh = opts.markerThresholdHours ?? FDP_NEAR_MAX_THRESHOLD_H
  const approachTh =
    opts.approachingThresholdHours ?? FDP_APPROACHING_THRESHOLD_H
  const empty: FdpNearMaxResult = {
    status: 'ok',
    near: false,
    actualHours: 0,
    maxFdpHours: 0,
    remainingHours: 0,
    rdpLimiting: false,
    limitKind: 'FDP',
    message: '',
    remainingLabel: '',
  }
  if (duty.type !== 'duty') return empty
  if (isNaN(duty.start.getTime()) || isNaN(duty.end.getTime())) return empty

  const actualHours = fdpHoursForNearLimit(duty)
  const { maxFdpHours, rdpLimiting } = resolveDutyMaxFdpHours(duty, opts)
  if (maxFdpHours <= 0 || !Number.isFinite(maxFdpHours)) return empty

  const remainingHours = maxFdpHours - actualHours
  const limitKind: 'FDP' | 'RDP' = rdpLimiting ? 'RDP' : 'FDP'
  const remainingLabel = formatDurationHMin(remainingHours)

  const exceeded = remainingHours < -1e-9
  const approaching =
    !exceeded && remainingHours <= approachTh + 1e-9
  const near =
    exceeded || remainingHours <= markerTh + 1e-9

  let status: FdpLimitStatus = 'ok'
  if (exceeded) status = 'exceeded'
  else if (approaching) status = 'approaching'

  let message = ''
  if (status === 'exceeded') {
    message = `Forecast FDP ${formatDurationHMin(actualHours)} exceeds Max ${limitKind} ${formatDurationHMin(maxFdpHours)} by ${formatDurationHMin(-remainingHours)}. Action is required.`
  } else if (status === 'approaching') {
    message = `FDP approaching Max ${limitKind}: ${remainingLabel} remaining (${formatDurationHMin(actualHours)} used of ${formatDurationHMin(maxFdpHours)} max).`
  } else if (near) {
    message = `Within 1 h 30 of Max ${limitKind}: ${remainingLabel} remaining.`
  }

  return {
    status,
    near,
    actualHours,
    maxFdpHours,
    remainingHours,
    rdpLimiting,
    limitKind,
    message,
    remainingLabel,
  }
}

/**
 * Dialog chrome for near/over Max FDP prompts:
 * - amber: within 1 h of max (still more than 30 min remaining)
 * - danger (red): within 30 min of max, or past max
 */
export function fdpLimitDialogTone(
  result: Pick<FdpNearMaxResult, 'status' | 'remainingHours'>,
): FdpDialogTone {
  if (result.status === 'exceeded' || result.remainingHours <= FDP_APPROACHING_THRESHOLD_H + 1e-9) {
    return 'danger'
  }
  return 'amber'
}

/** True when a post-save Max FDP advisory dialog should open. */
export function shouldPromptFdpLimitDialog(
  result: Pick<FdpNearMaxResult, 'status' | 'remainingHours' | 'maxFdpHours'>,
): boolean {
  if (result.maxFdpHours <= 0) return false
  if (result.status === 'exceeded') return true
  // Amber band (≤1 h) includes the red approaching band (≤30 min)
  return result.remainingHours <= FDP_AMBER_THRESHOLD_H + 1e-9
}
