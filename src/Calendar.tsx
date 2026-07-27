import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { Link } from 'react-router-dom'
import './Calendar.css'
import './App.css'
import type { AvgSectorTime, DutyEvent, RestType } from './domain/types'
import { defaultWorkFactor, MAX_WEEKLY_DUTY_HOURS } from './domain/types'
import {
  createId,
  eventsOnLocalDay,
  findDutyOnDate,
  findDutiesOnDate,
  recomputeAfterDutyChange,
  recomputeAfterDutyDelete,
  removeDutyAndRelated,
  restIdForDuty,
  summarizeViolatedLnrs,
} from './domain/events'
import {
  freeEventFromProposal,
  proposeFreeBlocks,
  type FreeBlockProposal,
} from './domain/free-time-planner'
import {
  explainEvent,
  explainMarker,
  infoSheetFrom70029Violation,
  infoSheetFromMarker,
  infoSheetFromPhantomDisruptiveRest,
  infoSheetFromSdf,
  type InfoSheetContent,
} from './domain/markers'
import {
  withDebugContext,
  type DebugFocus,
} from './domain/info-sheet-debug'
import {
  buildPhantomSegments,
  buildScheduleLayout,
  type DayBarSpec,
  type DayMarkerSpec,
} from './domain/calendar-day-layout'
import { buildPreferredHostMap } from './domain/marker-layout'
import {
  eventsOverlap,
  getAbsoluteMaxFdpHours,
  getMaxFdpHours,
  wouldExceedWeeklyLimit,
} from './domain/regulations'
import { CalendarDayCell } from './CalendarDayCell'
import {
  evaluate70029,
  hasHard70029HourViolation,
  hasSoft70029SdfWarning,
} from './domain/rest-70029'
import {
  addCivilDaysInTimeZone,
  addDaysToDateInputValue,
  daysBetweenDateInputValues,
  formatHHmmInTZ,
  formatTimeDisplay,
  getHourInTZ,
  getZonedTimeParts,
  getZuluTimeDisplay,
  isOvernightDutyPeriod,
  parseDateInputValue,
  parseZonedDateTime,
  startOfDayInTimeZone,
  startOfDayKeyInTimeZone,
  toDateInputValueInTZ,
  zonedWallTime,
} from './domain/time'
import { useSettings } from './features/settings/SettingsContext'
import { scheduleTravelRestReminders } from './shared/notifications'
import {
  clearDeletedEvents,
  loadDeletedEvents,
  loadEvents,
  mergeIntoDeletedBin,
  mergeRestoredEvents,
  partitionEvents,
  saveDeletedEvents,
  saveEvents,
} from './shared/storage'
import FreeTimeInput from './shared/ui/FreeTimeInput'
import SettingsPanel from './shared/ui/SettingsPanel'
import TimeZoneSelector from './shared/ui/TimeZoneSelector'
import ThemeToggle from './shared/ui/ThemeToggle'
import { IconClose, IconSettings } from './shared/ui/icons'

