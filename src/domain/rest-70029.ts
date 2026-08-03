/**
 * CAR 700.29 / AC 700-047 §§4.31–4.34 — Hours of work & time free from duty.
 *
 * Option C: ≤60 h / 168 h + ≥1 SDF in window; ≥4 SDF / 672 h; caps 192/28d, 2200/365d
 * Option D: ≤70 h / 168 h if 120 h free incl. 5 consecutive LNRs in 504 h (before exceeding 60),
 *           and no early/late/night, FDP≤12 h, ≤24 h work / 48 h
 *
 * Work factors (700.29(3)): duty/standby 100%, reserve 33%, free/rest 0%.
 */
import type { DutyEvent, Regulator, TimeFreeOption } from './types'
import { defaultWorkFactor, isWorkEvent } from './types'
import {
  isEarlyDuty,
  isLateDuty,
  isNightDuty,
} from './regulations'
import { earliestLocalNightsRestEnd } from './rest-70042'
import { splitBreakOverlapHours } from './rest-70050'
import { getZonedTimeParts, zonedWallTimeOnDay } from './time'

/** Typical post-duty clock rest used to probe “could another FDP fit?” */
const HYP_CLOCK_REST_H = 12
/** Typical FDP length for the probe duty after min rest. */
const HYP_FDP_H = 10

const H = 60 * 60 * 1000
const MS_48H = 48 * H
const MS_168H = 168 * H
const MS_504H = 504 * H
const MS_672H = 672 * H
const MS_365D = 365 * 24 * H

export const WORK_LIMIT_60_IN_168 = 60
export const WORK_LIMIT_70_IN_168 = 70
export const WORK_LIMIT_192_IN_672 = 192
export const WORK_LIMIT_2200_IN_365 = 2200
export const WORK_LIMIT_24_IN_48 = 24
export const SDF_REQUIRED_IN_168 = 1
export const SDF_REQUIRED_IN_672 = 4
export const OPTION_D_FREE_HOURS = 120
export const OPTION_D_LNR_COUNT = 5
export const OPTION_D_LOOKBACK_H = 504
export const OPTION_D_MAX_FDP_H = 12

export interface LocalNightInterval {
  start: Date
  end: Date
  windowKey: string
  acclTZ: string
}

export interface SingleDayFree {
  start: Date
  end: Date
  nights: [LocalNightInterval, LocalNightInterval]
  acclTZ: string
}

export interface FiveLnrBlock {
  start: Date
  end: Date
  freeStart: Date
  freeEnd: Date
  nights: LocalNightInterval[]
  acclTZ: string
}

export type C70029ViolationCode =
  | 'work_60_in_168'
  | 'work_70_in_168'
  | 'missing_sdf_in_168'
  | 'work_192_in_672'
  | 'missing_sdf_count_in_672'
  | 'work_2200_in_365'
  | 'option_d_not_eligible'
  | 'option_d_switch_too_late'
  | 'option_d_eln_assigned'
  | 'option_d_fdp_over_12'
  | 'option_d_work_24_in_48'

export interface C70029Violation {
  code: C70029ViolationCode
  windowStart: Date
  windowEnd: Date
  detail: string
  workHours?: number
  sdfCount?: number
}

export interface C70029Report {
  option: 'C' | 'D' | 'auto'
  resolvedOption: 'C' | 'D'
  optionReason: string
  lnrs: LocalNightInterval[]
  /** All detected SDFs (for compliance math). */
  sdfs: SingleDayFree[]
  /** SDFs to show on the calendar (load-bearing or required before next duty). */
  displaySdfs: DisplaySdf[]
  fiveLnrBlocks: FiveLnrBlock[]
  violations: C70029Violation[]
}

export interface FreeInterval {
  start: Date
  end: Date
  acclTZ: string
}

function eventAccl(e: DutyEvent, fallback: string): string {
  return e.acclTZ || fallback
}

function workFactorOf(e: DutyEvent): number {
  if (e.workFactor != null && Number.isFinite(e.workFactor)) return e.workFactor
  return defaultWorkFactor(e.type)
}

/** Weighted hours of work in [windowStart, windowEnd] (700.29). */
export function getWorkHoursInWindow(
  events: DutyEvent[],
  windowStart: Date,
  windowEnd: Date,
  excludeEventId?: string,
): number {
  if (windowEnd.getTime() <= windowStart.getTime()) return 0
  return events
    .filter(
      (e) =>
        isWorkEvent(e) &&
        e.id !== excludeEventId &&
        workFactorOf(e) > 0,
    )
    .reduce((total, e) => {
      const o0 = Math.max(e.start.getTime(), windowStart.getTime())
      const o1 = Math.min(e.end.getTime(), windowEnd.getTime())
      if (o1 <= o0) return total
      const factor = workFactorOf(e)
      let hours = ((o1 - o0) / H) * factor
      // CAR 700.50 / AC 700-047: split-duty break is not hours of work
      if (e.type === 'duty' && e.splitBreak) {
        hours -= splitBreakOverlapHours(e, windowStart, windowEnd) * factor
      }
      return total + Math.max(0, hours)
    }, 0)
}

