/**
 * Flight-based Add/Edit FDP form.
 * Report/release auto from settings buffers; sectors & avg band derived.
 */
import { useEffect, useMemo, useState } from 'react'
import { getAirportByIcao } from './domain/airports'
import {
  deriveFdpFromFlights,
  newEmptyFlightLeg,
} from './domain/fdp-from-flights'
import { assertPositioningAllowed } from './domain/rest-70043'
import type {
  DutyEvent,
  DutyTimingBuffers,
  FlightLeg,
  Regulator,
  RestType,
  TimeFormat,
} from './domain/types'
import {
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
  restType: RestType
  onRestTypeChange: (v: RestType) => void
  validationMessage: string
  onCancel: () => void
  onSubmit: (payload: {
    duty: Omit<DutyEvent, 'id' | 'title' | 'type' | 'violated'> & {
      title?: string
    }
    restType: RestType
  }) => void
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

function emptyDraft(dayKey: string, id?: string): DutyFormDraftLeg {
  return {
    id: id || newEmptyFlightLeg().id,
    depIcao: '',
    arrIcao: '',
    depDate: dayKey,
    depTime: '',
    arrDate: dayKey,
    arrTime: '',
    isDeadhead: false,
    customsPreclearance: false,
  }
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

function formatDur(ms: number): string {
  if (!(ms > 0)) return '—'
  const m = Math.round(ms / 60_000)
  const h = Math.floor(m / 60)
  const mm = m % 60
  if (h === 0) return `${mm}m`
  return mm ? `${h}h ${mm}m` : `${h}h`
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
  restType,
  onRestTypeChange,
  validationMessage,
  onCancel,
  onSubmit,
}: DutyFormProps) {
  const [legs, setLegs] = useState<DutyFormDraftLeg[]>(() => [
    emptyDraft(defaultDayKey),
  ])
  const [reportTime, setReportTime] = useState('')
  const [reportDate, setReportDate] = useState(defaultDayKey)
  const [releaseTime, setReleaseTime] = useState('')
  const [releaseDate, setReleaseDate] = useState(defaultDayKey)
  const [reportOverridden, setReportOverridden] = useState(false)
  const [releaseOverridden, setReleaseOverridden] = useState(false)
  const [positioningAgreed, setPositioningAgreed] = useState(false)
  const [localError, setLocalError] = useState('')

  // Hydrate from edit event once
  useEffect(() => {
    if (!editEvent) return
    if (editEvent.flights && editEvent.flights.length > 0) {
      setLegs(
        editEvent.flights.map((f) => draftFromLeg(f, defaultDayKey)),
      )
    } else {
      // Legacy: empty flight + overrides from stored start/end
      setLegs([emptyDraft(defaultDayKey)])
    }
    const sTz = editEvent.startTZ || editEvent.acclTZ || acclTZ
    const eTz = editEvent.endTZ || editEvent.acclTZ || acclTZ
    setReportDate(toDateInputValueInTZ(editEvent.start, sTz))
    setReportTime(formatHHmmInTZ(editEvent.start, sTz))
    setReleaseDate(toDateInputValueInTZ(editEvent.end, eTz))
    setReleaseTime(formatHHmmInTZ(editEvent.end, eTz))
    setReportOverridden(!!editEvent.reportOverridden || !editEvent.flights?.length)
    setReleaseOverridden(
      !!editEvent.releaseOverridden || !editEvent.flights?.length,
    )
    setPositioningAgreed(!!editEvent.positioningAgreed)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate on open only
  }, [editEvent?.id])

  const parsedLegs: FlightLeg[] = useMemo(() => {
    return legs
      .map(draftToFlightLeg)
      .filter((f): f is FlightLeg => f != null)
  }, [legs])

  const derived = useMemo(() => {
    if (parsedLegs.length === 0) return null
    let reportOverride: Date | null = null
    let releaseOverride: Date | null = null
    if (reportOverridden && reportDate && reportTime && parsedLegs[0]) {
      const tz =
        getAirportByIcao(parsedLegs[0].depIcao)?.tz || acclTZ
      const d = parseZonedDateTime(reportDate, reportTime, tz)
      if (!isNaN(d.getTime())) reportOverride = d
    }
    if (releaseOverridden && releaseDate && releaseTime) {
      const last = parsedLegs[parsedLegs.length - 1]
      const tz = getAirportByIcao(last.arrIcao)?.tz || acclTZ
      const d = parseZonedDateTime(releaseDate, releaseTime, tz)
      if (!isNaN(d.getTime())) releaseOverride = d
    }
    return deriveFdpFromFlights({
      flights: parsedLegs,
      buffers,
      reportOverride,
      releaseOverride,
      regulator,
      acclTZ,
    })
  }, [
    parsedLegs,
    buffers,
    reportOverridden,
    releaseOverridden,
    reportDate,
    reportTime,
    releaseDate,
    releaseTime,
    regulator,
    acclTZ,
  ])

  // Sync auto report/release into fields when not overridden
  useEffect(() => {
    if (!derived?.ok) return
    if (!reportOverridden) {
      setReportDate(toDateInputValueInTZ(derived.reportAuto, derived.startTZ))
      setReportTime(formatHHmmInTZ(derived.reportAuto, derived.startTZ))
    }
    if (!releaseOverridden) {
      setReleaseDate(toDateInputValueInTZ(derived.releaseAuto, derived.endTZ))
      setReleaseTime(formatHHmmInTZ(derived.releaseAuto, derived.endTZ))
    }
  }, [derived, reportOverridden, releaseOverridden])

  const updateLeg = (id: string, patch: Partial<DutyFormDraftLeg>) => {
    setLegs((prev) =>
      prev.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    )
  }

  const addLeg = () => {
    setLegs((prev) => {
      const last = prev[prev.length - 1]
      const next = emptyDraft(last?.arrDate || defaultDayKey)
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

  const handleSubmit = () => {
    setLocalError('')
    if (!derived || !derived.ok) {
      setLocalError(derived?.error || 'Complete at least one flight.')
      return
    }
    if (regulator === 'TC' && derived.endsWithPositioning && derived.operatingEnd) {
      const allowed = assertPositioningAllowed({
        start: derived.report,
        end: derived.release,
        operatingEnd: derived.operatingEnd,
        maxFdpHours: derived.maxFdpHours,
        positioningAgreed,
      })
      if (!allowed.ok) {
        setLocalError(allowed.detail || 'Positioning not allowed.')
        return
      }
    } else if (
      derived.totalDutyHours > derived.maxFdpHours + 1e-9 &&
      !derived.endsWithPositioning
    ) {
      setLocalError(
        `Duty ${derived.totalDutyHours.toFixed(1)} h exceeds max FDP ${derived.maxFdpHours} h.`,
      )
      return
    }

    onSubmit({
      restType,
      duty: {
        start: derived.report,
        end: derived.release,
        acclTZ,
        startTZ: derived.startTZ,
        endTZ: derived.endTZ,
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
      },
    })
  }

  return (
    <div className="duty-form">
      <h3>
        {mode === 'edit' ? 'Edit Duty' : 'Add Duty'} · {dutyDateLabel}
      </h3>
      <p className="form-hint">
        Enter flights; report and release are calculated from Settings buffers
        (override anytime). Home base {homeBaseTZ.replace(/_/g, ' ')}.
      </p>

      {/* Report */}
      <div className="duty-form-block">
        <label>
          Report time
          <div className="duty-form-row">
            <input
              type="date"
              value={reportDate}
              onChange={(e) => {
                setReportOverridden(true)
                setReportDate(e.target.value)
              }}
            />
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
        </label>
        {derived?.ok && (
          <p className="form-hint">
            {reportOverridden ? (
              <>
                Manual override.{' '}
                <button
                  type="button"
                  className="duty-form-btn duty-form-btn-ghost"
                  onClick={() => setReportOverridden(false)}
                >
                  Use auto
                </button>
              </>
            ) : (
              derived.reportReason
            )}
          </p>
        )}
      </div>

      {/* Flights */}
      {legs.map((leg, index) => {
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
              <strong>Flight {index + 1}</strong>
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
            <label>
              Departure airport
              <AirportSelector
                valueIcao={leg.depIcao}
                onChange={(icao) => updateLeg(leg.id, { depIcao: icao })}
              />
            </label>
            <label>
              Departure date / time
              <div className="duty-form-row">
                <input
                  type="date"
                  value={leg.depDate}
                  onChange={(e) =>
                    updateLeg(leg.id, { depDate: e.target.value })
                  }
                />
                <FreeTimeInput
                  value={leg.depTime}
                  onChange={(t) => updateLeg(leg.id, { depTime: t })}
                  timeFormat={timeFormat}
                  aria-label={`Flight ${index + 1} departure time`}
                />
              </div>
              {depAp && leg.depTime && (
                <span className="time-display">
                  {formatTimeDisplay(leg.depTime, timeFormat)} ·{' '}
                  {depAp.tz.replace(/_/g, ' ')}
                </span>
              )}
            </label>
            <label>
              Arrival airport
              <AirportSelector
                valueIcao={leg.arrIcao}
                onChange={(icao) => updateLeg(leg.id, { arrIcao: icao })}
              />
            </label>
            <label>
              Arrival date / time
              <div className="duty-form-row">
                <input
                  type="date"
                  value={leg.arrDate}
                  onChange={(e) =>
                    updateLeg(leg.id, { arrDate: e.target.value })
                  }
                />
                <FreeTimeInput
                  value={leg.arrTime}
                  onChange={(t) => updateLeg(leg.id, { arrTime: t })}
                  timeFormat={timeFormat}
                  aria-label={`Flight ${index + 1} arrival time`}
                />
              </div>
              {arrAp && leg.arrTime && (
                <span className="time-display">
                  {formatTimeDisplay(leg.arrTime, timeFormat)} ·{' '}
                  {arrAp.tz.replace(/_/g, ' ')}
                </span>
              )}
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={leg.isDeadhead}
                onChange={(e) =>
                  updateLeg(leg.id, { isDeadhead: e.target.checked })
                }
              />
              Deadhead / positioning
            </label>
            {index === 0 && (
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={leg.customsPreclearance}
                  onChange={(e) =>
                    updateLeg(leg.id, {
                      customsPreclearance: e.target.checked,
                    })
                  }
                />
                Customs pre-clearance (report buffer)
              </label>
            )}
            {dur && (
              <p className="form-hint">
                Block {dur}
                {leg.isDeadhead ? ' · DH (not in sector count)' : ' · operating'}
              </p>
            )}
          </div>
        )
      })}

      <button
        type="button"
        className="duty-form-btn duty-form-btn-secondary duty-form-add-flight"
        onClick={addLeg}
      >
        + Add flight
      </button>

      {/* Release */}
      <div className="duty-form-block">
        <label>
          Release time
          <div className="duty-form-row">
            <input
              type="date"
              value={releaseDate}
              onChange={(e) => {
                setReleaseOverridden(true)
                setReleaseDate(e.target.value)
              }}
            />
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
        </label>
        {derived?.ok && (
          <p className="form-hint">
            {releaseOverridden ? (
              <>
                Manual override.{' '}
                <button
                  type="button"
                  className="duty-form-btn duty-form-btn-ghost"
                  onClick={() => setReleaseOverridden(false)}
                >
                  Use auto
                </button>
              </>
            ) : (
              derived.releaseReason
            )}
          </p>
        )}
      </div>

      {derived?.ok && (
        <div className="duty-form-derived">
          <p>
            <strong>Max FDP</strong> {derived.maxFdpHours} h ·{' '}
            {derived.operatingSectors || 0} operating sector
            {derived.operatingSectors === 1 ? '' : 's'} · avg{' '}
            {derived.avgSectorTime === '<30'
              ? '<30 min'
              : derived.avgSectorTime === '30-50'
                ? '30–50 min'
                : '≥50 min'}
          </p>
          <p>
            Duty {derived.totalDutyHours.toFixed(1)} h
            {derived.endsWithPositioning && derived.operatingEnd
              ? ` · operating to ${derived.operatingEnd.toLocaleString()} · trailing DH (700.43)`
              : ''}
          </p>
        </div>
      )}

      {derived?.ok &&
        derived.endsWithPositioning &&
        derived.totalDutyHours - derived.maxFdpHours > 3 && (
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={positioningAgreed}
              onChange={(e) => setPositioningAgreed(e.target.checked)}
            />
            Crew agrees to extended positioning (&gt;3 h past max FDP, 700.43(3))
          </label>
        )}

      <label>
        Rest type (base / CAR 700.40)
        <select
          value={restType}
          onChange={(e) => onRestTypeChange(e.target.value as RestType)}
        >
          <option value="12h">12 hours rest</option>
          <option value="10+travel">10+travel (10 h at hotel + room key)</option>
        </select>
      </label>

      {(localError || validationMessage) && (
        <div className="validation-error">
          {localError || validationMessage}
        </div>
      )}

      <button type="button" className="duty-form-btn duty-form-btn-primary" onClick={handleSubmit}>
        {mode === 'edit' ? 'Update' : 'Add'}
      </button>
      <button type="button" className="duty-form-btn duty-form-btn-secondary" onClick={onCancel}>
        Cancel
      </button>
    </div>
  )
}
