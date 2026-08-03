/**
 * Pure schedule-import parsing: device calendar events → WiseDuty duty drafts.
 * Report Auto: use report from calendar when present; else buffer-based report.
 */
import { getAirportByCode, getAirportByIcao } from './airports'
import { createId } from './events'
import {
  avgSectorBandFromMinutes,
  selectReleaseBufferMin,
  selectReportBufferMin,
} from './fdp-from-flights'
import type {
  DutyEvent,
  DutyTimingBuffers,
  FlightLeg,
  ImportReportMode,
} from './types'
import { DEFAULT_DUTY_TIMING_BUFFERS } from './types'
import { parseZonedDateTime, toDateInputValueInTZ } from './time'

/** Neutral calendar event shape (from device or tests). */
export interface ImportCalendarEvent {
  id: string
  calendarId?: string
  title: string
  notes?: string
  location?: string
  start: Date
  end: Date
  allDay: boolean
}

export type ReportSource =
  | 'calendar_report_event'
  | 'calendar_embedded_time'
  | 'event_start_as_report'
  | 'buffers'

export interface ParsedFlightCandidate {
  eventId: string
  depIcao: string
  arrIcao: string
  dep: Date
  arr: Date
  isDeadhead: boolean
  customsPreclearance: boolean
  title: string
}

export interface ImportDutyDraft {
  title: string
  start: Date
  end: Date
  startTZ: string
  endTZ: string
  reportOverridden?: boolean
  releaseOverridden?: boolean
  flights: FlightLeg[]
  reportSource: ReportSource
  reportReason: string
  sourceEventIds: string[]
  warnings: string[]
}

export interface ScheduleImportResult {
  duties: DutyEvent[]
  drafts: ImportDutyDraft[]
  skippedEvents: { id: string; title: string; reason: string }[]
  summary: string
}

const H = 3_600_000
/** Gap after which a new FDP starts (near min rest). */
export const DEFAULT_FDP_GAP_HOURS = 9

/** YYZ-YVR, YYZ→YVR, YYZ/YVR, CYYZ-CYVR, etc. */
const ROUTE_RE =
  /\b([A-Za-z]{3,4})\s*[-–—/>→]+\s*([A-Za-z]{3,4})\b/

const REPORT_EVENT_RE =
  /\b(report|show\s*time|check[- ]?in|briefing|rpt)\b/i

/** Flight Crew View: title "Report: 1435L" */
const FCV_REPORT_TITLE_RE = /^Report\s*:\s*(\d{3,4})\s*L?\s*$/i

const DH_RE = /\b(deadhead|positioning|\bDH\b|\bPAX\b)\b/i
const CUSTOMS_RE = /\b(customs|pre[- ]?clear(?:ance)?)\b/i

/**
 * Report 05:45, RPT 0545, Report: 1435L, Show: 5:45 AM
 * Flight Crew View uses HHMM + optional L (local).
 */
const EMBEDDED_REPORT_RE =
  /\b(?:report(?:\s*time)?|show(?:\s*time)?|rpt)\s*[:\s]*(\d{1,2}):?(\d{2})\s*(?:L\b)?\s*(a\.?m\.?|p\.?m\.?)?/i

/** End: 1645L (FCV) / Release 14:20 / REL 1420 */
const EMBEDDED_RELEASE_RE =
  /\b(?:end|release|rel)\s*[:\s]*(\d{1,2}):?(\d{2})\s*(?:L\b)?\s*(a\.?m\.?|p\.?m\.?)?/i

/**
 * FCV flight line examples:
 *   SA01 DH 816 YYZ-YUL 1520-1645
 *   SA01 123 YYZ-YVR 0900-1130
 * Optional pair code, optional DH, flight #, route, dep-arr HHMM.
 */
