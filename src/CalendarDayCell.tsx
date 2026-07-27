import { memo, type CSSProperties, type MouseEvent } from 'react'
import type {
  DayBarSpec,
  DayLayoutSpec,
  DayMarkerSpec,
} from './domain/calendar-day-layout'

export interface CalendarDayCellProps {
  layout: DayLayoutSpec
  isSelected: boolean
  isToday: boolean
  isInRange: boolean
  onDayClick: (dayStartMs: number) => void
  onDayPressStart: (dayStartMs: number) => void
  onDayPressEnd: () => void
  onBarClick: (bar: DayBarSpec, e: MouseEvent) => void
  onMarkerClick: (marker: DayMarkerSpec, e: MouseEvent) => void
  onViolationClick: (dayStartMs: number, e: MouseEvent) => void
}

function CalendarDayCellInner({
  layout,
  isSelected,
  isToday,
  isInRange,
  onDayClick,
  onDayPressStart,
  onDayPressEnd,
  onBarClick,
  onMarkerClick,
  onViolationClick,
}: CalendarDayCellProps) {
  const className = [
    'day',
    layout.status,
    layout.otherMonth ? 'other-month' : '',
    isSelected ? 'selected' : '',
    isInRange ? 'in-range' : '',
    isToday ? 'today' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={className}
      onMouseDown={() => onDayPressStart(layout.dayStartMs)}
      onMouseUp={onDayPressEnd}
      onMouseLeave={onDayPressEnd}
      onTouchStart={() => onDayPressStart(layout.dayStartMs)}
      onTouchEnd={onDayPressEnd}
      onClick={() => onDayClick(layout.dayStartMs)}
    >
      <span className="day-number">{layout.dayNumber}</span>
      {layout.bars.map((bar) => (
        <div
          key={bar.key}
          className={bar.className}
          style={{
            left: bar.left,
            width: bar.width,
            top: bar.top,
          }}
          title={bar.title}
          onClick={(e) => onBarClick(bar, e)}
        />
      ))}
      {layout.leaders.map((leader) => (
        <div
          key={leader.key}
          className="marker-leader"
          style={{
            left: leader.left,
            top: leader.top,
            height: leader.height,
          }}
          aria-hidden
        />
      ))}
      {layout.markers.map((m) => (
        <button
          type="button"
          key={m.key}
          className={m.className}
          style={
            {
              top: m.top,
              left: m.left,
              right: m.right,
              maxWidth: m.maxWidth,
              minWidth: m.minWidth,
              width: m.width,
            } as CSSProperties
          }
          title={m.title}
          aria-label={m.ariaLabel}
          onClick={(e) => onMarkerClick(m, e)}
        >
          {m.label}
        </button>
      ))}
      {layout.showViolation && (
        <div
          className="violation-icon"
          style={{ left: `${layout.violationLeftPct}%`, bottom: '2px' }}
          onClick={(e) => onViolationClick(layout.dayStartMs, e)}
        >
          ⚠️
        </div>
      )}
    </div>
  )
}

export const CalendarDayCell = memo(CalendarDayCellInner)
