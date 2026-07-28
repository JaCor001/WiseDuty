import { useState } from 'react'
import { createPortal } from 'react-dom'
import type {
  CalendarTimeReference,
  Regulator,
  TimeFormat,
  TimeFreeOption,
} from '../../domain/types'
import { useSettings } from '../../features/settings/SettingsContext'
import TimeZoneSelector from './TimeZoneSelector'
import './SettingsPanel.css'

export type DeleteEventsScope = 'month' | 'all'

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
}

export default function SettingsPanel({
  onClose,
  onDeleteEvents,
  onRestoreDeletedEvents,
  onPurgeDeletedEvents,
  deleteMonthLabel,
  deletedEventCount = 0,
}: SettingsPanelProps) {
  const {
    timeFormat,
    setTimeFormat,
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

  const [showDeleteOptions, setShowDeleteOptions] = useState(false)
  const [showPurgeConfirm, setShowPurgeConfirm] = useState(false)
  const canRestore = deletedEventCount > 0 && Boolean(onRestoreDeletedEvents)
  const canPurge = deletedEventCount > 0 && Boolean(onPurgeDeletedEvents)
  const showCalendarData = Boolean(onDeleteEvents)

  const handleDelete = (scope: DeleteEventsScope) => {
    if (!onDeleteEvents) return
    const scopeLabel =
      scope === 'month'
        ? deleteMonthLabel
          ? `all events in ${deleteMonthLabel}`
          : 'all events in the current month'
        : 'ALL events on your calendar'
    if (
      !confirm(
        `Delete ${scopeLabel}? You can restore them later from Settings.`,
      )
    ) {
      return
    }
    onDeleteEvents(scope)
    setShowDeleteOptions(false)
  }

  const handleRestore = () => {
    if (!canRestore || !onRestoreDeletedEvents) return
    if (
      !confirm(
        `Restore ${deletedEventCount} deleted event${deletedEventCount === 1 ? '' : 's'}?`,
      )
    ) {
      return
    }
    onRestoreDeletedEvents()
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

  return (
    <div className="slide-menu open settings-panel">
      <h3>Settings</h3>

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
        Regulator
        <select
          value={regulator}
          onChange={(e) => setRegulator(e.target.value as Regulator)}
        >
          <option value="TC">CAR 705 (Canada)</option>
          <option value="FAA">FAA (USA)</option>
          <option value="EASA">EASA (Europe)</option>
          <option value="Australia">CASA (Australia)</option>
        </select>
      </label>

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
        Option D requires 120 consecutive hours free including five consecutive
        local nights before exceeding 60 h work in 7 days.
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

      <h4 className="settings-section-title">Report & release buffers</h4>
      <p className="settings-section-hint">
        Auto report = first departure minus these minutes. Auto release = last
        arrival plus these minutes. You can still override times on each duty.
      </p>
      <label>
        Report · operating (min before dep)
        <input
          type="number"
          min={0}
          max={240}
          value={dutyTimingBuffers.reportOperatingMin}
          onChange={(e) =>
            setDutyTimingBuffers({
              ...dutyTimingBuffers,
              reportOperatingMin: Math.max(0, Number(e.target.value) || 0),
            })
          }
        />
      </label>
      <label>
        Report · operating + customs (min)
        <input
          type="number"
          min={0}
          max={240}
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
        />
      </label>
      <label>
        Report · deadhead (min)
        <input
          type="number"
          min={0}
          max={240}
          value={dutyTimingBuffers.reportDeadheadMin}
          onChange={(e) =>
            setDutyTimingBuffers({
              ...dutyTimingBuffers,
              reportDeadheadMin: Math.max(0, Number(e.target.value) || 0),
            })
          }
        />
      </label>
      <label>
        Report · deadhead + customs (min)
        <input
          type="number"
          min={0}
          max={240}
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
        />
      </label>
      <label>
        Release · after operating (min after arr)
        <input
          type="number"
          min={0}
          max={120}
          value={dutyTimingBuffers.releaseOperatingMin}
          onChange={(e) =>
            setDutyTimingBuffers({
              ...dutyTimingBuffers,
              releaseOperatingMin: Math.max(0, Number(e.target.value) || 0),
            })
          }
        />
      </label>
      <label>
        Release · after deadhead (min after arr)
        <input
          type="number"
          min={0}
          max={120}
          value={dutyTimingBuffers.releaseDeadheadMin}
          onChange={(e) =>
            setDutyTimingBuffers({
              ...dutyTimingBuffers,
              releaseDeadheadMin: Math.max(0, Number(e.target.value) || 0),
            })
          }
        />
      </label>

      {showCalendarData && (
        <section className="settings-danger-zone" aria-label="Calendar data">
          <h4 className="settings-section-title">Calendar data</h4>
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
            <div className="settings-delete-options" role="group" aria-label="Delete scope">
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
      )}

      <button type="button" className="settings-close-button" onClick={onClose}>
        Close
      </button>

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