const FCV_FLIGHT_LINE_RE =
  /(?:^|\n)\s*[^\n]*?\b(?:DH\s+)?(?:\d{1,4}\s+)?([A-Za-z]{3,4})\s*[-–—/]\s*([A-Za-z]{3,4})\s+(\d{3,4})\s*[-–—]\s*(\d{3,4})\b/gi

export function resolveAirportCode(code: string): string | undefined {
  const c = code.trim().toUpperCase()
  if (!c) return undefined
  const by = getAirportByCode(c)
  if (by) return by.icao
  // Try K/C prefix for 3-letter as US/CA ICAO guess only if known
  if (c.length === 3) {
    for (const prefix of ['C', 'K']) {
      const ap = getAirportByIcao(prefix + c)
      if (ap) return ap.icao
    }
  }
  return undefined
}

export function parseRouteAirports(
  text: string,
): { depIcao: string; arrIcao: string } | null {
  if (!text) return null
  const m = text.match(ROUTE_RE)
  if (!m) return null
  const dep = resolveAirportCode(m[1])
  const arr = resolveAirportCode(m[2])
  if (!dep || !arr || dep === arr) return null
  return { depIcao: dep, arrIcao: arr }
}

function haystack(e: ImportCalendarEvent): string {
  return [e.title, e.location, e.notes].filter(Boolean).join(' \n ')
}

/** True if title is an FCV / crew-view report event (even when notes list flights). */
export function isFcvReportEvent(e: ImportCalendarEvent): boolean {
  if (e.allDay) return false
  return FCV_REPORT_TITLE_RE.test((e.title || '').trim())
}

export function isReportLikeEvent(e: ImportCalendarEvent): boolean {
  if (e.allDay) return false
  if (isFcvReportEvent(e)) return true
  // Pure flight-title events are not "report blocks"
  if (parseRouteAirports(e.title || '') && !REPORT_EVENT_RE.test(e.title || '')) {
    return false
  }
  // Body may list flights (FCV) while title is Report — still report-like
  if (REPORT_EVENT_RE.test(e.title || '')) return true
  if (parseRouteAirports(haystack(e)) && !REPORT_EVENT_RE.test(e.title || '')) {
    return false
  }
  return REPORT_EVENT_RE.test(haystack(e))
}

export function isDeadheadText(text: string): boolean {
  return DH_RE.test(text)
}

export function hasCustomsText(text: string): boolean {
  return CUSTOMS_RE.test(text)
}

/** Parse HHMM or HMM token (1435, 945, 1520). */
export function parseHHmmToken(raw: string): { hour: number; minute: number } | null {
  const s = raw.replace(/\D/g, '')
  if (s.length === 3) {
    const hour = Number(s[0])
    const minute = Number(s.slice(1))
    if (hour <= 23 && minute <= 59) return { hour, minute }
    return null
  }
  if (s.length === 4) {
    const hour = Number(s.slice(0, 2))
    const minute = Number(s.slice(2))
    if (hour <= 23 && minute <= 59) return { hour, minute }
    return null
  }
  return null
}

export function parseEmbeddedClock(
  text: string,
  kind: 'report' | 'release',
): { hour: number; minute: number } | null {
  const re = kind === 'report' ? EMBEDDED_REPORT_RE : EMBEDDED_RELEASE_RE
  const m = text.match(re)
  if (!m) return null
  // Prefer compact HHMM when the match is four digits without colon in source slice
  const full = m[0]
  const compact = full.match(/(\d{3,4})\s*L?\b/i)
  if (compact && !full.includes(':')) {
    const tok = parseHHmmToken(compact[1])
    if (tok) return tok
  }
  let hour = Number(m[1])
  const minute = Number(m[2])
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
  if (minute < 0 || minute > 59 || hour < 0 || hour > 23) return null
  const ampm = (m[3] || '').toLowerCase().replace(/\./g, '')
  if (ampm.startsWith('p') && hour < 12) hour += 12
  if (ampm.startsWith('a') && hour === 12) hour = 0
  return { hour, minute }
}

