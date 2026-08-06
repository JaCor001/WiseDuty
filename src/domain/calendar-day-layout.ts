/**
 * One-pass calendar day layout for bars/markers/content height.
 * Pure: no React. Call once per schedule/view change, not per click.
 */
import type { DutyEvent, Regulator, TimeFormat } from './types'
import { phantomDisruptiveRestExtension } from './events'
import { buildEventsByDayKey, eventsOnDayKey } from './day-index'
import {
  buildDayTimeStamps,
  EVENT_BAR_HEIGHT_PCT,
  type DayTimeStampSpec,
  type TimeStampInput,
} from './time-stamps'
import {
  dayContentMinRem,
  elnHostKey,
  isElnMarkerType,
  isHostDayFor,
  markerBandTiers,
  markerVerticalRole,
  preferredMarkerLeftPct,
  preferredMarkerTopPct,
  resolveMarkerOverlaps,
  type MarkerLayoutInput,
} from './marker-layout'
import {
  eventsOverlap,
  fdpOperatingEnd,
  getDutyMarkers,
  markerBarAnchor,
  markerChipLabel,
  type DutyMarker,
} from './regulations'
import {
  evaluateFdpNearMaxLimit,
  fdpLimitDialogTone,
  type FdpDialogTone,
} from './fdp-near-limit'
import type { DisplaySdf } from './rest-70029'
import {
  addCivilDaysInTimeZone,
  dayBarPosition,
  getZonedTimeParts,
  startOfDayInTimeZone,
  toDateInputValueInTZ,
} from './time'

const BAR_TOP = 'var(--event-bar-top, 46%)'
const BAR_TOP_OVERLAP = 'var(--event-bar-top-overlap, 56%)'
const BAR_TOP_PCT = 46
const BAR_TOP_OVERLAP_PCT = 56

/**
 * Structural free-day rest (CAR 700.29, 2+ local nights) already draws an SDF
 * chip via getDutyMarkers. A displaySdf nested in that rest is the same free day
 * — attach its sheet metadata instead of rendering a second chip.
 */
function isStructuralSdfRest(event: DutyEvent): boolean {
  return (
    event.type === 'rest' &&
    event.restRule === 'CAR 700.29' &&
    (event.requiredLocalNights ?? 0) >= 2
  )
}

function restContainsSdf(
  rest: DutyEvent,
  sdf: DisplaySdf['sdf'],
): boolean {
  return (
    rest.start.getTime() <= sdf.start.getTime() &&
    rest.end.getTime() >= sdf.end.getTime()
  )
}

function findDisplaySdfForRest(
  rest: DutyEvent,
  displaySdfs: DisplaySdf[],
): DisplaySdf | undefined {
  if (!isStructuralSdfRest(rest)) return undefined
  return displaySdfs.find((d) => restContainsSdf(rest, d.sdf))
}

function isSdfCoveredByStructuralRest(
  sdf: DisplaySdf['sdf'],
  events: DutyEvent[],
): boolean {
  return events.some(
    (e) => isStructuralSdfRest(e) && restContainsSdf(e, sdf),
  )
}

/** Slack when treating rest as covering a full civil day (edge minutes). */
const REST_FULL_DAY_SLACK_MS = 30 * 60 * 1000

/**
 * True when required rest alone covers essentially the entire civil day, so no
 * FDP / reserve / standby can be accepted that day without overlapping rest.
 */
export function restsBlockFullCivilDay(
  dayEvents: DutyEvent[],
  dayStartMs: number,
  dayEndMs: number,
): boolean {
  if (dayEvents.length === 0) return false
  if (!dayEvents.every((e) => e.type === 'rest')) return false

  const segments = dayEvents
    .map((e) => ({
      a: Math.max(e.start.getTime(), dayStartMs),
      b: Math.min(e.end.getTime(), dayEndMs),
    }))
    .filter((iv) => iv.b > iv.a)
    .sort((x, y) => x.a - y.a)
  if (segments.length === 0) return false

  // Merge overlapping rest on this day
  const merged: { a: number; b: number }[] = []
  for (const iv of segments) {
    const last = merged[merged.length - 1]
    if (last && iv.a <= last.b + REST_FULL_DAY_SLACK_MS) {
      last.b = Math.max(last.b, iv.b)
    } else {
      merged.push({ ...iv })
    }
  }

  // Single merged block must span midnight→midnight (within slack)
  if (merged.length !== 1) return false
  const cover = merged[0]
  return (
    cover.a <= dayStartMs + REST_FULL_DAY_SLACK_MS &&
    cover.b >= dayEndMs - REST_FULL_DAY_SLACK_MS
  )
}

