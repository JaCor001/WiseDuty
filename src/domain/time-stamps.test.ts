import { describe, expect, it } from 'vitest'
import {
  buildDayTimeStamps,
  estimateLabelWidthPct,
  formatTimeStampLabel,
  isFullyAboveBar,
  packCentersOnLine,
  placeStampLabel,
  timeStampConnectorPoints,
  buildStampConnectorPlans,
  clipConnectorAgainstLabels,
  dayNumberObstacleRect,
  gapPolylineAtPoint,
  packCentersCooperative,
  segmentIntersection,
  EVENT_BAR_HEIGHT_PCT,
  TIME_STAMP_BAR_CLEARANCE_PCT,
  TIME_STAMP_CHAR_WIDTH_PCT,
  TIME_STAMP_CONNECTOR_LABEL_GAP_PCT,
  TIME_STAMP_DAY_NUMBER_HEIGHT_PCT,
  TIME_STAMP_DAY_NUMBER_WIDTH_PCT,
  TIME_STAMP_EDGE_PAD_PCT,
  TIME_STAMP_LABEL_HEIGHT_PCT,
  TIME_STAMP_MIN_GAP_PCT,
  type DayTimeStampSpec,
  type TimeStampInput,
} from './time-stamps'
import { zonedWallTime } from './time'

const TZ = 'America/Toronto'

function edge(
  partial: Partial<TimeStampInput> &
    Pick<TimeStampInput, 'eventId' | 'at' | 'leftPct' | 'edge'>,
): TimeStampInput {
  return {
    barTop: '46%',
    barTopPct: 46,
    ...partial,
  }
}

function boxOf(s: {
  labelCenterPct: number
  labelTopPct: number
  labelWidthPct: number
  labelHeightPct: number
}) {
  return {
    left: s.labelCenterPct - s.labelWidthPct / 2,
    top: s.labelTopPct,
    w: s.labelWidthPct,
    h: s.labelHeightPct,
  }
}

function overlaps(
  a: { left: number; top: number; w: number; h: number },
  b: { left: number; top: number; w: number; h: number },
  gapX = TIME_STAMP_MIN_GAP_PCT,
  gapY = TIME_STAMP_MIN_GAP_PCT,
): boolean {
  const eps = 1e-3
  return !(
    a.left + a.w + gapX <= b.left + eps ||
    b.left + b.w + gapX <= a.left + eps ||
    a.top + a.h + gapY <= b.top + eps ||
    b.top + b.h + gapY <= a.top + eps
  )
}

function edgeGap(
  a: { left: number; w: number },
  b: { left: number; w: number },
): number {
  const left = a.left <= b.left ? a : b
  const right = a.left <= b.left ? b : a
  return right.left - (left.left + left.w)
}

describe('formatTimeStampLabel', () => {
  it('formats 24h compactly', () => {
    expect(
      formatTimeStampLabel(zonedWallTime(TZ, 2026, 8, 4, 8, 5), TZ, '24h'),
    ).toBe('08:05')
  })
})

describe('placeStampLabel', () => {
  const halfW = estimateLabelWidthPct('06:00') / 2
  const h = TIME_STAMP_LABEL_HEIGHT_PCT
  const top0 = 46 - TIME_STAMP_BAR_CLEARANCE_PCT - h

  it('stays on tier 0 at the anchor when free', () => {
    const p = placeStampLabel(40, 46, halfW, [])
    expect(p.tier).toBe(0)
    expect(p.centerX).toBeCloseTo(40, 0)
  })

  it('moves only as far as needed when blocked', () => {
    const blocking = [
      { left: 40 - halfW, top: top0, w: halfW * 2, h },
    ]
    const p = placeStampLabel(40, 46, halfW, blocking)
    // Must clear the block
    const self = {
      left: p.centerX - halfW,
      top: p.top,
      w: halfW * 2,
      h,
    }
    expect(overlaps(self, blocking[0])).toBe(false)
    // Prefer staying on tier 0 with modest lateral move, or one tier up
    expect(p.tier).toBeLessThanOrEqual(1)
    if (p.tier === 0) {
      // Just enough to clear: not halfway across the cell
      expect(Math.abs(p.centerX - 40)).toBeLessThan(halfW * 3)
    }
  })
})

