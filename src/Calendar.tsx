import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { Link } from 'react-router-dom'
import './Calendar.css'
import './App.css'
import type { DutyEvent, RestType } from './domain/types'
import {
  defaultWorkFactorForKind,
  eventKindToDutyType,
  inferEventKind,
  isNonFlightDutyKind,
  MAX_WEEKLY_DUTY_HOURS,
  titleForEventKind,
} from './domain/types'
import {
  createId,
  eventsOnLocalDay,
  findDutyOnDate,
  findEditableEventOnDate,
  findEditableEventsOnDate,
  previewTenPlusTravelCompression,
  removeDutyAndRelated,
  restIdForDuty,
  summarizeViolatedLnrs,
  type TenPlusTravelCompression,
} from './domain/events'
import {
  applyScheduleMutation,
  type ScheduleContext,
} from './domain/schedule-pipeline'
import {
  applyAvailabilityRemovals,
  applyReserveStartAdjustments,
  clearAvailabilityDependenciesForDuty,
  markDutyViolated,
  planPostDutyOverlapFix,
} from './domain/schedule-overlap'
import {
  REDUCED_REST_10_TRAVEL_DETAILS,
  REDUCED_REST_CONSENT_MESSAGE,
} from './domain/rest-10-travel-copy'
import {
  evaluateFdpNearMaxLimit,
  fdpLimitDialogTone,
  shouldPromptFdpLimitDialog,
  type FdpNearMaxResult,
} from './domain/fdp-near-limit'
import {
  buildFdpExtensionPhasePrompt,
  classifyFdpExtensionPhase,
  DEFAULT_UOC_EXTENSION_CAP_H,
} from './domain/uoc-extension'
import FdpLimitGuideSheet from './features/calendar/FdpLimitGuideSheet'
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
import {
  buildElnHostMap,
  buildPreferredHostMap,
  type ElnHostDutyInput,
} from './domain/marker-layout'
import {
  eventsOverlap,
  fdpOperatingEnd,
  getDutyMarkers,
  wouldExceedWeeklyLimit,
} from './domain/regulations'
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
import {
  bootstrapNotifications,
  scheduleTravelRestReminders,
  setNotificationHandler,
} from './shared/notifications'
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
import AppDialog from './shared/ui/AppDialog'
import { IconClose, IconSettings } from './shared/ui/icons'
import CalendarImportPanel from './features/import/CalendarImportPanel'
import { useAppDialog } from './features/calendar/useAppDialog'
import CalendarMonthGrid from './features/calendar/CalendarMonthGrid'
import CalendarDayDetails from './features/calendar/CalendarDayDetails'

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
  /** Latest schedule for sequential multi-clone (state alone lags between awaits). */
  const eventsRef = useRef(events)
  eventsRef.current = events
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
  const [fdpLimitGuide, setFdpLimitGuide] = useState<{
    mode: 'extension' | 'uoc'
    duty: DutyEvent
    assessment: FdpNearMaxResult
  } | null>(null)
  const {
    dialog: appDialog,
    showAlert,
    showConfirm,
    showChoice,
  } = useAppDialog()

  const scheduleCtx = useCallback((): ScheduleContext => {
    return {
      regulator,
      homeBaseTZ,
      globalAcclTZ: acclTZ,
      timeFreeOption,
    }
  }, [regulator, homeBaseTZ, acclTZ, timeFreeOption])

  // Durable notification bootstrap + in-app delivery
  useEffect(() => {
    bootstrapNotifications()
    setNotificationHandler((n) => {
      void showAlert(n.title, n.body)
    })
    return () => setNotificationHandler(null)
  }, [showAlert])

  useEffect(() => {
    // Avoid rewriting localStorage on mount with an identical payload
    if (skipNextPersist.current) {
      skipNextPersist.current = false
      return
    }
    saveEvents(events)
  }, [events])

  // Rebuild managed rests (incl. post-reserve free-day structure) once after
  // load so stored schedules pick up rule changes without re-editing each day.
  useEffect(() => {
    const result = applyScheduleMutation(
      loadEvents(),
      { type: 'recompute_only' },
      {
        regulator,
        homeBaseTZ,
        globalAcclTZ: acclTZ,
        timeFreeOption,
      },
    )
    setEvents(result.events)
    // Intentional mount-only hydrate; settings are already loaded from storage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    return () => {
      if (pressTimerRef.current) clearTimeout(pressTimerRef.current)
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
    // E/L/N host days: prefer natural day, move to roomier cell when crowded/thin
    const elnDuties: ElnHostDutyInput[] = events
      .filter((e) => e.type === 'duty')
      .map((e) => {
        const markers = getDutyMarkers(e, regulator, acclTZ, true, true).filter(
          (m): m is 'E' | 'L' | 'N' => m === 'E' || m === 'L' || m === 'N',
        )
        return {
          id: e.id,
          start: e.start,
          end: e.end,
          operatingEnd: fdpOperatingEnd(e),
          markers,
        }
      })
      .filter((d) => d.markers.length > 0)
    const elnHostMap = buildElnHostMap(elnDuties, calendarTZ, hostMap)
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
      timeFormat,
      elnHostMap,
    )
  }, [
    days,
    currentDate,
    events,
    calendarTZ,
    regulator,
    acclTZ,
    timeFormat,
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
      } else {
        // Duty, rest, reserve, standby — explainEvent adds 700.70 RDP when linked
        openInfoSheet(
          explainEvent(event, regulator, acclTZ, homeBaseTZ, events),
          { kind: 'event', event },
        )
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

      // ≈MAX: reopen interactive extension / UOC scheme
      if (marker.type === 'NEAR' && event.type === 'duty') {
        const assessment = evaluateFdpNearMaxLimit(event, {
          regulator,
          globalAcclTZ: event.acclTZ || acclTZ,
          homeBaseTZ,
          allEvents: events,
        })
        setFdpLimitGuide({
          mode: assessment.status === 'exceeded' ? 'uoc' : 'extension',
          duty: event,
          assessment,
        })
        return
      }

      if (marker.sheet === 'rest' || event.type === 'rest') {
        openInfoSheet(
          explainEvent(event, regulator, acclTZ, homeBaseTZ, events),
          {
            kind: 'event',
            event,
            marker: marker.type,
          },
        )
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
      if (lnrMsg) {
        showAlert('Rest requirement', lnrMsg)
      } else {
        showAlert(
          'Violation',
          'Duty period overlaps a rest period, or rest requirements are not met.',
        )
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [calendarTZ, report70029.violations, events, dateByStartMs, showAlert],
  )

  const getDayActions = (date: Date) => {
    const editable = findEditableEventsOnDate(events, date)
    if (editable.length > 1) {
      return [
        'Edit Event…',
        'Delete Event…',
        'Add Event',
        'Suggest Free Time',
      ]
    }
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
    if (!selectedDate) return null
    return (
      findEditableEventOnDate(events, selectedDate) ??
      findDutyOnDate(events, selectedDate) ??
      null
    )
  }

  const openEditForEvent = (event: DutyEvent) => {
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
    setValidationMessage('')
  }

  const deleteEventById = (event: DutyEvent) => {
    if (event.type === 'duty') {
      const result = applyScheduleMutation(
        events,
        { type: 'delete_duty', dutyId: event.id },
        scheduleCtx(),
      )
      // Restore reserve/standby starts that depended on this duty
      const restored = clearAvailabilityDependenciesForDuty(
        result.events,
        event.id,
      )
      const next =
        restored === result.events
          ? result
          : applyScheduleMutation(
              restored,
              { type: 'recompute_only' },
              scheduleCtx(),
            )
      setEvents(next.events)
    } else if (event.type === 'reserve' || event.type === 'standby') {
      // Drop availability + its managed rest (`{id}-rest`), then recompute
      const stripped = removeDutyAndRelated(events, event)
      const result = applyScheduleMutation(
        stripped,
        { type: 'recompute_only' },
        scheduleCtx(),
      )
      setEvents(result.events)
    } else {
      setEvents((prev) => prev.filter((e) => e.id !== event.id))
    }
    clearDaySelection()
  }

  /** Multi-duty day: let user pick which event to edit/delete. */
  const pickEditableOnDay = async (
    date: Date,
    mode: 'edit' | 'delete',
  ): Promise<void> => {
    const list = findEditableEventsOnDate(events, date)
    if (list.length === 0) return
    if (list.length === 1) {
      if (mode === 'edit') openEditForEvent(list[0])
      else deleteEventById(list[0])
      return
    }
    const choices = list.map((e) => {
      const t = e.start.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })
      return {
        id: e.id,
        label: `${e.title || e.type} · ${t}`,
      }
    })
    const chosen = await showChoice(
      mode === 'edit' ? 'Edit which event?' : 'Delete which event?',
      'This day has more than one event.',
      choices,
    )
    if (!chosen) return
    const event = list.find((e) => e.id === chosen)
    if (!event) return
    if (mode === 'edit') openEditForEvent(event)
    else deleteEventById(event)
  }

  const handleEditDuty = () => {
    const event = resolveActionEvent()
    if (!event) return
    openEditForEvent(event)
  }

  const handleDeleteDuty = () => {
    const event = resolveActionEvent()
    if (!event) return
    deleteEventById(event)
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
      showAlert(
        'Time free from duty (CAR 700.29)',
        `${soft}\n\nUse “Suggest Free Time” from the day menu to auto-schedule days free from duty.`,
      )
    }
    return true
  }

  /**
   * Official mutation path:
   * mutate → recomputeScheduleCompliance → 10+travel → evaluate70029
   * → post-FDP overlap fix (reserve start / violation) → setState/persist
   *
   * Never auto-reduces rest below 12 h for reserve/standby clearance without
   * explicit crew consent (Keep 12 h vs accept 10+travel).
   */
  const saveDutyEvent = async (
    dutyEvent: DutyEvent,
    rt: RestType,
    baseEvents: DutyEvent[],
  ) => {
    const ctx = {
      ...scheduleCtx(),
      globalAcclTZ: dutyEvent.acclTZ || acclTZ,
    }
    let result = applyScheduleMutation(
      baseEvents,
      {
        type: 'upsert_duty',
        duty: dutyEvent,
        restType: rt,
        applyTenPlusTravel: true,
      },
      ctx,
    )
    let eventsOut = result.events
    let restTypeUsed: RestType = rt
    const overlapNotes: string[] = []

    // After rest is built: overlaps with next reserve/assignment.
    // Default: protect 12 h after release when sliding reserve/standby starts.
    const restAlreadyReduced = restTypeUsed === '10+travel'
    let allowReducedRest = restAlreadyReduced
    let plan = planPostDutyOverlapFix(eventsOut, dutyEvent.id, {
      allowReducedRest,
    })
    if (plan.tryRestType10Travel && !allowReducedRest) {
      const choice = await showChoice(
        'Rest length',
        REDUCED_REST_CONSENT_MESSAGE,
        [
          {
            id: 'keep_12',
            label: 'Keep 12 h rest',
          },
          {
            id: 'accept_10',
            label: 'Accept reduced rest (10 h + travel)',
            detailLabel: 'Details',
            detail: REDUCED_REST_10_TRAVEL_DETAILS,
          },
        ],
      )
      if (choice === 'accept_10') {
        restTypeUsed = '10+travel'
        allowReducedRest = true
        result = applyScheduleMutation(
          eventsOut,
          {
            type: 'upsert_duty',
            duty: dutyEvent,
            restType: '10+travel',
            applyTenPlusTravel: true,
          },
          ctx,
        )
        eventsOut = result.events
        plan = planPostDutyOverlapFix(eventsOut, dutyEvent.id, {
          allowReducedRest: true,
        })
      } else {
        // Keep 12 h: slides/cancels still use a 12 h post-release floor
        plan = planPostDutyOverlapFix(eventsOut, dutyEvent.id, {
          allowReducedRest: false,
        })
      }
    }

    if (plan.messages.length) {
      for (const m of plan.messages) {
        if (!overlapNotes.includes(m)) overlapNotes.push(m)
      }
    }

    const needApply =
      plan.reserveAdjustments.length > 0 || plan.removePeerIds.length > 0
    if (needApply) {
      let adjusted = applyReserveStartAdjustments(
        eventsOut,
        plan.reserveAdjustments,
      )
      adjusted = applyAvailabilityRemovals(adjusted, plan.removePeerIds)
      const after = applyScheduleMutation(
        adjusted,
        { type: 'recompute_only' },
        ctx,
      )
      eventsOut = after.events
      if (after.notices.length) {
        result = { ...result, notices: [...result.notices, ...after.notices] }
      }
      // Re-check with same rest-protection policy after moves/removals
      plan = planPostDutyOverlapFix(eventsOut, dutyEvent.id, {
        allowReducedRest,
      })
      for (const m of plan.messages) {
        if (
          !overlapNotes.includes(m) &&
          (/assignment|Contact|cancelled|Notify/i.test(m))
        ) {
          overlapNotes.push(m)
        }
      }
      if (plan.removePeerIds.length > 0 || plan.reserveAdjustments.length > 0) {
        adjusted = applyReserveStartAdjustments(
          eventsOut,
          plan.reserveAdjustments,
        )
        adjusted = applyAvailabilityRemovals(adjusted, plan.removePeerIds)
        const after2 = applyScheduleMutation(
          adjusted,
          { type: 'recompute_only' },
          ctx,
        )
        eventsOut = after2.events
      }
    }

    if (plan.markDutyViolated) {
      eventsOut = markDutyViolated(eventsOut, dutyEvent.id, true)
    }

    eventsRef.current = eventsOut
    setEvents(eventsOut)

    // Post-save dialogs must run in sequence (one AppDialog at a time).
    // Priority: Max FDP/RDP choice → schedule notes → LNR → 10+travel notice.
    // Fire-and-forget microtasks previously clobbered each other — especially
    // common on reserve→FDP handoff when overlap notes also fire.
    const tenPlus = result.notices.find((n) => n.kind === 'ten_plus_travel')
    const lnrMsg = summarizeViolatedLnrs(eventsOut)
    const savedDuty = eventsOut.find(
      (e) => e.id === dutyEvent.id && e.type === 'duty',
    )
    const limitEval = savedDuty
      ? evaluateFdpNearMaxLimit(savedDuty, {
          regulator,
          globalAcclTZ: savedDuty.acclTZ || acclTZ,
          homeBaseTZ,
          allEvents: eventsOut,
        })
      : evaluateFdpNearMaxLimit(dutyEvent, {
          regulator,
          globalAcclTZ: dutyEvent.acclTZ || acclTZ,
          homeBaseTZ,
          allEvents: eventsOut,
        })
    const dutyForGuide = savedDuty ?? dutyEvent

    queueMicrotask(() => {
      void (async () => {
        // 1) Max FDP / RDP: within 1 h of max or exceeded — branch by
        // wall-clock phase of the default +2 h UOC extension window.
        // Chrome: amber (≤1 h, >30 min) or red (≤30 min / over).
        if (shouldPromptFdpLimitDialog(limitEval)) {
          const dialogTone = fdpLimitDialogTone(limitEval)
          const extWindow = classifyFdpExtensionPhase(dutyForGuide, {
            maxFdpHours: limitEval.maxFdpHours,
            actualHours: limitEval.actualHours,
            extensionCapHours: DEFAULT_UOC_EXTENSION_CAP_H,
          })
          const prompt = buildFdpExtensionPhasePrompt({
            phase: extWindow.phase,
            limitKind: limitEval.limitKind,
            assessmentMessage: limitEval.message,
            remainingLabel: limitEval.remainingLabel,
            window: extWindow,
          })

          if (prompt.kind === 'choice') {
            const choice = await showChoice(
              prompt.title,
              prompt.message,
              prompt.choices,
              { tone: dialogTone },
            )
            if (choice === 'guidelines' || choice === 'uoc') {
              setFdpLimitGuide({
                mode:
                  limitEval.status === 'exceeded' ? 'uoc' : 'extension',
                duty: dutyForGuide,
                assessment: limitEval,
              })
            } else if (choice === 'refuse') {
              await showAlert(
                'Contact your company',
                'You indicated you are not willing to extend. Contact your company so the assignment can be re-planned.',
                { confirmLabel: 'Got it', tone: dialogTone },
              )
            }
          } else {
            await showAlert(prompt.title, prompt.message, {
              confirmLabel: 'Got it',
              tone: dialogTone,
            })
            // Active/ended: offer guidelines after the advisory
            if (extWindow.phase === 'active' || extWindow.phase === 'ended') {
              const review = await showConfirm(
                'Review UOC guidelines?',
                'Open the CAR 700.63 decision scheme (timing, crew consent, PIC, crew configuration)?',
                {
                  confirmLabel: 'Review guidelines',
                  cancelLabel: 'Not now',
                  tone: dialogTone,
                },
              )
              if (review) {
                setFdpLimitGuide({
                  mode:
                    limitEval.status === 'exceeded' ||
                    extWindow.phase === 'active' ||
                    extWindow.phase === 'ended'
                      ? 'uoc'
                      : 'extension',
                  duty: dutyForGuide,
                  assessment: limitEval,
                })
              }
            }
          }
        }

        // 2) Schedule notes (reserve slides, assignment conflicts, …)
        if (overlapNotes.length > 0) {
          await showAlert('Schedule note', overlapNotes.join(' '), {
            confirmLabel: 'Got it',
          })
        }

        // 3) Local night rest
        if (lnrMsg) {
          await showAlert('Rest requirement', lnrMsg)
        }

        // 4) 10+travel notice + optional reminder scheduling
        if (tenPlus && tenPlus.kind === 'ten_plus_travel') {
          setTenPlusNotice(tenPlus.compression)
          void scheduleTravelRestReminders(tenPlus.compression.previousRelease, {
            askUser: () =>
              showConfirm(
                '10+travel reminders',
                'Notify you 30 minutes after the previous release to confirm hotel / rest location timing?',
                { confirmLabel: 'Yes, remind me', cancelLabel: 'No thanks' },
              ),
          })
        }
      })()
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
  const resolveRestOverlapForDuty = async (
    duty: DutyEvent,
    schedule: DutyEvent[],
    restTypeForDuty: RestType,
    dutyAccl: string,
  ): Promise<{ abort: boolean; markViolated: boolean }> => {
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

    const stayAndEdit = await showConfirm(
      'Overlaps rest period',
      'This duty overlaps a rest period. Stay on the form to edit times, or add it anyway (flagged).',
      {
        confirmLabel: 'Stay and edit',
        cancelLabel: 'Add anyway',
        danger: false,
      },
    )
    if (stayAndEdit) {
      return { abort: true, markViolated: false }
    }
    return { abort: false, markViolated: true }
  }

  /**
   * Commit a duty form payload.
   * - forceNew: always insert (clone path; never replace editEvent)
   * - closeOnSuccess: close the form after a successful save (false for clone)
   */
  const commitDutyFormPayload = async (
    payload: EventFormSubmitPayload,
    opts: { forceNew?: boolean; closeOnSuccess?: boolean } = {},
  ): Promise<boolean> => {
    const forceNew = opts.forceNew === true
    const closeOnSuccess = opts.closeOnSuccess !== false
    const treatingAsEdit = !forceNew && isEdit && !!editEvent
    // Snapshot schedule (ref stays current across sequential multi-clone awaits)
    const schedule = eventsRef.current

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
      wouldExceedWeeklyLimit(schedule, start, end, excludeId) ||
      (prefixReserve &&
        wouldExceedWeeklyLimit(
          schedule,
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

    // Reserve / standby: rebuild post-availability rest (700.40 + optional 700.29 free day)
    // (Manual free time is not an event type; use Suggest Free Time for free blocks.)
    if (dutyType === 'reserve' || dutyType === 'standby') {
      // Manual schedule: floor = this start; drop auto-dependency from prior FDP
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
        scheduledStart: start,
        startDependsOnDutyId: undefined,
      }
      if (treatingAsEdit && editEvent && editEvent.type === 'duty') {
        // Convert duty → reserve/standby: delete duty via pipeline then append aux
        const afterDelete = applyScheduleMutation(
          schedule,
          { type: 'delete_duty', dutyId: editEvent.id },
          scheduleCtx(),
        )
        const next = applyScheduleMutation(
          [...afterDelete.events, aux],
          { type: 'recompute_only' },
          scheduleCtx(),
        )
        eventsRef.current = next.events
        setEvents(next.events)
      } else {
        const without =
          treatingAsEdit && editEvent
            ? schedule.filter((e) => e.id !== editEvent.id)
            : schedule
        const next = applyScheduleMutation(
          [...without, aux],
          { type: 'recompute_only' },
          scheduleCtx(),
        )
        eventsRef.current = next.events
        setEvents(next.events)
      }
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
      // CAR 700.70: RAP start for RDP (not call/end time). Prefer form value;
      // fall back to prefix reserve start on handoff.
      rapStart:
        partial.rapStart ??
        (prefixReserve &&
        eventKindToDutyType(prefixReserve.eventKind) === 'reserve'
          ? prefixReserve.start
          : undefined),
      workFactor: defaultWorkFactorForKind(eventKind),
      violated,
    })

    // 700.29 preview for duty hours
    const previewDuty = buildDuty(
      treatingAsEdit && editEvent ? editEvent.id : 'preview-duty',
    )
    const baseDuties = schedule.filter(
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

    // Prefix reserve/standby then FDP (add or edit existing reserve → handoff)
    // Must run before plain edit: editEvent may be the reserve being updated.
    if (prefixReserve) {
      const editingReserve =
        treatingAsEdit &&
        !!editEvent &&
        (editEvent.type === 'reserve' || editEvent.type === 'standby')

      const baseSchedule = editingReserve
        ? schedule.filter(
            (e) =>
              e.id !== editEvent!.id && e.id !== restIdForDuty(editEvent!.id),
          )
        : schedule

      const rsv: DutyEvent = {
        id: editingReserve
          ? editEvent!.id
          : createId(`-${eventKindToDutyType(prefixReserve.eventKind)}`),
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
      void prefixPreview
      const overlap = await resolveRestOverlapForDuty(
        candidate,
        baseSchedule,
        rt,
        dutyAccl,
      )
      if (overlap.abort) return false
      if (rt === '10+travel') {
        const result = await scheduleTravelRestReminders(end, {
          askUser: () =>
            showConfirm(
              '10+travel reminders',
              'Notify you 30 minutes after release to confirm hotel / rest location timing?',
              { confirmLabel: 'Yes, remind me', cancelLabel: 'No thanks' },
            ),
        })
        if (!result.ok) {
          setValidationMessage(
            (result.hoursSinceRelease ?? 0) > 15
              ? 'More than 15 hours have passed since the original release time. Please update the release time.'
              : 'The original release time has already passed. Please modify the release time.',
          )
          return false
        }
      }
      const newDuty = buildDuty(dutyId, overlap.markViolated)
      // Persist updated/created reserve + new FDP through compliance pipeline
      await saveDutyEvent(newDuty, rt, [...baseSchedule, rsv, newDuty])
      if (closeOnSuccess) resetDutyForm()
      return true
    }

    if (treatingAsEdit && editEvent) {
      const without = schedule.filter(
        (e) => e.id !== editEvent.id && e.id !== restIdForDuty(editEvent.id),
      )
      const candidate = buildDuty(editEvent.id)
      const overlap = await resolveRestOverlapForDuty(
        candidate,
        without,
        rt,
        dutyAccl,
      )
      if (overlap.abort) return false
      // Validate 10+travel reminders BEFORE persist (Phase 1)
      if (rt === '10+travel' && eventKind === 'flight_duty') {
        const result = await scheduleTravelRestReminders(end, {
          askUser: () =>
            showConfirm(
              '10+travel reminders',
              'Notify you 30 minutes after release to confirm hotel / rest location timing?',
              { confirmLabel: 'Yes, remind me', cancelLabel: 'No thanks' },
            ),
        })
        if (!result.ok) {
          setValidationMessage(
            (result.hoursSinceRelease ?? 0) > 15
              ? 'More than 15 hours have passed since the release time. Please update the release time to reflect the actual time at the rest location.'
              : 'The release time has already passed. Please modify the release time of the duty.',
          )
          return false
        }
      }
      const updatedDuty = buildDuty(editEvent.id, overlap.markViolated)
      if (updatedDuty.type === 'duty') {
        await saveDutyEvent(updatedDuty, rt, [...without, updatedDuty])
      }
      if (closeOnSuccess) resetDutyForm()
      return true
    }

    const dutyId = createId()
    const candidate = buildDuty(dutyId)
    const overlap = await resolveRestOverlapForDuty(
      candidate,
      schedule,
      rt,
      dutyAccl,
    )
    if (overlap.abort) return false

    if (rt === '10+travel' && eventKind === 'flight_duty') {
      const result = await scheduleTravelRestReminders(end, {
        askUser: () =>
          showConfirm(
            '10+travel reminders',
            'Notify you 30 minutes after release to confirm hotel / rest location timing?',
            { confirmLabel: 'Yes, remind me', cancelLabel: 'No thanks' },
          ),
      })
      if (!result.ok) {
        setValidationMessage(
          (result.hoursSinceRelease ?? 0) > 15
            ? 'More than 15 hours have passed since the original release time. Please update the release time.'
            : 'The original release time has already passed. Please modify the release time.',
        )
        return false
      }
    }

    const newEvent = buildDuty(dutyId, overlap.markViolated)
    await saveDutyEvent(newEvent, rt, [...schedule, newEvent])

    if (closeOnSuccess) resetDutyForm()
    return true
  }

  const handleDutyFormSubmit = (payload: EventFormSubmitPayload) => {
    void commitDutyFormPayload(payload, {
      forceNew: false,
      closeOnSuccess: true,
    })
  }

  /** Clone always inserts a new event and leaves the form open. */
  const handleDutyFormClone = (
    payload: EventFormSubmitPayload,
  ): boolean | Promise<boolean> => {
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
          <CalendarMonthGrid
            days={days}
            weekDayLabels={weekDayLabels}
            weekRows={weekRows}
            sharedDayMinRem={sharedDayMinRem}
            scheduleLayout={scheduleLayout}
            calendarTZ={calendarTZ}
            selectedDate={selectedDate}
            dayStartInCal={dayStartInCal}
            isInRange={isInRange}
            onDayClickMs={handleDayClickMs}
            onDayPressStartMs={handleDayPressStartMs}
            onDayPressEnd={handleDayPressEnd}
            onBarClick={handleBarClick}
            onMarkerClick={handleMarkerClick}
            onViolationClick={handleViolationClick}
          />
          {selectedDate && (
            <CalendarDayDetails
              selectedDate={selectedDate}
              eventTitles={
                events
                  .filter(
                    (e) =>
                      e.start.toDateString() === selectedDate.toDateString() ||
                      (e.start < selectedDate &&
                        e.end > dayStartInCal(selectedDate)),
                  )
                  .map((e) => e.title)
                  .join(', ') || 'None'
              }
              actions={getDayActions(selectedDate)}
              onClose={() => clearDaySelection()}
              onAction={(action) => {
                if (action === 'Add Event') handleAddDuty()
                else if (action === 'Edit Event') handleEditDuty()
                else if (action === 'Edit Event…')
                  void pickEditableOnDay(selectedDate, 'edit')
                else if (action === 'Delete Event') handleDeleteDuty()
                else if (action === 'Delete Event…')
                  void pickEditableOnDay(selectedDate, 'delete')
                else if (action === 'Suggest Free Time') openFreeSuggestions()
              }}
            />
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
                    Add Event
                  </button>
                  <button
                    type="button"
                    className="day-details-btn day-details-btn-secondary"
                    onClick={openFreeSuggestions}
                  >
                    Suggest Free Time
                  </button>
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
                priorDuties={events.filter(
                  (e) =>
                    e.type === 'duty' ||
                    e.type === 'reserve' ||
                    e.type === 'standby',
                )}
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
      {fdpLimitGuide && (
        <FdpLimitGuideSheet
          mode={fdpLimitGuide.mode}
          duty={fdpLimitGuide.duty}
          assessment={fdpLimitGuide.assessment}
          onClose={() => setFdpLimitGuide(null)}
        />
      )}

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
                        const result = applyScheduleMutation(
                          [...events, free],
                          { type: 'recompute_only' },
                          scheduleCtx(),
                        )
                        setEvents(result.events)
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
                    void (async () => {
                      const ok = await showConfirm(
                        'Delete rest event?',
                        'Remove this rest event from the calendar?',
                        {
                          confirmLabel: 'Delete',
                          cancelLabel: 'Cancel',
                          danger: true,
                        },
                      )
                      if (!ok) return
                      const id = infoSheet.eventId
                      setEvents((prev) => prev.filter((e) => e.id !== id))
                      setInfoSheet(null)
                    })()
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

      {appDialog && (
        <AppDialog
          open
          kind={appDialog.kind}
          title={appDialog.title}
          message={appDialog.message}
          danger={
            appDialog.kind === 'confirm' ? !!appDialog.danger : false
          }
          tone={appDialog.tone}
          confirmLabel={
            appDialog.kind === 'alert' || appDialog.kind === 'confirm'
              ? appDialog.confirmLabel
              : undefined
          }
          cancelLabel={
            appDialog.kind === 'confirm'
              ? appDialog.cancelLabel
              : appDialog.kind === 'choice'
                ? 'Cancel'
                : undefined
          }
          choices={appDialog.kind === 'choice' ? appDialog.choices : undefined}
          onConfirm={
            appDialog.kind === 'choice'
              ? () => appDialog.onCancel()
              : appDialog.onConfirm
          }
          onCancel={
            appDialog.kind === 'alert' ? undefined : appDialog.onCancel
          }
          onChoose={
            appDialog.kind === 'choice' ? appDialog.onChoose : undefined
          }
        />
      )}
    </>
  )
}

export default Calendar
