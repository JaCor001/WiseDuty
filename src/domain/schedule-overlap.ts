/**
 * Detect when a newly saved FDP (or its required rest) overlaps later work
 * events, and plan fixes:
 *
 * - Next **reserve or standby** — **only** when this FDP is a call-out from
 *   reserve/standby (handoff menu, stored `rapStart`, or FDP overlaps /
 *   follows an availability period). Then move **start** later (keep end) to
 *   clear the overlap when possible; prompt to contact company if needed.
 * - Next **reserve/standby when FDP is not on availability**: treat like a
 *   conflicting assignment — do **not** slide; leave a violation.
 * - Next **duty** (assignment): do **not** move; leave a violation and tell
 *   the user to contact the company.
 * - **Rest protection:** clearance for a slide/cancel never leaves less than
 *   12 h after release unless `allowReducedRest` (crew accepted 10+travel).
 *   Applies to start shifts earlier/later, not only full cancellations.
 *
 * Linked dependents: once a reserve/standby start is auto-moved for a duty,
 * it stores `scheduledStart` (floor) and `startDependsOnDutyId`. Later edits
 * to that duty or its rest re-slide the start to clear the new clearance
 * time, never earlier than `scheduledStart`.
 */
import type { DutyEvent } from './types'
import { eventsOverlap } from './regulations'
import { restIdForDuty } from './events'
import { RAP_LINK_MAX_LOOKBACK_MS } from './rest-70070'

const H = 3_600_000
/** Touching end==start is not an overlap (eventsOverlap); tiny pad for float. */
const TOL_MS = 500
const DEFAULT_MIN_REST_H = 12
const REDUCED_MIN_REST_H = 10

export interface PlanPostDutyOverlapOptions {
  /**
   * When true, clearance may use a 10 h post-release floor (crew accepted
   * 10+travel, or rest is already 10+travel). Default false → always 12 h.
   */
  allowReducedRest?: boolean
}

export interface ReserveStartAdjustment {
  id: string
  /** Floor / original scheduled start (never move before this). */
  scheduledStart: Date
  oldStart: Date
  newStart: Date
  end: Date
  /** Peer type being adjusted (reserve or standby). */
  peerType: 'reserve' | 'standby'
  /** Duty whose release/rest drives this start. */
  drivingDutyId: string
  /** Clear dependency and restore floor (duty no longer conflicts). */
  clearDependency?: boolean
}

export interface PostDutyOverlapPlan {
  /** Suggest re-saving the duty with restType 10+travel to shrink rest. */
  tryRestType10Travel: boolean
  /**
   * Reserve/standby whose start should move (end unchanged).
   * Name kept for call-site compatibility.
   */
  reserveAdjustments: ReserveStartAdjustment[]
  /**
   * Reserve/standby ids to remove when clearance would push start past end
   * (delay wipes the whole availability period).
   */
  removePeerIds: string[]
  /** Duty still collides with duty or rest — leave calendar violation. */
  markDutyViolated: boolean
  /** Brief user-facing lines (show with Got it). */
  messages: string[]
}

function isWorkPeer(e: DutyEvent): boolean {
  return e.type === 'duty' || e.type === 'reserve' || e.type === 'standby'
}

/** Reserve and standby: start can slide later; end stays fixed. */
function isStartAdjustablePeer(e: DutyEvent): e is DutyEvent & {
  type: 'reserve' | 'standby'
} {
  return e.type === 'reserve' || e.type === 'standby'
}

/** Original scheduled start floor for auto-adjust (never earlier than this). */
export function peerScheduledStart(p: DutyEvent): Date {
  if (p.scheduledStart && !isNaN(p.scheduledStart.getTime())) {
    return p.scheduledStart
  }
  return p.start
}

/**
 * True when this FDP is a call-out from reserve/standby, or runs during an
 * availability period already on the schedule.
 *
 * Qualifies when any of:
 * - duty has stored `rapStart` (reserve→FDP handoff from the edit menu)
 * - a reserve/standby **overlaps the FDP** (report→release)
 * - a reserve/standby started before report and ends at/before report within
 *   the RAP lookback (classic call-out ending at contact/report)
 *
 * Only then may duty/rest slide later reserve/standby starts. Otherwise a
 * colliding reserve/standby is treated like a conflicting assignment.
 */
