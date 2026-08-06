import { restampDutyAcclimatization } from './acclimatization'
import type {
  DutyEvent,
  Regulator,
  RestType,
  StoredDutyEvent,
} from './types'
import { isWorkEvent, SCHEDULE_SCHEMA_VERSION } from './types'
import {
  addCivilDaysInTimeZone,
  startOfDayInTimeZone,
} from './time'
import {
  computeLocalNightRest,
  dutyHasEarlyMarker,
  dutyHasLateMarker,
  dutyHasNightMarker,
  eventsOverlap,
  formatLnrViolationMessage,
  getMinRestHours,
  isDisruptiveTransition,
  type LnrViolationReason,
} from './regulations'
import {
  computeTimeZoneRestPlan,
  dutyAcclTZ,
  earliestLocalNightsRestEnd,
  plannedRestInterval,
  restPlanSatisfied,
  type TimeZoneRestPlan,
} from './rest-70042'
import {
  buildSingleDaysFree,
  CONSECUTIVE_WORK_DAYS_FOR_SDF,
  countConsecutiveWorkCalendarDays,
  countSdfsAfterWorkStartedInWindow,
  detectLocalNightsFromEvents,
  getWorkHoursInWindow,
  isSdfAbsolutelyRequired,
  shouldRequireSdfIn168,
  workActivitySpanHours,
} from './rest-70029'
import { evaluatePositioningRestForDuty } from './rest-70043'
import {
  buildSplitBreakRestEvent,
  isSplitBreakRest,
  splitBreakRestId,
} from './rest-70050'

const MS_168H = 168 * 60 * 60 * 1000

const VALID_TYPES = new Set([
  'duty',
  'rest',
  'reserve',
  'standby',
  'free',
])

export function serializeEvents(events: DutyEvent[]): StoredDutyEvent[] {
  return events.map((e) => ({
    schemaVersion: SCHEDULE_SCHEMA_VERSION,
    id: e.id,
    title: e.title,
    start: e.start.toISOString(),
    end: e.end.toISOString(),
    type: e.type,
    eventKind: e.eventKind,
    locationIcao: e.locationIcao,
    acclTZ: e.acclTZ,
    startTZ: e.startTZ,
    endTZ: e.endTZ,
    violated: e.violated,
    isLocalNightRest: e.isLocalNightRest,
    restKind: e.restKind,
    restRule: e.restRule,
    requiredRestHours: e.requiredRestHours,
    requiredLocalNights: e.requiredLocalNights,
    ruleWhy: e.ruleWhy,
    baseRestType: e.baseRestType,
    workFactor: e.workFactor,
    freePurpose: e.freePurpose,
    operatingSectors: e.operatingSectors,
    positioningSectors: e.positioningSectors,
    avgSectorTime: e.avgSectorTime,
    endsWithPositioning: e.endsWithPositioning,
    operatingEnd: e.operatingEnd?.toISOString(),
    positioningAgreed: e.positioningAgreed,
    flights: e.flights?.map((f) => ({
      id: f.id,
      depIcao: f.depIcao,
      arrIcao: f.arrIcao,
      dep: f.dep.toISOString(),
      arr: f.arr.toISOString(),
      isDeadhead: f.isDeadhead,
      customsPreclearance: f.customsPreclearance,
    })),
    reportOverridden: e.reportOverridden,
    releaseOverridden: e.releaseOverridden,
    splitBreak: e.splitBreak
      ? {
          start: e.splitBreak.start.toISOString(),
          end: e.splitBreak.end.toISOString(),
          locationIcao: e.splitBreak.locationIcao,
          unforeseenReplan: e.splitBreak.unforeseenReplan,
        }
      : undefined,
    rapStart: e.rapStart?.toISOString(),
    scheduledStart: e.scheduledStart?.toISOString(),
    startDependsOnDutyId: e.startDependsOnDutyId,
    importSource: e.importSource,
  }))
}

export function deserializeEvents(stored: StoredDutyEvent[]): DutyEvent[] {
  return stored
    .map((e) => {
      const operatingEnd = e.operatingEnd ? new Date(e.operatingEnd) : undefined
      const flights = e.flights
        ?.map((f) => {
          const dep = new Date(f.dep)
          const arr = new Date(f.arr)
          if (isNaN(dep.getTime()) || isNaN(arr.getTime())) return null
          return {
            id: f.id,
            depIcao: f.depIcao,
            arrIcao: f.arrIcao,
            dep,
            arr,
            isDeadhead: !!f.isDeadhead,
            customsPreclearance: f.customsPreclearance,
          }
        })
        .filter((f): f is NonNullable<typeof f> => f != null)
      return {
        id: e.id,
        title: e.title,
        start: new Date(e.start),
        end: new Date(e.end),
        type: VALID_TYPES.has(e.type) ? e.type : 'duty',
        eventKind: e.eventKind,
        locationIcao: e.locationIcao,
        acclTZ: e.acclTZ,
        startTZ: e.startTZ,
        endTZ: e.endTZ,
        violated: e.violated,
        isLocalNightRest: e.isLocalNightRest,
        restKind: e.restKind,
        restRule: e.restRule,
        requiredRestHours: e.requiredRestHours,
        requiredLocalNights: e.requiredLocalNights,
        ruleWhy: e.ruleWhy,
        baseRestType: e.baseRestType,
        workFactor: e.workFactor,
        freePurpose: e.freePurpose,
        operatingSectors: e.operatingSectors,
        positioningSectors: e.positioningSectors,
        avgSectorTime: e.avgSectorTime,
        endsWithPositioning: e.endsWithPositioning,
        operatingEnd:
          operatingEnd && !isNaN(operatingEnd.getTime())
            ? operatingEnd
            : undefined,
        positioningAgreed: e.positioningAgreed,
        flights: flights && flights.length > 0 ? flights : undefined,
        reportOverridden: e.reportOverridden,
        releaseOverridden: e.releaseOverridden,
        splitBreak: (() => {
          if (!e.splitBreak?.start || !e.splitBreak?.end) return undefined
          const start = new Date(e.splitBreak.start)
          const end = new Date(e.splitBreak.end)
          if (isNaN(start.getTime()) || isNaN(end.getTime())) return undefined
          return {
            start,
            end,
            locationIcao: e.splitBreak.locationIcao,
            unforeseenReplan: e.splitBreak.unforeseenReplan,
          }
        })(),
        rapStart: (() => {
          if (!e.rapStart) return undefined
          const d = new Date(e.rapStart)
          return isNaN(d.getTime()) ? undefined : d
        })(),
        scheduledStart: (() => {
          if (!e.scheduledStart) return undefined
          const d = new Date(e.scheduledStart)
          return isNaN(d.getTime()) ? undefined : d
        })(),
        startDependsOnDutyId: e.startDependsOnDutyId,
        importSource: e.importSource,
      }
    })
    .filter((e) => !isNaN(e.start.getTime()) && !isNaN(e.end.getTime()))
}

