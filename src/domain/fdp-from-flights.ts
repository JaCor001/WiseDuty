/**
 * Derive FDP report/release, sectors, avg band, and trailing-DH flags from legs.
 * Max FDP (CAR 700.28) uses acclimatized start hour — never raw dep-airport local
 * when the member is still acclimatized to another zone (700.28(5)).
 * Optional CAR 700.50 split-duty break extends max FDP and reduces hours of work.
 */
import { resolveAcclimatizedTZ } from './acclimatization'
import { getAirportByIcao } from './airports'
import { getMaxFdpHours } from './regulations'
import {
  computeSplitDutyExtensionFromBreak,
  formatSplitBreakSummary,
  splitBreakInsideFdp,
} from './rest-70050'
import type {
  AvgSectorTime,
  DutyEvent,
  DutyTimingBuffers,
  FlightLeg,
  Regulator,
  SplitDutyBreak,
} from './types'
import { DEFAULT_DUTY_TIMING_BUFFERS } from './types'
import {
  addCivilDaysInTimeZone,
  getHourInTZ,
  parseZonedDateTime,
  toDateInputValueInTZ,
} from './time'

export interface FdpFromFlightsInput {
  flights: FlightLeg[]
  buffers?: DutyTimingBuffers
  /** When set, use instead of auto report. */
  reportOverride?: Date | null
  releaseOverride?: Date | null
  regulator?: Regulator
  /**
   * Explicit acclimatized TZ for the 700.28 table. Prefer this when already
   * resolved via {@link resolveAcclimatizedTZ}.
   */
  acclTZ?: string
  /** Home base TZ — used with priorDuties to resolve acclimatization. */
  homeBaseTZ?: string
  /** Prior duties (before this FDP) for CAR 700.28(5) walk. */
  priorDuties?: DutyEvent[]
  /** Mid-FDP split-duty break (CAR 700.50). */
  splitBreak?: SplitDutyBreak | null
}

export interface FdpFromFlightsResult {
  ok: boolean
  error?: string
  report: Date
  release: Date
  startTZ: string
  endTZ: string
  /** Zone used for Max FDP table hour (acclimatized). */
  acclTZ: string
  /** Acclimatized wall-clock hour of report (0–23) used in the table. */
  acclimatizedStartHour: number
  /** Local wall-clock hour of report at departure airport (informational). */
  localStartHour: number
  acclimatizationReason: string
  operatingSectors: number
  positioningSectors: number
  avgSectorTime: AvgSectorTime
  endsWithPositioning: boolean
  operatingEnd?: Date
  reportBufferMin: number
  releaseBufferMin: number
  reportAuto: Date
  releaseAuto: Date
  reportReason: string
  releaseReason: string
  /** Unaffected 700.28 table maximum. */
  maxFdpHours: number
  /** CAR 700.50 extension hours (0 if no valid split). */
  splitExtensionHours: number
  /** maxFdpHours + splitExtensionHours. */
  extendedMaxFdpHours: number
  operatingHours: number
  /** FDP length report→release (includes break). */
  totalDutyHours: number
  /** totalDutyHours − break (hours of work under 700.29). */
  hoursOfWorkHours: number
  meanOperatingBlockMin: number
  completeLegs: FlightLeg[]
  splitBreakSummary?: string
}

function hoursBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 3_600_000
}

export function avgSectorBandFromMinutes(meanMin: number): AvgSectorTime {
  if (meanMin < 30) return '<30'
  if (meanMin < 50) return '30-50'
  return '>=50'
}

export function selectReportBufferMin(
  first: FlightLeg,
  buffers: DutyTimingBuffers,
): { min: number; reason: string } {
  const customs = !!first.customsPreclearance
  if (first.isDeadhead) {
    if (customs) {
      return {
        min: buffers.reportDeadheadCustomsMin,
        reason: `deadhead + customs pre-clearance (${buffers.reportDeadheadCustomsMin} min before first dep)`,
      }
    }
    return {
      min: buffers.reportDeadheadMin,
      reason: `deadhead (${buffers.reportDeadheadMin} min before first dep)`,
    }
  }
  if (customs) {
    return {
      min: buffers.reportOperatingCustomsMin,
      reason: `operating + customs pre-clearance (${buffers.reportOperatingCustomsMin} min before first dep)`,
    }
  }
  return {
    min: buffers.reportOperatingMin,
    reason: `operating (${buffers.reportOperatingMin} min before first dep)`,
  }
}

