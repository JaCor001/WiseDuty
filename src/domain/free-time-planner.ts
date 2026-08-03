/**
 * Propose free-time blocks to restore CAR 700.29 structure
 * (SDF for Option C, 5 consecutive LNRs + 120 h free for Option D).
 */
import type { DutyEvent, TimeFreeOption } from './types'
import {
  buildFreeIntervals,
  detectLocalNightsFromEvents,
  evaluate70029,
  findLocalNightsInGap,
  hasSoft70029SdfWarning,
  isOptionDEligibleAt,
  findFiveLnrBlocks,
  OPTION_D_FREE_HOURS,
  OPTION_D_LNR_COUNT,
  type C70029Report,
} from './rest-70029'
import { earliestLocalNightsRestEnd } from './rest-70042'

function newId(suffix = ''): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID() + suffix
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}${suffix}`
}

const H = 60 * 60 * 1000

export interface FreeBlockProposal {
  id: string
  start: Date
  end: Date
  purpose: 'sdf' | 'five_lnr_block'
  reason: string
  lnrsCreated: number
  score: number
}

function workEvents(events: DutyEvent[]): DutyEvent[] {
  return events
    .filter((e) => e.type === 'duty' || e.type === 'reserve' || e.type === 'standby')
    .sort((a, b) => a.start.getTime() - b.start.getTime())
}

function overlapsWork(
  events: DutyEvent[],
  start: Date,
  end: Date,
): boolean {
  return workEvents(events).some(
    (w) => w.start.getTime() < end.getTime() && w.end.getTime() > start.getTime(),
  )
}

/**
 * Shortest free block starting at `from` that yields `n` local nights.
 * Extended to at least minHours if needed (Option D 120 h).
 */
export function freeBlockForLocalNights(
  from: Date,
  acclTZ: string,
  n: number,
  minHours = 0,
): { start: Date; end: Date } {
  const lnrEnd = earliestLocalNightsRestEnd(from, acclTZ, n)
  let end = lnrEnd
  const minEnd = new Date(from.getTime() + minHours * H)
  if (minEnd.getTime() > end.getTime()) end = minEnd
  return { start: from, end }
}

function scoreProposal(
  p: Omit<FreeBlockProposal, 'id' | 'score'>,
  preferAfter: Date | null,
): number {
  const durationH = (p.end.getTime() - p.start.getTime()) / H
  let score = 1000 - durationH // prefer shorter
  if (preferAfter) {
    const delayH = (p.start.getTime() - preferAfter.getTime()) / H
    score -= Math.abs(delayH) * 0.5
  }
  if (p.purpose === 'five_lnr_block') score += 50 // prefer when D needed
  return score
}

/**
 * Suggest free blocks after last work, or in existing short gaps, to fix 700.29.
 */
export function proposeFreeBlocks(
  events: DutyEvent[],
  globalAcclTZ: string,
  timeFreeOption: TimeFreeOption = 'auto',
  preferAfter: Date | null = null,
): FreeBlockProposal[] {
  const report = evaluate70029(events, globalAcclTZ, 'TC', timeFreeOption)
  const proposals: FreeBlockProposal[] = []
  const work = workEvents(events)
  const lastWork = work.length ? work[work.length - 1] : null
  const anchor = preferAfter || lastWork?.end || new Date()

  // --- SDF proposals when structure is missing or schedule has work but no SDF yet ---
  const wantsSdf =
    hasSoft70029SdfWarning(report) ||
    (report.sdfs.length === 0 && work.length >= 2)
  if (wantsSdf) {
    const starts: Date[] = []
    if (lastWork) starts.push(lastWork.end)
    // Also try start of largest free gap
    const free = buildFreeIntervals(events, globalAcclTZ)
    for (const iv of free) {
      starts.push(iv.start)
      // If gap already has 1 LNR, start free at gap start (extend)
      const nights = findLocalNightsInGap(iv.start, iv.end, iv.acclTZ)
      if (nights.length === 1) {
        starts.push(iv.start)
      }
    }
    const seen = new Set<string>()
    for (const from of starts) {
      const { start, end } = freeBlockForLocalNights(from, globalAcclTZ, 2)
      const key = `${start.getTime()}-${end.getTime()}-sdf`
      if (seen.has(key)) continue
      seen.add(key)
      if (overlapsWork(events, start, end)) continue
      // Verify applying would create LNR/SDF
      const probe: DutyEvent = {
        id: 'probe-free',
        title: 'Free',
        start,
        end,
        type: 'free',
        acclTZ: globalAcclTZ,
        freePurpose: 'sdf',
      }
      const nextReport = evaluate70029(
        [...events, probe],
        globalAcclTZ,
        'TC',
        timeFreeOption,
      )
      if (nextReport.sdfs.length <= report.sdfs.length) {
        // still try if soft warnings reduced
        if (
          nextReport.violations.filter((v) => v.code.startsWith('missing_sdf'))
            .length >=
          report.violations.filter((v) => v.code.startsWith('missing_sdf')).length
        ) {
          continue
        }
      }
      const base = {
        start,
        end,
        purpose: 'sdf' as const,
        reason:
          'Insert free time covering two consecutive local nights’ rests to form a single day free from duty (CAR 700.29(1)(c)).',
        lnrsCreated: 2,
      }
      proposals.push({
        ...base,
        id: newId('-free-prop'),
        score: scoreProposal(base, anchor),
      })
    }
  }

  // --- Option D 5-LNR block ---
  const needD =
    timeFreeOption === 'D' ||
    report.violations.some((v) => v.code === 'option_d_not_eligible') ||
    (timeFreeOption === 'auto' &&
      report.violations.some(
        (v) => v.code === 'work_60_in_168' || v.code === 'option_d_not_eligible',
      ))
  const eligible = isOptionDEligibleAt(report.fiveLnrBlocks, anchor)
  if (needD && !eligible) {
    const from = lastWork?.end || anchor
    const { start, end } = freeBlockForLocalNights(
      from,
      globalAcclTZ,
      OPTION_D_LNR_COUNT,
      OPTION_D_FREE_HOURS,
    )
    if (!overlapsWork(events, start, end)) {
      const base = {
        start,
        end,
        purpose: 'five_lnr_block' as const,
        reason:
          'Insert ≥120 consecutive hours free including five consecutive local nights’ rests so Option D (70 h) can apply (CAR 700.29(1)(d)/(2)).',
        lnrsCreated: 5,
      }
      proposals.push({
        ...base,
        id: newId('-free-prop'),
        score: scoreProposal(base, anchor),
      })
    }
  }

  proposals.sort((a, b) => b.score - a.score)
  // Cap list
  return proposals.slice(0, 5)
}

/** Build a persisted free event from a proposal. */
export function freeEventFromProposal(
  p: FreeBlockProposal,
  acclTZ: string,
): DutyEvent {
  return {
    id: newId('-free'),
    title:
      p.purpose === 'five_lnr_block'
        ? 'Time free from duty (5× LNR / Option D)'
        : 'Time free from duty (SDF)',
    start: p.start,
    end: p.end,
    type: 'free',
    eventKind: 'free',
    acclTZ,
    restKind: 'free_block',
    restRule: 'CAR 700.29',
    freePurpose: p.purpose,
    ruleWhy: p.reason,
    workFactor: 0,
  }
}

/** Simulate report after applying first proposal (for UI preview). */
export function previewReportWithProposal(
  events: DutyEvent[],
  proposal: FreeBlockProposal,
  acclTZ: string,
  timeFreeOption: TimeFreeOption,
): C70029Report {
  return evaluate70029(
    [...events, freeEventFromProposal(proposal, acclTZ)],
    acclTZ,
    'TC',
    timeFreeOption,
  )
}

export function listExistingFiveLnrBlocks(
  events: DutyEvent[],
  acclTZ: string,
): ReturnType<typeof findFiveLnrBlocks> {
  const lnrs = detectLocalNightsFromEvents(events, acclTZ)
  return findFiveLnrBlocks(events, lnrs, acclTZ)
}