export interface PhantomSegment {
  key: string
  restId: string
  solidRestEnd: Date
  phantomStart: Date
  phantomEnd: Date
  thisDutyLabel: string
  ifNextLabel: string
  reason: string
}

export interface DayBarSpec {
  key: string
  eventId: string
  className: string
  left: string
  width: string
  top: string
  title: string
  /** event | phantom */
  kind: 'event' | 'phantom'
  phantom?: PhantomSegment
}

export interface DayMarkerSpec {
  key: string
  type: DutyMarker
  eventId: string
  className: string
  top: string
  left: string
  right: string
  maxWidth: string
  minWidth: number | string
  width: string
  label: string
  title: string
  ariaLabel: string
  /** rest | duty | sdf */
  sheet: 'rest' | 'duty' | 'sdf' | 'free' | 'aux'
  sdfProspective?: boolean
  sdfStartMs?: number
  sdfEndMs?: number
  sdfReasons?: string[]
}

export type { DayTimeStampSpec }

export interface DayLayoutSpec {
  dayKey: string
  dayStartMs: number
  dayEndMs: number
  dayNumber: number
  otherMonth: boolean
  contentMinRem: number
  bars: DayBarSpec[]
  markers: DayMarkerSpec[]
  /** Start/end clock labels with thin connectors to bar edges. */
  timeStamps: DayTimeStampSpec[]
  leaders: Array<{ key: string; left: string; top: string; height: string }>
  showViolation: boolean
  violationLeftPct: number
  status: 'white' | 'blue' | 'amber' | 'red'
}

export function buildPhantomSegments(
  events: DutyEvent[],
  regulator: Regulator,
  acclTZ: string,
): PhantomSegment[] {
  const dutiesSorted = events
    .filter((e) => e.type === 'duty')
    .sort((a, b) => a.start.getTime() - b.start.getTime())
  const rests = events.filter((e) => e.type === 'rest' && e.id.endsWith('-rest'))
  const out: PhantomSegment[] = []
  for (const rest of rests) {
    const dutyId = rest.id.slice(0, -'-rest'.length)
    const dutyIdx = dutiesSorted.findIndex((d) => d.id === dutyId)
    if (dutyIdx < 0) continue
    const phantom = phantomDisruptiveRestExtension(
      dutiesSorted[dutyIdx],
      rest,
      regulator,
      acclTZ,
      dutiesSorted[dutyIdx + 1],
    )
    if (!phantom || phantom.end.getTime() <= rest.end.getTime()) continue
    out.push({
      key: `${rest.id}-phantom`,
      restId: rest.id,
      solidRestEnd: rest.end,
      phantomStart: rest.end,
      phantomEnd: phantom.end,
      thisDutyLabel: phantom.thisDutyLabel,
      ifNextLabel: phantom.ifNextLabel,
      reason: phantom.reason,
    })
  }
  return out
}

