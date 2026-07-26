/**
 * Copy-paste debug dump for info-sheet section 4 (marker / alert / event).
 * Dense, machine-friendly text for pasting into coding chats.
 */
import type { DutyEvent, Regulator, TimeFreeOption } from './types'
import { defaultWorkFactor, isWorkEvent } from './types'
import {
  dutyHasEarlyMarker,
  dutyHasLateMarker,
  dutyHasNightMarker,
} from './regulations'
import {
  countTrailingWoclDuties,
  fdpTouchesWocl,
} from './rest-70042'
import type { C70029Report, C70029Violation, SingleDayFree } from './rest-70029'
import { getWorkHoursInWindow } from './rest-70029'
import { getZonedTimeParts } from './time'
import type { InfoSheetContent } from './markers'
import { locationTZ } from './markers'

export type DebugFocus =
  | { kind: 'event'; event: DutyEvent; marker?: string }
  | { kind: 'sdf'; sdf: SingleDayFree; reasons?: string[] }
  | { kind: 'violation'; violation: C70029Violation }
  | { kind: 'generic' }

export interface DebugContextInput {
  sheet: InfoSheetContent
  focus: DebugFocus
  events: DutyEvent[]
  regulator: Regulator
  acclTZ: string
  homeBaseTZ: string
  timeFreeOption?: TimeFreeOption
  report70029?: C70029Report
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Wall time in a named zone + ISO instant. */
export function fmtWall(d: Date, tz: string): string {
  const p = getZonedTimeParts(d, tz)
  return `${p.dayKey} ${pad2(p.hour)}:${pad2(p.minute)} ${tz} (UTC ${d.toISOString()})`
}

function hoursBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / (1000 * 60 * 60)
}

function eventAccl(e: DutyEvent, fallback: string): string {
  return e.acclTZ || fallback
}

function describeDutyLine(
  e: DutyEvent,
  allDuties: DutyEvent[],
  regulator: Regulator,
  globalAcclTZ: string,
  homeBaseTZ: string,
): string[] {
  const accl = eventAccl(e, globalAcclTZ)
  const startTZ = locationTZ(e, 'start', globalAcclTZ)
  const endTZ = locationTZ(e, 'end', globalAcclTZ)
  const dur = hoursBetween(e.start, e.end)
  const early = dutyHasEarlyMarker(e, regulator, globalAcclTZ)
  const late = dutyHasLateMarker(e, regulator, globalAcclTZ)
  const night = dutyHasNightMarker(e, regulator, globalAcclTZ)
  const wocl = fdpTouchesWocl(e.start, e.end, accl)
  const trailWocl =
    e.type === 'duty'
      ? countTrailingWoclDuties(allDuties, e, globalAcclTZ)
      : 0
  const eln = [early && 'E', late && 'L', night && 'N'].filter(Boolean).join('') || '—'
  const lines = [
    `  type=duty id=${e.id} title=${JSON.stringify(e.title || 'Duty')}`,
    `  start=${fmtWall(e.start, startTZ)}`,
    `  end=${fmtWall(e.end, endTZ)}`,
    `  duration_h=${dur.toFixed(2)} acclTZ=${accl} startTZ=${startTZ} endTZ=${endTZ} home=${homeBaseTZ}`,
    `  ELN=${eln} (E=${early} L=${late} N=${night}) WOCL=${wocl} trailingWoclCount=${trailWocl}`,
  ]
  if (e.violated) lines.push(`  violated=true`)
  return lines
}

function describeRestLine(e: DutyEvent, globalAcclTZ: string): string[] {
  const accl = eventAccl(e, globalAcclTZ)
  const dur = hoursBetween(e.start, e.end)
  return [
    `  type=rest id=${e.id} title=${JSON.stringify(e.title || 'Rest')}`,
    `  start=${fmtWall(e.start, accl)}`,
    `  end=${fmtWall(e.end, accl)}`,
    `  duration_h=${dur.toFixed(2)} acclTZ=${accl}`,
    `  restRule=${e.restRule ?? '—'} restKind=${e.restKind ?? '—'} clockH=${e.requiredRestHours ?? '—'} localNights=${e.requiredLocalNights ?? 0} isLNR=${!!e.isLocalNightRest} baseRest=${e.baseRestType ?? '—'} violated=${!!e.violated}`,
    e.ruleWhy ? `  ruleWhy=${JSON.stringify(e.ruleWhy)}` : '',
  ].filter(Boolean)
}