export function dutyTakesPlaceOnAvailability(
  duty: DutyEvent,
  events: DutyEvent[],
): boolean {
  if (duty.type !== 'duty') return false
  if (isNaN(duty.start.getTime()) || isNaN(duty.end.getTime())) return false

  if (duty.rapStart && !isNaN(duty.rapStart.getTime())) {
    return true
  }

  const reportMs = duty.start.getTime()
  for (const e of events) {
    if (e.id === duty.id) continue
    if (e.type !== 'reserve' && e.type !== 'standby') continue
    if (isNaN(e.start.getTime()) || isNaN(e.end.getTime())) continue
    if (e.end.getTime() <= e.start.getTime()) continue

    // FDP runs inside / across an availability bar
    if (eventsOverlap(duty.start, duty.end, e.start, e.end)) {
      return true
    }

    // Call-out: availability began before report and ends at or before report
    // (reserve often ends at call time hours before report — still counts).
    if (e.start.getTime() >= reportMs - TOL_MS) continue
    if (e.end.getTime() > reportMs + TOL_MS) continue
    if (reportMs - e.start.getTime() > RAP_LINK_MAX_LOOKBACK_MS) continue
    return true
  }
  return false
}

/**
 * Events that can collide with this FDP/rest: duty, reserve, standby that are
 * not the duty itself and not purely prior (ended at/before report).
 * Always includes dependents linked to this duty (even if currently cleared).
 */
function candidatePeers(events: DutyEvent[], duty: DutyEvent): DutyEvent[] {
  const reportMs = duty.start.getTime()
  return events.filter((e) => {
    if (!isWorkPeer(e)) return false
    if (e.id === duty.id) return false
    if (isStartAdjustablePeer(e) && e.startDependsOnDutyId === duty.id) {
      return true
    }
    // Prior RAP/SBY ending at report, or anything fully before report
    if (e.end.getTime() <= reportMs + TOL_MS) return false
    return true
  })
}

function overlapsInterval(
  a0: Date,
  a1: Date,
  b0: Date,
  b1: Date,
): boolean {
  return eventsOverlap(a0, a1, b0, b1)
}

/**
 * Protected rest end after release: never earlier than release + minRestHours.
 *
 * When evaluating the full (12 h) policy, also respect a longer built rest bar
 * (e.g. 700.42). When evaluating reduced (10 h) — including the hypothetical
 * “what if we accept 10+travel” plan — use the minRestHours floor only so a
 * still-12 h rest bar does not force clearance past 10 h.
 */
function protectedRestEndMs(
  duty: DutyEvent,
  rest: DutyEvent | undefined,
  minRestHours: number,
): number {
  const releaseMs = duty.end.getTime()
  const floorMs = releaseMs + minRestHours * H
  if (minRestHours + 1e-9 < DEFAULT_MIN_REST_H) {
    // Reduced / hypothetical 10 h plan
    if (
      rest &&
      !isNaN(rest.end.getTime()) &&
      (rest.baseRestType === '10+travel' ||
        (rest.requiredRestHours != null &&
          rest.requiredRestHours <= REDUCED_MIN_REST_H + 1e-6))
    ) {
      return Math.max(floorMs, rest.end.getTime())
    }
    return floorMs
  }
  if (rest && !isNaN(rest.end.getTime())) {
    return Math.max(floorMs, rest.end.getTime())
  }
  return floorMs
}

/**
 * Clear-until for a reserve/standby relative to this duty + protected rest.
 * Uses the peer’s scheduled window so already-slid bars still re-sync when
 * the driving duty/rest moves earlier or later.
 *
 * Rest protection: clearance is never before release + minRestHours (12 unless
 * reduced rest allowed), so start slides never leave a sub-12 h gap without
 * explicit consent.
 */
function clearanceForPeer(
  duty: DutyEvent,
  rest: DutyEvent | undefined,
  p: DutyEvent,
  minRestHours: number,
): Date | null {
  const floor = peerScheduledStart(p)
  const winEnd = p.end
  const releaseMs = duty.end.getTime()
  const restEndMs = protectedRestEndMs(duty, rest, minRestHours)
  const restStart = new Date(releaseMs)
  const restEnd = new Date(restEndMs)

  let needsClear = false
  if (overlapsInterval(duty.start, duty.end, floor, winEnd)) {
    needsClear = true
  }
  if (overlapsInterval(restStart, restEnd, floor, winEnd)) {
    needsClear = true
  }

  // Linked dependent: always re-evaluate (early/late arrival re-slide)
  if (p.startDependsOnDutyId === duty.id) {
    if (!needsClear) {
      // Protected rest no longer intersects original window → restore floor
      return floor
    }
    return restEnd
  }

  if (!needsClear) return null
  return restEnd
}

