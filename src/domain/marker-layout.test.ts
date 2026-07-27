import { describe, expect, it } from 'vitest'
import {
  buildPreferredHostMap,
  dayContentMinRem,
  isHostDayFor,
  isPreferredMarkerDay,
  markerBandTiers,
  markerVerticalRole,
  preferredMarkerHostDayStartMs,
  preferredMarkerLeftPct,
  preferredMarkerTopPct,
  resolveMarkerOverlaps,
  type MarkerLayoutInput,
  type ResolvedMarkerLayout,
} from './marker-layout'
import { startOfDayInTimeZone, startOfLocalDay } from './time'

describe('markerVerticalRole', () => {
  it('places E/L/N above the bar', () => {
    expect(markerVerticalRole('E')).toBe('above')
    expect(markerVerticalRole('L')).toBe('above')
    expect(markerVerticalRole('N')).toBe('above')
  })

  it('places rest markers below the bar', () => {
    expect(markerVerticalRole('RR')).toBe('below')
    expect(markerVerticalRole('LNR')).toBe('below')
    expect(markerVerticalRole('LNR2')).toBe('below')
    expect(markerVerticalRole('SDF')).toBe('below')
  })
})

describe('preferredMarkerLeftPct', () => {
  it('anchors start / end / center and clamps to cell with edge gap', () => {
    expect(preferredMarkerLeftPct(10, 40, 10, 'start', 2)).toBeCloseTo(10)
    expect(preferredMarkerLeftPct(10, 40, 10, 'end', 2)).toBeCloseTo(40)
    expect(preferredMarkerLeftPct(10, 40, 10, 'center', 2)).toBeCloseTo(25)
    // clamp left edge
    expect(preferredMarkerLeftPct(0, 5, 20, 'start', 2)).toBeCloseTo(2)
    // end-anchored near right edge — full chip stays inside gap
    expect(preferredMarkerLeftPct(90, 10, 20, 'end', 4)).toBeCloseTo(76)
    // start-anchored at 0 with gap
    expect(preferredMarkerLeftPct(0, 30, 18, 'start', 5)).toBeCloseTo(5)
  })
})

describe('preferredMarkerTopPct', () => {
  it('puts above markers over the bar and below under it with a clear gap', () => {
    const barTop = 46
    const barH = 10
    const chipH = 12
    const above = preferredMarkerTopPct('above', barTop, barH, chipH, 4, 4, 96)
    const below = preferredMarkerTopPct('below', barTop, barH, chipH, 4, 4, 96)
    // Clearance above: chip bottom ends before bar top
    expect(above + chipH).toBeLessThan(barTop)
    // Clearance below: chip top starts after bar bottom
    expect(below).toBeGreaterThan(barTop + barH)
    // Symmetric-ish gap on both sides of the bar
    const gapAbove = barTop - (above + chipH)
    const gapBelow = below - (barTop + barH)
    expect(gapAbove).toBeGreaterThanOrEqual(2)
    expect(gapBelow).toBeGreaterThanOrEqual(2)
    expect(Math.abs(gapAbove - gapBelow)).toBeLessThan(0.1)
  })
})