function describeAuxLine(e: DutyEvent, globalAcclTZ: string): string[] {
  const accl = eventAccl(e, globalAcclTZ)
  const dur = hoursBetween(e.start, e.end)
  const factor =
    e.workFactor != null && Number.isFinite(e.workFactor)
      ? e.workFactor
      : defaultWorkFactor(e.type)
  const lines = [
    `  type=${e.type} id=${e.id} title=${JSON.stringify(e.title || e.type)}`,
    `  start=${fmtWall(e.start, accl)}`,
    `  end=${fmtWall(e.end, accl)}`,
    `  duration_h=${dur.toFixed(2)} workFactor=${factor} acclTZ=${accl}`,
  ]
  if (e.type === 'free' && e.freePurpose) {
    lines.push(`  freePurpose=${e.freePurpose}`)
  }
  return lines
}

/**
 * Build a single plain-text block for the info-sheet “Debug for AI” section.
 */
export function buildInfoSheetDebugContext(input: DebugContextInput): string {
  const {
    sheet,
    focus,
    events,
    regulator,
    acclTZ,
    homeBaseTZ,
    timeFreeOption,
    report70029,
  } = input

  const sorted = [...events].sort(
    (a, b) => a.start.getTime() - b.start.getTime(),
  )
  const duties = sorted.filter((e) => e.type === 'duty')
  const lines: string[] = []

  lines.push('=== WiseDuty debug context (paste into coding chat) ===')
  lines.push(`generated=${new Date().toISOString()}`)
  lines.push(
    `settings regulator=${regulator} acclTZ=${acclTZ} homeBaseTZ=${homeBaseTZ} timeFreeOption=${timeFreeOption ?? '—'}`,
  )
  lines.push('')

  lines.push('--- SHEET ---')
  lines.push(`badge=${sheet.badge} title=${JSON.stringify(sheet.title)} violated=${!!sheet.violated}`)
  lines.push(`reference=${sheet.reference}`)
  lines.push(`whyApplies=${JSON.stringify(sheet.whyApplies)}`)
  if (sheet.meta?.length) {
    for (const m of sheet.meta) lines.push(`meta: ${m}`)
  }
  lines.push('')

  lines.push('--- FOCUS ---')
  if (focus.kind === 'event') {
    const e = focus.event
    lines.push(`kind=event marker=${focus.marker ?? '—'} eventId=${e.id} type=${e.type}`)
    if (e.type === 'duty') {
      lines.push(...describeDutyLine(e, duties, regulator, acclTZ, homeBaseTZ))
    } else if (e.type === 'rest') {
      lines.push(...describeRestLine(e, acclTZ))
    } else {
      lines.push(...describeAuxLine(e, acclTZ))
    }
    // Neighbours
    if (e.type === 'duty' || e.type === 'rest') {
      const dutyId =
        e.type === 'duty'
          ? e.id
          : e.id.endsWith('-rest')
            ? e.id.slice(0, -'-rest'.length)
            : null
      const idx = dutyId
        ? duties.findIndex((d) => d.id === dutyId)
        : -1
      if (idx >= 0) {
        const prev = duties[idx - 1]
        const next = duties[idx + 1]
        if (prev) {
          const gap = hoursBetween(prev.end, duties[idx].start)
          lines.push(
            `prevDuty id=${prev.id} end=${fmtWall(prev.end, eventAccl(prev, acclTZ))} gap_to_this_h=${gap.toFixed(2)}`,
          )
        } else {
          lines.push('prevDuty=none')
        }
        if (next) {
          const gap = hoursBetween(duties[idx].end, next.start)
          lines.push(
            `nextDuty id=${next.id} start=${fmtWall(next.start, eventAccl(next, acclTZ))} gap_after_this_h=${gap.toFixed(2)}`,
          )
        } else {
          lines.push('nextDuty=none')
        }
      }
    }
  } else if (focus.kind === 'sdf') {
    const s = focus.sdf
    lines.push(
      `kind=sdf reasons=${(focus.reasons ?? []).join(',') || '—'} acclTZ=${s.acclTZ}`,
    )
    lines.push(`sdf.start=${fmtWall(s.start, s.acclTZ)}`)
    lines.push(`sdf.end=${fmtWall(s.end, s.acclTZ)}`)
    lines.push(
      `nights=${s.nights[0].windowKey}→${s.nights[1].windowKey} night0=${fmtWall(s.nights[0].start, s.acclTZ)}→${fmtWall(s.nights[0].end, s.acclTZ)} night1=${fmtWall(s.nights[1].start, s.acclTZ)}→${fmtWall(s.nights[1].end, s.acclTZ)}`,
    )
  } else if (focus.kind === 'violation') {
    const v = focus.violation
    lines.push(`kind=violation code=${v.code}`)
    lines.push(`windowStart=${fmtWall(v.windowStart, acclTZ)}`)
    lines.push(`windowEnd=${fmtWall(v.windowEnd, acclTZ)}`)
    lines.push(
      `workHours=${v.workHours ?? '—'} sdfCount=${v.sdfCount ?? '—'} detail=${JSON.stringify(v.detail)}`,
    )
    // Duties overlapping window
    const inWin = duties.filter(
      (d) =>
        d.end.getTime() > v.windowStart.getTime() &&
        d.start.getTime() < v.windowEnd.getTime(),
    )
    lines.push(`duties_overlapping_window=${inWin.length}`)
    for (const d of inWin) {
      lines.push(
        `  - ${d.id} ${fmtWall(d.start, eventAccl(d, acclTZ))} → ${fmtWall(d.end, eventAccl(d, acclTZ))} dur=${hoursBetween(d.start, d.end).toFixed(2)}h`,
      )
    }
    const workInWin = getWorkHoursInWindow(
      sorted,
      v.windowStart,
      v.windowEnd,
    )
    lines.push(`recomputed_work_in_window_h=${workInWin.toFixed(3)}`)
  } else {
    lines.push('kind=generic')
  }
  lines.push('')

  lines.push(`--- SCHEDULE (${sorted.length} events, chronological) ---`)
  sorted.forEach((e, i) => {
    lines.push(`[${i + 1}]`)
    if (e.type === 'duty') {
      lines.push(...describeDutyLine(e, duties, regulator, acclTZ, homeBaseTZ))
    } else if (e.type === 'rest') {
      lines.push(...describeRestLine(e, acclTZ))
    } else {
      lines.push(...describeAuxLine(e, acclTZ))
    }
  })
  lines.push('')

  // Work totals snapshot
  const workEvents = sorted.filter(isWorkEvent)
  let totalWork = 0
  for (const e of workEvents) {
    const f =
      e.workFactor != null && Number.isFinite(e.workFactor)
        ? e.workFactor
        : defaultWorkFactor(e.type)
    totalWork += hoursBetween(e.start, e.end) * f
  }
  lines.push('--- WORK SNAPSHOT ---')
  lines.push(
    `work_events=${workEvents.length} duties=${duties.length} weighted_work_h_all_time=${totalWork.toFixed(2)}`,
  )
  lines.push('')

  if (report70029 && regulator === 'TC') {
    lines.push('--- 700.29 REPORT ---')
    lines.push(
      `option=${report70029.option} resolved=${report70029.resolvedOption} reason=${JSON.stringify(report70029.optionReason)}`,
    )
    lines.push(
      `lnrs=${report70029.lnrs.length} sdfs=${report70029.sdfs.length} displaySdfs=${report70029.displaySdfs.length} fiveLnrBlocks=${report70029.fiveLnrBlocks.length} violations=${report70029.violations.length}`,
    )
    for (const v of report70029.violations) {
      lines.push(
        `  viol code=${v.code} work=${v.workHours ?? '—'} sdf=${v.sdfCount ?? '—'} window=${fmtWall(v.windowStart, acclTZ)} → ${fmtWall(v.windowEnd, acclTZ)}`,
      )
      lines.push(`    detail=${JSON.stringify(v.detail)}`)
    }
    for (const d of report70029.displaySdfs) {
      lines.push(
        `  displaySdf reasons=${d.reasons.join('+')} ${fmtWall(d.sdf.start, d.sdf.acclTZ)} → ${fmtWall(d.sdf.end, d.sdf.acclTZ)}`,
      )
    }
    lines.push('')
  }

  lines.push('=== end debug context ===')
  return lines.join('\n')
}

/** Attach section-4 debug text to any info sheet. */
export function withDebugContext(
  sheet: InfoSheetContent,
  input: Omit<DebugContextInput, 'sheet'>,
): InfoSheetContent {
  return {
    ...sheet,
    debugContext: buildInfoSheetDebugContext({ ...input, sheet }),
  }
}