export function findLocalNightsInGap(
  gapStart: Date,
  gapEnd: Date,
  acclTZ: string,
): LocalNightInterval[] {
  if (gapEnd.getTime() <= gapStart.getTime()) return []
  const out: LocalNightInterval[] = []
  for (let dayOffset = -1; dayOffset <= 45; dayOffset++) {
    const windowStart = zonedWallTimeOnDay(gapStart, acclTZ, 22, 30, dayOffset)
    const windowEnd = zonedWallTimeOnDay(windowStart, acclTZ, 9, 30, 1)
    if (windowEnd.getTime() <= gapStart.getTime()) continue
    if (windowStart.getTime() >= gapEnd.getTime()) break

    const sleepStart = Math.max(gapStart.getTime(), windowStart.getTime())
    const completeAt = sleepStart + 9 * H
    if (completeAt <= Math.min(gapEnd.getTime(), windowEnd.getTime()) + 500) {
      const parts = getZonedTimeParts(windowStart, acclTZ)
      out.push({
        start: new Date(sleepStart),
        end: new Date(completeAt),
        windowKey: parts.dayKey,
        acclTZ,
      })
    }
  }
  const seen = new Set<string>()
  return out.filter((n) => {
    const k = `${n.acclTZ}|${n.windowKey}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** Work events that break free time (duty, reserve, standby). */
export function workEventsSorted(events: DutyEvent[]): DutyEvent[] {
  return events
    .filter((e) => isWorkEvent(e))
    .sort((a, b) => a.start.getTime() - b.start.getTime())
}

/**
 * Free intervals: gaps between work events + explicit `free` events (merged).
 * Also includes completed free time after the last work event through "now"
 * (so a free weekend after the latest FDP can form LNRs/SDFs).
 */
export function buildFreeIntervals(
  events: DutyEvent[],
  globalAcclTZ: string,
  now: Date = new Date(),
): FreeInterval[] {
  const work = workEventsSorted(events)
  const intervals: FreeInterval[] = []

  for (let i = 0; i < work.length - 1; i++) {
    const prev = work[i]
    const next = work[i + 1]
    if (next.start.getTime() <= prev.end.getTime()) continue
    intervals.push({
      start: prev.end,
      end: next.start,
      acclTZ: eventAccl(prev, globalAcclTZ),
    })
  }

  // Trailing free after last work: only if the last work is recent (within 30 days
  // of "now"), so historical pairings do not invent weeks of free time after the
  // last sector of an old trip.
  if (work.length > 0) {
    const last = work[work.length - 1]
    const ageMs = now.getTime() - last.end.getTime()
    if (ageMs > 0 && ageMs <= 30 * 24 * H) {
      intervals.push({
        start: last.end,
        end: now,
        acclTZ: eventAccl(last, globalAcclTZ),
      })
    }
  }

  for (const e of events) {
    if (e.type !== 'free') continue
    if (e.end.getTime() <= e.start.getTime()) continue
    intervals.push({
      start: e.start,
      end: e.end,
      acclTZ: eventAccl(e, globalAcclTZ),
    })
  }

  // Merge overlapping intervals (same TZ preferred; merge regardless for LNR scan)
  intervals.sort((a, b) => a.start.getTime() - b.start.getTime())
  const merged: FreeInterval[] = []
  for (const iv of intervals) {
    const last = merged[merged.length - 1]
    if (last && iv.start.getTime() <= last.end.getTime()) {
      if (iv.end.getTime() > last.end.getTime()) last.end = iv.end
    } else {
      merged.push({ ...iv })
    }
  }
  return merged
}

/**
 * Span of work activity inside a window (first work start → last work end), hours.
 * Used so short / sparse schedules do not trigger full SDF structure checks.
 */
export function workActivitySpanHours(
  events: DutyEvent[],
  windowStart: Date,
  windowEnd: Date,
): number {
  let first = Infinity
  let last = -Infinity
  for (const e of events) {
    if (!isWorkEvent(e)) continue
    if (e.end.getTime() <= windowStart.getTime()) continue
    if (e.start.getTime() >= windowEnd.getTime()) continue
    first = Math.min(first, e.start.getTime())
    last = Math.max(last, e.end.getTime())
  }
  if (!Number.isFinite(first) || !Number.isFinite(last) || last <= first) return 0
  return (last - first) / H
}

/**
 * Whether work intensity is high enough that SDF structure is in scope for a
 * 168 h lookback (not necessarily flag yet — see canStillCompleteSdfBeforeDeadline).
 *
 * Gate: meaningful work (≥24 h) and activity spanning ≥4 days, or ≥40 h work.
 */
export function shouldRequireSdfIn168(
  workHours: number,
  activitySpanHours: number,
): boolean {
  if (workHours < 24 - 1e-9) return false
  if (workHours >= 40 - 1e-9) return true
  return activitySpanHours >= 96 - 1e-9
}

/** First work-event start among events that overlap [windowStart, windowEnd]. */
export function firstWorkStartInWindow(
  events: DutyEvent[],
  windowStart: Date,
  windowEnd: Date,
): Date | null {
  let first: number | null = null
  for (const e of events) {
    if (!isWorkEvent(e)) continue
    if (e.end.getTime() <= windowStart.getTime()) continue
    if (e.start.getTime() >= windowEnd.getTime()) continue
    const startMs = e.start.getTime()
    if (first == null || startMs < first) first = startMs
  }
  return first != null ? new Date(first) : null
}

/**
 * True if one SDF (2 local nights) can still be completed after `after`
 * and finish at or before `firstWorkStart + 168 h`.
 *
 * Matches the pilot model: under 60 h work, free days may still be taken
 * after the last FDP before the rolling week that began with the first
 * duty runs out — do not flag missing SDF while that remains possible.
 */
export function canStillCompleteSdfBeforeDeadline(
  after: Date,
  firstWorkStart: Date,
  acclTZ: string,
): boolean {
  const deadline = new Date(firstWorkStart.getTime() + MS_168H)
  if (after.getTime() >= deadline.getTime()) return false
  const complete = earliestLocalNightsRestEnd(after, acclTZ, 2)
  return complete.getTime() <= deadline.getTime() + 60_000
}

/**
 * Soft-flag missing SDF only when structure is due AND there is no longer
 * room after `windowEnd` to finish two local nights before first-work + 168 h.
 *
 * Do **not** flag merely for sitting at 48–60 h work if a free double-night
 * can still be completed after the last FDP (pilot can still take the free day
 * later in the same rolling week). Hour-cap breaches (>60 h) are handled
 * separately as work_60_in_168 / Option D.
 */
export function shouldFlagMissingSdfIn168(opts: {
  workHours: number
  activitySpanHours: number
  sdfCount: number
  windowEnd: Date
  firstWorkStart: Date | null
  acclTZ: string
}): boolean {
  if (opts.sdfCount >= SDF_REQUIRED_IN_168) return false
  if (!shouldRequireSdfIn168(opts.workHours, opts.activitySpanHours)) {
    return false
  }
  if (!opts.firstWorkStart) {
    // No anchor for deadline — only flag if already over the hour cap
    return opts.workHours > WORK_LIMIT_60_IN_168 + 1e-9
  }
  // Still time after this point to complete 2 LNRs before first+168h → no flag
  if (
    canStillCompleteSdfBeforeDeadline(
      opts.windowEnd,
      opts.firstWorkStart,
      opts.acclTZ,
    )
  ) {
    return false
  }
  return true
}

/**
 * Earliest plausible next FDP after a release (12 h clock rest, prefer ~07:00
 * report). Used like “required rest”: show free-day need even when no next duty
 * is on the calendar yet, if *adding* that FDP would leave no room for an SDF.
 */
export function earliestHypotheticalNextFdp(
  dutyEnd: Date,
  acclTZ: string,
): { start: Date; end: Date } {
  const afterClock = new Date(dutyEnd.getTime() + HYP_CLOCK_REST_H * H)
  // Next local 07:00 on/after the calendar day after release (or later if clock rest wins)
  let start = afterClock
  for (let dayOffset = 0; dayOffset <= 4; dayOffset++) {
    const morning = zonedWallTimeOnDay(dutyEnd, acclTZ, 7, 0, dayOffset)
    if (morning.getTime() + 500 < afterClock.getTime()) continue
    start = morning
    break
  }
  if (afterClock.getTime() > start.getTime()) start = afterClock
  return {
    start,
    end: new Date(start.getTime() + HYP_FDP_H * H),
  }
}

/**
 * Free day is **absolutely required** when continuing without one is no longer
 * legal — same spirit as required rest bars (shown even if no next duty is
 * scheduled yet).
 *
 * Required when free day cannot wait until after the next FDP (scheduled, or a
 * hypothetical next-morning duty if none is scheduled). That includes a long
 * gap before a later duty: free day must still sit in that gap (and the rest
 * bar marks it) so duty cannot be placed inside the free-day window.
 *
 * Not required when free day can still complete *after* that next FDP (another
 * consecutive day can still be flown first under 60 h).
 */
export function isSdfAbsolutelyRequired(opts: {
  dutyEnd: Date
  nextDutyStart?: Date | null
  nextDutyEnd?: Date | null
  scheduleEvents: DutyEvent[]
  acclTZ: string
}): boolean {
  const { dutyEnd, acclTZ, scheduleEvents } = opts
  const w0 = new Date(dutyEnd.getTime() - MS_168H)
  const first = firstWorkStartInWindow(scheduleEvents, w0, dutyEnd)
  if (!first) return false

  // Week already closed after this release
  if (!canStillCompleteSdfBeforeDeadline(dutyEnd, first, acclTZ)) {
    return true
  }

  // Probe next: scheduled next duty, or earliest plausible FDP if none yet
  const realNextStart = opts.nextDutyStart
  const realNextEnd = opts.nextDutyEnd
  const probe =
    realNextStart && realNextEnd
      ? { start: realNextStart, end: realNextEnd }
      : earliestHypotheticalNextFdp(dutyEnd, acclTZ)

  // Free day can still finish after that next FDP → defer (mid-pairing OK)
  const w0n = new Date(probe.end.getTime() - MS_168H)
  const firstN = firstWorkStartInWindow(scheduleEvents, w0n, probe.end) ?? first
  if (canStillCompleteSdfBeforeDeadline(probe.end, firstN, acclTZ)) {
    return false
  }

  // Next duty (real or hypothetical) leaves no room for free day afterward →
  // free day is required after this release (in the gap, or as blocked rest).
  return true
}

/**
 * Whether to require 4 SDFs inside a 672 h (28 d) window.
 * Only once the pilot has been active long enough for a 28-day structure
 * to be meaningful (activity span ≥21 days or work ≥80 h).
 */
export function shouldRequireSdfCountIn672(
  workHours: number,
  activitySpanHours: number,
): boolean {
  if (workHours < 1e-6) return false
  if (activitySpanHours >= 21 * 24 - 1e-9) return true
  if (workHours >= 80 - 1e-9 && activitySpanHours >= 14 * 24 - 1e-9) return true
  return false
}

export function detectLocalNightsFromEvents(
  events: DutyEvent[],
  globalAcclTZ: string,
): LocalNightInterval[] {
  const free = buildFreeIntervals(events, globalAcclTZ)
  const all: LocalNightInterval[] = []
  for (const iv of free) {
    all.push(...findLocalNightsInGap(iv.start, iv.end, iv.acclTZ || globalAcclTZ))
  }
  all.sort((a, b) => a.start.getTime() - b.start.getTime())
  const seen = new Set<string>()
  return all.filter((n) => {
    const k = `${n.acclTZ}|${n.windowKey}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** @deprecated Prefer detectLocalNightsFromEvents */
export function detectLocalNightsFromDuties(
  duties: DutyEvent[],
  globalAcclTZ: string,
): LocalNightInterval[] {
  return detectLocalNightsFromEvents(duties, globalAcclTZ)
}

export function areConsecutiveLocalNights(
  a: LocalNightInterval,
  b: LocalNightInterval,
): boolean {
  if (a.acclTZ !== b.acclTZ) return false
  const [y1, m1, d1] = a.windowKey.split('-').map(Number)
  const [y2, m2, d2] = b.windowKey.split('-').map(Number)
  if (![y1, m1, d1, y2, m2, d2].every(Number.isFinite)) return false
  const t1 = Date.UTC(y1, m1 - 1, d1)
  const t2 = Date.UTC(y2, m2 - 1, d2)
  return Math.round((t2 - t1) / (24 * H)) === 1
}

function workIntersects(
  events: DutyEvent[],
  rangeStart: Date,
  rangeEnd: Date,
): boolean {
  return events.some(
    (d) =>
      isWorkEvent(d) &&
      d.start.getTime() < rangeEnd.getTime() &&
      d.end.getTime() > rangeStart.getTime(),
  )
}

export function buildSingleDaysFree(
  lnrs: LocalNightInterval[],
  events: DutyEvent[],
): SingleDayFree[] {
  const sorted = [...lnrs].sort((a, b) => a.start.getTime() - b.start.getTime())
  const sdfs: SingleDayFree[] = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]
    const b = sorted[i + 1]
    if (!areConsecutiveLocalNights(a, b)) continue
    if (workIntersects(events, a.start, b.end)) continue
    sdfs.push({
      start: a.start,
      end: b.end,
      nights: [a, b],
      acclTZ: a.acclTZ,
    })
  }
  return sdfs
}

/**
 * Runs of N consecutive LNRs with no work between first start and last end.
 */
export function findConsecutiveLnrRuns(
  lnrs: LocalNightInterval[],
  events: DutyEvent[],
  n: number,
): LocalNightInterval[][] {
  if (n <= 0) return []
  const sorted = [...lnrs].sort((a, b) => a.start.getTime() - b.start.getTime())
  const runs: LocalNightInterval[][] = []
  for (let i = 0; i <= sorted.length - n; i++) {
    const slice = sorted.slice(i, i + n)
    let ok = true
    for (let j = 1; j < slice.length; j++) {
      if (!areConsecutiveLocalNights(slice[j - 1], slice[j])) {
        ok = false
        break
      }
    }
    if (!ok) continue
    if (workIntersects(events, slice[0].start, slice[n - 1].end)) continue
    runs.push(slice)
  }
  return runs
}

/**
 * 120 h free blocks that contain 5 consecutive LNRs (Option D prerequisite).
 */
export function findFiveLnrBlocks(
  events: DutyEvent[],
  lnrs: LocalNightInterval[],
  globalAcclTZ: string,
): FiveLnrBlock[] {
  const free = buildFreeIntervals(events, globalAcclTZ)
  const runs = findConsecutiveLnrRuns(lnrs, events, OPTION_D_LNR_COUNT)
  const blocks: FiveLnrBlock[] = []

  for (const nights of runs) {
    const lnrStart = nights[0].start
    const lnrEnd = nights[nights.length - 1].end
    // Find a free interval containing the full 5-LNR span with ≥120 h free
    for (const iv of free) {
      if (iv.start.getTime() > lnrStart.getTime()) continue
      if (iv.end.getTime() < lnrEnd.getTime()) continue
      const freeHours = (iv.end.getTime() - iv.start.getTime()) / H
      if (freeHours + 1e-9 < OPTION_D_FREE_HOURS) continue
      // Prefer free span that is ≥120 h; block ends when 5 LNRs complete
      blocks.push({
        start: lnrStart,
        end: lnrEnd,
        freeStart: iv.start,
        freeEnd: iv.end,
        nights,
        acclTZ: nights[0].acclTZ,
      })
      break
    }
  }
  return blocks
}

/** True if a 5-LNR/120h block completed at or before `at`, within 504 h lookback. */
export function isOptionDEligibleAt(
  blocks: FiveLnrBlock[],
  at: Date,
): FiveLnrBlock | null {
  const lookbackStart = new Date(at.getTime() - MS_504H)
  for (const b of blocks) {
    // Block must complete before or at `at` (switch before exceeding 60 h)
    if (b.end.getTime() > at.getTime()) continue
    // Free stretch / block should sit inside the 504 h preceding `at`
    if (b.freeStart.getTime() < lookbackStart.getTime()) continue
    if (b.end.getTime() < lookbackStart.getTime()) continue
    const freeH = (b.freeEnd.getTime() - b.freeStart.getTime()) / H
    if (freeH + 1e-9 < OPTION_D_FREE_HOURS) continue
    return b
  }
  return null
}

/**
 * First work-event end at or before `upTo` where rolling 168 h work hours exceed 60.
 * Used for CAR 700.29(2): Option D free block must be complete before this moment.
 */
export function firstInstantWorkExceeds60(
  events: DutyEvent[],
  upTo: Date,
): Date | null {
  const ends = events
    .filter((e) => isWorkEvent(e) && e.end.getTime() <= upTo.getTime())
    .map((e) => e.end)
    .sort((a, b) => a.getTime() - b.getTime())
  const seen = new Set<number>()
  for (const end of ends) {
    const key = end.getTime()
    if (seen.has(key)) continue
    seen.add(key)
    const w0 = new Date(end.getTime() - MS_168H)
    const hours = getWorkHoursInWindow(events, w0, end)
    if (hours > WORK_LIMIT_60_IN_168 + 1e-9) return end
  }
  return null
}

/**
 * Whether a 5-LNR block completed early enough for a valid C→D switch at `upTo`.
 * Block must end at or before the first moment rolling 168 h work exceeded 60 h
 * (or before `upTo` if work has never exceeded 60 yet).
 */
export function optionDSwitchIsTimely(
  blocks: FiveLnrBlock[],
  events: DutyEvent[],
  upTo: Date,
): { ok: boolean; firstOver60: Date | null; block: FiveLnrBlock | null } {
  const firstOver60 = firstInstantWorkExceeds60(events, upTo)
  const deadline = firstOver60 ?? upTo
  const block = isOptionDEligibleAt(blocks, deadline)
  if (!firstOver60) {
    // Never exceeded 60 h yet — D not required for hours, but if a block exists it's fine
    return {
      ok: true,
      firstOver60: null,
      block: isOptionDEligibleAt(blocks, upTo),
    }
  }
  return { ok: !!block, firstOver60, block }
}

export function countSdfsInWindow(
  sdfs: SingleDayFree[],
  windowStart: Date,
  windowEnd: Date,
): number {
  return sdfs.filter(
    (s) =>
      s.start.getTime() >= windowStart.getTime() &&
      s.end.getTime() <= windowEnd.getTime(),
  ).length
}

function sdfKey(s: SingleDayFree): string {
  return `${s.start.getTime()}|${s.end.getTime()}|${s.acclTZ}`
}

function sdfFullyInWindow(
  s: SingleDayFree,
  windowStart: Date,
  windowEnd: Date,
): boolean {
  return (
    s.start.getTime() >= windowStart.getTime() &&
    s.end.getTime() <= windowEnd.getTime()
  )
}

export type DisplaySdfReason =
  | 'load_bearing'
  | 'required_before_next'
  /** Planned free-day slot after last work — not yet achieved free time. */
  | 'prospective'

export interface DisplaySdf {
  sdf: SingleDayFree
  reasons: DisplaySdfReason[]
}

/**
 * Earliest single day free from duty that can start after `after` (two consecutive
 * local nights in an open gap). Used for calendar foreshadowing when structure is
 * due but no free day has been completed yet.
 */
export function earliestPossibleSdfAfter(
  after: Date,
  acclTZ: string,
): SingleDayFree | null {
  const gapEnd = new Date(after.getTime() + 6 * 24 * H)
  const nights = findLocalNightsInGap(after, gapEnd, acclTZ)
  for (let i = 0; i < nights.length - 1; i++) {
    const a = nights[i]
    const b = nights[i + 1]
    if (!areConsecutiveLocalNights(a, b)) continue
    return {
      start: a.start,
      end: b.end,
      nights: [a, b],
      acclTZ,
    }
  }
  return null
}

/**
 * SDFs to show on the calendar (subset of all detected free double-nights, plus
 * prospective slots when a free day is due but not yet taken).
 *
 * 1. **load_bearing** — without this SDF, a 168 h / 672 h window that already
 *    needs free-time structure would fail (removing it would cause a violation).
 * 2. **required_before_next** — after the latest work, work intensity already
 *    warrants an SDF before further duty; show the earliest trailing / in-window
 *    completed SDF (not every free night pair for weeks).
 * 3. **prospective** — same situation, but no completed free day covers the
 *    current window yet; show where the next two local nights should fall so the
 *    pilot sees the requirement *before* adding another FDP that closes the window.
 */
export function selectDisplaySdfs(
  events: DutyEvent[],
  sdfs: SingleDayFree[],
  globalAcclTZ: string,
): DisplaySdf[] {
  const byKey = new Map<string, DisplaySdf>()
  const add = (sdf: SingleDayFree, reason: DisplaySdfReason) => {
    const k = sdfKey(sdf)
    const existing = byKey.get(k)
    if (existing) {
      if (!existing.reasons.includes(reason)) existing.reasons.push(reason)
    } else {
      byKey.set(k, { sdf, reasons: [reason] })
    }
  }

  const workEnds = workEventsSorted(events).map((e) => e.end)

  // --- (1) Load-bearing for 168 h / 672 h ---
  for (const sdf of sdfs) {
    let loadBearing = false
    for (const t of workEnds) {
      const w168Start = new Date(t.getTime() - MS_168H)
      if (!sdfFullyInWindow(sdf, w168Start, t)) continue
      const workH = getWorkHoursInWindow(events, w168Start, t)
      const span = workActivitySpanHours(events, w168Start, t)
      if (!shouldRequireSdfIn168(workH, span)) continue
      const others = sdfs.filter(
        (o) =>
          sdfKey(o) !== sdfKey(sdf) && sdfFullyInWindow(o, w168Start, t),
      )
      if (others.length < SDF_REQUIRED_IN_168) {
        loadBearing = true
        break
      }
    }
    if (!loadBearing) {
      for (const t of workEnds) {
        const w672Start = new Date(t.getTime() - MS_672H)
        if (!sdfFullyInWindow(sdf, w672Start, t)) continue
        const workH = getWorkHoursInWindow(events, w672Start, t)
        const span = workActivitySpanHours(events, w672Start, t)
        if (!shouldRequireSdfCountIn672(workH, span)) continue
        const others = sdfs.filter(
          (o) =>
            sdfKey(o) !== sdfKey(sdf) && sdfFullyInWindow(o, w672Start, t),
        )
        if (others.length < SDF_REQUIRED_IN_672) {
          loadBearing = true
          break
        }
      }
    }
    if (loadBearing) add(sdf, 'load_bearing')
  }

  // --- (2) Free day only when absolutely required (after last work) ---
  const work = workEventsSorted(events)
  if (work.length > 0) {
    const last = work[work.length - 1]
    const nextWork = work.find((w) => w.start.getTime() > last.end.getTime())
    const accl = eventAccl(last, globalAcclTZ)
    const w168Start = new Date(last.end.getTime() - MS_168H)
    const work168 = getWorkHoursInWindow(events, w168Start, last.end)
    const span168 = workActivitySpanHours(events, w168Start, last.end)
    const covering = countSdfsInWindow(sdfs, w168Start, last.end)

    const absolute =
      shouldRequireSdfIn168(work168, span168) &&
      covering < SDF_REQUIRED_IN_168 &&
      isSdfAbsolutelyRequired({
        dutyEnd: last.end,
        nextDutyStart: nextWork?.start,
        nextDutyEnd: nextWork?.end,
        scheduleEvents: events,
        acclTZ: accl,
      })

    if (absolute) {
      const trailing = sdfs
        .filter((s) => s.start.getTime() >= last.end.getTime() - H)
        .sort((a, b) => a.start.getTime() - b.start.getTime())
      if (trailing[0]) add(trailing[0], 'required_before_next')

      const hasPostWorkDisplay = [...byKey.values()].some(
        (d) =>
          d.sdf.start.getTime() >= last.end.getTime() - H &&
          (d.reasons.includes('required_before_next') ||
            d.reasons.includes('prospective')),
      )
      if (!hasPostWorkDisplay) {
        const prospective = earliestPossibleSdfAfter(last.end, accl)
        if (prospective) add(prospective, 'prospective')
      }
    }
  }

  return [...byKey.values()].sort(
    (a, b) => a.sdf.start.getTime() - b.sdf.start.getTime(),
  )
}

function pushUnique(list: C70029Violation[], v: C70029Violation): void {
  const key = `${v.code}|${v.windowEnd.getTime()}|${v.windowStart.getTime()}`
  if (list.some((x) => `${x.code}|${x.windowEnd.getTime()}|${x.windowStart.getTime()}` === key))
    return
  list.push(v)
}

function fdpHours(e: DutyEvent): number {
  return (e.end.getTime() - e.start.getTime()) / H
}

function isElnWorkEvent(
  e: DutyEvent,
  regulator: Regulator,
  globalAcclTZ: string,
): boolean {
  if (!isWorkEvent(e)) return false
  const tz = eventAccl(e, globalAcclTZ)
  if (isEarlyDuty(e.start, regulator, tz)) return true
  if (isLateDuty(e.end, regulator, tz)) return true
  if (e.type === 'duty' && isNightDuty(e.start, e.end, regulator, tz)) return true
  // Reserve/standby: early/late by start/end; night only for multi-day span
  if (
    (e.type === 'reserve' || e.type === 'standby') &&
    isNightDuty(e.start, e.end, regulator, tz)
  ) {
    return true
  }
  return false
}

function checkOptionDConstraints(
  events: DutyEvent[],
  windowStart: Date,
  windowEnd: Date,
  regulator: Regulator,
  globalAcclTZ: string,
  violations: C70029Violation[],
): void {
  const inWindow = events.filter(
    (e) =>
      isWorkEvent(e) &&
      e.start.getTime() < windowEnd.getTime() &&
      e.end.getTime() > windowStart.getTime(),
  )
  for (const e of inWindow) {
    if (isElnWorkEvent(e, regulator, globalAcclTZ)) {
      pushUnique(violations, {
        code: 'option_d_eln_assigned',
        windowStart,
        windowEnd,
        detail: `Option D (70 h) does not allow early, late, or night duty in the high-hour period; assignment ${e.title || e.type} from ${e.start.toLocaleString()} conflicts (CAR 700.29(1)(d)).`,
      })
    }
    if (e.type === 'duty' && fdpHours(e) > OPTION_D_MAX_FDP_H + 1e-9) {
      pushUnique(violations, {
        code: 'option_d_fdp_over_12',
        windowStart,
        windowEnd,
        detail: `Option D requires flight duty periods ≤ 12 h; this FDP is ${fdpHours(e).toFixed(1)} h (CAR 700.29(1)(d)).`,
      })
    }
  }
  // ≤24 h work in any 48 h overlapping this window — check at duty ends inside window
  for (const e of inWindow) {
    const t = e.end
    if (t.getTime() < windowStart.getTime() || t.getTime() > windowEnd.getTime())
      continue
    const w0 = new Date(t.getTime() - MS_48H)
    const w48 = getWorkHoursInWindow(events, w0, t)
    if (w48 > WORK_LIMIT_24_IN_48 + 1e-9) {
      pushUnique(violations, {
        code: 'option_d_work_24_in_48',
        windowStart: w0,
        windowEnd: t,
        workHours: w48,
        detail: `Option D limits hours of work to 24 h in any 48 consecutive hours; found ${w48.toFixed(1)} h ending ${t.toLocaleString()} (CAR 700.29(1)(d)).`,
      })
    }
  }
}

function defaultAnchors(
  events: DutyEvent[],
  sdfs: SingleDayFree[],
  blocks: FiveLnrBlock[],
): Date[] {
  const points: Date[] = []
  for (const d of events) {
    if (isWorkEvent(d)) points.push(d.end)
  }
  for (const s of sdfs) points.push(s.end)
  for (const b of blocks) points.push(b.end)
  const seen = new Set<number>()
  return points.filter((p) => {
    const t = p.getTime()
    if (seen.has(t)) return false
    seen.add(t)
    return true
  })
}

/**
 * Full 700.29 report (Option C / D / auto).
 */
export function evaluate70029(
  events: DutyEvent[],
  globalAcclTZ: string,
  regulator: Regulator = 'TC',
  timeFreeOption: TimeFreeOption = 'auto',
): C70029Report {
  if (regulator !== 'TC') {
    return {
      option: timeFreeOption === 'D' ? 'D' : 'C',
      resolvedOption: 'C',
      optionReason: 'Non-TC regulator — 700.29 not applied.',
      lnrs: [],
      sdfs: [],
      displaySdfs: [],
      fiveLnrBlocks: [],
      violations: [],
    }
  }

  const lnrs = detectLocalNightsFromEvents(events, globalAcclTZ)
  const sdfs = buildSingleDaysFree(lnrs, events)
  const displaySdfs = selectDisplaySdfs(events, sdfs, globalAcclTZ)
  const fiveLnrBlocks = findFiveLnrBlocks(events, lnrs, globalAcclTZ)
  const anchors = defaultAnchors(events, sdfs, fiveLnrBlocks)
  const violations: C70029Violation[] = []

  let resolvedOption: 'C' | 'D' = timeFreeOption === 'D' ? 'D' : 'C'
  let optionReason =
    timeFreeOption === 'D'
      ? 'Settings force Option D (70 h) when eligible.'
      : timeFreeOption === 'C'
        ? 'Settings force Option C (60 h + single days free).'
        : 'Auto: use Option D only when 60 h is exceeded and prerequisites are met.'

  // Shared caps
  for (const t of anchors) {
    if (isNaN(t.getTime())) continue
    const w672Start = new Date(t.getTime() - MS_672H)
    const work672 = getWorkHoursInWindow(events, w672Start, t)
    const sdf672 = countSdfsInWindow(sdfs, w672Start, t)
    if (work672 > WORK_LIMIT_192_IN_672 + 1e-9) {
      pushUnique(violations, {
        code: 'work_192_in_672',
        windowStart: w672Start,
        windowEnd: t,
        workHours: work672,
        sdfCount: sdf672,
        detail: `Hours of work ${work672.toFixed(1)} h exceed 192 h in 672 consecutive hours ending ${t.toLocaleString()} (CAR 700.29(1)(b)).`,
      })
    }
    const span672 = workActivitySpanHours(events, w672Start, t)
    if (
      shouldRequireSdfCountIn672(work672, span672) &&
      sdf672 < SDF_REQUIRED_IN_672 &&
      timeFreeOption !== 'D'
    ) {
      pushUnique(violations, {
        code: 'missing_sdf_count_in_672',
        windowStart: w672Start,
        windowEnd: t,
        workHours: work672,
        sdfCount: sdf672,
        detail: `Only ${sdf672} single day(s) free from duty in 672 h ending ${t.toLocaleString()}; need 4 (CAR 700.29(1)(c)(ii)). Work activity spans ${span672.toFixed(0)} h in this window.`,
      })
    }

    const w365Start = new Date(t.getTime() - MS_365D)
    const work365 = getWorkHoursInWindow(events, w365Start, t)
    if (work365 > WORK_LIMIT_2200_IN_365 + 1e-9) {
      pushUnique(violations, {
        code: 'work_2200_in_365',
        windowStart: w365Start,
        windowEnd: t,
        workHours: work365,
        detail: `Hours of work ${work365.toFixed(1)} h exceed 2,200 h in 365 days ending ${t.toLocaleString()} (CAR 700.29(1)(a)).`,
      })
    }
  }

  for (const t of anchors) {
    if (isNaN(t.getTime())) continue
    const w168Start = new Date(t.getTime() - MS_168H)
    const work168 = getWorkHoursInWindow(events, w168Start, t)
    const sdf168 = countSdfsInWindow(sdfs, w168Start, t)
    // 700.29(2): free block must be complete by the first moment rolling work > 60 h
    const switchCheck = optionDSwitchIsTimely(fiveLnrBlocks, events, t)
    const eligibleBlock = switchCheck.block
    const timelyEligible =
      !!eligibleBlock &&
      (!switchCheck.firstOver60 || switchCheck.ok)

    // Auto: D only when work > 60 and a timely 5-LNR block exists.
    // Forced D: always on the D evaluation path for this window.
    const useD =
      timeFreeOption === 'D' ||
      (timeFreeOption === 'auto' &&
        work168 > WORK_LIMIT_60_IN_168 + 1e-9 &&
        timelyEligible)

    if (useD) resolvedOption = 'D'

    if (timeFreeOption === 'C' || (timeFreeOption === 'auto' && !useD)) {
      // Option C rules for this window
      if (work168 > WORK_LIMIT_60_IN_168 + 1e-9) {
        if (timeFreeOption === 'auto' && !timelyEligible) {
          // Late block that only finishes after first >60 h moment
          const lateBlock =
            switchCheck.firstOver60 &&
            fiveLnrBlocks.some(
              (b) =>
                b.end.getTime() > switchCheck.firstOver60!.getTime() &&
                b.end.getTime() <= t.getTime(),
            )
          if (lateBlock) {
            pushUnique(violations, {
              code: 'option_d_switch_too_late',
              windowStart: w168Start,
              windowEnd: t,
              workHours: work168,
              detail: `The 120 h free / 5 consecutive local nights’ rest block completed only after hours of work had already exceeded 60 h (first exceedance at ${switchCheck.firstOver60!.toLocaleString()}). CAR 700.29(2) requires that block before exceeding Option C limits.`,
            })
          } else {
            pushUnique(violations, {
              code: 'option_d_not_eligible',
              windowStart: w168Start,
              windowEnd: t,
              workHours: work168,
              detail: `Hours of work ${work168.toFixed(1)} h exceed 60 h in 168 h ending ${t.toLocaleString()}, but Option D is not available (need 120 consecutive hours free including 5 consecutive local nights’ rests within 504 h, completed before exceeding 60 h) (CAR 700.29(1)(d)/(2)).`,
            })
          }
        } else {
          pushUnique(violations, {
            code: 'work_60_in_168',
            windowStart: w168Start,
            windowEnd: t,
            workHours: work168,
            sdfCount: sdf168,
            detail: `Hours of work ${work168.toFixed(1)} h exceed 60 h in 168 h ending ${t.toLocaleString()} (CAR 700.29(1)(c)).`,
          })
        }
      }
      const span168 = workActivitySpanHours(events, w168Start, t)
      const firstWork = firstWorkStartInWindow(events, w168Start, t)
      if (
        shouldFlagMissingSdfIn168({
          workHours: work168,
          activitySpanHours: span168,
          sdfCount: sdf168,
          windowEnd: t,
          firstWorkStart: firstWork,
          acclTZ: globalAcclTZ,
        })
      ) {
        pushUnique(violations, {
          code: 'missing_sdf_in_168',
          windowStart: w168Start,
          windowEnd: t,
          workHours: work168,
          sdfCount: sdf168,
          detail: `No single day free from duty can still be completed after ${t.toLocaleString()} before the 168 h period that began with the first duty in this window runs out (${work168.toFixed(1)} h work over ${span168.toFixed(0)} h of activity) (CAR 700.29(1)(c)(i)).`,
        })
      }
    } else {
      // Option D path for this window (forced D, or auto with timely eligibility)
      if (work168 > WORK_LIMIT_60_IN_168 + 1e-9 && !timelyEligible) {
        const lateBlock =
          switchCheck.firstOver60 &&
          fiveLnrBlocks.some(
            (b) =>
              b.end.getTime() > switchCheck.firstOver60!.getTime() &&
              b.end.getTime() <= t.getTime(),
          )
        if (lateBlock) {
          pushUnique(violations, {
            code: 'option_d_switch_too_late',
            windowStart: w168Start,
            windowEnd: t,
            workHours: work168,
            detail: `Option D cannot apply: the 5 consecutive local nights’ rest / 120 h free block finished after work had already exceeded 60 h (first exceedance ${switchCheck.firstOver60!.toLocaleString()}) (CAR 700.29(2)).`,
          })
        } else {
          pushUnique(violations, {
            code: 'option_d_not_eligible',
            windowStart: w168Start,
            windowEnd: t,
            workHours: work168,
            detail: `Option D required for ${work168.toFixed(1)} h work in 168 h, but 120 h free with 5 consecutive LNRs was not completed before exceeding 60 h (CAR 700.29(1)(d)/(2)).`,
          })
        }
      }
      if (work168 > WORK_LIMIT_70_IN_168 + 1e-9) {
        pushUnique(violations, {
          code: 'work_70_in_168',
          windowStart: w168Start,
          windowEnd: t,
          workHours: work168,
          detail: `Hours of work ${work168.toFixed(1)} h exceed 70 h in 168 h ending ${t.toLocaleString()} (CAR 700.29(1)(d)).`,
        })
      }
      // Always apply D operational constraints while on the D path (even if work ≤ 60),
      // so forced-D schedules with early/late/night or long FDPs are still flagged.
      checkOptionDConstraints(
        events,
        w168Start,
        t,
        regulator,
        globalAcclTZ,
        violations,
      )
    }
  }

  if (resolvedOption === 'D' && fiveLnrBlocks.length) {
    optionReason =
      timeFreeOption === 'auto'
        ? 'Auto selected Option D: 120 h free with 5 consecutive LNRs available.'
        : optionReason
  }

  return {
    option: timeFreeOption,
    resolvedOption,
    optionReason,
    lnrs,
    sdfs,
    displaySdfs,
    fiveLnrBlocks,
    violations,
  }
}

/** Backward-compatible Option C entry (forces C). */
export function evaluate70029OptionC(
  events: DutyEvent[],
  globalAcclTZ: string,
  regulator: Regulator = 'TC',
): C70029Report {
  return evaluate70029(events, globalAcclTZ, regulator, 'C')
}

export function hasHard70029HourViolation(report: C70029Report): boolean {
  return report.violations.some(
    (v) =>
      v.code === 'work_60_in_168' ||
      v.code === 'work_70_in_168' ||
      v.code === 'work_192_in_672' ||
      v.code === 'work_2200_in_365' ||
      v.code === 'option_d_not_eligible' ||
      v.code === 'option_d_switch_too_late' ||
      v.code === 'option_d_eln_assigned' ||
      v.code === 'option_d_fdp_over_12' ||
      v.code === 'option_d_work_24_in_48',
  )
}

export function hasSoft70029SdfWarning(report: C70029Report): boolean {
  return report.violations.some(
    (v) =>
      v.code === 'missing_sdf_in_168' || v.code === 'missing_sdf_count_in_672',
  )
}

export function summarize70029Violations(report: C70029Report): string | null {
  if (report.violations.length === 0) return null
  const hard = report.violations.filter((v) =>
    hasHard70029HourViolation({ ...report, violations: [v] }),
  )
  const soft = report.violations.filter(
    (v) =>
      v.code === 'missing_sdf_in_168' || v.code === 'missing_sdf_count_in_672',
  )
  const parts: string[] = []
  if (hard.length) parts.push(hard.map((v) => v.detail).join('\n\n'))
  if (soft.length) {
    parts.push(
      'Time free from duty warning (CAR 700.29):\n\n' +
        soft.map((v) => v.detail).join('\n\n'),
    )
  }
  return parts.join('\n\n')
}

export function explainSingleDayFree(sdf: SingleDayFree): {
  rule: string
  reference: string
  whyApplies: string
} {
  return {
    rule: 'A single day free from duty is time free from duty from the beginning of the first local night’s rest until the end of the following local night’s rest. Each local night’s rest is at least nine hours between 22:30 and 09:30 acclimatized local time. No duty may be assigned during this free period.',
    reference: 'CAR 700.29(1)(c); AC 700-047 §§2.3(i), 4.31–4.32',
    whyApplies: `This free period runs from ${sdf.start.toLocaleString()} to ${sdf.end.toLocaleString()} (${sdf.acclTZ.replace(/_/g, ' ')}), covering two consecutive local nights (${sdf.nights[0].windowKey} and ${sdf.nights[1].windowKey}) with no duty between.`,
  }
}

export function explainFiveLnrBlock(block: FiveLnrBlock): {
  rule: string
  reference: string
  whyApplies: string
} {
  const freeH =
    (block.freeEnd.getTime() - block.freeStart.getTime()) / H
  return {
    rule: 'To use the 70-hour option in any 7 consecutive days, the member must have had 120 consecutive hours free from duty, including five consecutive local nights’ rest, within any 504 consecutive hours — completed before exceeding 60 hours under the standard option. While using the 70-hour option, early/late/night duty is prohibited, FDPs are limited to 12 hours, and work is limited to 24 hours in any 48 hours.',
    reference: 'CAR 700.29(1)(d), 700.29(2); AC 700-047 §§4.31–4.33',
    whyApplies: `Five consecutive local nights from ${block.start.toLocaleString()} to ${block.end.toLocaleString()}, inside a free stretch of ${freeH.toFixed(1)} h (${block.freeStart.toLocaleString()} – ${block.freeEnd.toLocaleString()}).`,
  }
}
