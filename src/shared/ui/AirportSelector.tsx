import { useMemo, useState } from 'react'
import {
  airportLabel,
  getAirportByIcao,
  searchAirports,
} from '../../domain/airports'
import './TimeZoneSelector.css'

interface AirportSelectorProps {
  valueIcao: string
  onChange: (icao: string) => void
  placeholder?: string
}

export default function AirportSelector({
  valueIcao,
  onChange,
  placeholder = 'ICAO, IATA, city, or airport…',
}: AirportSelectorProps) {
  const [searchText, setSearchText] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)

  const selected = valueIcao ? getAirportByIcao(valueIcao) : undefined
  const filtered = useMemo(
    () => searchAirports(searchText, 25),
    [searchText],
  )

  const handleSelect = (icao: string) => {
    onChange(icao)
    setSearchText('')
    setShowDropdown(false)
  }

  const display =
    searchText ||
    (selected ? airportLabel(selected) : valueIcao ? valueIcao : '')

  return (
    <div className="timezone-selector">
      <input
        type="text"
        className="timezone-selector-input"
        value={display}
        onChange={(e) => {
          setSearchText(e.target.value)
          setShowDropdown(true)
          if (!e.target.value.trim()) onChange('')
        }}
        onFocus={() => setShowDropdown(true)}
        onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
      />
      {showDropdown && (searchText.trim() || !valueIcao) && (
        <div className="timezone-selector-dropdown">
          {filtered.map((a) => (
            <div
              key={a.icao}
              className={`timezone-selector-option ${valueIcao === a.icao ? 'selected' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleSelect(a.icao)}
            >
              {airportLabel(a)}
              <span style={{ opacity: 0.65, marginLeft: 6, fontSize: '0.85em' }}>
                {a.tz.replace(/_/g, ' ')}
              </span>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="timezone-selector-empty">No airports found</div>
          )}
        </div>
      )}
    </div>
  )
}
