export type DutyType = 'duty' | 'rest' | 'reserve' | 'standby' | 'free'
export type TimeFormat = '24h' | '12h'
export type Regulator = 'TC' | 'FAA' | 'EASA' | 'Australia'
export type AvgSectorTime = '<30' | '30-50' | '>=50'
export type RestType = '12h' | '10+travel'
/** CAR 700.29 time-free-from-duty option. */
export type TimeFreeOption = 'C' | 'D' | 'auto'

/** Regulatory rest classification for markers / alerts. */
export type RestRuleCode =
  | 'CAR 700.40'
  | 'CAR 700.41'
  | 'CAR 700.42(1)'
  | 'CAR 700.42(2)'
  | 'CAR 700.51'
  | 'CAR 700.29'

export type RestKind =
  | 'base'
  | 'lnr_disruptive'
  | 'tz_away'
  | 'tz_return_hours'
  | 'tz_return_lnr'
  | 'wocl_consecutive'
  | 'sdf_structure'
  | 'free_block'

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
  /**
   * User-selected base rest option used when building this rest (12h vs 10+travel).
   * Preserved across full schedule recomputes so mid-trip inserts do not reset preferences.
   */
  baseRestType?: RestType
  /**
   * Factor toward hours of work (CAR 700.29(3)).
   * Defaults: duty/standby 1.0, reserve 0.33, rest/free 0.
   */
  workFactor?: number
  /** Auto-scheduled free block purpose. */
  freePurpose?: 'sdf' | 'five_lnr_block' | 'manual'
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
  baseRestType?: RestType
  workFactor?: number
  freePurpose?: 'sdf' | 'five_lnr_block' | 'manual'
}

/**
 * How calendar day cells / event bars are laid out in time.
 * - zulu: UTC
 * - device: browser/device local IANA zone
 * - home: account home base (referenceTZ)
 * - custom: user-picked IANA zone (calendarDisplayTZ)
 */
export type CalendarTimeReference = 'zulu' | 'device' | 'home' | 'custom'

export interface AppSettings {
  theme: 'light' | 'dark'
  timeFormat: TimeFormat
  regulator: Regulator
  /** Home base time zone (CAR 700.42). */
  referenceTZ: string
  acclTZ: string
  lastSectors: number
  lastAvgSectorTime: AvgSectorTime
  timeFreeOption: TimeFreeOption
  /** Calendar grid / bar time reference mode. */
  calendarTimeRef: CalendarTimeReference
  /** IANA zone when calendarTimeRef === 'custom'. */
  calendarDisplayTZ: string
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
  timeFreeOption: 'timeFreeOption',
  calendarTimeRef: 'calendarTimeRef',
  calendarDisplayTZ: 'calendarDisplayTZ',
} as const

export const MAX_WEEKLY_DUTY_HOURS = 60

/** Default work factor for hours-of-work counting (CAR 700.29(3)). */
export function defaultWorkFactor(type: DutyType): number {
  if (type === 'reserve') return 0.33
  if (type === 'duty' || type === 'standby') return 1
  return 0
}

/** Events that count as "on duty" for free-time gaps (break free intervals). */
export function isWorkEvent(e: { type: DutyType }): boolean {
  return e.type === 'duty' || e.type === 'reserve' || e.type === 'standby'
}
