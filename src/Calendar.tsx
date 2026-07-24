import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import './Calendar.css'
import './App.css'
import type { AvgSectorTime, DutyEvent, RestType } from './domain/types'
import { MAX_WEEKLY_DUTY_HOURS } from './domain/types'
import {
  buildRestEvent,
  createId,
  eventsOnLocalDay,
  findDutyOnDate,
  findDutiesOnDate,
  findNextDuty,
  findPreviousDuty,
  maybeBuildLnrBetween,
  removeDutyAndRelated,
  restIdForDuty,
  stripLnrTouching,
} from './domain/events'
import {
  eventsOverlap,
  getDutyMarkers,
  getMaxFdpHours,
  getMinRestHours,
  wouldExceedWeeklyLimit,
} from './domain/regulations'
import {
  combineLocalDateAndTime,
  dayBarPosition,
  formatHHmm,
  formatTimeDisplay,
  getHourInTZ,
  getZuluTimeDisplay,
  parseLocalDateTime,
  startOfLocalDay,
  toLocalDateInputValue,
} from './domain/time'
import { useSettings } from './features/settings/SettingsContext'
import { scheduleTravelRestReminders } from './shared/notifications'
import { loadEvents, saveEvents } from './shared/storage'
import FreeTimeInput from './shared/ui/FreeTimeInput'
import SettingsPanel from './shared/ui/SettingsPanel'
import TimeZoneSelector from './shared/ui/TimeZoneSelector'