type PeerAdjustOutcome = {
  adjustments: ReserveStartAdjustment[]
  removeIds: string[]
  anyNewSlide: boolean
  anyResync: boolean
}

function planAdjustablePeers(
  duty: DutyEvent,
  rest: DutyEvent | undefined,
  adjustablePeers: DutyEvent[],
  minRestHours: number,
): PeerAdjustOutcome {
  const adjustMap = new Map<string, ReserveStartAdjustment>()
  const removeIds: string[] = []
  let anyNewSlide = false
  let anyResync = false

  for (const p of adjustablePeers) {
    if (!isStartAdjustablePeer(p)) continue
    const floor = peerScheduledStart(p)
    const clearUntil = clearanceForPeer(duty, rest, p, minRestHours)
    if (clearUntil == null) continue

    const linked = p.startDependsOnDutyId === duty.id
    const desiredMs = Math.max(floor.getTime(), clearUntil.getTime())

    // Restore to floor when clearance no longer pushes past it
    if (desiredMs <= floor.getTime() + TOL_MS) {
      if (linked && p.start.getTime() > floor.getTime() + TOL_MS) {
        adjustMap.set(p.id, {
          id: p.id,
          scheduledStart: floor,
          oldStart: p.start,
          newStart: new Date(floor.getTime()),
          end: p.end,
          peerType: p.type,
          drivingDutyId: duty.id,
          clearDependency: true,
        })
        anyResync = true
      }
      continue
    }

    // Clearance past scheduled end → cancel (delete) the availability period
    if (desiredMs >= p.end.getTime() - TOL_MS) {
      removeIds.push(p.id)
      continue
    }

    const newStart = new Date(desiredMs)
    if (Math.abs(newStart.getTime() - p.start.getTime()) <= TOL_MS) {
      if (!linked || !p.scheduledStart) {
        adjustMap.set(p.id, {
          id: p.id,
          scheduledStart: floor,
          oldStart: p.start,
          newStart,
          end: p.end,
          peerType: p.type,
          drivingDutyId: duty.id,
        })
      }
      continue
    }

    if (newStart.getTime() > p.start.getTime() + TOL_MS) anyNewSlide = true
    if (newStart.getTime() < p.start.getTime() - TOL_MS) anyResync = true

    adjustMap.set(p.id, {
      id: p.id,
      scheduledStart: floor,
      oldStart: p.start,
      newStart,
      end: p.end,
      peerType: p.type,
      drivingDutyId: duty.id,
    })
  }

  return {
    adjustments: [...adjustMap.values()],
    removeIds,
    anyNewSlide,
    anyResync,
  }
}

/**
 * Plan fixes after a duty (+ rest) exists on the schedule.
 * Does not mutate events; apply with {@link applyReserveStartAdjustments}.
 */
