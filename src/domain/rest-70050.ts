/**
 * CAR 700.50 — Split Flight Duty (AC 700-047 §§4.49–4.53).
 *
 * A mid-FDP break in suitable accommodation of ≥60 consecutive minutes may
 * extend the 700.28 maximum FDP. The break remains inside the FDP (not a rest
 * period under 700.40) and does not count as hours of work.
 *
 * Extension (after subtracting 45 min):
 * - 100% of break during 24:00–05:59 acclimatized local time
 * - 50% of break during 06:00–23:59
 * - 50% when unforeseen replan after FDP begun (700.50(1)(c))
 */
import type { DutyEvent, SplitDutyBreak } from './types'
import { getZonedTimeParts, zonedWallTimeOnDay } from './time'

const MIN_BREAK_MS = 60 * 60_000
const INERTIA_MS = 45 * 60_000
const H = 3_600_000

export interface SplitDutyExtensionInput {
  breakStart: Date
  breakEnd: Date
  /** Acclimatized TZ for night/day windows (700.50(4)). */
  acclTZ: string
  /** Force 50% credit (UOC replan). */
  unforeseenReplan?: boolean
}

export interface SplitDutyExtensionResult {
  ok: boolean
  error?: string
  breakHours: number
  /** max(0, break − 0.75 h) */
  netHours: number
  /** Portion of raw break in 00:00–05:59 accl. */
  nightHours: number
  /** Portion of raw break in 06:00–23:59 accl. */
  dayHours: number
  extensionHours: number
  creditRateLabel: string
}

/**
 * Minutes of [start, end) that fall in the acclimatized night window
 * 00:00–05:59 (i.e. before 06:00) on each civil day.
 */
export function nightMinutesInBreak(
  breakStart: Date,
  breakEnd: Date,
  acclTZ: string,
): number {
  if (breakEnd.getTime() <= breakStart.getTime()) return 0
  let nightMs = 0
  // Walk civil days covering the break (pad one day either side).
  for (let dayOffset = -1; dayOffset <= 40; dayOffset++) {
    const dayMidnight = zonedWallTimeOnDay(breakStart, acclTZ, 0, 0, dayOffset)
    const daySix = zonedWallTimeOnDay(breakStart, acclTZ, 6, 0, dayOffset)
    // Night window for this civil day is [00:00, 06:00)
    const w0 = Math.max(breakStart.getTime(), dayMidnight.getTime())
    const w1 = Math.min(breakEnd.getTime(), daySix.getTime())
    if (w1 > w0) nightMs += w1 - w0
    if (dayMidnight.getTime() > breakEnd.getTime() + 24 * H) break
  }
  return nightMs / 60_000
}

export function computeSplitDutyExtension(
  input: SplitDutyExtensionInput,
): SplitDutyExtensionResult {
  const { breakStart, breakEnd, acclTZ, unforeseenReplan } = input
  if (isNaN(breakStart.getTime()) || isNaN(breakEnd.getTime())) {
    return {
      ok: false,
      error: 'Invalid split-duty break times.',
      breakHours: 0,
      netHours: 0,
      nightHours: 0,
      dayHours: 0,
      extensionHours: 0,
      creditRateLabel: '—',
    }
  }
  const breakMs = breakEnd.getTime() - breakStart.getTime()
  if (breakMs < MIN_BREAK_MS) {
    return {
      ok: false,
      error:
        'Split-duty break must be at least 60 consecutive minutes in suitable accommodation (CAR 700.50).',
      breakHours: breakMs / H,
      netHours: 0,
      nightHours: 0,
      dayHours: 0,
      extensionHours: 0,
      creditRateLabel: '—',
    }
  }

  const breakHours = breakMs / H
  const nightMin = nightMinutesInBreak(breakStart, breakEnd, acclTZ)
  const totalMin = breakMs / 60_000
  const dayMin = Math.max(0, totalMin - nightMin)
  const nightHours = nightMin / 60
  const dayHours = dayMin / 60

  const netMs = Math.max(0, breakMs - INERTIA_MS)
  const netHours = netMs / H

  let extensionHours: number
  let creditRateLabel: string

  if (unforeseenReplan) {
    extensionHours = netHours * 0.5
    creditRateLabel = '50% (UOC replan)'
  } else if (totalMin <= 0) {
    extensionHours = 0
    creditRateLabel = '—'
  } else {
    // Prorate net break by fraction of raw break in night vs day windows
    const nightFrac = nightMin / totalMin
    const dayFrac = dayMin / totalMin
    extensionHours = netHours * (nightFrac * 1.0 + dayFrac * 0.5)
    if (nightFrac >= 0.999) creditRateLabel = '100% (00:00–05:59 accl)'
    else if (dayFrac >= 0.999) creditRateLabel = '50% (06:00–23:59 accl)'
    else {
      creditRateLabel = `prorated ${Math.round(nightFrac * 100)}% night / ${Math.round(dayFrac * 100)}% day`
    }
  }

  return {
    ok: true,
    breakHours,
    netHours,
    nightHours,
    dayHours,
    extensionHours,
    creditRateLabel,
  }
}

