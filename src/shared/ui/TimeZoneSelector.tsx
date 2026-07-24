import { useMemo, useState } from 'react'
import {
  filterTimeZones,
  getTimeZonesWithOffsets,
  type TimeZoneOption,
} from '../../domain/time'
import './TimeZoneSelector.css'

// Build once per module load — offsets refresh on full reload is acceptable
const TIME_ZONES: TimeZoneOption[] = getTimeZonesWithOffsets()

interface TimeZoneSelectorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  allowEmpty?: boolean
}

export default function TimeZoneSelector({
  value,
  onChange,
  placeholder = 'Search time zones...',
  allowEmpty = false,
}: TimeZoneSelectorProps) {
  const [searchText, setSearchText] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)

  const filteredZones = useMemo(
    () => filterTimeZones(TIME_ZONES, searchText),
    [searchText],
  )
  const selectedZone = TIME_ZONES.find((tz) => tz.value === value)

  const handleSelect = (tzValue: string) => {
    onChange(tzValue)
    setSearchText('')
    setShowDropdown(false)
  }

  return (
    <div className="timezone-selector">
      <input
        type="text"
        className="timezone-selector-input"
        value={searchText || selectedZone?.label || ''}
        onChange={(e) => {
          setSearchText(e.target.value)
          setShowDropdown(true)
        }}
        onFocus={() => setShowDropdown(true)}
        onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
        placeholder={placeholder}
      />
      {showDropdown && (
        <div className="timezone-selector-dropdown">
          {allowEmpty && (
            <div
              className={`timezone-selector-option ${value === '' ? 'selected' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleSelect('')}
            >
              Use global setting
            </div>
          )}
          {filteredZones.map((tz) => (
            <div
              key={tz.value}
              className={`timezone-selector-option ${value === tz.value ? 'selected' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleSelect(tz.value)}
            >
              {tz.label}
            </div>
          ))}
          {filteredZones.length === 0 && (
            <div className="timezone-selector-empty">No time zones found</div>
          )}
        </div>
      )}
    </div>
  )
}
