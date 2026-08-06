import {
  memo,
  useCallback,
  useMemo,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
} from 'react'
import type {
  DayBarSpec,
  DayLayoutSpec,
  DayMarkerSpec,
} from './domain/calendar-day-layout'
import {
  buildStampConnectorPlans,
  connectorPointsAttr,
} from './domain/time-stamps'

export interface CalendarDayCellProps {
  layout: DayLayoutSpec
  isSelected: boolean
  isToday: boolean
  isInRange: boolean
  /**
   * Shared month-grid highlight: event id under hover/hold so start/end
   * stamps light on every day cell that owns them (multi-day bars).
   */
  activeEventId: string | null
  onActiveEventChange: (eventId: string | null) => void
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
  activeEventId,
  onActiveEventChange,
  onDayClick,
  onDayPressStart,
  onDayPressEnd,
  onBarClick,
  onMarkerClick,
  onViolationClick,
}: CalendarDayCellProps) {
  /** Pointer is held on a bar in *this* cell (touch / click-hold). */
  const [holding, setHolding] = useState(false)

  // Light the day when *this* cell has a bar or stamp for the active event
  const dayHasActive =
    !!activeEventId &&
    (layout.bars.some(
      (b) => b.kind !== 'phantom' && b.eventId === activeEventId,
    ) ||
      layout.timeStamps.some((ts) => ts.eventIds.includes(activeEventId)))

  const className = [
    'day',
    layout.status,
    layout.otherMonth ? 'other-month' : '',
    isSelected ? 'selected' : '',
    isInRange ? 'in-range' : '',
    isToday ? 'today' : '',
    dayHasActive ? 'day--bar-active' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const clearActive = useCallback(() => {
    onActiveEventChange(null)
    setHolding(false)
  }, [onActiveEventChange])

  const handleBarPointerDown = (bar: DayBarSpec, e: PointerEvent) => {
    // Keep day long-press from starting when interacting with an event bar
    e.stopPropagation()
    if (bar.kind === 'phantom') return
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* ignore — not all targets support capture */
    }
    onActiveEventChange(bar.eventId)
    setHolding(true)
  }

  const handleBarPointerEnd = (e: PointerEvent) => {
    e.stopPropagation()
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
    }
    setHolding(false)
    // Keep hover highlight if the pointer is still over the bar (desktop)
    if (e.pointerType === 'mouse' && e.type === 'pointerup') {
      // leave activeEventId for mouseenter/leave to manage
      return
    }
    onActiveEventChange(null)
  }

  /** Mouse/touch companions: pointer stopPropagation does not block these. */
  const stopDayPress = (e: { stopPropagation: () => void }) => {
    e.stopPropagation()
  }

  // Day-wide connector plan: clip under foreign stamps + gap at crossings
  const connectorByKey = useMemo(() => {
    const plans = buildStampConnectorPlans(layout.timeStamps)
    const map = new Map<string, typeof plans[0]['pieces']>()
    for (const p of plans) map.set(p.key, p.pieces)
    return map
  }, [layout.timeStamps])

  return (
    <div
      className={className}
      onMouseDown={() => onDayPressStart(layout.dayStartMs)}
      onMouseUp={onDayPressEnd}
      onMouseLeave={() => {
        onDayPressEnd()
        if (!holding) clearActive()
      }}
      onTouchStart={() => onDayPressStart(layout.dayStartMs)}
      onTouchEnd={onDayPressEnd}
      onClick={() => onDayClick(layout.dayStartMs)}
    >
      <span className="day-number">{layout.dayNumber}</span>
      {layout.bars.map((bar) => {
        const isActive =
          !!activeEventId &&
          bar.eventId === activeEventId &&
          bar.kind !== 'phantom'
        return (
          <div
            key={bar.key}
            className={`${bar.className}${isActive ? ' is-active' : ''}`}
            style={{
              left: bar.left,
              width: bar.width,
              top: bar.top,
            }}
            title={bar.title}
            onPointerDown={(e) => handleBarPointerDown(bar, e)}
            onPointerUp={handleBarPointerEnd}
            onPointerCancel={(e) => {
              handleBarPointerEnd(e)
              clearActive()
            }}
            onMouseEnter={() => {
              if (bar.kind === 'phantom') return
              onActiveEventChange(bar.eventId)
            }}
            onMouseLeave={() => {
              if (!holding) onActiveEventChange(null)
            }}
            onMouseDown={stopDayPress}
            onMouseUp={stopDayPress}
            onTouchStart={stopDayPress}
            onTouchEnd={(e) => {
              stopDayPress(e)
              setHolding(false)
              onActiveEventChange(null)
            }}
            onClick={(e) => onBarClick(bar, e)}
          />
        )
      })}
      {layout.timeStamps.map((ts) => {
        const lit =
          !!activeEventId && ts.eventIds.includes(activeEventId)
        const labelX = ts.labelCenterPct
        const labelY = ts.labelTopPct
        const pieces = connectorByKey.get(ts.key) ?? []
        return (
          <div
            key={ts.key}
            className={`event-time-stamp event-time-stamp--${ts.edge}${
              lit ? ' is-lit' : ''
            }${
              (ts.stackTier ?? 0) > 0
                ? ` event-time-stamp--tier-${Math.min(ts.stackTier, 5)}`
                : ''
            }`}
            aria-hidden
          >
            {/* Full-cell SVG: pieces already clipped under foreign stamps +
                gapped at line crossings for a clean cartographic look */}
            <svg
              className="event-time-stamp-svg"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden
            >
              {pieces.map((pts, i) =>
                pts.length >= 2 ? (
                  <polyline
                    key={`${ts.key}-c${i}`}
                    className="event-time-stamp-connector"
                    points={connectorPointsAttr(pts)}
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null,
              )}
            </svg>
            <span
              className="event-time-stamp-label"
              style={
                {
                  left: `${labelX}%`,
                  top: `${labelY}%`,
                } as CSSProperties
              }
            >
              {ts.label}
            </span>
          </div>
        )
      })}
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
