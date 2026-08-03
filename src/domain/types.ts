export type DutyType = 'duty' | 'rest' | 'reserve' | 'standby' | 'free'
export type TimeFormat = '24h' | '12h'
/** First column of the calendar month grid. */
export type WeekStartDay = 'sunday' | 'monday'
/** How import derives FDP report time from calendar events. */
export type ImportReportMode = 'auto' | 'buffers' | 'event_start'
export type Regulator = 'TC' | 'FAA' | 'EASA' | 'Australia'
export type AvgSectorTime = '<30' | '30-50' | '>=50'
export type RestType = '12h' | '10+travel'
/** CAR 700.29 time-free-from-duty option. */
export type TimeFreeOption = 'C' | 'D' | 'auto'

/**
 * User-facing event subtype for the Add Event form.
 * Maps onto regulatory {@link DutyType} via {@link eventKindToDutyType}.
 */
export type EventKind =
  | 'flight_duty'
  | 'airport_reserve'
  | 'airport_standby'
  | 'home_reserve'
  | 'home_standby'
  | 'simulator'
  | 'ground_school'
  | 'e_class'
  | 'free'

/** Form field keys that may apply to an event kind. */
export type EventFieldKey =
  | 'startEnd'
  | 'location'
  | 'flights'
  | 'reportRelease'
  | 'restType'
  | 'addFlightHandoff'
  | 'fdpSummary'

/**
 * Dropdown order by relevance (most common first).
 * Free time is not a user-created event type — empty calendar is free time;
 * CAR free blocks come only from “Suggest Free Time”.
 */
export const EVENT_KIND_ORDER: EventKind[] = [
  'flight_duty',
  'airport_reserve',
  'airport_standby',
  'home_reserve',
  'home_standby',
  'simulator',
  'ground_school',
  'e_class',
]

export function eventKindToDutyType(kind: EventKind): DutyType {
  switch (kind) {
    case 'flight_duty':
    case 'simulator':
    case 'ground_school':
    case 'e_class':
      return 'duty'
    case 'airport_reserve':
    case 'home_reserve':
      return 'reserve'
    case 'airport_standby':
    case 'home_standby':
      return 'standby'
    case 'free':
      return 'free'
  }
}

export function titleForEventKind(kind: EventKind): string {
  switch (kind) {
    case 'flight_duty':
      return 'Flight Duty'
    case 'airport_reserve':
      return 'Airport Reserve'
    case 'airport_standby':
      return 'Airport Standby'
    case 'home_reserve':
      return 'Home Reserve'
    case 'home_standby':
      return 'Home Standby'
    case 'simulator':
      return 'Simulator'
    case 'ground_school':
      return 'Ground School'
    case 'e_class':
      return 'E-Class'
    case 'free':
      return 'Time free from duty'
  }
}

/** Infer eventKind for legacy stored events that lack the field. */
export function inferEventKind(e: {
  type: DutyType
  eventKind?: EventKind
  flights?: unknown[]
}): EventKind {
  if (e.eventKind) return e.eventKind
  switch (e.type) {
    case 'duty':
      return e.flights && e.flights.length > 0 ? 'flight_duty' : 'flight_duty'
    case 'reserve':
      return 'home_reserve'
    case 'standby':
      return 'home_standby'
    case 'free':
      return 'free'
    case 'rest':
      return 'flight_duty' // rest is not user-created via Add Event
  }
}

export function fieldsForEventKind(kind: EventKind): Set<EventFieldKey> {
  switch (kind) {
    case 'flight_duty':
      return new Set([
        'startEnd',
        'flights',
        'reportRelease',
        'restType',
        'fdpSummary',
      ])
    case 'airport_reserve':
    case 'airport_standby':
      return new Set(['startEnd', 'location', 'addFlightHandoff'])
    case 'home_reserve':
    case 'home_standby':
      return new Set(['startEnd', 'addFlightHandoff'])
    case 'simulator':
    case 'ground_school':
    case 'e_class':
      return new Set(['startEnd', 'location', 'restType'])
    case 'free':
      return new Set(['startEnd'])
  }
}

export function isReserveOrStandbyKind(kind: EventKind): boolean {
  return (
    kind === 'airport_reserve' ||
    kind === 'airport_standby' ||
    kind === 'home_reserve' ||
    kind === 'home_standby'
  )
}

export function isNonFlightDutyKind(kind: EventKind): boolean {
  return (
    kind === 'simulator' ||
    kind === 'ground_school' ||
    kind === 'e_class'
  )
}

export function defaultWorkFactorForKind(kind: EventKind): number {
  return defaultWorkFactor(eventKindToDutyType(kind))
}

/** Airport row used by search / flight legs. */
export interface AirportRef {
  icao: string
  iata?: string
  name: string
  city?: string
  country?: string
  tz: string
}

/** One sector / leg inside an FDP (source of truth when present). */
export interface FlightLeg {
  id: string
  depIcao: string
  arrIcao: string
  dep: Date
  arr: Date
  isDeadhead: boolean
  /** Affects report buffer when this is the first leg. */
  customsPreclearance?: boolean
}

export interface StoredFlightLeg {
  id: string
  depIcao: string
  arrIcao: string
  dep: string
  arr: string
  isDeadhead: boolean
  customsPreclearance?: boolean
}

/**
 * Minutes before first dep / after last arr for auto report & release.
 * Configured in Settings.
 */
export interface DutyTimingBuffers {
  reportOperatingMin: number
  reportOperatingCustomsMin: number
  reportDeadheadMin: number
  reportDeadheadCustomsMin: number
  releaseOperatingMin: number
  releaseDeadheadMin: number
}

