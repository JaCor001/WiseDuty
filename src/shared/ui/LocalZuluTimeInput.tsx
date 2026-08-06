import { useMemo } from 'react'
import type { TimeFormat } from '../../domain/types'
import {
  localWallToZuluHHmm,
  zuluHHmmToLocalWall,
} from '../../domain/time'
import FreeTimeInput from './FreeTimeInput'
import './LocalZuluTimeInput.css'

export interface LocalZuluTimeInputProps {
  /** Local civil date `YYYY-MM-DD` (anchors the conversion). */
  dateKey: string
  /** Local wall time `HH:mm` (24h) — form source of truth. */
  value: string
  onChange: (localHHmm: string) => void
  /**
   * When a Zulu edit shifts the local civil day, update the date field.
   * Optional for fields that only expose a time (rare).
   */
  onDateChange?: (dateKey: string) => void
  /** IANA zone for local wall clock. Empty/missing disables dual sync. */
  tz: string
  timeFormat: TimeFormat
  ariaLabelLocal?: string
  ariaLabelZulu?: string
  className?: string
  /**
   * `row` — L | Z side by side (full-width form sections).
   * `stack` — L above Z (narrow columns, e.g. dep|arr side by side).
   */
  layout?: 'row' | 'stack'
}

/**
 * Dual time entry: Local (L) and Zulu (Z).
 * Editing either side updates the other when `tz` is set.
 * Parent still stores local wall time (+ date); Zulu is derived.
 */
export default function LocalZuluTimeInput({
  dateKey,
  value,
  onChange,
  onDateChange,
  tz,
  timeFormat,
  ariaLabelLocal = 'Local time',
  ariaLabelZulu = 'Zulu time (UTC)',
  className,
  layout = 'row',
}: LocalZuluTimeInputProps) {
  const canSync = Boolean(tz && dateKey)

  const zuluValue = useMemo(() => {
    if (!canSync || !value) return ''
    return localWallToZuluHHmm(dateKey, value, tz)
  }, [canSync, dateKey, value, tz])

  const zoneLabel = (tz || '').replace(/_/g, ' ')

  const handleLocal = (localHHmm: string) => {
    onChange(localHHmm)
  }

  const handleZulu = (zuluHHmm: string) => {
    if (!zuluHHmm) {
      onChange('')
      return
    }
    if (!canSync) {
      // Without a zone we cannot convert — ignore Z edits
      return
    }
    const next = zuluHHmmToLocalWall(dateKey, zuluHHmm, tz, value || undefined)
    if (!next) return
    if (onDateChange && next.dateKey && next.dateKey !== dateKey) {
      onDateChange(next.dateKey)
    }
    onChange(next.timeHHmm)
  }

  return (
    <div
      className={`local-zulu-time local-zulu-time--${layout}${className ? ` ${className}` : ''}${!canSync ? ' is-local-only' : ''}`}
      title={
        canSync
          ? `Local (${zoneLabel}) · Zulu (UTC) — edit either side`
          : 'Set airport / time zone to enable Zulu entry'
      }
    >
      <FreeTimeInput
        value={value}
        onChange={handleLocal}
        timeFormat={timeFormat}
        badge="L"
        className="local-zulu-time-half"
        aria-label={ariaLabelLocal}
      />
      <FreeTimeInput
        value={zuluValue}
        onChange={handleZulu}
        timeFormat="24h"
        badge="Z"
        className="local-zulu-time-half"
        aria-label={ariaLabelZulu}
        disabled={!canSync}
      />
    </div>
  )
}
