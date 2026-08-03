/**
 * Import crew schedule from the device Calendar app (iOS/Android).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  importScheduleFromEvents,
  mergeImportedDuties,
  replaceDutiesInRange,
  type ScheduleImportResult,
} from '../../domain/schedule-import'
import type { DutyEvent, ImportReportMode } from '../../domain/types'
import { applyScheduleMutation } from '../../domain/schedule-pipeline'
import { useSettings } from '../settings/SettingsContext'
import {
  getCalendarAccess,
  type DeviceCalendarInfo,
} from '../../shared/calendar-access'
import { IconClose } from '../../shared/ui/icons'
import '../../shared/ui/SettingsPanel.css'

export interface CalendarImportPanelProps {
  events: DutyEvent[]
  onImport: (nextEvents: DutyEvent[]) => void
  onClose: () => void
}

type MergeMode = 'merge' | 'replace'

function toDateInput(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function startOfLocalDayFromInput(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0)
}

function endOfLocalDayFromInput(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1, 23, 59, 59, 999)
}

export default function CalendarImportPanel({
  events,
  onImport,
  onClose,
}: CalendarImportPanelProps) {
  const {
    referenceTZ,
    acclTZ,
    dutyTimingBuffers,
    regulator,
    importCalendarId,
    setImportCalendarId,
    importCalendarName,
    setImportCalendarName,
    importReportMode,
    setImportReportMode,
    importDefaultRangeDays,
  } = useSettings()

  const homeBaseTZ = referenceTZ || acclTZ

  const [available, setAvailable] = useState(false)
  const [platform, setPlatform] = useState('web')
  const [perm, setPerm] = useState<string>('unknown')
  const [calendars, setCalendars] = useState<DeviceCalendarInfo[]>([])
  const [selectedId, setSelectedId] = useState(importCalendarId)
  const [selectedName, setSelectedName] = useState(importCalendarName)
  const [rangeStart, setRangeStart] = useState(() => toDateInput(new Date()))
  const [rangeEnd, setRangeEnd] = useState(() => {
    const e = new Date()
    e.setDate(e.getDate() + (importDefaultRangeDays || 30))
    return toDateInput(e)
  })
  const [reportMode, setReportMode] = useState<ImportReportMode>(importReportMode)
  const [mergeMode, setMergeMode] = useState<MergeMode>('merge')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<ScheduleImportResult | null>(null)
  const [statusMsg, setStatusMsg] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const access = await getCalendarAccess()
      if (cancelled) return
      setAvailable(access.isAvailable())
      setPlatform(access.platformLabel())
      if (!access.isAvailable()) return
      const p = await access.checkPermission()
      setPerm(p)
      if (p === 'granted') {
        try {
          const list = await access.listCalendars()
          if (!cancelled) setCalendars(list)
        } catch (e) {
          if (!cancelled)
            setError(e instanceof Error ? e.message : 'Could not list calendars')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const selectedCalendar = useMemo(
    () =>
      calendars.find((c) => c.id === selectedId) ||
      calendars.find((c) => c.title === selectedName),
    [calendars, selectedId, selectedName],
  )

  const requestAccess = useCallback(async () => {
    setError('')
    setBusy(true)
    try {
      const access = await getCalendarAccess()
      const p = await access.requestPermission()
      setPerm(p)
      if (p !== 'granted') {
        setError('Calendar access was denied. Enable it in iOS Settings → WiseDuty.')
        return
      }
      const list = await access.listCalendars()
      setCalendars(list)
      if (!selectedId && list[0]) {
        setSelectedId(list[0].id)
        setSelectedName(list[0].displayName || list[0].title)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Permission request failed')
    } finally {
      setBusy(false)
    }
  }, [selectedId])

  const runPreview = useCallback(async () => {
    setError('')
    setPreview(null)
    setStatusMsg('')
    setBusy(true)
    try {
      const access = await getCalendarAccess()
      if (!access.isAvailable()) {
        setError('Calendar import requires the iOS or Android app.')
        return
      }
      if (perm !== 'granted') {
        setError('Grant calendar access first.')
        return
      }
      const cal = selectedCalendar
      if (!cal) {
        setError('Select a calendar.')
        return
      }
      const start = startOfLocalDayFromInput(rangeStart)
      const end = endOfLocalDayFromInput(rangeEnd)
      if (end <= start) {
        setError('End date must be after start date.')
        return
      }
      const raw = await access.listEvents({
        calendarId: cal.id,
        calendarName: cal.title,
        start,
        end,
      })
      const result = importScheduleFromEvents(raw, {
        reportMode,
        buffers: dutyTimingBuffers,
        homeBaseTZ,
        acclTZ,
      })
      setPreview(result)
      setImportCalendarId(cal.id)
      setImportCalendarName(cal.title)
      setImportReportMode(reportMode)
      if (result.duties.length === 0) {
        setStatusMsg(
          `No duties parsed from ${raw.length} calendar event${raw.length === 1 ? '' : 's'}. Check that flight titles include routes like YYZ-YVR.`,
        )
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import preview failed')
    } finally {
      setBusy(false)
    }
  }, [
    perm,
    selectedCalendar,
    rangeStart,
    rangeEnd,
    reportMode,
    dutyTimingBuffers,
    homeBaseTZ,
    acclTZ,
    setImportCalendarId,
    setImportCalendarName,
    setImportReportMode,
  ])

  const confirmImport = useCallback(() => {
    if (!preview || preview.duties.length === 0) return
    setBusy(true)
    try {
      const start = startOfLocalDayFromInput(rangeStart)
      const end = endOfLocalDayFromInput(rangeEnd)
      const stamped = preview.duties.map((d) => ({
        ...d,
        importSource: {
          ...d.importSource,
          calendarId: selectedId || selectedCalendar?.id,
        },
      }))
      let merged: DutyEvent[]
      let note = ''
      if (mergeMode === 'replace') {
        merged = replaceDutiesInRange(events, stamped, start, end)
        note = `Replaced duties in range; imported ${stamped.length}.`
      } else {
        const m = mergeImportedDuties(events, stamped)
        merged = m.events
        note = `Added ${m.added}, skipped ${m.skippedOverlap} overlapping.`
      }
      // Full pipeline: recompute → 10+travel across duties → evaluate70029
      const result = applyScheduleMutation(
        [],
        {
          type: 'replace_schedule',
          events: merged,
          applyTenPlusTravelAll: true,
        },
        {
          regulator,
          homeBaseTZ,
          globalAcclTZ: acclTZ || homeBaseTZ,
        },
      )
      onImport(result.events)
      const tenPlus = result.notices.filter((n) => n.kind === 'ten_plus_travel')
        .length
      setStatusMsg(
        `Import complete. ${note}` +
          (tenPlus
            ? ` Applied ${tenPlus} reduced-rest (10+travel) conversion(s).`
            : ''),
      )
      setPreview(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setBusy(false)
    }
  }, [
    preview,
    rangeStart,
    rangeEnd,
    mergeMode,
    events,
    selectedId,
    selectedCalendar,
    regulator,
    homeBaseTZ,
    acclTZ,
    onImport,
  ])

  const body = (
    <div
      className="info-sheet-overlay"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="info-sheet free-proposals-sheet calendar-import-sheet"
        role="dialog"
        aria-labelledby="calendar-import-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="info-sheet-header">
          <div className="info-sheet-heading">
            <span className="info-sheet-badge">Import</span>
            <div className="info-sheet-title-block">
              <h2 id="calendar-import-title" className="info-sheet-title">
                Import from Calendar
              </h2>
            </div>
          </div>
          <button
            type="button"
            className="info-sheet-close"
            aria-label="Close"
            onClick={onClose}
          >
            <IconClose size={18} />
          </button>
        </header>

        <div className="info-sheet-body">
          {!available && (
            <p className="info-sheet-section-text">
              Schedule import reads the iPhone (or Android) Calendar app via
              EventKit. Open WiseDuty in the native app to select a calendar and
              import. Web builds cannot access device calendars.
            </p>
          )}

          {available && (
            <>
              <p className="settings-section-hint">
                Platform: {platform}. Permission: {perm}.
              </p>

              {perm !== 'granted' && (
                <button
                  type="button"
                  className="day-details-btn day-details-btn-primary"
                  disabled={busy}
                  onClick={requestAccess}
                >
                  Allow calendar access
                </button>
              )}

              {perm === 'granted' && (
                <>
                  <label>
                    Calendar
                    <select
                      value={selectedId || selectedName}
                      onChange={(e) => {
                        const cal =
                          calendars.find((c) => c.id === e.target.value) ||
                          calendars.find((c) => c.title === e.target.value)
                        if (cal) {
                          setSelectedId(cal.id)
                          setSelectedName(cal.displayName || cal.title)
                        }
                      }}
                    >
                      {calendars.length === 0 && (
                        <option value="">No calendars found</option>
                      )}
                      {calendars.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.displayName || c.title}
                          {c.isPrimary ? ' (default)' : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="settings-section-hint">
                    Choose the crew/work calendar from your Calendar app (not
                    personal unless that is where pairings live).
                  </p>

                  <div className="duty-form-row" style={{ gap: '0.5rem' }}>
                    <label style={{ flex: 1 }}>
                      From
                      <input
                        type="date"
                        value={rangeStart}
                        onChange={(e) => setRangeStart(e.target.value)}
                      />
                    </label>
                    <label style={{ flex: 1 }}>
                      To
                      <input
                        type="date"
                        value={rangeEnd}
                        onChange={(e) => setRangeEnd(e.target.value)}
                      />
                    </label>
                  </div>

                  <label>
                    Report time
                    <select
                      value={reportMode}
                      onChange={(e) =>
                        setReportMode(e.target.value as ImportReportMode)
                      }
                    >
                      <option value="auto">
                        Auto — use report from schedule if available
                      </option>
                      <option value="buffers">
                        Always buffers (Settings report times)
                      </option>
                      <option value="event_start">
                        First event start = report
                      </option>
                    </select>
                  </label>
                  <p className="settings-section-hint">
                    Auto detects “Report …”, show time, or a Report calendar
                    event; otherwise uses first departure minus report buffer.
                  </p>

                  <label>
                    On import
                    <select
                      value={mergeMode}
                      onChange={(e) =>
                        setMergeMode(e.target.value as MergeMode)
                      }
                    >
                      <option value="merge">
                        Merge (skip overlapping duties)
                      </option>
                      <option value="replace">
                        Replace duties in date range
                      </option>
                    </select>
                  </label>

                  <button
                    type="button"
                    className="day-details-btn day-details-btn-secondary"
                    disabled={busy || calendars.length === 0}
                    onClick={runPreview}
                  >
                    {busy ? 'Working…' : 'Preview import'}
                  </button>
                </>
              )}
            </>
          )}

          {error && (
            <p className="validation-error" style={{ marginTop: '0.75rem' }}>
              {error}
            </p>
          )}
          {statusMsg && (
            <p className="info-sheet-section-text" style={{ marginTop: '0.5rem' }}>
              {statusMsg}
            </p>
          )}

          {preview && preview.duties.length > 0 && (
            <section className="info-sheet-section" style={{ marginTop: '1rem' }}>
              <div className="info-sheet-section-label">Preview</div>
              <p className="info-sheet-section-text">{preview.summary}</p>
              <ul className="duty-form-stale-list">
                {preview.drafts.slice(0, 12).map((d, i) => (
                  <li key={i}>
                    <strong>{d.title}</strong>
                    {' · '}
                    {d.flights.length} flight{d.flights.length === 1 ? '' : 's'}
                    {' · report: '}
                    {d.reportSource}
                    {d.warnings.length > 0
                      ? ` · ⚠ ${d.warnings.join('; ')}`
                      : ''}
                  </li>
                ))}
              </ul>
              {preview.drafts.length > 12 && (
                <p className="settings-section-hint">
                  …and {preview.drafts.length - 12} more
                </p>
              )}
              <button
                type="button"
                className="day-details-btn day-details-btn-primary"
                disabled={busy}
                onClick={confirmImport}
              >
                Confirm import
              </button>
            </section>
          )}
        </div>
      </div>
    </div>
  )

  return createPortal(body, document.body)
}