export function createId(suffix = ''): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID() + suffix
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}${suffix}`
}

export function restIdForDuty(dutyId: string): string {
  return `${dutyId}-rest`
}

export { splitBreakRestId, isSplitBreakRest, buildSplitBreakRestEvent }

export function findDutiesOnDate(events: DutyEvent[], date: Date): DutyEvent[] {
  const key = date.toDateString()
  return events.filter(
    (e) => e.type === 'duty' && e.start.toDateString() === key,
  )
}

/** First duty that starts on this local calendar day (legacy single-duty UI). */
export function findDutyOnDate(
  events: DutyEvent[],
  date: Date,
): DutyEvent | undefined {
  return findDutiesOnDate(events, date)[0]
}

/** User-editable work events starting on this calendar day (not rest/free). */
export function findEditableEventsOnDate(
  events: DutyEvent[],
  date: Date,
): DutyEvent[] {
  const key = date.toDateString()
  return events.filter(
    (e) =>
      (e.type === 'duty' || e.type === 'reserve' || e.type === 'standby') &&
      e.start.toDateString() === key,
  )
}

export function findEditableEventOnDate(
  events: DutyEvent[],
  date: Date,
): DutyEvent | undefined {
  return findEditableEventsOnDate(events, date)[0]
}

export function eventsOnLocalDay(
  events: DutyEvent[],
  date: Date,
  /** When set, day bounds use this IANA zone instead of browser local. */
  displayTZ?: string,
): DutyEvent[] {
  let dayStart: Date
  let dayEnd: Date
  if (displayTZ) {
    dayStart = startOfDayInTimeZone(date, displayTZ)
    dayEnd = addCivilDaysInTimeZone(dayStart, displayTZ, 1)
  } else {
    dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate())
    dayEnd = new Date(dayStart)
    dayEnd.setDate(dayEnd.getDate() + 1)
  }
  return events.filter((e) => e.start < dayEnd && e.end > dayStart)
}

/**
 * Remove a duty **or** reserve/standby and its managed rest (`{id}-rest`),
 * plus split-break rest when present. Caller should recompute compliance.
 */
export function removeDutyAndRelated(
  events: DutyEvent[],
  duty: DutyEvent,
): DutyEvent[] {
  const restId = restIdForDuty(duty.id)
  const splitId = splitBreakRestId(duty.id)
  const without = events.filter((e) => {
    if (e.id === duty.id || e.id === restId || e.id === splitId) return false
    // Drop auto LNRs; caller should recompute via recomputeLocalNightRests
    if (e.isLocalNightRest && e.restKind === 'lnr_disruptive') return false
    if (e.isLocalNightRest && !e.id.endsWith('-rest')) return false
    return true
  })
  return without
}

function restTitle(plan: TimeZoneRestPlan): string {
  if (plan.restRule === 'CAR 700.29' && plan.localNights >= 2) {
    return 'Required Rest — SDF (2× local night, 700.29)'
  }
  if (plan.localNights >= 3) {
    return `Required Rest — 3× local night (${plan.restRule.replace('CAR ', '')})`
  }
  if (plan.localNights === 2) {
    return `Required Rest — 2× local night (${plan.restRule.replace('CAR ', '')})`
  }
  if (plan.localNights === 1) {
    const code = plan.restRule.replace('CAR ', '')
    return `Required Rest — 1× local night (${code})`
  }
  if (plan.restRule === 'CAR 700.43') {
    return `Required Rest (${plan.restHours}h) — positioning (700.43)`
  }
  if (plan.restRule === 'CAR 700.42(1)') {
    return `Required Rest — ${plan.restHours}h (700.42(1))`
  }
  if (plan.restRule === 'CAR 700.42(2)') {
    return `Required Rest — ${plan.restHours}h (700.42(2))`
  }
  return plan.restHours === 10
    ? 'Required Rest (10+travel)'
    : `Required Rest (${plan.restHours}h)`
}

/**
 * CAR 700.43 — increase clock rest after trailing positioning when total duty
 * exceeds max FDP. Stacks by taking the longer of positioning rest vs plan.
 * Does not reduce local nights already required by 700.41/42/51/29.
 */
export function applyPositioningRestToPlan(
  plan: TimeZoneRestPlan,
  duty: DutyEvent,
  regulator: Regulator,
  globalAcclTZ: string,
  fallbackSectors = 1,
): TimeZoneRestPlan {
  const pos = evaluatePositioningRestForDuty(
    duty,
    regulator,
    globalAcclTZ,
    fallbackSectors,
    duty.avgSectorTime ?? '>=50',
  )
  if (!pos || pos.restHours <= 0) return plan

  if (pos.restHours > plan.restHours + 1e-9) {
    return {
      ...plan,
      restHours: pos.restHours,
      restKind: 'positioning',
      restRule: 'CAR 700.43',
      why:
        plan.why && plan.localNights > 0
          ? `${pos.why} Local night requirement(s) from other rules still apply (${plan.localNights}×). Prior plan: ${plan.why}`
          : plan.why
            ? `${pos.why} (Replaces shorter clock rest under ${plan.restRule}: ${plan.why})`
            : pos.why,
    }
  }

  // Positioning evaluated but another rule already requires equal/longer clock rest
  return {
    ...plan,
    why: `${plan.why} Also evaluated CAR 700.43 positioning rest (${pos.restHours.toFixed(1)} h); existing plan is longer or equal.`,
  }
}

/**
 * Phantom (what-if) rest extension for CAR 700.41: after an early duty, shows
 * how far rest would need to run if the next FDP were late/night; after a
 * late/night duty, if the next were early. Only when the solid rest bar is
 * still shorter than one local night’s rest (i.e. disruptive LNR not already
 * folded into this rest for a real next duty).
 */
export interface PhantomDisruptiveRest {
  end: Date
  reason: string
  ifNextLabel: string
  thisDutyLabel: string
  solidRestEnd: Date
}

export function phantomDisruptiveRestExtension(
  duty: DutyEvent,
  rest: DutyEvent,
  regulator: Regulator,
  globalAcclTZ: string,
  nextDuty?: DutyEvent | null,
): PhantomDisruptiveRest | null {
  if (regulator !== 'TC' || duty.type !== 'duty' || rest.type !== 'rest') {
    return null
  }

  const early = dutyHasEarlyMarker(duty, regulator, globalAcclTZ)
  const late = dutyHasLateMarker(duty, regulator, globalAcclTZ)
  const night = dutyHasNightMarker(duty, regulator, globalAcclTZ)
  if (!early && !late && !night) return null

  // Real next already triggers 700.41 → solid bar should include LNR; no phantom
  if (
    nextDuty &&
    isDisruptiveTransition(duty, nextDuty, regulator, globalAcclTZ)
  ) {
    return null
  }

  const accl = dutyAcclTZ(duty, globalAcclTZ)
  const lnrEnd = earliestLocalNightsRestEnd(duty.end, accl, 1)
  // Already at least as long as one LNR (e.g. multi-night 700.42/700.29)
  if (lnrEnd.getTime() <= rest.end.getTime() + 60_000) return null

  // Directional 700.41: E → L/N, or L/N → E (not a vague “either could be a problem”)
  let thisDutyLabel: string
  let ifNextLabel: string
  if (early) {
    thisDutyLabel = 'early'
    ifNextLabel = 'night or late'
  } else if (night && late) {
    thisDutyLabel = 'night and late'
    ifNextLabel = 'early'
  } else if (night) {
    thisDutyLabel = 'night'
    ifNextLabel = 'early'
  } else {
    thisDutyLabel = 'late'
    ifNextLabel = 'early'
  }

  return {
    end: lnrEnd,
    ifNextLabel,
    thisDutyLabel,
    solidRestEnd: rest.end,
    reason: `Because this duty is ${thisDutyLabel}, if the next duty is ${ifNextLabel}, CAR 700.41 requires one local night’s rest (LNR: ≥9 h inside 22:30–09:30 acclimatized) before that next FDP — earliest completion ${lnrEnd.toLocaleString()}. The filled bar is only the rest that applies with your current schedule (usually the 700.40 clock minimum). The outline is that what-if LNR: it is not required unless the next duty is actually ${ifNextLabel}.`,
  }
}

/**
 * Fold CAR 700.41 disruptive-schedule LNR into the post-duty rest plan when
 * the following duty creates a late/night ↔ early transition.
 */
export function applyDisruptiveScheduleToPlan(
  plan: TimeZoneRestPlan,
  duty: DutyEvent,
  next: DutyEvent | undefined,
  regulator: Regulator,
  globalAcclTZ: string,
): TimeZoneRestPlan {
  if (!next || regulator !== 'TC') return plan
  if (!isDisruptiveTransition(duty, next, regulator, globalAcclTZ)) {
    return plan
  }
  const priorNights = plan.localNights
  const localNights = Math.max(plan.localNights, 1)
  const disruptiveWhy =
    'CAR 700.41 requires one local night’s rest between this duty and the following early/late/night transition (in addition to the 700.40 rest minimum).'

  if (priorNights < 1) {
    return {
      ...plan,
      localNights,
      restKind: 'lnr_disruptive',
      restRule: 'CAR 700.41',
      why: disruptiveWhy,
    }
  }
  return {
    ...plan,
    localNights,
    why: `${plan.why} Additionally: ${disruptiveWhy}`,
  }
}

/**
 * Fold CAR 700.29 single day free from duty into a post-work rest plan.
 *
 * `workEvent` may be a duty **or** reserve/standby (hours of work under 700.29).
 * Free-day structure is only attached when absolutely required (cannot legally
 * defer past the next work period, or the week is already closed).
 *
 * When attached, rest ends at the **earliest legal free-day completion**.
 */
export function applySdfStructureToPlan(
  plan: TimeZoneRestPlan,
  workEvent: DutyEvent,
  scheduleEvents: DutyEvent[],
  regulator: Regulator,
  globalAcclTZ: string,
  /** Next work event (duty, reserve, or standby) after this release. */
  nextWork?: DutyEvent,
): TimeZoneRestPlan {
  if (regulator !== 'TC') return plan

  const windowEnd = workEvent.end
  const windowStart = new Date(windowEnd.getTime() - MS_168H)
  const workH = getWorkHoursInWindow(scheduleEvents, windowStart, windowEnd)
  const span = workActivitySpanHours(scheduleEvents, windowStart, windowEnd)
  const accl = dutyAcclTZ(workEvent, globalAcclTZ)
  const consecutiveDays = countConsecutiveWorkCalendarDays(
    scheduleEvents,
    workEvent.end,
    accl,
  )
  if (!shouldRequireSdfIn168(workH, span, consecutiveDays)) return plan

  const lnrs = detectLocalNightsFromEvents(scheduleEvents, globalAcclTZ)
  const sdfs = buildSingleDaysFree(lnrs, scheduleEvents)
  // Only free days that start after work has begun in this lookback count as
  // already covering structure. A free weekend sitting only in the leading gap
  // (before the first RAP/duty of the window) is outside the problem period —
  // even though a raw 168 h lookback from the last release still contains it.
  // ≥5 consecutive work days still force free-day rest after the block.
  const coveringAfterWork = countSdfsAfterWorkStartedInWindow(
    sdfs,
    scheduleEvents,
    windowStart,
    windowEnd,
  )
  if (
    consecutiveDays < CONSECUTIVE_WORK_DAYS_FOR_SDF &&
    coveringAfterWork >= 1
  ) {
    return plan
  }

  if (
    !isSdfAbsolutelyRequired({
      dutyEnd: workEvent.end,
      nextDutyStart: nextWork?.start,
      nextDutyEnd: nextWork?.end,
      scheduleEvents,
      acclTZ: accl,
      lastWorkEvent: workEvent,
    })
  ) {
    return plan
  }

  const earliestSdfEnd = earliestLocalNightsRestEnd(workEvent.end, accl, 2)
  const priorNights = plan.localNights
  const localNights = Math.max(plan.localNights, 2)
  const kindLabel =
    workEvent.type === 'reserve'
      ? 'reserve period'
      : workEvent.type === 'standby'
        ? 'standby period'
        : 'release'
  const reason =
    consecutiveDays >= CONSECUTIVE_WORK_DAYS_FOR_SDF
      ? `${consecutiveDays} consecutive local calendar days of work end at this ${kindLabel} — free day is required after this block (earliest free-day end ${earliestSdfEnd.toLocaleString()}), even if an earlier free day sits elsewhere in the 168 h window`
      : nextWork
        ? `the next work period (${nextWork.type}) starts at ${nextWork.start.toLocaleString()}, and free day cannot wait until after it — free day must begin after this ${kindLabel} (earliest free-day end ${earliestSdfEnd.toLocaleString()})`
        : `further work cannot be added after this ${kindLabel} without leaving insufficient room for a single day free from duty in the rolling 168 h window — free day is required now (earliest free-day end ${earliestSdfEnd.toLocaleString()})`
  const sdfWhy = `In the 168 h ending at this ${kindLabel} there are ${workH.toFixed(1)} h of work (duty 100%, standby 100%, reserve 33%) over ${span.toFixed(0)} h of activity and no single day free from duty fully inside the window. CAR 700.29(1)(c): free day is required when further work would make it impossible to complete. ${reason}.`

  if (priorNights < 2) {
    if (priorNights < 1) {
      return {
        ...plan,
        localNights,
        restKind: 'sdf_structure',
        restRule: 'CAR 700.29',
        why: sdfWhy,
      }
    }
    return {
      ...plan,
      localNights,
      restKind: 'sdf_structure',
      restRule: 'CAR 700.29',
      why: `${plan.why} Additionally: ${sdfWhy}`,
    }
  }
  return {
    ...plan,
    localNights,
    why: `${plan.why} Additionally: ${sdfWhy}`,
  }
}

/** Slack after availability end still treated as call-out from that RAP/stby. */
const AVAIL_CALL_OUT_SLACK_MS = 2 * 3_600_000

/**
 * True when a duty is a call-out from this reserve/standby (stored RAP start
 * inside the period, or report during / shortly after the period).
 * When true, post-FDP rest is owned by the duty — do not also rest after RAP.
 */
export function availabilitySpawnedCallOut(
  avail: DutyEvent,
  events: DutyEvent[],
): boolean {
  if (avail.type !== 'reserve' && avail.type !== 'standby') return false
  const a0 = avail.start.getTime()
  const a1 = avail.end.getTime()
  return events.some((e) => {
    if (e.type !== 'duty') return false
    if (e.rapStart && !isNaN(e.rapStart.getTime())) {
      const r = e.rapStart.getTime()
      if (r >= a0 - 1000 && r <= a1 + AVAIL_CALL_OUT_SLACK_MS) return true
    }
    const s = e.start.getTime()
    return s >= a0 - 1000 && s <= a1 + AVAIL_CALL_OUT_SLACK_MS
  })
}

/**
 * Required rest after reserve or standby that did **not** produce an FDP
 * (pilot not called / no assignment during the period).
 *
 * Regulatory basis (TC):
 * - Standby and reserve count as hours of work (700.29(3): 100% / 33%).
 * - CAR 700.40 minimum rest (12 h TC) is required **before further duty** after
 *   a period of duty-like availability ends without an intervening FDP rest.
 * - When a call-out FDP exists, rest is the post-FDP rest only (skip here).
 * - CAR 700.29 free-day structure attaches when the rolling 168 h window ending
 *   at availability end makes free day absolutely required (same gates as FDP).
 */
export function buildRequiredRestAfterAvailability(
  avail: DutyEvent,
  allEvents: DutyEvent[],
  regulator: Regulator,
  globalAcclTZ: string,
): DutyEvent | null {
  if (avail.type !== 'reserve' && avail.type !== 'standby') return null
  if (availabilitySpawnedCallOut(avail, allEvents)) return null

  const hours = getMinRestHours(regulator)
  const accl = dutyAcclTZ(avail, globalAcclTZ)
  const work = allEvents
    .filter(
      (e) =>
        (e.type === 'duty' || e.type === 'reserve' || e.type === 'standby') &&
        e.id !== avail.id,
    )
    .sort((a, b) => a.start.getTime() - b.start.getTime())
  const nextWork = work.find((w) => w.start.getTime() >= avail.end.getTime() - 500)

  const baseWhy =
    avail.type === 'standby'
      ? 'Standby ended without an assigned flight duty period. Minimum rest under CAR 700.40 applies before further duty (standby is 100% hours of work under 700.29(3)).'
      : 'Reserve availability period ended without call-out (no FDP from this RAP). Minimum rest under CAR 700.40 applies before further duty (reserve is 33% hours of work under 700.29(3)).'

  let plan: TimeZoneRestPlan = {
    restHours: hours,
    localNights: 0,
    restKind: 'base',
    restRule: 'CAR 700.40',
    why: baseWhy,
  }

  // Schedule without managed rests for 700.29 scan
  const scheduleForScan = allEvents.filter(
    (e) => !(e.type === 'rest' && e.id.endsWith('-rest')),
  )
  plan = applySdfStructureToPlan(
    plan,
    avail,
    scheduleForScan,
    regulator,
    globalAcclTZ,
    nextWork,
  )

  const { start, end } = plannedRestInterval(avail.end, plan, accl)
  const isLnr = plan.localNights > 0
  const title =
    plan.localNights >= 2
      ? 'Required Rest — free day (700.29)'
      : plan.localNights === 1
        ? 'Required Rest — 1× local night'
        : avail.type === 'standby'
          ? 'Required Rest after standby'
          : 'Required Rest after reserve'

  return {
    id: restIdForDuty(avail.id),
    title,
    start,
    end,
    type: 'rest',
    acclTZ: accl,
    restKind: plan.restKind,
    restRule: plan.restRule,
    requiredRestHours: plan.restHours,
    requiredLocalNights: plan.localNights > 0 ? plan.localNights : undefined,
    isLocalNightRest: isLnr,
    ruleWhy: plan.why,
    violated: false,
    baseRestType: '12h',
  }
}

/**
 * Infer the user's base rest preference from a previously built duty-rest event.
 */
export function inferBaseRestType(rest?: DutyEvent): RestType {
  if (!rest) return '12h'
  if (rest.baseRestType === '10+travel' || rest.baseRestType === '12h') {
    return rest.baseRestType
  }
  if (rest.title.includes('10+travel')) return '10+travel'
  if (rest.requiredRestHours === 10 && rest.restKind === 'base') return '10+travel'
  return '12h'
}

/**
 * Build the single required rest after a duty.
 * Merges 700.40 / 700.42 / 700.51 / 700.41 / 700.29 / 700.43 into one bar: the
 * longest of clock rest and earliest LNR completion (no separate LNR strip).
 *
 * @param scheduleEvents optional full schedule (duty/reserve/standby/free) for
 *   700.29 hours-of-work and free-day detection; defaults to `allDuties`.
 */
export function buildRequiredRestForDuty(
  duty: DutyEvent,
  allDuties: DutyEvent[],
  regulator: Regulator,
  homeBaseTZ: string,
  globalAcclTZ: string,
  restType: RestType,
  scheduleEvents?: DutyEvent[],
): DutyEvent {
  const duties = [...allDuties]
    .filter((e) => e.type === 'duty')
    .sort((a, b) => a.start.getTime() - b.start.getTime())
  if (!duties.some((d) => d.id === duty.id)) {
    duties.push(duty)
    duties.sort((a, b) => a.start.getTime() - b.start.getTime())
  }
  const idx = duties.findIndex((d) => d.id === duty.id)
  const nextDuty = idx >= 0 ? duties[idx + 1] : undefined
  const schedule = scheduleEvents ?? duties
  // Next work of any kind (duty/reserve/standby) for 700.29 free-day deferral
  const nextWork =
    schedule
      .filter((e) => isWorkEvent(e) && e.id !== duty.id)
      .filter((e) => e.start.getTime() >= duty.end.getTime() - 500)
      .sort((a, b) => a.start.getTime() - b.start.getTime())[0] ?? nextDuty

  let plan = computeTimeZoneRestPlan(
    duty,
    duties,
    regulator,
    homeBaseTZ,
    globalAcclTZ,
    restType,
  )
  plan = applyDisruptiveScheduleToPlan(
    plan,
    duty,
    nextDuty,
    regulator,
    globalAcclTZ,
  )
  plan = applySdfStructureToPlan(
    plan,
    duty,
    schedule,
    regulator,
    globalAcclTZ,
    nextWork,
  )
  plan = applyPositioningRestToPlan(
    plan,
    duty,
    regulator,
    globalAcclTZ,
    duty.operatingSectors ?? 1,
  )

  const accl = dutyAcclTZ(duty, globalAcclTZ)
  const { start, end } = plannedRestInterval(duty.end, plan, accl)
  const isLnr = plan.localNights > 0

  return {
    id: restIdForDuty(duty.id),
    title: restTitle(plan),
    start,
    end,
    type: 'rest',
    acclTZ: accl,
    restKind: plan.restKind,
    restRule: plan.restRule,
    requiredRestHours: plan.restHours,
    requiredLocalNights: plan.localNights > 0 ? plan.localNights : undefined,
    isLocalNightRest: isLnr,
    ruleWhy: plan.why,
    violated: false,
    baseRestType: restType,
  }
}

/** @deprecated Prefer buildRequiredRestForDuty for TC 700.42 support */
export function buildRestEvent(
  dutyId: string,
  restStart: Date,
  restHours: number,
  restType: RestType,
): DutyEvent {
  const end = new Date(restStart.getTime() + restHours * 60 * 60 * 1000)
  return {
    id: restIdForDuty(dutyId),
    title:
      restType === '10+travel' ? 'Required Rest (10+travel)' : 'Required Rest',
    start: restStart,
    end,
    type: 'rest',
    restKind: 'base',
    restRule: 'CAR 700.40',
    requiredRestHours: restHours,
  }
}

/**
 * Re-evaluate required rest events against the next duty (clock + multi-LNR).
 */
export function annotateRestViolations(
  events: DutyEvent[],
  globalAcclTZ: string,
): DutyEvent[] {
  const duties = events
    .filter((e) => e.type === 'duty')
    .sort((a, b) => a.start.getTime() - b.start.getTime())

  return events.map((e) => {
    // Only duty-linked required rests (one per FDP)
    if (e.type !== 'rest' || !e.id.endsWith('-rest')) return e

    const dutyId = e.id.slice(0, -'-rest'.length)
    const dutyIdx = duties.findIndex((d) => d.id === dutyId)
    const following =
      dutyIdx >= 0 && dutyIdx < duties.length - 1
        ? duties[dutyIdx + 1]
        : undefined

    const accl = e.acclTZ || duties[dutyIdx]?.acclTZ || globalAcclTZ
    const plan: TimeZoneRestPlan = {
      restHours: e.requiredRestHours ?? getMinRestHours('TC'),
      localNights: e.requiredLocalNights ?? 0,
      restKind: e.restKind ?? 'base',
      restRule: e.restRule ?? 'CAR 700.40',
      why: e.ruleWhy ?? '',
      zoneDiffHours: 0,
      timeAwayHours: null,
      endsAtHome: false,
      endsAway: false,
      startsAway: false,
      woclOnReturn: false,
      consecutiveWoclDuties: 0,
    }
    const check = restPlanSatisfied(
      plan,
      e.start,
      following ? following.start : null,
      accl,
    )
    if (check.ok === !e.violated && check.ok) return e
    return {
      ...e,
      violated: !check.ok,
      ruleWhy: check.ok
        ? e.ruleWhy
        : `${e.ruleWhy ?? ''}\n${check.detail}`.trim(),
      title: check.ok
        ? e.title.replace(/ — not met$/, '')
        : e.title.includes('not met')
          ? e.title
          : `${e.title} — not met`,
    }
  })
}

/**
 * If previous→next is a disruptive schedule transition (700.41), create an LNR
 * event spanning the gap. Covers (L|N)→E and E→(L|N), not only N→E.
 */
export function maybeBuildLnrBetween(
  previous: DutyEvent,
  next: DutyEvent,
  regulator: Regulator,
  globalAcclTZ: string,
  existingDuties: DutyEvent[],
): DutyEvent | null {
  if (previous.type !== 'duty' || next.type !== 'duty') return null
  if (!isDisruptiveTransition(previous, next, regulator, globalAcclTZ)) {
    return null
  }

  const tz = previous.acclTZ || next.acclTZ || globalAcclTZ
  const minRest = getMinRestHours(regulator)
  const result = computeLocalNightRest(
    previous.end,
    next.start,
    tz,
    minRest,
  )
  const reasons: LnrViolationReason[] = [...result.reasons]

  const overlapsDuty = existingDuties.some(
    (e) =>
      e.type === 'duty' &&
      e.id !== previous.id &&
      e.id !== next.id &&
      eventsOverlap(result.start, result.end, e.start, e.end),
  )
  if (overlapsDuty) reasons.push('duty_overlap')

  const violated = reasons.length > 0
  const title = violated
    ? formatLnrViolationMessage(reasons, {
        gapHours: result.gapHours,
        nightWindowHours: result.nightWindowHours,
        minRestHours: minRest,
      })
    : 'Local Night Rest (CAR 700.41)'

  const why = violated
    ? title
    : `Disruptive schedule transition (CAR 700.41): rest between duties must include one local night’s rest (≥9 h inside 22:30–09:30 in ${tz.replace(/_/g, ' ')}).`

  return {
    id: createId('-lnr'),
    title,
    start: result.start,
    end: result.end,
    type: 'rest',
    acclTZ: tz,
    isLocalNightRest: true,
    restKind: 'lnr_disruptive',
    restRule: 'CAR 700.41',
    requiredLocalNights: 1,
    requiredRestHours: minRest,
    ruleWhy: why,
    violated,
  }
}

/**
 * Build a user-facing message for violated rest / LNR events (save alerts).
 */
export function summarizeViolatedLnrs(events: DutyEvent[]): string | null {
  const bad = events.filter(
    (e) =>
      e.type === 'rest' &&
      e.violated &&
      (e.isLocalNightRest ||
        e.restRule === 'CAR 700.42(1)' ||
        e.restRule === 'CAR 700.42(2)' ||
        e.restRule === 'CAR 700.41' ||
        e.restRule === 'CAR 700.43' ||
        e.restRule === 'CAR 700.51'),
  )
  if (bad.length === 0) return null
  if (bad.length === 1) {
    return bad[0].ruleWhy || bad[0].title
  }
  return `${bad.length} rest / local night requirements are not met.\n\n${bad
    .map((e) => e.ruleWhy || e.title)
    .join('\n\n')}`
}

/**
 * Strip legacy separate auto-LNR bars (not the single duty-linked rest).
 * Duty rests use ids ending in `-rest` and must be preserved.
 */
export function stripAllLnr(events: DutyEvent[]): DutyEvent[] {
  return events.filter(
    (e) =>
      !(
        e.type === 'rest' &&
        e.isLocalNightRest &&
        !e.id.endsWith('-rest')
      ),
  )
}

/**
 * Strip legacy separate 700.41 LNR bars (no longer drawn — LNR is folded into
 * the single duty-linked rest) and re-annotate violation flags.
 */
export function recomputeLocalNightRests(
  events: DutyEvent[],
  _regulator: Regulator,
  globalAcclTZ: string,
): DutyEvent[] {
  const base = stripAllLnr(events)
  return annotateRestViolations(base, globalAcclTZ)
}

/**
 * True if this rest is auto-managed (duty-linked required rest or 700.41 LNR).
 * Manual / unknown rests without these markers are left alone if ever introduced.
 */
export function isManagedRestEvent(e: DutyEvent): boolean {
  if (e.type !== 'rest') return false
  if (e.id.endsWith('-rest')) return true
  if (isSplitBreakRest(e)) return true
  if (e.restKind === 'lnr_disruptive') return true
  if (e.isLocalNightRest && e.restRule === 'CAR 700.41') return true
  // Legacy auto LNRs (no restKind, random id)
  if (e.isLocalNightRest && !e.id.endsWith('-rest')) return true
  return false
}

/** Events that are not duties/rests for calendar bars (reserve, standby, free). */
export function isAuxiliaryScheduleEvent(e: DutyEvent): boolean {
  return e.type === 'reserve' || e.type === 'standby' || e.type === 'free'
}

/**
 * Rebuild every duty's single required rest
 * (700.40 / 700.41 / 700.42 / 700.51 / 700.29) from the full chronological
 * schedule, then annotate violation flags.
 *
 * One rest bar per FDP = longest of clock minimum and earliest LNR completion
 * (including two local nights when a 168 h window requires a single day free).
 *
 * @param restTypeForDuty optional map dutyId → base rest preference for duties
 *   being saved from the form; other duties keep their previous preference.
 */
export function recomputeScheduleCompliance(
  events: DutyEvent[],
  regulator: Regulator,
  homeBaseTZ: string,
  globalAcclTZ: string,
  restTypeForDuty?: Record<string, RestType>,
): DutyEvent[] {
  // CAR 700.28(5): restamp each duty’s acclTZ from home base + time in zone
  // so Max FDP / E/L/N use acclimatized time across multi-TZ pairings.
  const restamped = restampDutyAcclimatization(events, homeBaseTZ || globalAcclTZ)

  const duties = restamped
    .filter((e) => e.type === 'duty')
    .sort((a, b) => a.start.getTime() - b.start.getTime())

  const prevRestByDuty = new Map<string, DutyEvent>()
  for (const e of restamped) {
    if (e.type === 'rest' && e.id.endsWith('-rest')) {
      const dutyId = e.id.slice(0, -'-rest'.length)
      prevRestByDuty.set(dutyId, e)
    }
  }

  // Duties get rebuilt rests; preserve reserve/standby/free and non-managed rests.
  const availabilities = restamped.filter(
    (e) => e.type === 'reserve' || e.type === 'standby',
  )
  const preserved = restamped.filter(
    (e) =>
      e.type === 'reserve' ||
      e.type === 'standby' ||
      e.type === 'free' ||
      (e.type === 'rest' && !isManagedRestEvent(e)),
  )

  // Full schedule without managed rests (for 700.29 work / free-day scan)
  const scheduleFor70029 = [...duties, ...preserved]

  const rests = duties.map((d) => {
    const pref =
      restTypeForDuty?.[d.id] ?? inferBaseRestType(prevRestByDuty.get(d.id))
    // Per-duty acclTZ (after restamp) is preferred over global settings accl
    const dutyAccl = d.acclTZ || globalAcclTZ
    return buildRequiredRestForDuty(
      d,
      duties,
      regulator,
      homeBaseTZ,
      dutyAccl,
      pref,
      scheduleFor70029,
    )
  })

  // Rest after reserve/standby with no call-out FDP (700.40 + optional 700.29 SDF)
  const availRests = availabilities
    .map((a) =>
      buildRequiredRestAfterAvailability(
        a,
        scheduleFor70029,
        regulator,
        a.acclTZ || globalAcclTZ,
      ),
    )
    .filter((r): r is DutyEvent => r != null)

  // Mid-FDP split-duty breaks (CAR 700.50) — rebuilt from duty.splitBreak
  const splitRests = duties
    .map((d) => buildSplitBreakRestEvent(d))
    .filter((r): r is DutyEvent => r != null)

  return recomputeLocalNightRests(
    [...duties, ...rests, ...availRests, ...splitRests, ...preserved],
    regulator,
    globalAcclTZ,
  )
}

/**
 * Full post-mutation recompute after adding/updating one duty.
 * Rebuilds required rest for **all** duties (not only the changed one).
 */
export function recomputeAfterDutyChange(
  events: DutyEvent[],
  duty: DutyEvent,
  regulator: Regulator,
  homeBaseTZ: string,
  globalAcclTZ: string,
  restType: RestType,
): DutyEvent[] {
  const withoutOldRest = events.filter(
    (e) =>
      e.id !== restIdForDuty(duty.id) && e.id !== splitBreakRestId(duty.id),
  )
  const withDuty = withoutOldRest.some((e) => e.id === duty.id)
    ? withoutOldRest.map((e) => (e.id === duty.id ? duty : e))
    : [...withoutOldRest, duty]

  return recomputeScheduleCompliance(
    withDuty,
    regulator,
    homeBaseTZ,
    globalAcclTZ,
    { [duty.id]: restType },
  )
}

/** Notice when next FDP compresses prior rest into legal CAR 700.40 10+travel. */
export interface TenPlusTravelCompression {
  previousDutyId: string
  previousRelease: Date
  nextDutyId: string
  gapHours: number
  requiredRestHours: number
}

function collectRestTypePrefs(events: DutyEvent[]): Record<string, RestType> {
  const prefs: Record<string, RestType> = {}
  for (const e of events) {
    if (e.type === 'rest' && e.id.endsWith('-rest')) {
      const dutyId = e.id.slice(0, -'-rest'.length)
      prefs[dutyId] = inferBaseRestType(e)
    }
  }
  return prefs
}

/**
 * If adding/editing `triggeringDutyId` leaves only 10–12 h after the previous
 * FDP, and 10 h rest (CAR 700.40 10+travel) is legally sufficient while 12 h is
 * not, convert the previous duty’s base rest to 10+travel and return a notice
 * for crew acknowledgment + travel-time reminders.
 */
export function applyTenPlusTravelIfRestCompressed(
  events: DutyEvent[],
  triggeringDutyId: string,
  regulator: Regulator,
  homeBaseTZ: string,
  globalAcclTZ: string,
): { events: DutyEvent[]; notice: TenPlusTravelCompression | null } {
  if (regulator !== 'TC') {
    return { events, notice: null }
  }

  const duties = events
    .filter((e) => e.type === 'duty')
    .sort((a, b) => a.start.getTime() - b.start.getTime())
  const idx = duties.findIndex((d) => d.id === triggeringDutyId)
  if (idx <= 0) return { events, notice: null }

  const prev = duties[idx - 1]
  const next = duties[idx]
  const gapHours =
    (next.start.getTime() - prev.end.getTime()) / (1000 * 60 * 60)

  // Only the “reduced between 10 and 12 h” band
  if (gapHours < 10 - 1e-6 || gapHours >= 12 - 1e-6) {
    return { events, notice: null }
  }

  const existingRest = events.find((e) => e.id === restIdForDuty(prev.id))
  // Already on 10+travel — no conversion / no popup
  if (inferBaseRestType(existingRest) === '10+travel') {
    return { events, notice: null }
  }

  // Only act when the next duty actually collides with the prior required rest
  // (or that rest is already flagged short). Pure schedule edits with a clean
  // gap should not force reduced rest.
  if (
    existingRest &&
    !existingRest.violated &&
    !eventsOverlap(existingRest.start, existingRest.end, next.start, next.end)
  ) {
    return { events, notice: null }
  }

  const nonManaged = events.filter(
    (e) => e.type !== 'rest' || !isManagedRestEvent(e),
  )
  const scheduleFor70029 = [
    ...duties,
    ...nonManaged.filter((e) => e.type !== 'duty'),
  ]

  const restIf12 = buildRequiredRestForDuty(
    prev,
    duties,
    regulator,
    homeBaseTZ,
    globalAcclTZ,
    '12h',
    scheduleFor70029,
  )
  const restIf10 = buildRequiredRestForDuty(
    prev,
    duties,
    regulator,
    homeBaseTZ,
    globalAcclTZ,
    '10+travel',
    scheduleFor70029,
  )

  const accl = restIf10.acclTZ || prev.acclTZ || globalAcclTZ
  const plan12: TimeZoneRestPlan = {
    restHours: restIf12.requiredRestHours ?? 12,
    localNights: restIf12.requiredLocalNights ?? 0,
    restKind: restIf12.restKind ?? 'base',
    restRule: restIf12.restRule ?? 'CAR 700.40',
    why: restIf12.ruleWhy ?? '',
    zoneDiffHours: 0,
    timeAwayHours: null,
    endsAtHome: false,
    endsAway: false,
    startsAway: false,
    woclOnReturn: false,
    consecutiveWoclDuties: 0,
  }
  const plan10: TimeZoneRestPlan = {
    ...plan12,
    restHours: restIf10.requiredRestHours ?? 10,
    localNights: restIf10.requiredLocalNights ?? 0,
    restKind: restIf10.restKind ?? 'base',
    restRule: restIf10.restRule ?? 'CAR 700.40',
    why: restIf10.ruleWhy ?? '',
  }

  const sat12 = restPlanSatisfied(plan12, prev.end, next.start, accl)
  const sat10 = restPlanSatisfied(plan10, prev.end, next.start, accl)

  // 10+travel must be legal; 12 h must not fit (compression into reduced rest)
  if (!sat10.ok || sat12.ok) {
    return { events, notice: null }
  }

  // Must still be a base-clock path (not LNR-heavy) for “10 h was an option”
  if ((restIf10.requiredLocalNights ?? 0) > 0) {
    return { events, notice: null }
  }

  const req10 = restIf10.requiredRestHours ?? 10
  const prefs = collectRestTypePrefs(events)
  prefs[prev.id] = '10+travel'
  const nextEvents = recomputeScheduleCompliance(
    events,
    regulator,
    homeBaseTZ,
    globalAcclTZ,
    prefs,
  )

  // Clear a stale “duty overlaps rest” flag on the following FDP when reduced
  // rest fully resolves the collision under CAR 700.40.
  const cleaned = nextEvents.map((e) =>
    e.id === next.id && e.violated ? { ...e, violated: false } : e,
  )

  return {
    events: cleaned,
    notice: {
      previousDutyId: prev.id,
      previousRelease: prev.end,
      nextDutyId: next.id,
      gapHours,
      requiredRestHours: req10,
    },
  }
}

/**
 * Dry-run: after placing `duty` on the schedule, would CAR 700.40 10+travel
 * legally resolve compression of the previous FDP’s required rest?
 * Used before the “overlaps rest” confirm so we can auto-apply reduced rest.
 */
export function previewTenPlusTravelCompression(
  events: DutyEvent[],
  duty: DutyEvent,
  regulator: Regulator,
  homeBaseTZ: string,
  globalAcclTZ: string,
  restType: RestType = '12h',
): TenPlusTravelCompression | null {
  if (regulator !== 'TC') return null
  const withoutSelf = events.filter(
    (e) => e.id !== duty.id && e.id !== restIdForDuty(duty.id),
  )
  const recomputed = recomputeAfterDutyChange(
    withoutSelf,
    duty,
    regulator,
    homeBaseTZ,
    globalAcclTZ,
    restType,
  )
  return applyTenPlusTravelIfRestCompressed(
    recomputed,
    duty.id,
    regulator,
    homeBaseTZ,
    globalAcclTZ,
  ).notice
}

/**
 * After deleting a duty (and its linked rest), rebuild compliance for survivors.
 */
export function recomputeAfterDutyDelete(
  events: DutyEvent[],
  regulator: Regulator,
  homeBaseTZ: string,
  globalAcclTZ: string,
): DutyEvent[] {
  return recomputeScheduleCompliance(
    events,
    regulator,
    homeBaseTZ,
    globalAcclTZ,
  )
}

export function findPreviousDuty(
  events: DutyEvent[],
  beforeStart: Date,
  excludeId?: string,
): DutyEvent | undefined {
  return events
    .filter(
      (e) =>
        e.type === 'duty' &&
        e.id !== excludeId &&
        e.end.getTime() <= beforeStart.getTime(),
    )
    .sort((a, b) => b.end.getTime() - a.end.getTime())[0]
}

/**
 * Arrival ICAO of the last flight on the chronologically latest prior FDP.
 * Used to seed the next duty’s first departure (user-overridable).
 */
export function lastFdpArrivalIcao(
  duties: DutyEvent[],
  opts?: { before?: Date; excludeId?: string },
): string | undefined {
  const beforeMs = opts?.before?.getTime()
  const candidates = duties
    .filter((e) => e.type === 'duty' && e.id !== opts?.excludeId)
    .filter((e) =>
      beforeMs == null ? true : e.end.getTime() <= beforeMs,
    )
    .sort((a, b) => b.end.getTime() - a.end.getTime())

  for (const d of candidates) {
    if (d.flights && d.flights.length > 0) {
      const legs = [...d.flights].sort(
        (a, b) => a.arr.getTime() - b.arr.getTime(),
      )
      const last = legs[legs.length - 1]
      if (last?.arrIcao) return last.arrIcao.toUpperCase()
    }
  }
  return undefined
}

export function findNextDuty(
  events: DutyEvent[],
  afterEnd: Date,
  excludeId?: string,
): DutyEvent | undefined {
  return events
    .filter(
      (e) =>
        e.type === 'duty' &&
        e.id !== excludeId &&
        e.start.getTime() >= afterEnd.getTime(),
    )
    .sort((a, b) => a.start.getTime() - b.start.getTime())[0]
}

/** @deprecated Prefer stripAllLnr + recomputeLocalNightRests */
export function stripLnrTouching(
  events: DutyEvent[],
  dutyStart: Date,
  dutyEnd: Date,
): DutyEvent[] {
  return events.filter(
    (e) =>
      !(
        e.isLocalNightRest &&
        (e.start.getTime() === dutyEnd.getTime() ||
          e.end.getTime() === dutyStart.getTime())
      ),
  )
}
