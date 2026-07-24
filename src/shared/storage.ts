import type { DutyEvent, StoredDutyEvent } from '../domain/types'
import { STORAGE_KEYS } from '../domain/types'
import { deserializeEvents, serializeEvents } from '../domain/events'

export function loadEvents(): DutyEvent[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.events)
    if (!raw) return []
    const parsed = JSON.parse(raw) as StoredDutyEvent[]
    if (!Array.isArray(parsed)) return []
    return deserializeEvents(parsed)
  } catch {
    return []
  }
}

export function saveEvents(events: DutyEvent[]): void {
  try {
    localStorage.setItem(
      STORAGE_KEYS.events,
      JSON.stringify(serializeEvents(events)),
    )
  } catch {
    // Quota or private mode — fail soft
  }
}

export function readString(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

export function writeString(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // ignore
  }
}
