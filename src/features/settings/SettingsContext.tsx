import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type {
  AvgSectorTime,
  CalendarTimeReference,
  DutyTimingBuffers,
  ImportReportMode,
  Regulator,
  TimeFormat,
  TimeFreeOption,
  WeekStartDay,
} from '../../domain/types'
import { DEFAULT_DUTY_TIMING_BUFFERS, STORAGE_KEYS } from '../../domain/types'
import { deviceTimeZone } from '../../domain/time'
import { readString, writeString } from '../../shared/storage'

function parseDutyTimingBuffers(raw: string): DutyTimingBuffers {
  try {
    const o = JSON.parse(raw) as Partial<DutyTimingBuffers>
    return {
      reportOperatingMin:
        Number(o.reportOperatingMin) || DEFAULT_DUTY_TIMING_BUFFERS.reportOperatingMin,
      reportOperatingCustomsMin:
        Number(o.reportOperatingCustomsMin) ||
        DEFAULT_DUTY_TIMING_BUFFERS.reportOperatingCustomsMin,
      reportDeadheadMin:
        Number(o.reportDeadheadMin) || DEFAULT_DUTY_TIMING_BUFFERS.reportDeadheadMin,
      reportDeadheadCustomsMin:
        Number(o.reportDeadheadCustomsMin) ||
        DEFAULT_DUTY_TIMING_BUFFERS.reportDeadheadCustomsMin,
      releaseOperatingMin:
        Number(o.releaseOperatingMin) ||
        DEFAULT_DUTY_TIMING_BUFFERS.releaseOperatingMin,
      releaseDeadheadMin:
        Number(o.releaseDeadheadMin) ||
        DEFAULT_DUTY_TIMING_BUFFERS.releaseDeadheadMin,
    }
  } catch {
    return { ...DEFAULT_DUTY_TIMING_BUFFERS }
  }
}

