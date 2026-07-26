import type {
  DutyEvent,
  Regulator,
  RestType,
  StoredDutyEvent,
} from './types'
import {
  computeLocalNightRest,
  eventsOverlap,
  formatLnrViolationMessage,
  getMinRestHours,
  isDisruptiveTransition,
  type LnrViolationReason,
} from './regulations'
import {
  computeTimeZoneRestPlan,
  dutyAcclTZ,
  plannedRestInterval,
  restPlanSatisfied,
  type TimeZoneRestPlan,
} from './rest-70042'

export function serializeEvents(events: DutyEvent[]): StoredDutyEvent[] {
  return events.map((e) => ({
    id: e.id,
    title: e.title,
    start: e.start.toISOString(),
    end: e.end.toISOString(),
    type: e.type,
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
  }))
}

export function deserializeEvents(stored: StoredDutyEvent[]): DutyEvent[] {
  return stored
    .map((e) => ({
      id: e.id,
      title: e.title,
      start: new Date(e.start),
      end: new Date(e.end),
      type: e.type,
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
    }))
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

export function eventsOnLocalDay(
  events: DutyEvent[],
  date: Date,
): DutyEvent[] {
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const dayEnd = new Date(dayStart)
  dayEnd.setDate(dayEnd.getDate() + 1)
  return events.filter((e) => e.start < dayEnd && e.end > dayStart)
}

export function removeDutyAndRelated(
  events: DutyEvent[],
  duty: DutyEvent,
): DutyEvent[] {
  const restId = restIdForDuty(duty.id)
  const without = events.filter((e) => {
    if (e.id === duty.id || e.id === restId) return false
    // Drop auto LNRs; caller should recompute via recomputeLocalNightRests
    if (e.isLocalNightRest && e.restKind === 'lnr_disruptive') return false
    if (e.isLocalNightRest && !e.id.endsWith('-rest')) return false
    return true
  })
  return without
}

function restTitle(plan: TimeZoneRestPlan): string {
  if (plan.localNights >= 3) {
    return `Required Rest — 3× local night (${plan.restRule.replace('CAR ', '')})`
  }
  if (plan.localNights === 2) {
    return `Required Rest — 2× local night (${plan.restRule.replace('CAR ', '')})`
  }
  if (plan.localNights === 1) {
    const code =
      plan.restRule === 'CAR 700.51' ? '700.51' : plan.restRule.replace('CAR ', '')
    return `Required Rest — 1× local night (${code})`
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
 * Build required rest after a duty using CAR 700.40 + 700.42.
 */
export function buildRequiredRestForDuty(
  duty: DutyEvent,
  allDuties: DutyEvent[],
  regulator: Regulator,
  homeBaseTZ: string,
  globalAcclTZ: string,
  restType: RestType,
): DutyEvent {
  const plan = computeTimeZoneRestPlan(
    duty,
    allDuties,
    regulator,
    homeBaseTZ,
    globalAcclTZ,
    restType,
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
    if (e.type !== 'rest' || e.restKind === 'lnr_disruptive') return e
    // Only duty-linked required rests
    if (!e.id.endsWith('-rest')) return e

    const dutyId = e.id.replace(/-rest$/, '')
    const duty = duties.find((d) => d.id === dutyId)
    const next = duties.find(
      (d) =>
        d.id !== dutyId &&
        d.start.getTime() >= (duty?.end.getTime() ?? e.start.getTime()),
    )
    // Prefer chronological next after this rest start
    const nextAfterRest = duties
      .filter((d) => d.start.getTime() >= e.start.getTime())
      .sort((a, b) => a.start.getTime() - b.start.getTime())[0]

    const following = nextAfterRest ?? next
    const accl = e.acclTZ || duty?.acclTZ || globalAcclTZ
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
      ruleWhy: check.ok ? e.ruleWhy : `${e.ruleWhy ?? ''}\n${check.detail}`.trim(),
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
 * Strip auto-generated 700.41 LNR events (not duty-linked required rests).
 */
export function stripAllLnr(events: DutyEvent[]): DutyEvent[] {
  return events.filter(
    (e) =>
      !(
        e.isLocalNightRest &&
        (e.restKind === 'lnr_disruptive' ||
          // legacy auto LNRs without restKind / not duty-rest id
          (!e.restKind && !e.id.endsWith('-rest')))
      ),
  )
}

/**
 * Recompute every 700.41 LNR from adjacent duties after add/edit/delete.
 * Clears disruptive auto LNRs and inserts one per disruptive pair.
 * Also re-annotates required-rest violations against following duties.
 */
export function recomputeLocalNightRests(
  events: DutyEvent[],
  regulator: Regulator,
  globalAcclTZ: string,
): DutyEvent[] {
  const base = stripAllLnr(events)
  const duties = base
    .filter((e) => e.type === 'duty')
    .sort((a, b) => a.start.getTime() - b.start.getTime())

  const lnrs: DutyEvent[] = []
  for (let i = 0; i < duties.length - 1; i++) {
    const prev = duties[i]
    const next = duties[i + 1]
    const lnr = maybeBuildLnrBetween(
      prev,
      next,
      regulator,
      globalAcclTZ,
      duties,
    )
    if (lnr) lnrs.push(lnr)
  }

  return annotateRestViolations([...base, ...lnrs], globalAcclTZ)
}

/**
 * Full post-mutation recompute: rebuild one duty's required rest (700.40/42),
 * then 700.41 LNRs + violation flags.
 */
export function recomputeAfterDutyChange(
  events: DutyEvent[],
  duty: DutyEvent,
  regulator: Regulator,
  homeBaseTZ: string,
  globalAcclTZ: string,
  restType: RestType,
): DutyEvent[] {
  const withoutOldRest = events.filter((e) => e.id !== restIdForDuty(duty.id))
  const withDuty = withoutOldRest.some((e) => e.id === duty.id)
    ? withoutOldRest.map((e) => (e.id === duty.id ? duty : e))
    : [...withoutOldRest, duty]

  const rest = buildRequiredRestForDuty(
    duty,
    withDuty,
    regulator,
    homeBaseTZ,
    globalAcclTZ,
    restType,
  )
  return recomputeLocalNightRests(
    [...withDuty.filter((e) => e.id !== rest.id), rest],
    regulator,
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
