export type DutyType = 'duty' | 'rest'
export type TimeFormat = '24h' | '12h'
export type Regulator = 'TC' | 'FAA' | 'EASA' | 'Australia'
export type AvgSectorTime = '<30' | '30-50' | '>=50'
export type RestType = '12h' | '10+travel'

export interface DutyEvent {
  id: string
  title: string
  start: Date
  end: Date
  type: DutyType
  acclTZ?: string
  violated?: boolean
  isLocalNightRest?: boolean
}

/** Serializable form stored in localStorage */
export interface StoredDutyEvent {
  id: string
  title: string
  start: string
  end: string
  type: DutyType
  acclTZ?: string
  violated?: boolean
  isLocalNightRest?: boolean
}

export interface AppSettings {
  theme: 'light' | 'dark'
  timeFormat: TimeFormat
  regulator: Regulator
  referenceTZ: string
  acclTZ: string
  lastSectors: number
  lastAvgSectorTime: AvgSectorTime
}

export const STORAGE_KEYS = {
  events: 'wiseduty.events.v1',
  /** Soft-deleted events held for undo / restore */
  deletedEvents: 'wiseduty.events.deleted.v1',
  theme: 'theme',
  timeFormat: 'timeFormat',
  regulator: 'regulator',
  referenceTZ: 'referenceTZ',
  acclTZ: 'lastAcclTZ',
  lastSectors: 'lastSectors',
  lastAvgSectorTime: 'lastAvgSectorTime',
} as const

export const MAX_WEEKLY_DUTY_HOURS = 60
