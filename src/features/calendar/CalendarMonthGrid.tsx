import { useCallback, useState, type CSSProperties, type MouseEvent } from 'react'
import { CalendarDayCell } from '../../CalendarDayCell'
import type {
  DayBarSpec,
  DayLayoutSpec,
  DayMarkerSpec,
} from '../../domain/calendar-day-layout'
import { toDateInputValueInTZ } from '../../domain/time'

export interface CalendarMonthGridProps {
  days: Date[]
  weekDayLabels: readonly string[]
  weekRows: number
  sharedDayMinRem: number
  scheduleLayout: { byKey: Map<string, DayLayoutSpec> }
  calendarTZ: string
  selectedDate: Date | null
  dayStartInCal: (d: Date) => Date
  isInRange: (date: Date) => boolean
  onDayClickMs: (dayStartMs: number) => void
  onDayPressStartMs: (dayStartMs: number) => void
  onDayPressEnd: () => void
  onBarClick: (bar: DayBarSpec, e: MouseEvent) => void
  onMarkerClick: (marker: DayMarkerSpec, e: MouseEvent) => void
  onViolationClick: (dayStartMs: number, e: MouseEvent) => void
}

/**
 * Presentational month grid (Phase deferred extract).
 */
export default function CalendarMonthGrid({
  days,
  weekDayLabels,
  weekRows,
  sharedDayMinRem,
  scheduleLayout,
  calendarTZ,
  selectedDate,
  dayStartInCal,
  isInRange,
  onDayClickMs,
  onDayPressStartMs,
  onDayPressEnd,
  onBarClick,
  onMarkerClick,
  onViolationClick,
}: CalendarMonthGridProps) {
  /**
   * Shared across all day cells so multi-day events light start/end stamps
   * (and bar segments) on every cell that owns a piece of that event.
   */
  const [activeEventId, setActiveEventId] = useState<string | null>(null)
  const onActiveEventChange = useCallback((eventId: string | null) => {
    setActiveEventId(eventId)
  }, [])

  return (
    <div className="calendar-container">
      <div
        className="calendar-grid"
        style={
          {
            ['--day-min-h']: `${sharedDayMinRem}rem`,
            ['--week-rows']: String(weekRows),
          } as CSSProperties
        }
      >
        {weekDayLabels.map((day) => (
          <div key={day} className="day-header">
            {day}
          </div>
        ))}
        {days.map((date: Date) => {
          const dayKey = toDateInputValueInTZ(date, calendarTZ)
          const layout = scheduleLayout.byKey.get(dayKey)
          if (!layout) return null
          const dayStartMs = layout.dayStartMs
          const isToday =
            dayStartMs === dayStartInCal(new Date()).getTime()
          const isSelected =
            !!selectedDate &&
            dayStartInCal(selectedDate).getTime() === dayStartMs
          return (
            <CalendarDayCell
              key={dayKey}
              layout={layout}
              isSelected={isSelected}
              isToday={isToday}
              isInRange={isInRange(date)}
              activeEventId={activeEventId}
              onActiveEventChange={onActiveEventChange}
              onDayClick={onDayClickMs}
              onDayPressStart={onDayPressStartMs}
              onDayPressEnd={onDayPressEnd}
              onBarClick={onBarClick}
              onMarkerClick={onMarkerClick}
              onViolationClick={onViolationClick}
            />
          )
        })}
      </div>
    </div>
  )
}
