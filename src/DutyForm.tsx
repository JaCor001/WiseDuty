/**
 * Unified Add/Edit Event form.
 * Event-type dropdown at top; fields adapt per kind.
 * Reserve/standby can hand off to a following FDP via Add Flight.
 */
import { useEffect, useMemo, useState } from 'react'
import { getAirportByIcao } from './domain/airports'
import { lastFdpArrivalIcao } from './domain/events'
import {
  deriveFdpFromFlights,
  newEmptyFlightLeg,
  reportDayRelativeHint,
  resolveReleaseDateTimeFromTime,
  resolveReportDateTimeFromTime,
  selectReleaseBufferMin,
  selectReportBufferMin,
} from './domain/fdp-from-flights'
import { assertPositioningAllowed } from './domain/rest-70043'
import type {
  DutyEvent,
  DutyTimingBuffers,
  EventKind,
  FlightLeg,
  Regulator,
  RestType,
  SplitDutyBreak,
  TimeFormat,
} from './domain/types'
import {
  EVENT_KIND_ORDER,
  fieldsForEventKind,
  inferEventKind,
  isNonFlightDutyKind,
  isReserveOrStandbyKind,
  titleForEventKind,
} from './domain/types'
import { shiftEventFormPayload } from './domain/clone-event'
import {
  daysBetweenDateInputValues,
  formatHHmmInTZ,
  formatTimeDisplay,
  parseZonedDateTime,
  toDateInputValueInTZ,
} from './domain/time'
import FreeTimeInput from './shared/ui/FreeTimeInput'
import AirportSelector from './shared/ui/AirportSelector'
import './DutyForm.css'

export interface DutyFormDraftLeg {
  id: string
  depIcao: string
  arrIcao: string
  depDate: string
  depTime: string
  arrDate: string
  arrTime: string
  isDeadhead: boolean
  customsPreclearance: boolean
}

/** Snapshot of values that became irrelevant after a type switch. */
export interface StaleFieldLine {
  key: string
  label: string
  value: string
}

export interface EventFormSubmitPayload {
  eventKind: EventKind
  /** When set, save a reserve/standby first, then the FDP. */
  prefixReserve?: {
    eventKind: EventKind
    start: Date
    end: Date
    locationIcao?: string
  }
  duty: Omit<DutyEvent, 'id' | 'title' | 'type' | 'violated'> & {
    title?: string
    type?: DutyEvent['type']
    eventKind?: EventKind
  }
  restType: RestType
}

export interface DutyFormProps {
  mode: 'add' | 'edit'
  dutyDateLabel: string
  /** YYYY-MM-DD default for first flight (calendar day). */
  defaultDayKey: string
  timeFormat: TimeFormat
  regulator: Regulator
  acclTZ: string
  homeBaseTZ: string
  buffers: DutyTimingBuffers
  editEvent?: DutyEvent | null
  /** Prior schedule duties (for CAR 700.28(5) acclimatization / Max FDP). */
  priorDuties?: DutyEvent[]
  restType: RestType
  onRestTypeChange: (v: RestType) => void
  validationMessage: string
  onCancel: () => void
  onSubmit: (payload: EventFormSubmitPayload) => void
  /**
   * Always creates a new event from the (already shifted) payload; form stays open.
   * Return false when validation blocked the clone (weekly limit, etc.).
   */
  onClone: (
    payload: EventFormSubmitPayload,
  ) => boolean | void | Promise<boolean | void>
}

function draftFromLeg(leg: FlightLeg, fallbackDay: string): DutyFormDraftLeg {
  const depAp = getAirportByIcao(leg.depIcao)
  const arrAp = getAirportByIcao(leg.arrIcao)
  const depTz = depAp?.tz || 'UTC'
  const arrTz = arrAp?.tz || depTz
  return {
    id: leg.id,
    depIcao: leg.depIcao,
    arrIcao: leg.arrIcao,
    depDate: toDateInputValueInTZ(leg.dep, depTz) || fallbackDay,
    depTime: formatHHmmInTZ(leg.dep, depTz),
    arrDate: toDateInputValueInTZ(leg.arr, arrTz) || fallbackDay,
    arrTime: formatHHmmInTZ(leg.arr, arrTz),
    isDeadhead: !!leg.isDeadhead,
    customsPreclearance: !!leg.customsPreclearance,
  }
}

function emptyDraft(
  dayKey: string,
  opts?: { id?: string; depIcao?: string },
): DutyFormDraftLeg {
  return {
    id: opts?.id || newEmptyFlightLeg().id,
    depIcao: opts?.depIcao || '',
    arrIcao: '',
    depDate: dayKey,
    depTime: '',
    arrDate: dayKey,
    arrTime: '',
    isDeadhead: false,
    customsPreclearance: false,
  }
}

/** Seed first-leg dep from last arrival of the previous FDP (overridable). */
function seedDepFromPriorFdp(
  priorDuties: DutyEvent[],
  excludeId?: string,
): string {
  return (
    lastFdpArrivalIcao(priorDuties, { excludeId }) ||
    ''
  )
}

function emptyDraftForNewFdp(
  dayKey: string,
  priorDuties: DutyEvent[],
  excludeId?: string,
): DutyFormDraftLeg {
  return emptyDraft(dayKey, {
    depIcao: seedDepFromPriorFdp(priorDuties, excludeId),
  })
}

function draftToFlightLeg(d: DutyFormDraftLeg): FlightLeg | null {
  if (!d.depIcao || !d.arrIcao || !d.depTime || !d.arrTime) return null
  const depAp = getAirportByIcao(d.depIcao)
  const arrAp = getAirportByIcao(d.arrIcao)
  if (!depAp || !arrAp) return null
  const dep = parseZonedDateTime(d.depDate, d.depTime, depAp.tz)
  const arr = parseZonedDateTime(d.arrDate, d.arrTime, arrAp.tz)
  if (isNaN(dep.getTime()) || isNaN(arr.getTime())) return null
  return {
    id: d.id,
    depIcao: d.depIcao,
    arrIcao: d.arrIcao,
    dep,
    arr,
    isDeadhead: d.isDeadhead,
    customsPreclearance: d.customsPreclearance,
  }
}

/** Where a draft leg sits relative to a mid-FDP split break. */
type SplitBucket = 'pre' | 'post' | 'overlap'

function bucketLegVsSplit(
  leg: DutyFormDraftLeg,
  index: number,
  br: SplitDutyBreak | null,
  fallbackTZ: string,
): SplitBucket {
  if (!br) return 'pre'
  const parsed = draftToFlightLeg(leg)
  if (parsed) {
    if (parsed.arr.getTime() <= br.start.getTime() + 1000) return 'pre'
    if (parsed.dep.getTime() >= br.end.getTime() - 1000) return 'post'
    return 'overlap'
  }
  const depTz =
    (leg.depIcao && getAirportByIcao(leg.depIcao)?.tz) || fallbackTZ
  const arrTz =
    (leg.arrIcao && getAirportByIcao(leg.arrIcao)?.tz) || fallbackTZ
  if (leg.depDate && leg.depTime) {
    const dep = parseZonedDateTime(leg.depDate, leg.depTime, depTz)
    if (!isNaN(dep.getTime()) && dep.getTime() >= br.end.getTime() - 1000) {
      return 'post'
    }
  }
  if (leg.arrDate && leg.arrTime) {
    const arr = parseZonedDateTime(leg.arrDate, leg.arrTime, arrTz)
    if (!isNaN(arr.getTime()) && arr.getTime() <= br.start.getTime() + 1000) {
      return 'pre'
    }
  }
  // Incomplete legs after the first: treat as post-break when split is on
  return index > 0 ? 'post' : 'pre'
}

function formatDur(ms: number): string {
  if (!(ms > 0)) return '—'
  const m = Math.round(ms / 60_000)
  const h = Math.floor(m / 60)
  const mm = m % 60
  if (h === 0) return `${mm}m`
  return mm ? `${h}h ${mm}m` : `${h}h`
}

function legSummary(legs: DutyFormDraftLeg[]): string {
  const parts = legs
    .filter((l) => l.depIcao || l.arrIcao || l.depTime || l.arrTime)
    .map((l, i) => {
      const route =
        l.depIcao || l.arrIcao
          ? `${l.depIcao || '???'}→${l.arrIcao || '???'}`
          : 'incomplete'
      const times =
        l.depTime || l.arrTime
          ? ` ${l.depTime || '—'}–${l.arrTime || '—'}`
          : ''
      return `Flight ${i + 1}: ${route}${times}`
    })
  return parts.join('; ')
}

