import type { Regulator, TimeFormat } from '../../domain/types'
import { useSettings } from '../../features/settings/SettingsContext'
import TimeZoneSelector from './TimeZoneSelector'
import './SettingsPanel.css'

interface SettingsPanelProps {
  onClose: () => void
  /** Optional calendar-only actions (e.g. delete month events). */
  onDeleteMonthEvents?: () => void
  /** Label for the month being cleaned, e.g. "March 2026". */
  deleteMonthLabel?: string
}

export default function SettingsPanel({
  onClose,
  onDeleteMonthEvents,
  deleteMonthLabel,
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

  const handleDeleteMonth = () => {
    if (!onDeleteMonthEvents) return
    const label = deleteMonthLabel ? ` in ${deleteMonthLabel}` : ' in the current month'
    if (
      confirm(
        `Are you sure you want to delete all events${label}? This cannot be undone.`,
      )
    ) {
      onDeleteMonthEvents()
      onClose()
    }
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
        Reference Time Zone
        <TimeZoneSelector value={referenceTZ} onChange={setReferenceTZ} />
      </label>

      <label>
        Acclimatization Time Zone
        <TimeZoneSelector value={acclTZ} onChange={setAcclTZ} />
      </label>

      {onDeleteMonthEvents && (
        <section className="settings-danger-zone" aria-label="Calendar data">
          <h4 className="settings-section-title">Calendar data</h4>
          <p className="settings-section-hint">
            Remove every duty and rest event
            {deleteMonthLabel ? ` in ${deleteMonthLabel}` : ' this month'}.
          </p>
          <button
            type="button"
            className="settings-danger-button"
            onClick={handleDeleteMonth}
          >
            Delete all events
            {deleteMonthLabel ? ` (${deleteMonthLabel})` : ''}
          </button>
        </section>
      )}

      <button type="button" className="settings-close-button" onClick={onClose}>
        Close
      </button>
    </div>
  )
}
