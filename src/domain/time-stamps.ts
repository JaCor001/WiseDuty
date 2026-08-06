/**
 * Layout for start/end time stamps on calendar event bars.
 * Pure geometry — no React.
 *
 * Rules:
 * - No label overlaps; min separation ≈ one character (lateral, vertical, or diagonal)
 * - Labels never touch day-cell edges
 * - Always sit above the event bar with a clean gap (≥ bar thickness)
 * - Move labels **only as far as needed** for that min separation:
 *   1) deficit-only lateral first (short bars need this — stack alone looks glued)
 *   2) stack only when the cell edges make lateral clearance impossible
 * - Thin connector from the bar edge: short vertical stub (≈ bar height),
 *   then a segment that joins the label
 */
import type { TimeFormat } from './types'
import { formatHHmmInTZ, formatTimeDisplay } from './time'

/** Merge edges within this many ms as the same instant. */
export const TIME_STAMP_MERGE_MS = 60_000
/** Also merge when X positions are this close (% of day). */
export const TIME_STAMP_MERGE_X_PCT = 1.25

/**
 * One character as % of a day cell (month-grid, ~0.5rem type on ~100–120px days).
 * Used as the min clear air between label boxes.
 */
export const TIME_STAMP_CHAR_WIDTH_PCT = 3.6
/** Minimum clear gap between label boxes (= one character). */
export const TIME_STAMP_MIN_GAP_PCT = TIME_STAMP_CHAR_WIDTH_PCT
/**
 * Vertical air between stacked rows (≥ one character). Kept equal to the
 * lateral gap so pure vertical separation is visually honest.
 */
export const TIME_STAMP_MIN_VGAP_PCT = TIME_STAMP_CHAR_WIDTH_PCT
/** Inset from day-cell edges — labels must not touch the border. */
export const TIME_STAMP_EDGE_PAD_PCT = 2
/**
 * Day-number badge obstacle (top-left of the cell), as % of the day cell.
 * Stamps must keep the same one-character air as stamp↔stamp separation.
 * Sized for a two-digit date + pad on typical month-grid day heights.
 */
export const TIME_STAMP_DAY_NUMBER_LEFT_PCT = 0
export const TIME_STAMP_DAY_NUMBER_TOP_PCT = 0
export const TIME_STAMP_DAY_NUMBER_WIDTH_PCT = 30
export const TIME_STAMP_DAY_NUMBER_HEIGHT_PCT = 16

/** Fixed obstacle rect for the date indicator in a day cell. */
export function dayNumberObstacleRect(): TimeStampObstacleRect {
  return {
    left: TIME_STAMP_DAY_NUMBER_LEFT_PCT,
    top: TIME_STAMP_DAY_NUMBER_TOP_PCT,
    w: TIME_STAMP_DAY_NUMBER_WIDTH_PCT,
    h: TIME_STAMP_DAY_NUMBER_HEIGHT_PCT,
  }
}
/**
 * Label box height as % of day cell.
 * Real CSS is ~0.5rem font + pad on ~90–120px-tall days → ~8–11%.
 * Must not under-estimate or stacked labels will touch on screen.
 */
export const TIME_STAMP_LABEL_HEIGHT_PCT = 8.5
/** Event bar thickness as % of the day cell (matches layout barHPct). */
export const EVENT_BAR_HEIGHT_PCT = 10
/** Gap between label bottom and bar top (≥ one bar thickness). */
export const TIME_STAMP_BAR_CLEARANCE_PCT = EVENT_BAR_HEIGHT_PCT
/**
 * Vertical pitch between stack rows (= full label + one-char air).
 * Chosen so tier 0 / 1 / 2 stay distinct above the bar without collapsing
 * into the day-cell top padding (which previously left only ~3.4% air).
 */
export const TIME_STAMP_ROW_PITCH_PCT =
  TIME_STAMP_LABEL_HEIGHT_PCT + TIME_STAMP_MIN_VGAP_PCT
/** Max stack rows above the bar. */
export const TIME_STAMP_MAX_TIER = 6
/** Band height reserved above the bar for time-stamp labels. */
export const TIME_STAMP_BAND_HEIGHT_PCT =
  TIME_STAMP_LABEL_HEIGHT_PCT + TIME_STAMP_BAR_CLEARANCE_PCT + 2

/**
 * Max lateral drift from anchor before we prefer stacking, as a fraction of
 * label half-width. ~0.9 allows short-bar pairs (14:35–16:53 need ~0.7 halfW)
 * but blocks packing stamps across the whole day cell.
 */
export const TIME_STAMP_MAX_LATERAL_HALF_WIDTHS = 0.9
/** Soft char-based floor for the same cap (whichever is larger wins). */
export const TIME_STAMP_MAX_LATERAL_CHARS = 2.5

export type TimeStampEdge = 'start' | 'end' | 'shared'

export interface TimeStampObstacleRect {
  left: number
  top: number
  w: number
  h: number
}

export interface TimeStampInput {
  eventId: string
  at: Date
  leftPct: number
  edge: 'start' | 'end'
  barTop: string
  barTopPct: number
}

export interface DayTimeStampSpec {
  key: string
  anchorLeftPct: number
  anchorTopPct: number
  labelCenterPct: number
  labelTopPct: number
  labelOffsetPct: number
  stackTier: number
  labelWidthPct: number
  labelHeightPct: number
  label: string
  edge: TimeStampEdge
  barTop: string
  barTopPct: number
  eventIds: string[]
  atMs: number
}

export function formatTimeStampLabel(
  at: Date,
  tz: string,
  timeFormat: TimeFormat,
): string {
  const hhmm = formatHHmmInTZ(at, tz)
  if (timeFormat === '12h') {
    const full = formatTimeDisplay(hhmm, '12h')
    return full
      .replace(/\s*AM$/i, 'a')
      .replace(/\s*PM$/i, 'p')
      .replace(/^0/, '')
  }
  return hhmm
}

export type ConnectorPoint = { x: number; y: number }

/**
 * Join segment is drawn only when |labelX − anchorX| ≥ this fraction of the
 * stamp label width. Below that, vertical-only.
 */
export const TIME_STAMP_CONNECTOR_JOIN_MIN_HALF_WIDTHS = 0.5

