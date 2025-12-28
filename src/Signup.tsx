import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import './App.css'

function Signup() {
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('theme') === 'dark')

  useEffect(() => {
    document.body.className = darkMode ? 'dark' : 'light'
  }, [darkMode])

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
          <Link to="/" className="logo-placeholder">(LOGO)</Link>
          <nav>
            <Link to="/calendar">Calendar</Link>
            <Link to="/login">Login</Link>
            <Link to="/">Home</Link>
            <button
              className="theme-toggle"
              aria-label="Toggle dark mode"
              onClick={() => {
                const next = !darkMode
                setDarkMode(next)
                localStorage.setItem('theme', next ? 'dark' : 'light')
              }}
            >
              {darkMode ? '☀️' : '🌙'}
            </button>
          </nav>
        </div>
      </header>

      <main className="auth-content">
        <section className="auth-copy">
          <p className="eyebrow">Account</p>
          <h1>Join WiseDuty</h1>
          <p className="subhead">
            Create your account to sync schedules, keep duty limits in sight, and plan smarter on web or native.
          </p>
          <div className="chip-row">
            <span className="chip">Sync across devices</span>
            <span className="chip">Duty-aware schedules</span>
            <span className="chip">Secure by default</span>
          </div>
        </section>

        <form className="auth-card" aria-label="Create account">
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" name="email" autoComplete="email" required placeholder="you@example.com" />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" type="password" name="password" autoComplete="new-password" required placeholder="Create a password" />
          </div>
          <div className="field">
            <label htmlFor="confirm">Confirm Password</label>
            <input id="confirm" type="password" name="confirm" autoComplete="new-password" required placeholder="Repeat your password" />
          </div>
          <button type="submit" className="cta-button wide">Create Account</button>

          <div className="divider" role="separator" aria-label="Or continue with" />

          <div className="social-buttons" aria-label="Continue with social account">
            <button type="button" className="social-button" aria-label="Continue with Google">
              <span className="social-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false" width="18" height="18">
                  <path fill="#4285F4" d="M23.5 12.27c0-.82-.07-1.64-.23-2.43H12v4.6h6.48a5.54 5.54 0 0 1-2.4 3.63v3h3.88c2.27-2.1 3.54-5.2 3.54-8.8Z" />
                  <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.9l-3.88-3c-1.08.74-2.46 1.18-4.06 1.18-3.12 0-5.76-2.1-6.7-4.94H1.3v3.1C3.26 21.38 7.32 24 12 24Z" />
                  <path fill="#FBBC05" d="M5.3 14.34A7.21 7.21 0 0 1 4.9 12c0-.81.14-1.6.4-2.34V6.56H1.3A12 12 0 0 0 0 12c0 1.92.46 3.73 1.3 5.34l4-3Z" />
                  <path fill="#EA4335" d="M12 4.75c1.76 0 3.33.6 4.57 1.77l3.42-3.42C17.95 1.12 15.23 0 12 0 7.32 0 3.26 2.62 1.3 6.56l4 3.1C6.24 6.85 8.88 4.75 12 4.75Z" />
                </svg>
              </span>
              <span>Continue with Google</span>
            </button>
            <button type="button" className="social-button" aria-label="Continue with Apple">
              <span className="social-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false" width="18" height="18">
                  <path fill="currentColor" d="M16.69 12.54c0-1.56.82-2.87 2.1-3.6-.8-1.14-2.08-1.8-3.54-1.86-1.48-.12-2.9.88-3.64.88-.76 0-2-.86-3.3-.84-1.7.06-3.28 1-4.14 2.46-1.78 3.08-.46 7.62 1.26 10.12.84 1.2 1.84 2.54 3.16 2.5 1.26-.06 1.74-.82 3.28-.82 1.52 0 1.98.82 3.3.8 1.36-.02 2.22-1.2 3.04-2.42.98-1.44 1.4-2.86 1.42-2.94-.04-.02-2.74-1.04-2.74-4.28Z" />
                  <path fill="currentColor" d="M14.8 5.8c.66-.8 1.1-1.92 1-3.02-1 .04-2.2.7-2.9 1.52-.64.74-1.14 1.86-1 2.94 1.08.08 2.18-.56 2.9-1.44Z" />
                </svg>
              </span>
              <span>Continue with Apple</span>
            </button>
          </div>
          <p className="form-meta">
            Already have an account? <Link to="/login">Login</Link>
          </p>
        </form>
      </main>

      <footer className="auth-footer">
        <p>&copy; 2025 WiseDuty. All rights reserved.</p>
      </footer>
    </div>
  )
}

export default Signup
