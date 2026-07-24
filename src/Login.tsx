import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import './App.css'
import { useSettings } from './features/settings/SettingsContext'
import { IconMoon, IconSun } from './shared/ui/icons'

function Login() {
  const { darkMode, toggleDarkMode } = useSettings()
  const [message, setMessage] = useState('')

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    setMessage(
      'Login is not connected to a backend yet. This is a stub so navigation works.',
    )
  }

  return (
    <div className="auth-page">
      <div className="auth-backdrop" aria-hidden="true">
        <div className="bg-video-blur">
          <div className="video-placeholder">Demo Video</div>
        </div>
        <div className="backdrop-overlay" />
      </div>

      <header className="auth-header">
        <div className="nav-container">
          <Link to="/" className="logo-placeholder">
            (LOGO)
          </Link>
          <nav className="header-center">
            <Link to="/calendar">Calendar</Link>
            <Link to="/signup">Signup</Link>
            <Link to="/">Home</Link>
          </nav>
          <div className="header-actions">
            <button
              className="theme-toggle"
              aria-label={
                darkMode ? 'Switch to light mode' : 'Switch to dark mode'
              }
              type="button"
              onClick={toggleDarkMode}
            >
              {darkMode ? <IconSun /> : <IconMoon />}
            </button>
          </div>
        </div>
      </header>

      <main className="auth-content">
        <section className="auth-copy">
          <p className="eyebrow">Account</p>
          <h1>Welcome back</h1>
          <p className="subhead">
            Sign in to sync schedules and keep duty limits in sight on web or
            native.
          </p>
        </section>

        <form
          className="auth-card"
          aria-label="Login"
          onSubmit={handleSubmit}
        >
          <div className="field">
            <label htmlFor="login-email">Email</label>
            <input
              id="login-email"
              type="email"
              name="email"
              autoComplete="email"
              required
              placeholder="you@example.com"
            />
          </div>
          <div className="field">
            <label htmlFor="login-password">Password</label>
            <input
              id="login-password"
              type="password"
              name="password"
              autoComplete="current-password"
              required
              placeholder="Your password"
            />
          </div>
          <button type="submit" className="cta-button wide">
            Log In
          </button>
          {message && <p className="form-meta">{message}</p>}
          <p className="form-meta">
            Need an account? <Link to="/signup">Sign up</Link>
          </p>
        </form>
      </main>

      <footer className="auth-footer">
        <p>&copy; {new Date().getFullYear()} WiseDuty. All rights reserved.</p>
      </footer>
    </div>
  )
}

export default Login