export function buildScheduleLayout(
  days: Date[],
  viewMonth: Date,
  events: DutyEvent[],
  displaySdfs: DisplaySdf[],
  calendarTZ: string,
  regulator: Regulator,
  acclTZ: string,
  hostMap: Map<string, number>,
  phantoms: PhantomSegment[],
  violations: Array<{ windowEnd: Date }>,
  timeFormat: TimeFormat = '24h',
  /** Precomputed E/L/N host days (`eventId:type` → dayStartMs). */
  elnHostMap: Map<string, number> = new Map(),
): { byKey: Map<string, DayLayoutSpec>; sharedDayMinRem: number } {
  const viewParts = getZonedTimeParts(viewMonth, calendarTZ)
  const byKey = new Map<string, DayLayoutSpec>()
  let sharedMin = 2.75
  // One index for the month: O(events × span) then O(1) per day (not O(days×events))
  const eventsByDay = buildEventsByDayKey(events, calendarTZ)

  for (const date of days) {
    const dayKey = toDateInputValueInTZ(date, calendarTZ)
    const layout = buildOneDayLayout({
      date,
      viewYear: viewParts.year,
      viewMonth: viewParts.month,
      dayEvents: eventsOnDayKey(eventsByDay, dayKey),
      allEvents: events,
      displaySdfs,
      calendarTZ,
      regulator,
      acclTZ,
      hostMap,
      elnHostMap,
      phantoms,
      violations,
      timeFormat,
    })
    byKey.set(layout.dayKey, layout)
    sharedMin = Math.max(sharedMin, layout.contentMinRem)
  }

  return { byKey, sharedDayMinRem: Math.min(6.25, sharedMin) }
}

