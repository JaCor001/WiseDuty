export type DutyType = 'duty' | 'rest'
export type TimeFormat = '24h' | '12h'
export type Regulator = 'TC' | 'FAA' | 'EASA' | 'Australia'
export type AvgSectorTime = '<30' | '30-50' | '>=50'
export type RestType = '12h' | '10+travel'

/** Regulatory rest classification for markers / alerts. */
export type RestRuleCode =
  | 'CAR 700.40'
  | 'CAR 700.41'
  | 'CAR 700.42(1)'
  | 'CAR 700.42(2)'
  | 'CAR 700.51'

export type RestKind =
  | 'base'
  | 'lnr_disruptive'
  | 'tz_away'
  | 'tz_return_hours'
  | 'tz_return_lnr'
  | 'wocl_consecutive'

export interface DutyEvent {
  id: string
  title: string
  start: Date
  end: Date
  type: DutyType
  /** Acclimatized time zone for E/L/N and LNR window evaluation. */
  acclTZ?: string
  /** Local time zone where the FDP began (report location). Defaults to acclTZ. */
  startTZ?: string
  /** Local time zone where the FDP ended (release location). Defaults to acclTZ. */
  endTZ?: string
  violated?: boolean
  isLocalNightRest?: boolean
  /** How this rest was derived (rest events). */
  restKind?: RestKind
  restRule?: RestRuleCode
  /** Planned minimum clock rest hours (rest events). */
  requiredRestHours?: number
  /** Planned local nights under 700.42(2) (1–3). */
  requiredLocalNights?: number
  /** Free-text why this rest/rule applies (stored for marker/rest details). */
  ruleWhy?: string
}

/** Serializable form stored in localStorage */
export interface StoredDutyEvent {
  id: string
  title: string
  start: string
  end: string
  type: DutyType
  acclTZ?: string
  startTZ?: string
  endTZ?: string
  violated?: boolean
  isLocalNightRest?: boolean
  restKind?: RestKind
  restRule?: RestRuleCode
  requiredRestHours?: number
  requiredLocalNights?: number
  ruleWhy?: string
}

export interface AppSettings {
  theme: 'light' | 'dark'
  timeFormat: TimeFormat
  regulator: Regulator
  /** Home base time zone (CAR 700.42). */
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