/**
 * Clear air between connector tip and the stamp label box (day-cell %).
 * Stops the stroke from kissing / merging with the glyphs — standard
 * cartographic “terminal gap” on leader lines.
 * ~0.4 character keeps a readable breath without looking detached.
 */
export const TIME_STAMP_CONNECTOR_LABEL_GAP_PCT =
  TIME_STAMP_CHAR_WIDTH_PCT * 0.4

/**
 * Y of the connector tip: just below the label box (toward the bar), never
 * past the bar attach. Leaves a deliberate gap so the line does not merge
 * with the timestamp characters.
 */
export function connectorTipY(
  anchorY: number,
  labelBottomY: number,
  gapPct: number = TIME_STAMP_CONNECTOR_LABEL_GAP_PCT,
): number {
  if (labelBottomY >= anchorY) {
    // Label at/below bar — tiny tick only
    return anchorY - Math.min(2, Math.max(0.5, gapPct))
  }
  // Stop short of the label bottom (larger Y = further from the text)
  const tip = labelBottomY + Math.max(0, gapPct)
  // Never reverse past the bar or collapse to zero length
  return Math.min(tip, anchorY - 0.4)
}

/**
 * Polyline for the stamp↔bar connector (day-cell % coords).
 *
 * - Terminal gap: line ends short of the label so it never merges with glyphs
 * - Join segment only when lateral offset is ≥ half the stamp label width;
 *   otherwise pure vertical under the stamp
 */
export function timeStampConnectorPoints(
  anchorX: number,
  anchorY: number,
  labelX: number,
  labelBottomY: number,
  stubHeightPct: number = EVENT_BAR_HEIGHT_PCT,
  /** Label width as % of day cell — join threshold is half of this. */
  labelWidthPct: number = estimateLabelWidthPct('00:00'),
  joinMinHalfWidths: number = TIME_STAMP_CONNECTOR_JOIN_MIN_HALF_WIDTHS,
  labelGapPct: number = TIME_STAMP_CONNECTOR_LABEL_GAP_PCT,
): ConnectorPoint[] {
  const stub = Math.max(0, stubHeightPct)
  // Join only when |offset| ≥ half the stamp width (joinMinHalfWidths = 0.5)
  const threshold = Math.max(0, labelWidthPct) * joinMinHalfWidths
  const lateral = Math.abs(labelX - anchorX)
  const needsJoin = lateral >= threshold - 1e-9
  const tipY = connectorTipY(anchorY, labelBottomY, labelGapPct)

  if (!needsJoin) {
    // Within half label width: pure vertical bar → tip (gap under stamp)
    return [
      { x: anchorX, y: anchorY },
      { x: anchorX, y: tipY },
    ]
  }

  // Displaced beyond half width: short vertical stub, then join to tip under stamp
  let elbowY = anchorY - stub
  // Stub should not climb past the tip (keeps gap under the label)
  elbowY = Math.max(elbowY, tipY)
  // If stub would sit at/below the bar, still leave a minimal rise
  if (elbowY >= anchorY - 0.2) {
    elbowY = Math.min(tipY, anchorY - Math.min(stub, 4))
  }

  const pts: ConnectorPoint[] = [
    { x: anchorX, y: anchorY },
    { x: anchorX, y: elbowY },
  ]
  if (Math.abs(labelX - anchorX) >= 0.05 || Math.abs(tipY - elbowY) >= 0.05) {
    pts.push({ x: labelX, y: tipY })
  }
  return pts
}

/** SVG `points` attribute for a polyline in viewBox 0–100. */
export function connectorPointsAttr(pts: ConnectorPoint[]): string {
  return pts.map((p) => `${p.x},${p.y}`).join(' ')
}

/**
 * Half-gap on each side of a line–line crossing (day-cell %).
 * Total visual break ≈ 2× this along the yielding stroke.
 */
export const TIME_STAMP_CONNECTOR_CROSS_GAP_HALF_PCT =
  TIME_STAMP_CHAR_WIDTH_PCT * 0.35

/**
 * Extra pad around foreign stamp boxes when hiding a connector under them.
 * Slightly larger than the terminal gap so the break reads as intentional.
 */
export const TIME_STAMP_CONNECTOR_LABEL_OCCLUSION_PAD_PCT =
  TIME_STAMP_CHAR_WIDTH_PCT * 0.35

const MIN_SEG_LEN = 0.12

function dist(a: ConnectorPoint, b: ConnectorPoint): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  return Math.hypot(dx, dy)
}

function lerp(
  a: ConnectorPoint,
  b: ConnectorPoint,
  t: number,
): ConnectorPoint {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

/** Point-in-rect with optional uniform pad (day-cell %). */
export function pointInPaddedRect(
  p: ConnectorPoint,
  r: TimeStampObstacleRect,
  pad: number,
): boolean {
  return (
    p.x >= r.left - pad &&
    p.x <= r.left + r.w + pad &&
    p.y >= r.top - pad &&
    p.y <= r.top + r.h + pad
  )
}

/**
 * Parameter intervals t∈[0,1] where segment A→B is inside the padded rect.
 * Empty if the segment misses the rect.
 */
export function segmentRectOcclusionIntervals(
  a: ConnectorPoint,
  b: ConnectorPoint,
  r: TimeStampObstacleRect,
  pad: number,
): Array<[number, number]> {
  const x0 = r.left - pad
  const x1 = r.left + r.w + pad
  const y0 = r.top - pad
  const y1 = r.top + r.h + pad
  const dx = b.x - a.x
  const dy = b.y - a.y

  // Liang–Barsky style: clip segment to rect, return [tEnter, tExit] if any
  let t0 = 0
  let t1 = 1
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return false
      return true
    }
    const t = q / p
    if (p < 0) {
      if (t > t1) return false
      if (t > t0) t0 = t
    } else {
      if (t < t0) return false
      if (t < t1) t1 = t
    }
    return true
  }

  if (
    !clip(-dx, a.x - x0) ||
    !clip(dx, x1 - a.x) ||
    !clip(-dy, a.y - y0) ||
    !clip(dy, y1 - a.y)
  ) {
    return []
  }
  if (t0 > t1) return []
  // Expand slightly so the visible ends leave a clean air gap
  const expand = 0.02
  return [[Math.max(0, t0 - expand), Math.min(1, t1 + expand)]]
}

