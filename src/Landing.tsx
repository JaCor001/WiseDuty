import { useState } from 'react'
import { Link } from 'react-router-dom'
import './App.css'
import './Calendar.css'
import { useSettings } from './features/settings/SettingsContext'
import SettingsPanel from './shared/ui/SettingsPanel'

function Landing() {
  const { darkMode, toggleDarkMode } = useSettings()
  const [showSettings, setShowSettings] = useState(false)

  return (
    <>
      <div className="landing-container">
        <div className="auth-backdrop" aria-hidden="true">
          <div className="bg-video-blur">
            <div className="video-placeholder">Demo Video</div>
          </div>
          <div className="backdrop-overlay" />
        </div>
        <header className="site-header">
          <div className="nav-container">
            <Link to="/" className="logo-placeholder">
              (LOGO)
            </Link>
            <nav className="header-center">
              <Link to="/calendar">Calendar</Link>
              <Link to="/login">Login</Link>
            </nav>
            <div className="header-actions">
              <button
                type="button"
                className="settings-button"
                aria-label="Settings"
                onClick={() => setShowSettings(true)}
              >
                ⚙️
              </button>
              <button
                type="button"
                className="theme-toggle"
                aria-label="Toggle theme"
                onClick={toggleDarkMode}
              >
                {darkMode ? '☀️' : '🌙'}
              </button>
            </div>
          </div>
        </header>

        <main className="landing-shell">
          <div className="landing-title">
            <h1>WiseDuty</h1>
          </div>

          <div className="landing-hook">
            <p className="hook-text">
              <span className="hook-line-1">
                Invisible <span className="hook-muted">Duty Regs</span> no more.
                Seamlessly add
                <span className="pill pill-red"> color</span>-
                <span className="pill pill-amber"> coded</span>
                <span className="pill pill-blue"> clarity</span> to your
                schedule.
              </span>
              <br />
              Optimize your strategy -
              <span className="hook-script"> Enhance your life.</span>
            </p>
          </div>

          <div className="landing-cta">
            <Link to="/signup" className="cta-button">
              Get Started
            </Link>
          </div>

          <section className="feature-list">
            <h2>Features</h2>
            <ul>
              <li>Crystal-clear duty awareness in one color-coded glance.</li>
              <li>Your shield against reduced duty situational awareness.</li>
              <li>
                Knowledge is power: bid smarter, trade pairings, and optimize at
                a glance.
              </li>
              <li>
                Customized schedule suggestions that align regulations with your
                schedule preferences.
              </li>
              <li>
                Let WiseDuty carry the mental load of every duty reg so you can
                fly the schedule you actually want.
              </li>
            </ul>
          </section>

          <div className="demo-video">
            <div className="video-placeholder">
              <span>Demo Video</span>
            </div>
          </div>
        </main>

        <footer className="site-footer">
          <p>
            &copy; {new Date().getFullYear()} WiseDuty. All rights reserved.
          </p>
        </footer>
      </div>
      {showSettings && (
        <SettingsPanel onClose={() => setShowSettings(false)} />
      )}
    </>
  )
}

export default Landing