function defaultStartEndForKind(
  kind: EventKind,
): { startTime: string; endTime: string } {
  if (isReserveOrStandbyKind(kind))
    return { startTime: '08:00', endTime: '18:00' }
  if (isNonFlightDutyKind(kind))
    return { startTime: '08:00', endTime: '16:00' }
  return { startTime: '', endTime: '' }
}

export default function DutyForm({
  mode,
  dutyDateLabel,
  defaultDayKey,
  timeFormat,
  regulator,
  acclTZ,
  homeBaseTZ,
  buffers,
  editEvent,
  priorDuties = [],
  restType,
  onRestTypeChange,
  validationMessage,
  onCancel,
  onSubmit,
  onClone,
}: DutyFormProps) {
  const [eventKind, setEventKind] = useState<EventKind>(() =>
    editEvent ? inferEventKind(editEvent) : 'flight_duty',
  )
  /** After Add Flight from reserve/stby: show FDP fields + prefix summary. */
  const [fdpHandoff, setFdpHandoff] = useState(false)
  const [handoffKind, setHandoffKind] = useState<EventKind | null>(null)

  const [legs, setLegs] = useState<DutyFormDraftLeg[]>(() => [
    editEvent
      ? emptyDraft(defaultDayKey)
      : emptyDraftForNewFdp(defaultDayKey, priorDuties),
  ])
  const [reportTime, setReportTime] = useState('')
  const [reportDate, setReportDate] = useState(defaultDayKey)
  const [releaseTime, setReleaseTime] = useState('')
  const [releaseDate, setReleaseDate] = useState(defaultDayKey)
  const [reportOverridden, setReportOverridden] = useState(false)
  const [releaseOverridden, setReleaseOverridden] = useState(false)
  const [positioningAgreed, setPositioningAgreed] = useState(false)

  // Simple start/end for non-flight kinds
  const [startDate, setStartDate] = useState(defaultDayKey)
  const [startTime, setStartTime] = useState('08:00')
  const [endDate, setEndDate] = useState(defaultDayKey)
  const [endTime, setEndTime] = useState('18:00')
  const [locationIcao, setLocationIcao] = useState('')

  const [staleLines, setStaleLines] = useState<StaleFieldLine[]>([])
  const [localError, setLocalError] = useState('')
  const [showClonePicker, setShowClonePicker] = useState(false)
  const [cloneTargetDate, setCloneTargetDate] = useState(defaultDayKey)
  const [cloneMessage, setCloneMessage] = useState('')
  /** Expand Max FDP calculation details in the summary block. */
  const [fdpDetailsOpen, setFdpDetailsOpen] = useState(false)

  // CAR 700.50 split-duty break (mid-FDP)
  const [splitEnabled, setSplitEnabled] = useState(false)
  const [splitStartDate, setSplitStartDate] = useState(defaultDayKey)
  const [splitStartTime, setSplitStartTime] = useState('')
  const [splitEndDate, setSplitEndDate] = useState(defaultDayKey)
  const [splitEndTime, setSplitEndTime] = useState('')
  const [splitLocationIcao, setSplitLocationIcao] = useState('')
  const [splitUoc, setSplitUoc] = useState(false)

  // Hydrate from edit event once
  useEffect(() => {
    if (!editEvent) return
    const kind = inferEventKind(editEvent)
    setEventKind(kind)
    setFdpHandoff(false)
    setHandoffKind(null)

    if (editEvent.flights && editEvent.flights.length > 0) {
      setLegs(editEvent.flights.map((f) => draftFromLeg(f, defaultDayKey)))
    } else {
      // Edit without stored legs: still offer carry-forward from prior FDP
      setLegs([
        emptyDraftForNewFdp(defaultDayKey, priorDuties, editEvent.id),
      ])
    }
    const sTz = editEvent.startTZ || editEvent.acclTZ || acclTZ
    const eTz = editEvent.endTZ || editEvent.acclTZ || acclTZ
    setReportDate(toDateInputValueInTZ(editEvent.start, sTz))
    setReportTime(formatHHmmInTZ(editEvent.start, sTz))
    setReleaseDate(toDateInputValueInTZ(editEvent.end, eTz))
    setReleaseTime(formatHHmmInTZ(editEvent.end, eTz))
    setReportOverridden(
      !!editEvent.reportOverridden || !editEvent.flights?.length,
    )
    setReleaseOverridden(
      !!editEvent.releaseOverridden || !editEvent.flights?.length,
    )
    setPositioningAgreed(!!editEvent.positioningAgreed)
    setStartDate(toDateInputValueInTZ(editEvent.start, sTz))
    setStartTime(formatHHmmInTZ(editEvent.start, sTz))
    setEndDate(toDateInputValueInTZ(editEvent.end, eTz))
    setEndTime(formatHHmmInTZ(editEvent.end, eTz))
    setLocationIcao(editEvent.locationIcao || '')
    if (editEvent.splitBreak) {
      const br = editEvent.splitBreak
      const brTz =
        (br.locationIcao && getAirportByIcao(br.locationIcao)?.tz) ||
        eTz ||
        acclTZ
      setSplitEnabled(true)
      setSplitStartDate(toDateInputValueInTZ(br.start, brTz))
      setSplitStartTime(formatHHmmInTZ(br.start, brTz))
      setSplitEndDate(toDateInputValueInTZ(br.end, brTz))
      setSplitEndTime(formatHHmmInTZ(br.end, brTz))
      setSplitLocationIcao(br.locationIcao || '')
      setSplitUoc(!!br.unforeseenReplan)
    } else {
      setSplitEnabled(false)
      setSplitStartTime('')
      setSplitEndTime('')
      setSplitLocationIcao('')
      setSplitUoc(false)
    }
    setStaleLines([])
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate on open only
  }, [editEvent?.id])

  const activeKind: EventKind = fdpHandoff ? 'flight_duty' : eventKind
  const fieldSet = fieldsForEventKind(activeKind)
  const showFlights = fieldSet.has('flights') || fdpHandoff
  const showReportRelease = fieldSet.has('reportRelease') || fdpHandoff
  const showFdpSummary = fieldSet.has('fdpSummary') || fdpHandoff
  const showRestType = fieldSet.has('restType') || fdpHandoff
  const showStartEnd =
    fieldSet.has('startEnd') &&
    !showReportRelease &&
    !fdpHandoff
  // During handoff, still show reserve end as summary; start/end for RSV edited before handoff
  const showLocation = fieldSet.has('location') && !fdpHandoff
  const showAddFlightHandoff =
    fieldSet.has('addFlightHandoff') && !fdpHandoff && mode === 'add'

  const parsedLegs: FlightLeg[] = useMemo(() => {
    return legs
      .map(draftToFlightLeg)
      .filter((f): f is FlightLeg => f != null)
  }, [legs])

  const parsedSplitBreak: SplitDutyBreak | null = useMemo(() => {
    if (!splitEnabled || !splitStartDate || !splitStartTime || !splitEndDate || !splitEndTime) {
      return null
    }
    const tz =
      (splitLocationIcao && getAirportByIcao(splitLocationIcao)?.tz) ||
      (parsedLegs[0] && getAirportByIcao(parsedLegs[0].arrIcao)?.tz) ||
      acclTZ
    const start = parseZonedDateTime(splitStartDate, splitStartTime, tz)
    const end = parseZonedDateTime(splitEndDate, splitEndTime, tz)
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return null
    return {
      start,
      end,
      locationIcao: splitLocationIcao || undefined,
      unforeseenReplan: splitUoc || undefined,
    }
  }, [
    splitEnabled,
    splitStartDate,
    splitStartTime,
    splitEndDate,
    splitEndTime,
    splitLocationIcao,
    splitUoc,
    parsedLegs,
    acclTZ,
  ])

  /** First departure used to infer report date (complete leg or draft). */
  const firstDepAnchor = useMemo(() => {
    if (parsedLegs[0]) {
      const tz = getAirportByIcao(parsedLegs[0].depIcao)?.tz || acclTZ
      return { dep: parsedLegs[0].dep, tz }
    }
    const leg = legs[0]
    if (leg?.depDate && leg?.depTime) {
      const tz = (leg.depIcao && getAirportByIcao(leg.depIcao)?.tz) || acclTZ
      const dep = parseZonedDateTime(leg.depDate, leg.depTime, tz)
      if (!isNaN(dep.getTime())) return { dep, tz }
    }
    return null
  }, [parsedLegs, legs, acclTZ])

  const derived = useMemo(() => {
    if (parsedLegs.length === 0) return null
    let reportOverride: Date | null = null
    let releaseOverride: Date | null = null
    if (reportOverridden && reportTime && parsedLegs[0]) {
      const tz = getAirportByIcao(parsedLegs[0].depIcao)?.tz || acclTZ
      // Date is inferred from first dep (same day, or previous day if needed)
      const d = resolveReportDateTimeFromTime(
        reportTime,
        parsedLegs[0].dep,
        tz,
      )
      if (d) reportOverride = d
    }
    if (releaseOverridden && releaseTime) {
      const last = parsedLegs[parsedLegs.length - 1]
      const tz = getAirportByIcao(last.arrIcao)?.tz || acclTZ
      const d = resolveReleaseDateTimeFromTime(releaseTime, last.arr, tz)
      if (d) releaseOverride = d
    }
    return deriveFdpFromFlights({
      flights: parsedLegs,
      buffers,
      reportOverride,
      releaseOverride,
      regulator,
      homeBaseTZ: homeBaseTZ || acclTZ,
      priorDuties: priorDuties.filter(
        (d) => !editEvent || d.id !== editEvent.id,
      ),
      splitBreak: parsedSplitBreak,
    })
  }, [
    parsedLegs,
    buffers,
    reportOverridden,
    releaseOverridden,
    reportTime,
    releaseTime,
    regulator,
    acclTZ,
    homeBaseTZ,
    priorDuties,
    editEvent,
    parsedSplitBreak,
  ])

  /**
   * Last arrival used for auto release (and date inference).
   * Prefer the last flight that has an arrival date/time entered — even if
   * the leg is not fully complete — so release tracks as the user types arr.
   */
  const lastArrAnchor = useMemo(() => {
    for (let i = legs.length - 1; i >= 0; i--) {
      const leg = legs[i]
      if (!leg?.arrDate || !leg?.arrTime) continue
      const tz = (leg.arrIcao && getAirportByIcao(leg.arrIcao)?.tz) || acclTZ
      const arr = parseZonedDateTime(leg.arrDate, leg.arrTime, tz)
      if (isNaN(arr.getTime())) continue
      return {
        arr,
        tz,
        isDeadhead: !!leg.isDeadhead,
        legId: leg.id,
      }
    }
    return null
  }, [legs, acclTZ])

  /** Resolved report for UI (auto or manual with inferred date). */
  const resolvedReportInstant = useMemo(() => {
    if (derived?.ok) return derived.report
    if (reportTime && firstDepAnchor) {
      return resolveReportDateTimeFromTime(
        reportTime,
        firstDepAnchor.dep,
        firstDepAnchor.tz,
      )
    }
    return null
  }, [derived, reportTime, firstDepAnchor])

  const resolvedReleaseInstant = useMemo(() => {
    if (derived?.ok) return derived.release
    if (releaseTime && lastArrAnchor) {
      return resolveReleaseDateTimeFromTime(
        releaseTime,
        lastArrAnchor.arr,
        lastArrAnchor.tz,
      )
    }
    return null
  }, [derived, releaseTime, lastArrAnchor])

  const displayReportDate = useMemo(() => {
    if (resolvedReportInstant && firstDepAnchor) {
      return toDateInputValueInTZ(resolvedReportInstant, firstDepAnchor.tz)
    }
    return reportDate || ''
  }, [resolvedReportInstant, firstDepAnchor, reportDate])

  const displayReleaseDate = useMemo(() => {
    if (resolvedReleaseInstant && lastArrAnchor) {
      return toDateInputValueInTZ(resolvedReleaseInstant, lastArrAnchor.tz)
    }
    return releaseDate || ''
  }, [resolvedReleaseInstant, lastArrAnchor, releaseDate])

  const reportDayHint = useMemo(() => {
    if (!resolvedReportInstant || !firstDepAnchor) return null
    return reportDayRelativeHint(
      resolvedReportInstant,
      firstDepAnchor.dep,
      firstDepAnchor.tz,
    )
  }, [resolvedReportInstant, firstDepAnchor])

  const releaseDayHint = useMemo(() => {
    if (!resolvedReleaseInstant || !lastArrAnchor) return null
    const releaseDay = toDateInputValueInTZ(
      resolvedReleaseInstant,
      lastArrAnchor.tz,
    )
    const arrDay = toDateInputValueInTZ(lastArrAnchor.arr, lastArrAnchor.tz)
    if (releaseDay === arrDay) return null
    if (releaseDay > arrDay) return `Day after arr · ${releaseDay}`
    return releaseDay
  }, [resolvedReleaseInstant, lastArrAnchor])

  /**
   * Auto report from first departure − buffer (customs/DH).
   * Uses first dep even when the full FDP derive is incomplete
   * (e.g. arrival not filled yet).
   */
  const autoReportFields = useMemo((): {
    date: string
    time: string
  } | null => {
    if (parsedLegs[0]) {
      const first = parsedLegs[0]
      const tz = getAirportByIcao(first.depIcao)?.tz || acclTZ
      const { min } = selectReportBufferMin(first, buffers)
      const auto = new Date(first.dep.getTime() - min * 60_000)
      if (isNaN(auto.getTime())) return null
      return {
        date: toDateInputValueInTZ(auto, tz),
        time: formatHHmmInTZ(auto, tz),
      }
    }
    if (firstDepAnchor) {
      const draft = legs[0]
      const probe: FlightLeg = {
        id: 'auto-report',
        depIcao: draft?.depIcao || '',
        arrIcao: draft?.arrIcao || '',
        dep: firstDepAnchor.dep,
        arr: firstDepAnchor.dep,
        isDeadhead: !!draft?.isDeadhead,
        customsPreclearance: !!draft?.customsPreclearance,
      }
      const { min } = selectReportBufferMin(probe, buffers)
      const auto = new Date(firstDepAnchor.dep.getTime() - min * 60_000)
      if (isNaN(auto.getTime())) return null
      return {
        date: toDateInputValueInTZ(auto, firstDepAnchor.tz),
        time: formatHHmmInTZ(auto, firstDepAnchor.tz),
      }
    }
    if (derived?.ok && !isNaN(derived.reportAuto.getTime())) {
      return {
        date: toDateInputValueInTZ(derived.reportAuto, derived.startTZ),
        time: formatHHmmInTZ(derived.reportAuto, derived.startTZ),
      }
    }
    return null
  }, [
    parsedLegs,
    firstDepAnchor,
    legs,
    buffers,
    acclTZ,
    derived,
  ])

  /**
   * Auto release = last arrival + buffer (operating/DH).
   * Driven by lastArrAnchor so it updates whenever the user enters/changes
   * the last flight’s arrival — without waiting for a full FDP derive.
   */
  const autoReleaseFields = useMemo((): {
    date: string
    time: string
  } | null => {
    if (lastArrAnchor) {
      const probe: FlightLeg = {
        id: lastArrAnchor.legId || 'auto-release',
        depIcao: '',
        arrIcao: '',
        dep: lastArrAnchor.arr,
        arr: lastArrAnchor.arr,
        isDeadhead: lastArrAnchor.isDeadhead,
      }
      const { min } = selectReleaseBufferMin(probe, buffers)
      const auto = new Date(lastArrAnchor.arr.getTime() + min * 60_000)
      if (isNaN(auto.getTime())) return null
      return {
        date: toDateInputValueInTZ(auto, lastArrAnchor.tz),
        time: formatHHmmInTZ(auto, lastArrAnchor.tz),
      }
    }
    if (derived?.ok && !isNaN(derived.releaseAuto.getTime())) {
      return {
        date: toDateInputValueInTZ(derived.releaseAuto, derived.endTZ),
        time: formatHHmmInTZ(derived.releaseAuto, derived.endTZ),
      }
    }
    return null
  }, [lastArrAnchor, buffers, derived])

  const recalculateReport = () => {
    if (!autoReportFields) return
    setReportOverridden(false)
    setReportDate(autoReportFields.date)
    setReportTime(autoReportFields.time)
  }

  const recalculateRelease = () => {
    if (!autoReleaseFields) return
    setReleaseOverridden(false)
    setReleaseDate(autoReleaseFields.date)
    setReleaseTime(autoReleaseFields.time)
  }

  const enableSplitDuty = () => {
    /**
     * Default mid-FDP break placement (CAR 700.50):
     * - 2+ complete legs: largest gap between consecutive flights
     * - 1 complete leg: after that arrival (user must then add post-break flights
     *   so release moves past the break)
     */
    if (parsedLegs.length >= 2) {
      let bestI = 0
      let bestGap = -1
      for (let i = 0; i < parsedLegs.length - 1; i++) {
        const gap =
          parsedLegs[i + 1].dep.getTime() - parsedLegs[i].arr.getTime()
        if (gap > bestGap) {
          bestGap = gap
          bestI = i
        }
      }
      const before = parsedLegs[bestI]
      const after = parsedLegs[bestI + 1]
      const tz =
        getAirportByIcao(before.arrIcao)?.tz ||
        getAirportByIcao(after.depIcao)?.tz ||
        acclTZ
      const start = new Date(before.arr.getTime() + 15 * 60_000)
      let end = new Date(after.dep.getTime() - 15 * 60_000)
      // Ensure ≥60 min; if gap is tight, still offer a 2 h window after first block
      if (end.getTime() - start.getTime() < 60 * 60_000) {
        end = new Date(start.getTime() + 2 * 3_600_000)
      }
      setSplitStartDate(toDateInputValueInTZ(start, tz))
      setSplitStartTime(formatHHmmInTZ(start, tz))
      setSplitEndDate(toDateInputValueInTZ(end, tz))
      setSplitEndTime(formatHHmmInTZ(end, tz))
      setSplitLocationIcao(before.arrIcao || '')
    } else if (parsedLegs.length === 1) {
      const last = parsedLegs[0]
      const arrTz = getAirportByIcao(last.arrIcao)?.tz || acclTZ
      // After first arrival — add a flight after the break next
      const start = new Date(last.arr.getTime() + 15 * 60_000)
      const end = new Date(start.getTime() + 2 * 3_600_000)
      setSplitStartDate(toDateInputValueInTZ(start, arrTz))
      setSplitStartTime(formatHHmmInTZ(start, arrTz))
      setSplitEndDate(toDateInputValueInTZ(end, arrTz))
      setSplitEndTime(formatHHmmInTZ(end, arrTz))
      setSplitLocationIcao(last.arrIcao || '')
    } else {
      setSplitStartDate(defaultDayKey)
      setSplitStartTime('14:00')
      setSplitEndDate(defaultDayKey)
      setSplitEndTime('16:00')
      setSplitLocationIcao('')
    }
    setSplitUoc(false)
    setSplitEnabled(true)
    setLocalError('')
  }

  const clearSplitDuty = () => {
    setSplitEnabled(false)
    setSplitStartTime('')
    setSplitEndTime('')
    setSplitUoc(false)
    setLocalError('')
  }

  /** Pre / mid / post flight groups when split duty is active. */
  const splitFlightGroups = useMemo(() => {
    const br = parsedSplitBreak
    const pre: { leg: DutyFormDraftLeg; index: number }[] = []
    const post: { leg: DutyFormDraftLeg; index: number }[] = []
    const mid: { leg: DutyFormDraftLeg; index: number }[] = []
    legs.forEach((leg, index) => {
      if (!splitEnabled) {
        pre.push({ leg, index })
        return
      }
      const bucket = bucketLegVsSplit(leg, index, br, acclTZ)
      if (bucket === 'post') post.push({ leg, index })
      else if (bucket === 'overlap') mid.push({ leg, index })
      else pre.push({ leg, index })
    })
    return { pre, post, mid }
  }, [legs, splitEnabled, parsedSplitBreak, acclTZ])

  // Keep report in lockstep with first departure when the user has not
  // manually entered a report time (reportOverridden stays false).
  // Works as soon as flight 1 has a dep date/time — full FDP derive not required.
  useEffect(() => {
    if (reportOverridden) return
    if (!autoReportFields) return
    setReportDate((prev) =>
      prev === autoReportFields.date ? prev : autoReportFields.date,
    )
    setReportTime((prev) =>
      prev === autoReportFields.time ? prev : autoReportFields.time,
    )
  }, [autoReportFields, reportOverridden])

  // Keep release in lockstep with last flight arrival when the user has not
  // manually entered a release time (releaseOverridden stays false).
  // Updates whenever the last leg’s arr date/time (or DH flag) changes.
  useEffect(() => {
    if (releaseOverridden) return
    if (!autoReleaseFields) return
    setReleaseDate((prev) =>
      prev === autoReleaseFields.date ? prev : autoReleaseFields.date,
    )
    setReleaseTime((prev) =>
      prev === autoReleaseFields.time ? prev : autoReleaseFields.time,
    )
  }, [autoReleaseFields, releaseOverridden])

  // When report is manual, keep reportDate in sync with inferred civil day
  // (e.g. after-midnight dep → report lands previous evening).
  useEffect(() => {
    if (!reportOverridden || !resolvedReportInstant || !firstDepAnchor) return
    const day = toDateInputValueInTZ(
      resolvedReportInstant,
      firstDepAnchor.tz,
    )
    if (day !== reportDate) setReportDate(day)
  }, [
    reportOverridden,
    resolvedReportInstant,
    firstDepAnchor,
    reportDate,
  ])

  // When release is manual, keep releaseDate in sync (may roll past midnight).
  useEffect(() => {
    if (!releaseOverridden || !releaseTime || parsedLegs.length === 0) return
    const last = parsedLegs[parsedLegs.length - 1]
    const tz = getAirportByIcao(last.arrIcao)?.tz || acclTZ
    const resolved = resolveReleaseDateTimeFromTime(releaseTime, last.arr, tz)
    if (!resolved) return
    const day = toDateInputValueInTZ(resolved, tz)
    if (day !== releaseDate) setReleaseDate(day)
  }, [
    releaseOverridden,
    releaseTime,
    parsedLegs,
    acclTZ,
    releaseDate,
  ])

  const collectStaleFromKind = (
    fromKind: EventKind,
    toKind: EventKind,
  ): StaleFieldLine[] => {
    const fromFields = fieldsForEventKind(fromKind)
    const toFields = fieldsForEventKind(toKind)
    const lines: StaleFieldLine[] = []

    if (fromFields.has('flights') && !toFields.has('flights')) {
      const s = legSummary(legs)
      if (s) lines.push({ key: 'flights', label: 'Flights', value: s })
    }
    if (
      fromFields.has('reportRelease') &&
      !toFields.has('reportRelease') &&
      !toFields.has('startEnd')
    ) {
      if (reportTime || releaseTime) {
        lines.push({
          key: 'reportRelease',
          label: 'Report / release',
          value: `${reportDate} ${reportTime || '—'} → ${releaseDate} ${releaseTime || '—'}`,
        })
      }
    }
    if (fromFields.has('location') && !toFields.has('location') && locationIcao) {
      lines.push({
        key: 'location',
        label: 'Location',
        value: locationIcao,
      })
    }
    if (
      fromFields.has('restType') &&
      !toFields.has('restType') &&
      restType
    ) {
      lines.push({
        key: 'restType',
        label: 'Rest type',
        value: restType === '12h' ? '12 hours rest' : '10+travel',
      })
    }
    // Non-flight start/end when moving to pure flight form (start/end become derived)
    if (
      fromFields.has('startEnd') &&
      !fromFields.has('reportRelease') &&
      toFields.has('reportRelease') &&
      (startTime || endTime)
    ) {
      // Keep as context if user had customized; still relevant if handoff
      // Only stale when not used as handoff prefix
      if (!isReserveOrStandbyKind(fromKind)) {
        lines.push({
          key: 'startEnd',
          label: 'Start / end',
          value: `${startDate} ${startTime || '—'} → ${endDate} ${endTime || '—'}`,
        })
      }
    }
    return lines
  }

  const handleKindChange = (next: EventKind) => {
    if (next === eventKind && !fdpHandoff) return

    // Leaving handoff mode by picking a non-flight kind
    if (fdpHandoff) {
      const stale = collectStaleFromKind('flight_duty', next)
      if (stale.length) {
        setStaleLines((prev) => {
          const keys = new Set(stale.map((s) => s.key))
          return [...prev.filter((p) => !keys.has(p.key)), ...stale]
        })
      }
      setFdpHandoff(false)
      setHandoffKind(null)
      setLegs([
        emptyDraftForNewFdp(
          defaultDayKey,
          priorDuties,
          editEvent?.id,
        ),
      ])
      setReportOverridden(false)
      setReleaseOverridden(false)
    } else {
      const stale = collectStaleFromKind(eventKind, next)
      if (stale.length) {
        setStaleLines((prev) => {
          const keys = new Set(stale.map((s) => s.key))
          return [...prev.filter((p) => !keys.has(p.key)), ...stale]
        })
      }
      // Clear fields that no longer apply
      const nextFields = fieldsForEventKind(next)
      if (!nextFields.has('flights')) {
        setLegs([emptyDraft(defaultDayKey)])
      } else if (
        next === 'flight_duty' &&
        !fieldsForEventKind(eventKind).has('flights')
      ) {
        // Switching into Flight Duty: seed dep from last FDP arrival
        setLegs([
          emptyDraftForNewFdp(
            defaultDayKey,
            priorDuties,
            editEvent?.id,
          ),
        ])
      }
      if (!nextFields.has('location')) {
        setLocationIcao('')
      }
      // Apply default times for simple kinds when switching to them
      if (nextFields.has('startEnd') && !nextFields.has('reportRelease')) {
        const def = defaultStartEndForKind(next)
        // Refresh defaults when switching into rsv/sim for better UX
        if (isReserveOrStandbyKind(next) || isNonFlightDutyKind(next)) {
          setStartTime(def.startTime)
          setEndTime(def.endTime)
        }
      }
    }

    setEventKind(next)
    setLocalError('')
  }

  const updateLeg = (id: string, patch: Partial<DutyFormDraftLeg>) => {
    setLegs((prev) =>
      prev.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    )
  }

  const addLeg = () => {
    setLegs((prev) => {
      const last = prev[prev.length - 1]
      const next = emptyDraft(last?.arrDate || defaultDayKey)

      // After a split break: seed the new leg to depart after the break ends
      // (post-break sector), not at the pre-break arrival.
      if (splitEnabled && splitEndDate && splitEndTime) {
        const tz =
          (splitLocationIcao && getAirportByIcao(splitLocationIcao)?.tz) ||
          (last?.arrIcao && getAirportByIcao(last.arrIcao)?.tz) ||
          acclTZ
        const breakEnd = parseZonedDateTime(splitEndDate, splitEndTime, tz)
        if (!isNaN(breakEnd.getTime())) {
          const dep = new Date(breakEnd.getTime() + 15 * 60_000)
          next.depDate = toDateInputValueInTZ(dep, tz)
          next.depTime = formatHHmmInTZ(dep, tz)
          next.arrDate = next.depDate
          if (splitLocationIcao) next.depIcao = splitLocationIcao
          else if (last?.arrIcao) next.depIcao = last.arrIcao
          return [...prev, next]
        }
      }

      // Within an FDP, next dep defaults to previous arr (overridable)
      if (last?.arrIcao) next.depIcao = last.arrIcao
      if (last?.arrTime) next.depTime = last.arrTime
      if (last?.arrDate) next.depDate = last.arrDate
      return [...prev, next]
    })
  }

  const removeLeg = (id: string) => {
    setLegs((prev) =>
      prev.length <= 1 ? prev : prev.filter((l) => l.id !== id),
    )
  }

  const resolveWall = (
    date: string,
    time: string,
    tz: string,
  ): Date | null => {
    if (!date || !time) return null
    const d = parseZonedDateTime(date, time, tz)
    return isNaN(d.getTime()) ? null : d
  }

  const handleAddFlightHandoff = () => {
    setLocalError('')
    // Require end of reserve/standby
    if (!endDate || !endTime) {
      setLocalError(
        'Set when reserve/standby ends — this becomes the end of the availability period.',
      )
      return
    }
    const locTz =
      (locationIcao && getAirportByIcao(locationIcao)?.tz) || acclTZ
    const end = resolveWall(endDate, endTime, locTz)
    if (!end) {
      setLocalError('Invalid end date/time for reserve/standby.')
      return
    }
    const start = resolveWall(startDate, startTime, locTz)
    if (!start || end <= start) {
      setLocalError('Reserve/standby end must be after start.')
      return
    }

    setHandoffKind(eventKind)
    setFdpHandoff(true)
    // Seed first flight dep from last FDP arrival (and/or reserve location)
    setLegs((prev) => {
      if (prev.length === 1 && !prev[0].depIcao) {
        const fromFdp = seedDepFromPriorFdp(priorDuties, editEvent?.id)
        const dep = fromFdp || locationIcao || ''
        return [emptyDraft(defaultDayKey, { depIcao: dep })]
      }
      return prev
    })
    // Seed report toward reserve end
    setReportDate(endDate)
    setReportTime(endTime)
    setReportOverridden(true)
    setLocalError('')
  }

  /** Build validated payload from current form state, or null on error. */
  const buildSubmitPayload = (): EventFormSubmitPayload | null => {
    setLocalError('')
    setCloneMessage('')

    // Composite: reserve/stby + FDP
    if (fdpHandoff && handoffKind) {
      if (splitEnabled && !parsedSplitBreak) {
        setLocalError(
          'Complete the split-duty break start and end times (at least 60 minutes in suitable accommodation).',
        )
        return null
      }
      if (!derived || !derived.ok) {
        setLocalError(derived?.error || 'Complete at least one flight.')
        return null
      }
      const locTz =
        (locationIcao && getAirportByIcao(locationIcao)?.tz) || acclTZ
      const rsvStart = resolveWall(startDate, startTime, locTz)
      const rsvEnd = resolveWall(endDate, endTime, locTz)
      if (!rsvStart || !rsvEnd || rsvEnd <= rsvStart) {
        setLocalError('Invalid reserve/standby period.')
        return null
      }
      const maxAllowed =
        derived.extendedMaxFdpHours ?? derived.maxFdpHours
      if (regulator === 'TC' && derived.endsWithPositioning && derived.operatingEnd) {
        const allowed = assertPositioningAllowed({
          start: derived.report,
          end: derived.release,
          operatingEnd: derived.operatingEnd,
          maxFdpHours: maxAllowed,
          positioningAgreed,
        })
        if (!allowed.ok) {
          setLocalError(allowed.detail || 'Positioning not allowed.')
          return null
        }
      } else if (
        derived.totalDutyHours > maxAllowed + 1e-9 &&
        !derived.endsWithPositioning
      ) {
        const splitNote =
          derived.splitExtensionHours > 0
            ? ` (table ${derived.maxFdpHours} h + split +${derived.splitExtensionHours.toFixed(2)} h)`
            : ''
        setLocalError(
          `Duty ${derived.totalDutyHours.toFixed(1)} h exceeds max FDP ${maxAllowed.toFixed(2)} h${splitNote}.`,
        )
        return null
      }

      return {
        eventKind: 'flight_duty',
        restType,
        prefixReserve: {
          eventKind: handoffKind,
          start: rsvStart,
          end: rsvEnd,
          locationIcao: locationIcao || undefined,
        },
        duty: {
          start: derived.report,
          end: derived.release,
          acclTZ: derived.acclTZ,
          startTZ: derived.startTZ,
          endTZ: derived.endTZ,
          eventKind: 'flight_duty',
          flights: derived.completeLegs,
          reportOverridden: reportOverridden || undefined,
          releaseOverridden: releaseOverridden || undefined,
          operatingSectors: Math.max(1, derived.operatingSectors || 1),
          positioningSectors:
            derived.positioningSectors > 0
              ? derived.positioningSectors
              : undefined,
          avgSectorTime: derived.avgSectorTime,
          endsWithPositioning: derived.endsWithPositioning || undefined,
          operatingEnd: derived.operatingEnd,
          positioningAgreed:
            derived.endsWithPositioning && positioningAgreed
              ? true
              : undefined,
          splitBreak: parsedSplitBreak || undefined,
        },
      }
    }

    // Flight duty
    if (activeKind === 'flight_duty') {
      if (splitEnabled && !parsedSplitBreak) {
        setLocalError(
          'Complete the split-duty break start and end times (at least 60 minutes in suitable accommodation).',
        )
        return null
      }
      if (!derived || !derived.ok) {
        setLocalError(derived?.error || 'Complete at least one flight.')
        return null
      }
      const maxAllowed =
        derived.extendedMaxFdpHours ?? derived.maxFdpHours
      if (regulator === 'TC' && derived.endsWithPositioning && derived.operatingEnd) {
        const allowed = assertPositioningAllowed({
          start: derived.report,
          end: derived.release,
          operatingEnd: derived.operatingEnd,
          maxFdpHours: maxAllowed,
          positioningAgreed,
        })
        if (!allowed.ok) {
          setLocalError(allowed.detail || 'Positioning not allowed.')
          return null
        }
      } else if (
        derived.totalDutyHours > maxAllowed + 1e-9 &&
        !derived.endsWithPositioning
      ) {
        const splitNote =
          derived.splitExtensionHours > 0
            ? ` (table ${derived.maxFdpHours} h + split +${derived.splitExtensionHours.toFixed(2)} h)`
            : ''
        setLocalError(
          `Duty ${derived.totalDutyHours.toFixed(1)} h exceeds max FDP ${maxAllowed.toFixed(2)} h${splitNote}.`,
        )
        return null
      }

      return {
        eventKind: 'flight_duty',
        restType,
        duty: {
          start: derived.report,
          end: derived.release,
          acclTZ: derived.acclTZ,
          startTZ: derived.startTZ,
          endTZ: derived.endTZ,
          eventKind: 'flight_duty',
          flights: derived.completeLegs,
          reportOverridden: reportOverridden || undefined,
          releaseOverridden: releaseOverridden || undefined,
          operatingSectors: Math.max(1, derived.operatingSectors || 1),
          positioningSectors:
            derived.positioningSectors > 0
              ? derived.positioningSectors
              : undefined,
          avgSectorTime: derived.avgSectorTime,
          endsWithPositioning: derived.endsWithPositioning || undefined,
          operatingEnd: derived.operatingEnd,
          positioningAgreed:
            derived.endsWithPositioning && positioningAgreed
              ? true
              : undefined,
          splitBreak: parsedSplitBreak || undefined,
        },
      }
    }

    // Simple kinds: reserve, standby, sim, ground, e-class
    const locTz =
      (locationIcao && getAirportByIcao(locationIcao)?.tz) || acclTZ
    const start = resolveWall(startDate, startTime, locTz)
    const end = resolveWall(endDate, endTime, locTz)
    if (!start || !end) {
      setLocalError('Enter start and end date/time.')
      return null
    }
    if (end <= start) {
      setLocalError('End must be after start.')
      return null
    }

    return {
      eventKind,
      restType,
      duty: {
        start,
        end,
        acclTZ,
        startTZ: locTz,
        endTZ: locTz,
        eventKind,
        locationIcao: locationIcao || undefined,
      },
    }
  }

  /** Civil day used as the clone anchor (form start / report day). */
  const cloneAnchorDay = (): string => {
    if (fdpHandoff || activeKind === 'flight_duty') {
      return reportDate || defaultDayKey
    }
    return startDate || defaultDayKey
  }

  const handleSubmit = () => {
    const payload = buildSubmitPayload()
    if (payload) onSubmit(payload)
  }

  const handleClone = () => {
    setCloneMessage('')
    if (!cloneTargetDate) {
      setLocalError('Select a date to clone this event to.')
      return
    }
    const payload = buildSubmitPayload()
    if (!payload) return

    const dayDelta = daysBetweenDateInputValues(
      cloneAnchorDay(),
      cloneTargetDate,
    )
    const shifted = shiftEventFormPayload(payload, dayDelta)
    void Promise.resolve(onClone(shifted)).then((ok) => {
      if (ok === false) return
      setCloneMessage(`Cloned to ${cloneTargetDate}`)
    })
  }

  const formTitle =
    mode === 'edit'
      ? `Edit Event · ${dutyDateLabel}`
      : `Add Event · ${dutyDateLabel}`

  const renderFlightCard = (leg: DutyFormDraftLeg, index: number) => {
    const parsed = draftToFlightLeg(leg)
    const depAp = leg.depIcao ? getAirportByIcao(leg.depIcao) : undefined
    const arrAp = leg.arrIcao ? getAirportByIcao(leg.arrIcao) : undefined
    const dur =
      parsed && parsed.arr > parsed.dep
        ? formatDur(parsed.arr.getTime() - parsed.dep.getTime())
        : null
    return (
      <div className="duty-form-flight" key={leg.id}>
        <div className="duty-form-flight-head">
          <div className="duty-form-flight-head-left">
            <strong>Flight {index + 1}</strong>
            <div className="duty-form-flight-toggles">
              {index === 0 && (
                <label
                  className="checkbox-label duty-form-checkbox-compact duty-form-flight-toggle"
                  title="Customs pre-clearance before departure (longer report buffer)"
                >
                  <input
                    type="checkbox"
                    checked={leg.customsPreclearance}
                    onChange={(e) =>
                      updateLeg(leg.id, {
                        customsPreclearance: e.target.checked,
                      })
                    }
                  />
                  Customs Pre-Clearance
                </label>
              )}
              <label
                className="checkbox-label duty-form-checkbox-compact duty-form-flight-toggle"
                title="Deadhead / positioning"
              >
                <input
                  type="checkbox"
                  checked={leg.isDeadhead}
                  onChange={(e) =>
                    updateLeg(leg.id, { isDeadhead: e.target.checked })
                  }
                />
                Deadhead
              </label>
            </div>
          </div>
          <div className="duty-form-flight-head-meta">
            {dur && (
              <span className="duty-form-block-time">
                Block {dur}
                {leg.isDeadhead ? ' · DH' : ''}
              </span>
            )}
            {legs.length > 1 && (
              <button
                type="button"
                className="duty-form-btn duty-form-btn-danger"
                onClick={() => removeLeg(leg.id)}
              >
                Remove
              </button>
            )}
          </div>
        </div>

        <div className="duty-form-flight-grid">
          <div className="duty-form-endpoint">
            <span className="duty-form-endpoint-label">Departure</span>
            <label className="duty-form-field">
              <span className="duty-form-sr-only">Departure airport</span>
              <AirportSelector
                valueIcao={leg.depIcao}
                onChange={(icao) => updateLeg(leg.id, { depIcao: icao })}
                placeholder="Dep airport…"
              />
            </label>
            <label className="duty-form-field">
              <span className="duty-form-sr-only">Departure date</span>
              <input
                type="date"
                value={leg.depDate}
                onChange={(e) =>
                  updateLeg(leg.id, { depDate: e.target.value })
                }
                aria-label={`Flight ${index + 1} departure date`}
              />
            </label>
            <label className="duty-form-field">
              <span className="duty-form-sr-only">Departure time</span>
              <FreeTimeInput
                value={leg.depTime}
                onChange={(t) => updateLeg(leg.id, { depTime: t })}
                timeFormat={timeFormat}
                aria-label={`Flight ${index + 1} departure time`}
              />
            </label>
            {depAp && leg.depTime && (
              <span className="time-display">
                {formatTimeDisplay(leg.depTime, timeFormat)} ·{' '}
                {depAp.tz.replace(/_/g, ' ')}
              </span>
            )}
          </div>

          <div className="duty-form-endpoint">
            <span className="duty-form-endpoint-label">Arrival</span>
            <label className="duty-form-field">
              <span className="duty-form-sr-only">Arrival airport</span>
              <AirportSelector
                valueIcao={leg.arrIcao}
                onChange={(icao) => updateLeg(leg.id, { arrIcao: icao })}
                placeholder="Arr airport…"
              />
            </label>
            <label className="duty-form-field">
              <span className="duty-form-sr-only">Arrival date</span>
              <input
                type="date"
                value={leg.arrDate}
                onChange={(e) =>
                  updateLeg(leg.id, { arrDate: e.target.value })
                }
                aria-label={`Flight ${index + 1} arrival date`}
              />
            </label>
            <label className="duty-form-field">
              <span className="duty-form-sr-only">Arrival time</span>
              <FreeTimeInput
                value={leg.arrTime}
                onChange={(t) => updateLeg(leg.id, { arrTime: t })}
                timeFormat={timeFormat}
                aria-label={`Flight ${index + 1} arrival time`}
              />
            </label>
            {arrAp && leg.arrTime && (
              <span className="time-display">
                {formatTimeDisplay(leg.arrTime, timeFormat)} ·{' '}
                {arrAp.tz.replace(/_/g, ' ')}
              </span>
            )}
          </div>
        </div>
      </div>
    )
  }

  const renderSplitPanel = () => (
    <div className="duty-form-split">
      <div
        className="duty-form-split-panel"
        role="region"
        aria-label="Split-duty break"
      >
        <div className="duty-form-split-head">
          <strong>Split-duty break (CAR 700.50)</strong>
          <button
            type="button"
            className="duty-form-btn duty-form-btn-danger"
            onClick={clearSplitDuty}
          >
            Remove
          </button>
        </div>
        <p className="form-hint duty-form-hint-tight">
          Mid-FDP rest in suitable accommodation (≥60 min). Order:{' '}
          <strong>pre-break flights → this break → post-break flights</strong>.
          Release must be after the last post-break arrival.
        </p>
        <div className="duty-form-pair">
          <label className="duty-form-field">
            Break start
            <input
              type="date"
              value={splitStartDate}
              onChange={(e) => setSplitStartDate(e.target.value)}
            />
            <FreeTimeInput
              value={splitStartTime}
              onChange={setSplitStartTime}
              timeFormat={timeFormat}
              aria-label="Split break start time"
            />
          </label>
          <label className="duty-form-field">
            Break end
            <input
              type="date"
              value={splitEndDate}
              onChange={(e) => setSplitEndDate(e.target.value)}
            />
            <FreeTimeInput
              value={splitEndTime}
              onChange={setSplitEndTime}
              timeFormat={timeFormat}
              aria-label="Split break end time"
            />
          </label>
        </div>
        <label className="duty-form-field">
          Location (suitable accommodation)
          <AirportSelector
            valueIcao={splitLocationIcao}
            onChange={setSplitLocationIcao}
          />
        </label>
        <label className="checkbox-label duty-form-checkbox-compact">
          <input
            type="checkbox"
            checked={splitUoc}
            onChange={(e) => setSplitUoc(e.target.checked)}
          />
          Unforeseen replan (50% credit, 700.50(1)(c))
        </label>
        {derived?.ok && derived.splitBreakSummary && (
          <p className="duty-form-split-summary">{derived.splitBreakSummary}</p>
        )}
        {derived &&
          !derived.ok &&
          derived.error &&
          /split/i.test(derived.error) && (
            <p
              className="form-hint"
              style={{ color: 'var(--error-color, #b91c1c)' }}
            >
              {derived.error}
            </p>
          )}
        {splitFlightGroups.post.length === 0 && (
          <p className="form-hint duty-form-hint-tight">
            Next: use <strong>+ Add flight</strong> below for sectors after this
            break (seeded after break end).
          </p>
        )}
      </div>
    </div>
  )

  return (
    <div className="duty-form">
      <h3>{formTitle}</h3>
      <p className="form-hint">
        Fields adapt to event type · home base {homeBaseTZ.replace(/_/g, ' ')}
      </p>

      <label className="duty-form-select-label">
        Event type
        <span className="duty-form-select-wrap">
          <select
            className="duty-form-select"
            value={fdpHandoff ? 'flight_duty' : eventKind}
            onChange={(e) => handleKindChange(e.target.value as EventKind)}
            disabled={fdpHandoff}
            aria-label="Event type"
          >
            {EVENT_KIND_ORDER.map((k) => (
              <option key={k} value={k}>
                {titleForEventKind(k)}
                {fdpHandoff && k === 'flight_duty'
                  ? ' (after reserve/standby)'
                  : ''}
              </option>
            ))}
          </select>
        </span>
      </label>

      {fdpHandoff && handoffKind && (
        <div className="duty-form-derived duty-form-handoff-summary">
          <p>
            <strong>{titleForEventKind(handoffKind)}</strong> ends{' '}
            {endDate} {endTime}
            {locationIcao ? ` · ${locationIcao}` : ''}
          </p>
          <p className="form-hint">
            A new flight duty will be created after this period. Adjust the end
            time above if needed before saving.
          </p>
          <label>
            End of {titleForEventKind(handoffKind).toLowerCase()}
            <div className="duty-form-row">
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
              <FreeTimeInput
                value={endTime}
                onChange={setEndTime}
                timeFormat={timeFormat}
                aria-label="End of reserve or standby"
              />
            </div>
          </label>
        </div>
      )}

      {staleLines.length > 0 && (
        <div className="duty-form-stale" role="region" aria-label="Previously entered unused data">
          <div className="duty-form-stale-head">
            <strong>Previously entered (not used for this event type)</strong>
            <button
              type="button"
              className="duty-form-btn duty-form-btn-danger"
              onClick={() => setStaleLines([])}
            >
              Delete
            </button>
          </div>
          <ul className="duty-form-stale-list">
            {staleLines.map((line) => (
              <li key={line.key}>
                <span className="duty-form-stale-label">{line.label}:</span>{' '}
                {line.value}
              </li>
            ))}
          </ul>
        </div>
      )}

      {showStartEnd && (
        <div className="duty-form-pair">
          <label className="duty-form-field">
            Start
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
            <FreeTimeInput
              value={startTime}
              onChange={setStartTime}
              timeFormat={timeFormat}
              aria-label="Start time"
            />
          </label>
          <label className="duty-form-field">
            {isReserveOrStandbyKind(eventKind)
              ? 'End of reserve/standby'
              : 'End'}
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
            <FreeTimeInput
              value={endTime}
              onChange={setEndTime}
              timeFormat={timeFormat}
              aria-label="End time"
            />
          </label>
        </div>
      )}

      {showLocation && (
        <label>
          Location (airport)
          <AirportSelector
            valueIcao={locationIcao}
            onChange={setLocationIcao}
          />
        </label>
      )}

      {showAddFlightHandoff && (
        <button
          type="button"
          className="duty-form-btn duty-form-btn-secondary duty-form-add-flight"
          onClick={handleAddFlightHandoff}
        >
          + Add Flight
        </button>
      )}

      {showReportRelease && (
        <div
          className={`duty-form-timing-row${reportOverridden ? ' is-manual' : ''}`}
          title={
            derived?.ok
              ? derived.reportReason
              : 'Report time before first departure (date from dep, previous day if needed)'
          }
        >
          <span className="duty-form-timing-title">Report</span>
          <span
            className={`duty-form-timing-date${reportDayHint ? ' is-offset' : ''}`}
            title={
              reportDayHint ||
              (firstDepAnchor
                ? `Local date in ${firstDepAnchor.tz.replace(/_/g, ' ')}`
                : 'Inferred from first departure')
            }
          >
            {displayReportDate || '—'}
          </span>
          <div className="duty-form-timing-time">
            <FreeTimeInput
              value={reportTime}
              onChange={(t) => {
                setReportOverridden(true)
                setReportTime(t)
              }}
              timeFormat={timeFormat}
              aria-label="Report time"
            />
          </div>
          <button
            type="button"
            className="duty-form-btn duty-form-timing-auto"
            onClick={recalculateReport}
            disabled={!firstDepAnchor && !parsedLegs[0] && !derived?.ok}
            title={
              derived?.ok
                ? `Recalculate: ${derived.reportReason}`
                : 'Recalculate report from first departure − report buffer'
            }
            aria-label="Recalculate report time from departure"
          >
            Auto
          </button>
        </div>
      )}

      {showFlights && !splitEnabled && (
        <>
          {legs.map((leg, index) => renderFlightCard(leg, index))}
          <div className="duty-form-flight-actions">
            <button
              type="button"
              className="duty-form-btn duty-form-btn-secondary duty-form-add-flight"
              onClick={addLeg}
            >
              + Add flight
            </button>
            {regulator === 'TC' && (
              <button
                type="button"
                className="duty-form-btn duty-form-btn-secondary duty-form-split-toggle"
                onClick={enableSplitDuty}
              >
                Split duty
              </button>
            )}
          </div>
        </>
      )}

      {showFlights && splitEnabled && (
        <>
          {splitFlightGroups.pre.length > 0 && (
            <p className="form-hint duty-form-hint-tight duty-form-split-section-label">
              Before break
            </p>
          )}
          {splitFlightGroups.pre.map(({ leg, index }) =>
            renderFlightCard(leg, index),
          )}

          {regulator === 'TC' && renderSplitPanel()}

          {splitFlightGroups.mid.length > 0 && (
            <>
              <p
                className="form-hint duty-form-hint-tight"
                style={{ color: 'var(--error-color, #b91c1c)' }}
              >
                These flights overlap the break — move times before break start
                or after break end.
              </p>
              {splitFlightGroups.mid.map(({ leg, index }) =>
                renderFlightCard(leg, index),
              )}
            </>
          )}

          <p className="form-hint duty-form-hint-tight duty-form-split-section-label">
            After break
          </p>
          {splitFlightGroups.post.map(({ leg, index }) =>
            renderFlightCard(leg, index),
          )}
          {splitFlightGroups.post.length === 0 && (
            <p className="form-hint duty-form-hint-tight">
              No post-break flights yet. Add one so the FDP continues after the
              break (required for a legal split duty).
            </p>
          )}

          <div className="duty-form-flight-actions">
            <button
              type="button"
              className="duty-form-btn duty-form-btn-secondary duty-form-add-flight"
              onClick={addLeg}
            >
              + Add flight after break
            </button>
          </div>
        </>
      )}

      {showReportRelease && (
        <div
          className={`duty-form-timing-row${releaseOverridden ? ' is-manual' : ''}`}
          title={
            derived?.ok
              ? derived.releaseReason
              : 'Release time after last arrival (date from arr, next day if needed)'
          }
        >
          <span className="duty-form-timing-title">Release</span>
          <span
            className={`duty-form-timing-date${releaseDayHint ? ' is-offset' : ''}`}
            title={
              releaseDayHint ||
              (lastArrAnchor
                ? `Local date in ${lastArrAnchor.tz.replace(/_/g, ' ')}`
                : 'Inferred from last arrival')
            }
          >
            {displayReleaseDate || '—'}
          </span>
          <div className="duty-form-timing-time">
            <FreeTimeInput
              value={releaseTime}
              onChange={(t) => {
                setReleaseOverridden(true)
                setReleaseTime(t)
              }}
              timeFormat={timeFormat}
              aria-label="Release time"
            />
          </div>
          <button
            type="button"
            className="duty-form-btn duty-form-timing-auto"
            onClick={recalculateRelease}
            disabled={
              parsedLegs.length === 0 && !lastArrAnchor && !derived?.ok
            }
            title={
              derived?.ok
                ? `Recalculate: ${derived.releaseReason}`
                : 'Recalculate release from last arrival + release buffer'
            }
            aria-label="Recalculate release time from arrival"
          >
            Auto
          </button>
        </div>
      )}

      {showFdpSummary && derived?.ok && (
        <div
          className={`duty-form-derived${fdpDetailsOpen ? ' is-expanded' : ''}`}
        >
          <div className="duty-form-derived-summary">
            <p className="duty-form-derived-max">
              <strong>Max FDP</strong>{' '}
              <span className="duty-form-derived-value">
                {derived.splitExtensionHours > 0
                  ? `${derived.extendedMaxFdpHours.toFixed(2)} h`
                  : `${derived.maxFdpHours} h`}
              </span>
              {derived.splitExtensionHours > 0 && (
                <span className="duty-form-derived-sub">
                  {' '}
                  (table {derived.maxFdpHours} h + split)
                </span>
              )}
            </p>
            <button
              type="button"
              className="duty-form-btn duty-form-derived-toggle"
              onClick={() => setFdpDetailsOpen((o) => !o)}
              aria-expanded={fdpDetailsOpen}
              aria-controls="duty-form-fdp-details"
            >
              {fdpDetailsOpen ? 'Hide details' : 'Details'}
            </button>
          </div>
          {fdpDetailsOpen && (
            <div
              id="duty-form-fdp-details"
              className="duty-form-derived-details"
            >
              <p>
                Table max {derived.maxFdpHours} h
                {derived.splitExtensionHours > 0
                  ? ` + split +${derived.splitExtensionHours.toFixed(2)} h = ${derived.extendedMaxFdpHours.toFixed(2)} h`
                  : ''}{' '}
                · {derived.operatingSectors || 0} operating sector
                {derived.operatingSectors === 1 ? '' : 's'} · avg{' '}
                {derived.avgSectorTime === '<30'
                  ? '<30 min'
                  : derived.avgSectorTime === '30-50'
                    ? '30–50 min'
                    : '≥50 min'}
              </p>
              <p>
                Duty {derived.totalDutyHours.toFixed(1)} h
                {derived.splitExtensionHours > 0
                  ? ` · hours of work ${derived.hoursOfWorkHours.toFixed(1)} h (break excluded)`
                  : ''}
                {derived.endsWithPositioning && derived.operatingEnd
                  ? ` · operating to ${derived.operatingEnd.toLocaleString()} · trailing DH (700.43)`
                  : ''}
              </p>
              {derived.splitBreakSummary && (
                <p className="form-hint">{derived.splitBreakSummary}</p>
              )}
              <p>
                <strong>CAR 700.28 start</strong>{' '}
                {String(derived.acclimatizedStartHour).padStart(2, '0')}:xx
                acclimatized ({derived.acclTZ.replace(/_/g, ' ')})
                {derived.localStartHour !== derived.acclimatizedStartHour
                  ? ` · local dep ${String(derived.localStartHour).padStart(2, '0')}:xx (${derived.startTZ.replace(/_/g, ' ')}) — not used for table`
                  : ` · same as dep local`}
              </p>
              <p className="form-hint">{derived.acclimatizationReason}</p>
            </div>
          )}
        </div>
      )}

      {showFdpSummary &&
        derived?.ok &&
        derived.endsWithPositioning &&
        derived.totalDutyHours - (derived.extendedMaxFdpHours ?? derived.maxFdpHours) > 3 && (
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={positioningAgreed}
              onChange={(e) => setPositioningAgreed(e.target.checked)}
            />
            Crew agrees to extended positioning (&gt;3 h past max FDP, 700.43(3))
          </label>
        )}

      {showRestType && (
        <label className="duty-form-select-label">
          Rest type (base / CAR 700.40)
          <span className="duty-form-select-wrap">
            <select
              className="duty-form-select"
              value={restType}
              onChange={(e) => onRestTypeChange(e.target.value as RestType)}
              aria-label="Rest type"
            >
              <option value="12h">12 hours rest</option>
              <option value="10+travel">
                10+travel (10 h at hotel + room key)
              </option>
            </select>
          </span>
        </label>
      )}

      {(localError || validationMessage) && (
        <div className="validation-error">
          {localError || validationMessage}
        </div>
      )}

      <button
        type="button"
        className="duty-form-btn duty-form-btn-primary"
        onClick={handleSubmit}
      >
        {mode === 'edit' ? 'Update' : 'Add'}
      </button>

      <div className="duty-form-clone">
        {!showClonePicker ? (
          <button
            type="button"
            className="duty-form-btn duty-form-btn-secondary"
            onClick={() => {
              setShowClonePicker(true)
              setCloneTargetDate(defaultDayKey)
              setCloneMessage('')
            }}
          >
            Clone to date…
          </button>
        ) : (
          <>
            <label className="duty-form-clone-label">
              Clone to
              <div className="duty-form-row duty-form-clone-row">
                <input
                  type="date"
                  value={cloneTargetDate}
                  onChange={(e) => {
                    setCloneTargetDate(e.target.value)
                    setCloneMessage('')
                  }}
                  aria-label="Clone target date"
                />
                <button
                  type="button"
                  className="duty-form-btn duty-form-btn-secondary duty-form-clone-confirm"
                  onClick={handleClone}
                >
                  Clone
                </button>
              </div>
            </label>
            <button
              type="button"
              className="duty-form-btn duty-form-btn-ghost duty-form-clone-dismiss"
              onClick={() => {
                setShowClonePicker(false)
                setCloneMessage('')
              }}
            >
              Hide clone
            </button>
          </>
        )}
        {cloneMessage && (
          <p className="duty-form-clone-success" role="status">
            {cloneMessage}
          </p>
        )}
      </div>

      <button
        type="button"
        className="duty-form-btn duty-form-btn-secondary"
        onClick={onCancel}
      >
        Cancel
      </button>
    </div>
  )
}
