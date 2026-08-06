/**
 * CAR 700.70 — Flight crew member on reserve (RDP limits).
 *
 * Definitions (AC 700-047 / CAR 700.01):
 * - RAP (Reserve Availability Period): time the member is available to report
 * - RDP (Reserve Duty Period): RAP start → end of the assigned FDP
 *
 * When called out from reserve, the more restrictive of:
 *   (a) CAR 700.28 max FDP from report (plus any 700.50 split extension), and
 *   (b) remaining RDP after RAP-start → report elapsed,
 * limits how long the FDP may run — unless 700.70(10) 24 h-notice applies.
 *
 * Grid CAR 700.70(7) — max RDP by RAP start hour (acclimatized local):
 *   02:00–17:59 → 18 h
 *   18:00–18:59 → 17 h
 *   19:00–20:59 → 16 h
 *   21:00–22:59 → 15 h
 *   23:00–01:59 → 14 h
 *
 * 700.70(8) augmented tables and 700.70(9) early-RAP no-contact extension are
 * optional inputs. 700.50(5): valid split duty on reserve may extend RDP by 2 h.
 */
import type { AvgSectorTime, DutyEvent, Regulator } from './types'
import { getMaxFdpHours } from './regulations'
import {
  computeSplitDutyExtensionFromBreak,
} from './rest-70050'
import { getHourInTZ, zonedWallTimeOnDay } from './time'

const H = 3_600_000

/**
 * Legacy gap used when reserve still covers report (availability until report).
 * Call-out often ends the reserve bar hours earlier — see {@link findLinkedRapStart}.
 */
export const RAP_CONTINUITY_GAP_MS = 2 * H

/**
 * Max lookback from FDP report to a candidate RAP start when auto-linking.
 * Covers unaugmented 18 h RDP and 700.70(8) augmented up to 26 h, plus slack.
 */
export const RAP_LINK_MAX_LOOKBACK_MS = 28 * H

export type MaxRdpBandLabel =
  | '02:00–17:59 → 18 h'
  | '18:00–18:59 → 17 h'
  | '19:00–20:59 → 16 h'
  | '21:00–22:59 → 15 h'
  | '23:00–01:59 → 14 h'

/**
 * CAR 700.70(7) table: max consecutive RDP hours from RAP start hour (0–23).
 */
export function getMaxRdpHoursFromRapStartHour(
  rapStartHour: number,
): { maxRdpHours: number; bandLabel: MaxRdpBandLabel } {
  const h = ((Math.floor(rapStartHour) % 24) + 24) % 24
  if (h >= 2 && h <= 17) {
    return { maxRdpHours: 18, bandLabel: '02:00–17:59 → 18 h' }
  }
  if (h === 18) {
    return { maxRdpHours: 17, bandLabel: '18:00–18:59 → 17 h' }
  }
  if (h >= 19 && h <= 20) {
    return { maxRdpHours: 16, bandLabel: '19:00–20:59 → 16 h' }
  }
  if (h >= 21 && h <= 22) {
    return { maxRdpHours: 15, bandLabel: '21:00–22:59 → 15 h' }
  }
  // 23, 0, 1
  return { maxRdpHours: 14, bandLabel: '23:00–01:59 → 14 h' }
}

/**
 * CAR 700.70(8) — augmented crew RDP caps (when applicable).
 * Returns null if augmentation does not apply / insufficient rest facility.
 */
export function getAugmentedMaxRdpHours(opts: {
  /** 1 = one extra FCM; 2 = two extra. */
  additionalCrew: 0 | 1 | 2
  /** Class 1 or 2 rest facility for the extra member(s). */
  restFacilityClass: 0 | 1 | 2
  /** Acclimatized hour of RAP start (0–23). */
  rapStartHour: number
}): number | null {
  const { additionalCrew, restFacilityClass, rapStartHour } = opts
  if (additionalCrew < 1 || restFacilityClass < 1) return null
  if (additionalCrew === 1) {
    // 700.70(8)(a): max 20 h with class 1 or 2
    return 20
  }
  // additionalCrew === 2
  const h = ((Math.floor(rapStartHour) % 24) + 24) % 24
  // (b) RAP 21:00–03:00 → 22 h with class 1 or 2
  // (c) RAP before 21:00 or after 03:00 → 26 h with class 1 only
  const between21And03 = h >= 21 || h <= 3
  if (between21And03) {
    return restFacilityClass >= 1 ? 22 : null
  }
  return restFacilityClass === 1 ? 26 : null
}

/**
 * CAR 700.70(9) — early RAP no-contact extension.
 * RAP begins 02:00–05:59 acclimatized; member not contacted in that window.
 * Extension = min(2 h, 50% of RAP that falls in 02:00–05:59).
 */
