import { describe, expect, it } from 'vitest'
import {
  maybeBuildLnrBetween,
  recomputeLocalNightRests,
  stripAllLnr,
} from './events'
import type { DutyEvent } from './types'
import { zonedWallTime } from './time'

const TZ = 'UTC'

function at(y: number, mo: number, d: number, h: number, mi = 0): Date {
  return zonedWallTime(TZ, y, mo, d, h, mi)
}

function duty(id: string, start: Date, end: Date): DutyEvent {
  return { id, title: 'Duty', start, end, type: 'duty', acclTZ: TZ }
}

describe('maybeBuildLnrBetween / recomputeLocalNightRests', () => {
  it('builds LNR for Late → Early (not only Night → Early)', () => {
    const late = duty('l', at(2024, 6, 10, 18, 0), at(2024, 6, 11, 1, 0))
    const early = duty('e', at(2024, 6, 11, 5, 0), at(2024, 6, 11, 12, 0))
    const lnr = maybeBuildLnrBetween(late, early, 'TC', TZ, [late, early])
    expect(lnr).not.toBeNull()
    expect(lnr!.isLocalNightRest).toBe(true)
    // Short gap → violated
    expect(lnr!.violated).toBe(true)
    expect(lnr!.title).toMatch(/not met/i)
    expect(lnr!.title).toMatch(/700\.4/)
  })

  it('labels compliant LNR without violation wording', () => {
    const night = duty('n', at(2024, 6, 10, 22, 0), at(2024, 6, 11, 6, 0))
    const early = duty('e', at(2024, 6, 13, 5, 0), at(2024, 6, 13, 12, 0))
    const lnr = maybeBuildLnrBetween(night, early, 'TC', TZ, [night, early])
    expect(lnr).not.toBeNull()
    expect(lnr!.violated).toBe(false)
    expect(lnr!.title).toBe('Local Night Rest (CAR 700.41)')
  })

  it('builds LNR for Early → Night', () => {
    const early = duty('e', at(2024, 6, 10, 5, 0), at(2024, 6, 10, 12, 0))
    const night = duty('n', at(2024, 6, 10, 22, 0), at(2024, 6, 11, 6, 0))
    const lnr = maybeBuildLnrBetween(early, night, 'TC', TZ, [early, night])
    expect(lnr).not.toBeNull()
  })

  it('does not build LNR for normal day → day', () => {
    const a = duty('a', at(2024, 6, 10, 9, 0), at(2024, 6, 10, 15, 0))
    const b = duty('b', at(2024, 6, 11, 9, 0), at(2024, 6, 11, 15, 0))
    expect(maybeBuildLnrBetween(a, b, 'TC', TZ, [a, b])).toBeNull()
  })

  it('recomputes all LNRs and replaces stale ones', () => {
    // Night ends day 11 06:00; Early day 13 05:00 leaves a full 22:30–09:30 window (≥9h LNR).
    // (A next-morning Early cannot fit 9h inside 22:30–09:30 before 07:00 — correct TC math.)
    const night = duty('n', at(2024, 6, 10, 22, 0), at(2024, 6, 11, 6, 0))
    const early = duty('e', at(2024, 6, 13, 5, 0), at(2024, 6, 13, 12, 0))
    const withStale: DutyEvent[] = [
      night,
      early,
      {
        id: 'stale-lnr',
        title: 'Local Night Rest',
        start: night.end,
        end: early.start,
        type: 'rest',
        isLocalNightRest: true,
        violated: true,
      },
    ]
    const next = recomputeLocalNightRests(withStale, 'TC', TZ)
    const lnrs = next.filter((e) => e.isLocalNightRest)
    expect(lnrs).toHaveLength(1)
    expect(lnrs[0].id).not.toBe('stale-lnr')
    expect(lnrs[0].violated).toBe(false)
    expect(stripAllLnr(next).every((e) => !e.isLocalNightRest)).toBe(true)
  })
})