describe('buildDayTimeStamps', () => {
  it('merges consecutive end+start at the same instant', () => {
    const join = zonedWallTime(TZ, 2026, 8, 4, 12, 0)
    const stamps = buildDayTimeStamps(
      [
        edge({ eventId: 'a', at: join, leftPct: 50, edge: 'end' }),
        edge({ eventId: 'b', at: join, leftPct: 50, edge: 'start' }),
      ],
      { tz: TZ, timeFormat: '24h' },
    )
    expect(stamps).toHaveLength(1)
    expect(stamps[0].edge).toBe('shared')
    // Shared stamp stays on the join
    expect(Math.abs(stamps[0].labelOffsetPct)).toBeLessThan(0.5)
  })

  it('keeps far-apart edges near their anchors (no over-displacement)', () => {
    // Overnight rest day: only end at 07:19 (~30%) — should not wander
    const stamps = buildDayTimeStamps(
      [
        edge({
          eventId: 'rest',
          at: zonedWallTime(TZ, 2026, 8, 1, 7, 19),
          leftPct: (7 + 19 / 60) / 24 * 100,
          edge: 'end',
        }),
      ],
      { tz: TZ, timeFormat: '24h' },
    )
    expect(stamps).toHaveLength(1)
    expect(Math.abs(stamps[0].labelOffsetPct)).toBeLessThan(0.5)
    expect(stamps[0].stackTier).toBe(0)
  })

  it('separates 06:00 / 10:25 with minimal lateral move, no overlap', () => {
    const stamps = buildDayTimeStamps(
      [
        edge({
          eventId: 'rsv',
          at: zonedWallTime(TZ, 2026, 8, 4, 6, 0),
          leftPct: 25,
          edge: 'start',
        }),
        edge({
          eventId: 'rsv',
          at: zonedWallTime(TZ, 2026, 8, 4, 10, 25),
          leftPct: 43.4,
          edge: 'end',
        }),
      ],
      { tz: TZ, timeFormat: '24h' },
    )
    expect(stamps).toHaveLength(2)
    expect(overlaps(boxOf(stamps[0]), boxOf(stamps[1]))).toBe(false)
    // Anchors preserved for connectors
    expect(stamps[0].anchorLeftPct).toBeCloseTo(25, 5)
    expect(stamps[1].anchorLeftPct).toBeCloseTo(43.4, 5)
    // Same tier, deficit-only lateral — one-char edge gap
    expect(stamps[0].stackTier).toBe(0)
    expect(stamps[1].stackTier).toBe(0)
    expect(
      edgeGap(boxOf(stamps[0]), boxOf(stamps[1])),
    ).toBeGreaterThanOrEqual(TIME_STAMP_MIN_GAP_PCT - 0.15)
    // Moved only the shortfall (not halfway across the cell)
    for (const s of stamps) {
      expect(Math.abs(s.labelOffsetPct)).toBeLessThan(s.labelWidthPct * 0.6)
    }
  })

  it('short bar 14:35–16:53 separates laterally by exactly the deficit', () => {
    // Anchors ~9.6% apart — labels need ~one-char air, not a pure stack
    const stamps = buildDayTimeStamps(
      [
        edge({
          eventId: 'd',
          at: zonedWallTime(TZ, 2026, 8, 1, 14, 35),
          leftPct: ((14 + 35 / 60) / 24) * 100,
          edge: 'start',
        }),
        edge({
          eventId: 'd',
          at: zonedWallTime(TZ, 2026, 8, 1, 16, 53),
          leftPct: ((16 + 53 / 60) / 24) * 100,
          edge: 'end',
        }),
      ],
      { tz: TZ, timeFormat: '24h' },
    )
    expect(stamps).toHaveLength(2)
    expect(overlaps(boxOf(stamps[0]), boxOf(stamps[1]))).toBe(false)
    // Prefer same-tier lateral for short bars
    expect(stamps[0].stackTier).toBe(0)
    expect(stamps[1].stackTier).toBe(0)
    expect(stamps[0].labelCenterPct).toBeLessThan(stamps[1].labelCenterPct)
    const gap = edgeGap(boxOf(stamps[0]), boxOf(stamps[1]))
    expect(gap).toBeGreaterThanOrEqual(TIME_STAMP_MIN_GAP_PCT - 0.15)
    // Just enough — edge gap should be near the min, not a huge void
    expect(gap).toBeLessThan(TIME_STAMP_MIN_GAP_PCT + 1.5)
    // Start nudged left of its anchor, end right of its anchor
    expect(stamps[0].labelOffsetPct).toBeLessThan(0)
    expect(stamps[1].labelOffsetPct).toBeGreaterThan(0)
  })

  it('dense cluster never overlaps; stack keeps ≥ one character of vertical air', () => {
    // Near the right edge so pure lateral cannot clear every pair
    const stamps = buildDayTimeStamps(
      [
        edge({
          eventId: 'a',
          at: zonedWallTime(TZ, 2026, 8, 1, 20, 0),
          leftPct: 88,
          edge: 'start',
        }),
        edge({
          eventId: 'b',
          at: zonedWallTime(TZ, 2026, 8, 1, 20, 30),
          leftPct: 90,
          edge: 'start',
        }),
        edge({
          eventId: 'c',
          at: zonedWallTime(TZ, 2026, 8, 1, 21, 0),
          leftPct: 92,
          edge: 'end',
        }),
        edge({
          eventId: 'd',
          at: zonedWallTime(TZ, 2026, 8, 1, 21, 30),
          leftPct: 94,
          edge: 'end',
        }),
      ],
      { tz: TZ, timeFormat: '24h' },
    )
    expect(stamps.length).toBeGreaterThanOrEqual(2)
    for (let i = 0; i < stamps.length; i++) {
      for (let j = i + 1; j < stamps.length; j++) {
        expect(overlaps(boxOf(stamps[i]), boxOf(stamps[j]))).toBe(false)
        if (stamps[i].stackTier !== stamps[j].stackTier) {
          const a = boxOf(stamps[i])
          const b = boxOf(stamps[j])
          const upper = a.top <= b.top ? a : b
          const lower = a.top <= b.top ? b : a
          const vGap = lower.top - (upper.top + upper.h)
          const hGap = edgeGap(a, b)
          // If still horizontally overlapping, vertical air must be ≥ 1 char
          if (hGap < TIME_STAMP_MIN_GAP_PCT - 0.15) {
            expect(vGap).toBeGreaterThanOrEqual(TIME_STAMP_MIN_GAP_PCT - 0.2)
          }
        }
      }
    }
  })

  it('overnight rest start/end alone never wander', () => {
    const start = buildDayTimeStamps(
      [
        edge({
          eventId: 'rest',
          at: zonedWallTime(TZ, 2026, 7, 31, 19, 19),
          leftPct: ((19 + 19 / 60) / 24) * 100,
          edge: 'start',
        }),
      ],
      { tz: TZ, timeFormat: '24h' },
    )
    const end = buildDayTimeStamps(
      [
        edge({
          eventId: 'rest',
          at: zonedWallTime(TZ, 2026, 8, 1, 7, 19),
          leftPct: ((7 + 19 / 60) / 24) * 100,
          edge: 'end',
        }),
      ],
      { tz: TZ, timeFormat: '24h' },
    )
    expect(Math.abs(start[0].labelOffsetPct)).toBeLessThan(0.05)
    expect(Math.abs(end[0].labelOffsetPct)).toBeLessThan(0.05)
    expect(start[0].stackTier).toBe(0)
    expect(end[0].stackTier).toBe(0)
  })

  it('never overlaps; always above bar; never touches day edges', () => {
    const inputs: TimeStampInput[] = [
      edge({
        eventId: 'rsv',
        at: zonedWallTime(TZ, 2026, 8, 4, 6, 0),
        leftPct: 25,
        edge: 'start',
      }),
      edge({
        eventId: 'rsv',
        at: zonedWallTime(TZ, 2026, 8, 4, 10, 25),
        leftPct: 43.4,
        edge: 'end',
      }),
      edge({
        eventId: 'fdp',
        at: zonedWallTime(TZ, 2026, 8, 4, 10, 25),
        leftPct: 43.4,
        edge: 'start',
      }),
      edge({
        eventId: 'fdp',
        at: zonedWallTime(TZ, 2026, 8, 4, 22, 24),
        leftPct: 93.3,
        edge: 'end',
      }),
    ]
    const stamps = buildDayTimeStamps(inputs, {
      tz: TZ,
      timeFormat: '24h',
    })
    expect(stamps.length).toBe(3)

    for (const s of stamps) {
      const left = s.labelCenterPct - s.labelWidthPct / 2
      const right = s.labelCenterPct + s.labelWidthPct / 2
      expect(left).toBeGreaterThanOrEqual(TIME_STAMP_EDGE_PAD_PCT - 0.1)
      expect(right).toBeLessThanOrEqual(100 - TIME_STAMP_EDGE_PAD_PCT + 0.1)
      expect(
        isFullyAboveBar(
          s.labelTopPct,
          s.labelHeightPct,
          s.barTopPct,
          TIME_STAMP_BAR_CLEARANCE_PCT,
        ),
      ).toBe(true)
      expect(s.barTopPct - (s.labelTopPct + s.labelHeightPct)).toBeGreaterThanOrEqual(
        EVENT_BAR_HEIGHT_PCT - 0.1,
      )
    }
    for (let i = 0; i < stamps.length; i++) {
      for (let j = i + 1; j < stamps.length; j++) {
        expect(overlaps(boxOf(stamps[i]), boxOf(stamps[j]))).toBe(false)
      }
    }
  })

  it('multi-day rest edges stay near anchors when alone on the day', () => {
    // Jul 31: only 19:19 start (open end)
    const startOnly = buildDayTimeStamps(
      [
        edge({
          eventId: 'rest',
          at: zonedWallTime(TZ, 2026, 7, 31, 19, 19),
          leftPct: (19 + 19 / 60) / 24 * 100,
          edge: 'start',
        }),
      ],
      { tz: TZ, timeFormat: '24h' },
    )
    expect(startOnly).toHaveLength(1)
    expect(Math.abs(startOnly[0].labelOffsetPct)).toBeLessThan(0.5)

    // Aug 1: only 07:19 end (open start)
    const endOnly = buildDayTimeStamps(
      [
        edge({
          eventId: 'rest',
          at: zonedWallTime(TZ, 2026, 8, 1, 7, 19),
          leftPct: (7 + 19 / 60) / 24 * 100,
          edge: 'end',
        }),
      ],
      { tz: TZ, timeFormat: '24h' },
    )
    expect(endOnly).toHaveLength(1)
    expect(Math.abs(endOnly[0].labelOffsetPct)).toBeLessThan(0.5)
  })

  it('estimates width from character count', () => {
    expect(estimateLabelWidthPct('08:00')).toBeGreaterThan(
      estimateLabelWidthPct('8a'),
    )
    expect(TIME_STAMP_MIN_GAP_PCT).toBe(TIME_STAMP_CHAR_WIDTH_PCT)
  })
})