export function earlyRapNoContactExtensionHours(
  rapStart: Date,
  acclTZ: string,
  /** Instant when first contacted / called out (defaults: assume after 06:00). */
  firstContact?: Date | null,
): number {
  const startH = getHourInTZ(rapStart, acclTZ)
  if (startH < 2 || startH >= 6) return 0

  // Portion of RAP in 02:00–05:59: from RAP start until 06:00 acclimatized same day
  const sixAm = zonedWallTimeOnDay(rapStart, acclTZ, 6, 0, 0)
  const windowEnd = sixAm.getTime()
  if (windowEnd <= rapStart.getTime()) return 0

  // Contacted during 02:00–05:59 → no extension
  if (firstContact && !isNaN(firstContact.getTime())) {
    if (
      firstContact.getTime() >= rapStart.getTime() &&
      firstContact.getTime() < windowEnd
    ) {
      return 0
    }
  }

  const rapInWoclMs = windowEnd - rapStart.getTime()
  const half = rapInWoclMs / 2 / H
  return Math.min(2, half)
}

export interface RdpLimitInput {
  rapStart: Date
  /** FDP report (start of flight duty period). */
  report: Date
  /** Acclimatized TZ for RAP start hour band (700.19(2)). */
  acclTZ: string
  /**
   * Pure 700.28 table max FDP hours (before split). Used only for labeling;
   * limiting uses extendedMaxFdpHours when provided.
   */
  maxFdpTableHours: number
  /**
   * 700.28 max + any 700.50 split extension. Compared against remaining RDP.
   */
  extendedMaxFdpHours: number
  /** CAR 700.50(5): valid mid-FDP split on reserve → RDP +2 h. */
  splitDutyOnReserve?: boolean
  /** CAR 700.70(9): early RAP, no contact 02:00–05:59. */
  earlyRapNoContact?: boolean
  firstContact?: Date | null
  /**
   * CAR 700.70(10): 24 h notice / no night notice / no duties after notice.
   * When true, RDP does not limit the FDP (700.28 alone applies).
   */
  notice24hEscape?: boolean
  /** Optional 700.70(8) augmentation. */
  additionalCrew?: 0 | 1 | 2
  restFacilityClass?: 0 | 1 | 2
}

export interface RdpLimitResult {
  applies: boolean
  /** Instant of RAP start used for this calculation. */
  rapStart: Date
  /** Acclimatized wall-clock hour of RAP start (0–23). */
  rapStartHour: number
  /** Base table from 700.70(7). */
  baseMaxRdpHours: number
  bandLabel: MaxRdpBandLabel
  /** +2 h from 700.50(5) if split on reserve. */
  splitRdpExtensionHours: number
  /** From 700.70(9) if early no-contact. */
  earlyExtensionHours: number
  /** Augmented cap from 700.70(8), if higher and applicable. */
  augmentedMaxRdpHours: number | null
  /** Final max RDP length (RAP start → FDP end). */
  maxRdpHours: number
  /** Hours from RAP start to FDP report. */
  elapsedRapToReportHours: number
  /**
   * Max FDP length allowed by RDP: maxRdp − elapsed.
   * Negative means already past max RDP at report (assignment invalid).
   */
  remainingRdpForFdpHours: number
  /** Pure 700.28 (+ split) max used for comparison. */
  fdpTableLimitHours: number
  /**
   * min(fdpTableLimit, remainingRdp) unless 700.70(10) escape.
   * This is the operational Max FDP when reserve is combined.
   */
  limitingMaxFdpHours: number
  /** Which rule is tighter. */
  limitingSource: 'fdp_70028' | 'rdp_70070' | 'notice_24h_escape'
  /** Human-readable summary for UI details. */
  summary: string
}

/**
 * Compute reserve+FDP limiting Max FDP under CAR 700.70(7)/(10) and 700.50(5).
 */
