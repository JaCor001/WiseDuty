import { Link } from 'react-router-dom'
import { useState, useEffect } from 'react'
import './App.css'
import './Calendar.css'

// Get all IANA time zones with their current UTC offsets
const getTimeZonesWithOffsets = () => {
  const timeZones = Intl.supportedValuesOf('timeZone')
  return timeZones.map(tz => {
    const now = new Date()
    const offset = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'shortOffset'
    }).formatToParts(now).find(part => part.type === 'timeZoneName')?.value || '+00:00'
    
    // Format the display name nicely
    const displayName = tz.replace(/_/g, ' ').replace(/\//g, ' / ')
    
    return {
      value: tz,
      label: `${displayName} (${offset})`
    }
  }).sort((a, b) => a.label.localeCompare(b.label))
}

const TIME_ZONES = getTimeZonesWithOffsets()

// Filter time zones based on search text
const getFilteredTimeZones = (searchText: string) => {
  if (!searchText) return TIME_ZONES
  return TIME_ZONES.filter(tz => 
    tz.label.toLowerCase().includes(searchText.toLowerCase()) ||
    tz.value.toLowerCase().includes(searchText.toLowerCase())
  )
}

// Custom Time Zone Selector Component
const TimeZoneSelector = ({ 
  value, 
  onChange, 
  placeholder = "Search time zones...",
  allowEmpty = false 
}: { 
  value: string, 
  onChange: (value: string) => void,
  placeholder?: string,
  allowEmpty?: boolean
}) => {
  const [searchText, setSearchText] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)
  
  const filteredZones = getFilteredTimeZones(searchText)
  const selectedZone = TIME_ZONES.find(tz => tz.value === value)
  
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
          color: 'var(--text-color)'
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
            boxShadow: '0 4px 8px rgba(0,0,0,0.1)'
          }}
        >
          {allowEmpty && (
            <div
              onClick={() => handleSelect('')}
              style={{
                padding: '0.5rem',
                cursor: 'pointer',
                borderBottom: '1px solid var(--border-color)',
                background: value === '' ? 'var(--hover-bg)' : 'transparent'
              }}
            >
              Use global setting
            </div>
          )}
          {filteredZones.map(tz => (
            <div
              key={tz.value}
              onClick={() => handleSelect(tz.value)}
              style={{
                padding: '0.5rem',
                cursor: 'pointer',
                borderBottom: '1px solid var(--border-color)',
                background: value === tz.value ? 'var(--hover-bg)' : 'transparent'
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

function Landing() {
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('theme') === 'dark')
  const [showSettings, setShowSettings] = useState(false)
  const [timeFormat, setTimeFormat] = useState(() => (localStorage.getItem('timeFormat') as '24h' | '12h') || '24h')
  const [regulator, setRegulator] = useState(() => (localStorage.getItem('regulator') as 'TC' | 'FAA' | 'EASA' | 'Australia') || 'TC')
  const [referenceTZ, setReferenceTZ] = useState(() => localStorage.getItem('referenceTZ') || Intl.DateTimeFormat().resolvedOptions().timeZone)
  const [acclTZ, setAcclTZ] = useState(() => localStorage.getItem('lastAcclTZ') || Intl.DateTimeFormat().resolvedOptions().timeZone)

  useEffect(() => {
    document.body.className = darkMode ? 'dark' : 'light'
  }, [darkMode])

  return (
    <>
      <div className="landing-container">
        <header>
          <div className="nav-container">
            <div className="logo-placeholder">WiseDuty</div>
            <nav>
              <Link to="/calendar">Calendar</Link>
              <button className="settings-button" onClick={() => setShowSettings(true)}>⚙️</button>
              <button className="theme-toggle" onClick={() => {
                const newMode = !darkMode;
                setDarkMode(newMode);
                localStorage.setItem('theme', newMode ? 'dark' : 'light');
              }}>
                {darkMode ? '☀️' : '🌙'}
              </button>
            </nav>
          </div>
        </header>

        <main className="landing-shell">
          <div className="landing-title">
            <h1>WiseDuty</h1>
          </div>

          <div className="landing-hook">
            <p className="hook-text">
              Invisible <span className="hook-muted">Duty Regs</span> no more. Seamlessly add
              <span className="pill pill-red"> color</span>
              -
              <span className="pill pill-amber"> coded</span>
              <span className="pill pill-blue"> clarity</span>
               to your schedule. Optimize your strategy -
              <span className="hook-script"> Enhance your life.</span>
            </p>
          </div>

          <div className="landing-cta">
            <Link to="/calendar" className="cta-button">Get Started</Link>
          </div>

          <section className="feature-list">
            <h2>Features</h2>
            <ul>
              <li>Crystal-clear duty awareness in one color-coded glance.</li>
              <li>Your shield against reduced duty situational awareness.</li>
              <li>Knowledge is power: bid smarter, trade pairings, and optimize at a glance.</li>
              <li>Customized schedule suggestions that align regulations with your schedule preferences.</li>
              <li>Let WiseDuty carry the mental load of every duty reg so you can fly the schedule you actually want.</li>
            </ul>
          </section>

          <div className="demo-video">
            <div className="video-placeholder">
              <span>Demo Video</span>
            </div>
          </div>
        </main>

        <footer>
          <p>&copy; 2025 WiseDuty. All rights reserved.</p>
        </footer>
      </div>
      {showSettings && (
        <div className={`slide-menu ${showSettings ? 'open' : ''}`}>
          <h3>Settings</h3>
          <label>Time Format: <select value={timeFormat} onChange={(e) => { setTimeFormat(e.target.value as '24h' | '12h'); localStorage.setItem('timeFormat', e.target.value) }}><option value="24h">24H</option><option value="12h">12H (AM/PM)</option></select></label>
          <label>Regulator: <select value={regulator} onChange={(e) => { setRegulator(e.target.value as 'TC' | 'FAA' | 'EASA' | 'Australia'); localStorage.setItem('regulator', e.target.value) }}><option value="TC">CAR 705 (Canada)</option><option value="FAA">FAA (USA)</option><option value="EASA">EASA (Europe)</option><option value="Australia">CASA (Australia)</option></select></label>
          <label>Reference Time Zone: <TimeZoneSelector value={referenceTZ} onChange={(value) => { setReferenceTZ(value); localStorage.setItem('referenceTZ', value) }} /></label>
          <label>Acclimatization Time Zone: <TimeZoneSelector value={acclTZ} onChange={(value) => { setAcclTZ(value); localStorage.setItem('lastAcclTZ', value) }} /></label>
          <button onClick={() => setShowSettings(false)}>Close</button>
        </div>
      )}
    </>
  )
}

export default Landing