interface SettingsContextValue {
  darkMode: boolean
  setDarkMode: (value: boolean) => void
  toggleDarkMode: () => void
  timeFormat: TimeFormat
  setTimeFormat: (value: TimeFormat) => void
  weekStartDay: WeekStartDay
  setWeekStartDay: (value: WeekStartDay) => void
  regulator: Regulator
  setRegulator: (value: Regulator) => void
  referenceTZ: string
  setReferenceTZ: (value: string) => void
  acclTZ: string
  setAcclTZ: (value: string) => void
  sectors: number
  setSectors: (value: number) => void
  avgSectorTime: AvgSectorTime
  setAvgSectorTime: (value: AvgSectorTime) => void
  timeFreeOption: TimeFreeOption
  setTimeFreeOption: (value: TimeFreeOption) => void
  calendarTimeRef: CalendarTimeReference
  setCalendarTimeRef: (value: CalendarTimeReference) => void
  calendarDisplayTZ: string
  setCalendarDisplayTZ: (value: string) => void
  /** Resolved IANA zone for calendar day cells / bars. */
  resolvedCalendarTZ: string
  dutyTimingBuffers: DutyTimingBuffers
  setDutyTimingBuffers: (value: DutyTimingBuffers) => void
  importCalendarId: string
  setImportCalendarId: (value: string) => void
  importCalendarName: string
  setImportCalendarName: (value: string) => void
  importReportMode: ImportReportMode
  setImportReportMode: (value: ImportReportMode) => void
  importDefaultRangeDays: number
  setImportDefaultRangeDays: (value: number) => void
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

function defaultTimeZone(): string {
  const tz = deviceTimeZone()
  return tz || 'America/Vancouver'
}

function parseCalendarTimeRef(raw: string): CalendarTimeReference {
  if (
    raw === 'zulu' ||
    raw === 'device' ||
    raw === 'home' ||
    raw === 'custom'
  ) {
    return raw
  }
  return 'device'
}

export function resolveCalendarTimeZone(
  mode: CalendarTimeReference,
  homeBaseTZ: string,
  customTZ: string,
): string {
  if (mode === 'zulu') return 'UTC'
  if (mode === 'home') return homeBaseTZ || deviceTimeZone()
  if (mode === 'custom') return customTZ || homeBaseTZ || deviceTimeZone()
  return deviceTimeZone()
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [darkMode, setDarkModeState] = useState(
    () => readString(STORAGE_KEYS.theme, 'light') === 'dark',
  )
  const [timeFormat, setTimeFormatState] = useState<TimeFormat>(
    () => (readString(STORAGE_KEYS.timeFormat, '24h') as TimeFormat) || '24h',
  )
  const [weekStartDay, setWeekStartDayState] = useState<WeekStartDay>(() => {
    const v = readString(STORAGE_KEYS.weekStartDay, 'sunday')
    return v === 'monday' ? 'monday' : 'sunday'
  })
  const [regulator, setRegulatorState] = useState<Regulator>(
    () =>
      (readString(STORAGE_KEYS.regulator, 'TC') as Regulator) || 'TC',
  )
  const [referenceTZ, setReferenceTZState] = useState(() =>
    readString(STORAGE_KEYS.referenceTZ, defaultTimeZone()),
  )
  const [acclTZ, setAcclTZState] = useState(() =>
    readString(STORAGE_KEYS.acclTZ, defaultTimeZone()),
  )
  const [sectors, setSectorsState] = useState(() => {
    const n = Number(readString(STORAGE_KEYS.lastSectors, '1'))
    return Number.isFinite(n) && n >= 1 ? n : 1
  })
  const [avgSectorTime, setAvgSectorTimeState] = useState<AvgSectorTime>(
    () =>
      (readString(STORAGE_KEYS.lastAvgSectorTime, '<30') as AvgSectorTime) ||
      '<30',
  )
  const [timeFreeOption, setTimeFreeOptionState] = useState<TimeFreeOption>(
    () => {
      const v = readString(STORAGE_KEYS.timeFreeOption, 'auto') as TimeFreeOption
      return v === 'C' || v === 'D' || v === 'auto' ? v : 'auto'
    },
  )
  const [calendarTimeRef, setCalendarTimeRefState] =
    useState<CalendarTimeReference>(() =>
      parseCalendarTimeRef(readString(STORAGE_KEYS.calendarTimeRef, 'device')),
    )
  const [calendarDisplayTZ, setCalendarDisplayTZState] = useState(() =>
    readString(STORAGE_KEYS.calendarDisplayTZ, defaultTimeZone()),
  )
  const [dutyTimingBuffers, setDutyTimingBuffersState] =
    useState<DutyTimingBuffers>(() =>
      parseDutyTimingBuffers(
        readString(
          STORAGE_KEYS.dutyTimingBuffers,
          JSON.stringify(DEFAULT_DUTY_TIMING_BUFFERS),
        ),
      ),
    )
  const [importCalendarId, setImportCalendarIdState] = useState(() =>
    readString(STORAGE_KEYS.importCalendarId, ''),
  )
  const [importCalendarName, setImportCalendarNameState] = useState(() =>
    readString(STORAGE_KEYS.importCalendarName, ''),
  )
  const [importReportMode, setImportReportModeState] =
    useState<ImportReportMode>(() => {
      const v = readString(STORAGE_KEYS.importReportMode, 'auto')
      return v === 'buffers' || v === 'event_start' || v === 'auto'
        ? v
        : 'auto'
    })
  const [importDefaultRangeDays, setImportDefaultRangeDaysState] = useState(
    () => {
      const n = Number(readString(STORAGE_KEYS.importDefaultRangeDays, '30'))
      return Number.isFinite(n) && n >= 1 && n <= 366 ? n : 30
    },
  )

  useEffect(() => {
    document.body.className = darkMode ? 'dark' : 'light'
  }, [darkMode])

  const setDarkMode = useCallback((value: boolean) => {
    setDarkModeState(value)
    writeString(STORAGE_KEYS.theme, value ? 'dark' : 'light')
  }, [])

  const toggleDarkMode = useCallback(() => {
    setDarkModeState((prev) => {
      const next = !prev
      writeString(STORAGE_KEYS.theme, next ? 'dark' : 'light')
      return next
    })
  }, [])

  const setTimeFormat = useCallback((value: TimeFormat) => {
    setTimeFormatState(value)
    writeString(STORAGE_KEYS.timeFormat, value)
  }, [])

  const setWeekStartDay = useCallback((value: WeekStartDay) => {
    setWeekStartDayState(value)
    writeString(STORAGE_KEYS.weekStartDay, value)
  }, [])

  const setRegulator = useCallback((value: Regulator) => {
    setRegulatorState(value)
    writeString(STORAGE_KEYS.regulator, value)
  }, [])

  const setReferenceTZ = useCallback((value: string) => {
    setReferenceTZState(value)
    writeString(STORAGE_KEYS.referenceTZ, value)
  }, [])

  const setAcclTZ = useCallback((value: string) => {
    setAcclTZState(value)
    writeString(STORAGE_KEYS.acclTZ, value)
  }, [])

  const setSectors = useCallback((value: number) => {
    setSectorsState(value)
    writeString(STORAGE_KEYS.lastSectors, String(value))
  }, [])

  const setAvgSectorTime = useCallback((value: AvgSectorTime) => {
    setAvgSectorTimeState(value)
    writeString(STORAGE_KEYS.lastAvgSectorTime, value)
  }, [])

  const setTimeFreeOption = useCallback((value: TimeFreeOption) => {
    setTimeFreeOptionState(value)
    writeString(STORAGE_KEYS.timeFreeOption, value)
  }, [])

  const setCalendarTimeRef = useCallback((value: CalendarTimeReference) => {
    setCalendarTimeRefState(value)
    writeString(STORAGE_KEYS.calendarTimeRef, value)
  }, [])

  const setCalendarDisplayTZ = useCallback((value: string) => {
    setCalendarDisplayTZState(value)
    writeString(STORAGE_KEYS.calendarDisplayTZ, value)
  }, [])

  const setDutyTimingBuffers = useCallback((value: DutyTimingBuffers) => {
    setDutyTimingBuffersState(value)
    writeString(STORAGE_KEYS.dutyTimingBuffers, JSON.stringify(value))
  }, [])

  const setImportCalendarId = useCallback((value: string) => {
    setImportCalendarIdState(value)
    writeString(STORAGE_KEYS.importCalendarId, value)
  }, [])

  const setImportCalendarName = useCallback((value: string) => {
    setImportCalendarNameState(value)
    writeString(STORAGE_KEYS.importCalendarName, value)
  }, [])

  const setImportReportMode = useCallback((value: ImportReportMode) => {
    setImportReportModeState(value)
    writeString(STORAGE_KEYS.importReportMode, value)
  }, [])

  const setImportDefaultRangeDays = useCallback((value: number) => {
    setImportDefaultRangeDaysState(value)
    writeString(STORAGE_KEYS.importDefaultRangeDays, String(value))
  }, [])

  const resolvedCalendarTZ = useMemo(
    () =>
      resolveCalendarTimeZone(
        calendarTimeRef,
        referenceTZ,
        calendarDisplayTZ,
      ),
    [calendarTimeRef, referenceTZ, calendarDisplayTZ],
  )

  const value = useMemo(
    () => ({
      darkMode,
      setDarkMode,
      toggleDarkMode,
      timeFormat,
      setTimeFormat,
      weekStartDay,
      setWeekStartDay,
      regulator,
      setRegulator,
      referenceTZ,
      setReferenceTZ,
      acclTZ,
      setAcclTZ,
      sectors,
      setSectors,
      avgSectorTime,
      setAvgSectorTime,
      timeFreeOption,
      setTimeFreeOption,
      calendarTimeRef,
      setCalendarTimeRef,
      calendarDisplayTZ,
      setCalendarDisplayTZ,
      resolvedCalendarTZ,
      dutyTimingBuffers,
      setDutyTimingBuffers,
      importCalendarId,
      setImportCalendarId,
      importCalendarName,
      setImportCalendarName,
      importReportMode,
      setImportReportMode,
      importDefaultRangeDays,
      setImportDefaultRangeDays,
    }),
    [
      darkMode,
      setDarkMode,
      toggleDarkMode,
      timeFormat,
      setTimeFormat,
      weekStartDay,
      setWeekStartDay,
      regulator,
      setRegulator,
      referenceTZ,
      setReferenceTZ,
      acclTZ,
      setAcclTZ,
      sectors,
      setSectors,
      avgSectorTime,
      setAvgSectorTime,
      timeFreeOption,
      setTimeFreeOption,
      calendarTimeRef,
      setCalendarTimeRef,
      calendarDisplayTZ,
      setCalendarDisplayTZ,
      resolvedCalendarTZ,
      dutyTimingBuffers,
      setDutyTimingBuffers,
      importCalendarId,
      setImportCalendarId,
      importCalendarName,
      setImportCalendarName,
      importReportMode,
      setImportReportMode,
      importDefaultRangeDays,
      setImportDefaultRangeDays,
    ],
  )

  return (
    <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
  )
}

// Hook colocated with provider for convenience (react-refresh only cares about HMR of this file).
// eslint-disable-next-line react-refresh/only-export-components
export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext)
  if (!ctx) {
    throw new Error('useSettings must be used within SettingsProvider')
  }
  return ctx
}
