import type { Regulator, TimeFormat } from '../../domain/types'
import { useSettings } from '../../features/settings/SettingsContext'
import TimeZoneSelector from './TimeZoneSelector'

interface SettingsPanelProps {
  onClose: () => void
}

export default function SettingsPanel({ onClose }: SettingsPanelProps) {
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

  return (
    <div className="slide-menu open">
      <h3>Settings</h3>
      <label>
        Time Format:{' '}
        <select
          value={timeFormat}
          onChange={(e) => setTimeFormat(e.target.value as TimeFormat)}
        >
          <option value="24h">24H</option>
          <option value="12h">12H (AM/PM)</option>
        </select>
      </label>
      <label>
        Regulator:{' '}
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
        Reference Time Zone:{' '}
        <TimeZoneSelector value={referenceTZ} onChange={setReferenceTZ} />
      </label>
      <label>
        Acclimatization Time Zone:{' '}
        <TimeZoneSelector value={acclTZ} onChange={setAcclTZ} />
      </label>
      <button type="button" onClick={onClose}>
        Close
      </button>
    </div>
  )
}