/** Merge overlapping [t0,t1] intervals on [0,1]. */
export function mergeIntervals(
  intervals: Array<[number, number]>,
): Array<[number, number]> {
  if (intervals.length === 0) return []
  const sorted = [...intervals].sort((a, b) => a[0] - b[0])
  const out: Array<[number, number]> = [[sorted[0][0], sorted[0][1]]]
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]
    const last = out[out.length - 1]
    if (cur[0] <= last[1] + 1e-9) {
      last[1] = Math.max(last[1], cur[1])
    } else {
      out.push([cur[0], cur[1]])
    }
  }
  return out
}

/**
 * Split one segment into visible pieces outside occlusion intervals.
 * Returns polylines of 2 points each (open segments).
 */
export function splitSegmentByOcclusion(
  a: ConnectorPoint,
  b: ConnectorPoint,
  occluded: Array<[number, number]>,
): ConnectorPoint[][] {
  const len = dist(a, b)
  if (len < MIN_SEG_LEN) return []
  const merged = mergeIntervals(occluded)
  if (merged.length === 0) return [[a, b]]

  const pieces: ConnectorPoint[][] = []
  let cursor = 0
  for (const [t0, t1] of merged) {
    if (t0 > cursor + 1e-9) {
      const p0 = lerp(a, b, cursor)
      const p1 = lerp(a, b, t0)
      if (dist(p0, p1) >= MIN_SEG_LEN) pieces.push([p0, p1])
    }
    cursor = Math.max(cursor, t1)
  }
  if (cursor < 1 - 1e-9) {
    const p0 = lerp(a, b, cursor)
    const p1 = b
    if (dist(p0, p1) >= MIN_SEG_LEN) pieces.push([p0, p1])
  }
  return pieces
}

/**
 * Hide portions of a connector that pass through foreign stamp boxes.
 * Own label is skipped (connector already has a terminal gap to it).
 */
export function clipConnectorAgainstLabels(
  pts: ConnectorPoint[],
  foreignLabels: TimeStampObstacleRect[],
  pad: number = TIME_STAMP_CONNECTOR_LABEL_OCCLUSION_PAD_PCT,
): ConnectorPoint[][] {
  if (pts.length < 2) return []
  const pieces: ConnectorPoint[][] = []
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    const intervals: Array<[number, number]> = []
    for (const r of foreignLabels) {
      intervals.push(...segmentRectOcclusionIntervals(a, b, r, pad))
    }
    pieces.push(...splitSegmentByOcclusion(a, b, intervals))
  }
  return coalesceColinearPieces(pieces)
}

/** Join pieces that share an endpoint into longer polylines. */
function coalesceColinearPieces(pieces: ConnectorPoint[][]): ConnectorPoint[][] {
  if (pieces.length === 0) return []
  const out: ConnectorPoint[][] = []
  for (const piece of pieces) {
    if (piece.length < 2) continue
    const last = out[out.length - 1]
    if (
      last &&
      dist(last[last.length - 1], piece[0]) < 1e-6
    ) {
      // Append, skip duplicate joint
      for (let i = 1; i < piece.length; i++) last.push(piece[i])
    } else {
      out.push([...piece])
    }
  }
  return out
}

/**
 * Segment–segment intersection in the open/closed unit square.
 * Returns null if parallel, collinear-overlap, or no hit in (0,1)×(0,1).
 */
export function segmentIntersection(
  a1: ConnectorPoint,
  a2: ConnectorPoint,
  b1: ConnectorPoint,
  b2: ConnectorPoint,
): { t: number; u: number; point: ConnectorPoint } | null {
  const rX = a2.x - a1.x
  const rY = a2.y - a1.y
  const sX = b2.x - b1.x
  const sY = b2.y - b1.y
  const det = rX * sY - rY * sX
  if (Math.abs(det) < 1e-10) return null // parallel / collinear
  const qpx = b1.x - a1.x
  const qpy = b1.y - a1.y
  const t = (qpx * sY - qpy * sX) / det
  const u = (qpx * rY - qpy * rX) / det
  // Require a true crossing interior (not shared endpoints)
  if (t <= 0.02 || t >= 0.98 || u <= 0.02 || u >= 0.98) return null
  return {
    t,
    u,
    point: { x: a1.x + t * rX, y: a1.y + t * rY },
  }
}

/**
 * Cut a polyline open at `hit` with a total gap of 2×gapHalf along the stroke.
 * Returns zero or more remaining pieces.
 */
export function gapPolylineAtPoint(
  pts: ConnectorPoint[],
  hit: ConnectorPoint,
  gapHalfPct: number = TIME_STAMP_CONNECTOR_CROSS_GAP_HALF_PCT,
): ConnectorPoint[][] {
  if (pts.length < 2 || gapHalfPct <= 0) return [pts]

  // Find closest segment and project hit
  let bestI = 0
  let bestT = 0
  let bestD = Infinity
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    const len = dist(a, b)
    if (len < 1e-12) continue
    const dx = b.x - a.x
    const dy = b.y - a.y
    let t = ((hit.x - a.x) * dx + (hit.y - a.y) * dy) / (len * len)
    t = Math.max(0, Math.min(1, t))
    const proj = lerp(a, b, t)
    const d = dist(proj, hit)
    if (d < bestD) {
      bestD = d
      bestI = i
      bestT = t
    }
  }
  if (bestD > gapHalfPct * 3) return [pts] // hit not on this polyline

  // Build cumulative length and remove [sHit - gapHalf, sHit + gapHalf]
  const segLens: number[] = []
  let total = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const L = dist(pts[i], pts[i + 1])
    segLens.push(L)
    total += L
  }
  let sHit = 0
  for (let i = 0; i < bestI; i++) sHit += segLens[i]
  sHit += bestT * segLens[bestI]

  const g0 = sHit - gapHalfPct
  const g1 = sHit + gapHalfPct
  if (g1 <= 0 || g0 >= total) return [pts]

  const pointAt = (s: number): ConnectorPoint => {
    let rem = Math.max(0, Math.min(total, s))
    for (let i = 0; i < pts.length - 1; i++) {
      const L = segLens[i]
      if (rem <= L + 1e-12) {
        return lerp(pts[i], pts[i + 1], L < 1e-12 ? 0 : rem / L)
      }
      rem -= L
    }
    return pts[pts.length - 1]
  }

  const before: ConnectorPoint[] = []
  const after: ConnectorPoint[] = []
  // Walk original vertices into before/after relative to gap
  let acc = 0
  before.push(pts[0])
  for (let i = 0; i < pts.length - 1; i++) {
    const L = segLens[i]
    const sA = acc
    const sB = acc + L
    // Vertex at sB
    if (sB < g0 - 1e-9) {
      before.push(pts[i + 1])
    } else if (sA > g1 + 1e-9) {
      if (after.length === 0) after.push(pointAt(g1))
      after.push(pts[i + 1])
    } else {
      // Segment straddles gap
      if (sA < g0 - 1e-9) {
        before.push(pointAt(g0))
      }
      if (sB > g1 + 1e-9) {
        if (after.length === 0) after.push(pointAt(g1))
        after.push(pts[i + 1])
      }
    }
    acc = sB
  }

  const out: ConnectorPoint[][] = []
  if (before.length >= 2 && dist(before[0], before[before.length - 1]) >= MIN_SEG_LEN) {
    out.push(before)
  }
  if (after.length >= 2 && dist(after[0], after[after.length - 1]) >= MIN_SEG_LEN) {
    out.push(after)
  }
  return out.length > 0 ? out : []
}

