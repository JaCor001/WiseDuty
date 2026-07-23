import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { AvgSectorTime, Regulator, TimeFormat } from '../../domain/types'
import { STORAGE_KEYS } from '../../domain/types'
import { readString, writeString } from '../../shared/storage'

interface SettingsContextValue {
  darkMode: boolean
  setDarkMode: (value: boolean) => void
  toggleDarkMode: () => void
  timeFormat: TimeFormat
  setTimeFormat: (value: TimeFormat) => void
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
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

function defaultTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return 'America/Vancouver'
  }
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [darkMode, setDarkModeState] = useState(
    () => readString(STORAGE_KEYS.theme, 'light') === 'dark',
  )
  const [timeFormat, setTimeFormatState] = useState<TimeFormat>(
    () => (readString(STORAGE_KEYS.timeFormat, '24h') as TimeFormat) || '24h',
  )
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

  useEffect(() => {
    document.body.className = darkMode ? 'dark' : 'light'
  }, [darkMode])

  const setDarkMode = useCallback((value: boolean) => {
    setDarkModeState(value)
    writeString(STORAGE_KEYS.theme, value ? 'dark' : 'light')
  }, [])

  const toggleDarkMode = useCallback(() => {
    setDarkMode(!darkMode)
  }, [darkMode, setDarkMode])

  const setTimeFormat = useCallback((value: TimeFormat) => {
    setTimeFormatState(value)
    writeString(STORAGE_KEYS.timeFormat, value)
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

  const value = useMemo(
    () => ({
      darkMode,
      setDarkMode,
      toggleDarkMode,
      timeFormat,
      setTimeFormat,
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
    }),
    [
      darkMode,
      setDarkMode,
      toggleDarkMode,
      timeFormat,
      setTimeFormat,
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
