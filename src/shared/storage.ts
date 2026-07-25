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

/** Pure: split active list by predicate without touching storage. */
export function partitionEvents(
  active: DutyEvent[],
  predicate: (e: DutyEvent) => boolean,
): { kept: DutyEvent[]; removed: DutyEvent[] } {
  const kept: DutyEvent[] = []
  const removed: DutyEvent[] = []
  for (const e of active) {
    if (predicate(e)) removed.push(e)
    else kept.push(e)
  }
  return { kept, removed }
}

/** Pure: merge removed into an existing deleted bin by id. */
export function mergeIntoDeletedBin(
  existingDeleted: DutyEvent[],
  removed: DutyEvent[],
): DutyEvent[] {
  const byId = new Map(existingDeleted.map((e) => [e.id, e]))
  for (const e of removed) byId.set(e.id, e)
  return Array.from(byId.values())
}

/** Pure: merge deleted events into active (skip ids already present). */
export function mergeRestoredEvents(
  active: DutyEvent[],
  deleted: DutyEvent[],
): DutyEvent[] {
  if (deleted.length === 0) return active
  const existing = new Set(active.map((e) => e.id))
  const toAdd = deleted.filter((e) => !existing.has(e.id))
  return toAdd.length === 0 ? active : [...active, ...toAdd]
}

/**
 * Soft-delete with storage I/O. Safe to call once from an event handler
 * (not from inside a setState updater — React may run those twice).
 */
export function softDeleteEvents(
  active: DutyEvent[],
  predicate: (e: DutyEvent) => boolean,
): { active: DutyEvent[]; deleted: DutyEvent[]; removedCount: number } {
  const { kept, removed } = partitionEvents(active, predicate)
  if (removed.length === 0) {
    return {
      active,
      deleted: loadDeletedEvents(),
      removedCount: 0,
    }
  }
  const nextDeleted = mergeIntoDeletedBin(loadDeletedEvents(), removed)
  saveDeletedEvents(nextDeleted)
  return {
    active: kept,
    deleted: nextDeleted,
    removedCount: removed.length,
  }
}

/**
 * Restore with storage I/O. Call once from an event handler, not from setState.
 */
export function restoreDeletedEvents(active: DutyEvent[]): {
  active: DutyEvent[]
  restoredCount: number
} {
  const deleted = loadDeletedEvents()
  if (deleted.length === 0) {
    return { active, restoredCount: 0 }
  }
  const next = mergeRestoredEvents(active, deleted)
  clearDeletedEvents()
  return {
    active: next,
    restoredCount: deleted.length,
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