export type StampConnectorPlan = {
  key: string
  /** Visible connector pieces after occlusion + crossing gaps. */
  pieces: ConnectorPoint[][]
  stackTier: number
}

/**
 * Build all stamp connectors for a day cell:
 * 1) raw bar→stamp polylines
 * 2) hide under foreign timestamps (padded boxes)
 * 3) at line crossings, open an aesthetic gap on the lower-priority stroke
 *
 * Priority (keeps clearer): lower stackTier wins; on tie, shorter path wins;
 * on further tie, earlier key wins. The loser is gapped.
 */
export function buildStampConnectorPlans(
  stamps: DayTimeStampSpec[],
  opts?: {
    stubHeightPct?: number
    labelOcclusionPadPct?: number
    crossGapHalfPct?: number
  },
): StampConnectorPlan[] {
  const stub = opts?.stubHeightPct ?? EVENT_BAR_HEIGHT_PCT
  const occPad =
    opts?.labelOcclusionPadPct ?? TIME_STAMP_CONNECTOR_LABEL_OCCLUSION_PAD_PCT
  const crossHalf =
    opts?.crossGapHalfPct ?? TIME_STAMP_CONNECTOR_CROSS_GAP_HALF_PCT

  const labels = timeStampObstacleRects(stamps)
  const raw: Array<{
    key: string
    stackTier: number
    pieces: ConnectorPoint[][]
    pathLen: number
  }> = []

  for (let i = 0; i < stamps.length; i++) {
    const ts = stamps[i]
    const anchorX = ts.anchorLeftPct
    const anchorY = ts.anchorTopPct
    const labelX = ts.labelCenterPct
    const labelY = ts.labelTopPct
    const labelH = ts.labelHeightPct
    const labelW = ts.labelWidthPct
    const labelBottomY = labelY + labelH
    const pts = timeStampConnectorPoints(
      anchorX,
      anchorY,
      labelX,
      labelBottomY,
      stub,
      labelW,
    )
    // Hide under other stamps AND the day-number badge
    const foreign = [
      ...labels.filter((_, j) => j !== i),
      dayNumberObstacleRect(),
    ]
    const pieces = clipConnectorAgainstLabels(pts, foreign, occPad)
    let pathLen = 0
    for (const p of pieces) {
      for (let k = 0; k < p.length - 1; k++) pathLen += dist(p[k], p[k + 1])
    }
    raw.push({
      key: ts.key,
      stackTier: ts.stackTier,
      pieces,
      pathLen,
    })
  }

  // Crossing gaps: lower priority yields
  const yields = (a: (typeof raw)[0], b: (typeof raw)[0]) => {
    if (a.stackTier !== b.stackTier) return a.stackTier > b.stackTier
    if (Math.abs(a.pathLen - b.pathLen) > 0.5) return a.pathLen > b.pathLen
    return a.key > b.key
  }

  for (let i = 0; i < raw.length; i++) {
    for (let j = i + 1; j < raw.length; j++) {
      const A = raw[i]
      const B = raw[j]
      const aYields = yields(A, B)
      const loser = aYields ? A : B
      const winner = aYields ? B : A

      const newLoserPieces: ConnectorPoint[][] = []
      for (const lp of loser.pieces) {
        let parts = [lp]
        for (const wp of winner.pieces) {
          const next: ConnectorPoint[][] = []
          for (const part of parts) {
            // Find all crossings between part and wp
            let hits: ConnectorPoint[] = []
            for (let p = 0; p < part.length - 1; p++) {
              for (let q = 0; q < wp.length - 1; q++) {
                const hit = segmentIntersection(
                  part[p],
                  part[p + 1],
                  wp[q],
                  wp[q + 1],
                )
                if (hit) hits.push(hit.point)
              }
            }
            if (hits.length === 0) {
              next.push(part)
              continue
            }
            // Apply gaps sequentially
            let cur: ConnectorPoint[][] = [part]
            for (const h of hits) {
              const stepped: ConnectorPoint[][] = []
              for (const c of cur) {
                stepped.push(...gapPolylineAtPoint(c, h, crossHalf))
              }
              cur = stepped
            }
            next.push(...cur)
          }
          parts = next
        }
        newLoserPieces.push(...parts)
      }
      loser.pieces = newLoserPieces
    }
  }

  return raw.map((r) => ({
    key: r.key,
    pieces: r.pieces,
    stackTier: r.stackTier,
  }))
}

/** Label width as % of day cell (glyph run + modest padding). */
export function estimateLabelWidthPct(label: string): number {
  const n = Math.max(1, label.length)
  // Slightly conservative so real CSS text (tabular nums + pad) rarely kisses.
  // Stacking absorbs the extra width — we no longer slide labels halfway across.
  return Math.min(
    26,
    Math.max(
      TIME_STAMP_CHAR_WIDTH_PCT * 2.6,
      n * TIME_STAMP_CHAR_WIDTH_PCT + TIME_STAMP_CHAR_WIDTH_PCT * 0.75,
    ),
  )
}

