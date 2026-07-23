import { useMemo, useState } from 'react'
import {
  filterTimeZones,
  getTimeZonesWithOffsets,
  type TimeZoneOption,
} from '../../domain/time'

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
    <div className="timezone-selector" style={{ position: 'relative' }}>
      <input
        type="text"
        value={searchText || selectedZone?.label || ''}
        onChange={(e) => {
          setSearchText(e.target.value)
          setShowDropdown(true)
        }}
        onFocus={() => setShowDropdown(true)}
        onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
        placeholder={placeholder}
        style={{
          width: '100%',
          padding: '0.5rem',
          border: '1px solid var(--border-color)',
          borderRadius: '4px',
          background: 'var(--card-bg)',
          color: 'var(--text-color)',
        }}
      />
      {showDropdown && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            maxHeight: '200px',
            overflowY: 'auto',
            border: '1px solid var(--border-color)',
            borderRadius: '4px',
            background: 'var(--card-bg)',
            zIndex: 1000,
            boxShadow: '0 4px 8px rgba(0,0,0,0.1)',
          }}
        >
          {allowEmpty && (
            <div
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleSelect('')}
              style={{
                padding: '0.5rem',
                cursor: 'pointer',
                borderBottom: '1px solid var(--border-color)',
                background: value === '' ? 'var(--hover-bg)' : 'transparent',
              }}
            >
              Use global setting
            </div>
          )}
          {filteredZones.map((tz) => (
            <div
              key={tz.value}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleSelect(tz.value)}
              style={{
                padding: '0.5rem',
                cursor: 'pointer',
                borderBottom: '1px solid var(--border-color)',
                background:
                  value === tz.value ? 'var(--hover-bg)' : 'transparent',
              }}
            >
              {tz.label}
            </div>
          ))}
          {filteredZones.length === 0 && (
            <div style={{ padding: '0.5rem', color: 'var(--text-secondary)' }}>
              No time zones found
            </div>
          )}
        </div>
      )}
    </div>
  )
}
