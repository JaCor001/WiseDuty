/**
 * Pure geometry for calendar day-cell markers:
 * preferred placement, overlap stacking, and leader-line endpoints.
 *
 * All coordinates are percentages of the day cell (0–100).
 */

import {
  addCivilDaysInTimeZone,
  dayBarPosition,
  startOfDayInTimeZone,
  startOfLocalDay,
} from './time'

export type MarkerVerticalRole = 'above' | 'below'

/** Segment width below this (% of day) is a sliver when the event spans other days. */
export const MIN_MARKER_BAR_WIDTH_PCT = 12

export interface MarkerLayoutInput {
  id: string
  role: MarkerVerticalRole
  /** Preferred top edge of the chip (before collision). */
  preferredTopPct: number
  /** Left edge of the chip (kept fixed during vertical resolution). */
  leftPct: number
  widthPct: number
  heightPct: number
  /** Bar top edge (for leader attach). */
  barTopPct: number
  /** Bar height. */
  barHPct: number
  /** Horizontal attach on the bar (start / mid / end X). */
  barAttachXPct: number
}

export interface LeaderLine {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface ResolvedMarkerLayout {
  id: string
  role: MarkerVerticalRole
  leftPct: number
  topPct: number
  widthPct: number
  heightPct: number
  /** Set when the chip was vertically displaced from its preferred attach. */
  leader?: LeaderLine
}

export interface ResolveMarkerOverlapsOpts {
  /** Minimum vertical gap between stacked chips (cell %). */
  gapPct: number
  /** Soft top clamp for chip top edge. */
  minTopPct: number
  /** Soft bottom clamp for chip bottom edge (top + height ≤ this). */
  maxBottomPct: number
  /**
   * If |resolvedTop − preferredTop| exceeds this (cell %), draw a leader.
   * Default: half of the chip height.
   */
  leaderThresholdPct?: number
}

function boxesOverlap(
  a: { left: number; top: number; w: number; h: number },
  b: { left: number; top: number; w: number; h: number },
  gap: number,
): boolean {
  return !(
    a.left + a.w + gap <= b.left ||
    b.left + b.w + gap <= a.left ||
    a.top + a.h + gap <= b.top ||
    b.top + b.h + gap <= a.top
  )
}

function clampTop(
  top: number,
  height: number,
  minTop: number,
  maxBottom: number,
): number {
  const maxTop = Math.max(minTop, maxBottom - height)
  return Math.min(Math.max(top, minTop), maxTop)
}

/**
 * Whether a marker type is an FDP day-type label (above the bar)
 * vs a rest/free-day requirement (below the bar).
 */
export function markerVerticalRole(
  type: string,
): MarkerVerticalRole {
  if (type === 'E' || type === 'L' || type === 'N') return 'above'
  return 'below'
}

/**
 * Resolve horizontal chip left (%) from bar geometry and anchor,
 * clamping so the chip stays inside [gap, 100 - gap - width].
 */
export function preferredMarkerLeftPct(
  barLeftPct: number,
  barWidthPct: number,
  chipWidthPct: number,
  anchor: 'start' | 'end' | 'center',
  gapPct: number,
): number {
  let left: number
  if (anchor === 'start') {
    left = barLeftPct
  } else if (anchor === 'end') {
    left = barLeftPct + barWidthPct - chipWidthPct
  } else {
    left = barLeftPct + barWidthPct / 2 - chipWidthPct / 2
  }
  const min = gapPct
  const max = Math.max(min, 100 - gapPct - chipWidthPct)
  return Math.min(Math.max(left, min), max)
}

/**
 * Preferred top (%) for a chip relative to its event bar.
 * Above and below use the same bar↔chip clearance so neither side sits on the bar.
 */
export function preferredMarkerTopPct(
  role: MarkerVerticalRole,
  barTopPct: number,
  barHPct: number,
  chipHeightPct: number,
  gapPct: number,
  minTopPct: number,
  maxBottomPct: number,
): number {
  // Symmetric aesthetic gap between bar edge and chip (cell %)
  const barChipGap = Math.max(2.5, gapPct * 0.75)
  let top: number
  if (role === 'above') {
    top = barTopPct - barChipGap - chipHeightPct
  } else {
    top = barTopPct + barHPct + barChipGap
  }
  return clampTop(top, chipHeightPct, minTopPct, maxBottomPct)
}

/**
 * Greedy vertical stacking within each band (above / below).
 * Horizontal left is fixed; chips that collide are nudged up (above)
 * or down (below). Leaders are attached when displacement is large.
 */
export function resolveMarkerOverlaps(
  markers: MarkerLayoutInput[],
  opts: ResolveMarkerOverlapsOpts,
): ResolvedMarkerLayout[] {
  const { gapPct, minTopPct, maxBottomPct } = opts

  const resolveBand = (
    band: MarkerLayoutInput[],
    direction: 'up' | 'down',
  ): ResolvedMarkerLayout[] => {
    // Stable order: left → right, then preferred top
    const sorted = [...band].sort((a, b) => {
      if (a.leftPct !== b.leftPct) return a.leftPct - b.leftPct
      return a.preferredTopPct - b.preferredTopPct
    })

    const placed: ResolvedMarkerLayout[] = []

    for (const m of sorted) {
      let top = clampTop(
        m.preferredTopPct,
        m.heightPct,
        minTopPct,
        maxBottomPct,
      )
      const step = m.heightPct + gapPct
      let guard = 0

      while (guard < 12) {
        const box = {
          left: m.leftPct,
          top,
          w: m.widthPct,
          h: m.heightPct,
        }
        const hit = placed.find((p) =>
          boxesOverlap(
            box,
            {
              left: p.leftPct,
              top: p.topPct,
              w: p.widthPct,
              h: p.heightPct,
            },
            gapPct * 0.5,
          ),
        )
        if (!hit) break

        if (direction === 'up') {
          top = hit.topPct - step
        } else {
          top = hit.topPct + hit.heightPct + gapPct
        }
        top = clampTop(top, m.heightPct, minTopPct, maxBottomPct)
        guard += 1

        // If clamp trapped us on the same row as the hit, try the other direction once
        if (
          boxesOverlap(
            { left: m.leftPct, top, w: m.widthPct, h: m.heightPct },
            {
              left: hit.leftPct,
              top: hit.topPct,
              w: hit.widthPct,
              h: hit.heightPct,
            },
            gapPct * 0.5,
          )
        ) {
          if (direction === 'up') {
            top = clampTop(
              hit.topPct + hit.heightPct + gapPct,
              m.heightPct,
              minTopPct,
              maxBottomPct,
            )
          } else {
            top = clampTop(
              hit.topPct - step,
              m.heightPct,
              minTopPct,
              maxBottomPct,
            )
          }
        }
      }

      const threshold =
        opts.leaderThresholdPct ?? Math.max(1.2, m.heightPct * 0.45)
      const displaced = Math.abs(top - m.preferredTopPct) > threshold

      let leader: LeaderLine | undefined
      if (displaced) {
        const chipCx = m.leftPct + m.widthPct / 2
        const attachX = Math.min(
          Math.max(m.barAttachXPct, m.leftPct),
          m.leftPct + m.widthPct,
        )
        // Prefer a vertical-ish line at the bar attach X, clamped into chip width
        const x = (attachX + chipCx) / 2
        if (m.role === 'above') {
          // From bottom of chip down to top of bar
          leader = {
            x1: x,
            y1: top + m.heightPct,
            x2: x,
            y2: m.barTopPct,
          }
        } else {
          // From top of chip up to bottom of bar
          leader = {
            x1: x,
            y1: top,
            x2: x,
            y2: m.barTopPct + m.barHPct,
          }
        }
      }

      placed.push({
        id: m.id,
        role: m.role,
        leftPct: m.leftPct,
        topPct: top,
        widthPct: m.widthPct,
        heightPct: m.heightPct,
        leader,
      })
    }

    return placed
  }

  const above = markers.filter((m) => m.role === 'above')
  const below = markers.filter((m) => m.role === 'below')

  // Preserve original input order for consumers that map by id
  const byId = new Map<string, ResolvedMarkerLayout>()
  for (const r of resolveBand(above, 'up')) byId.set(r.id, r)
  for (const r of resolveBand(below, 'down')) byId.set(r.id, r)

  return markers.map((m) => byId.get(m.id)!).filter(Boolean)
}

/** Parse bar top string like "46%" or "30%" → number. */
export function parsePct(value: string, fallback = 46): number {
  const m = /^([\d.]+)%$/.exec(value.trim())
  if (!m) return fallback
  return Number(m[1])
}

/**
 * Absolute start-of-day (ms) that should host a center marker for [eventStart, eventEnd).
 * Uses civil days in `displayTZ` when provided; otherwise browser-local days.
 * Widest segment wins; earlier day wins ties. Returns null if interval is empty.
 */
export function preferredMarkerHostDayStartMs(
  eventStart: Date,
  eventEnd: Date,
  displayTZ?: string,
  opts?: { minWidthPct?: number },
): number | null {
  if (eventEnd.getTime() <= eventStart.getTime()) return null

  const minWidthPct = opts?.minWidthPct ?? MIN_MARKER_BAR_WIDTH_PCT
  let cursor = displayTZ
    ? startOfDayInTimeZone(eventStart, displayTZ)
    : startOfLocalDay(eventStart)
  let bestDayStart = cursor.getTime()
  let bestWidth = -1
  let dayCount = 0

  while (cursor.getTime() < eventEnd.getTime() && dayCount < 400) {
    const d0 = cursor
    const d1 = displayTZ
      ? addCivilDaysInTimeZone(cursor, displayTZ, 1)
      : (() => {
          const n = new Date(cursor)
          n.setDate(n.getDate() + 1)
          return n
        })()
    if (eventStart < d1 && eventEnd > d0) {
      dayCount += 1
      const w = dayBarPosition(eventStart, eventEnd, d0, d1).width
      if (w > bestWidth) {
        bestWidth = w
        bestDayStart = d0.getTime()
      }
    }
    cursor = d1
  }

  if (dayCount === 0) return null
  // Multi-day with only slivers: still return the best day
  if (dayCount > 1 && bestWidth < minWidthPct) return bestDayStart
  return bestDayStart
}

/**
 * Whether this local day should host a center-anchored event marker (RR/LNR/SDF).
 * Prefer `preferredMarkerHostDayStartMs` + O(1) map lookup in hot paths.
 */
export function isPreferredMarkerDay(
  eventStart: Date,
  eventEnd: Date,
  dayStart: Date,
  dayEnd: Date,
  opts?: { minWidthPct?: number; displayTZ?: string },
): boolean {
  if (eventEnd.getTime() <= eventStart.getTime()) return false
  if (
    eventEnd.getTime() <= dayStart.getTime() ||
    eventStart.getTime() >= dayEnd.getTime()
  ) {
    return false
  }

  const host = preferredMarkerHostDayStartMs(
    eventStart,
    eventEnd,
    opts?.displayTZ,
    { minWidthPct: opts?.minWidthPct },
  )
  if (host == null) return false
  if (dayStart.getTime() !== host) return false

  const thisWidth = dayBarPosition(
    eventStart,
    eventEnd,
    dayStart,
    dayEnd,
  ).width
  const minWidthPct = opts?.minWidthPct ?? MIN_MARKER_BAR_WIDTH_PCT
  // Single-day or host is the winner: allow even thin single-day bars
  if (thisWidth >= minWidthPct) return true
  // Host day is best even if thin (only remaining day)
  return true
}

/**
 * Precompute preferred host day-start ms for each rest (and optional SDF keys).
 * Call once per schedule layout, not per day cell.
 */
export function buildPreferredHostMap(
  intervals: Array<{ id: string; start: Date; end: Date }>,
  displayTZ: string,
): Map<string, number> {
  const map = new Map<string, number>()
  for (const iv of intervals) {
    const host = preferredMarkerHostDayStartMs(iv.start, iv.end, displayTZ)
    if (host != null) map.set(iv.id, host)
  }
  return map
}

export function isHostDayFor(
  hostMap: Map<string, number>,
  id: string,
  dayStartMs: number,
): boolean {
  const host = hostMap.get(id)
  return host != null && host === dayStartMs
}

/**
 * Count distinct vertical tiers used by resolved markers in one band.
 * Markers within `tierEpsPct` of the same top share a tier.
 */
export function markerBandTiers(
  resolved: ResolvedMarkerLayout[],
  role: MarkerVerticalRole,
  tierEpsPct = 5,
): number {
  const tops = resolved
    .filter((m) => m.role === role)
    .map((m) => m.topPct)
    .sort((a, b) => a - b)
  if (tops.length === 0) return 0
  let tiers = 1
  let anchor = tops[0]
  for (let i = 1; i < tops.length; i++) {
    if (tops[i] - anchor > tierEpsPct) {
      tiers += 1
      anchor = tops[i]
    }
  }
  return tiers
}

export interface DayContentMinOpts {
  hasBar: boolean
  /** Vertical tiers after overlap resolve (0 if none). */
  aboveTiers: number
  belowTiers: number
  /** Never smaller than this (day number must stay readable). */
  absoluteFloorRem?: number
  /** Soft ceiling matching CSS --day-max-h. */
  maxRem?: number
}

/**
 * Content-driven day cell min-height (rem).
 * Grows only with real structure: number band, bar, and each marker tier in use.
 */
export function dayContentMinRem(opts: DayContentMinOpts): number {
  const floor = opts.absoluteFloorRem ?? 2.75
  const max = opts.maxRem ?? 6.25
  const dayNumberBand = 1.35
  const chipH = 1.05
  const chipGap = 0.18
  const barH = 0.62
  const barGap = 0.32
  const bottomPad = 0.22

  let h = dayNumberBand

  if (opts.aboveTiers > 0) {
    h += opts.aboveTiers * (chipH + chipGap)
  }

  const needsBarTrack =
    opts.hasBar || opts.aboveTiers > 0 || opts.belowTiers > 0
  if (needsBarTrack) {
    h += barGap + barH + barGap
  }

  if (opts.belowTiers > 0) {
    h += opts.belowTiers * (chipH + chipGap)
  }

  h += bottomPad
  return Math.min(max, Math.max(floor, Math.round(h * 100) / 100))
}