/** Apply HH:mm on the civil day of `dayAnchor` in IANA `tz`. */
export function wallTimeOnDay(
  dayAnchor: Date,
  hour: number,
  minute: number,
  tz: string,
): Date {
  const ymd = toDateInputValueInTZ(dayAnchor, tz)
  const hh = String(hour).padStart(2, '0')
  const mm = String(minute).padStart(2, '0')
  return parseZonedDateTime(ymd, `${hh}:${mm}`, tz)
}

/**
 * Flight Crew View (and similar) multi-line duty bodies:
 *   Report: 1435L
 *   End: 1645L
 *   SA01 DH 816 YYZ-YUL 1520-1645
 */
export function parseFcvFlightLines(
  text: string,
  dayAnchor: Date,
  eventId: string,
  homeTZ: string,
): ParsedFlightCandidate[] {
  if (!text) return []
  const out: ParsedFlightCandidate[] = []
  const re = new RegExp(FCV_FLIGHT_LINE_RE.source, 'gi')
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) != null) {
    const lineStart = Math.max(0, m.index - 40)
    const lineCtx = text.slice(lineStart, m.index + m[0].length)
    const depIcao = resolveAirportCode(m[1])
    const arrIcao = resolveAirportCode(m[2])
    const depTok = parseHHmmToken(m[3])
    const arrTok = parseHHmmToken(m[4])
    if (!depIcao || !arrIcao || !depTok || !arrTok || depIcao === arrIcao) {
      continue
    }
    const depTz = tzForIcao(depIcao, homeTZ)
    const arrTz = tzForIcao(arrIcao, homeTZ)
    let dep = wallTimeOnDay(dayAnchor, depTok.hour, depTok.minute, depTz)
    let arr = wallTimeOnDay(dayAnchor, arrTok.hour, arrTok.minute, arrTz)
    // Overnight arrival
    if (arr.getTime() <= dep.getTime()) {
      arr = new Date(arr.getTime() + 24 * H)
    }
    const isDh = /\bDH\b/i.test(lineCtx) || isDeadheadText(lineCtx)
    out.push({
      eventId: `${eventId}-leg${out.length}`,
      depIcao,
      arrIcao,
      dep,
      arr,
      isDeadhead: isDh,
      customsPreclearance: hasCustomsText(lineCtx),
      title: `${depIcao.slice(-3)}-${arrIcao.slice(-3)}${isDh ? ' DH' : ''}`,
    })
  }
  return out
}

/**
 * All flights carried by one calendar event (FCV body lines and/or simple route).
 */
export function extractFlightsFromEvent(
  e: ImportCalendarEvent,
  homeTZ = 'UTC',
): ParsedFlightCandidate[] {
  if (e.allDay) return []
  const text = haystack(e)
  const fcv = parseFcvFlightLines(text, e.start, e.id, homeTZ)
  if (fcv.length > 0) return fcv

  // Simple one-leg event: title/location is the route; times = event start/end
  if (isFcvReportEvent(e)) {
    // Report-only without parseable legs
    return []
  }
  const route =
    parseRouteAirports(e.title) ||
    parseRouteAirports(e.location || '') ||
    parseRouteAirports(e.notes || '')
  if (!route) return []
  if (!(e.end.getTime() > e.start.getTime())) return []
  return [
    {
      eventId: e.id,
      depIcao: route.depIcao,
      arrIcao: route.arrIcao,
      dep: e.start,
      arr: e.end,
      isDeadhead: isDeadheadText(text),
      customsPreclearance: hasCustomsText(text),
      title: e.title || route.depIcao + '→' + route.arrIcao,
    },
  ]
}

/** @deprecated Prefer extractFlightsFromEvent — kept for tests / single-leg. */
export function tryParseFlightEvent(
  e: ImportCalendarEvent,
  homeTZ = 'UTC',
): ParsedFlightCandidate | null {
  return extractFlightsFromEvent(e, homeTZ)[0] ?? null
}

