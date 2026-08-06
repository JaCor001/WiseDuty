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
  /**
   * When false, never attach a leader even if stacked away from the bar.
   * E/L/N use duty-aligned X instead of leader lines.
   */
  allowLeader?: boolean
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

export type LayoutRect = {
  left: number
  top: number
  w: number
  h: number
}

function boxesOverlap(
  a: LayoutRect,
  b: LayoutRect,
  gap: number,
): boolean {
  return !(
    a.left + a.w + gap <= b.left ||
    b.left + b.w + gap <= a.left ||
    a.top + a.h + gap <= b.top ||
    b.top + b.h + gap <= a.top
  )
}

function anyRectOverlap(
  box: LayoutRect,
  obstacles: LayoutRect[],
  gap: number,
): boolean {
  return obstacles.some((o) => boxesOverlap(box, o, gap))
}

/**
 * After peer stacking, push **above-bar** chips (E/L/N) clear of obstacles
 * such as time-stamp labels.
 *
 * Prefer **vertical** clearance only so chips stay laterally aligned with their
 * duty bar. Allow only a tiny lateral nudge as a last resort. Never draw
 * leader lines for above-bar markers — association is the duty-aligned X.
 * Below-bar markers are left unchanged.
 */
export function deconflictAboveMarkersWithObstacles(
  resolved: ResolvedMarkerLayout[],
  inputs: MarkerLayoutInput[],
  obstacles: LayoutRect[],
  opts: {
    gapPct?: number
    minTopPct: number
    maxBottomPct: number
    edgePadPct?: number
    /** Max |Δleft| from duty-aligned left (cell %). Default ~ half chip. */
    maxLateralDriftPct?: number
  },
): ResolvedMarkerLayout[] {
  if (obstacles.length === 0) return resolved
  const gap = opts.gapPct ?? 1.4
  const edgePad = opts.edgePadPct ?? 2
  const byId = new Map(inputs.map((i) => [i.id, i]))

  // Process left→right so later chips react to earlier shifts
  const order = [...resolved].sort((a, b) => a.leftPct - b.leftPct)
  const out = new Map<string, ResolvedMarkerLayout>()

  for (const r of order) {
    const input = byId.get(r.id)
    if (!input || r.role !== 'above') {
      out.set(r.id, r)
      continue
    }

    // Always prefer the duty-aligned left from layout input (not a prior drift)
    const homeLeft = input.leftPct
    const w = r.widthPct
    const h = r.heightPct
    const minLeft = edgePad
    const maxLeft = Math.max(minLeft, 100 - edgePad - w)
    const maxDrift =
      opts.maxLateralDriftPct ?? Math.min(w * 0.4, 8)

    const peerBoxes: LayoutRect[] = [...out.values()]
      .filter((p) => p.role === 'above')
      .map((p) => ({
        left: p.leftPct,
        top: p.topPct,
        w: p.widthPct,
        h: p.heightPct,
      }))
    const blocked = [...obstacles, ...peerBoxes]

    const fits = (left: number, top: number) => {
      const t = clampTop(top, h, opts.minTopPct, opts.maxBottomPct)
      const l = Math.min(maxLeft, Math.max(minLeft, left))
      return !anyRectOverlap({ left: l, top: t, w, h }, blocked, gap)
    }

    let left = Math.min(maxLeft, Math.max(minLeft, homeLeft))
    let top = r.topPct

    if (!fits(left, top)) {
      let found = false

      // 1) Vertical only — keep X locked to the duty bar
      for (let step = 1; step <= 14 && !found; step++) {
        const tryTop = r.topPct - step * (h * 0.45 + gap)
        if (fits(left, tryTop)) {
          top = clampTop(tryTop, h, opts.minTopPct, opts.maxBottomPct)
          found = true
        }
      }

      // 2) Tiny lateral only if still blocked (stay near duty attach)
      if (!found) {
        const lateral: number[] = []
        for (let s = 1; s <= 4; s++) {
          const d = Math.min(maxDrift, (w * 0.2 + gap) * s)
          lateral.push(d, -d)
        }
        for (const dx of lateral) {
          const tryLeft = homeLeft + dx
          if (Math.abs(tryLeft - homeLeft) > maxDrift + 0.01) continue
          if (fits(tryLeft, top)) {
            left = Math.min(maxLeft, Math.max(minLeft, tryLeft))
            found = true
            break
          }
        }
      }

      // 3) Combined: vertical steps × small lateral (still capped)
      if (!found) {
        for (let step = 0; step <= 12 && !found; step++) {
          const tryTop = r.topPct - step * (h * 0.45 + gap)
          const lateral: number[] = [0]
          for (let s = 1; s <= 4; s++) {
            const d = Math.min(maxDrift, (w * 0.2 + gap) * s)
            lateral.push(d, -d)
          }
          for (const dx of lateral) {
            const tryLeft = homeLeft + dx
            if (Math.abs(tryLeft - homeLeft) > maxDrift + 0.01) continue
            if (fits(tryLeft, tryTop)) {
              left = Math.min(maxLeft, Math.max(minLeft, tryLeft))
              top = clampTop(tryTop, h, opts.minTopPct, opts.maxBottomPct)
              found = true
              break
            }
          }
        }
      }

      if (!found) {
        // Best effort: stay on duty X, sit just above colliding obstacles
        let clearTop = r.topPct
        for (const o of obstacles) {
          if (
            boxesOverlap(
              { left: homeLeft, top: clearTop, w, h },
              o,
              gap,
            )
          ) {
            clearTop = Math.min(clearTop, o.top - gap - h)
          }
        }
        top = clampTop(clearTop, h, opts.minTopPct, opts.maxBottomPct)
        left = Math.min(maxLeft, Math.max(minLeft, homeLeft))
      }
    }

    top = clampTop(top, h, opts.minTopPct, opts.maxBottomPct)
    left = Math.min(maxLeft, Math.max(minLeft, left))

    // E/L/N never get leader lines — keep association via duty-aligned X
    out.set(r.id, {
      ...r,
      leftPct: left,
      topPct: top,
      leader: undefined,
    })
  }

  // Preserve original order
  return resolved.map((r) => out.get(r.id) ?? r)
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
 * Vertical band for a marker type.
 * E/L/N sit **below** the duty bar (with rest/near chips) so the stamp band
 * above the bar stays clear and spacing is easier.
 */
export function markerVerticalRole(
  type: string,
): MarkerVerticalRole {
  // All calendar chips currently share the below-bar band.
  // (Role 'above' remains for future non-stamp overlays.)
  void type
  return 'below'
}

/** E/L/N duty classification chips (never draw leader lines). */
export function isElnMarkerType(type: string): boolean {
  return type === 'E' || type === 'L' || type === 'N'
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
 * or down (below).
 *
 * Leaders are only for **below-bar** rest markers when heavily stacked —
 * E/L/N stay associated by their duty-aligned X and never get leader lines.
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

      // Rest / free-day markers may keep a leader when stacked far from the bar.
      // E/L/N (allowLeader === false) never get lines — duty-aligned X is enough.
      let leader: LeaderLine | undefined
      if (m.role === 'below' && m.allowLeader !== false) {
        const threshold =
          opts.leaderThresholdPct ?? Math.max(1.2, m.heightPct * 0.45)
        const displaced = Math.abs(top - m.preferredTopPct) > threshold
        if (displaced) {
          const chipCx = m.leftPct + m.widthPct / 2
          const attachX = Math.min(
            Math.max(m.barAttachXPct, m.leftPct),
            m.leftPct + m.widthPct,
          )
          const x = (attachX + chipCx) / 2
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

/** Map key for an E/L/N chip host entry. */
export function elnHostKey(eventId: string, type: string): string {
  return `${eventId}:${type}`
}

export type ElnHostDutyInput = {
  id: string
  /** Visual bar start (duty report). */
  start: Date
  /** Visual bar end (includes trailing DH when present). */
  end: Date
  /** Operating release — natural day for L/N. */
  operatingEnd: Date
  markers: Array<'E' | 'L' | 'N'>
}

/**
 * Pick the civil day that should host a single chip for a multi-day bar.
 * Prefers the natural day (start for E, operating-end for L/N) but will
 * move to a wider / less crowded day of the same bar when that day is a
 * thin sliver or already stacked with many below-bar markers.
 */
export function pickRoomierHostDayStartMs(
  eventStart: Date,
  eventEnd: Date,
  displayTZ: string,
  opts: {
    naturalDayStartMs: number
    /** Existing below-bar load per dayStartMs (rest chips, prior ELN, …). */
    dayLoad: Map<number, number>
    /** Penalty per co-located marker. Default 18. */
    loadWeight?: number
    /** Bonus for staying on the natural day. Default 24. */
    naturalBonus?: number
    minWidthPct?: number
  },
): number | null {
  if (eventEnd.getTime() <= eventStart.getTime()) return null

  const loadWeight = opts.loadWeight ?? 18
  const naturalBonus = opts.naturalBonus ?? 24
  const minWidthPct = opts.minWidthPct ?? MIN_MARKER_BAR_WIDTH_PCT

  let cursor = startOfDayInTimeZone(eventStart, displayTZ)
  let bestDayStart = opts.naturalDayStartMs
  let bestScore = -Infinity
  let dayCount = 0
  let sawNatural = false

  while (cursor.getTime() < eventEnd.getTime() && dayCount < 400) {
    const d0 = cursor
    const d1 = addCivilDaysInTimeZone(cursor, displayTZ, 1)
    if (eventStart < d1 && eventEnd > d0) {
      dayCount += 1
      const dayStartMs = d0.getTime()
      const width = dayBarPosition(eventStart, eventEnd, d0, d1).width
      const load = opts.dayLoad.get(dayStartMs) ?? 0
      const isNatural = dayStartMs === opts.naturalDayStartMs
      if (isNatural) sawNatural = true

      let score = width - load * loadWeight
      if (isNatural) score += naturalBonus
      if (width < minWidthPct) score -= 40
      // Prefer earlier days on ties for stability
      score -= dayCount * 0.01

      if (score > bestScore) {
        bestScore = score
        bestDayStart = dayStartMs
      }
    }
    cursor = d1
  }

  if (dayCount === 0) return null
  // If natural day is outside the visual span (TZ edge), fall back to best
  if (!sawNatural && opts.naturalDayStartMs) {
    // keep best among span
  }
  return bestDayStart
}

/**
 * Precompute host day for each E/L/N chip so multi-day duties land on the
 * roomier cell and avoid piling onto days already full of rest markers.
 *
 * Key: `eventId:type` → dayStartMs (display TZ midnight).
 */
export function buildElnHostMap(
  duties: ElnHostDutyInput[],
  displayTZ: string,
  /** Rest/SDF host map — seeds per-day load before ELN assignment. */
  restHostMap?: Map<string, number>,
): Map<string, number> {
  const dayLoad = new Map<number, number>()
  if (restHostMap) {
    for (const dayMs of restHostMap.values()) {
      dayLoad.set(dayMs, (dayLoad.get(dayMs) ?? 0) + 1)
    }
  }

  const sorted = [...duties].sort(
    (a, b) => a.start.getTime() - b.start.getTime() || a.id.localeCompare(b.id),
  )
  const map = new Map<string, number>()

  for (const duty of sorted) {
    const barEnd =
      duty.end.getTime() > duty.start.getTime() ? duty.end : duty.operatingEnd
    for (const type of duty.markers) {
      const naturalInstant = type === 'E' ? duty.start : duty.operatingEnd
      const naturalDay = startOfDayInTimeZone(naturalInstant, displayTZ)
      const host = pickRoomierHostDayStartMs(duty.start, barEnd, displayTZ, {
        naturalDayStartMs: naturalDay.getTime(),
        dayLoad,
      })
      if (host == null) continue
      map.set(elnHostKey(duty.id, type), host)
      dayLoad.set(host, (dayLoad.get(host) ?? 0) + 1)
    }
  }

  return map
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
