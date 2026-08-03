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
import type { DutyEvent, RestType } from './domain/types'
import {
  defaultWorkFactor,
  defaultWorkFactorForKind,
  eventKindToDutyType,
  inferEventKind,
  isNonFlightDutyKind,
  MAX_WEEKLY_DUTY_HOURS,
  titleForEventKind,
} from './domain/types'
import {
  applyTenPlusTravelIfRestCompressed,
  createId,
  eventsOnLocalDay,
  findDutyOnDate,
  findEditableEventOnDate,
  findEditableEventsOnDate,
  previewTenPlusTravelCompression,
  recomputeAfterDutyChange,
  recomputeAfterDutyDelete,
  removeDutyAndRelated,
  restIdForDuty,
  summarizeViolatedLnrs,
  type TenPlusTravelCompression,
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
  wouldExceedWeeklyLimit,
} from './domain/regulations'
import { CalendarDayCell } from './CalendarDayCell'
import DutyForm, { type EventFormSubmitPayload } from './DutyForm'
import {
  evaluate70029,
  hasHard70029HourViolation,
  hasSoft70029SdfWarning,
} from './domain/rest-70029'
import {
  addCivilDaysInTimeZone,
  getZonedTimeParts,
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
import SettingsPanel from './shared/ui/SettingsPanel'
import ThemeToggle from './shared/ui/ThemeToggle'
import { IconClose, IconSettings } from './shared/ui/icons'
import CalendarImportPanel from './features/import/CalendarImportPanel'

function Calendar() {
  const {
    darkMode,
    timeFormat,
    regulator,
    acclTZ,
    referenceTZ,
    timeFreeOption,
    calendarTimeRef,
    resolvedCalendarTZ,
    dutyTimingBuffers,
    weekStartDay,
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
  const barPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Suppress the synthetic click that follows a successful long-press. */
  const suppressClickRef = useRef(false)
  /**
   * Ignore modal/info backdrop closes until this timestamp — prevents the
   * finger-up/click that ends a long-press from immediately dismissing the menu.
   */
  const ignoreBackdropUntilRef = useRef(0)
  const skipNextPersist = useRef(true)
  const [showMenu, setShowMenu] = useState(false)
  const [menuDate, setMenuDate] = useState<Date | null>(null)
  /** Event targeted by long-press on a bar (edit/delete menu). */
  const [actionEvent, setActionEvent] = useState<DutyEvent | null>(null)
  const [showAddDuty, setShowAddDuty] = useState(false)
  const [addDutyDate, setAddDutyDate] = useState<Date | null>(null)
  const [restType, setRestType] = useState<RestType>('12h')
  const [isEdit, setIsEdit] = useState(false)
  const [editEvent, setEditEvent] = useState<DutyEvent | null>(null)
  const [animating, setAnimating] = useState(false)
  const [infoSheet, setInfoSheet] = useState<InfoSheetContent | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showCalendarImport, setShowCalendarImport] = useState(false)
  const [validationMessage, setValidationMessage] = useState('')
  const [tenPlusNotice, setTenPlusNotice] =
    useState<TenPlusTravelCompression | null>(null)

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
      if (barPressTimerRef.current) clearTimeout(barPressTimerRef.current)
    }
  }, [])

  const armLongPressGuard = () => {
    suppressClickRef.current = true
    // Cover pointerup + synthetic click after the hold
    ignoreBackdropUntilRef.current = Date.now() + 600
  }

  const consumeSuppressedClick = (): boolean => {
    if (!suppressClickRef.current) return false
    suppressClickRef.current = false
    return true
  }

  const shouldIgnoreBackdropClose = (): boolean =>
    Date.now() < ignoreBackdropUntilRef.current

  const now = useMemo(() => new Date(), [])
  const minMonth = useMemo(
    () => new Date(now.getFullYear(), now.getMonth() - 13, 1),
    [now],
  )
  const maxMonth = useMemo(
    () => new Date(now.getFullYear(), now.getMonth() + 3, 1),
    [now],
  )

  /**
   * Days for the month grid: leading/trailing other-month cells as needed,
   * only as many full weeks as the month spans (4–6), not a fixed 6×7.
   */
  const getCalendarDays = (date: Date) => {
    const p = getZonedTimeParts(date, calendarTZ)
    const firstOfMonth = zonedWallTime(calendarTZ, p.year, p.month, 1, 0, 0)
    // Last civil day of this month in calendarTZ
    const nextMonth = p.month === 12
      ? zonedWallTime(calendarTZ, p.year + 1, 1, 1, 0, 0)
      : zonedWallTime(calendarTZ, p.year, p.month + 1, 1, 0, 0)
    const lastOfMonth = addCivilDaysInTimeZone(nextMonth, calendarTZ, -1)
    const daysInMonth = getZonedTimeParts(lastOfMonth, calendarTZ).day

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
    // JS-style: 0 = Sunday … 6 = Saturday
    const sundayIndex = wdMap[wdLabel] ?? 0
    // Offset from the configured week start to the 1st of the month
    const firstDow =
      weekStartDay === 'monday'
        ? (sundayIndex + 6) % 7 // Mon=0 … Sun=6
        : sundayIndex
    const gridStart = addCivilDaysInTimeZone(firstOfMonth, calendarTZ, -firstDow)
    // Full weeks only: leading pads + month days, rounded up to 7
    const weekRows = Math.ceil((firstDow + daysInMonth) / 7)
    const cellCount = weekRows * 7
    const days: Date[] = []
    let cur = gridStart
    for (let i = 0; i < cellCount; i++) {
      days.push(cur)
      cur = addCivilDaysInTimeZone(cur, calendarTZ, 1)
    }
    return days
  }

  const days = useMemo(
    () => getCalendarDays(currentDate),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- getCalendarDays closes over calendarTZ + weekStartDay
    [currentDate, calendarTZ, weekStartDay],
  )

  /** 4–6 depending on month layout (no empty trailing week). */
  const weekRows = Math.ceil(days.length / 7) || 5

  const weekDayLabels =
    weekStartDay === 'monday'
      ? (['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const)
      : (['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const)

  // Layout once when schedule/view changes — NOT on selection clicks.
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
      if (consumeSuppressedClick()) return
      const d = dateByStartMs.get(dayStartMs)
      if (d) handleClick(d)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dateByStartMs, showMenu, showAddDuty, isEdit, events, calendarTZ, selectedDate],
  )

  const handleDayPressStartMs = useCallback(
    (dayStartMs: number) => {
      // Don't start day long-press while a bar long-press may be active
      if (barPressTimerRef.current) return
      const d = dateByStartMs.get(dayStartMs)
      if (d) handleMouseDown(d)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dateByStartMs],
  )

  const handleDayPressEnd = useCallback(() => {
    handleMouseUp()
  }, [])

  const openEventActionMenu = useCallback(
    (event: DutyEvent) => {
      const day = startOfDayInTimeZone(event.start, calendarTZ)
      setInfoSheet(null)
      setActionEvent(event)
      selectDate(day)
      setShowMenu(true)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [calendarTZ],
  )

  const handleBarPressStart = useCallback(
    (bar: DayBarSpec) => {
      // Cancel any day long-press
      if (pressTimerRef.current) {
        clearTimeout(pressTimerRef.current)
        pressTimerRef.current = null
      }
      if (bar.kind === 'phantom') return
      const event = eventsById.get(bar.eventId)
      if (!event) return
      // Edit/delete only for user-editable work events
      if (
        event.type !== 'duty' &&
        event.type !== 'reserve' &&
        event.type !== 'standby'
      ) {
        return
      }
      if (barPressTimerRef.current) clearTimeout(barPressTimerRef.current)
      barPressTimerRef.current = setTimeout(() => {
        armLongPressGuard()
        openEventActionMenu(event)
        barPressTimerRef.current = null
      }, 500)
    },
    [eventsById, openEventActionMenu],
  )

  const handleBarPressEnd = useCallback(() => {
    if (barPressTimerRef.current) {
      clearTimeout(barPressTimerRef.current)
      barPressTimerRef.current = null
    }
  }, [])

  const handleBarClick = useCallback(
    (bar: DayBarSpec, e: ReactMouseEvent) => {
      e.stopPropagation()
      // Long-press already opened edit/delete — ignore the trailing click
      if (consumeSuppressedClick()) return
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
        const kind = inferEventKind(event)
        const factor = event.workFactor ?? defaultWorkFactor(event.type)
        const kindTitle = titleForEventKind(kind)
        openInfoSheet(
          {
            badge: event.type === 'reserve' ? 'RSV' : 'SBY',
            title: kindTitle,
            rule:
              event.type === 'reserve'
                ? 'Time as a flight crew member on reserve (availability with notice of more than one hour) counts at 33% toward the maximum number of hours of work.'
                : 'Time as a flight crew member on standby (at a designated location, notice of one hour or less) counts at 100% toward hours of work.',
            reference: 'CAR 700.29(3); AC 700-047 §4.34',
            whyApplies: `${kindTitle} from ${event.start.toLocaleString()} to ${event.end.toLocaleString()}. Work credit factor ${factor} (CAR 700.29(3)).`,
            meta: [
              `Start · ${event.start.toLocaleString()}`,
              `End · ${event.end.toLocaleString()}`,
              `Work factor · ${factor}`,
              event.locationIcao
                ? `Location · ${event.locationIcao}`
                : undefined,
            ].filter(Boolean) as string[],
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
    const editable = findEditableEventsOnDate(events, date)
    if (editable.length > 0) {
      return ['Edit Event', 'Delete Event', 'Add Event', 'Suggest Free Time']
    }
    return ['Add Event', 'Suggest Free Time']
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
      armLongPressGuard()
      setActionEvent(null)
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
    setActionEvent(null)
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

  const handleClick = (date: Date) => {
    if (consumeSuppressedClick()) return
    if (showMenu) return
    if (showAddDuty) {
      const ymd = toDateInputValueInTZ(date, calendarTZ)
      const dayInst = startOfDayKeyInTimeZone(ymd, calendarTZ)
      setAddDutyDate(dayInst)
      selectDate(dayInst)
    } else if (isEdit) {
      const duty = findDutyOnDate(events, date)
      if (duty) {
        selectDate(date)
        setEditEvent(duty)
        setAddDutyDate(startOfDayInTimeZone(duty.start, calendarTZ))
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
    setRestType('12h')
    setIsEdit(false)
    setEditEvent(null)
    setValidationMessage('')
  }

  const handleAddDuty = () => {
    // Prefer last clicked/selected date; fall back to long-press menu date only if needed
    openAddDutyFor(selectedDate ?? menuDate)
  }

  const resolveActionEvent = (): DutyEvent | null => {
    if (actionEvent) {
      // Prefer live copy from schedule (in case state is stale)
      return events.find((e) => e.id === actionEvent.id) ?? actionEvent
    }
    if (!selectedDate) return null
    return (
      findEditableEventOnDate(events, selectedDate) ??
      findDutyOnDate(events, selectedDate) ??
      null
    )
  }

  const handleEditDuty = () => {
    const event = resolveActionEvent()
    if (!event) return

    setIsEdit(true)
    setEditEvent(event)
    setAddDutyDate(startOfDayInTimeZone(event.start, calendarTZ))
    const restEvent = events.find((e) => e.id === restIdForDuty(event.id))
    if (restEvent) {
      const restDuration = restEvent.requiredRestHours
        ?? (restEvent.end.getTime() - restEvent.start.getTime()) /
          (1000 * 60 * 60)
      setRestType(
        restEvent.baseRestType === '10+travel' || restDuration === 10
          ? '10+travel'
          : '12h',
      )
    } else {
      setRestType('12h')
    }
    setShowAddDuty(true)
    setShowMenu(false)
    setActionEvent(null)
    setValidationMessage('')
  }

  const handleDeleteDuty = () => {
    const event = resolveActionEvent()
    if (!event) return
    if (event.type === 'duty') {
      setEvents((prev) =>
        recomputeAfterDutyDelete(
          removeDutyAndRelated(prev, event),
          regulator,
          homeBaseTZ,
          acclTZ,
        ),
      )
    } else {
      setEvents((prev) => prev.filter((e) => e.id !== event.id))
    }
    clearDaySelection()
  }

  const resetDutyForm = () => {
    setShowAddDuty(false)
    setAddDutyDate(null)
    setRestType('12h')
    setIsEdit(false)
    setEditEvent(null)
    setValidationMessage('')
  }

  const run70029Preview = (
    previewDuties: DutyEvent[],
    dutyAccl: string,
  ): boolean => {
    if (regulator !== 'TC') return true
    const previewReport = evaluate70029(
      previewDuties,
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
      return false
    }
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
    return true
  }

  const saveDutyEvent = (
    dutyEvent: DutyEvent,
    rt: RestType,
    baseEvents: DutyEvent[],
  ) => {
    setEvents(() => {
      let next = recomputeAfterDutyChange(
        baseEvents,
        dutyEvent,
        regulator,
        homeBaseTZ,
        dutyEvent.acclTZ || acclTZ,
        rt,
      )
      const compressed = applyTenPlusTravelIfRestCompressed(
        next,
        dutyEvent.id,
        regulator,
        homeBaseTZ,
        dutyEvent.acclTZ || acclTZ,
      )
      next = compressed.events
      if (compressed.notice) {
        // Defer modal to after state commit
        queueMicrotask(() => {
          setTenPlusNotice(compressed.notice)
          // 10+travel rules: offer release / hotel-timing reminders for prior FDP
          scheduleTravelRestReminders(compressed.notice!.previousRelease)
        })
      }
      const lnrMsg = summarizeViolatedLnrs(next)
      if (lnrMsg) alert(lnrMsg)
      return next
    })
  }

  const acknowledgeTenPlusNotice = () => {
    setTenPlusNotice(null)
  }

  /**
   * When a new/edited duty collides with an existing rest bar, try CAR 700.40
   * 10+travel on the previous FDP first. If that is legal, skip the confirm and
   * do not flag the duty as violated — saveDutyEvent will apply the conversion
   * and show the Got it notice.
   */
  const resolveRestOverlapForDuty = (
    duty: DutyEvent,
    schedule: DutyEvent[],
    restTypeForDuty: RestType,
    dutyAccl: string,
  ): { abort: boolean; markViolated: boolean } => {
    const overlapsRest = schedule.some(
      (e) =>
        e.type === 'rest' &&
        eventsOverlap(duty.start, duty.end, e.start, e.end),
    )
    if (!overlapsRest) {
      return { abort: false, markViolated: false }
    }

    const tenPlus = previewTenPlusTravelCompression(
      schedule,
      duty,
      regulator,
      homeBaseTZ,
      dutyAccl,
      restTypeForDuty,
    )
    if (tenPlus) {
      return { abort: false, markViolated: false }
    }

    if (
      confirm(
        'Duty period overlaps with a rest period. Click OK to edit the duty, or Cancel to disregard and add anyway.',
      )
    ) {
      return { abort: true, markViolated: false }
    }
    return { abort: false, markViolated: true }
  }

  /**
   * Commit a duty form payload.
   * - forceNew: always insert (clone path; never replace editEvent)
   * - closeOnSuccess: close the form after a successful save (false for clone)
   */
  const commitDutyFormPayload = (
    payload: EventFormSubmitPayload,
    opts: { forceNew?: boolean; closeOnSuccess?: boolean } = {},
  ) => {
    const forceNew = opts.forceNew === true
    const closeOnSuccess = opts.closeOnSuccess !== false
    const treatingAsEdit = !forceNew && isEdit && !!editEvent

    setValidationMessage('')
    const { duty: partial, restType: rt, eventKind, prefixReserve } = payload
    const start = partial.start
    const end = partial.end
    const dutyAccl = partial.acclTZ || acclTZ
    const dutyType = eventKindToDutyType(eventKind)
    const title =
      partial.title || titleForEventKind(eventKind)

    // Weekly limit: include prefix reserve hours when present
    // Clone never excludes the original (it is a new event).
    const excludeId = treatingAsEdit ? editEvent?.id : undefined
    if (
      wouldExceedWeeklyLimit(events, start, end, excludeId) ||
      (prefixReserve &&
        wouldExceedWeeklyLimit(
          events,
          prefixReserve.start,
          prefixReserve.end,
          excludeId,
        ))
    ) {
      setValidationMessage(
        `Total hours of work in 7 days would exceed ${MAX_WEEKLY_DUTY_HOURS} hours for ${regulator === 'TC' ? 'CAR 700.29' : regulator}`,
      )
      return false
    }

    // Non-duty types: reserve / standby — no rest recompute from duty engine
    // (Manual free time is not an event type; use Suggest Free Time for SDF blocks.)
    if (dutyType === 'reserve' || dutyType === 'standby') {
      const aux: DutyEvent = {
        id:
          treatingAsEdit && editEvent
            ? editEvent.id
            : createId(`-${dutyType}`),
        title,
        start,
        end,
        type: dutyType,
        eventKind,
        locationIcao: partial.locationIcao,
        acclTZ: dutyAccl,
        startTZ: partial.startTZ,
        endTZ: partial.endTZ,
        workFactor: defaultWorkFactorForKind(eventKind),
      }
      setEvents((prev) => {
        let without = prev
        if (treatingAsEdit && editEvent) {
          // Drop the edited event and any managed rest if it was a duty
          without = prev.filter(
            (e) =>
              e.id !== editEvent.id &&
              e.id !== restIdForDuty(editEvent.id),
          )
          if (editEvent.type === 'duty') {
            return recomputeAfterDutyDelete(
              without,
              regulator,
              homeBaseTZ,
              acclTZ,
            ).concat(aux)
          }
        }
        return [...without, aux]
      })
      if (closeOnSuccess) resetDutyForm()
      return true
    }

    // Duty types (flight, sim, ground, e-class) and optional prefix reserve→FDP
    const isFlightLike =
      eventKind === 'flight_duty' || isNonFlightDutyKind(eventKind)

    if (!isFlightLike) {
      setValidationMessage('Unsupported event type.')
      return false
    }

    const buildDuty = (id: string, violated?: boolean): DutyEvent => ({
      id,
      title,
      type: 'duty',
      eventKind,
      locationIcao: partial.locationIcao,
      start,
      end,
      acclTZ: dutyAccl,
      startTZ: partial.startTZ,
      endTZ: partial.endTZ,
      flights: partial.flights,
      operatingSectors: partial.operatingSectors,
      positioningSectors: partial.positioningSectors,
      avgSectorTime: partial.avgSectorTime,
      endsWithPositioning: partial.endsWithPositioning,
      operatingEnd: partial.operatingEnd,
      positioningAgreed: partial.positioningAgreed,
      reportOverridden: partial.reportOverridden,
      releaseOverridden: partial.releaseOverridden,
      splitBreak: partial.splitBreak,
      workFactor: defaultWorkFactorForKind(eventKind),
      violated,
    })

    // 700.29 preview for duty hours
    const previewDuty = buildDuty(
      treatingAsEdit && editEvent ? editEvent.id : 'preview-duty',
    )
    const baseDuties = events.filter(
      (e) =>
        e.type === 'duty' &&
        !(treatingAsEdit && editEvent && e.id === editEvent.id),
    )
    const prefixPreview: DutyEvent | null = prefixReserve
      ? {
          id: 'preview-rsv',
          title: titleForEventKind(prefixReserve.eventKind),
          type: eventKindToDutyType(prefixReserve.eventKind),
          eventKind: prefixReserve.eventKind,
          locationIcao: prefixReserve.locationIcao,
          start: prefixReserve.start,
          end: prefixReserve.end,
          acclTZ: dutyAccl,
          workFactor: defaultWorkFactorForKind(prefixReserve.eventKind),
        }
      : null
    // evaluate70029 uses work events; include reserve in full schedule via base+new
    // The function filters duties for some checks; still run with duty list for hours
    if (!run70029Preview([...baseDuties, previewDuty], dutyAccl)) return false

    if (treatingAsEdit && editEvent) {
      const without = events.filter(
        (e) => e.id !== editEvent.id && e.id !== restIdForDuty(editEvent.id),
      )
      const candidate = buildDuty(editEvent.id)
      const overlap = resolveRestOverlapForDuty(
        candidate,
        without,
        rt,
        dutyAccl,
      )
      if (overlap.abort) return false
      const updatedDuty = buildDuty(editEvent.id, overlap.markViolated)
      if (updatedDuty.type === 'duty') {
        saveDutyEvent(updatedDuty, rt, [...without, updatedDuty])
        if (rt === '10+travel' && eventKind === 'flight_duty') {
          const result = scheduleTravelRestReminders(end)
          if (!result.ok) {
            setValidationMessage(
              (result.hoursSinceRelease ?? 0) > 15
                ? 'More than 15 hours have passed since the release time. Please update the release time to reflect the actual time at the rest location.'
                : 'The release time has already passed. Please modify the release time of the duty.',
            )
            return false
          }
        }
      }
      if (closeOnSuccess) resetDutyForm()
      return true
    }

    // Prefix reserve/standby then FDP
    if (prefixReserve) {
      const rsv: DutyEvent = {
        id: createId(
          `-${eventKindToDutyType(prefixReserve.eventKind)}`,
        ),
        title: titleForEventKind(prefixReserve.eventKind),
        type: eventKindToDutyType(prefixReserve.eventKind),
        eventKind: prefixReserve.eventKind,
        locationIcao: prefixReserve.locationIcao,
        start: prefixReserve.start,
        end: prefixReserve.end,
        acclTZ: dutyAccl,
        workFactor: defaultWorkFactorForKind(prefixReserve.eventKind),
      }
      const dutyId = createId()
      const candidate = buildDuty(dutyId)
      // Keep unused var lint-free: prefixPreview was for future weekly checks
      void prefixPreview
      const overlap = resolveRestOverlapForDuty(
        candidate,
        events,
        rt,
        dutyAccl,
      )
      if (overlap.abort) return false
      const newDuty = buildDuty(dutyId, overlap.markViolated)
      saveDutyEvent(newDuty, rt, [...events, rsv, newDuty])
      if (rt === '10+travel') {
        const result = scheduleTravelRestReminders(end)
        if (!result.ok) {
          // Clone keeps the open form; normal add may switch into edit on the new duty
          if (!forceNew) {
            setIsEdit(true)
            setEditEvent(newDuty)
            setRestType('10+travel')
            setShowAddDuty(true)
          }
          setValidationMessage(
            (result.hoursSinceRelease ?? 0) > 15
              ? 'More than 15 hours have passed since the original release time. Please update the release time.'
              : 'The original release time has already passed. Please modify the release time.',
          )
          return false
        }
      }
      if (closeOnSuccess) resetDutyForm()
      return true
    }

    const dutyId = createId()
    const candidate = buildDuty(dutyId)
    const overlap = resolveRestOverlapForDuty(candidate, events, rt, dutyAccl)
    if (overlap.abort) return false

    const newEvent = buildDuty(dutyId, overlap.markViolated)
    saveDutyEvent(newEvent, rt, [...events, newEvent])

    if (rt === '10+travel' && eventKind === 'flight_duty') {
      const result = scheduleTravelRestReminders(end)
      if (!result.ok) {
        if (!forceNew) {
          setIsEdit(true)
          setEditEvent(newEvent)
          setRestType('10+travel')
          setShowAddDuty(true)
        }
        setValidationMessage(
          (result.hoursSinceRelease ?? 0) > 15
            ? 'More than 15 hours have passed since the original release time. Please update the release time.'
            : 'The original release time has already passed. Please modify the release time.',
        )
        return false
      }
    }

    if (closeOnSuccess) resetDutyForm()
    return true
  }

  const handleDutyFormSubmit = (payload: EventFormSubmitPayload) => {
    commitDutyFormPayload(payload, { forceNew: false, closeOnSuccess: true })
  }

  /** Clone always inserts a new event and leaves the form open. */
  const handleDutyFormClone = (payload: EventFormSubmitPayload): boolean => {
    return commitDutyFormPayload(payload, {
      forceNew: true,
      closeOnSuccess: false,
    })
  }

  const isInRange = (date: Date) => {
    if (!showAddDuty || !addDutyDate) return false
    return dayStartInCal(date).getTime() === dayStartInCal(addDutyDate).getTime()
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
                    onDayClick={handleDayClickMs}
                    onDayPressStart={handleDayPressStartMs}
                    onDayPressEnd={handleDayPressEnd}
                    onBarClick={handleBarClick}
                    onBarPressStart={handleBarPressStart}
                    onBarPressEnd={handleBarPressEnd}
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
                  const isDelete = action === 'Delete Event'
                  const isPrimary =
                    action === 'Add Event' || action === 'Edit Event'
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
                        if (action === 'Add Event') handleAddDuty()
                        else if (action === 'Edit Event') handleEditDuty()
                        else if (action === 'Delete Event') handleDeleteDuty()
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
                // Finger-up after long-press lands on the backdrop — ignore it
                if (shouldIgnoreBackdropClose()) return
                clearDaySelection()
              }}
            >
              <div
                className="modal-content day-menu-modal"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-label={
                  actionEvent
                    ? `Actions for ${actionEvent.title}`
                    : `Options for ${menuDate.toDateString()}`
                }
              >
                <div className="day-details-header">
                  <h3>
                    {actionEvent
                      ? actionEvent.title || 'Event'
                      : menuDate.toDateString()}
                  </h3>
                  <button
                    type="button"
                    className="day-details-close"
                    aria-label="Close"
                    onClick={() => clearDaySelection()}
                  >
                    <IconClose size={18} />
                  </button>
                </div>
                {actionEvent && (
                  <p className="day-details-events">
                    <span className="day-details-events-label">
                      {actionEvent.start.toLocaleString()} →{' '}
                      {actionEvent.end.toLocaleString()}
                    </span>
                  </p>
                )}
                <div className="day-details-actions">
                  {actionEvent ? (
                    <>
                      <button
                        type="button"
                        className="day-details-btn day-details-btn-primary"
                        onClick={handleEditDuty}
                      >
                        Edit Event
                      </button>
                      <button
                        type="button"
                        className="day-details-btn day-details-btn-danger"
                        onClick={handleDeleteDuty}
                      >
                        Delete Event
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="day-details-btn day-details-btn-primary"
                        onClick={handleAddDuty}
                      >
                        Add Event
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
              <DutyForm
                key={
                  isEdit && editEvent
                    ? `edit-${editEvent.id}`
                    : `add-${toDateInputValueInTZ(addDutyDate, calendarTZ)}`
                }
                mode={isEdit ? 'edit' : 'add'}
                dutyDateLabel={addDutyDate.toDateString()}
                defaultDayKey={toDateInputValueInTZ(addDutyDate, calendarTZ)}
                timeFormat={timeFormat}
                regulator={regulator}
                acclTZ={acclTZ}
                homeBaseTZ={homeBaseTZ}
                buffers={dutyTimingBuffers}
                editEvent={isEdit ? editEvent : null}
                priorDuties={events.filter((e) => e.type === 'duty')}
                restType={restType}
                onRestTypeChange={setRestType}
                validationMessage={validationMessage}
                onCancel={resetDutyForm}
                onSubmit={handleDutyFormSubmit}
                onClone={handleDutyFormClone}
              />
            </div>
          )}

          {showSettings && (
            <SettingsPanel
              onClose={() => setShowSettings(false)}
              onImportSchedule={() => setShowCalendarImport(true)}
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

          {showCalendarImport && (
            <CalendarImportPanel
              events={events}
              onClose={() => setShowCalendarImport(false)}
              onImport={(next) => {
                setEvents(next)
                setShowCalendarImport(false)
              }}
            />
          )}
        </div>
      </div>
      {tenPlusNotice && (
        <div
          className="info-sheet-overlay"
          role="presentation"
          // Require explicit Got it — no click-outside dismiss
        >
          <div
            className="info-sheet ten-plus-notice-sheet"
            onClick={(e) => e.stopPropagation()}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="ten-plus-notice-title"
          >
            <header className="info-sheet-header">
              <div className="info-sheet-heading">
                <span className="info-sheet-badge">10R</span>
                <div className="info-sheet-title-block">
                  <h2 id="ten-plus-notice-title" className="info-sheet-title">
                    Reduced rest (10 + travel)
                  </h2>
                </div>
              </div>
            </header>
            <div className="info-sheet-body">
              <p className="info-sheet-section-text">
                The following flight duty shortens the previous rest to{' '}
                <strong>{tenPlusNotice.gapHours.toFixed(1)} hours</strong>{' '}
                (between 10 and 12). Under CAR 700.40 this is only legal if you
                take the <strong>10 hours rest + travel time</strong> option
                (hotel / room key / established rest location).
              </p>
              <p className="info-sheet-section-text">
                WiseDuty has applied the 10+travel rest (
                {tenPlusNotice.requiredRestHours.toFixed(1)} h minimum) to the
                previous duty. The calendar shows a distinct <strong>10R</strong>{' '}
                marker instead of standard RR. Confirm the actual time at the
                rest facility with your company when prompted.
              </p>
              <button
                type="button"
                className="day-details-btn day-details-btn-primary"
                onClick={acknowledgeTenPlusNotice}
                autoFocus
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

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
          onClick={() => {
            if (shouldIgnoreBackdropClose()) return
            setInfoSheet(null)
          }}
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