export const DEFAULT_DUTY_TIMING_BUFFERS: DutyTimingBuffers = {
  reportOperatingMin: 60,
  reportOperatingCustomsMin: 90,
  reportDeadheadMin: 45,
  reportDeadheadCustomsMin: 75,
  releaseOperatingMin: 15,
  releaseDeadheadMin: 15,
}

/** Regulatory rest classification for markers / alerts. */
export type RestRuleCode =
  | 'CAR 700.40'
  | 'CAR 700.41'
  | 'CAR 700.42(1)'
  | 'CAR 700.42(2)'
  | 'CAR 700.51'
  | 'CAR 700.29'
  | 'CAR 700.43'
  | 'CAR 700.50'

export type RestKind =
  | 'base'
  | 'lnr_disruptive'
  | 'tz_away'
  | 'tz_return_hours'
  | 'tz_return_lnr'
  | 'wocl_consecutive'
  | 'sdf_structure'
  | 'free_block'
  | 'positioning'
  /** Mid-FDP break in suitable accommodation (CAR 700.50) — still inside the FDP. */
  | 'split_break'

/**
 * Mid-FDP split-duty break (CAR 700.50). Times are the period in suitable
 * accommodation (travel to/from accommodation is excluded).
 */
export interface SplitDutyBreak {
  start: Date
  end: Date
  /** Suitable accommodation location (airport ICAO). */
  locationIcao?: string
  /** Force 50% credit — unforeseen replan after FDP begun (700.50(1)(c)). */
  unforeseenReplan?: boolean
}

export interface StoredSplitDutyBreak {
  start: string
  end: string
  locationIcao?: string
  unforeseenReplan?: boolean
}

export interface DutyEvent {
  id: string
  title: string
  start: Date
  end: Date
  type: DutyType
  /** User-facing subtype (airport reserve, simulator, etc.). */
  eventKind?: EventKind
  /** Airport ICAO when location applies (airport reserve/standby, sim, etc.). */
  locationIcao?: string
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
  /**
   * Operating sectors for CAR 700.28 table (excludes positioning / deadhead).
   * Stored per duty so rest recompute does not depend on later settings changes.
   */
  operatingSectors?: number
  /** Positioning / deadhead sectors (not counted in 700.28 table columns). */
  positioningSectors?: number
  /** Avg sector band used for max FDP at save time. */
  avgSectorTime?: AvgSectorTime
  /**
   * Duty ends with operator positioning after the last operating flight
   * (trailing deadhead). Enables CAR 700.43 when total duty exceeds max FDP.
   */
  endsWithPositioning?: boolean
  /**
   * Engines-off / end of last operating flight (start of post-FDP positioning).
   * Required for 700.43 when endsWithPositioning is true.
   */
  operatingEnd?: Date
  /**
   * Crew agreed to positioning that exceeds max FDP by more than 3 h (700.43(3)).
   */
  positioningAgreed?: boolean
  /** Flight legs (source of truth for flight-based FDP entry). */
  flights?: FlightLeg[]
  /** User overrode auto report (first dep − buffer). */
  reportOverridden?: boolean
  /** User overrode auto release (last arr + buffer). */
  releaseOverridden?: boolean
  /**
   * Mid-FDP split-duty break (CAR 700.50). Still part of this FDP; does not end
   * the duty. Extends max FDP and is excluded from hours of work.
   */
  splitBreak?: SplitDutyBreak
  /** Provenance when created via calendar import. */
  importSource?: {
    calendarId?: string
    eventIds?: string[]
    importedAt?: string
    reportSource?: string
  }
}

/** Serializable form stored in localStorage */
export interface StoredDutyEvent {
  id: string
  title: string
  start: string
  end: string
  type: DutyType
  eventKind?: EventKind
  locationIcao?: string
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
  operatingSectors?: number
  positioningSectors?: number
  avgSectorTime?: AvgSectorTime
  endsWithPositioning?: boolean
  operatingEnd?: string
  positioningAgreed?: boolean
  flights?: StoredFlightLeg[]
  reportOverridden?: boolean
  releaseOverridden?: boolean
  splitBreak?: StoredSplitDutyBreak
  importSource?: {
    calendarId?: string
    eventIds?: string[]
    importedAt?: string
    reportSource?: string
  }
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
  weekStartDay: WeekStartDay
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
  dutyTimingBuffers: DutyTimingBuffers
  /** Last selected device calendar id for import. */
  importCalendarId: string
  importCalendarName: string
  importReportMode: ImportReportMode
  importDefaultRangeDays: number
}

export const STORAGE_KEYS = {
  events: 'wiseduty.events.v1',
  /** Soft-deleted events held for undo / restore */
  deletedEvents: 'wiseduty.events.deleted.v1',
  theme: 'theme',
  timeFormat: 'timeFormat',
  weekStartDay: 'weekStartDay',
  regulator: 'regulator',
  referenceTZ: 'referenceTZ',
  acclTZ: 'lastAcclTZ',
  lastSectors: 'lastSectors',
  lastAvgSectorTime: 'lastAvgSectorTime',
  timeFreeOption: 'timeFreeOption',
  calendarTimeRef: 'calendarTimeRef',
  calendarDisplayTZ: 'calendarDisplayTZ',
  dutyTimingBuffers: 'dutyTimingBuffers',
  importCalendarId: 'importCalendarId',
  importCalendarName: 'importCalendarName',
  importReportMode: 'importReportMode',
  importDefaultRangeDays: 'importDefaultRangeDays',
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