describe('resolveMarkerOverlaps', () => {
  const base = (
    partial: Partial<MarkerLayoutInput> & Pick<MarkerLayoutInput, 'id' | 'role'>,
  ): MarkerLayoutInput => ({
    preferredTopPct: 30,
    leftPct: 50,
    widthPct: 20,
    heightPct: 12,
    barTopPct: 46,
    barHPct: 4,
    barAttachXPct: 60,
    ...partial,
  })

  it('leaves non-overlapping markers at preferred tops', () => {
    const resolved = resolveMarkerOverlaps(
      [
        base({ id: 'a', role: 'above', leftPct: 10, preferredTopPct: 20 }),
        base({ id: 'b', role: 'above', leftPct: 60, preferredTopPct: 20 }),
      ],
      { gapPct: 2, minTopPct: 4, maxBottomPct: 96 },
    )
    expect(resolved[0].topPct).toBeCloseTo(20)
    expect(resolved[1].topPct).toBeCloseTo(20)
    expect(resolved[0].leader).toBeUndefined()
    expect(resolved[1].leader).toBeUndefined()
  })

  it('stacks L+N style chips vertically while keeping left', () => {
    const resolved = resolveMarkerOverlaps(
      [
        base({
          id: 'L',
          role: 'above',
          leftPct: 70,
          preferredTopPct: 28,
          barAttachXPct: 80,
        }),
        base({
          id: 'N',
          role: 'above',
          leftPct: 70,
          preferredTopPct: 28,
          barAttachXPct: 80,
        }),
      ],
      { gapPct: 2, minTopPct: 4, maxBottomPct: 96, leaderThresholdPct: 3 },
    )
    expect(resolved[0].leftPct).toBe(70)
    expect(resolved[1].leftPct).toBe(70)
    expect(Math.abs(resolved[0].topPct - resolved[1].topPct)).toBeGreaterThan(
      10,
    )
    // At least one should be displaced enough for a leader
    const leaders = resolved.filter((r) => r.leader)
    expect(leaders.length).toBeGreaterThanOrEqual(1)
  })

  it('resolves above and below bands independently', () => {
    const resolved = resolveMarkerOverlaps(
      [
        base({
          id: 'N',
          role: 'above',
          leftPct: 50,
          preferredTopPct: 28,
        }),
        base({
          id: 'RR',
          role: 'below',
          leftPct: 50,
          preferredTopPct: 55,
        }),
      ],
      { gapPct: 2, minTopPct: 4, maxBottomPct: 96 },
    )
    expect(resolved.find((r) => r.id === 'N')!.topPct).toBeCloseTo(28)
    expect(resolved.find((r) => r.id === 'RR')!.topPct).toBeCloseTo(55)
  })

  it('stacks below-band rest markers downward', () => {
    const resolved = resolveMarkerOverlaps(
      [
        base({
          id: 'RR',
          role: 'below',
          leftPct: 40,
          preferredTopPct: 55,
        }),
        base({
          id: 'LNR',
          role: 'below',
          leftPct: 42,
          preferredTopPct: 55,
          widthPct: 22,
        }),
      ],
      { gapPct: 2, minTopPct: 4, maxBottomPct: 96, leaderThresholdPct: 3 },
    )
    const tops = resolved.map((r) => r.topPct).sort((a, b) => a - b)
    expect(tops[1] - tops[0]).toBeGreaterThan(10)
  })
})

describe('markerBandTiers + dayContentMinRem', () => {
  const resolved = (
    items: Array<Pick<ResolvedMarkerLayout, 'id' | 'role' | 'topPct'>>,
  ): ResolvedMarkerLayout[] =>
    items.map((m) => ({
      leftPct: 50,
      widthPct: 20,
      heightPct: 12,
      ...m,
    }))

  it('counts tiers for empty, single, and stacked bands', () => {
    expect(markerBandTiers(resolved([]), 'above')).toBe(0)
    expect(
      markerBandTiers(
        resolved([{ id: 'E', role: 'above', topPct: 28 }]),
        'above',
      ),
    ).toBe(1)
    expect(
      markerBandTiers(
        resolved([
          { id: 'L', role: 'above', topPct: 14 },
          { id: 'N', role: 'above', topPct: 28 },
        ]),
        'above',
      ),
    ).toBe(2)
  })

  it('sizes empty days low and grows only with real structure', () => {
    const empty = dayContentMinRem({
      hasBar: false,
      aboveTiers: 0,
      belowTiers: 0,
    })
    const barOnly = dayContentMinRem({
      hasBar: true,
      aboveTiers: 0,
      belowTiers: 0,
    })
    const single = dayContentMinRem({
      hasBar: true,
      aboveTiers: 1,
      belowTiers: 1,
    })
    const stacked = dayContentMinRem({
      hasBar: true,
      aboveTiers: 2,
      belowTiers: 1,
    })
    expect(empty).toBe(2.75)
    expect(barOnly).toBeGreaterThan(empty)
    expect(single).toBeGreaterThan(barOnly)
    expect(stacked).toBeGreaterThan(single)
    expect(stacked).toBeLessThanOrEqual(6.25)
  })
})

