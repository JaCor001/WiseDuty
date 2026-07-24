/**
 * Timezone-safe helpers for duty calculations and display.
 */

export function getHourInTZ(date: Date, tz: string): number {
  const raw = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    hour12: false,
  }).format(date)
  const hour = parseInt(raw, 10)
  // Some engines format midnight as "24"
  if (hour === 24) return 0
  return Number.isFinite(hour) ? hour : 0
}

/** Local calendar YYYY-MM-DD (avoids UTC shift from toISOString). */
export function toLocalDateInputValue(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
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

export function formatTimeDisplay(
  timeHHmm: string,
  timeFormat: '24h' | '12h',
): string {
  if (!timeHHmm) return ''
  if (timeFormat === '12h') {
    const [h, m] = timeHHmm.split(':').map(Number)
    const period = h >= 12 ? 'PM' : 'AM'
    const hour = h % 12 || 12
    return `${hour}:${String(m).padStart(2, '0')} ${period}`
  }
  return timeHHmm
}

/** True Zulu (UTC) display for a local day + HH:mm. */
export function getZuluTimeDisplay(
  timeHHmm: string,
  day: Date | null,
  timeFormat: '24h' | '12h',
): string {
  if (!timeHHmm || !day || isNaN(day.getTime())) return ''
  const local = combineLocalDateAndTime(day, timeHHmm)
  const utcH = local.getUTCHours()
  const utcM = local.getUTCMinutes()
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
 * Position a bar within a local calendar day.
 * Returns left/width as percentages of the day cell.
 */
export function dayBarPosition(
  eventStart: Date,
  eventEnd: Date,
  dayStart: Date,
  dayEnd: Date,
): { left: number; width: number } {
  const isStart = eventStart >= dayStart && eventStart < dayEnd
  const isEnd = eventEnd > dayStart && eventEnd <= dayEnd
  let left = 0
  let width = 100

  if (isStart && !isEnd) {
    left = (localTimeOfDayHours(eventStart) / 24) * 100
    width = 100 - left
  } else if (isEnd && !isStart) {
    const endHours =
      eventEnd.getTime() === dayStart.getTime()
        ? 0
        : eventEnd.getTime() === dayEnd.getTime()
          ? 24
          : localTimeOfDayHours(eventEnd) || 24
    width = (endHours / 24) * 100
  } else if (isStart && isEnd) {
    const startH = localTimeOfDayHours(eventStart)
    let endH = localTimeOfDayHours(eventEnd)
    if (eventEnd.getTime() === dayEnd.getTime()) endH = 24
    if (endH === 0 && eventEnd > eventStart) endH = 24
    left = (startH / 24) * 100
    width = ((endH - startH) / 24) * 100
  }

  return {
    left: Math.max(0, Math.min(100, left)),
    width: Math.max(0, Math.min(100 - left, width)),
  }
}