function Calendar() {
  const {
    darkMode,
    timeFormat,
    regulator,
    acclTZ,
    referenceTZ,
    sectors,
    setSectors,
    avgSectorTime,
    setAvgSectorTime,
    timeFreeOption,
    calendarTimeRef,
    resolvedCalendarTZ,
  } = useSettings()

  const homeBaseTZ = referenceTZ || acclTZ
  /** Calendar day cells / bars use this IANA zone. */
  const calendarTZ = resolvedCalendarTZ

  const dayStartInCal = (d: Date) => startOfDayInTimeZone(d, calendarTZ)

  const [currentDate, setCurrentDate] = useState(() => new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [events, setEvents] = useState<DutyEvent[]>(() => loadEvents())
  const [freeProposals, setFreeProposals] = useState<FreeBlockProposal[]>([])
  const [showFreeProposals, setShowFreeProposals] = useState(false)

  const report70029 = useMemo(
    () => evaluate70029(events, acclTZ, regulator, timeFreeOption),
    [events, acclTZ, regulator, timeFreeOption],
  )

  /** Open marker/event info sheet with section-4 AI debug dump attached. */
  const openInfoSheet = (sheet: InfoSheetContent, focus: DebugFocus) => {
    setInfoSheet(
      withDebugContext(sheet, {
        focus,
        events,
        regulator,
        acclTZ,
        homeBaseTZ,
        timeFreeOption,
        report70029,
      }),
    )
  }

  const [debugCopied, setDebugCopied] = useState(false)
  const copyDebugContext = async () => {
    const text = infoSheet?.debugContext
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setDebugCopied(true)
      window.setTimeout(() => setDebugCopied(false), 2000)
    } catch {
      // Fallback for restricted clipboard
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.left = '-9999px'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      setDebugCopied(true)
      window.setTimeout(() => setDebugCopied(false), 2000)
    }
  }
  const [deletedEventCount, setDeletedEventCount] = useState(
    () => loadDeletedEvents().length,
  )
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
  const [modalStartTZ, setModalStartTZ] = useState('')
  const [modalEndTZ, setModalEndTZ] = useState('')
  const [restType, setRestType] = useState<RestType>('12h')
  const [isEdit, setIsEdit] = useState(false)
  const [editEvent, setEditEvent] = useState<DutyEvent | null>(null)
  const [animating, setAnimating] = useState(false)
  const [infoSheet, setInfoSheet] = useState<InfoSheetContent | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [maxDutyResult, setMaxDutyResult] = useState('')
  const [validationMessage, setValidationMessage] = useState('')
  /** Re-key end-date input to re-run blink animation after auto overnight adjust. */
  const [endDateBlinkKey, setEndDateBlinkKey] = useState(0)
  const [endDateShouldBlink, setEndDateShouldBlink] = useState(false)

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

  // Overnight: if end instant ≤ start on the same end-date label, roll end date.
  useEffect(() => {
    if (!showAddDuty || !addDutyDate || !startTime || !endTime || !endDate)
      return
    const startYmd = toDateInputValueInTZ(addDutyDate, calendarTZ)
    const sTz = modalStartTZ || modalAcclTZ || acclTZ
    const eTz = modalEndTZ || modalAcclTZ || acclTZ
    const start = parseZonedDateTime(startYmd, startTime, sTz)
    const endOnLabel = parseZonedDateTime(endDate, endTime, eTz)
    if (isNaN(start.getTime()) || isNaN(endOnLabel.getTime())) return
    // Same civil end label as start day and end ≤ start → need next end-day
    if (endDate === startYmd && endOnLabel.getTime() <= start.getTime()) {
      const auto = addDaysToDateInputValue(endDate, 1)
      if (auto !== endDate) {
        setEndDate(auto)
        setEndDateShouldBlink(true)
        setEndDateBlinkKey((k) => k + 1)
      }
    }
  }, [
    showAddDuty,
    addDutyDate,
    startTime,
    endTime,
    endDate,
    calendarTZ,
    modalStartTZ,
    modalEndTZ,
    modalAcclTZ,
    acclTZ,
  ])

  useEffect(() => {
    if (!endDateShouldBlink) return
    const t = setTimeout(() => setEndDateShouldBlink(false), 1400)
    return () => clearTimeout(t)
  }, [endDateShouldBlink, endDateBlinkKey])

  const isOvernightDuty = useMemo(() => {
    if (!showAddDuty || !addDutyDate || !startTime || !endTime || !endDate) {
      return false
    }
    const startYmd = toDateInputValueInTZ(addDutyDate, calendarTZ)
    const sTz = modalStartTZ || modalAcclTZ || acclTZ
    const eTz = modalEndTZ || modalAcclTZ || acclTZ
    const start = parseZonedDateTime(startYmd, startTime, sTz)
    const end = parseZonedDateTime(endDate, endTime, eTz)
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start)
      return false
    // Spans midnight in calendar display zone, or end civil day ≠ start civil day
    const startCal = toDateInputValueInTZ(start, calendarTZ)
    const endCal = toDateInputValueInTZ(end, calendarTZ)
    return (
      startCal !== endCal ||
      isOvernightDutyPeriod(startYmd, startTime, endDate, endTime)
    )
  }, [
    showAddDuty,
    addDutyDate,
    startTime,
    endTime,
    endDate,
    calendarTZ,
    modalStartTZ,
    modalEndTZ,
    modalAcclTZ,
    acclTZ,
  ])

  const longDutyPeriodWarning = useMemo(() => {
    if (!showAddDuty || !addDutyDate || !startTime || !endTime || !endDate) {
      return false
    }
    const startYmd = toDateInputValueInTZ(addDutyDate, calendarTZ)
    const sTz = modalStartTZ || modalAcclTZ || acclTZ
    const eTz = modalEndTZ || modalAcclTZ || acclTZ
    const start = parseZonedDateTime(startYmd, startTime, sTz)
    const end = parseZonedDateTime(endDate, endTime, eTz)
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
      return false
    }
    const hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60)
    return hours > getAbsoluteMaxFdpHours(regulator)
  }, [
    showAddDuty,
    addDutyDate,
    startTime,
    endTime,
    endDate,
    regulator,
    calendarTZ,
    modalStartTZ,
    modalEndTZ,
    modalAcclTZ,
    acclTZ,
  ])

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
    const p = getZonedTimeParts(date, calendarTZ)
    const firstOfMonth = zonedWallTime(calendarTZ, p.year, p.month, 1, 0, 0)
    const wdLabel = new Intl.DateTimeFormat('en-US', {
      timeZone: calendarTZ,
      weekday: 'short',
    }).format(firstOfMonth)
    const wdMap: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    }
    const firstDow = wdMap[wdLabel] ?? 0
    // 6 weeks fixed grid
    const gridStart = addCivilDaysInTimeZone(firstOfMonth, calendarTZ, -firstDow)
    const days: Date[] = []
    let cur = gridStart
    for (let i = 0; i < 42; i++) {
      days.push(cur)
      cur = addCivilDaysInTimeZone(cur, calendarTZ, 1)
    }
    return days
  }

  const days = useMemo(
    () => getCalendarDays(currentDate),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- getCalendarDays closes over calendarTZ
    [currentDate, calendarTZ],
  )


  // Layout once when schedule/view changes — NOT on selection clicks.
  // Duty add/edit/delete still run recomputeAfterDuty* → setEvents → this rebuilds.
  const scheduleLayout = useMemo(() => {
    const restIntervals = events
      .filter((e) => e.type === 'rest')
      .map((e) => ({ id: e.id, start: e.start, end: e.end }))
    const sdfIntervals = report70029.displaySdfs.map((d, i) => ({
      id: `sdf-${d.sdf.start.toISOString()}-${i}`,
      start: d.sdf.start,
      end: d.sdf.end,
    }))
    const hostMap = buildPreferredHostMap(
      [...restIntervals, ...sdfIntervals],
      calendarTZ,
    )
    const phantoms = buildPhantomSegments(events, regulator, acclTZ)
    return buildScheduleLayout(
      days,
      currentDate,
      events,
      report70029.displaySdfs,
      calendarTZ,
      regulator,
      acclTZ,
      hostMap,
      phantoms,
      report70029.violations,
    )
  }, [
    days,
    currentDate,
    events,
    calendarTZ,
    regulator,
    acclTZ,
    report70029.displaySdfs,
    report70029.violations,
  ])

  const sharedDayMinRem = scheduleLayout.sharedDayMinRem

  const eventsById = useMemo(() => {
    const m = new Map<string, DutyEvent>()
    for (const e of events) m.set(e.id, e)
    return m
  }, [events])

  const dateByStartMs = useMemo(() => {
    const m = new Map<number, Date>()
    for (const d of days) m.set(dayStartInCal(d).getTime(), d)
    return m
  }, [days, calendarTZ])

  const handleDayClickMs = useCallback(
    (dayStartMs: number) => {
      const d = dateByStartMs.get(dayStartMs)
      if (d) handleClick(d)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dateByStartMs, showMenu, showAddDuty, isEdit, events, calendarTZ, selectedDate],
  )

  const handleDayPressStartMs = useCallback(
    (dayStartMs: number) => {
      const d = dateByStartMs.get(dayStartMs)
      if (d) handleMouseDown(d)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dateByStartMs],
  )

  const handleDayPressEnd = useCallback(() => {
    handleMouseUp()
  }, [])

  const handleBarClick = useCallback(
    (bar: DayBarSpec, e: ReactMouseEvent) => {
      e.stopPropagation()
      if (bar.kind === 'phantom' && bar.phantom) {
        const ph = bar.phantom
        openInfoSheet(
          infoSheetFromPhantomDisruptiveRest({
            solidRestEnd: ph.solidRestEnd,
            phantomEnd: ph.phantomEnd,
            thisDutyLabel: ph.thisDutyLabel,
            ifNextLabel: ph.ifNextLabel,
            reason: ph.reason,
          }),
          { kind: 'generic' },
        )
        return
      }
      const event = eventsById.get(bar.eventId)
      if (!event) return
      if (event.type === 'free') {
        openInfoSheet(
          {
            badge: 'Free',
            title: event.title || 'Time free from duty',
            rule: 'Time free from duty: the member is not required to perform work for the operator, and the operator must not assign duty during this period. Free time is used to form local nights’ rests and single days free from duty under CAR 700.29.',
            reference: 'CAR 700.29; AC 700-047 §§4.31–4.32',
            whyApplies:
              event.ruleWhy ||
              `Scheduled free time from ${event.start.toLocaleString()} to ${event.end.toLocaleString()}.`,
            meta: [
              `Start · ${event.start.toLocaleString()}`,
              `End · ${event.end.toLocaleString()}`,
              event.freePurpose
                ? `Purpose · ${event.freePurpose}`
                : 'Purpose · manual',
            ],
            canDelete: true,
            eventId: event.id,
          },
          { kind: 'event', event },
        )
      } else if (event.type === 'reserve' || event.type === 'standby') {
        const factor = event.workFactor ?? defaultWorkFactor(event.type)
        openInfoSheet(
          {
            badge: event.type === 'reserve' ? 'RSV' : 'SBY',
            title:
              event.type === 'reserve' ? 'Reserve availability' : 'Standby',
            rule:
              event.type === 'reserve'
                ? 'Time as a flight crew member on reserve (availability with notice of more than one hour) counts at 33% toward the maximum number of hours of work.'
                : 'Time as a flight crew member on standby (at a designated location, notice of one hour or less) counts at 100% toward hours of work.',
            reference: 'CAR 700.29(3); AC 700-047 §4.34',
            whyApplies: `${event.type === 'reserve' ? 'Reserve' : 'Standby'} from ${event.start.toLocaleString()} to ${event.end.toLocaleString()}. Work credit factor ${factor} (CAR 700.29(3)).`,
            meta: [
              `Start · ${event.start.toLocaleString()}`,
              `End · ${event.end.toLocaleString()}`,
              `Work factor · ${factor}`,
            ],
            canDelete: true,
            eventId: event.id,
          },
          { kind: 'event', event },
        )
      } else {
        openInfoSheet(explainEvent(event, regulator, acclTZ, homeBaseTZ), {
          kind: 'event',
          event,
        })
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [eventsById, regulator, acclTZ, homeBaseTZ, events, timeFreeOption, report70029],
  )

  const handleMarkerClick = useCallback(
    (marker: DayMarkerSpec, e: ReactMouseEvent) => {
      e.stopPropagation()
      if (marker.sheet === 'sdf' && marker.sdfStartMs != null) {
        const display = report70029.displaySdfs.find(
          (d) => d.sdf.start.getTime() === marker.sdfStartMs,
        )
        if (display) {
          openInfoSheet(infoSheetFromSdf(display.sdf, display.reasons), {
            kind: 'sdf',
            sdf: display.sdf,
            reasons: display.reasons,
          })
        }
        return
      }
      const event = eventsById.get(marker.eventId)
      if (!event) return
      if (marker.sheet === 'rest' || event.type === 'rest') {
        openInfoSheet(explainEvent(event, regulator, acclTZ, homeBaseTZ), {
          kind: 'event',
          event,
          marker: marker.type,
        })
      } else {
        const explanation = explainMarker(
          marker.type,
          event,
          regulator,
          acclTZ,
          homeBaseTZ,
        )
        openInfoSheet(infoSheetFromMarker(explanation), {
          kind: 'event',
          event,
          marker: marker.type,
        })
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [eventsById, regulator, acclTZ, homeBaseTZ, report70029.displaySdfs, events, timeFreeOption],
  )

  const handleViolationClick = useCallback(
    (dayStartMs: number, e: ReactMouseEvent) => {
      e.stopPropagation()
      const dayStart = new Date(dayStartMs)
      const dayEnd = addCivilDaysInTimeZone(dayStart, calendarTZ, 1)
      const v700 = report70029.violations.find(
        (v) => v.windowEnd >= dayStart && v.windowEnd < dayEnd,
      )
      if (v700) {
        openInfoSheet(infoSheetFrom70029Violation(v700), {
          kind: 'violation',
          violation: v700,
        })
        return
      }
      const dayDate = dateByStartMs.get(dayStartMs) ?? dayStart
      const dayEvents = eventsOnLocalDay(events, dayDate, calendarTZ)
      const lnrMsg = summarizeViolatedLnrs(dayEvents)
      if (lnrMsg) alert(lnrMsg)
      else
        alert(
          'Violation: duty period overlaps a rest period, or rest requirements are not met.',
        )
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [calendarTZ, report70029.violations, events, dateByStartMs],
  )

  const getDayActions = (date: Date) => {
    const duties = findDutiesOnDate(events, date)
    if (duties.length > 0) {
      return [
        'Edit Duty',
        'Delete Duty',
        'Add Reserve',
        'Add Standby',
        'Add Free Time',
        'Suggest Free Time',
      ]
    }
    return [
      'Add Duty',
      'Add Reserve',
      'Add Standby',
      'Add Free Time',
      'Suggest Free Time',
    ]
  }

  const addAuxEvent = (type: 'reserve' | 'standby' | 'free', date: Date) => {
    const ymd = toDateInputValueInTZ(date, calendarTZ)
    const start = parseZonedDateTime(ymd, '08:00', calendarTZ)
    const end = parseZonedDateTime(
      ymd,
      type === 'free' ? '20:00' : '18:00',
      calendarTZ,
    )
    // Multi-day free default for free: 2 nights worth will be adjusted by user
    const endFree =
      type === 'free'
        ? new Date(start.getTime() + 40 * 60 * 60 * 1000)
        : end
    const ev: DutyEvent = {
      id: createId(`-${type}`),
      title:
        type === 'reserve'
          ? 'Reserve'
          : type === 'standby'
            ? 'Standby'
            : 'Time free from duty',
      start,
      end: type === 'free' ? endFree : end,
      type,
      acclTZ,
      workFactor: defaultWorkFactor(type),
      freePurpose: type === 'free' ? 'manual' : undefined,
      restRule: type === 'free' ? 'CAR 700.29' : undefined,
    }
    setEvents((prev) => [...prev, ev])
    setShowMenu(false)
    setSelectedDate(null)
  }

  const openFreeSuggestions = () => {
    const props = proposeFreeBlocks(
      events,
      acclTZ,
      timeFreeOption,
      selectedDate ? dayStartInCal(selectedDate) : null,
    )
    setFreeProposals(props)
    setShowFreeProposals(true)
    setShowMenu(false)
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

  const clearDaySelection = () => {
    setSelectedDate(null)
    setMenuDate(null)
    setShowMenu(false)
  }

  /**
   * Clicking empty chrome (not a day cell, panel, or control) closes the
   * day-details strip and clears selection.
   */
  const handleCalendarBackgroundClick = (
    e: ReactMouseEvent<HTMLElement>,
  ) => {
    const target = e.target as Element | null
    if (!target) return
    if (
      target.closest(
        [
          '.day',
          '.day-details',
          '.slide-menu',
          '.site-header',
          '.month-header',
          '.modal-content',
          '.nav-prev',
          '.nav-next',
          'button',
          'a',
          'input',
          'select',
          'textarea',
          'label',
        ].join(','),
      )
    ) {
      return
    }
    clearDaySelection()
  }

  /**
   * Move start date; shift end date by the same number of civil days so the
   * FDP duration (and overnight span) is preserved. Avoids an accidentally
   * multi-day “long duty” when only the start day was moved.
   */
  const applyStartDateChange = (newStartYmd: string) => {
    if (!newStartYmd) return
    const newStart = parseDateInputValue(newStartYmd)
    if (!newStart) return

    const prevStartYmd = addDutyDate
      ? toDateInputValueInTZ(addDutyDate, calendarTZ)
      : newStartYmd
    const delta = daysBetweenDateInputValues(prevStartYmd, newStartYmd)

    // Store as calendar-TZ midnight of that civil date
    const dayInst = startOfDayKeyInTimeZone(newStartYmd, calendarTZ)
    setAddDutyDate(dayInst)
    selectDate(dayInst)

    if (delta === 0) return

    if (endDate) {
      const shiftedEnd = addDaysToDateInputValue(endDate, delta)
      if (shiftedEnd !== endDate) {
        setEndDate(shiftedEnd)
        setEndDateShouldBlink(true)
        setEndDateBlinkKey((k) => k + 1)
      }
    } else {
      setEndDate(newStartYmd)
    }
  }

  const handleClick = (date: Date) => {
    if (showMenu) return
    if (showAddDuty) {
      applyStartDateChange(toDateInputValueInTZ(date, calendarTZ))
    } else if (isEdit) {
      const duty = findDutyOnDate(events, date)
      if (duty) {
        selectDate(date)
        setEditEvent(duty)
        const sTz = duty.startTZ || duty.acclTZ || acclTZ
        const eTz = duty.endTZ || duty.acclTZ || acclTZ
        setAddDutyDate(startOfDayInTimeZone(duty.start, calendarTZ))
        setStartTime(formatHHmmInTZ(duty.start, sTz))
        setEndDate(toDateInputValueInTZ(duty.end, eTz))
        setEndTime(formatHHmmInTZ(duty.end, eTz))
        setModalAcclTZ(duty.acclTZ || acclTZ)
        setModalStartTZ(duty.startTZ || duty.acclTZ || acclTZ)
        setModalEndTZ(duty.endTZ || duty.acclTZ || acclTZ)
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
    setEndDate(toDateInputValueInTZ(date, calendarTZ))
    setRestType('12h')
    setIsEdit(false)
    setEditEvent(null)
    setValidationMessage('')
    setMaxDutyResult('')
    setEndDateShouldBlink(false)
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
    const sTz = event.startTZ || event.acclTZ || acclTZ
    const eTz = event.endTZ || event.acclTZ || acclTZ
    setAddDutyDate(startOfDayInTimeZone(event.start, calendarTZ))
    setStartTime(formatHHmmInTZ(event.start, sTz))
    setEndDate(toDateInputValueInTZ(event.end, eTz))
    setEndTime(formatHHmmInTZ(event.end, eTz))
    setModalAcclTZ(event.acclTZ || acclTZ)
    setModalStartTZ(event.startTZ || event.acclTZ || acclTZ)
    setModalEndTZ(event.endTZ || event.acclTZ || acclTZ)
    const restEvent = events.find((e) => e.id === restIdForDuty(event.id))
    if (restEvent) {
      const restDuration = restEvent.requiredRestHours
        ?? (restEvent.end.getTime() - restEvent.start.getTime()) /
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
    setEvents((prev) =>
      recomputeAfterDutyDelete(
        removeDutyAndRelated(prev, event),
        regulator,
        homeBaseTZ,
        acclTZ,
      ),
    )
    setSelectedDate(null)
  }

  const resetDutyForm = () => {
    setShowAddDuty(false)
    setStartTime('')
    setEndTime('')
    setEndDate('')
    setModalAcclTZ('')
    setModalStartTZ('')
    setModalEndTZ('')
    setRestType('12h')
    setIsEdit(false)
    setEditEvent(null)
    setValidationMessage('')
    setMaxDutyResult('')
    setEndDateShouldBlink(false)
  }

  const handleSubmitDuty = () => {
    setValidationMessage('')
    if (!addDutyDate || !startTime || !endTime || !endDate) {
      setValidationMessage(
        'Please fill in all required fields: Start Time, End Date, and End Time',
      )
      return
    }

    const dutyAccl = modalAcclTZ || acclTZ
    const dutyStartLoc = modalStartTZ || dutyAccl
    const dutyEndLoc = modalEndTZ || dutyAccl
    // Date fields + times are wall clock in start/end location TZ (fallback accl / global)
    const startYmd = toDateInputValueInTZ(addDutyDate, calendarTZ)
    const start = parseZonedDateTime(startYmd, startTime, dutyStartLoc)
    const end = parseZonedDateTime(endDate, endTime, dutyEndLoc)

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      setValidationMessage('Invalid date/time format. Please check your inputs.')
      return
    }
    if (start >= end) {
      setValidationMessage(
        'End time must be after start time (check times and location time zones).',
      )
      return
    }

    const duration = (end.getTime() - start.getTime()) / (1000 * 60 * 60)
    const startHour = getHourInTZ(start, dutyAccl)
    const maxDuty = getMaxFdpHours(regulator, startHour, sectors, avgSectorTime)

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
        `Total hours of work in 7 days would exceed ${MAX_WEEKLY_DUTY_HOURS} hours for ${regulator === 'TC' ? 'CAR 700.29' : regulator}`,
      )
      return
    }

    // Preview 700.29 Option C on the schedule that would result after this save
    if (regulator === 'TC') {
      const previewDuty: DutyEvent = {
        id: isEdit && editEvent ? editEvent.id : 'preview-duty',
        title: 'Duty Period',
        start,
        end,
        type: 'duty',
        acclTZ: dutyAccl,
        startTZ: dutyStartLoc,
        endTZ: dutyEndLoc,
      }
      const base = events.filter(
        (e) =>
          e.type === 'duty' &&
          !(isEdit && editEvent && e.id === editEvent.id),
      )
      const previewReport = evaluate70029(
        [...base, previewDuty],
        dutyAccl,
        'TC',
        timeFreeOption,
      )
      if (hasHard70029HourViolation(previewReport)) {
        const hard = previewReport.violations.find((v) =>
          hasHard70029HourViolation({
            ...previewReport,
            violations: [v],
          }),
        )
        setValidationMessage(
          hard?.detail ||
            'Hours of work or Option D conditions would breach CAR 700.29.',
        )
        return
      }
      // Soft: missing SDF — allow save but alert + offer free-time suggest
      if (hasSoft70029SdfWarning(previewReport)) {
        const soft = previewReport.violations
          .filter(
            (v) =>
              v.code === 'missing_sdf_in_168' ||
              v.code === 'missing_sdf_count_in_672',
          )
          .map((v) => v.detail)
          .join('\n\n')
        alert(
          `Time free from duty warning (CAR 700.29):\n\n${soft}\n\nUse “Suggest Free Time” from the day menu to auto-schedule days free from duty.`,
        )
      }
    }

    if (isEdit && editEvent) {
      const updatedDuty: DutyEvent = {
        ...editEvent,
        start,
        end,
        acclTZ: dutyAccl,
        startTZ: dutyStartLoc,
        endTZ: dutyEndLoc,
        title: editEvent.title || 'Duty Period',
        type: 'duty',
      }

      setEvents((prev) => {
        const without = prev.filter(
          (e) => e.id !== editEvent.id && e.id !== restIdForDuty(editEvent.id),
        )
        const next = recomputeAfterDutyChange(
          [...without, updatedDuty],
          updatedDuty,
          regulator,
          homeBaseTZ,
          dutyAccl,
          restType,
        )
        const lnrMsg = summarizeViolatedLnrs(next)
        if (lnrMsg) alert(lnrMsg)
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
      startTZ: dutyStartLoc,
      endTZ: dutyEndLoc,
      violated: overlapsRest,
    }

    setEvents((prev) => {
      const next = recomputeAfterDutyChange(
        [...prev, newEvent],
        newEvent,
        regulator,
        homeBaseTZ,
        dutyAccl,
        restType,
      )
      const lnrMsg = summarizeViolatedLnrs(next)
      if (lnrMsg) alert(lnrMsg)
      return next
    })

    if (restType === '10+travel') {
      const result = scheduleTravelRestReminders(end)
      if (!result.ok) {
        setIsEdit(true)
        setEditEvent(newEvent)
        setStartTime(
          formatHHmmInTZ(
            newEvent.start,
            newEvent.startTZ || newEvent.acclTZ || acclTZ,
          ),
        )
        setEndDate(
          toDateInputValueInTZ(
            newEvent.end,
            newEvent.endTZ || newEvent.acclTZ || acclTZ,
          ),
        )
        setEndTime(
          formatHHmmInTZ(
            newEvent.end,
            newEvent.endTZ || newEvent.acclTZ || acclTZ,
          ),
        )
        setModalAcclTZ(newEvent.acclTZ || acclTZ)
        setModalStartTZ(newEvent.startTZ || acclTZ)
        setModalEndTZ(newEvent.endTZ || acclTZ)
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


  const isInRange = (date: Date) => {
    if (!showAddDuty || !addDutyDate) return false
    const start = dayStartInCal(addDutyDate)
    const end = endDate
      ? startOfDayKeyInTimeZone(endDate, calendarTZ)
      : start
    const d = dayStartInCal(date)
    return d.getTime() >= start.getTime() && d.getTime() <= end.getTime()
  }

  return (
    <>
      <div
        className={`calendar ${darkMode ? 'dark' : 'light'} ${animating ? 'animating' : ''}`}
        onClick={handleCalendarBackgroundClick}
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
                <IconSettings />
              </button>
              <ThemeToggle />
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
                {new Intl.DateTimeFormat('en-US', {
                  month: 'long',
                  year: 'numeric',
                  timeZone: calendarTZ,
                }).format(currentDate)}
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
            <p className="calendar-tz-badge" title="Calendar time reference (Settings)">
              {calendarTimeRef === 'zulu'
                ? 'Zulu (UTC)'
                : calendarTimeRef === 'home'
                  ? `Home · ${calendarTZ.replace(/_/g, ' ')}`
                  : calendarTimeRef === 'custom'
                    ? calendarTZ.replace(/_/g, ' ')
                    : `Local · ${calendarTZ.replace(/_/g, ' ')}`}
            </p>
          </div>
          <div className="calendar-container">
            <div
              className="calendar-grid"
              style={
                {
                  ['--day-min-h']: `${sharedDayMinRem}rem`,
                } as CSSProperties
              }
            >
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
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
                    onDayClick={handleDayClickMs}
                    onDayPressStart={handleDayPressStartMs}
                    onDayPressEnd={handleDayPressEnd}
                    onBarClick={handleBarClick}
                    onMarkerClick={handleMarkerClick}
                    onViolationClick={handleViolationClick}
                  />
                )
              })}
            </div>
          </div>
          {selectedDate && (
            <div className="day-details" role="region" aria-label="Day details">
              <div className="day-details-header">
                <h3>{selectedDate.toDateString()}</h3>
                <button
                  type="button"
                  className="day-details-close"
                  aria-label="Close day details"
                  onClick={() => clearDaySelection()}
                >
                  <IconClose size={18} />
                </button>
              </div>
              <p className="day-details-events">
                <span className="day-details-events-label">Events</span>
                {events
                  .filter(
                    (e) =>
                      e.start.toDateString() === selectedDate.toDateString() ||
                      (e.start < selectedDate &&
                        e.end > dayStartInCal(selectedDate)),
                  )
                  .map((e) => e.title)
                  .join(', ') || 'None'}
              </p>
              <div className="day-details-actions">
                {getDayActions(selectedDate).map((action) => {
                  const isDelete = action === 'Delete Duty'
                  const isPrimary =
                    action === 'Add Duty' || action === 'Edit Duty'
                  return (
                    <button
                      type="button"
                      key={action}
                      className={
                        isDelete
                          ? 'day-details-btn day-details-btn-danger'
                          : isPrimary
                            ? 'day-details-btn day-details-btn-primary'
                            : 'day-details-btn day-details-btn-secondary'
                      }
                      onClick={() => {
                        if (action === 'Add Duty') handleAddDuty()
                        else if (action === 'Edit Duty') handleEditDuty()
                        else if (action === 'Delete Duty') handleDeleteDuty()
                        else if (action === 'Add Reserve' && selectedDate)
                          addAuxEvent('reserve', selectedDate)
                        else if (action === 'Add Standby' && selectedDate)
                          addAuxEvent('standby', selectedDate)
                        else if (action === 'Add Free Time' && selectedDate)
                          addAuxEvent('free', selectedDate)
                        else if (action === 'Suggest Free Time')
                          openFreeSuggestions()
                      }}
                    >
                      {action}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {showMenu && menuDate && (
            <div
              className="modal"
              onClick={() => {
                clearDaySelection()
              }}
            >
              <div
                className="modal-content day-menu-modal"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-label={`Options for ${menuDate.toDateString()}`}
              >
                <div className="day-details-header">
                  <h3>{menuDate.toDateString()}</h3>
                  <button
                    type="button"
                    className="day-details-close"
                    aria-label="Close"
                    onClick={() => clearDaySelection()}
                  >
                    <IconClose size={18} />
                  </button>
                </div>
                <div className="day-details-actions">
                  <button
                    type="button"
                    className="day-details-btn day-details-btn-primary"
                    onClick={handleAddDuty}
                  >
                    Add Duty
                  </button>
                  {menuDate && (
                    <>
                      <button
                        type="button"
                        className="day-details-btn day-details-btn-secondary"
                        onClick={() => addAuxEvent('reserve', menuDate)}
                      >
                        Add Reserve
                      </button>
                      <button
                        type="button"
                        className="day-details-btn day-details-btn-secondary"
                        onClick={() => addAuxEvent('standby', menuDate)}
                      >
                        Add Standby
                      </button>
                      <button
                        type="button"
                        className="day-details-btn day-details-btn-secondary"
                        onClick={() => addAuxEvent('free', menuDate)}
                      >
                        Add Free Time
                      </button>
                      <button
                        type="button"
                        className="day-details-btn day-details-btn-secondary"
                        onClick={openFreeSuggestions}
                      >
                        Suggest Free Time
                      </button>
                    </>
                  )}
                </div>
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
                Start Date:
                <input
                  type="date"
                  value={toDateInputValueInTZ(addDutyDate, calendarTZ)}
                  onChange={(e) => applyStartDateChange(e.target.value)}
                  aria-label="Start date"
                />
              </label>
              <label>
                Start Time (report, start location TZ):
                <FreeTimeInput
                  value={startTime}
                  onChange={setStartTime}
                  timeFormat={timeFormat}
                  aria-label="Start time"
                />
                {startTime && (
                  <span className="time-display">
                    Wall ({(modalStartTZ || modalAcclTZ || acclTZ).replace(/_/g, ' ')}
                    ): {formatTimeDisplay(startTime, timeFormat)} | Zulu:{' '}
                    {getZuluTimeDisplay(
                      startTime,
                      addDutyDate,
                      timeFormat,
                      modalStartTZ || modalAcclTZ || acclTZ,
                    )}
                  </span>
                )}
              </label>
              <label className="end-date-label">
                <span className="end-date-label-row">
                  End Date:
                  {isOvernightDuty && (
                    <span className="overnight-duty-badge" aria-live="polite">
                      (overnight duty)
                    </span>
                  )}
                </span>
                <input
                  key={endDateBlinkKey}
                  type="date"
                  value={endDate}
                  onChange={(e) => {
                    setEndDate(e.target.value)
                    setEndDateShouldBlink(false)
                  }}
                  className={
                    endDateShouldBlink ? 'end-date-input end-date-blink' : 'end-date-input'
                  }
                  aria-describedby={
                    isOvernightDuty ? 'overnight-duty-hint' : undefined
                  }
                />
                {isOvernightDuty && (
                  <span id="overnight-duty-hint" className="sr-only">
                    Overnight duty: end date is after start date
                  </span>
                )}
              </label>
              <label>
                End Time (release, end location TZ):
                <FreeTimeInput
                  value={endTime}
                  onChange={setEndTime}
                  timeFormat={timeFormat}
                  aria-label="End time"
                />
                {endTime && endDate && (
                  <span className="time-display">
                    Wall ({(modalEndTZ || modalAcclTZ || acclTZ).replace(/_/g, ' ')}
                    ): {formatTimeDisplay(endTime, timeFormat)} | Zulu:{' '}
                    {getZuluTimeDisplay(
                      endTime,
                      startOfDayKeyInTimeZone(endDate, calendarTZ),
                      timeFormat,
                      modalEndTZ || modalAcclTZ || acclTZ,
                    )}
                  </span>
                )}
                {longDutyPeriodWarning && (
                  <span
                    className="long-duty-warning"
                    role="status"
                    aria-live="polite"
                  >
                    Long duty period, check time and date
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
                Start location time zone (FDP report):
                <TimeZoneSelector
                  value={modalStartTZ}
                  onChange={setModalStartTZ}
                  placeholder="Defaults to acclimatization TZ"
                  allowEmpty={true}
                />
              </label>
              <label>
                End location time zone (FDP release):
                <TimeZoneSelector
                  value={modalEndTZ}
                  onChange={setModalEndTZ}
                  placeholder="Defaults to acclimatization TZ"
                  allowEmpty={true}
                />
              </label>
              <p className="form-hint">
                Home base: {homeBaseTZ.replace(/_/g, ' ')}. Used for CAR 700.42
                time-zone rest (set in Settings → Home Base).
              </p>
              <label>
                Rest Type (base / CAR 700.40):
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
                  const sTz = modalStartTZ || modalAcclTZ || acclTZ
                  const startYmd = toDateInputValueInTZ(addDutyDate, calendarTZ)
                  const start = parseZonedDateTime(startYmd, startTime, sTz)
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

          {showSettings && (
            <SettingsPanel
              onClose={() => setShowSettings(false)}
              deleteMonthLabel={currentDate.toLocaleDateString('en-US', {
                month: 'long',
                year: 'numeric',
              })}
              deletedEventCount={deletedEventCount}
              onDeleteEvents={(scope) => {
                // Snapshot current events once (not inside setState — avoids Strict Mode double I/O)
                const prev = events
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
                const predicate =
                  scope === 'all'
                    ? () => true
                    : (e: DutyEvent) =>
                        e.start >= monthStart && e.start < monthEnd

                const { kept, removed } = partitionEvents(prev, predicate)
                if (removed.length === 0) return

                const nextDeleted = mergeIntoDeletedBin(
                  loadDeletedEvents(),
                  removed,
                )
                saveDeletedEvents(nextDeleted)
                setEvents(kept)
                setDeletedEventCount(nextDeleted.length)
              }}
              onRestoreDeletedEvents={() => {
                // Read bin once, then update state purely — never clear storage inside setState
                const bin = loadDeletedEvents()
                if (bin.length === 0) return

                setEvents((prev) => mergeRestoredEvents(prev, bin))
                clearDeletedEvents()
                setDeletedEventCount(0)
              }}
              onPurgeDeletedEvents={() => {
                clearDeletedEvents()
                setDeletedEventCount(0)
              }}
            />
          )}
        </div>
      </div>
      {showFreeProposals && (
        <div
          className="info-sheet-overlay"
          onClick={() => setShowFreeProposals(false)}
          role="presentation"
        >
          <div
            className="info-sheet free-proposals-sheet"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-labelledby="free-proposals-title"
          >
            <header className="info-sheet-header">
              <div className="info-sheet-heading">
                <span className="info-sheet-badge">Free</span>
                <div className="info-sheet-title-block">
                  <h2 id="free-proposals-title" className="info-sheet-title">
                    Suggest free time (CAR 700.29)
                  </h2>
                </div>
              </div>
              <button
                type="button"
                className="info-sheet-close"
                aria-label="Close"
                onClick={() => setShowFreeProposals(false)}
              >
                <IconClose size={18} />
              </button>
            </header>
            <div className="info-sheet-body">
              {freeProposals.length === 0 ? (
                <p className="info-sheet-section-text">
                  No automatic free-time block could be placed without
                  overlapping existing duty, reserve, or standby. Add free time
                  manually or free up the schedule.
                </p>
              ) : (
                freeProposals.map((p) => (
                  <section key={p.id} className="info-sheet-section">
                    <div className="info-sheet-section-label">
                      {p.purpose === 'five_lnr_block'
                        ? 'Option D · 5× LNR'
                        : 'Option C · SDF'}
                    </div>
                    <p className="info-sheet-section-text">
                      {p.start.toLocaleString()} → {p.end.toLocaleString()}
                    </p>
                    <p className="info-sheet-section-text">{p.reason}</p>
                    <button
                      type="button"
                      className="info-sheet-btn info-sheet-btn-primary"
                      style={{ marginTop: '0.5rem' }}
                      onClick={() => {
                        const free = freeEventFromProposal(p, acclTZ)
                        setEvents((prev) => [...prev, free])
                        setShowFreeProposals(false)
                        setFreeProposals([])
                      }}
                    >
                      Apply this free block
                    </button>
                  </section>
                ))
              )}
            </div>
            <footer className="info-sheet-footer">
              <button
                type="button"
                className="info-sheet-btn info-sheet-btn-primary"
                onClick={() => setShowFreeProposals(false)}
              >
                Close
              </button>
            </footer>
          </div>
        </div>
      )}

      {infoSheet && (
        <div
          className="info-sheet-overlay"
          onClick={() => setInfoSheet(null)}
          role="presentation"
        >
          <div
            className={`info-sheet${infoSheet.violated ? ' info-sheet--alert' : ''}`}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="info-sheet-title"
          >
            <header className="info-sheet-header">
              <div className="info-sheet-heading">
                <span className="info-sheet-badge" aria-hidden="true">
                  {infoSheet.badge}
                </span>
                <div className="info-sheet-title-block">
                  <h2 id="info-sheet-title" className="info-sheet-title">
                    {infoSheet.title}
                  </h2>
                  {infoSheet.violated && (
                    <span className="info-sheet-status">Not met</span>
                  )}
                </div>
              </div>
              <button
                type="button"
                className="info-sheet-close"
                aria-label="Close"
                onClick={() => setInfoSheet(null)}
              >
                <IconClose size={18} />
              </button>
            </header>

            {infoSheet.meta && infoSheet.meta.length > 0 && (
              <ul className="info-sheet-meta">
                {infoSheet.meta.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}

            <div className="info-sheet-body">
              <section className="info-sheet-section">
                <div className="info-sheet-section-label">
                  <span className="info-sheet-step">1</span>
                  Rule
                </div>
                <p className="info-sheet-section-text">{infoSheet.rule}</p>
              </section>

              <section className="info-sheet-section">
                <div className="info-sheet-section-label">
                  <span className="info-sheet-step">2</span>
                  Legal reference
                </div>
                <p className="info-sheet-section-text info-sheet-reference">
                  {infoSheet.reference}
                </p>
              </section>

              <section className="info-sheet-section">
                <div className="info-sheet-section-label">
                  <span className="info-sheet-step">3</span>
                  Why it applies here
                </div>
                <p className="info-sheet-section-text">{infoSheet.whyApplies}</p>
              </section>

              {infoSheet.debugContext && (
                <section className="info-sheet-section info-sheet-section-debug">
                  <div className="info-sheet-section-label">
                    <span className="info-sheet-step">4</span>
                    Debug for AI
                    <button
                      type="button"
                      className="info-sheet-copy-btn"
                      onClick={() => void copyDebugContext()}
                    >
                      {debugCopied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <p className="info-sheet-section-hint">
                    Full schedule context for pasting into a coding chat
                    (times, ELN, WOCL, rest rules, 700.29).
                  </p>
                  <pre className="info-sheet-debug">{infoSheet.debugContext}</pre>
                </section>
              )}
            </div>

            <footer className="info-sheet-footer">
              {infoSheet.canDelete && infoSheet.eventId && (
                <button
                  type="button"
                  className="info-sheet-btn info-sheet-btn-danger"
                  onClick={() => {
                    if (
                      confirm(
                        'Delete this rest event from the calendar?',
                      )
                    ) {
                      const id = infoSheet.eventId
                      setEvents((prev) => prev.filter((e) => e.id !== id))
                      setInfoSheet(null)
                    }
                  }}
                >
                  Delete
                </button>
              )}
              {infoSheet.debugContext && (
                <button
                  type="button"
                  className="info-sheet-btn info-sheet-btn-secondary"
                  onClick={() => void copyDebugContext()}
                >
                  {debugCopied ? 'Copied' : 'Copy debug'}
                </button>
              )}
              <button
                type="button"
                className="info-sheet-btn info-sheet-btn-primary"
                onClick={() => setInfoSheet(null)}
              >
                Close
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  )
}

export default Calendar