describe('isPreferredMarkerDay', () => {
  const day = (y: number, m: number, d: number) => {
    const s = startOfLocalDay(new Date(y, m - 1, d, 12, 0, 0))
    const e = new Date(s)
    e.setDate(e.getDate() + 1)
    return { s, e }
  }

  it('shows same-day rest on that day only', () => {
    const { s, e } = day(2024, 6, 10)
    const start = new Date(2024, 5, 10, 10, 0, 0)
    const end = new Date(2024, 5, 10, 20, 0, 0)
    expect(isPreferredMarkerDay(start, end, s, e)).toBe(true)
    const next = day(2024, 6, 11)
    expect(isPreferredMarkerDay(start, end, next.s, next.e)).toBe(false)
  })

  it('picks the widest multi-day segment (not the midnight sliver)', () => {
    // Rest 10 Jun 14:00 → 11 Jun 02:00
    const start = new Date(2024, 5, 10, 14, 0, 0)
    const end = new Date(2024, 5, 11, 2, 0, 0)
    const d10 = day(2024, 6, 10)
    const d11 = day(2024, 6, 11)
    // 10th has 14:00–24:00 = ~42%; 11th has 00:00–02:00 = ~8% sliver
    expect(isPreferredMarkerDay(start, end, d10.s, d10.e)).toBe(true)
    expect(isPreferredMarkerDay(start, end, d11.s, d11.e)).toBe(false)
  })

  it('picks full middle day over partial start/end for long rest', () => {
    // Mon 20:00 → Wed 08:00
    const start = new Date(2024, 5, 10, 20, 0, 0) // Mon
    const end = new Date(2024, 5, 12, 8, 0, 0) // Wed
    const mon = day(2024, 6, 10)
    const tue = day(2024, 6, 11)
    const wed = day(2024, 6, 12)
    expect(isPreferredMarkerDay(start, end, mon.s, mon.e)).toBe(false)
    expect(isPreferredMarkerDay(start, end, tue.s, tue.e)).toBe(true)
    expect(isPreferredMarkerDay(start, end, wed.s, wed.e)).toBe(false)
  })

  it('prefers earlier day on equal-width ties', () => {
    // Exactly two full days
    const start = new Date(2024, 5, 10, 0, 0, 0)
    const end = new Date(2024, 5, 12, 0, 0, 0)
    const d10 = day(2024, 6, 10)
    const d11 = day(2024, 6, 11)
    expect(isPreferredMarkerDay(start, end, d10.s, d10.e)).toBe(true)
    expect(isPreferredMarkerDay(start, end, d11.s, d11.e)).toBe(false)
  })

  it('buildPreferredHostMap enables O(1) host checks', () => {
    const start = new Date(2024, 5, 10, 14, 0, 0)
    const end = new Date(2024, 5, 11, 2, 0, 0)
    const map = buildPreferredHostMap(
      [{ id: 'r1', start, end }],
      'America/Toronto',
    )
    const host = preferredMarkerHostDayStartMs(
      start,
      end,
      'America/Toronto',
    )
    expect(host).not.toBeNull()
    expect(map.get('r1')).toBe(host!)
    expect(isHostDayFor(map, 'r1', host!)).toBe(true)
    const other = startOfDayInTimeZone(end, 'America/Toronto').getTime()
    if (other !== host) {
      expect(isHostDayFor(map, 'r1', other)).toBe(false)
    }
  })
})
