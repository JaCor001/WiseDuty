/**
 * Device calendar access port — EventKit / Android Calendar via Capacitor.
 * Web: not available (use iOS/Android app).
 */
import { Capacitor } from '@capacitor/core'
import type { ImportCalendarEvent } from '../domain/schedule-import'

export interface DeviceCalendarInfo {
  id: string
  title: string
  /** Platform display name when distinct from title. */
  displayName?: string
  isPrimary?: boolean
}

export type CalendarPermissionResult = 'granted' | 'denied' | 'prompt' | 'unavailable'

export interface CalendarAccess {
  isAvailable(): boolean
  platformLabel(): string
  checkPermission(): Promise<CalendarPermissionResult>
  requestPermission(): Promise<CalendarPermissionResult>
  listCalendars(): Promise<DeviceCalendarInfo[]>
  listEvents(opts: {
    /** Restrict by calendar display name when set. */
    calendarName?: string
    calendarId?: string
    start: Date
    end: Date
  }): Promise<ImportCalendarEvent[]>
}

function webAccess(): CalendarAccess {
  return {
    isAvailable: () => false,
    platformLabel: () => 'web',
    async checkPermission() {
      return 'unavailable'
    },
    async requestPermission() {
      return 'unavailable'
    },
    async listCalendars() {
      return []
    },
    async listEvents() {
      return []
    },
  }
}

function mapPerm(state: string | undefined): CalendarPermissionResult {
  if (state === 'granted') return 'granted'
  if (state === 'denied') return 'denied'
  if (state === 'prompt' || state === 'prompt-with-rationale') return 'prompt'
  return 'denied'
}

async function nativeAccess(): Promise<CalendarAccess> {
  const { Calendar } = await import('@capacitor/calendar')
  return {
    isAvailable: () => true,
    platformLabel: () => Capacitor.getPlatform(),
    async checkPermission() {
      const s = await Calendar.checkPermissions()
      return mapPerm(s.readCalendar)
    },
    async requestPermission() {
      const s = await Calendar.requestPermissions({
        permissions: ['readCalendar'],
      })
      return mapPerm(s.readCalendar)
    },
    async listCalendars() {
      const { calendars } = await Calendar.listCalendars()
      return (calendars || []).map((c) => ({
        id: c.id,
        title: c.name,
        displayName: c.displayName || c.name,
        isPrimary: c.isPrimary,
      }))
    },
    async listEvents(opts) {
      const { events } = await Calendar.findEvents({
        startDate: opts.start.getTime(),
        endDate: opts.end.getTime(),
        calendarName: opts.calendarName,
      })
      let list = events || []
      if (opts.calendarId) {
        list = list.filter((e) => e.calendarId === opts.calendarId)
      }
      return list.map((e) => ({
        id: e.id,
        calendarId: e.calendarId,
        title: e.title || '',
        notes: e.notes,
        location: e.location,
        start: new Date(e.startDate),
        end: new Date(e.endDate),
        allDay: !!e.isAllDay,
      }))
    },
  }
}

let cached: CalendarAccess | null = null

export async function getCalendarAccess(): Promise<CalendarAccess> {
  if (cached) return cached
  if (!Capacitor.isNativePlatform()) {
    cached = webAccess()
    return cached
  }
  try {
    cached = await nativeAccess()
    return cached
  } catch {
    cached = webAccess()
    return cached
  }
}

/** Reset cache (tests). */
export function resetCalendarAccessCache(): void {
  cached = null
}