export function selectReleaseBufferMin(
  last: FlightLeg,
  buffers: DutyTimingBuffers,
): { min: number; reason: string } {
  if (last.isDeadhead) {
    return {
      min: buffers.releaseDeadheadMin,
      reason: `after deadhead arrival (${buffers.releaseDeadheadMin} min)`,
    }
  }
  return {
    min: buffers.releaseOperatingMin,
    reason: `after operating arrival (${buffers.releaseOperatingMin} min)`,
  }
}

/**
 * Resolve a report instant from wall-clock time + first departure.
 * Prefer the same local civil day as departure; if that would place report
 * after departure (e.g. dep 00:30, report 23:00), use the previous civil day.
 */
export function resolveReportDateTimeFromTime(
  reportHHmm: string,
  firstDep: Date,
  depTZ: string,
): Date | null {
  const t = reportHHmm.trim()
  if (!t || isNaN(firstDep.getTime())) return null

  const depDay = toDateInputValueInTZ(firstDep, depTZ)
  let candidate = parseZonedDateTime(depDay, t, depTZ)
  if (isNaN(candidate.getTime())) return null

  // Same calendar day would be after departure → previous local day
  if (candidate.getTime() > firstDep.getTime()) {
    const prevMidnight = addCivilDaysInTimeZone(firstDep, depTZ, -1)
    const prevDay = toDateInputValueInTZ(prevMidnight, depTZ)
    candidate = parseZonedDateTime(prevDay, t, depTZ)
    if (isNaN(candidate.getTime())) return null
  }

  return candidate
}

/**
 * Resolve a release instant from wall-clock time + last arrival.
 * Prefer the same local civil day as arrival; if that would place release
 * before arrival (e.g. arr 23:40, release 00:10), use the next civil day.
 */
export function resolveReleaseDateTimeFromTime(
  releaseHHmm: string,
  lastArr: Date,
  arrTZ: string,
): Date | null {
  const t = releaseHHmm.trim()
  if (!t || isNaN(lastArr.getTime())) return null

  const arrDay = toDateInputValueInTZ(lastArr, arrTZ)
  let candidate = parseZonedDateTime(arrDay, t, arrTZ)
  if (isNaN(candidate.getTime())) return null

  if (candidate.getTime() < lastArr.getTime()) {
    const nextMidnight = addCivilDaysInTimeZone(lastArr, arrTZ, 1)
    const nextDay = toDateInputValueInTZ(nextMidnight, arrTZ)
    candidate = parseZonedDateTime(nextDay, t, arrTZ)
    if (isNaN(candidate.getTime())) return null
  }

  return candidate
}

/** Short UI hint when report falls on a different civil day than first dep. */
export function reportDayRelativeHint(
  report: Date,
  firstDep: Date,
  depTZ: string,
): string | null {
  if (isNaN(report.getTime()) || isNaN(firstDep.getTime())) return null
  const reportDay = toDateInputValueInTZ(report, depTZ)
  const depDay = toDateInputValueInTZ(firstDep, depTZ)
  if (reportDay === depDay) return null
  if (reportDay < depDay) {
    return `Day before dep · ${reportDay}`
  }
  return reportDay
}

/** Legs with both airports and valid arr > dep. */
export function completeFlightLegs(flights: FlightLeg[]): FlightLeg[] {
  return flights.filter((f) => {
    if (!f.depIcao || !f.arrIcao) return false
    if (isNaN(f.dep.getTime()) || isNaN(f.arr.getTime())) return false
    if (f.arr.getTime() <= f.dep.getTime()) return false
    return true
  })
}