function buildOneDayLayout(opts: {
  date: Date
  viewYear: number
  viewMonth: number
  /** Pre-filtered events for this civil day (from day-index). */
  dayEvents: DutyEvent[]
  /** Full schedule for RAP auto-link (700.70) when evaluating ≈MAX. */
  allEvents: DutyEvent[]
  displaySdfs: DisplaySdf[]
  calendarTZ: string
  regulator: Regulator
  acclTZ: string
  hostMap: Map<string, number>
  elnHostMap: Map<string, number>
  phantoms: PhantomSegment[]
  violations: Array<{ windowEnd: Date }>
  timeFormat: TimeFormat
}): DayLayoutSpec {
  const {
    date,
    viewYear,
    viewMonth,
    dayEvents,
    allEvents,
    displaySdfs,
    calendarTZ,
    regulator,
    acclTZ,
    hostMap,
    elnHostMap,
    phantoms,
    violations,
    timeFormat,
  } = opts

  const dayStart = startOfDayInTimeZone(date, calendarTZ)
  const dayEnd = addCivilDaysInTimeZone(dayStart, calendarTZ, 1)
  const dayKey = toDateInputValueInTZ(date, calendarTZ)
  const dayStartMs = dayStart.getTime()
  const dayEndMs = dayEnd.getTime()
  const dayParts = getZonedTimeParts(date, calendarTZ)
  const bars: DayBarSpec[] = []
  const timeStampInputs: TimeStampInput[] = []
  type RawMarker = {
    type: DutyMarker
    eventId: string
    event: DutyEvent
    left: number
    width: number
    barTop: string
    barTopPct: number
    violated?: boolean
    sdfProspective?: boolean
    sdfReasons?: string[]
    sdfRef?: DisplaySdf['sdf']
    /** ≈MAX chip severity — matches AppDialog amber / danger chrome. */
    nearTone?: FdpDialogTone
  }
  const rawMarkers: RawMarker[] = []
  /** Per-duty ≈MAX tone so the chip can match the alert palette. */
  const nearToneByDutyId = new Map<string, FdpDialogTone>()

  dayEvents.forEach((event) => {
    let barTop = BAR_TOP
    let barTopPct = BAR_TOP_PCT
    if (event.type === 'rest') {
      const overlappingRest = dayEvents.find(
        (e) =>
          e.type === 'rest' &&
          e.id !== event.id &&
          eventsOverlap(e.start, e.end, event.start, event.end),
      )
      if (overlappingRest) {
        const thisDuration = event.end.getTime() - event.start.getTime()
        const otherDuration =
          overlappingRest.end.getTime() - overlappingRest.start.getTime()
        if (thisDuration > otherDuration) {
          barTop = BAR_TOP_OVERLAP
          barTopPct = BAR_TOP_OVERLAP_PCT
        }
      }
    }

    const isStart = event.start >= dayStart && event.start < dayEnd
    const isEnd = event.end > dayStart && event.end <= dayEnd
    const { left, width } = dayBarPosition(
      event.start,
      event.end,
      dayStart,
      dayEnd,
    )

    const dayKeyAccl = getZonedTimeParts(date, acclTZ).dayKey
    // Full ELN set for the duty; host day is chosen schedule-wide (roomier cell).
    const markers = getDutyMarkers(event, regulator, acclTZ, true, true)
    // Near Max FDP chip under the bar on operating/release day
    if (event.type === 'duty') {
      const tz = event.acclTZ || acclTZ
      const opEnd = fdpOperatingEnd(event)
      const endKey = getZonedTimeParts(opEnd, tz).dayKey
      if (endKey === dayKeyAccl) {
        const near = evaluateFdpNearMaxLimit(event, {
          regulator,
          globalAcclTZ: acclTZ,
          allEvents,
        })
        if (near.near && !markers.includes('NEAR')) {
          markers.push('NEAR')
          nearToneByDutyId.set(event.id, fdpLimitDialogTone(near))
        }
      }
    }
    const showRestChip =
      event.type !== 'rest' || isHostDayFor(hostMap, event.id, dayStartMs)
    const coveringDisplay =
      event.type === 'rest' ? findDisplaySdfForRest(event, displaySdfs) : undefined
    markers.forEach((marker) => {
      if (event.type === 'rest' && !showRestChip) return
      // E/L/N: roomier host day when precomputed; else natural start/end day
      if (isElnMarkerType(marker)) {
        const key = elnHostKey(event.id, marker)
        if (elnHostMap.has(key)) {
          if (!isHostDayFor(elnHostMap, key, dayStartMs)) return
        } else if (marker === 'E' && !isStart) {
          return
        } else if ((marker === 'L' || marker === 'N') && !isEnd) {
          return
        }
      }
      const attachSdf = marker === 'SDF' && coveringDisplay
      rawMarkers.push({
        type: marker,
        eventId: event.id,
        event,
        left,
        width,
        barTop,
        barTopPct,
        violated: event.violated,
        sdfProspective: attachSdf
          ? coveringDisplay.reasons.includes('prospective')
          : undefined,
        sdfReasons: attachSdf ? coveringDisplay.reasons : undefined,
        sdfRef: attachSdf ? coveringDisplay.sdf : undefined,
        nearTone:
          marker === 'NEAR' ? nearToneByDutyId.get(event.id) : undefined,
      })
    })

    const barClass =
      event.type === 'reserve'
        ? 'reserve'
        : event.type === 'standby'
          ? 'standby'
          : event.type === 'free'
            ? 'free'
            : event.type === 'rest' && event.restKind === 'split_break'
              ? 'rest rest-split'
              : event.type
    const spanClass = [
      !isStart ? 'event-bar--open-start' : '',
      !isEnd ? 'event-bar--open-end' : '',
    ]
      .filter(Boolean)
      .join(' ')

    bars.push({
      key: `${event.id}-${dayKey}`,
      eventId: event.id,
      className: `event-bar ${barClass}${spanClass ? ` ${spanClass}` : ''}${event.violated ? ' violated' : ''}`,
      left: `${left}%`,
      width: `${width}%`,
      top: barTop,
      title: event.title,
      kind: 'event',
    })

    // Start/end clock stamps on the civil day that owns the edge.
    // Do NOT gate on bar width: a rest ending 00:04 is only ~0.3% of the end
    // day, but the end stamp must still show (was dropped by width >= 0.4).
    // Multi-day open edges stay unstamped because isStart/isEnd are false there.
    if (isStart) {
      timeStampInputs.push({
        eventId: event.id,
        at: event.start,
        leftPct: left,
        edge: 'start',
        barTop,
        barTopPct,
      })
    }
    if (isEnd) {
      timeStampInputs.push({
        eventId: event.id,
        at: event.end,
        // Clamp so a near-midnight end never sits past the cell (float noise)
        leftPct: Math.min(100, Math.max(0, left + width)),
        edge: 'end',
        barTop,
        barTopPct,
      })
    }

    // Flight legs inside FDP: darker sub-segments on the same vertical band
    if (event.type === 'duty' && event.flights && event.flights.length > 0) {
      const legs = [...event.flights].sort(
        (a, b) => a.dep.getTime() - b.dep.getTime(),
      )
      legs.forEach((leg, legIdx) => {
        if (
          leg.arr.getTime() <= dayStartMs ||
          leg.dep.getTime() >= dayEndMs
        ) {
          return
        }
        const pos = dayBarPosition(leg.dep, leg.arr, dayStart, dayEnd)
        if (pos.width < 0.15) return
        const legStart = leg.dep.getTime() >= dayStartMs
        const legEnd = leg.arr.getTime() <= dayEndMs
        const legSpan = [
          !legStart ? 'event-bar--open-start' : '',
          !legEnd ? 'event-bar--open-end' : '',
        ]
          .filter(Boolean)
          .join(' ')
        const route = `${leg.depIcao}→${leg.arrIcao}`
        bars.push({
          key: `${event.id}-leg-${leg.id || legIdx}-${dayKey}`,
          eventId: event.id,
          className: `event-bar flight-leg${leg.isDeadhead ? ' flight-leg--dh' : ''}${legSpan ? ` ${legSpan}` : ''}`,
          left: `${pos.left}%`,
          width: `${pos.width}%`,
          top: barTop,
          title: leg.isDeadhead
            ? `${route} (deadhead / positioning)`
            : route,
          kind: 'event',
        })
      })
    }
  })

  // Phantoms (precomputed) clipped to this day
  for (const ph of phantoms) {
    if (
      ph.phantomEnd.getTime() <= dayStartMs ||
      ph.phantomStart.getTime() >= dayEndMs
    ) {
      continue
    }
    const { left: pLeft, width: pWidth } = dayBarPosition(
      ph.phantomStart,
      ph.phantomEnd,
      dayStart,
      dayEnd,
    )
    if (pWidth <= 0.15) continue
    const fromSolid =
      ph.phantomStart.getTime() >= dayStartMs &&
      ph.phantomStart.getTime() < dayEndMs
    const toEnd =
      ph.phantomEnd.getTime() > dayStartMs &&
      ph.phantomEnd.getTime() <= dayEndMs
    const roleClass = [
      fromSolid ? 'rest-phantom--from-solid' : '',
      toEnd ? 'rest-phantom--to-end' : '',
      !fromSolid && !toEnd ? 'rest-phantom--continue' : '',
    ]
      .filter(Boolean)
      .join(' ')

    let phantomTop = BAR_TOP
    const solidOnDay = dayEvents.find((e) => e.id === ph.restId)
    if (solidOnDay) {
      const overlappingRest = dayEvents.find(
        (e) =>
          e.type === 'rest' &&
          e.id !== ph.restId &&
          eventsOverlap(e.start, e.end, solidOnDay.start, solidOnDay.end),
      )
      if (overlappingRest) {
        const thisDuration =
          solidOnDay.end.getTime() - solidOnDay.start.getTime()
        const otherDuration =
          overlappingRest.end.getTime() - overlappingRest.start.getTime()
        if (thisDuration > otherDuration) phantomTop = BAR_TOP_OVERLAP
      }
    }

    bars.push({
      key: `${ph.key}-${dayKey}`,
      eventId: ph.restId,
      className: `event-bar rest-phantom ${roleClass}`,
      left: fromSolid ? `calc(${pLeft}% - 2px)` : `${pLeft}%`,
      width: fromSolid ? `calc(${pWidth}% + 2px)` : `${pWidth}%`,
      top: phantomTop,
      title: `Because this duty is ${ph.thisDutyLabel}: if next is ${ph.ifNextLabel} → LNR to ${ph.phantomEnd.toLocaleString()} (CAR 700.41)`,
      kind: 'phantom',
      phantom: ph,
    })
  }

  // SDF display chips (host day precomputed in hostMap under sdfId).
  // Skip when a structural CAR 700.29 rest already owns this free day —
  // that rest's chip is enriched with the same displaySdf metadata above.
  displaySdfs.forEach((display, index) => {
    const sdf = display.sdf
    if (isSdfCoveredByStructuralRest(sdf, dayEvents)) return
    const sdfId = `sdf-${sdf.start.toISOString()}-${index}`
    if (
      sdf.end.getTime() <= dayStartMs ||
      sdf.start.getTime() >= dayEndMs
    ) {
      return
    }
    if (!isHostDayFor(hostMap, sdfId, dayStartMs)) return
    const prospective = display.reasons.includes('prospective')
    const { left, width } = dayBarPosition(
      sdf.start,
      sdf.end,
      dayStart,
      dayEnd,
    )
    rawMarkers.push({
      type: 'SDF',
      eventId: sdfId,
      event: {
        id: sdfId,
        title: 'SDF',
        type: 'free',
        start: sdf.start,
        end: sdf.end,
      },
      left,
      width,
      barTop: BAR_TOP,
      barTopPct: BAR_TOP_PCT,
      sdfProspective: prospective,
      sdfReasons: display.reasons,
      sdfRef: sdf,
    })
  })

  // Time stamps live above the bar; E/L/N and rest chips share the below band.
  const timeStamps = buildDayTimeStamps(timeStampInputs, {
    tz: calendarTZ,
    timeFormat,
  })

  const chipHPct = 13
  const chipWNarrowPct = 18
  const chipWWidePct = 28
  const barHPct = EVENT_BAR_HEIGHT_PCT
  const cellGapPct = 3
  const barChipGapPx = 4
  const minTopPct = 18
  const maxBottomPct = 97
  const edgeGapCss = 'var(--marker-gap, 6px)'

  // Prefer duty chips closer to the bar, then rest — reduces visual collision
  // when E/L/N and RR/LNR share a day (stack order in resolveMarkerOverlaps).
  const markerPriority = (type: DutyMarker): number => {
    if (type === 'E' || type === 'L' || type === 'N') return 0
    if (type === 'NEAR') return 1
    return 2
  }
  const orderedRaw = rawMarkers
    .map((m, index) => ({ m, index }))
    .sort((a, b) => {
      const p = markerPriority(a.m.type) - markerPriority(b.m.type)
      if (p !== 0) return p
      return a.m.left - b.m.left
    })

  const layoutInputs: MarkerLayoutInput[] = orderedRaw.map(({ m: marker, index }) => {
    const role = markerVerticalRole(marker.type)
    const restMarker =
      marker.type === 'LNR' ||
      marker.type === 'LNR2' ||
      marker.type === 'LNR3' ||
      marker.type === 'RR' ||
      marker.type === 'SDF'
    const isWide =
      marker.type === 'LNR2' ||
      marker.type === 'LNR3' ||
      marker.type === 'SDF' ||
      marker.type === 'NEAR' ||
      (marker.violated && restMarker)
    // End-anchored chips need a wider layout budget so labels like ≈MAX
    // are not clipped at the day-cell edge.
    const widthPct =
      marker.type === 'NEAR'
        ? Math.max(chipWWidePct, 22)
        : isWide
          ? chipWWidePct
          : chipWNarrowPct
    const anchor = markerBarAnchor(marker.type)
    // Extra edge inset for end-anchored chips (especially NEAR)
    const edgeGapPct =
      anchor === 'end' ? Math.max(cellGapPct, 5) : cellGapPct
    const leftPct = preferredMarkerLeftPct(
      marker.left,
      marker.width,
      widthPct,
      anchor,
      edgeGapPct,
    )
    const preferredTopPct = preferredMarkerTopPct(
      role,
      marker.barTopPct,
      barHPct,
      chipHPct,
      cellGapPct,
      minTopPct,
      maxBottomPct,
    )
    let barAttachXPct = marker.left + marker.width / 2
    if (anchor === 'start') barAttachXPct = marker.left
    else if (anchor === 'end') barAttachXPct = marker.left + marker.width
    return {
      id: `${marker.eventId}-${marker.type}-${index}`,
      role,
      preferredTopPct,
      leftPct,
      widthPct,
      heightPct: chipHPct,
      barTopPct: marker.barTopPct,
      barHPct,
      barAttachXPct,
      // E/L/N never get leader lines — stay associated via duty-aligned X
      allowLeader: !isElnMarkerType(marker.type),
    }
  })

  // Stack below-bar chips (E/L/N + rest + ≈MAX) so they don't overlap
  const resolved = resolveMarkerOverlaps(layoutInputs, {
    gapPct: 1.8,
    minTopPct,
    maxBottomPct,
    leaderThresholdPct: 4,
  })

  const markers: DayMarkerSpec[] = []
  const leaders: DayLayoutSpec['leaders'] = []

  rawMarkers.forEach((marker, index) => {
    const layoutId = `${marker.eventId}-${marker.type}-${index}`
    const place = resolved.find((r) => r.id === layoutId)
    const layoutIn = layoutInputs.find((l) => l.id === layoutId)
    if (!place || !layoutIn) return

    const restMarker =
      marker.type === 'LNR' ||
      marker.type === 'LNR2' ||
      marker.type === 'LNR3' ||
      marker.type === 'RR' ||
      marker.type === 'SDF'
    const isWide =
      marker.type === 'LNR2' ||
      marker.type === 'LNR3' ||
      marker.type === 'SDF' ||
      marker.type === 'NEAR' ||
      (marker.violated && restMarker)
    const violatedClass = marker.violated && restMarker
    const chipH = 'var(--marker-chip-height, 1.2em)'
    const barTopCss = marker.barTop
    const anchor = markerBarAnchor(marker.type)
    // Below-bar chips: preferred top is under the bar; stack offset is the
    // delta from preferredTop after resolveMarkerOverlaps.
    const top =
      place.role === 'above'
        ? `${place.topPct}%`
        : `calc(${barTopCss} + var(--event-bar-height) + ${barChipGapPx}px + ${place.topPct - layoutIn.preferredTopPct}%)`
    const chipW =
      marker.type === 'NEAR'
        ? 'var(--marker-chip-width-near, 2.65em)'
        : isWide
          ? 'var(--marker-chip-width-wide, 2.4em)'
          : 'var(--marker-chip-width, 1.55em)'
    // Larger inset for end-anchored chips so ≈MAX is not clipped by the cell edge
    const edgeInset =
      anchor === 'end' || marker.type === 'NEAR'
        ? 'var(--marker-edge-inset, 10px)'
        : edgeGapCss
    const maxWidthCss = `calc(100% - 2 * ${edgeInset})`

    // Always use resolved left so lateral deconflict against stamps is applied
    // (start/end anchors previously ignored place.leftPct).
    const leftStyle = `clamp(${edgeInset}, ${place.leftPct}%, calc(100% - ${edgeInset} - ${chipW}))`
    const rightStyle = 'auto'

    // Leader lines only for below-bar rest markers (RR/LNR/SDF). E/L/N stay
    // associated by duty-aligned X — no thin lines to bars.
    if (place.leader && place.role === 'below') {
      const { x1, y1, y2 } = place.leader
      const topY = Math.min(y1, y2)
      const height = Math.abs(y2 - y1)
      if (height > 0.4) {
        leaders.push({
          key: `leader-${layoutId}`,
          left: `clamp(${edgeInset}, ${x1}%, calc(100% - ${edgeInset}))`,
          top: `${topY}%`,
          height: `${height}%`,
        })
      }
    }

    const nearTone = marker.nearTone
    const nearToneClass =
      marker.type === 'NEAR'
        ? nearTone === 'danger'
          ? ' NEAR-danger'
          : ' NEAR-amber'
        : ''
    const label =
      marker.type === 'SDF' && marker.sdfProspective
        ? 'SDF?'
        : marker.type === 'NEAR' && nearTone === 'danger'
          ? 'MAX!'
          : markerChipLabel(marker.type, marker.violated)

    markers.push({
      key: layoutId,
      type: marker.type,
      eventId: marker.eventId,
      className: `marker marker-anchored marker-button ${marker.type}${violatedClass ? ' LNR-violated' : ''}${marker.sdfProspective ? ' SDF-prospective' : ''}${nearToneClass}`,
      top,
      left: leftStyle,
      right: rightStyle,
      maxWidth: maxWidthCss,
      minWidth: 0,
      width: 'max-content',
      label,
      title: marker.sdfRef
        ? marker.sdfProspective
          ? 'Single day free from duty needed before further duty (CAR 700.29) — tap for details'
          : 'Single day free from duty (CAR 700.29) — tap for details'
        : marker.type === 'NEAR'
          ? nearTone === 'danger'
            ? 'At or past Max FDP — tap for extension / UOC guidelines'
            : 'Near Max FDP — tap for extension / UOC guidelines'
          : `${marker.type} — tap for definition`,
      ariaLabel:
        marker.type === 'NEAR'
          ? nearTone === 'danger'
            ? 'Max FDP limit. Tap for extension and UOC guidelines.'
            : 'Near Max FDP. Tap for extension and UOC guidelines.'
          : `${marker.type}. Tap for definition and why it applies.`,
      sheet: marker.sdfRef
        ? 'sdf'
        : marker.event.type === 'rest'
          ? 'rest'
          : marker.event.type === 'duty'
            ? 'duty'
            : 'aux',
      sdfProspective: marker.sdfProspective,
      sdfStartMs: marker.sdfRef?.start.getTime(),
      sdfEndMs: marker.sdfRef?.end.getTime(),
      sdfReasons: marker.sdfReasons,
    })
  })

  const contentMinRem = dayContentMinRem({
    hasBar: bars.length > 0,
    aboveTiers: markerBandTiers(resolved, 'above'),
    belowTiers: markerBandTiers(resolved, 'below'),
  })

  // Status + violation icon
  // Purple (amber class) only when the day is rest-only *and* required rest
  // covers the full civil day — no FDP/reserve/standby can be accepted that day.
  // Partial rest ends (e.g. 12 h overnight) and awareness-only SDF chips stay white.
  let status: DayLayoutSpec['status'] = 'white'
  if (dayEvents.some((e) => e.violated)) status = 'red'
  else if (
    violations.some((v) => v.windowEnd >= dayStart && v.windowEnd < dayEnd)
  )
    status = 'red'
  else if (dayEvents.some((e) => e.type === 'duty')) status = 'blue'
  else if (restsBlockFullCivilDay(dayEvents, dayStartMs, dayEndMs))
    status = 'amber'

  let violationLeftPct = 0
  const violatedDuty = dayEvents.find((e) => e.violated && e.type === 'duty')
  let violatedLNR: DutyEvent | undefined
  if (!violatedDuty) {
    violatedLNR = dayEvents.find(
      (e) => e.violated && e.type === 'rest' && e.isLocalNightRest,
    )
  }
  if (violatedDuty) {
    const overlappingRest = dayEvents.find(
      (e) =>
        e.type === 'rest' &&
        eventsOverlap(
          violatedDuty.start,
          violatedDuty.end,
          e.start,
          e.end,
        ),
    )
    if (overlappingRest) {
      const overlapStart = new Date(
        Math.max(
          violatedDuty.start.getTime(),
          overlappingRest.start.getTime(),
        ),
      )
      const overlapHour =
        (overlapStart.getTime() - dayStartMs) / (1000 * 60 * 60)
      violationLeftPct = (overlapHour / 24) * 100
    }
  } else if (violatedLNR) {
    const overlappingDuty = dayEvents.find(
      (e) =>
        e.type === 'duty' &&
        eventsOverlap(
          violatedLNR!.start,
          violatedLNR!.end,
          e.start,
          e.end,
        ),
    )
    if (overlappingDuty) {
      const overlapStart = new Date(
        Math.max(
          violatedLNR.start.getTime(),
          overlappingDuty.start.getTime(),
        ),
      )
      const overlapHour =
        (overlapStart.getTime() - dayStartMs) / (1000 * 60 * 60)
      violationLeftPct = (overlapHour / 24) * 100
    }
  }

  const showViolation =
    dayEvents.some((e) => e.violated) ||
    violations.some((v) => v.windowEnd >= dayStart && v.windowEnd < dayEnd)

  return {
    dayKey,
    dayStartMs,
    dayEndMs,
    dayNumber: dayParts.day,
    otherMonth:
      dayParts.month !== viewMonth || dayParts.year !== viewYear,
    contentMinRem,
    bars,
    markers,
    timeStamps,
    leaders,
    showViolation,
    violationLeftPct,
    status,
  }
}