export function planPostDutyOverlapFix(
  events: DutyEvent[],
  dutyId: string,
  opts?: PlanPostDutyOverlapOptions,
): PostDutyOverlapPlan {
  const duty = events.find((e) => e.id === dutyId && e.type === 'duty')
  if (!duty) {
    return {
      tryRestType10Travel: false,
      reserveAdjustments: [],
      removePeerIds: [],
      markDutyViolated: false,
      messages: [],
    }
  }

  const restId = restIdForDuty(dutyId)
  const rest = events.find((e) => e.id === restId && e.type === 'rest')
  const peers = candidatePeers(events, duty)
  // Only call-out / on-reserve FDPs may slide later reserve/standby starts.
  const onAvailability = dutyTakesPlaceOnAvailability(duty, events)

  const dutyOverlapsAssignment: DutyEvent[] = []
  const restOverlapsAssignment: DutyEvent[] = []
  const adjustablePeers: DutyEvent[] = []

  // Protected 12 h window for assignment-overlap messages (always 12 for flagging)
  const protected12End = new Date(
    protectedRestEndMs(duty, rest, DEFAULT_MIN_REST_H),
  )

  for (const p of peers) {
    // Reserve/standby: slide only when this FDP is on availability; otherwise
    // treat exactly like a conflicting duty assignment.
    if (isStartAdjustablePeer(p) && onAvailability) {
      adjustablePeers.push(p)
      continue
    }
    const floor =
      isStartAdjustablePeer(p) && p.scheduledStart && !isNaN(p.scheduledStart.getTime())
        ? peerScheduledStart(p)
        : p.start
    if (overlapsInterval(duty.start, duty.end, floor, p.end)) {
      dutyOverlapsAssignment.push(p)
    }
    if (
      overlapsInterval(duty.end, protected12End, floor, p.end) ||
      (rest && overlapsInterval(rest.start, rest.end, floor, p.end))
    ) {
      restOverlapsAssignment.push(p)
    }
  }

  const restAlreadyReduced =
    rest?.baseRestType === '10+travel' ||
    (rest?.requiredRestHours != null && rest.requiredRestHours <= 10 + 1e-6)
  const allowReduced =
    !!opts?.allowReducedRest || restAlreadyReduced

  const outcome12 = planAdjustablePeers(
    duty,
    rest,
    adjustablePeers,
    DEFAULT_MIN_REST_H,
  )
  const outcome10 = planAdjustablePeers(
    duty,
    rest,
    adjustablePeers,
    REDUCED_MIN_REST_H,
  )

  // Offer 10+travel when 12 h floor forces a worse slide/cancel than 10 h,
  // and 10 h is still legal for at least one peer (clearance before its end).
  let tryRestType10Travel = false
  if (!allowReduced && !restAlreadyReduced) {
    const worseAt12 =
      outcome12.removeIds.length > outcome10.removeIds.length ||
      outcome12.adjustments.some((a12) => {
        const a10 = outcome10.adjustments.find((x) => x.id === a12.id)
        if (!a10) return outcome10.removeIds.includes(a12.id) === false
        return a12.newStart.getTime() > a10.newStart.getTime() + TOL_MS
      }) ||
      outcome12.removeIds.some((id) => !outcome10.removeIds.includes(id))
    const tenFitsSomewhere = adjustablePeers.some((p) => {
      const end = p.end.getTime()
      const clear10 = duty.end.getTime() + REDUCED_MIN_REST_H * H
      return clear10 < end - TOL_MS
    })
    tryRestType10Travel = worseAt12 && tenFitsSomewhere
  }

  const outcome = allowReduced ? outcome10 : outcome12
  const adjustMap = new Map(
    outcome.adjustments.map((a) => [a.id, a] as const),
  )
  const removePeers = adjustablePeers.filter((p) =>
    outcome.removeIds.includes(p.id),
  )
  const anyNewSlide = outcome.anyNewSlide
  const anyResync = outcome.anyResync

  const reserveAdjustments = outcome.adjustments
  const removePeerIds = outcome.removeIds
  void adjustMap

  const unfixedDutyAssignment = dutyOverlapsAssignment.length > 0
  const unfixedRestAssignment = restOverlapsAssignment.length > 0

  // Wipe-outs are removed, not left as calendar violations on the duty
  const markDutyViolated = unfixedDutyAssignment || unfixedRestAssignment

  const adjustedPeers = reserveAdjustments
    .filter((a) => !a.clearDependency)
    .map((a) => a.peerType)
  const removedTypes = removePeers.map((p) => p.type as 'reserve' | 'standby')
  const hasAdjReserve =
    adjustedPeers.includes('reserve') || removedTypes.includes('reserve')
  const hasAdjStandby =
    adjustedPeers.includes('standby') || removedTypes.includes('standby')
  const adjustableNoun =
    hasAdjReserve && hasAdjStandby
      ? 'reserve/standby'
      : hasAdjStandby
        ? 'standby'
        : 'reserve'

  const messages: string[] = []
  if (unfixedDutyAssignment) {
    messages.push(
      'Your duty period overlaps the next assignment. Contact your company.',
    )
  }
  if (anyNewSlide && reserveAdjustments.some((a) => !a.clearDependency)) {
    messages.push(
      `Your duty or rest overlaps a ${adjustableNoun} period. We’ll adjust the start of the next ${adjustableNoun}. If needed, contact your company.`,
    )
  } else if (anyResync && reserveAdjustments.some((a) => a.clearDependency)) {
    // Resync that shortens a prior slide (dependency cleared) still notes restore;
    // quiet resync that only re-aligns start to duty/rest end is silent by design.
    messages.push(
      `Restored ${adjustableNoun} start to the original scheduled time.`,
    )
  }
  if (unfixedRestAssignment) {
    messages.push(
      tryRestType10Travel
        ? 'Required rest overlaps the next assignment (even if reduced to 10 h where legal). Contact your company.'
        : 'Required rest overlaps the next assignment. Contact your company.',
    )
  }
  if (removePeerIds.length > 0) {
    const remNoun =
      removedTypes.includes('reserve') && removedTypes.includes('standby')
        ? 'reserve/standby'
        : removedTypes.includes('standby')
          ? 'standby'
          : 'reserve'
    messages.push(
      `Duty or rest runs past the next ${remNoun} end — that ${remNoun} period was cancelled. Notify your company if required.`,
    )
  }

  const unique = [...new Set(messages)]

  return {
    tryRestType10Travel,
    reserveAdjustments,
    removePeerIds,
    markDutyViolated,
    messages: unique,
  }
}

