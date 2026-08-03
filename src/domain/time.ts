/**
 * Timezone-safe helpers for duty calculations and display.
 */

export interface ZonedTimeParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  /** Minutes from local midnight in `tz` (0–1439). */
  minutesFromMidnight: number
  /** Calendar day key YYYY-MM-DD in `tz`. */
  dayKey: string
}

/**
 * Wall-clock parts of `date` in IANA timezone `tz`.
 * Used for ELN / LNR rules that must use acclimatized local time.
 */
export function getZonedTimeParts(date: Date, tz: string): ZonedTimeParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)

  const num = (type: Intl.DateTimeFormatPartTypes) => {
    const v = parts.find((p) => p.type === type)?.value
    return v != null ? parseInt(v, 10) : NaN
  }

  let hour = num('hour')
  // Some engines format midnight as "24"
  if (hour === 24) hour = 0
  const minute = num('minute')
  const year = num('year')
  const month = num('month')
  const day = num('day')
  const safeHour = Number.isFinite(hour) ? hour : 0
  const safeMinute = Number.isFinite(minute) ? minute : 0
  const safeYear = Number.isFinite(year) ? year : 1970
  const safeMonth = Number.isFinite(month) ? month : 1
  const safeDay = Number.isFinite(day) ? day : 1

  return {
    year: safeYear,
    month: safeMonth,
    day: safeDay,
    hour: safeHour,
    minute: safeMinute,
    minutesFromMidnight: safeHour * 60 + safeMinute,
    dayKey: `${String(safeYear).padStart(4, '0')}-${String(safeMonth).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`,
  }
}

/** Minutes from midnight (0–1439) of `date` in timezone `tz`. */
export function getMinutesInTZ(date: Date, tz: string): number {
  return getZonedTimeParts(date, tz).minutesFromMidnight
}

/**
 * UTC offset of IANA timezone `tz` at instant `date`, in minutes
 * (local = UTC + offset; e.g. America/Toronto EDT → -240).
 */
export function getUtcOffsetMinutes(date: Date, tz: string): number {
  const p = getZonedTimeParts(date, tz)
  // Treat wall-clock parts as UTC; difference from the real instant is the offset.
  const localAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0)
  const truncated = date.getTime() - (date.getTime() % 60_000)
  return (localAsUtc - truncated) / 60_000
}

/**
 * Absolute difference in hours between two IANA zones at the same instant.
 * Used for CAR 700.41(2) (>4 h local vs acclimatized).
 */
export function hoursBetweenTimeZones(
  tzA: string,
  tzB: string,
  at: Date,
): number {
  if (tzA === tzB) return 0
  const a = getUtcOffsetMinutes(at, tzA)
  const b = getUtcOffsetMinutes(at, tzB)
  return Math.abs(a - b) / 60
}

/**
 * Resolve the absolute instant when the wall clock in `tz` reads
 * `year-month-day hour:minute` (civil date in that zone).
 */
export function zonedWallTime(
  tz: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  // Iteratively correct a UTC guess so zoned parts match the target wall time.
  let utc = Date.UTC(year, month - 1, day, hour, minute, 0)
  for (let i = 0; i < 4; i++) {
    const g = getZonedTimeParts(new Date(utc), tz)
    const asIfUtc = Date.UTC(g.year, g.month - 1, g.day, g.hour, g.minute, 0)
    const target = Date.UTC(year, month - 1, day, hour, minute, 0)
    const delta = target - asIfUtc
    if (Math.abs(delta) < 500) break
    utc += delta
  }
  return new Date(utc)
}

/** Civil date of `around` in `tz`, plus `dayOffset` calendar days. */
export function zonedCivilDate(
  around: Date,
  tz: string,
  dayOffset = 0,
): { year: number; month: number; day: number; dayKey: string } {
  const p = getZonedTimeParts(around, tz)
  // Shift via UTC date arithmetic on the civil Y-M-D (not local browser).
  const shifted = new Date(Date.UTC(p.year, p.month - 1, p.day + dayOffset))
  const year = shifted.getUTCFullYear()
  const month = shifted.getUTCMonth() + 1
  const day = shifted.getUTCDate()
  return {
    year,
    month,
    day,
    dayKey: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  }
}

/**
 * Absolute instant of wall-clock `hour:minute` on the civil day of `around` in `tz`
 * (optionally offset by `dayOffset` civil days).
 */
export function zonedWallTimeOnDay(
  around: Date,
  tz: string,
  hour: number,
  minute: number,
  dayOffset = 0,
): Date {
  const d = zonedCivilDate(around, tz, dayOffset)
  return zonedWallTime(tz, d.year, d.month, d.day, hour, minute)
}