export function computeRdpFdpLimit(input: RdpLimitInput): RdpLimitResult {
  const {
    rapStart,
    report,
    acclTZ,
    maxFdpTableHours,
    extendedMaxFdpHours,
    splitDutyOnReserve = false,
    earlyRapNoContact = false,
    firstContact = null,
    notice24hEscape = false,
    additionalCrew = 0,
    restFacilityClass = 0,
  } = input

  const rapStartHour = getHourInTZ(rapStart, acclTZ)
  const base = getMaxRdpHoursFromRapStartHour(rapStartHour)
  const splitRdpExtensionHours = splitDutyOnReserve ? 2 : 0
  const earlyExtensionHours = earlyRapNoContact
    ? earlyRapNoContactExtensionHours(rapStart, acclTZ, firstContact)
    : 0

  const augmented = getAugmentedMaxRdpHours({
    additionalCrew: additionalCrew as 0 | 1 | 2,
    restFacilityClass: restFacilityClass as 0 | 1 | 2,
    rapStartHour,
  })

  // Base (7) + optional (9) + optional 700.50(5); augmented (8) replaces when higher
  let maxRdpHours =
    base.maxRdpHours + splitRdpExtensionHours + earlyExtensionHours
  if (augmented != null && augmented > maxRdpHours) {
    maxRdpHours = augmented + splitRdpExtensionHours
  }

  const elapsedMs = report.getTime() - rapStart.getTime()
  const elapsedRapToReportHours = elapsedMs / H
  const remainingRdpForFdpHours = maxRdpHours - elapsedRapToReportHours

  const fdpTableLimitHours = extendedMaxFdpHours

  if (notice24hEscape) {
    return {
      applies: true,
      rapStart,
      rapStartHour,
      baseMaxRdpHours: base.maxRdpHours,
      bandLabel: base.bandLabel,
      splitRdpExtensionHours,
      earlyExtensionHours,
      augmentedMaxRdpHours: augmented,
      maxRdpHours,
      elapsedRapToReportHours,
      remainingRdpForFdpHours,
      fdpTableLimitHours,
      limitingMaxFdpHours: fdpTableLimitHours,
      limitingSource: 'notice_24h_escape',
      summary: `CAR 700.70(10) 24 h-notice escape — FDP limited by 700.28 only (${formatH(fdpTableLimitHours)} h). RDP remaining would be ${formatH(remainingRdpForFdpHours)} h.`,
    }
  }

  const limitingMaxFdpHours = Math.min(
    fdpTableLimitHours,
    remainingRdpForFdpHours,
  )
  const limitingSource: RdpLimitResult['limitingSource'] =
    remainingRdpForFdpHours + 1e-9 < fdpTableLimitHours
      ? 'rdp_70070'
      : 'fdp_70028'

  const summaryParts = [
    `RDP max ${formatH(maxRdpHours)} h (RAP start ${pad2(rapStartHour)}:xx, ${base.bandLabel}`,
  ]
  if (splitRdpExtensionHours > 0) {
    summaryParts[0] += ` + split 700.50(5) +${splitRdpExtensionHours} h`
  }
  if (earlyExtensionHours > 0) {
    summaryParts[0] += ` + early no-contact +${formatH(earlyExtensionHours)} h`
  }
  if (augmented != null) {
    summaryParts[0] += ` · aug cap ${augmented} h`
  }
  summaryParts[0] += ')'
  summaryParts.push(
    `elapsed RAP→report ${formatH(elapsedRapToReportHours)} h → remaining for FDP ${formatH(remainingRdpForFdpHours)} h`,
  )
  summaryParts.push(
    `700.28 FDP max ${formatH(fdpTableLimitHours)} h` +
      (maxFdpTableHours + 1e-9 < fdpTableLimitHours
        ? ` (table ${formatH(maxFdpTableHours)} h + split)`
        : ''),
  )
  summaryParts.push(
    limitingSource === 'rdp_70070'
      ? `limiting: ${formatH(limitingMaxFdpHours)} h (RDP)`
      : `limiting: ${formatH(limitingMaxFdpHours)} h (700.28 FDP)`,
  )

  return {
    applies: true,
    rapStart,
    rapStartHour,
    baseMaxRdpHours: base.maxRdpHours,
    bandLabel: base.bandLabel,
    splitRdpExtensionHours,
    earlyExtensionHours,
    augmentedMaxRdpHours: augmented,
    maxRdpHours,
    elapsedRapToReportHours,
    remainingRdpForFdpHours,
    fdpTableLimitHours,
    limitingMaxFdpHours,
    limitingSource,
    summary: summaryParts.join(' · '),
  }
}

function formatH(n: number): string {
  if (!Number.isFinite(n)) return '—'
  const r = Math.round(n * 100) / 100
  return Number.isInteger(r) ? String(r) : r.toFixed(2)
}

function pad2(n: number): string {
  return String(Math.floor(n)).padStart(2, '0')
}

/**
 * Find RAP start from schedule for an FDP called from reserve.
 *
 * **Regulation (CAR 700.70 / AC 700-047):** RDP begins at RAP *start*, not at
 * call time or report. Pilots often end the reserve bar when the company
 * calls (hours before report). That gap must **not** prevent RDP linking.
 *
 * Standby (700.71) does not use RDP limits.
 *
 * Selection: latest-starting reserve with start &lt; report, still within a
 * plausible RDP lookback window. Prefers call-out that ends before report
 * over an unrelated older RAP.
 */