type Rect = { left: number; top: number; w: number; h: number }

/**
 * True when boxes lack ≥ gap of clear air on every axis.
 * Equal gapX/gapY means lateral, vertical, OR diagonal clearance of one unit
 * is enough (AABB expanded by gap/2 on each side).
 * Epsilon absorbs floating-point noise at the exact min-gap boundary.
 */
function boxesOverlap(
  a: Rect,
  b: Rect,
  gapX: number,
  gapY: number = gapX,
): boolean {
  const eps = 1e-3
  return !(
    a.left + a.w + gapX <= b.left + eps ||
    b.left + b.w + gapX <= a.left + eps ||
    a.top + a.h + gapY <= b.top + eps ||
    b.top + b.h + gapY <= a.top + eps
  )
}

export function labelTopForTier(barTopPct: number, tier: number): number {
  const labelBottom =
    barTopPct -
    TIME_STAMP_BAR_CLEARANCE_PCT -
    tier * TIME_STAMP_ROW_PITCH_PCT
  return labelBottom - TIME_STAMP_LABEL_HEIGHT_PCT
}

export function maxLabelTopAboveBar(barTopPct: number): number {
  return (
    barTopPct - TIME_STAMP_BAR_CLEARANCE_PCT - TIME_STAMP_LABEL_HEIGHT_PCT
  )
}

export function isFullyAboveBar(
  labelTop: number,
  labelH: number,
  barTopPct: number,
  clearance: number = TIME_STAMP_BAR_CLEARANCE_PCT,
): boolean {
  return labelTop + labelH + clearance <= barTopPct + 1e-9
}

type Draft = {
  anchor: number
  barTopPct: number
  barTop: string
  halfW: number
  widthPct: number
  centerX: number
  tier: number
  top: number
  atMs: number
  edges: Set<'start' | 'end'>
  eventIds: Set<string>
  label: string
}

function rectOf(d: Draft): Rect {
  return {
    left: d.centerX - d.halfW,
    top: d.top,
    w: d.widthPct,
    h: TIME_STAMP_LABEL_HEIGHT_PCT,
  }
}

function clampCenter(center: number, halfW: number, pad: number): number {
  const lo = pad + halfW
  const hi = 100 - pad - halfW
  return Math.min(hi, Math.max(lo, center))
}

function applyTier(d: Draft, tier: number, pad: number): void {
  const h = TIME_STAMP_LABEL_HEIGHT_PCT
  const minTop = pad
  const maxTop = Math.min(
    maxLabelTopAboveBar(d.barTopPct),
    Math.max(minTop, 100 - pad - h),
  )
  let top = labelTopForTier(d.barTopPct, tier)
  top = Math.min(maxTop, Math.max(minTop, top))
  if (!isFullyAboveBar(top, h, d.barTopPct)) {
    top = Math.min(maxTop, maxLabelTopAboveBar(d.barTopPct))
  }
  d.tier = tier
  d.top = top
  d.centerX = clampCenter(d.centerX, d.halfW, pad)
}

/**
 * Push a stamp clear of a fixed obstacle (e.g. day-number badge) using the
 * same min gap as stamp↔stamp. Prefer lateral (right of badge), then lower
 * the label toward the bar (never climb into the badge).
 */
export function clearStampFromObstacle(
  d: Draft,
  obstacle: Rect,
  opts: { gap: number; pad: number },
): boolean {
  const { gap, pad } = opts
  const r = rectOf(d)
  if (!boxesOverlap(r, obstacle, gap, gap)) return false

  let changed = false

  // 1) Lateral: place stamp fully to the right of the obstacle + gap
  const targetCenter = obstacle.left + obstacle.w + gap + d.halfW
  const maxCenter = 100 - pad - d.halfW
  if (targetCenter <= maxCenter + 1e-9) {
    const next = clampCenter(Math.max(d.centerX, targetCenter), d.halfW, pad)
    if (Math.abs(next - d.centerX) > 1e-4) {
      d.centerX = next
      changed = true
    }
  }

  // 2) If still overlapping, drop the label below the obstacle (+ gap)
  //    while staying above the event bar.
  const r2 = rectOf(d)
  if (boxesOverlap(r2, obstacle, gap, gap)) {
    const targetTop = obstacle.top + obstacle.h + gap
    const maxTop = maxLabelTopAboveBar(d.barTopPct)
    const minTop = pad
    const nextTop = Math.min(maxTop, Math.max(minTop, targetTop))
    if (
      nextTop + TIME_STAMP_LABEL_HEIGHT_PCT + TIME_STAMP_BAR_CLEARANCE_PCT <=
        d.barTopPct + 1e-9 &&
      nextTop > d.top + 1e-4
    ) {
      d.top = nextTop
      changed = true
    } else if (nextTop > d.top + 1e-4 && nextTop <= maxTop) {
      // Still try — isFullyAboveBar may allow if clearance is tight
      d.top = nextTop
      changed = true
    }
  }

  // 3) Last resort: clamp top below obstacle even if lateral was partial
  const r3 = rectOf(d)
  if (boxesOverlap(r3, obstacle, gap, gap)) {
    const targetTop = obstacle.top + obstacle.h + gap
    const maxTop = maxLabelTopAboveBar(d.barTopPct)
    if (targetTop <= maxTop) {
      d.top = Math.max(d.top, targetTop)
      // Nudge further right if still overlapping after top drop
      const r4 = rectOf(d)
      if (boxesOverlap(r4, obstacle, gap, gap)) {
        const tc = obstacle.left + obstacle.w + gap + d.halfW
        d.centerX = clampCenter(Math.max(d.centerX, tc), d.halfW, pad)
      }
      changed = true
    }
  }

  return changed
}

/**
 * Lower bound on stamp center X so the label clears the day-number badge
 * with the same min gap (only when vertical ranges interact).
 */
export function dayNumberMinCenter(
  d: { top: number; halfW: number },
  dayNum: Rect,
  gap: number,
  pad: number,
): number {
  const edge = pad + d.halfW
  const stampTop = d.top
  const stampBottom = d.top + TIME_STAMP_LABEL_HEIGHT_PCT
  // Fully below or above the badge → no lateral day-number constraint
  if (stampTop >= dayNum.top + dayNum.h + gap - 1e-9) return edge
  if (stampBottom + gap <= dayNum.top + 1e-9) return edge
  return Math.max(edge, dayNum.left + dayNum.w + gap + d.halfW)
}