describe('packCentersOnLine', () => {
  it('enforces min gap on one row', () => {
    const half = 5
    const centers = packCentersOnLine(
      [
        { preferred: 20, halfW: half },
        { preferred: 22, halfW: half },
      ],
      { pad: 1, minGap: TIME_STAMP_MIN_GAP_PCT },
    )
    expect(centers[1] - centers[0] - half - half).toBeGreaterThanOrEqual(
      TIME_STAMP_MIN_GAP_PCT - 0.05,
    )
  })
})

describe('day-number separation', () => {
  it('keeps one-character air between stamps and the date badge', () => {
    // Near-midnight end: anchor at left edge under the day number
    const stamps = buildDayTimeStamps(
      [
        edge({
          eventId: 'rest',
          at: zonedWallTime(TZ, 2026, 7, 16, 0, 4),
          leftPct: 0.3,
          edge: 'end',
        }),
      ],
      { tz: TZ, timeFormat: '24h' },
    )
    expect(stamps).toHaveLength(1)
    const s = stamps[0]
    const stampBox = boxOf(s)
    const dayNum = dayNumberObstacleRect()
    const hGap =
      stampBox.left >= dayNum.left + dayNum.w
        ? stampBox.left - (dayNum.left + dayNum.w)
        : dayNum.left - (stampBox.left + stampBox.w)
    const vGap =
      stampBox.top >= dayNum.top + dayNum.h
        ? stampBox.top - (dayNum.top + dayNum.h)
        : dayNum.top - (stampBox.top + stampBox.h)
    // Clear on at least one axis by ≥ one character (same rule as stamp↔stamp)
    const clear =
      hGap >= TIME_STAMP_MIN_GAP_PCT - 0.2 ||
      vGap >= TIME_STAMP_MIN_GAP_PCT - 0.2 ||
      // fully outside both axes with AABB gap
      stampBox.left + stampBox.w + TIME_STAMP_MIN_GAP_PCT <= dayNum.left ||
      dayNum.left + dayNum.w + TIME_STAMP_MIN_GAP_PCT <= stampBox.left ||
      stampBox.top + stampBox.h + TIME_STAMP_MIN_GAP_PCT <= dayNum.top ||
      dayNum.top + dayNum.h + TIME_STAMP_MIN_GAP_PCT <= stampBox.top
    expect(clear).toBe(true)
    // Stamp box must not sit inside the day-number badge
    const midX = stampBox.left + stampBox.w / 2
    const midY = stampBox.top + stampBox.h / 2
    const insideBadge =
      midX >= dayNum.left &&
      midX <= dayNum.left + dayNum.w &&
      midY >= dayNum.top &&
      midY <= dayNum.top + dayNum.h
    expect(insideBadge).toBe(false)
  })

  it('day number obstacle covers the top-left badge band', () => {
    const o = dayNumberObstacleRect()
    expect(o.left).toBe(0)
    expect(o.top).toBe(0)
    expect(o.w).toBe(TIME_STAMP_DAY_NUMBER_WIDTH_PCT)
    expect(o.h).toBe(TIME_STAMP_DAY_NUMBER_HEIGHT_PCT)
  })

  it('cooperative pack: stamp clearing day-number shares residual with neighbor', () => {
    // Stamp A preferred under the badge; B preferred just to its right.
    // A must clear day-number minCenter; B only shifts the residual gap.
    const half = 6
    const gap = TIME_STAMP_MIN_GAP_PCT
    const dayMin = TIME_STAMP_DAY_NUMBER_WIDTH_PCT + gap + half // ~39.6
    const centers = packCentersCooperative(
      [
        { preferred: 5, halfW: half, minCenter: dayMin },
        { preferred: dayMin + 2, halfW: half }, // would collide if A alone took all space
      ],
      { pad: TIME_STAMP_EDGE_PAD_PCT, minGap: gap },
    )
    // A sits at its day-number floor (minimal move for A)
    expect(centers[0]).toBeCloseTo(dayMin, 5)
    // B is only as far as A + need (not shoved across the cell)
    const need = half + gap + half
    expect(centers[1]).toBeCloseTo(centers[0] + need, 5)
    // Edge gap exactly one character
    expect(centers[1] - centers[0] - half - half).toBeCloseTo(gap, 5)
  })

  it('multi-stamp day: near-midnight end + nearby stamp both clear with shared shift', () => {
    const stamps = buildDayTimeStamps(
      [
        edge({
          eventId: 'rest',
          at: zonedWallTime(TZ, 2026, 7, 16, 0, 4),
          leftPct: 0.3,
          edge: 'end',
        }),
        edge({
          eventId: 'duty',
          at: zonedWallTime(TZ, 2026, 7, 16, 6, 0),
          leftPct: 25,
          edge: 'start',
        }),
      ],
      { tz: TZ, timeFormat: '24h' },
    )
    expect(stamps.length).toBe(2)
    const a = stamps.find((s) => s.eventIds.includes('rest'))!
    const b = stamps.find((s) => s.eventIds.includes('duty'))!
    // No overlap between stamps
    expect(overlaps(boxOf(a), boxOf(b))).toBe(false)
    // Both clear the day number
    const dayNum = dayNumberObstacleRect()
    for (const s of [a, b]) {
      const box = boxOf(s)
      const hits =
        !(
          box.left + box.w + TIME_STAMP_MIN_GAP_PCT <= dayNum.left ||
          dayNum.left + dayNum.w + TIME_STAMP_MIN_GAP_PCT <= box.left ||
          box.top + box.h + TIME_STAMP_MIN_GAP_PCT <= dayNum.top ||
          dayNum.top + dayNum.h + TIME_STAMP_MIN_GAP_PCT <= box.top
        )
      expect(hits).toBe(false)
    }
    // Rest (left) should not overshoot far past duty's natural area alone —
    // duty moves too, so rest stays near its day-number floor.
    expect(a.labelCenterPct).toBeLessThan(55)
  })
})

