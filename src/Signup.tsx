import { Link } from 'react-router-dom'
import './App.css'

function Signup() {
  return (
    <div className="landing-container">
      <header>
        <div className="nav-container">
          <Link to="/" className="logo-placeholder">(LOGO)</Link>
          <nav>
            <Link to="/calendar">Calendar</Link>
            <Link to="/login">Login</Link>
            <Link to="/">Home</Link>
          </nav>
        </div>
      </header>

      <main className="landing-shell" style={{ alignItems: 'center', justifyItems: 'center' }}>
        <div className="landing-title" style={{ gridArea: 'title' }}>
          <h1>Join WiseDuty</h1>
        </div>
        <div className="landing-hook" style={{ gridArea: 'hook', maxWidth: '520px' }}>
          <p className="hook-text">
            Create your account to sync schedules, see duty limits at a glance, and plan smarter.
          </p>
        </div>
        <div className="feature-list" style={{ gridArea: 'features', maxWidth: '520px' }}>
          <form className="card" style={{ width: '100%', padding: '1.5rem', display: 'grid', gap: '0.9rem' }}>
            <label className="form-field">
              <span>Email</span>
              <input type="email" name="email" required placeholder="you@example.com" />
            </label>
            <label className="form-field">
              <span>Password</span>
              <input type="password" name="password" required placeholder="••••••••" />
            </label>
            <label className="form-field">
              <span>Confirm Password</span>
              <input type="password" name="confirm" required placeholder="••••••••" />
            </label>
            <button type="submit" className="cta-button" style={{ width: '100%', justifyContent: 'center' }}>
              Create Account
            </button>
            <div style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
              Already have an account? <Link to="/login">Login</Link>
            </div>
          </form>
        </div>
      </main>

      <footer>
        <p>&copy; 2025 WiseDuty. All rights reserved.</p>
      </footer>
    </div>
  )
}

export default Signup