/**
 * Cooperative multi-object pack on one horizontal band.
 *
 * Satisfies: cell edges, per-stamp min/max centers (e.g. day-number floor),
 * and consecutive min-gap — while keeping each center as close as possible
 * to its preferred (anchor). Neighbors share displacement so stamp A clearing
 * an obstacle only pushes B by the residual shortfall, not the full shove.
 */
export function packCentersCooperative(
  items: Array<{
    preferred: number
    halfW: number
    minCenter?: number
    maxCenter?: number
  }>,
  opts: { pad: number; minGap: number },
): number[] {
  const n = items.length
  if (n === 0) return []
  const { pad, minGap } = opts
  const lo = items.map((it) =>
    Math.max(pad + it.halfW, it.minCenter ?? -Infinity),
  )
  const hi = items.map((it) =>
    Math.min(100 - pad - it.halfW, it.maxCenter ?? Infinity),
  )
  // Preferred clamped into hard bounds
  const c = items.map((it, i) => {
    const p = Math.min(hi[i], Math.max(lo[i], it.preferred))
    // If lo > hi (overconstrained), sit at midpoint of cell edge
    if (lo[i] > hi[i]) return (lo[i] + hi[i]) / 2
    return p
  })

  const need = (i: number, j: number) =>
    items[i].halfW + minGap + items[j].halfW

  // LTR: enforce gaps by pushing right — left stamps stay near preferred
  for (let i = 1; i < n; i++) {
    const minC = c[i - 1] + need(i - 1, i)
    if (c[i] < minC - 1e-9) c[i] = minC
    if (c[i] > hi[i]) c[i] = hi[i]
    if (c[i] < lo[i]) c[i] = lo[i]
  }

  // RTL: if the chain overflowed the right edge, share pressure leftward
  for (let i = n - 2; i >= 0; i--) {
    const maxC = c[i + 1] - need(i, i + 1)
    if (c[i] > maxC + 1e-9) c[i] = maxC
    if (c[i] < lo[i]) c[i] = lo[i]
    if (c[i] > hi[i]) c[i] = hi[i]
  }

  // LTR again — RTL may have broken gaps
  for (let i = 1; i < n; i++) {
    const minC = Math.max(lo[i], c[i - 1] + need(i - 1, i))
    if (c[i] < minC - 1e-9) c[i] = Math.min(hi[i], minC)
  }

  /**
   * Rebalance consecutive pairs toward preferreds, splitting deficit both ways
   * when free — but if the left stamp is floor-bound (day-number), the right
   * neighbor absorbs the residual (minimal move for the constrained stamp).
   */
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < n - 1; i++) {
      const nij = need(i, i + 1)
      let a = Math.min(hi[i], Math.max(lo[i], items[i].preferred))
      let b = Math.min(hi[i + 1], Math.max(lo[i + 1], items[i + 1].preferred))
      // Respect already-packed outer neighbors
      if (i > 0) a = Math.max(a, c[i - 1] + need(i - 1, i))
      if (i + 2 < n) b = Math.min(b, c[i + 2] - need(i + 1, i + 2))
      a = Math.min(hi[i], Math.max(lo[i], a))
      b = Math.min(hi[i + 1], Math.max(lo[i + 1], b))

      if (b - a < nij - 1e-9) {
        const deficit = nij - (b - a)
        let da = deficit / 2
        let db = deficit / 2
        // Left can't go below lo[i]
        if (a - da < lo[i] - 1e-9) {
          da = Math.max(0, a - lo[i])
          db = deficit - da
        }
        // Right can't go above hi[i+1]
        if (b + db > hi[i + 1] + 1e-9) {
          db = Math.max(0, hi[i + 1] - b)
          da = deficit - db
          if (a - da < lo[i] - 1e-9) da = Math.max(0, a - lo[i])
        }
        a -= da
        b += db
      }
      a = Math.min(hi[i], Math.max(lo[i], a))
      b = Math.min(hi[i + 1], Math.max(lo[i + 1], b))
      // Final gap fix if clamps broke separation
      if (b - a < nij - 1e-9) {
        b = Math.min(hi[i + 1], a + nij)
        a = Math.max(lo[i], b - nij)
      }
      c[i] = a
      c[i + 1] = b
    }
    // LTR gap repair after pair rebalance
    for (let i = 1; i < n; i++) {
      const minC = Math.max(lo[i], c[i - 1] + need(i - 1, i))
      if (c[i] < minC - 1e-9) c[i] = Math.min(hi[i], minC)
    }
  }

  // Final pull toward preferred within remaining slack
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      const pref = Math.min(hi[i], Math.max(lo[i], items[i].preferred))
      let leftLim = lo[i]
      let rightLim = hi[i]
      if (i > 0) leftLim = Math.max(leftLim, c[i - 1] + need(i - 1, i))
      if (i < n - 1) rightLim = Math.min(rightLim, c[i + 1] - need(i, i + 1))
      if (leftLim > rightLim) continue
      c[i] = Math.min(rightLim, Math.max(leftLim, pref))
    }
  }

  return c
}

/** True when two stamp rows can collide laterally (vertical bands interact). */
function verticalBandsInteract(a: Draft, b: Draft, gap: number): boolean {
  const ha = TIME_STAMP_LABEL_HEIGHT_PCT
  const hb = TIME_STAMP_LABEL_HEIGHT_PCT
  return !(a.top + ha + gap <= b.top || b.top + hb + gap <= a.top)
}

/**
 * Group drafts into horizontal interaction bands (connected components of
 * vertically interacting stamps), each sorted by anchor left→right.
 */
function horizontalBands(drafts: Draft[], gap: number): Draft[][] {
  if (drafts.length === 0) return []
  const n = drafts.length
  const parent = drafts.map((_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }
  const unite = (i: number, j: number) => {
    const a = find(i)
    const b = find(j)
    if (a !== b) parent[b] = a
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (verticalBandsInteract(drafts[i], drafts[j], gap)) unite(i, j)
    }
  }
  const groups = new Map<number, Draft[]>()
  for (let i = 0; i < n; i++) {
    const r = find(i)
    const list = groups.get(r) ?? []
    list.push(drafts[i])
    groups.set(r, list)
  }
  return [...groups.values()].map((g) =>
    g.sort((a, b) => a.anchor - b.anchor || a.atMs - b.atMs),
  )
}

