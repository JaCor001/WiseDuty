import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type {
  CalendarTimeReference,
  Regulator,
  TimeFormat,
  TimeFreeOption,
  WeekStartDay,
} from '../../domain/types'
import { useSettings } from '../../features/settings/SettingsContext'
import TimeZoneSelector from './TimeZoneSelector'
import AppDialog from './AppDialog'
import './SettingsPanel.css'

export type DeleteEventsScope = 'month' | 'all'

type SettingsSection =
  | 'display'
  | 'regulations'
  | 'buffers'
  | 'calendarData'

interface SettingsPanelProps {
  onClose: () => void
  /** When provided, shows calendar data delete/restore controls. */
  onDeleteEvents?: (scope: DeleteEventsScope) => void
  onRestoreDeletedEvents?: () => void
  /** Permanently wipe soft-deleted events from storage (cannot restore). */
  onPurgeDeletedEvents?: () => void
  /** Label for the current month, e.g. "March 2026". */
  deleteMonthLabel?: string
  /** Number of events in soft-delete storage (enables restore / purge). */
  deletedEventCount?: number
  /** Open device calendar import sheet (native). */
  onImportSchedule?: () => void
}

function shortTz(tz: string): string {
  return tz.replace(/_/g, ' ').split('/').pop() || tz
}