/**
 * First instant of local wall-clock `hour:minute` in `tz` that is strictly
 * after `from`, or at `from` when `inclusive` and it lands exactly on the wall time.
 */
export function nextZonedWallTime(
  from: Date,
  tz: string,
  hour: number,
  minute: number,
  inclusive = false,
): Date {
  const sameDay = zonedWallTimeOnDay(from, tz, hour, minute, 0)
  if (inclusive) {
    if (sameDay.getTime() >= from.getTime()) return sameDay
  } else if (sameDay.getTime() > from.getTime()) {
    return sameDay
  }
  return zonedWallTimeOnDay(from, tz, hour, minute, 1)
}

export function getHourInTZ(date: Date, tz: string): number {
  return getZonedTimeParts(date, tz).hour
}

/** Local calendar YYYY-MM-DD (avoids UTC shift from toISOString). */
export function toLocalDateInputValue(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Minutes from midnight for HH:mm, or null if invalid. */
export function parseHHmmToMinutes(timeHHmm: string): number | null {
  if (!timeHHmm || !timeHHmm.includes(':')) return null
  const [hs, ms] = timeHHmm.split(':')
  const h = Number(hs)
  const m = Number(ms)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  if (h < 0 || h > 23 || m < 0 || m > 59) return null
  return h * 60 + m
}

/** Add calendar days to a YYYY-MM-DD string (local civil arithmetic). */
export function addDaysToDateInputValue(dateYmd: string, days: number): string {
  const [y, mo, d] = dateYmd.split('-').map(Number)
  const dt = new Date(y, (mo || 1) - 1, (d || 1) + days)
  return toLocalDateInputValue(dt)
}

/**
 * Whole civil days from `fromYmd` to `toYmd` (positive if `to` is later).
 * Uses UTC noon-style date-only math to avoid DST edge cases.
 */
export function daysBetweenDateInputValues(
  fromYmd: string,
  toYmd: string,
): number {
  if (!fromYmd || !toYmd) return 0
  const [y1, m1, d1] = fromYmd.split('-').map(Number)
  const [y2, m2, d2] = toYmd.split('-').map(Number)
  if (![y1, m1, d1, y2, m2, d2].every(Number.isFinite)) return 0
  const a = Date.UTC(y1, (m1 || 1) - 1, d1 || 1)
  const b = Date.UTC(y2, (m2 || 1) - 1, d2 || 1)
  return Math.round((b - a) / (24 * 60 * 60 * 1000))
}

/** Parse YYYY-MM-DD into a local Date at local midnight. */
export function parseDateInputValue(dateYmd: string): Date | null {
  if (!dateYmd || !/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) return null
  const [y, mo, d] = dateYmd.split('-').map(Number)
  const dt = new Date(y, (mo || 1) - 1, d || 1)
  return isNaN(dt.getTime()) ? null : dt
}

/**
 * True when the end civil day is after the start civil day, or when the end
 * clock is before the start clock (overnight crossing midnight).
 */
export function isOvernightDutyPeriod(
  startDateYmd: string,
  startHHmm: string,
  endDateYmd: string,
  endHHmm: string,
): boolean {
  if (!startDateYmd || !endDateYmd) return false
  if (endDateYmd > startDateYmd) return true
  if (endDateYmd < startDateYmd) return false
  const sm = parseHHmmToMinutes(startHHmm)
  const em = parseHHmmToMinutes(endHHmm)
  if (sm == null || em == null) return false
  return em < sm
}

/**
 * If end clock is before start clock and end date is still the start day
 * (or empty), return the next calendar day YYYY-MM-DD for auto-adjust.
 * Otherwise null (no auto-change).
 */
export function overnightAutoEndDate(
  startDateYmd: string,
  startHHmm: string,
  endDateYmd: string,
  endHHmm: string,
): string | null {
  const sm = parseHHmmToMinutes(startHHmm)
  const em = parseHHmmToMinutes(endHHmm)
  if (sm == null || em == null || !startDateYmd) return null
  if (em >= sm) return null
  const effectiveEnd = endDateYmd || startDateYmd
  if (effectiveEnd > startDateYmd) return null // user already picked a later day
  return addDaysToDateInputValue(startDateYmd, 1)
}

/** Combine a calendar day + HH:mm into a local Date (no locale string parsing). */
export function combineLocalDateAndTime(day: Date, timeHHmm: string): Date {
  const [h, m] = timeHHmm.split(':').map(Number)
  return new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    h || 0,
    m || 0,
    0,
    0,
  )
}

/** Parse YYYY-MM-DD + HH:mm as local wall time. */
export function parseLocalDateTime(dateYmd: string, timeHHmm: string): Date {
  const [y, mo, d] = dateYmd.split('-').map(Number)
  const [h, m] = timeHHmm.split(':').map(Number)
  return new Date(y, (mo || 1) - 1, d || 1, h || 0, m || 0, 0, 0)
}