/**
 * Apply cooperative pack to one band (day-number floors + peer gaps).
 * Returns true if any center moved.
 */
function packBandCooperative(
  band: Draft[],
  dayNum: Rect,
  gap: number,
  pad: number,
): boolean {
  if (band.length === 0) return false
  const items = band.map((d) => ({
    preferred: d.anchor,
    halfW: d.halfW,
    minCenter: dayNumberMinCenter(d, dayNum, gap, pad),
  }))
  const packed = packCentersCooperative(items, {
    pad,
    minGap: gap + 1e-3,
  })
  let changed = false
  for (let i = 0; i < band.length; i++) {
    if (Math.abs(band[i].centerX - packed[i]) > 1e-4) {
      band[i].centerX = packed[i]
      changed = true
    }
  }
  return changed
}

/**
 * Minimal-displacement multi-object resolver.
 *
 * 1. Park every stamp on its anchor at tier 0.
 * 2. **Cooperative lateral pack** per horizontal band: day-number clearance +
 *    peer gaps solved together so neighbors share displacement (stamp 1 only
 *    moves as far as needed; stamp 2 shifts the residual).
 * 3. If a band cannot fit laterally, stack (promote) the rightmost conflict.
 * 4. Same one-character air vs the day-number badge (top-left).
 */
export function resolveStampPlacements(drafts: Draft[]): void {
  const pad = TIME_STAMP_EDGE_PAD_PCT
  const gap = TIME_STAMP_MIN_GAP_PCT
  const h = TIME_STAMP_LABEL_HEIGHT_PCT
  const dayNumber = dayNumberObstacleRect()

  for (const d of drafts) {
    d.centerX = clampCenter(d.anchor, d.halfW, pad)
    applyTier(d, 0, pad)
  }

  const promote = (d: Draft): boolean => {
    if (d.tier >= TIME_STAMP_MAX_TIER) return false
    d.centerX = clampCenter(d.anchor, d.halfW, pad)
    applyTier(d, d.tier + 1, pad)
    return true
  }

  for (let iter = 0; iter < 24; iter++) {
    let changed = false

    // --- Multi-object lateral resolution per interaction band ---
    for (const band of horizontalBands(drafts, gap)) {
      if (packBandCooperative(band, dayNumber, gap, pad)) changed = true
    }

    // Day-number residual: if still overlapping after pack, drop below badge
    for (const d of drafts) {
      if (clearStampFromObstacle(d, dayNumber, { gap, pad })) changed = true
    }

    // Re-pack after vertical day-number adjustments (tops may have changed)
    for (const band of horizontalBands(drafts, gap)) {
      if (packBandCooperative(band, dayNumber, gap, pad)) changed = true
    }

    // Remaining AABB collisions → promote (stack) when lateral pack can't fit
    const order = [...drafts].sort(
      (a, b) => a.anchor - b.anchor || a.atMs - b.atMs,
    )
    for (let i = 0; i < order.length; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const A = order[i]
        const B = order[j]
        if (!boxesOverlap(rectOf(A), rectOf(B), gap, gap)) continue

        // Prefer stacking the right / higher-tier stamp
        const right = A.anchor <= B.anchor ? B : A
        const left = A.anchor <= B.anchor ? A : B
        if (A.tier === B.tier) {
          if (promote(right)) {
            changed = true
            continue
          }
          if (promote(left)) {
            changed = true
            continue
          }
        } else {
          const higher = A.tier > B.tier ? A : B
          if (promote(higher)) {
            changed = true
            continue
          }
          if (promote(right)) {
            changed = true
          }
        }
      }
    }

    if (!changed) break
  }

  // Final cooperative pack per band + safety clamps
  for (const band of horizontalBands(drafts, gap)) {
    packBandCooperative(band, dayNumber, gap, pad)
  }
  for (const d of drafts) {
    d.centerX = clampCenter(d.centerX, d.halfW, pad)
    if (!isFullyAboveBar(d.top, h, d.barTopPct)) {
      applyTier(d, d.tier, pad)
    }
    clearStampFromObstacle(d, dayNumber, { gap, pad })
  }
  for (const band of horizontalBands(drafts, gap)) {
    packBandCooperative(band, dayNumber, gap, pad)
  }
}

/**
 * Place one stamp against fixed obstacles with minimal movement.
 * Prefer anchor → deficit-only lateral → next tier.
 */
export function placeStampLabel(
  anchorX: number,
  barTopPct: number,
  halfW: number,
  placed: Rect[],
  opts?: { pad?: number; minGap?: number; maxTier?: number },
): { centerX: number; top: number; tier: number } {
  const pad = opts?.pad ?? TIME_STAMP_EDGE_PAD_PCT
  const gap = opts?.minGap ?? TIME_STAMP_MIN_GAP_PCT
  const maxTier = opts?.maxTier ?? TIME_STAMP_MAX_TIER
  const h = TIME_STAMP_LABEL_HEIGHT_PCT
  const maxLat = TIME_STAMP_CHAR_WIDTH_PCT * TIME_STAMP_MAX_LATERAL_CHARS
  const minC = pad + halfW
  const maxC = 100 - pad - halfW

  for (let tier = 0; tier <= maxTier; tier++) {
    let top = labelTopForTier(barTopPct, tier)
    const maxTop = maxLabelTopAboveBar(barTopPct)
    top = Math.min(maxTop, Math.max(pad, top))
    if (!isFullyAboveBar(top, h, barTopPct)) continue

    // 1) Exact anchor
    let center = clampCenter(anchorX, halfW, pad)
    const atAnchor: Rect = { left: center - halfW, top, w: halfW * 2, h }
    if (!placed.some((p) => boxesOverlap(atAnchor, p, gap, gap))) {
      return { centerX: center, top, tier }
    }

    // 2) Deficit-only lateral past each hit
    for (let iter = 0; iter < 16; iter++) {
      const self: Rect = { left: center - halfW, top, w: halfW * 2, h }
      let hit: Rect | null = null
      for (const p of placed) {
        if (boxesOverlap(self, p, gap, gap)) {
          hit = p
          break
        }
      }
      if (!hit) return { centerX: center, top, tier }

      const pushRight = hit.left + hit.w + gap + halfW
      const pushLeft = hit.left - gap - halfW
      const candRight = clampCenter(pushRight, halfW, pad)
      const candLeft = clampCenter(pushLeft, halfW, pad)
      const next =
        Math.abs(candRight - anchorX) <= Math.abs(candLeft - anchorX)
          ? candRight
          : candLeft
      if (Math.abs(next - center) < 1e-4) break
      // Soft bail to next tier if this would be a long trek
      if (Math.abs(next - anchorX) > maxLat + 1e-6) break
      center = next
    }

    // 3) Dense scan near anchor on this tier
    const step = Math.max(0.25, TIME_STAMP_CHAR_WIDTH_PCT * 0.25)
    let best: number | null = null
    for (let c = minC; c <= maxC + 1e-6; c += step) {
      if (Math.abs(c - anchorX) > maxLat + 1e-6) continue
      const self: Rect = { left: c - halfW, top, w: halfW * 2, h }
      if (placed.some((p) => boxesOverlap(self, p, gap, gap))) continue
      if (best == null || Math.abs(c - anchorX) < Math.abs(best - anchorX)) {
        best = c
      }
    }
    if (best != null) return { centerX: best, top, tier }
  }

  return {
    centerX: clampCenter(anchorX, halfW, pad),
    top: Math.max(pad, maxLabelTopAboveBar(barTopPct)),
    tier: maxTier,
  }
}

