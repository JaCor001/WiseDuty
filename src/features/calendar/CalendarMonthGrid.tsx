import type { CSSProperties, MouseEvent } from 'react'
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
  onBarPressStart: (bar: DayBarSpec) => void
  onBarPressEnd: () => void
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
  onBarPressStart,
  onBarPressEnd,
  onMarkerClick,
  onViolationClick,
}: CalendarMonthGridProps) {
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
              onDayClick={onDayClickMs}
              onDayPressStart={onDayPressStartMs}
              onDayPressEnd={onDayPressEnd}
              onBarClick={onBarClick}
              onBarPressStart={onBarPressStart}
              onBarPressEnd={onBarPressEnd}
              onMarkerClick={onMarkerClick}
              onViolationClick={onViolationClick}
            />
          )
        })}
      </div>
    </div>
  )
}