describe('timeStampConnectorPoints', () => {
  const labelW = 16 // half width = 8
  const gap = TIME_STAMP_CONNECTOR_LABEL_GAP_PCT

  it('uses pure vertical when lateral offset is less than half the stamp width', () => {
    const anchorX = 40
    const anchorY = 46
    const labelBottomY = 30
    // 7% < half of 16% → vertical only
    const pts = timeStampConnectorPoints(
      anchorX,
      anchorY,
      anchorX + 7,
      labelBottomY,
      EVENT_BAR_HEIGHT_PCT,
      labelW,
    )
    expect(pts).toHaveLength(2)
    expect(pts[0]).toEqual({ x: anchorX, y: anchorY })
    // Tip sits below the label by the terminal gap (does not kiss glyphs)
    expect(pts[1].x).toBe(anchorX)
    expect(pts[1].y).toBeCloseTo(labelBottomY + gap)
    expect(pts[1].y).toBeGreaterThan(labelBottomY)
  })

  it('adds vertical stub + join when offset is ≥ half the stamp width', () => {
    const anchorX = 40
    const anchorY = 46
    const labelX = 40 + 8 // exactly half of 16
    const labelBottomY = 46 - EVENT_BAR_HEIGHT_PCT - 4
    const tipY = labelBottomY + gap
    const pts = timeStampConnectorPoints(
      anchorX,
      anchorY,
      labelX,
      labelBottomY,
      EVENT_BAR_HEIGHT_PCT,
      labelW,
    )
    expect(pts).toHaveLength(3)
    expect(pts[0]).toEqual({ x: anchorX, y: anchorY })
    expect(pts[1].x).toBe(anchorX)
    expect(pts[1].y).toBeCloseTo(anchorY - EVENT_BAR_HEIGHT_PCT)
    expect(pts[2]).toEqual({ x: labelX, y: tipY })
  })

  it('caps the stub so the join does not enter the label or its gap', () => {
    // offset 10 ≥ half of 16; label close to bar
    const labelBottomY = 40
    const tipY = labelBottomY + gap
    const pts = timeStampConnectorPoints(
      20,
      46,
      30,
      labelBottomY,
      EVENT_BAR_HEIGHT_PCT,
      labelW,
    )
    expect(pts).toHaveLength(3)
    expect(pts[1].y).toBeGreaterThanOrEqual(tipY - 0.01)
    expect(pts[2].y).toBeCloseTo(tipY)
    expect(pts[2].y).toBeGreaterThan(labelBottomY)
  })
})