/** Remove reserve/standby periods wiped by clearance past their end. */
export function applyAvailabilityRemovals(
  events: DutyEvent[],
  removeIds: string[],
): DutyEvent[] {
  if (removeIds.length === 0) return events
  const drop = new Set(removeIds)
  return events.filter((e) => !drop.has(e.id))
}

/**
 * Apply reserve/standby start moves (end unchanged) and dependency metadata.
 */
export function applyReserveStartAdjustments(
  events: DutyEvent[],
  adjustments: ReserveStartAdjustment[],
): DutyEvent[] {
  if (adjustments.length === 0) return events
  const byId = new Map(adjustments.map((a) => [a.id, a]))
  return events.map((e) => {
    const a = byId.get(e.id)
    if (!a) return e
    if (e.type !== 'reserve' && e.type !== 'standby') return e
    if (a.clearDependency) {
      return {
        ...e,
        start: new Date(a.scheduledStart.getTime()),
        scheduledStart: new Date(a.scheduledStart.getTime()),
        startDependsOnDutyId: undefined,
      }
    }
    return {
      ...e,
      start: new Date(a.newStart.getTime()),
      scheduledStart: new Date(a.scheduledStart.getTime()),
      startDependsOnDutyId: a.drivingDutyId,
    }
  })
}

/**
 * When a driving duty is deleted, restore dependents to scheduledStart and
 * drop the dependency link.
 */
export function clearAvailabilityDependenciesForDuty(
  events: DutyEvent[],
  dutyId: string,
): DutyEvent[] {
  return events.map((e) => {
    if (e.startDependsOnDutyId !== dutyId) return e
    if (e.type !== 'reserve' && e.type !== 'standby') return e
    const floor = peerScheduledStart(e)
    return {
      ...e,
      start: new Date(floor.getTime()),
      scheduledStart: new Date(floor.getTime()),
      startDependsOnDutyId: undefined,
    }
  })
}

/** Mark a duty violated (immutable). */
export function markDutyViolated(
  events: DutyEvent[],
  dutyId: string,
  violated: boolean,
): DutyEvent[] {
  if (!violated) return events
  return events.map((e) =>
    e.id === dutyId && e.type === 'duty' ? { ...e, violated: true } : e,
  )
}

/**
 * After plan + optional 10+travel recompute, re-run plan and produce final
 * events + single brief message.
 */
export function finalizePostDutyOverlaps(
  events: DutyEvent[],
  dutyId: string,
  opts?: PlanPostDutyOverlapOptions,
): {
  events: DutyEvent[]
  message: string | null
  adjusted: boolean
} {
  const plan = planPostDutyOverlapFix(events, dutyId, opts)
  let next = applyReserveStartAdjustments(events, plan.reserveAdjustments)
  next = applyAvailabilityRemovals(next, plan.removePeerIds)
  next = markDutyViolated(next, dutyId, plan.markDutyViolated)
  const message =
    plan.messages.length > 0 ? plan.messages.join(' ') : null
  return {
    events: next,
    message,
    adjusted:
      plan.reserveAdjustments.length > 0 ||
      plan.removePeerIds.length > 0 ||
      plan.markDutyViolated,
  }
}