export function deriveFdpFromFlights(
  input: FdpFromFlightsInput,
): FdpFromFlightsResult {
  const buffers = input.buffers ?? DEFAULT_DUTY_TIMING_BUFFERS
  const regulator = input.regulator ?? 'TC'
  const legs = completeFlightLegs(input.flights).sort(
    (a, b) => a.dep.getTime() - b.dep.getTime(),
  )

  const fail = (error: string): FdpFromFlightsResult => ({
    ok: false,
    error,
    report: new Date(NaN),
    release: new Date(NaN),
    startTZ: 'UTC',
    endTZ: 'UTC',
    acclTZ: 'UTC',
    acclimatizedStartHour: 0,
    localStartHour: 0,
    acclimatizationReason: '',
    operatingSectors: 0,
    positioningSectors: 0,
    avgSectorTime: '>=50',
    endsWithPositioning: false,
    reportBufferMin: 0,
    releaseBufferMin: 0,
    reportAuto: new Date(NaN),
    releaseAuto: new Date(NaN),
    reportReason: '',
    releaseReason: '',
    maxFdpHours: 0,
    splitExtensionHours: 0,
    extendedMaxFdpHours: 0,
    operatingHours: 0,
    totalDutyHours: 0,
    hoursOfWorkHours: 0,
    meanOperatingBlockMin: 0,
    completeLegs: legs,
  })

  if (legs.length === 0) {
    return fail('Add at least one complete flight (airports and times).')
  }

  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i]
    if (!getAirportByIcao(leg.depIcao)) {
      return fail(`Unknown departure airport: ${leg.depIcao}`)
    }
    if (!getAirportByIcao(leg.arrIcao)) {
      return fail(`Unknown arrival airport: ${leg.arrIcao}`)
    }
    if (i > 0 && leg.dep.getTime() < legs[i - 1].arr.getTime()) {
      return fail(
        `Flight ${i + 1} departs before the previous flight arrives.`,
      )
    }
  }

  const first = legs[0]
  const last = legs[legs.length - 1]
  const depAp = getAirportByIcao(first.depIcao)!
  const arrAp = getAirportByIcao(last.arrIcao)!
  const startTZ = depAp.tz
  const endTZ = arrAp.tz

  const reportBuf = selectReportBufferMin(first, buffers)
  const releaseBuf = selectReleaseBufferMin(last, buffers)

  const reportAuto = new Date(
    first.dep.getTime() - reportBuf.min * 60_000,
  )
  const releaseAuto = new Date(
    last.arr.getTime() + releaseBuf.min * 60_000,
  )

  const report =
    input.reportOverride && !isNaN(input.reportOverride.getTime())
      ? input.reportOverride
      : reportAuto
  const release =
    input.releaseOverride && !isNaN(input.releaseOverride.getTime())
      ? input.releaseOverride
      : releaseAuto

  if (report.getTime() > first.dep.getTime()) {
    return fail('Report time must be on or before the first departure.')
  }
  if (release.getTime() < last.arr.getTime()) {
    return fail('Release time must be on or after the last arrival.')
  }

  const operating = legs.filter((l) => !l.isDeadhead)
  const positioning = legs.filter((l) => l.isDeadhead)
  // 700.28 table needs ≥1; all-DH day uses leg count as floor
  const sectorsForTable =
    operating.length > 0 ? operating.length : Math.max(1, legs.length)

  let meanOperatingBlockMin = 0
  if (operating.length > 0) {
    const sumMin = operating.reduce(
      (s, l) => s + (l.arr.getTime() - l.dep.getTime()) / 60_000,
      0,
    )
    meanOperatingBlockMin = sumMin / operating.length
  } else {
    const sumMin = legs.reduce(
      (s, l) => s + (l.arr.getTime() - l.dep.getTime()) / 60_000,
      0,
    )
    meanOperatingBlockMin = sumMin / legs.length
  }
  const avgSectorTime = avgSectorBandFromMinutes(meanOperatingBlockMin)

  const endsWithPositioning = last.isDeadhead
  let operatingEnd: Date | undefined
  if (endsWithPositioning) {
    const lastOp = [...legs].reverse().find((l) => !l.isDeadhead)
    operatingEnd = lastOp ? lastOp.arr : undefined
    // All-DH: no separate operating end for 700.43(1); treat as duty bar only
  }

  // CAR 700.28: table hour is acclimatized local time of FDP start — not dep airport
  // local unless the member is acclimatized there (700.28(5)).
  // Never fall back to departure TZ alone as “acclimatized” without walking history
  // from home base (that was the multi-layover pairing bug).
  const homeBase = input.homeBaseTZ || input.acclTZ || startTZ
  const acclRes = resolveAcclimatizedTZ({
    homeBaseTZ: homeBase,
    priorDuties: input.priorDuties ?? [],
    at: report,
    localTZ: startTZ,
  })
  const accl = acclRes.acclTZ

  const acclimatizedStartHour = getHourInTZ(report, accl)
  const localStartHour = getHourInTZ(report, startTZ)
  const maxFdpHours = getMaxFdpHours(
    regulator,
    acclimatizedStartHour,
    sectorsForTable,
    avgSectorTime,
  )

  const totalDutyHours = hoursBetween(report, release)
  const operatingHours = operatingEnd
    ? hoursBetween(report, operatingEnd)
    : totalDutyHours

  // CAR 700.50 split-duty extension
  let splitExtensionHours = 0
  let hoursOfWorkHours = totalDutyHours
  let splitBreakSummary: string | undefined
  const br = input.splitBreak
  if (br && regulator === 'TC') {
    // Mid-FDP break must sit between report and release. Common setup error:
    // only pre-break flights entered → release is still before break end.
    if (br.start.getTime() < report.getTime() - 500) {
      return fail(
        'Split-duty break starts before report. Move the break after report (and usually after the first flight’s arrival).',
      )
    }
    if (br.end.getTime() > release.getTime() + 500) {
      return fail(
        'Split-duty break ends after release. A split break is mid-FDP: add at least one flight after the break so release is after the break ends (CAR 700.50).',
      )
    }
    if (br.end.getTime() <= br.start.getTime()) {
      return fail('Split-duty break end must be after break start.')
    }
    if (!splitBreakInsideFdp(br.start, br.end, report, release)) {
      return fail(
        'Split-duty break must fall entirely within the flight duty period (report → release).',
      )
    }
    for (const leg of legs) {
      const overlaps =
        leg.dep.getTime() < br.end.getTime() &&
        leg.arr.getTime() > br.start.getTime()
      if (overlaps) {
        return fail(
          'A flight overlaps the split-duty break. Put pre-break flights before the break and post-break flights after it.',
        )
      }
    }
    const ext = computeSplitDutyExtensionFromBreak(br, accl)
    if (!ext.ok) {
      return fail(ext.error || 'Invalid split-duty break.')
    }
    splitExtensionHours = ext.extensionHours
    hoursOfWorkHours = Math.max(0, totalDutyHours - ext.breakHours)
    splitBreakSummary = formatSplitBreakSummary(ext)
  }

  const extendedMaxFdpHours = maxFdpHours + splitExtensionHours

  const firstCode = first.depIcao
  const lastCode = last.arrIcao

  const acclimatizationReason = acclRes.reason

  return {
    ok: true,
    report,
    release,
    startTZ,
    endTZ,
    acclTZ: accl,
    acclimatizedStartHour,
    localStartHour,
    acclimatizationReason,
    operatingSectors: operating.length,
    positioningSectors: positioning.length,
    avgSectorTime,
    endsWithPositioning,
    operatingEnd,
    reportBufferMin: reportBuf.min,
    releaseBufferMin: releaseBuf.min,
    reportAuto,
    releaseAuto,
    reportReason: `auto · ${reportBuf.reason} · ${firstCode} ${startTZ.replace(/_/g, ' ')}`,
    releaseReason: `auto · ${releaseBuf.reason} · ${lastCode} ${endTZ.replace(/_/g, ' ')}`,
    maxFdpHours,
    splitExtensionHours,
    extendedMaxFdpHours,
    operatingHours,
    totalDutyHours,
    hoursOfWorkHours,
    meanOperatingBlockMin,
    completeLegs: legs,
    splitBreakSummary,
  }
}

export function newEmptyFlightLeg(id?: string): FlightLeg {
  return {
    id: id || `leg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    depIcao: '',
    arrIcao: '',
    dep: new Date(NaN),
    arr: new Date(NaN),
    isDeadhead: false,
    customsPreclearance: false,
  }
}
