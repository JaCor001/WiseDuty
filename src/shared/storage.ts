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

export function loadDeletedEvents(): DutyEvent[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.deletedEvents)
    if (!raw) return []
    const parsed = JSON.parse(raw) as StoredDutyEvent[]
    if (!Array.isArray(parsed)) return []
    return deserializeEvents(parsed)
  } catch {
    return []
  }
}

export function saveDeletedEvents(events: DutyEvent[]): void {
  try {
    localStorage.setItem(
      STORAGE_KEYS.deletedEvents,
      JSON.stringify(serializeEvents(events)),
    )
  } catch {
    // ignore
  }
}

export function clearDeletedEvents(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.deletedEvents)
  } catch {
    // ignore
  }
}

/**
 * Soft-delete: remove matching events from active list and merge them into
 * the deleted bin (by id). Returns next active + deleted snapshots.
 */
export function softDeleteEvents(
  active: DutyEvent[],
  predicate: (e: DutyEvent) => boolean,
): { active: DutyEvent[]; deleted: DutyEvent[]; removedCount: number } {
  const removed = active.filter(predicate)
  const nextActive = active.filter((e) => !predicate(e))
  if (removed.length === 0) {
    return {
      active,
      deleted: loadDeletedEvents(),
      removedCount: 0,
    }
  }
  const byId = new Map(loadDeletedEvents().map((e) => [e.id, e]))
  for (const e of removed) byId.set(e.id, e)
  const nextDeleted = Array.from(byId.values())
  saveDeletedEvents(nextDeleted)
  return {
    active: nextActive,
    deleted: nextDeleted,
    removedCount: removed.length,
  }
}

/**
 * Restore all soft-deleted events into the active list (skip ids already present).
 */
export function restoreDeletedEvents(active: DutyEvent[]): {
  active: DutyEvent[]
  restoredCount: number
} {
  const deleted = loadDeletedEvents()
  if (deleted.length === 0) {
    return { active, restoredCount: 0 }
  }
  const existing = new Set(active.map((e) => e.id))
  const toAdd = deleted.filter((e) => !existing.has(e.id))
  clearDeletedEvents()
  return {
    active: [...active, ...toAdd],
    restoredCount: toAdd.length,
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
