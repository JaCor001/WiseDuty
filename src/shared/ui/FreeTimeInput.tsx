import { useEffect, useState, type KeyboardEvent } from 'react'
import type { TimeFormat } from '../../domain/types'
import {
  formatTimeDisplay,
  parseFlexibleTime,
  timeInputPlaceholder,
} from '../../domain/time'
import './FreeTimeInput.css'

interface FreeTimeInputProps {
  /** Value in 24h `HH:mm` (empty string allowed). */
  value: string
  onChange: (hhmm: string) => void
  timeFormat: TimeFormat
  id?: string
  'aria-label'?: string
}

/**
 * Free-typing time field. Respects global 12h/24h display format.
 * Internal value is always 24h HH:mm for the rest of the app.
 */
export default function FreeTimeInput({
  value,
  onChange,
  timeFormat,
  id,
  'aria-label': ariaLabel,
}: FreeTimeInputProps) {
  const [focused, setFocused] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState(false)

  // Keep draft in sync when not focused (e.g. parent set value from edit duty)
  useEffect(() => {
    if (!focused) {
      setDraft(value ? formatTimeDisplay(value, timeFormat) : '')
      setError(false)
    }
  }, [value, timeFormat, focused])

  const commit = (raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed) {
      onChange('')
      setDraft('')
      setError(false)
      return true
    }
    const parsed = parseFlexibleTime(trimmed)
    if (!parsed) {
      setError(true)
      return false
    }
    onChange(parsed)
    setDraft(formatTimeDisplay(parsed, timeFormat))
    setError(false)
    return true
  }

  const handleBlur = () => {
    setFocused(false)
    commit(draft)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (commit(draft)) {
        ;(e.target as HTMLInputElement).blur()
      }
    }
  }

  const displayValue = focused
    ? draft
    : value
      ? formatTimeDisplay(value, timeFormat)
      : draft

  return (
    <div className={`free-time-input ${error ? 'invalid' : ''}`}>
      <input
        id={id}
        type="text"
        inputMode="text"
        autoComplete="off"
        spellCheck={false}
        aria-label={ariaLabel}
        aria-invalid={error || undefined}
        className="free-time-input-field"
        placeholder={timeInputPlaceholder(timeFormat)}
        value={displayValue}
        onFocus={(e) => {
          setFocused(true)
          setError(false)
          // 24h: focus shows compact digits for free overwrite (2030)
          // 12h: show display text including AM/PM so user can edit as one string
          const next = value
            ? timeFormat === '24h'
              ? value.replace(':', '')
              : formatTimeDisplay(value, timeFormat)
            : draft
          setDraft(next)
          requestAnimationFrame(() => e.target.select())
        }}
        onChange={(e) => {
          setDraft(e.target.value)
          setError(false)
        }}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
      />
      <span className="free-time-input-hint" aria-hidden="true">
        {timeFormat === '12h' ? '12h' : '24h'}
      </span>
      {error && (
        <span className="free-time-input-error" role="status">
          Try 2030, 20:30, or 8:30pm
        </span>
      )}
    </div>
  )
}