function Calendar() {
  const {
    darkMode,
    toggleDarkMode,
    timeFormat,
    regulator,
    acclTZ,
    sectors,
    setSectors,
    avgSectorTime,
    setAvgSectorTime,
  } = useSettings()

  const [currentDate, setCurrentDate] = useState(() => new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [events, setEvents] = useState<DutyEvent[]>(() => loadEvents())
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const skipNextPersist = useRef(true)
  const [showMenu, setShowMenu] = useState(false)
  const [menuDate, setMenuDate] = useState<Date | null>(null)
  const [showAddDuty, setShowAddDuty] = useState(false)
  const [addDutyDate, setAddDutyDate] = useState<Date | null>(null)
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [endDate, setEndDate] = useState('')
  const [modalAcclTZ, setModalAcclTZ] = useState('')
  const [restType, setRestType] = useState<RestType>('12h')
  const [isEdit, setIsEdit] = useState(false)
  const [editEvent, setEditEvent] = useState<DutyEvent | null>(null)
  const [animating, setAnimating] = useState(false)
  const [showRestDetails, setShowRestDetails] = useState(false)
  const [selectedRest, setSelectedRest] = useState<DutyEvent | null>(null)
  const [showHamburgerMenu, setShowHamburgerMenu] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [maxDutyResult, setMaxDutyResult] = useState('')
  const [validationMessage, setValidationMessage] = useState('')

  useEffect(() => {
    // Avoid rewriting localStorage on mount with an identical payload
    if (skipNextPersist.current) {
      skipNextPersist.current = false
      return
    }
    saveEvents(events)
  }, [events])

  useEffect(() => {
    return () => {
      if (pressTimerRef.current) clearTimeout(pressTimerRef.current)
    }
  }, [])

  const now = useMemo(() => new Date(), [])
  const minMonth = useMemo(
    () => new Date(now.getFullYear(), now.getMonth() - 13, 1),
    [now],
  )
  const maxMonth = useMemo(
    () => new Date(now.getFullYear(), now.getMonth() + 3, 1),
    [now],
  )

  const getCalendarDays = (date: Date) => {
    const year = date.getFullYear()
    const month = date.getMonth()
    const firstDayOfMonth = new Date(year, month, 1)
    const lastDayOfMonth = new Date(year, month + 1, 0)
    const startDate = new Date(firstDayOfMonth)
    startDate.setDate(firstDayOfMonth.getDate() - firstDayOfMonth.getDay())
    const endDateLocal = new Date(lastDayOfMonth)
    endDateLocal.setDate(lastDayOfMonth.getDate() + (6 - lastDayOfMonth.getDay()))
    const days: Date[] = []
    const current = new Date(startDate)
    while (current <= endDateLocal) {
      days.push(new Date(current))
      current.setDate(current.getDate() + 1)
    }
    return days
  }

  const getDayStatus = (date: Date) => {
    const dayEvents = eventsOnLocalDay(events, date)
    if (dayEvents.some((e) => e.violated)) return 'red'
    if (dayEvents.some((e) => e.type === 'duty')) return 'blue'
    if (dayEvents.some((e) => e.type === 'rest')) return 'amber'
    return 'white'
  }

  const renderEventBars = (date: Date) => {
    const dayStart = startOfLocalDay(date)
    const dayEnd = new Date(dayStart)
    dayEnd.setDate(dayEnd.getDate() + 1)
    const dayEvents = eventsOnLocalDay(events, date)
    const allBars: ReactNode[] = []
    const allMarkers: { type: string; eventId: string }[] = []

    dayEvents.forEach((event) => {
      let barTop = '30%'
      if (event.type === 'rest') {
        const overlappingRest = dayEvents.find(
          (e) =>
            e.type === 'rest' &&
            e.id !== event.id &&
            eventsOverlap(e.start, e.end, event.start, event.end),
        )
        if (overlappingRest) {
          const thisDuration = event.end.getTime() - event.start.getTime()
          const otherDuration =
            overlappingRest.end.getTime() - overlappingRest.start.getTime()
          if (thisDuration > otherDuration) barTop = '42%'
        }
      }

      const isStart = event.start >= dayStart && event.start < dayEnd
      const isEnd = event.end > dayStart && event.end <= dayEnd
      const { left, width } = dayBarPosition(
        event.start,
        event.end,
        dayStart,
        dayEnd,
      )

      const markers = getDutyMarkers(
        event,
        regulator,
        acclTZ,
        isStart,
        isEnd,
      )
      markers.forEach((marker) =>
        allMarkers.push({ type: marker, eventId: event.id }),
      )

      // Key includes day so multi-day events don't collide across cells
      allBars.push(
        <div
          key={`${event.id}-${dayStart.toISOString()}`}
          className={`event-bar ${event.type}`}
          style={{ left: `${left}%`, width: `${width}%`, top: barTop }}
          title={event.title}
          onClick={(e) => {
            e.stopPropagation()
            if (event.type === 'duty') {
              alert(
                `${event.title}\nType: ${event.type}\nStart: ${event.start.toLocaleString()}\nEnd: ${event.end.toLocaleString()}`,
              )
            } else {
              setSelectedRest(event)
              setShowRestDetails(true)
            }
          }}
        />,
      )
    })

    const markerElements = allMarkers.map((marker, index) => {
      const isLNR = marker.type === 'LNR'
      return (
        <span
          key={`${marker.eventId}-${marker.type}-${dayStart.toISOString()}-${index}`}
          className={`marker ${marker.type}`}
          style={
            isLNR
              ? {
                  top: 'calc(30% + 12px + 2px)',
                  left: '50%',
                  transform: 'translateX(-50%)',
                }
              : { left: `${2 + index * 15}px`, bottom: '2px' }
          }
        >
          {marker.type}
        </span>
      )
    })

    return [...allBars, ...markerElements]
  }

  const getDayActions = (date: Date) => {
    const duties = findDutiesOnDate(events, date)
    if (duties.length > 0) {
      return ['Edit Duty', 'Delete Duty', 'Required Rest']
    }
    return ['Add Duty', 'Required Rest']
  }

  const handleMouseDown = (date: Date) => {
    if (pressTimerRef.current) clearTimeout(pressTimerRef.current)
    pressTimerRef.current = setTimeout(() => {
      selectDate(date)
      setShowMenu(true)
      pressTimerRef.current = null
    }, 500)
  }

  const handleMouseUp = () => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current)
      pressTimerRef.current = null
    }
  }

  /** Last date the user targeted (click or long-press) — single source of truth for actions. */
  const selectDate = (date: Date) => {
    setSelectedDate(date)
    setMenuDate(date)
  }

  const handleClick = (date: Date) => {
    if (showMenu) return
    if (showAddDuty) {
      setAddDutyDate(date)
      setEndDate(toLocalDateInputValue(date))
      selectDate(date)
    } else if (isEdit) {
      const duty = findDutyOnDate(events, date)
      if (duty) {
        selectDate(date)
        setEditEvent(duty)
        setStartTime(formatHHmm(duty.start))
        setEndDate(toLocalDateInputValue(duty.end))
        setEndTime(formatHHmm(duty.end))
        setModalAcclTZ(duty.acclTZ || acclTZ)
      }
    } else if (date.getMonth() !== currentDate.getMonth()) {
      setAnimating(true)
      setTimeout(
        () => setCurrentDate(new Date(date.getFullYear(), date.getMonth(), 1)),
        150,
      )
      setTimeout(() => setAnimating(false), 300)
    } else {
      selectDate(date)
    }
  }

  const openAddDutyFor = (date: Date | null) => {
    if (!date) return
    selectDate(date)
    setShowAddDuty(true)
    setShowMenu(false)
    setAddDutyDate(date)
    setEndDate(toLocalDateInputValue(date))
    setRestType('12h')
    setIsEdit(false)
    setEditEvent(null)
    setValidationMessage('')
    setMaxDutyResult('')
  }

  const handleAddDuty = () => {
    // Prefer last clicked/selected date; fall back to long-press menu date only if needed
    openAddDutyFor(selectedDate ?? menuDate)
  }

  const handleEditDuty = () => {
    if (!selectedDate) return
    const event = findDutyOnDate(events, selectedDate)
    if (!event) return

    setIsEdit(true)
    setEditEvent(event)
    setAddDutyDate(selectedDate)
    setStartTime(formatHHmm(event.start))
    setEndDate(toLocalDateInputValue(event.end))
    setEndTime(formatHHmm(event.end))
    setModalAcclTZ(event.acclTZ || acclTZ)
    const restEvent = events.find((e) => e.id === restIdForDuty(event.id))
    if (restEvent) {
      const restDuration =
        (restEvent.end.getTime() - restEvent.start.getTime()) /
        (1000 * 60 * 60)
      setRestType(restDuration === 10 ? '10+travel' : '12h')
    } else {
      setRestType('12h')
    }
    setShowAddDuty(true)
    setShowMenu(false)
    setValidationMessage('')
  }

  const handleDeleteDuty = () => {
    if (!selectedDate) return
    const event = findDutyOnDate(events, selectedDate)
    if (!event) return
    setEvents((prev) => removeDutyAndRelated(prev, event))
    setSelectedDate(null)
  }

  const resetDutyForm = () => {
    setShowAddDuty(false)
    setStartTime('')
    setEndTime('')
    setEndDate('')
    setModalAcclTZ('')
    setRestType('12h')
    setIsEdit(false)
    setEditEvent(null)
    setValidationMessage('')
    setMaxDutyResult('')
  }

  const handleSubmitDuty = () => {
    setValidationMessage('')
    if (!addDutyDate || !startTime || !endTime || !endDate) {
      setValidationMessage(
        'Please fill in all required fields: Start Time, End Date, and End Time',
      )
      return
    }

    const start = combineLocalDateAndTime(addDutyDate, startTime)
    const end = parseLocalDateTime(endDate, endTime)

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      setValidationMessage('Invalid date/time format. Please check your inputs.')
      return
    }
    if (start >= end) {
      setValidationMessage('End time must be after start time.')
      return
    }

    const duration = (end.getTime() - start.getTime()) / (1000 * 60 * 60)
    const dutyAccl = modalAcclTZ || acclTZ
    const startHour = getHourInTZ(start, dutyAccl)
    const maxDuty = getMaxFdpHours(regulator, startHour, sectors, avgSectorTime)
    const minRest = getMinRestHours(regulator)
    const actualRestHours = restType === '10+travel' ? 10 : minRest

    if (duration > maxDuty) {
      setValidationMessage(
        `FDP exceeds table limit for ${regulator === 'TC' ? 'CAR 705' : regulator}`,
      )
      return
    }

    if (
      wouldExceedWeeklyLimit(
        events,
        start,
        end,
        isEdit ? editEvent?.id : undefined,
      )
    ) {
      setValidationMessage(
        `Total hours of work in 7 days would exceed ${MAX_WEEKLY_DUTY_HOURS} hours for ${regulator === 'TC' ? 'CAR 705' : regulator}`,
      )
      return
    }

    if (isEdit && editEvent) {
      const oldStart = editEvent.start
      const oldEnd = editEvent.end
      const updatedDuty: DutyEvent = {
        ...editEvent,
        start,
        end,
        acclTZ: dutyAccl,
        title: editEvent.title || 'Duty Period',
        type: 'duty',
      }

      setEvents((prev) => {
        let next = stripLnrTouching(prev, oldStart, oldEnd)
        next = next.filter(
          (e) => e.id !== editEvent.id && e.id !== restIdForDuty(editEvent.id),
        )
        next = [...next, updatedDuty]

        // Optional: rebuild rest if needed — keep previous rest hours via restType
        const restEvent = buildRestEvent(
          updatedDuty.id,
          end,
          actualRestHours,
          restType,
        )
        next = [...next, restEvent]

        const duties = next.filter((e) => e.type === 'duty')
        const previousDuty = findPreviousDuty(next, start, updatedDuty.id)
        if (previousDuty) {
          const lnr = maybeBuildLnrBetween(
            previousDuty,
            updatedDuty,
            regulator,
            previousDuty.acclTZ || dutyAccl,
            duties,
          )
          if (lnr) {
            if (lnr.violated) {
              alert('Local night rest does not meet regulatory requirements.')
            }
            next = [...next, lnr]
          }
        }

        const nextDuty = findNextDuty(next, end, updatedDuty.id)
        if (nextDuty) {
          const lnr = maybeBuildLnrBetween(
            updatedDuty,
            nextDuty,
            regulator,
            updatedDuty.acclTZ || dutyAccl,
            duties,
          )
          if (lnr) {
            if (lnr.violated) {
              alert('Local night rest does not meet regulatory requirements.')
            }
            next = [...next, lnr]
          }
        }

        return next
      })

      // Validate 10+travel before closing; form stays open if release already passed
      if (restType === '10+travel') {
        const result = scheduleTravelRestReminders(end)
        if (!result.ok) {
          if ((result.hoursSinceRelease ?? 0) > 15) {
            setValidationMessage(
              'More than 15 hours have passed since the release time. Please update the release time to reflect the actual time at the rest location.',
            )
          } else {
            setValidationMessage(
              'The release time has already passed. Please modify the end time of the duty to reflect the actual release time.',
            )
          }
          return
        }
      }

      resetDutyForm()
      return
    }

    // Create new duty
    const overlapsRest = events.some(
      (e) =>
        e.type === 'rest' && eventsOverlap(start, end, e.start, e.end),
    )
    if (overlapsRest) {
      if (
        confirm(
          'Duty period overlaps with a rest period. Click OK to edit the duty, or Cancel to disregard and add anyway.',
        )
      ) {
        return
      }
    }

    const newId = createId()
    const newEvent: DutyEvent = {
      id: newId,
      title: 'Duty Period',
      start,
      end,
      type: 'duty',
      acclTZ: dutyAccl,
      violated: overlapsRest,
    }
    const restEvent = buildRestEvent(newId, end, actualRestHours, restType)

    setEvents((prev) => {
      let next = [...prev, newEvent, restEvent]
      const previousDuty = findPreviousDuty(next, start, newId)
      if (previousDuty) {
        const lnr = maybeBuildLnrBetween(
          previousDuty,
          newEvent,
          regulator,
          previousDuty.acclTZ || dutyAccl,
          next.filter((e) => e.type === 'duty'),
        )
        if (lnr) {
          if (lnr.violated) {
            alert('Local night rest does not meet regulatory requirements.')
          }
          next = [...next, lnr]
        }
      }
      return next
    })

    if (restType === '10+travel') {
      const result = scheduleTravelRestReminders(end)
      if (!result.ok) {
        setIsEdit(true)
        setEditEvent(newEvent)
        setStartTime(formatHHmm(newEvent.start))
        setEndDate(toLocalDateInputValue(newEvent.end))
        setEndTime(formatHHmm(newEvent.end))
        setModalAcclTZ(newEvent.acclTZ || acclTZ)
        setRestType('10+travel')
        setShowAddDuty(true)
        if ((result.hoursSinceRelease ?? 0) > 15) {
          setValidationMessage(
            'More than 15 hours have passed since the original release time. Please update the release time to reflect the actual time at the rest location.',
          )
        } else {
          setValidationMessage(
            'The original release time has already passed. Please modify the end time of the duty to reflect the actual release time at the hotel.',
          )
        }
        return
      }
    }

    resetDutyForm()
  }

  const days = useMemo(
    () => getCalendarDays(currentDate),
    [currentDate],
  )

  const isInRange = (date: Date) => {
    if (!showAddDuty || !addDutyDate) return false
    const start = startOfLocalDay(addDutyDate)
    const end = endDate
      ? startOfLocalDay(parseLocalDateTime(endDate, '00:00'))
      : start
    const d = startOfLocalDay(date)
    return d.getTime() >= start.getTime() && d.getTime() <= end.getTime()
  }

  return (
    <>
      <div
        className={`calendar ${darkMode ? 'dark' : 'light'} ${animating ? 'animating' : ''}`}
      >
        <div className="auth-backdrop" aria-hidden="true">
          <div className="bg-video-blur">
            <div className="video-placeholder">Demo Video</div>
          </div>
          <div className="backdrop-overlay" />
        </div>
        <header className="site-header calendar-header">
          <div className="nav-container">
            <Link to="/" className="logo-placeholder">
              (LOGO)
            </Link>
            <div className="header-center">
              <h2 className="header-title">Calendar</h2>
              <Link to="/signup">Signup</Link>
              <Link to="/login">Login</Link>
            </div>
            <div className="header-buttons">
              <button
                type="button"
                className="settings-button"
                aria-label="Settings"
                onClick={() => setShowSettings(true)}
              >
                ⚙️
              </button>
              <button
                type="button"
                className="settings-button"
                aria-label="Menu"
                onClick={() => setShowHamburgerMenu(true)}
              >
                ☰
              </button>
              <button
                type="button"
                className="theme-toggle"
                aria-label="Toggle theme"
                onClick={toggleDarkMode}
              >
                {darkMode ? '☀️' : '🌙'}
              </button>
            </div>
          </div>
        </header>
        <div className="calendar-page-container">
          <div className="month-header">
            <h1 className="month-title">
              {currentDate > minMonth && (
                <button
                  type="button"
                  className="nav-prev"
                  aria-label="Previous month"
                  onClick={() => {
                    const newDate = new Date(
                      currentDate.getFullYear(),
                      currentDate.getMonth() - 1,
                      1,
                    )
                    if (newDate >= minMonth) {
                      setAnimating(true)
                      setTimeout(() => setCurrentDate(newDate), 150)
                      setTimeout(() => setAnimating(false), 300)
                    }
                  }}
                >
                  &#x00AB;
                </button>
              )}
              <span className="month-label">
                {currentDate.toLocaleDateString('en-US', {
                  month: 'long',
                  year: 'numeric',
                })}
              </span>
              {currentDate < maxMonth && (
                <button
                  type="button"
                  className="nav-next"
                  aria-label="Next month"
                  onClick={() => {
                    const newDate = new Date(
                      currentDate.getFullYear(),
                      currentDate.getMonth() + 1,
                      1,
                    )
                    if (newDate <= maxMonth) {
                      setAnimating(true)
                      setTimeout(() => setCurrentDate(newDate), 150)
                      setTimeout(() => setAnimating(false), 300)
                    }
                  }}
                >
                  &#x00BB;
                </button>
              )}
            </h1>
          </div>
          <div className="calendar-container">
            <div className="calendar-grid">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                <div key={day} className="day-header">
                  {day}
                </div>
              ))}
              {days.map((date: Date) => {
                const today = new Date()
                const isToday = date.toDateString() === today.toDateString()
                const dayStart = startOfLocalDay(date)
                const dayEvents = eventsOnLocalDay(events, date)
                let violationLeft = 0
                const violatedDuty = dayEvents.find(
                  (e) => e.violated && e.type === 'duty',
                )
                let violatedLNR: DutyEvent | null | undefined = null
                if (!violatedDuty) {
                  violatedLNR = dayEvents.find(
                    (e) =>
                      e.violated && e.type === 'rest' && e.isLocalNightRest,
                  )
                }
                if (violatedDuty) {
                  const overlappingRest = dayEvents.find(
                    (e) =>
                      e.type === 'rest' &&
                      eventsOverlap(
                        violatedDuty.start,
                        violatedDuty.end,
                        e.start,
                        e.end,
                      ),
                  )
                  if (overlappingRest) {
                    const overlapStart = new Date(
                      Math.max(
                        violatedDuty.start.getTime(),
                        overlappingRest.start.getTime(),
                      ),
                    )
                    const overlapHour =
                      (overlapStart.getTime() - dayStart.getTime()) /
                      (1000 * 60 * 60)
                    violationLeft = (overlapHour / 24) * 100
                  }
                } else if (violatedLNR) {
                  const overlappingDuty = dayEvents.find(
                    (e) =>
                      e.type === 'duty' &&
                      eventsOverlap(
                        violatedLNR!.start,
                        violatedLNR!.end,
                        e.start,
                        e.end,
                      ),
                  )
                  if (overlappingDuty) {
                    const overlapStart = new Date(
                      Math.max(
                        violatedLNR.start.getTime(),
                        overlappingDuty.start.getTime(),
                      ),
                    )
                    const overlapHour =
                      (overlapStart.getTime() - dayStart.getTime()) /
                      (1000 * 60 * 60)
                    violationLeft = (overlapHour / 24) * 100
                  }
                }
                return (
                  <div
                    key={date.toISOString()}
                    className={`day ${getDayStatus(date)} ${date.getMonth() !== currentDate.getMonth() ? 'other-month' : ''} ${selectedDate && selectedDate.toDateString() === date.toDateString() ? 'selected' : ''} ${isInRange(date) ? 'in-range' : ''} ${isToday ? 'today' : ''}`}
                    onMouseDown={() => handleMouseDown(date)}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                    onTouchStart={() => handleMouseDown(date)}
                    onTouchEnd={handleMouseUp}
                    onClick={() => handleClick(date)}
                  >
                    <span className="day-number">{date.getDate()}</span>
                    {renderEventBars(date)}
                    {dayEvents.some((e) => e.violated) && (
                      <div
                        className="violation-icon"
                        style={{ left: `${violationLeft}%`, bottom: '2px' }}
                        onClick={(e) => {
                          e.stopPropagation()
                          alert(
                            'Violation: Duty period overlaps with a rest period or LNR requirements not met.',
                          )
                        }}
                      >
                        ⚠️
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
          {selectedDate && (
            <div className="day-details">
              <h3>{selectedDate.toDateString()}</h3>
              <p>
                Events:{' '}
                {events
                  .filter(
                    (e) =>
                      e.start.toDateString() === selectedDate.toDateString() ||
                      (e.start < selectedDate &&
                        e.end >
                          startOfLocalDay(selectedDate)),
                  )
                  .map((e) => e.title)
                  .join(', ') || 'None'}
              </p>
              <div className="actions">
                {getDayActions(selectedDate).map((action) => (
                  <button
                    type="button"
                    key={action}
                    onClick={
                      action === 'Add Duty'
                        ? handleAddDuty
                        : action === 'Edit Duty'
                          ? handleEditDuty
                          : action === 'Delete Duty'
                            ? handleDeleteDuty
                            : () => alert(action)
                    }
                  >
                    {action}
                  </button>
                ))}
              </div>
              <button type="button" onClick={() => setSelectedDate(null)}>
                Close
              </button>
            </div>
          )}

          {showMenu && menuDate && (
            <div className="modal">
              <div className="modal-content">
                <h3>Options for {menuDate.toDateString()}</h3>
                <button type="button" onClick={handleAddDuty}>
                  Add Duty
                </button>
                <button type="button" onClick={() => setShowMenu(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {showAddDuty && addDutyDate && (
            <div className="slide-menu open">
              <h3>
                {isEdit ? 'Edit Duty' : 'Add Duty'} for{' '}
                {addDutyDate.toDateString()}
              </h3>
              <label>
                Start Time:
                <FreeTimeInput
                  value={startTime}
                  onChange={setStartTime}
                  timeFormat={timeFormat}
                  aria-label="Start time"
                />
                {startTime && (
                  <span className="time-display">
                    Local: {formatTimeDisplay(startTime, timeFormat)} | Zulu:{' '}
                    {getZuluTimeDisplay(startTime, addDutyDate, timeFormat)}
                  </span>
                )}
              </label>
              <label>
                End Date:
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </label>
              <label>
                End Time:
                <FreeTimeInput
                  value={endTime}
                  onChange={setEndTime}
                  timeFormat={timeFormat}
                  aria-label="End time"
                />
                {endTime && (
                  <span className="time-display">
                    Local: {formatTimeDisplay(endTime, timeFormat)} | Zulu:{' '}
                    {getZuluTimeDisplay(
                      endTime,
                      endDate ? parseLocalDateTime(endDate, '00:00') : null,
                      timeFormat,
                    )}
                  </span>
                )}
              </label>
              <label>
                Number of Sectors:
                <input
                  type="number"
                  min="1"
                  value={sectors}
                  onChange={(e) => setSectors(Number(e.target.value) || 1)}
                />
              </label>
              <label>
                Average Sector Time:
                <select
                  value={avgSectorTime}
                  onChange={(e) =>
                    setAvgSectorTime(e.target.value as AvgSectorTime)
                  }
                >
                  <option value="<30">Less than 30 min</option>
                  <option value="30-50">30 to less than 50 min</option>
                  <option value=">=50">50 min or more</option>
                </select>
              </label>
              <label>
                Acclimatization Time Zone:
                <TimeZoneSelector
                  value={modalAcclTZ}
                  onChange={setModalAcclTZ}
                  placeholder="Search time zones or use global setting"
                  allowEmpty={true}
                />
              </label>
              <label>
                Rest Type:
                <select
                  value={restType}
                  onChange={(e) => setRestType(e.target.value as RestType)}
                >
                  <option value="12h">12 hours rest</option>
                  <option value="10+travel">
                    10+travel (10 hours at hotel + room key)
                  </option>
                </select>
              </label>
              <button
                type="button"
                onClick={() => {
                  if (!startTime || !addDutyDate) return
                  const start = combineLocalDateAndTime(addDutyDate, startTime)
                  const hour = getHourInTZ(start, modalAcclTZ || acclTZ)
                  const max = getMaxFdpHours(
                    regulator,
                    hour,
                    sectors,
                    avgSectorTime,
                  )
                  setMaxDutyResult(
                    `Max FDP: ${max} hours (${regulator === 'TC' ? 'CAR 705' : regulator})`,
                  )
                }}
              >
                Check Max Duty
              </button>
              {maxDutyResult && (
                <div className="max-duty-result">{maxDutyResult}</div>
              )}
              <button type="button" onClick={handleSubmitDuty}>
                {isEdit ? 'Update' : 'Add'}
              </button>
              {validationMessage && (
                <div className="validation-error">{validationMessage}</div>
              )}
              <button type="button" onClick={resetDutyForm}>
                Cancel
              </button>
            </div>
          )}

          {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
        </div>
      </div>
      {showRestDetails && selectedRest && (
        <div
          className="modal-overlay"
          onClick={() => {
            setShowRestDetails(false)
            setSelectedRest(null)
          }}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{selectedRest.title}</h3>
            <p>Type: {selectedRest.type}</p>
            <p>Start: {selectedRest.start.toLocaleString()}</p>
            <p>End: {selectedRest.end.toLocaleString()}</p>
            <div
              style={{
                display: 'flex',
                gap: '1rem',
                justifyContent: 'center',
                marginTop: '1rem',
              }}
            >
              <button
                type="button"
                style={{ background: 'red', color: 'white' }}
                onClick={() => {
                  if (
                    confirm('Are you sure you want to delete this rest event?')
                  ) {
                    setEvents((prev) =>
                      prev.filter((e) => e.id !== selectedRest.id),
                    )
                    setShowRestDetails(false)
                    setSelectedRest(null)
                  }
                }}
              >
                Delete
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowRestDetails(false)
                  setSelectedRest(null)
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
      {showHamburgerMenu && (
        <div
          className="modal-overlay"
          onClick={() => setShowHamburgerMenu(false)}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Menu</h3>
            <button
              type="button"
              onClick={() => {
                const monthStart = new Date(
                  currentDate.getFullYear(),
                  currentDate.getMonth(),
                  1,
                )
                const monthEnd = new Date(
                  currentDate.getFullYear(),
                  currentDate.getMonth() + 1,
                  1,
                )
                if (
                  confirm(
                    'Are you sure you want to delete all events in the current month?',
                  )
                ) {
                  setEvents((prev) =>
                    prev.filter(
                      (e) => e.start < monthStart || e.start >= monthEnd,
                    ),
                  )
                  setShowHamburgerMenu(false)
                }
              }}
            >
              Delete all events
            </button>
            <button type="button" onClick={() => setShowHamburgerMenu(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </>
  )
}

export default Calendar
