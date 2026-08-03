/**
 * One-pass calendar day layout for bars/markers/content height.
 * Pure: no React. Call once per schedule/view change, not per click.
 */
import type { DutyEvent, Regulator } from './types'
import { phantomDisruptiveRestExtension } from './events'
import { buildEventsByDayKey, eventsOnDayKey } from './day-index'
import {
  dayContentMinRem,
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
  getDutyMarkers,
  markerBarAnchor,
  markerChipLabel,
  type DutyMarker,
} from './regulations'
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

export interface DayLayoutSpec {
  dayKey: string
  dayStartMs: number
  dayEndMs: number
  dayNumber: number
  otherMonth: boolean
  contentMinRem: number
  bars: DayBarSpec[]
  markers: DayMarkerSpec[]
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
      displaySdfs,
      calendarTZ,
      regulator,
      acclTZ,
      hostMap,
      phantoms,
      violations,
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
  displaySdfs: DisplaySdf[]
  calendarTZ: string
  regulator: Regulator
  acclTZ: string
  hostMap: Map<string, number>
  phantoms: PhantomSegment[]
  violations: Array<{ windowEnd: Date }>
}): DayLayoutSpec {
  const {
    date,
    viewYear,
    viewMonth,
    dayEvents,
    displaySdfs,
    calendarTZ,
    regulator,
    acclTZ,
    hostMap,
    phantoms,
    violations,
  } = opts

  const dayStart = startOfDayInTimeZone(date, calendarTZ)
  const dayEnd = addCivilDaysInTimeZone(dayStart, calendarTZ, 1)
  const dayKey = toDateInputValueInTZ(date, calendarTZ)
  const dayStartMs = dayStart.getTime()
  const dayEndMs = dayEnd.getTime()
  const dayParts = getZonedTimeParts(date, calendarTZ)
  const bars: DayBarSpec[] = []
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
  }
  const rawMarkers: RawMarker[] = []

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
    const markers = getDutyMarkers(
      event,
      regulator,
      acclTZ,
      isStart,
      isEnd,
      dayKeyAccl,
    )
    const showRestChip =
      event.type !== 'rest' || isHostDayFor(hostMap, event.id, dayStartMs)
    const coveringDisplay =
      event.type === 'rest' ? findDisplaySdfForRest(event, displaySdfs) : undefined
    markers.forEach((marker) => {
      if (event.type === 'rest' && !showRestChip) return
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

  const chipHPct = 13
  const chipWNarrowPct = 18
  const chipWWidePct = 28
  const barHPct = 10
  const cellGapPct = 3
  const barChipGapPx = 4
  const minTopPct = 22
  const maxBottomPct = 97
  const edgeGapCss = 'var(--marker-gap, 6px)'

  const layoutInputs: MarkerLayoutInput[] = rawMarkers.map((marker, index) => {
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
      (marker.violated && restMarker)
    const widthPct = isWide ? chipWWidePct : chipWNarrowPct
    const anchor = markerBarAnchor(marker.type)
    const leftPct = preferredMarkerLeftPct(
      marker.left,
      marker.width,
      widthPct,
      anchor,
      cellGapPct,
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
    }
  })

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
      (marker.violated && restMarker)
    const violatedClass = marker.violated && restMarker
    const chipH = 'var(--marker-chip-height, 1.2em)'
    const barTopCss = marker.barTop
    const anchor = markerBarAnchor(marker.type)
    const stackDeltaPct = place.topPct - layoutIn.preferredTopPct
    const top =
      place.role === 'above'
        ? `calc(${barTopCss} - ${chipH} - ${barChipGapPx}px + ${stackDeltaPct}%)`
        : `calc(${barTopCss} + var(--event-bar-height) + ${barChipGapPx}px + ${stackDeltaPct}%)`
    const chipW = isWide
      ? 'var(--marker-chip-width-wide, 2.4em)'
      : 'var(--marker-chip-width, 1.55em)'
    const maxWidthCss = `calc(100% - 2 * ${edgeGapCss})`
    let preferredLeft: string
    if (anchor === 'end') {
      const barRightPct = Math.min(100, marker.left + marker.width)
      preferredLeft = `calc(${barRightPct}% - ${chipW})`
    } else if (anchor === 'start') {
      preferredLeft = `${marker.left}%`
    } else {
      preferredLeft = `${place.leftPct}%`
    }
    const leftStyle = `clamp(${edgeGapCss}, ${preferredLeft}, calc(100% - ${edgeGapCss} - ${chipW}))`

    if (place.leader) {
      const { x1, y1, y2 } = place.leader
      const topY = Math.min(y1, y2)
      const height = Math.abs(y2 - y1)
      if (height > 0.4) {
        leaders.push({
          key: `leader-${layoutId}`,
          left: `clamp(${edgeGapCss}, ${x1}%, calc(100% - ${edgeGapCss}))`,
          top: `${topY}%`,
          height: `${height}%`,
        })
      }
    }

    const label =
      marker.type === 'SDF' && marker.sdfProspective
        ? 'SDF?'
        : markerChipLabel(marker.type, marker.violated)

    markers.push({
      key: layoutId,
      type: marker.type,
      eventId: marker.eventId,
      className: `marker marker-anchored marker-button ${marker.type}${violatedClass ? ' LNR-violated' : ''}${marker.sdfProspective ? ' SDF-prospective' : ''}`,
      top,
      left: leftStyle,
      right: 'auto',
      maxWidth: maxWidthCss,
      minWidth: 0,
      width: 'max-content',
      label,
      title: marker.sdfRef
        ? marker.sdfProspective
          ? 'Single day free from duty needed before further duty (CAR 700.29) — tap for details'
          : 'Single day free from duty (CAR 700.29) — tap for details'
        : `${marker.type} — tap for definition`,
      ariaLabel: `${marker.type}. Tap for definition and why it applies.`,
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
  let status: DayLayoutSpec['status'] = 'white'
  if (dayEvents.some((e) => e.violated)) status = 'red'
  else if (
    violations.some((v) => v.windowEnd >= dayStart && v.windowEnd < dayEnd)
  )
    status = 'red'
  else if (dayEvents.some((e) => e.type === 'duty')) status = 'blue'
  else if (
    dayEvents.some((e) => e.type === 'rest') ||
    displaySdfs.some((d) => d.sdf.start < dayEnd && d.sdf.end > dayStart)
  )
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
    leaders,
    showViolation,
    violationLeftPct,
    status,
  }
}
