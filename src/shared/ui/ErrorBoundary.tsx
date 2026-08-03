import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Catches render errors so one bad panel does not blank the whole app.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            padding: '1.5rem',
            maxWidth: 420,
            margin: '2rem auto',
            fontFamily: 'system-ui, sans-serif',
            color: 'var(--text-color, #0f172a)',
          }}
        >
          <h1 style={{ fontSize: '1.15rem', marginTop: 0 }}>Something went wrong</h1>
          <p style={{ color: 'var(--text-secondary, #64748b)', lineHeight: 1.45 }}>
            The app hit an unexpected error. Your saved schedule in this browser
            should still be available after reload.
          </p>
          <pre
            style={{
              fontSize: '0.75rem',
              overflow: 'auto',
              padding: '0.75rem',
              background: 'color-mix(in srgb, #000 6%, transparent)',
              borderRadius: 8,
            }}
          >
            {this.state.error.message}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              marginTop: '0.75rem',
              padding: '0.5rem 1rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