export function groupEventsIntoFdpClusters(
  events: ImportCalendarEvent[],
  gapHours = DEFAULT_FDP_GAP_HOURS,
): ImportCalendarEvent[][] {
  const sorted = [...events]
    .filter((e) => !e.allDay)
    .sort((a, b) => a.start.getTime() - b.start.getTime())
  if (sorted.length === 0) return []

  const clusters: ImportCalendarEvent[][] = []
  let cur: ImportCalendarEvent[] = [sorted[0]]
  for (let i = 1; i < sorted.length; i++) {
    const prev = cur[cur.length - 1]
    const e = sorted[i]
    const gap = (e.start.getTime() - prev.end.getTime()) / H
    if (gap >= gapHours) {
      clusters.push(cur)
      cur = [e]
    } else {
      cur.push(e)
    }
  }
  clusters.push(cur)
  return clusters
}

function tzForIcao(icao: string, fallback: string): string {
  return getAirportByIcao(icao)?.tz || fallback
}

export function resolveReportForCluster(
  cluster: ImportCalendarEvent[],
  flights: ParsedFlightCandidate[],
  mode: ImportReportMode,
  buffers: DutyTimingBuffers,
  homeTZ: string,
): { report: Date; source: ReportSource; reason: string; overridden: boolean } {
  if (flights.length === 0) {
    const start = cluster[0].start
    return {
      report: start,
      source: 'event_start_as_report',
      reason: 'No flights parsed; using first event start.',
      overridden: true,
    }
  }

  const firstFlight = flights[0]
  const firstLegLike = {
    depIcao: firstFlight.depIcao,
    arrIcao: firstFlight.arrIcao,
    dep: firstFlight.dep,
    arr: firstFlight.arr,
    isDeadhead: firstFlight.isDeadhead,
    customsPreclearance: firstFlight.customsPreclearance,
    id: firstFlight.eventId,
  }
  const buf = selectReportBufferMin(firstLegLike, buffers)
  const bufferReport = new Date(
    firstFlight.dep.getTime() - buf.min * 60_000,
  )

  if (mode === 'buffers') {
    return {
      report: bufferReport,
      source: 'buffers',
      reason: `Auto buffers: ${buf.reason}`,
      overridden: false,
    }
  }

  if (mode === 'event_start') {
    const first = cluster[0]
    return {
      report: first.start,
      source: 'event_start_as_report',
      reason: `Event start treated as report (${first.title || 'event'}).`,
      overridden: true,
    }
  }

  // --- Auto ---
  const depTz = tzForIcao(firstFlight.depIcao, homeTZ)

  // 1) Flight Crew View / "Report: 1435L" — event is timed at report; body lists flights
  const fcv = cluster.find((e) => isFcvReportEvent(e))
  if (fcv) {
    // Prefer calendar event start (FCV codes the event at report); fall back to parsed HHMM
    const clock = parseEmbeddedClock(haystack(fcv), 'report')
    const report = fcv.start
    const hhmm = clock
      ? `${String(clock.hour).padStart(2, '0')}:${String(clock.minute).padStart(2, '0')}`
      : ''
    return {
      report,
      source: 'calendar_report_event',
      reason: `Flight Crew View report event “${fcv.title || 'Report'}”${hhmm ? ` (${hhmm}L)` : ''} — event start used as report.`,
      overridden: true,
    }
  }

  // 2) Explicit report-like event (title contains Report / show / briefing)
  const explicit = cluster.find((e) => isReportLikeEvent(e))
  if (explicit) {
    return {
      report: explicit.start,
      source: 'calendar_report_event',
      reason: `Report from calendar event “${explicit.title || 'Report'}”.`,
      overridden: true,
    }
  }

  // 3) Short pre-flight block before first dep
  const preBlocks = cluster.filter(
    (e) =>
      extractFlightsFromEvent(e, homeTZ).length === 0 &&
      e.end.getTime() - e.start.getTime() <= 2.5 * H &&
      e.start.getTime() <= firstFlight.dep.getTime(),
  )
  if (preBlocks.length > 0) {
    const block = preBlocks.sort(
      (a, b) => a.start.getTime() - b.start.getTime(),
    )[0]
    return {
      report: block.start,
      source: 'calendar_report_event',
      reason: `Report from pre-flight calendar block “${block.title || 'Show'}”.`,
      overridden: true,
    }
  }

  // 4) Embedded report time in notes/title (Report: 1435L, Report 05:45, …)
  for (const e of cluster) {
    const clock = parseEmbeddedClock(haystack(e), 'report')
    if (clock) {
      const report = wallTimeOnDay(
        firstFlight.dep,
        clock.hour,
        clock.minute,
        depTz,
      )
      return {
        report,
        source: 'calendar_embedded_time',
        reason: `Report ${String(clock.hour).padStart(2, '0')}:${String(clock.minute).padStart(2, '0')} found in calendar text (${depTz.replace(/_/g, ' ')}).`,
        overridden: true,
      }
    }
  }

  // 5) Fallback buffers
  return {
    report: bufferReport,
    source: 'buffers',
    reason: `No report in schedule; ${buf.reason}`,
    overridden: false,
  }
}

