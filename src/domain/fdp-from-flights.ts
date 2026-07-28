/**
 * Derive FDP report/release, sectors, avg band, and trailing-DH flags from legs.
 */
import { getAirportByIcao } from './airports'
import { getMaxFdpHours } from './regulations'
import type {
  AvgSectorTime,
  DutyTimingBuffers,
  FlightLeg,
  Regulator,
} from './types'
import { DEFAULT_DUTY_TIMING_BUFFERS } from './types'
import { getHourInTZ } from './time'

export interface FdpFromFlightsInput {
  flights: FlightLeg[]
  buffers?: DutyTimingBuffers
  /** When set, use instead of auto report. */
  reportOverride?: Date | null
  releaseOverride?: Date | null
  regulator?: Regulator
  acclTZ?: string
}

export interface FdpFromFlightsResult {
  ok: boolean
  error?: string
  report: Date
  release: Date
  startTZ: string
  endTZ: string
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
  maxFdpHours: number
  operatingHours: number
  totalDutyHours: number
  meanOperatingBlockMin: number
  completeLegs: FlightLeg[]
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
    operatingHours: 0,
    totalDutyHours: 0,
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

  const accl = input.acclTZ || startTZ
  const startHour = getHourInTZ(report, accl)
  const maxFdpHours = getMaxFdpHours(
    regulator,
    startHour,
    sectorsForTable,
    avgSectorTime,
  )

  const totalDutyHours = hoursBetween(report, release)
  const operatingHours = operatingEnd
    ? hoursBetween(report, operatingEnd)
    : totalDutyHours

  const firstCode = first.depIcao
  const lastCode = last.arrIcao

  return {
    ok: true,
    report,
    release,
    startTZ,
    endTZ,
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
    operatingHours,
    totalDutyHours,
    meanOperatingBlockMin,
    completeLegs: legs,
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