export function computeSplitDutyExtensionFromBreak(
  breakInfo: SplitDutyBreak,
  acclTZ: string,
): SplitDutyExtensionResult {
  return computeSplitDutyExtension({
    breakStart: breakInfo.start,
    breakEnd: breakInfo.end,
    acclTZ,
    unforeseenReplan: breakInfo.unforeseenReplan,
  })
}

export function splitBreakRestId(dutyId: string): string {
  return `${dutyId}-split`
}

export function isSplitBreakRest(e: {
  type?: string
  restKind?: string
  id?: string
}): boolean {
  if (e.type !== 'rest') return false
  if (e.restKind === 'split_break') return true
  if (e.id?.endsWith('-split')) return true
  return false
}

/** Build calendar rest bar for a mid-FDP split-duty break (not post-FDP rest). */
export function buildSplitBreakRestEvent(
  duty: DutyEvent,
  breakInfo?: SplitDutyBreak | null,
): DutyEvent | null {
  const br = breakInfo ?? duty.splitBreak
  if (!br) return null
  if (isNaN(br.start.getTime()) || isNaN(br.end.getTime())) return null
  if (br.end.getTime() <= br.start.getTime()) return null

  const accl = duty.acclTZ || 'UTC'
  const ext = computeSplitDutyExtensionFromBreak(br, accl)
  const hours = ((br.end.getTime() - br.start.getTime()) / H).toFixed(1)
  const extLabel = ext.ok
    ? ` · FDP +${ext.extensionHours.toFixed(2)} h (${ext.creditRateLabel})`
    : ''

  return {
    id: splitBreakRestId(duty.id),
    title: `Split-duty break (${hours} h)`,
    start: br.start,
    end: br.end,
    type: 'rest',
    restKind: 'split_break',
    restRule: 'CAR 700.50',
    locationIcao: br.locationIcao || duty.locationIcao,
    acclTZ: accl,
    workFactor: 0,
    requiredRestHours: br.end.getTime() - br.start.getTime() > 0
      ? (br.end.getTime() - br.start.getTime()) / H
      : undefined,
    ruleWhy: `CAR 700.50 / AC 700-047 §§4.49–4.50: mid-FDP break in suitable accommodation (≥60 min). Counts toward FDP but not hours of work. 45 min deducted before extension credit.${extLabel}`,
  }
}

/** Overlap of split break with [windowStart, windowEnd) in hours (for 700.29). */
export function splitBreakOverlapHours(
  duty: DutyEvent,
  windowStart: Date,
  windowEnd: Date,
): number {
  const br = duty.splitBreak
  if (!br) return 0
  const o0 = Math.max(
    br.start.getTime(),
    duty.start.getTime(),
    windowStart.getTime(),
  )
  const o1 = Math.min(br.end.getTime(), duty.end.getTime(), windowEnd.getTime())
  if (o1 <= o0) return 0
  return (o1 - o0) / H
}

/** Format break duration for UI. */
export function formatSplitBreakSummary(ext: SplitDutyExtensionResult): string {
  if (!ext.ok) return ext.error || 'Invalid break'
  return (
    `Break ${ext.breakHours.toFixed(2)} h · after −45 min: ${ext.netHours.toFixed(2)} h · ` +
    `credit ${ext.creditRateLabel} → +${ext.extensionHours.toFixed(2)} h max FDP`
  )
}

/** True when break lies fully inside [report, release]. */
export function splitBreakInsideFdp(
  breakStart: Date,
  breakEnd: Date,
  report: Date,
  release: Date,
): boolean {
  return (
    breakStart.getTime() >= report.getTime() - 500 &&
    breakEnd.getTime() <= release.getTime() + 500 &&
    breakEnd.getTime() > breakStart.getTime()
  )
}

/** Debug helper: acclimatized hour of instant. */
export function acclHourOf(date: Date, acclTZ: string): number {
  return getZonedTimeParts(date, acclTZ).hour
}