export default function SettingsPanel({
  onClose,
  onDeleteEvents,
  onRestoreDeletedEvents,
  onPurgeDeletedEvents,
  deleteMonthLabel,
  deletedEventCount = 0,
  onImportSchedule,
}: SettingsPanelProps) {
  const {
    timeFormat,
    setTimeFormat,
    weekStartDay,
    setWeekStartDay,
    regulator,
    setRegulator,
    referenceTZ,
    setReferenceTZ,
    acclTZ,
    setAcclTZ,
    timeFreeOption,
    setTimeFreeOption,
    calendarTimeRef,
    setCalendarTimeRef,
    calendarDisplayTZ,
    setCalendarDisplayTZ,
    resolvedCalendarTZ,
    dutyTimingBuffers,
    setDutyTimingBuffers,
  } = useSettings()

  const [section, setSection] = useState<SettingsSection | null>(null)
  const [showDeleteOptions, setShowDeleteOptions] = useState(false)
  const [showPurgeConfirm, setShowPurgeConfirm] = useState(false)
  const canRestore = deletedEventCount > 0 && Boolean(onRestoreDeletedEvents)
  const canPurge = deletedEventCount > 0 && Boolean(onPurgeDeletedEvents)
  const showCalendarData = Boolean(onDeleteEvents)

  const [confirmDialog, setConfirmDialog] = useState<{
    title: string
    message: string
    danger?: boolean
    confirmLabel?: string
    onConfirm: () => void
  } | null>(null)

  const handleDelete = (scope: DeleteEventsScope) => {
    if (!onDeleteEvents) return
    const scopeLabel =
      scope === 'month'
        ? deleteMonthLabel
          ? `all events in ${deleteMonthLabel}`
          : 'all events in the current month'
        : 'ALL events on your calendar'
    setConfirmDialog({
      title: 'Delete events?',
      message: `Delete ${scopeLabel}? You can restore them later from Settings.`,
      danger: true,
      confirmLabel: 'Delete',
      onConfirm: () => {
        onDeleteEvents(scope)
        setShowDeleteOptions(false)
        setConfirmDialog(null)
      },
    })
  }

  const handleRestore = () => {
    if (!canRestore || !onRestoreDeletedEvents) return
    setConfirmDialog({
      title: 'Restore deleted events?',
      message: `Restore ${deletedEventCount} deleted event${deletedEventCount === 1 ? '' : 's'}?`,
      confirmLabel: 'Restore',
      onConfirm: () => {
        onRestoreDeletedEvents()
        setConfirmDialog(null)
      },
    })
  }

  const openPurgeConfirm = () => {
    if (!canPurge) return
    setShowPurgeConfirm(true)
  }

  const confirmPurgeDeleted = () => {
    if (!onPurgeDeletedEvents) return
    onPurgeDeletedEvents()
    setShowPurgeConfirm(false)
  }

  const regulatorLabel =
    regulator === 'TC'
      ? 'CAR 705'
      : regulator === 'FAA'
        ? 'FAA'
        : regulator === 'EASA'
          ? 'EASA'
          : 'CASA'

  const displaySummary = useMemo(() => {
    const fmt = timeFormat === '24h' ? '24H' : '12H'
    const week = weekStartDay === 'monday' ? 'Mon' : 'Sun'
    return `${fmt} · ${week} start · ${shortTz(resolvedCalendarTZ)}`
  }, [timeFormat, weekStartDay, resolvedCalendarTZ])

  const regulationsSummary = useMemo(() => {
    const free =
      timeFreeOption === 'auto'
        ? 'Auto free'
        : timeFreeOption === 'C'
          ? 'Opt C'
          : 'Opt D'
    return `${regulatorLabel} · ${shortTz(referenceTZ)} · ${free}`
  }, [regulatorLabel, referenceTZ, timeFreeOption])

  const buffersSummary = useMemo(() => {
    const b = dutyTimingBuffers
    return `R ${b.reportOperatingMin}/${b.reportOperatingCustomsMin} · DH ${b.reportDeadheadMin}/${b.reportDeadheadCustomsMin} · Rel ${b.releaseOperatingMin}/${b.releaseDeadheadMin}`
  }, [dutyTimingBuffers])

  const sectionTitle =
    section === 'display'
      ? 'Display & calendar'
      : section === 'regulations'
        ? 'Regulations & bases'
        : section === 'buffers'
          ? 'Report & release buffers'
          : section === 'calendarData'
            ? 'Calendar data'
            : 'Settings'

  const goBack = () => {
    setSection(null)
    setShowDeleteOptions(false)
  }

  return (
    <div className="slide-menu open settings-panel">
      <div className="settings-header">
        {section ? (
          <button
            type="button"
            className="settings-back-button"
            onClick={goBack}
            aria-label="Back to settings menu"
          >
            ← Back
          </button>
        ) : (
          <span className="settings-header-spacer" aria-hidden="true" />
        )}
        <h3 className="settings-title">{sectionTitle}</h3>
        <span className="settings-header-spacer" aria-hidden="true" />
      </div>

      {/* —— Main menu —— */}
      {!section && (
        <nav className="settings-menu" aria-label="Settings sections">
          <button
            type="button"
            className="settings-menu-item"
            onClick={() => setSection('display')}
          >
            <span className="settings-menu-item-text">
              <span className="settings-menu-item-title">Display & calendar</span>
              <span className="settings-menu-item-summary">{displaySummary}</span>
            </span>
            <span className="settings-menu-chevron" aria-hidden="true">
              ›
            </span>
          </button>

          <button
            type="button"
            className="settings-menu-item"
            onClick={() => setSection('regulations')}
          >
            <span className="settings-menu-item-text">
              <span className="settings-menu-item-title">
                Regulations & bases
              </span>
              <span className="settings-menu-item-summary">
                {regulationsSummary}
              </span>
            </span>
            <span className="settings-menu-chevron" aria-hidden="true">
              ›
            </span>
          </button>

          <button
            type="button"
            className="settings-menu-item"
            onClick={() => setSection('buffers')}
          >
            <span className="settings-menu-item-text">
              <span className="settings-menu-item-title">
                Report & release buffers
              </span>
              <span className="settings-menu-item-summary">
                {buffersSummary}
              </span>
            </span>
            <span className="settings-menu-chevron" aria-hidden="true">
              ›
            </span>
          </button>

          {onImportSchedule && (
            <button
              type="button"
              className="settings-menu-item settings-menu-item-action"
              onClick={() => {
                onClose()
                onImportSchedule()
              }}
            >
              <span className="settings-menu-item-text">
                <span className="settings-menu-item-title">
                  Import schedule from Calendar…
                </span>
                <span className="settings-menu-item-summary">
                  Device calendar → flights (report Auto when present)
                </span>
              </span>
              <span className="settings-menu-chevron" aria-hidden="true">
                ›
              </span>
            </button>
          )}

          {showCalendarData && (
            <button
              type="button"
              className="settings-menu-item settings-menu-item-danger"
              onClick={() => setSection('calendarData')}
            >
              <span className="settings-menu-item-text">
                <span className="settings-menu-item-title">Calendar data</span>
                <span className="settings-menu-item-summary">
                  {deletedEventCount > 0
                    ? `Delete · restore · purge (${deletedEventCount} deleted)`
                    : 'Delete · restore · purge'}
                </span>
              </span>
              <span className="settings-menu-chevron" aria-hidden="true">
                ›
              </span>
            </button>
          )}

          <button
            type="button"
            className="settings-close-button"
            onClick={onClose}
          >
            Close
          </button>
        </nav>
      )}

      {/* —— Display & calendar —— */}
      {section === 'display' && (
        <div className="settings-section-body">
          <label>
            Time Format
            <select
              value={timeFormat}
              onChange={(e) => setTimeFormat(e.target.value as TimeFormat)}
            >
              <option value="24h">24H</option>
              <option value="12h">12H (AM/PM)</option>
            </select>
          </label>

          <label>
            First day of week
            <select
              value={weekStartDay}
              onChange={(e) =>
                setWeekStartDay(e.target.value as WeekStartDay)
              }
            >
              <option value="sunday">Sunday</option>
              <option value="monday">Monday</option>
            </select>
          </label>
          <p className="settings-section-hint">
            Controls the leftmost column of the calendar month grid.
          </p>

          <label>
            Calendar time reference
            <select
              value={calendarTimeRef}
              onChange={(e) =>
                setCalendarTimeRef(e.target.value as CalendarTimeReference)
              }
            >
              <option value="zulu">Zulu (UTC)</option>
              <option value="device">Current local (device)</option>
              <option value="home">Home base</option>
              <option value="custom">Specific time zone…</option>
            </select>
          </label>
          {calendarTimeRef === 'custom' && (
            <label>
              Calendar time zone
              <TimeZoneSelector
                value={calendarDisplayTZ}
                onChange={setCalendarDisplayTZ}
              />
            </label>
          )}
          <p className="settings-section-hint">
            Day cells and event bars use this zone. Active:{' '}
            <strong>{resolvedCalendarTZ.replace(/_/g, ' ')}</strong>
            {calendarTimeRef === 'device'
              ? ' (device)'
              : calendarTimeRef === 'home'
                ? ' (home base)'
                : calendarTimeRef === 'zulu'
                  ? ' (Zulu)'
                  : ''}
            .
          </p>
        </div>
      )}

      {/* —— Regulations & bases —— */}
      {section === 'regulations' && (
        <div className="settings-section-body">
          <label>
            Regulator
            <select
              value={regulator}
              onChange={(e) => setRegulator(e.target.value as Regulator)}
            >
              <option value="TC">CAR 705 (Canada) — full fidelity</option>
              <option value="FAA">FAA (USA) — limited / experimental</option>
              <option value="EASA">EASA (Europe) — limited / experimental</option>
              <option value="Australia">
                CASA (Australia) — limited / experimental
              </option>
            </select>
          </label>
          {regulator !== 'TC' && (
            <p className="settings-section-hint">
              Non-TC regimes use simplified max-FDP ceilings and do not run full
              CAR 700.29 time-free evaluation. Prefer TC for production
              compliance checks.
            </p>
          )}

          <label>
            Home Base Time Zone
            <TimeZoneSelector value={referenceTZ} onChange={setReferenceTZ} />
          </label>
          <p className="settings-section-hint">
            Used for CAR 700.42 time-zone rest (away vs return to base).
          </p>

          <label>
            Acclimatization Time Zone
            <TimeZoneSelector value={acclTZ} onChange={setAcclTZ} />
          </label>

          <label>
            Time free from duty (CAR 700.29)
            <select
              value={timeFreeOption}
              onChange={(e) =>
                setTimeFreeOption(e.target.value as TimeFreeOption)
              }
            >
              <option value="auto">Auto (60 h, or 70 h when eligible)</option>
              <option value="C">Option C — 60 h + single days free</option>
              <option value="D">Option D — 70 h (5× LNR / 120 h free)</option>
            </select>
          </label>
          <p className="settings-section-hint">
            Option D requires 120 consecutive hours free including five
            consecutive local nights before exceeding 60 h work in 7 days.
          </p>
        </div>
      )}

      {/* —— Report & release buffers —— */}
      {section === 'buffers' && (
        <div className="settings-section-body">
          <p className="settings-section-hint">
            Auto report = first departure minus these minutes. Auto release =
            last arrival plus these minutes. You can still override times on
            each duty.
          </p>

          <div className="settings-buffer-groups">
            <section
              className="settings-buffer-group"
              aria-label="Report buffers"
            >
              <h4 className="settings-buffer-group-title">
                Report · min before dep
              </h4>
              <div className="settings-buffer-grid">
                <label className="settings-buffer-field">
                  <span className="settings-buffer-label">Operating</span>
                  <input
                    type="number"
                    min={0}
                    max={240}
                    inputMode="numeric"
                    value={dutyTimingBuffers.reportOperatingMin}
                    onChange={(e) =>
                      setDutyTimingBuffers({
                        ...dutyTimingBuffers,
                        reportOperatingMin: Math.max(
                          0,
                          Number(e.target.value) || 0,
                        ),
                      })
                    }
                    aria-label="Report operating minutes before departure"
                  />
                </label>
                <label className="settings-buffer-field">
                  <span className="settings-buffer-label">
                    Operating + customs
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={240}
                    inputMode="numeric"
                    value={dutyTimingBuffers.reportOperatingCustomsMin}
                    onChange={(e) =>
                      setDutyTimingBuffers({
                        ...dutyTimingBuffers,
                        reportOperatingCustomsMin: Math.max(
                          0,
                          Number(e.target.value) || 0,
                        ),
                      })
                    }
                    aria-label="Report operating with customs minutes before departure"
                  />
                </label>
                <label className="settings-buffer-field">
                  <span className="settings-buffer-label">Deadhead</span>
                  <input
                    type="number"
                    min={0}
                    max={240}
                    inputMode="numeric"
                    value={dutyTimingBuffers.reportDeadheadMin}
                    onChange={(e) =>
                      setDutyTimingBuffers({
                        ...dutyTimingBuffers,
                        reportDeadheadMin: Math.max(
                          0,
                          Number(e.target.value) || 0,
                        ),
                      })
                    }
                    aria-label="Report deadhead minutes before departure"
                  />
                </label>
                <label className="settings-buffer-field">
                  <span className="settings-buffer-label">
                    Deadhead + customs
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={240}
                    inputMode="numeric"
                    value={dutyTimingBuffers.reportDeadheadCustomsMin}
                    onChange={(e) =>
                      setDutyTimingBuffers({
                        ...dutyTimingBuffers,
                        reportDeadheadCustomsMin: Math.max(
                          0,
                          Number(e.target.value) || 0,
                        ),
                      })
                    }
                    aria-label="Report deadhead with customs minutes before departure"
                  />
                </label>
              </div>
            </section>

            <section
              className="settings-buffer-group"
              aria-label="Release buffers"
            >
              <h4 className="settings-buffer-group-title">
                Release · min after arr
              </h4>
              <div className="settings-buffer-grid settings-buffer-grid-pair">
                <label className="settings-buffer-field">
                  <span className="settings-buffer-label">Operating</span>
                  <input
                    type="number"
                    min={0}
                    max={120}
                    inputMode="numeric"
                    value={dutyTimingBuffers.releaseOperatingMin}
                    onChange={(e) =>
                      setDutyTimingBuffers({
                        ...dutyTimingBuffers,
                        releaseOperatingMin: Math.max(
                          0,
                          Number(e.target.value) || 0,
                        ),
                      })
                    }
                    aria-label="Release minutes after operating arrival"
                  />
                </label>
                <label className="settings-buffer-field">
                  <span className="settings-buffer-label">Deadhead</span>
                  <input
                    type="number"
                    min={0}
                    max={120}
                    inputMode="numeric"
                    value={dutyTimingBuffers.releaseDeadheadMin}
                    onChange={(e) =>
                      setDutyTimingBuffers({
                        ...dutyTimingBuffers,
                        releaseDeadheadMin: Math.max(
                          0,
                          Number(e.target.value) || 0,
                        ),
                      })
                    }
                    aria-label="Release minutes after deadhead arrival"
                  />
                </label>
              </div>
            </section>
          </div>
        </div>
      )}

      {/* —— Calendar data —— */}
      {section === 'calendarData' && showCalendarData && (
        <div className="settings-section-body">
          <section
            className="settings-danger-zone"
            aria-label="Calendar data"
          >
            <p className="settings-section-hint">
              Soft-delete events (they can be restored below until you delete
              again or restore).
            </p>

            {!showDeleteOptions ? (
              <button
                type="button"
                className="settings-danger-button"
                onClick={() => setShowDeleteOptions(true)}
              >
                Delete events…
              </button>
            ) : (
              <div
                className="settings-delete-options"
                role="group"
                aria-label="Delete scope"
              >
                <p className="settings-section-hint settings-delete-prompt">
                  Choose what to delete:
                </p>
                <button
                  type="button"
                  className="settings-danger-button"
                  onClick={() => handleDelete('month')}
                >
                  Current month
                  {deleteMonthLabel ? ` (${deleteMonthLabel})` : ''}
                </button>
                <button
                  type="button"
                  className="settings-danger-button"
                  onClick={() => handleDelete('all')}
                >
                  All events
                </button>
                <button
                  type="button"
                  className="settings-secondary-button"
                  onClick={() => setShowDeleteOptions(false)}
                >
                  Cancel
                </button>
              </div>
            )}

            <button
              type="button"
              className="settings-restore-button"
              disabled={!canRestore}
              aria-disabled={!canRestore}
              title={
                canRestore
                  ? `Restore ${deletedEventCount} deleted event${deletedEventCount === 1 ? '' : 's'}`
                  : 'No deleted events to restore'
              }
              onClick={handleRestore}
            >
              Restore deleted events
              {canRestore ? ` (${deletedEventCount})` : ''}
            </button>

            <button
              type="button"
              className="settings-purge-button"
              disabled={!canPurge}
              aria-disabled={!canPurge}
              title={
                canPurge
                  ? `Permanently remove ${deletedEventCount} deleted event${deletedEventCount === 1 ? '' : 's'} from storage`
                  : 'No deleted events in storage'
              }
              onClick={openPurgeConfirm}
            >
              Permanently erase deleted events
              {canPurge ? ` (${deletedEventCount})` : ''}
            </button>
          </section>
        </div>
      )}

      {confirmDialog && (
        <AppDialog
          open
          kind="confirm"
          title={confirmDialog.title}
          message={confirmDialog.message}
          danger={confirmDialog.danger}
          confirmLabel={confirmDialog.confirmLabel ?? 'OK'}
          cancelLabel="Cancel"
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => setConfirmDialog(null)}
        />
      )}

      {/* Portal to body: slide-menu overflow/stacking would clip and blur a nested overlay */}
      {showPurgeConfirm &&
        createPortal(
          <div
            className="settings-confirm-overlay"
            role="presentation"
            onClick={() => setShowPurgeConfirm(false)}
          >
            <div
              className="settings-confirm-dialog"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="settings-purge-title"
              aria-describedby="settings-purge-desc"
              onClick={(e) => e.stopPropagation()}
            >
              <h4 id="settings-purge-title" className="settings-confirm-title">
                Erase deleted events?
              </h4>
              <p id="settings-purge-desc" className="settings-confirm-body">
                Permanently remove{' '}
                <strong>
                  {deletedEventCount} deleted event
                  {deletedEventCount === 1 ? '' : 's'}
                </strong>{' '}
                from this device. This frees storage and{' '}
                <strong>cannot be undone</strong> — restore will no longer be
                available for these events.
              </p>
              <div className="settings-confirm-actions">
                <button
                  type="button"
                  className="settings-confirm-cancel"
                  onClick={() => setShowPurgeConfirm(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="settings-confirm-danger"
                  onClick={confirmPurgeDeleted}
                >
                  Erase permanently
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