function resolveRelease(
  cluster: ImportCalendarEvent[],
  flights: ParsedFlightCandidate[],
  buffers: DutyTimingBuffers,
  homeTZ: string,
): { release: Date; overridden: boolean } {
  if (flights.length === 0) {
    return { release: cluster[cluster.length - 1].end, overridden: true }
  }
  const last = flights[flights.length - 1]
  const arrTz = tzForIcao(last.arrIcao, homeTZ)

  // FCV "End: 1645L" (or event end when FCV report event end matches duty)
  for (const e of cluster) {
    const clock = parseEmbeddedClock(haystack(e), 'release')
    if (clock) {
      let release = wallTimeOnDay(last.arr, clock.hour, clock.minute, arrTz)
      if (release.getTime() < last.arr.getTime()) {
        release = new Date(release.getTime() + 24 * H)
      }
      return { release, overridden: true }
    }
  }

  // FCV: calendar event end often equals duty end (release)
  const fcv = cluster.find((e) => isFcvReportEvent(e))
  if (fcv && fcv.end.getTime() >= last.arr.getTime()) {
    return { release: fcv.end, overridden: true }
  }

  const lastLeg = {
    id: last.eventId,
    depIcao: last.depIcao,
    arrIcao: last.arrIcao,
    dep: last.dep,
    arr: last.arr,
    isDeadhead: last.isDeadhead,
  }
  const relBuf = selectReleaseBufferMin(lastLeg, buffers)
  return {
    release: new Date(last.arr.getTime() + relBuf.min * 60_000),
    overridden: false,
  }
}