describe('connector occlusion + crossing gaps', () => {
  it('clips a connector where it passes through a foreign stamp box', () => {
    // Vertical line x=50 from y=50→20 through a label at (45,28) w=10 h=10
    const pts = [
      { x: 50, y: 50 },
      { x: 50, y: 20 },
    ]
    const foreign = [{ left: 45, top: 28, w: 10, h: 10 }]
    const pieces = clipConnectorAgainstLabels(pts, foreign, 1)
    // Should be broken into a lower piece and possibly an upper piece
    expect(pieces.length).toBeGreaterThanOrEqual(1)
    // No remaining piece should have a midpoint deep inside the rect
    for (const p of pieces) {
      for (let i = 0; i < p.length - 1; i++) {
        const mid = {
          x: (p[i].x + p[i + 1].x) / 2,
          y: (p[i].y + p[i + 1].y) / 2,
        }
        const inside =
          mid.x >= 45 && mid.x <= 55 && mid.y >= 28 && mid.y <= 38
        expect(inside).toBe(false)
      }
    }
  })

  it('detects proper segment crossings', () => {
    const hit = segmentIntersection(
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 10, y: 0 },
    )
    expect(hit).not.toBeNull()
    expect(hit!.point.x).toBeCloseTo(5)
    expect(hit!.point.y).toBeCloseTo(5)
  })

  it('opens a gap on both sides of a hit point along a polyline', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
    ]
    const parts = gapPolylineAtPoint(pts, { x: 10, y: 0 }, 2)
    expect(parts).toHaveLength(2)
    // Left piece ends before 10, right starts after 10
    expect(parts[0][parts[0].length - 1].x).toBeLessThan(10)
    expect(parts[1][0].x).toBeGreaterThan(10)
    expect(parts[1][0].x - parts[0][parts[0].length - 1].x).toBeCloseTo(4)
  })

  it('buildStampConnectorPlans returns a plan per stamp', () => {
    const stamps: DayTimeStampSpec[] = [
      {
        key: 'a',
        anchorLeftPct: 20,
        anchorTopPct: 46,
        labelCenterPct: 20,
        labelTopPct: 28,
        labelOffsetPct: 0,
        stackTier: 0,
        labelWidthPct: 12,
        labelHeightPct: 8,
        label: '06:00',
        edge: 'start',
        barTop: '46%',
        barTopPct: 46,
        eventIds: ['e1'],
        atMs: 1,
      },
      {
        key: 'b',
        anchorLeftPct: 60,
        anchorTopPct: 46,
        labelCenterPct: 60,
        labelTopPct: 28,
        labelOffsetPct: 0,
        stackTier: 0,
        labelWidthPct: 12,
        labelHeightPct: 8,
        label: '14:00',
        edge: 'end',
        barTop: '46%',
        barTopPct: 46,
        eventIds: ['e2'],
        atMs: 2,
      },
    ]
    const plans = buildStampConnectorPlans(stamps)
    expect(plans).toHaveLength(2)
    expect(plans.every((p) => p.pieces.length >= 1)).toBe(true)
  })
})
