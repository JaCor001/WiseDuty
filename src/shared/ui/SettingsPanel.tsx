import { useState } from 'react'
import type { Regulator, TimeFormat } from '../../domain/types'
import { useSettings } from '../../features/settings/SettingsContext'
import TimeZoneSelector from './TimeZoneSelector'
import './SettingsPanel.css'

export type DeleteEventsScope = 'month' | 'all'

interface SettingsPanelProps {
  onClose: () => void
  /** When provided, shows calendar data delete/restore controls. */
  onDeleteEvents?: (scope: DeleteEventsScope) => void
  onRestoreDeletedEvents?: () => void
  /** Label for the current month, e.g. "March 2026". */
  deleteMonthLabel?: string
  /** Number of events in soft-delete storage (enables restore). */
  deletedEventCount?: number
}

export default function SettingsPanel({
  onClose,
  onDeleteEvents,
  onRestoreDeletedEvents,
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
  } = useSettings()

  const [showDeleteOptions, setShowDeleteOptions] = useState(false)
  const canRestore = deletedEventCount > 0 && Boolean(onRestoreDeletedEvents)
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
        </section>
      )}

      <button type="button" className="settings-close-button" onClick={onClose}>
        Close
      </button>
    </div>
  )
}
