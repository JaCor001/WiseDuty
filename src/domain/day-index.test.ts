import { describe, expect, it } from 'vitest'
import { buildEventsByDayKey, eventsOnDayKey } from './day-index'
import type { DutyEvent } from './types'
import { zonedWallTime } from './time'

const TZ = 'America/Toronto'

function duty(id: string, start: Date, end: Date): DutyEvent {
  return { id, title: 'D', type: 'duty', start, end, acclTZ: TZ }
}

describe('buildEventsByDayKey', () => {
  it('indexes single-day events', () => {
    const d = duty(
      'a',
      zonedWallTime(TZ, 2026, 6, 10, 8, 0),
      zonedWallTime(TZ, 2026, 6, 10, 16, 0),
    )
    const map = buildEventsByDayKey([d], TZ)
    expect(eventsOnDayKey(map, '2026-06-10').map((e) => e.id)).toEqual(['a'])
    expect(eventsOnDayKey(map, '2026-06-11')).toEqual([])
  })

  it('indexes multi-day events on each civil day', () => {
    const d = duty(
      'overnight',
      zonedWallTime(TZ, 2026, 6, 10, 22, 0),
      zonedWallTime(TZ, 2026, 6, 11, 6, 0),
    )
    const map = buildEventsByDayKey([d], TZ)
    expect(eventsOnDayKey(map, '2026-06-10').map((e) => e.id)).toEqual([
      'overnight',
    ])
    expect(eventsOnDayKey(map, '2026-06-11').map((e) => e.id)).toEqual([
      'overnight',
    ])
  })
})