export function timeStampObstacleRects(
  stamps: DayTimeStampSpec[],
): TimeStampObstacleRect[] {
  return stamps.map((ts) => {
    const w = ts.labelWidthPct
    const h = ts.labelHeightPct ?? TIME_STAMP_LABEL_HEIGHT_PCT
    const center = ts.labelCenterPct ?? ts.anchorLeftPct + ts.labelOffsetPct
    const top =
      ts.labelTopPct ??
      ts.barTopPct - TIME_STAMP_BAR_CLEARANCE_PCT - h
    return {
      left: center - w / 2,
      top,
      w,
      h,
    }
  })
}

export function buildDayTimeStamps(
  inputs: TimeStampInput[],
  opts: { tz: string; timeFormat: TimeFormat },
): DayTimeStampSpec[] {
  if (inputs.length === 0) return []

  const sorted = [...inputs].sort(
    (a, b) =>
      a.at.getTime() - b.at.getTime() || a.leftPct - b.leftPct,
  )

  type Cluster = {
    atMs: number
    leftPct: number
    edges: Set<'start' | 'end'>
    eventIds: Set<string>
    barTop: string
    barTopPct: number
  }

  const clusters: Cluster[] = []
  for (const raw of sorted) {
    const atMs = raw.at.getTime()
    const last = clusters[clusters.length - 1]
    const sameInstant =
      last && Math.abs(last.atMs - atMs) <= TIME_STAMP_MERGE_MS
    const samePlace =
      last && Math.abs(last.leftPct - raw.leftPct) < TIME_STAMP_MERGE_X_PCT
    if (sameInstant && samePlace) {
      last.eventIds.add(raw.eventId)
      last.edges.add(raw.edge)
      last.leftPct = (last.leftPct + raw.leftPct) / 2
      last.atMs = Math.round((last.atMs + atMs) / 2)
      if (raw.barTopPct < last.barTopPct) {
        last.barTopPct = raw.barTopPct
        last.barTop = raw.barTop
      }
      continue
    }
    clusters.push({
      atMs,
      leftPct: raw.leftPct,
      edges: new Set([raw.edge]),
      eventIds: new Set([raw.eventId]),
      barTop: raw.barTop,
      barTopPct: raw.barTopPct,
    })
  }

  const drafts: Draft[] = clusters
    .map((c) => {
      const label = formatTimeStampLabel(
        new Date(c.atMs),
        opts.tz,
        opts.timeFormat,
      )
      const widthPct = estimateLabelWidthPct(label)
      const halfW = widthPct / 2
      const anchor = Math.min(
        100 - TIME_STAMP_EDGE_PAD_PCT,
        Math.max(TIME_STAMP_EDGE_PAD_PCT, c.leftPct),
      )
      return {
        anchor,
        barTopPct: c.barTopPct,
        barTop: c.barTop,
        halfW,
        widthPct,
        centerX: anchor,
        tier: 0,
        top: 0,
        atMs: c.atMs,
        edges: c.edges,
        eventIds: c.eventIds,
        label,
      }
    })
    .sort((a, b) => a.anchor - b.anchor || a.atMs - b.atMs)

  resolveStampPlacements(drafts)

  const results: DayTimeStampSpec[] = drafts.map((d) => {
    const edge: TimeStampEdge =
      d.edges.has('start') && d.edges.has('end')
        ? 'shared'
        : d.edges.has('end')
          ? 'end'
          : 'start'
    const ids = [...d.eventIds].sort()
    return {
      key: `ts-${d.atMs}-${Math.round(d.anchor * 10)}-t${d.tier}-${ids.join('+')}`,
      anchorLeftPct: d.anchor,
      anchorTopPct: d.barTopPct,
      labelCenterPct: d.centerX,
      labelTopPct: d.top,
      labelOffsetPct: d.centerX - d.anchor,
      stackTier: d.tier,
      labelWidthPct: d.widthPct,
      labelHeightPct: TIME_STAMP_LABEL_HEIGHT_PCT,
      label: d.label,
      edge,
      barTop: d.barTop,
      barTopPct: d.barTopPct,
      eventIds: ids,
      atMs: d.atMs,
    }
  })

  results.sort(
    (a, b) =>
      a.anchorLeftPct - b.anchorLeftPct ||
      a.stackTier - b.stackTier ||
      a.atMs - b.atMs,
  )
  return results
}

/**
 * Single-row pack helper (tests + legacy).
 * Uses cooperative packing so neighbors share displacement.
 */
export function packCentersOnLine(
  items: { preferred: number; halfW: number; minCenter?: number }[],
  opts: { pad: number; minGap: number },
): number[] {
  return packCentersCooperative(items, opts)
}