export function buildImportDrafts(
  events: ImportCalendarEvent[],
  opts: {
    reportMode?: ImportReportMode
    buffers?: DutyTimingBuffers
    homeBaseTZ: string
    gapHours?: number
  },
): {
  drafts: ImportDutyDraft[]
  skippedEvents: ScheduleImportResult['skippedEvents']
} {
  const mode = opts.reportMode ?? 'auto'
  const buffers = opts.buffers ?? DEFAULT_DUTY_TIMING_BUFFERS
  const homeTZ = opts.homeBaseTZ || 'UTC'
  const gapHours = opts.gapHours ?? DEFAULT_FDP_GAP_HOURS

  const skipped: ScheduleImportResult['skippedEvents'] = []
  const timed = events.filter((e) => {
    if (e.allDay) {
      skipped.push({
        id: e.id,
        title: e.title || '(all day)',
        reason: 'All-day events are ignored',
      })
      return false
    }
    return true
  })

  const clusters = groupEventsIntoFdpClusters(timed, gapHours)
  const drafts: ImportDutyDraft[] = []

  for (const cluster of clusters) {
    const warnings: string[] = []
    const flights: ParsedFlightCandidate[] = []
    for (const e of cluster) {
      const legs = extractFlightsFromEvent(e, homeTZ)
      if (legs.length > 0) {
        flights.push(...legs)
      } else if (!isReportLikeEvent(e) && !isFcvReportEvent(e)) {
        const hasRouteAttempt = ROUTE_RE.test(haystack(e))
        if (hasRouteAttempt) {
          warnings.push(
            `Could not resolve airports in “${e.title || e.id}”`,
          )
          skipped.push({
            id: e.id,
            title: e.title || '',
            reason: 'Unrecognized airport codes',
          })
        }
      }
    }

    if (flights.length === 0 && !cluster.some(isReportLikeEvent)) {
      for (const e of cluster) {
        skipped.push({
          id: e.id,
          title: e.title || '',
          reason: 'No flight route found',
        })
      }
      continue
    }

    if (flights.length === 0) {
      for (const e of cluster) {
        skipped.push({
          id: e.id,
          title: e.title || '',
          reason: 'Report-only cluster without flights',
        })
      }
      continue
    }

    flights.sort((a, b) => a.dep.getTime() - b.dep.getTime())
    // First flight may carry customs
    if (flights[0] && cluster.some((e) => hasCustomsText(haystack(e)))) {
      flights[0] = { ...flights[0], customsPreclearance: true }
    }

    const reportRes = resolveReportForCluster(
      cluster,
      flights,
      mode,
      buffers,
      homeTZ,
    )
    const releaseRes = resolveRelease(cluster, flights, buffers, homeTZ)

    const legs: FlightLeg[] = flights.map((f) => ({
      id: f.eventId || createId('-leg'),
      depIcao: f.depIcao,
      arrIcao: f.arrIcao,
      dep: f.dep,
      arr: f.arr,
      isDeadhead: f.isDeadhead,
      customsPreclearance: f.customsPreclearance,
    }))

    const startTZ = tzForIcao(flights[0].depIcao, homeTZ)
    const endTZ = tzForIcao(flights[flights.length - 1].arrIcao, homeTZ)
    const title =
      flights.map((f) => `${f.depIcao.slice(-3)}-${f.arrIcao.slice(-3)}`).join(' · ') ||
      'Imported duty'

    let opMin = 0
    let opCount = 0
    for (const f of flights) {
      if (!f.isDeadhead) {
        opMin += (f.arr.getTime() - f.dep.getTime()) / 60_000
        opCount++
      }
    }
    if (opCount === 0) {
      for (const f of flights) {
        opMin += (f.arr.getTime() - f.dep.getTime()) / 60_000
        opCount++
      }
    }

    drafts.push({
      title: `Duty ${title}`,
      start: reportRes.report,
      end: releaseRes.release,
      startTZ,
      endTZ,
      reportOverridden: reportRes.overridden,
      releaseOverridden: releaseRes.overridden,
      flights: legs,
      reportSource: reportRes.source,
      reportReason: reportRes.reason,
      sourceEventIds: cluster.map((e) => e.id),
      warnings,
    })
  }

  return { drafts, skippedEvents: skipped }
}