/**
 * Parse YYYY-MM-DD + HH:mm as wall clock in IANA zone `tz` → absolute instant.
 * Falls back to browser-local parse when `tz` is empty.
 */
export function parseZonedDateTime(
  dateYmd: string,
  timeHHmm: string,
  tz?: string | null,
): Date {
  if (!tz) return parseLocalDateTime(dateYmd, timeHHmm)
  const [y, mo, d] = dateYmd.split('-').map(Number)
  const [h, m] = timeHHmm.split(':').map(Number)
  return zonedWallTime(
    tz,
    y || 1970,
    mo || 1,
    d || 1,
    h || 0,
    m || 0,
  )
}

/** HH:mm wall clock of `date` in IANA zone `tz`. */
export function formatHHmmInTZ(date: Date, tz: string): string {
  const p = getZonedTimeParts(date, tz)
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`
}

/** YYYY-MM-DD civil date of `date` in IANA zone `tz`. */
export function toDateInputValueInTZ(date: Date, tz: string): string {
  return getZonedTimeParts(date, tz).dayKey
}

/** Start of civil day (00:00) in `tz` that contains `date` (as absolute instant). */
export function startOfDayInTimeZone(date: Date, tz: string): Date {
  const p = getZonedTimeParts(date, tz)
  return zonedWallTime(tz, p.year, p.month, p.day, 0, 0)
}

/** Start of civil day for a YYYY-MM-DD key in `tz`. */
export function startOfDayKeyInTimeZone(dayKey: string, tz: string): Date {
  const [y, mo, d] = dayKey.split('-').map(Number)
  return zonedWallTime(tz, y || 1970, mo || 1, d || 1, 0, 0)
}

/** Add civil days in `tz` to a day-start instant (or any instant → its civil day). */
export function addCivilDaysInTimeZone(
  date: Date,
  tz: string,
  days: number,
): Date {
  const p = getZonedTimeParts(date, tz)
  const shifted = new Date(Date.UTC(p.year, p.month - 1, p.day + days))
  return zonedWallTime(
    tz,
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
    0,
    0,
  )
}

/** Device IANA time zone (fallback UTC). */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export function formatTimeDisplay(
  timeHHmm: string,
  timeFormat: '24h' | '12h',
): string {
  if (!timeHHmm) return ''
  const parts = timeHHmm.split(':').map(Number)
  const h = parts[0]
  const m = parts[1] ?? 0
  if (!Number.isFinite(h) || !Number.isFinite(m)) return ''
  if (timeFormat === '12h') {
    const period = h >= 12 ? 'PM' : 'AM'
    const hour = h % 12 || 12
    return `${hour}:${String(m).padStart(2, '0')} ${period}`
  }
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/**
 * Parse free-typed time into 24h `HH:mm`.
 * Accepts: 2030, 20:30, 8:30pm, 0930am, 930a, 20, 8pm, etc.
 * Digits 13–23 without am/pm are treated as 24h hours (e.g. 20 → 20:00 → 8:00 PM in 12h UI).
 */
export function parseFlexibleTime(input: string): string | null {
  if (!input || !input.trim()) return null

  let s = input.trim().toLowerCase()
  // Normalize separators and common typos
  s = s
    .replace(/[.\-]/g, ':')
    .replace(/\s+/g, '')
    .replace(/a\.?m\.?/g, 'am')
    .replace(/p\.?m\.?/g, 'pm')

  let meridiem: 'am' | 'pm' | null = null
  if (s.endsWith('am')) {
    meridiem = 'am'
    s = s.slice(0, -2)
  } else if (s.endsWith('pm')) {
    meridiem = 'pm'
    s = s.slice(0, -2)
  } else if (s.endsWith('a') && !/\d$/.test(s.slice(0, -1))) {
    // bare "a" only if not part of digits — skip
  } else if (/(?:^|[^0-9])a$/.test(s) || s.endsWith('a')) {
    // "930a" or "9a"
    if (s.endsWith('a') && s.length > 1 && /\d/.test(s)) {
      meridiem = 'am'
      s = s.slice(0, -1)
    }
  }
  if (s.endsWith('p') && s.length > 1 && /\d/.test(s.slice(0, -1))) {
    meridiem = 'pm'
    s = s.slice(0, -1)
  }

  // Strip remaining non-digit except colon
  s = s.replace(/[^0-9:]/g, '')
  if (!s) return null

  let hours: number
  let minutes: number

  if (s.includes(':')) {
    const [hs, ms = '0'] = s.split(':')
    if (!hs) return null
    hours = parseInt(hs, 10)
    // "8:3" → 8:30; "8:30" → 8:30; "8:03" → 8:03
    if (ms.length === 1) minutes = parseInt(ms, 10) * 10
    else minutes = parseInt(ms.slice(0, 2), 10)
  } else {
    if (!/^\d{1,4}$/.test(s)) return null
    if (s.length <= 2) {
      hours = parseInt(s, 10)
      minutes = 0
    } else if (s.length === 3) {
      // 930 → 9:30
      hours = parseInt(s.slice(0, 1), 10)
      minutes = parseInt(s.slice(1), 10)
    } else {
      // 4 digits: 0930 / 2030
      hours = parseInt(s.slice(0, 2), 10)
      minutes = parseInt(s.slice(2), 10)
    }
  }

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
  if (minutes < 0 || minutes > 59) return null

  if (meridiem) {
    // Explicit am/pm: hour is 1–12 (0 → 12)
    if (hours === 0) hours = 12
    if (hours < 1 || hours > 12) {
      // "20pm" etc. — fall back to 24h hour if valid
      if (hours > 23) return null
      // keep 13–23 as 24h and ignore conflicting meridiem for digit-only intent
    } else if (meridiem === 'am') {
      hours = hours === 12 ? 0 : hours
    } else {
      hours = hours === 12 ? 12 : hours + 12
    }
  } else if (hours < 0 || hours > 23) {
    return null
  }

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

/** Placeholder hint for free time entry (kept short for narrow columns). */
export function timeInputPlaceholder(timeFormat: '24h' | '12h'): string {
  return timeFormat === '12h' ? '830pm' : '20:30'
}

/**
 * Zulu (UTC) display for a civil day + HH:mm interpreted in `sourceTZ`
 * (empty/null → browser local).
 */
export function getZuluTimeDisplay(
  timeHHmm: string,
  day: Date | null,
  timeFormat: '24h' | '12h',
  sourceTZ?: string | null,
): string {
  if (!timeHHmm || !day || isNaN(day.getTime())) return ''
  const dayKey = sourceTZ
    ? toDateInputValueInTZ(day, sourceTZ)
    : toLocalDateInputValue(day)
  const instant = parseZonedDateTime(dayKey, timeHHmm, sourceTZ || undefined)
  if (isNaN(instant.getTime())) return ''
  const utcH = instant.getUTCHours()
  const utcM = instant.getUTCMinutes()
  const hhmm = `${String(utcH).padStart(2, '0')}:${String(utcM).padStart(2, '0')}`
  return formatTimeDisplay(hhmm, timeFormat)
}

export interface TimeZoneOption {
  value: string
  label: string
}

export function getTimeZonesWithOffsets(): TimeZoneOption[] {
  const timeZones = Intl.supportedValuesOf('timeZone')
  const now = new Date()
  return timeZones
    .map((tz) => {
      const offset =
        new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          timeZoneName: 'shortOffset',
        })
          .formatToParts(now)
          .find((part) => part.type === 'timeZoneName')?.value || '+00:00'

      const displayName = tz.replace(/_/g, ' ').replace(/\//g, ' / ')
      return {
        value: tz,
        label: `${displayName} (${offset})`,
      }
    })
    .sort((a, b) => a.label.localeCompare(b.label))
}

export function filterTimeZones(
  zones: TimeZoneOption[],
  searchText: string,
): TimeZoneOption[] {
  if (!searchText) return zones
  const q = searchText.toLowerCase()
  return zones.filter(
    (tz) =>
      tz.label.toLowerCase().includes(q) || tz.value.toLowerCase().includes(q),
  )
}

export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

/** HH:mm from a Date's local wall-clock components. */
export function formatHHmm(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** Fraction of a local day [0, 24) for positioning on a day grid. */
export function localTimeOfDayHours(date: Date): number {
  return date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600
}

/**
 * Position a bar within a calendar day cell.
 * `dayStart`/`dayEnd` are absolute instants (civil day bounds in the display TZ).
 * Uses elapsed time so DST days and non-browser time zones position correctly.
 */
export function dayBarPosition(
  eventStart: Date,
  eventEnd: Date,
  dayStart: Date,
  dayEnd: Date,
): { left: number; width: number } {
  const dayMs = dayEnd.getTime() - dayStart.getTime()
  if (dayMs <= 0) return { left: 0, width: 0 }

  const clipStart = Math.max(eventStart.getTime(), dayStart.getTime())
  const clipEnd = Math.min(eventEnd.getTime(), dayEnd.getTime())
  if (clipEnd <= clipStart) return { left: 0, width: 0 }

  const left = ((clipStart - dayStart.getTime()) / dayMs) * 100
  const width = ((clipEnd - clipStart) / dayMs) * 100
  return {
    left: Math.max(0, Math.min(100, left)),
    width: Math.max(0, Math.min(100 - left, width)),
  }
}