export function findLinkedRapStart(
  duties: DutyEvent[],
  report: Date,
  opts?: {
    excludeId?: string
    /** @deprecated Continuity gap is no longer required for call-out. */
    gapToleranceMs?: number
    maxLookbackMs?: number
  },
): Date | null {
  if (isNaN(report.getTime())) return null
  const reportMs = report.getTime()
  const lookback = opts?.maxLookbackMs ?? RAP_LINK_MAX_LOOKBACK_MS

  const candidates = duties.filter((d) => {
    if (opts?.excludeId && d.id === opts.excludeId) return false
    if (d.type !== 'reserve') return false
    if (isNaN(d.start.getTime()) || isNaN(d.end.getTime())) return false
    if (d.end.getTime() <= d.start.getTime()) return false
    if (d.start.getTime() >= reportMs) return false
    // RAP start too far before report → not this FDP's call-out window
    if (reportMs - d.start.getTime() > lookback) return false
    // Reserve must have started before report and not begin after report.
    // End may be at call time (hours before report) — that is valid.
    // Do not require end ≈ report.
    return true
  })

  if (candidates.length === 0) return null

  // Most recent RAP start (closest call-out period before this FDP)
  candidates.sort((a, b) => b.start.getTime() - a.start.getTime())
  return candidates[0].start
}

/** @deprecated Use {@link findLinkedRapStart}. */
export function findContinuousRapStart(
  duties: DutyEvent[],
  report: Date,
  opts?: { excludeId?: string; gapToleranceMs?: number },
): Date | null {
  return findLinkedRapStart(duties, report, opts)
}

/**
 * Evaluate CAR 700.70 RDP limit for a stored flight duty, using stored
 * `rapStart` or auto-linking a prior reserve on the schedule.
 */
export function evaluateRdpForDuty(
  duty: DutyEvent,
  allEvents: DutyEvent[],
  opts: {
    regulator: Regulator
    globalAcclTZ: string
    homeBaseTZ?: string
  },
): RdpLimitResult | null {
  if (opts.regulator !== 'TC') return null
  if (duty.type !== 'duty') return null
  if (isNaN(duty.start.getTime()) || isNaN(duty.end.getTime())) return null

  const accl = duty.acclTZ || opts.globalAcclTZ
  const startHour = getHourInTZ(duty.start, accl)
  const sectors =
    duty.operatingSectors != null && duty.operatingSectors >= 1
      ? duty.operatingSectors
      : 1
  const avg: AvgSectorTime = duty.avgSectorTime ?? '>=50'
  const maxFdpTableHours = getMaxFdpHours(
    opts.regulator,
    startHour,
    sectors,
    avg,
  )

  let splitExtensionHours = 0
  if (duty.splitBreak) {
    const ext = computeSplitDutyExtensionFromBreak(duty.splitBreak, accl)
    if (ext.ok) splitExtensionHours = ext.extensionHours
  }
  const extendedMaxFdpHours = maxFdpTableHours + splitExtensionHours

  const others = allEvents.filter((e) => e.id !== duty.id)
  const rapStart =
    duty.rapStart && !isNaN(duty.rapStart.getTime())
      ? duty.rapStart
      : findLinkedRapStart(others, duty.start)

  if (!rapStart || rapStart.getTime() > duty.start.getTime()) return null

  return computeRdpFdpLimit({
    rapStart,
    report: duty.start,
    acclTZ: accl,
    maxFdpTableHours,
    extendedMaxFdpHours,
    splitDutyOnReserve: splitExtensionHours > 0,
  })
}

/**
 * If this reserve is the RAP for a following FDP, return that duty + RDP analysis.
 */
export function evaluateRdpForReserve(
  reserve: DutyEvent,
  allEvents: DutyEvent[],
  opts: {
    regulator: Regulator
    globalAcclTZ: string
    homeBaseTZ?: string
  },
): { duty: DutyEvent; rdp: RdpLimitResult } | null {
  if (opts.regulator !== 'TC') return null
  if (reserve.type !== 'reserve') return null

  // Candidate FDPs that start at/after RAP start and within lookback window from RAP
  const candidates = allEvents
    .filter((e) => {
      if (e.type !== 'duty') return false
      if (e.id === reserve.id) return false
      if (e.start.getTime() < reserve.start.getTime()) return false
      if (e.start.getTime() - reserve.start.getTime() > RAP_LINK_MAX_LOOKBACK_MS)
        return false
      return true
    })
    .sort((a, b) => a.start.getTime() - b.start.getTime())

  for (const duty of candidates) {
    const linked = findLinkedRapStart(
      allEvents.filter((e) => e.id !== duty.id),
      duty.start,
    )
    const usesThisRap =
      (duty.rapStart &&
        Math.abs(duty.rapStart.getTime() - reserve.start.getTime()) < 60_000) ||
      (linked &&
        Math.abs(linked.getTime() - reserve.start.getTime()) < 60_000)
    if (!usesThisRap) continue
    const rdp = evaluateRdpForDuty(duty, allEvents, opts)
    if (rdp) return { duty, rdp }
  }
  return null
}