export function draftsToDutyEvents(
  drafts: ImportDutyDraft[],
  opts: { homeBaseTZ: string; acclTZ?: string },
): DutyEvent[] {
  const accl = opts.acclTZ || opts.homeBaseTZ
  return drafts.map((d) => {
    const operating = d.flights.filter((f) => !f.isDeadhead)
    const meanMin =
      operating.length > 0
        ? operating.reduce(
            (s, f) => s + (f.arr.getTime() - f.dep.getTime()) / 60_000,
            0,
          ) / operating.length
        : d.flights.reduce(
            (s, f) => s + (f.arr.getTime() - f.dep.getTime()) / 60_000,
            0,
          ) / Math.max(1, d.flights.length)

    return {
      id: createId('-import'),
      title: d.title,
      type: 'duty',
      eventKind: 'flight_duty',
      start: d.start,
      end: d.end,
      startTZ: d.startTZ,
      endTZ: d.endTZ,
      acclTZ: accl,
      flights: d.flights,
      reportOverridden: d.reportOverridden,
      releaseOverridden: d.releaseOverridden,
      operatingSectors: Math.max(1, operating.length || d.flights.length),
      positioningSectors: d.flights.filter((f) => f.isDeadhead).length || undefined,
      avgSectorTime: avgSectorBandFromMinutes(meanMin),
      endsWithPositioning:
        d.flights.length > 0
          ? d.flights[d.flights.length - 1].isDeadhead
          : undefined,
      operatingEnd: (() => {
        const lastOp = [...d.flights].reverse().find((f) => !f.isDeadhead)
        return lastOp && d.flights[d.flights.length - 1]?.isDeadhead
          ? lastOp.arr
          : undefined
      })(),
      importSource: {
        eventIds: d.sourceEventIds,
        importedAt: new Date().toISOString(),
        reportSource: d.reportSource,
      },
    }
  })
}

export function importScheduleFromEvents(
  events: ImportCalendarEvent[],
  opts: {
    reportMode?: ImportReportMode
    buffers?: DutyTimingBuffers
    homeBaseTZ: string
    acclTZ?: string
    gapHours?: number
  },
): ScheduleImportResult {
  const { drafts, skippedEvents } = buildImportDrafts(events, opts)
  const duties = draftsToDutyEvents(drafts, {
    homeBaseTZ: opts.homeBaseTZ,
    acclTZ: opts.acclTZ,
  })
  const autoReports = drafts.filter((d) => d.reportSource !== 'buffers').length
  const summary = `Parsed ${duties.length} duty period${duties.length === 1 ? '' : 's'} (${drafts.reduce((n, d) => n + d.flights.length, 0)} flights). Report from schedule: ${autoReports}; from buffers: ${duties.length - autoReports}. Skipped ${skippedEvents.length} event${skippedEvents.length === 1 ? '' : 's'}.`
  return { duties, drafts, skippedEvents, summary }
}

/** Merge imported duties into existing, skipping time-overlapping duties. */
export function mergeImportedDuties(
  existing: DutyEvent[],
  imported: DutyEvent[],
): { events: DutyEvent[]; added: number; skippedOverlap: number } {
  let added = 0
  let skippedOverlap = 0
  const next = [...existing]
  for (const d of imported) {
    const overlaps = next.some(
      (e) =>
        e.type === 'duty' &&
        e.start.getTime() < d.end.getTime() &&
        e.end.getTime() > d.start.getTime(),
    )
    if (overlaps) {
      skippedOverlap++
      continue
    }
    next.push(d)
    added++
  }
  return { events: next, added, skippedOverlap }
}

export function replaceDutiesInRange(
  existing: DutyEvent[],
  imported: DutyEvent[],
  rangeStart: Date,
  rangeEnd: Date,
): DutyEvent[] {
  const dutiesToRemove = new Set(
    existing
      .filter(
        (e) =>
          e.type === 'duty' &&
          e.start.getTime() >= rangeStart.getTime() &&
          e.start.getTime() < rangeEnd.getTime(),
      )
      .map((e) => e.id),
  )
  const kept = existing.filter((e) => {
    if (e.type === 'duty') return !dutiesToRemove.has(e.id)
    if (e.type === 'rest' && e.id.endsWith('-rest')) {
      const dutyId = e.id.slice(0, -'-rest'.length)
      return !dutiesToRemove.has(dutyId)
    }
    return true
  })
  return [...kept, ...imported]
}