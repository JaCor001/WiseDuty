/**
 * Marker definitions, regulatory references, and case-specific explanations.
 */
import type { DutyEvent, Regulator, RestRuleCode } from './types'
import {
  dutyHasEarlyMarker,
  dutyHasLateMarker,
  dutyHasNightMarker,
  getDutyMarkers,
  type DutyMarker,
} from './regulations'
import type { C70029Violation, SingleDayFree } from './rest-70029'
import { explainSingleDayFree } from './rest-70029'
import { getZonedTimeParts, hoursBetweenTimeZones } from './time'

export interface MarkerExplanation {
  marker: DutyMarker
  label: string
  definition: string
  reference: string
  /** Why this marker applies to this specific event. */
  whyApplies: string
  violated?: boolean
}

/** Unified info sheet for marker chips and calendar events. */
export interface InfoSheetContent {
  /** Short badge / chip text (e.g. "E", "Duty", "Rest") */
  badge: string
  /** Main title */
  title: string
  /** Section 1 — what the rule is */
  rule: string
  /** Section 2 — legal / regulatory citation */
  reference: string
  /** Section 3 — why it applies to this instance */
  whyApplies: string
  /**
   * Section 4 — dense pasteable schedule/debug dump for coding chats
   * (duty times, ELN, WOCL, rest rules, 700.29 snapshot).
   */
  debugContext?: string
  /** Optional meta lines under the header (times, duration, etc.) */
  meta?: string[]
  violated?: boolean
  /** Optional secondary action (e.g. delete rest) */
  canDelete?: boolean
  eventId?: string
}

const DEFINITIONS: Record<
  DutyMarker,
  { label: string; definition: string; reference: string }
> = {
  E: {
    label: 'Early duty',
    definition:
      'Duty that begins between 02:00 and 06:59 local time at the location where the flight crew member is acclimatized.',
    reference: 'CAR definitions / AC 700-047 §2.3(b); used with CAR 700.41',
  },
  L: {
    label: 'Late duty',
    definition:
      'Duty that ends between midnight (00:00) and 01:59 local time at the location where the flight crew member is acclimatized.',
    reference: 'CAR definitions / AC 700-047 §2.3(d); used with CAR 700.41',
  },
  N: {
    label: 'Night duty',
    definition:
      'Duty that begins between 13:00 and 01:59 and ends after 01:59 at the location where the flight crew member is acclimatized.',
    reference: 'CAR definitions / AC 700-047 §2.3(f); used with CAR 700.41',
  },
  LNR: {
    label: 'Local night’s rest',
    definition:
      'A rest period of at least nine hours that takes place between 22:30 and 09:30 local time where the flight crew member is acclimatized. Travel time to or from suitable accommodation is excluded.',
    reference:
      'CAR definitions / AC 700-047 §2.3(e); CAR 700.41 / 700.42(2) / 700.51',
  },
  LNR2: {
    label: 'Two local nights’ rest',
    definition:
      'Two separate local night’s rests (each ≥9 h inside 22:30–09:30 acclimatized) required before the next flight duty period after a time-zone return to home base.',
    reference: 'CAR 700.42(2); AC 700-047 §4.44',
  },
  LNR3: {
    label: 'Three local nights’ rest',
    definition:
      'Three separate local night’s rests (each ≥9 h inside 22:30–09:30 acclimatized) required before the next flight duty period after a large time-zone return to home base with long time away.',
    reference: 'CAR 700.42(2); AC 700-047 §4.44',
  },
  RR: {
    label: 'Required rest',
    definition:
      'Minimum rest period after a flight duty period. Under CAR 700.40 this is typically 10–12 hours depending on location and accommodation; CAR 700.42 may increase the minimum when time zones differ.',
    reference: 'CAR 700.40; CAR 700.42(1)/(2); AC 700-047 §§4.37–4.44',
  },
  R10: {
    label: 'Reduced rest (10 + travel)',
    definition:
      'CAR 700.40 alternative: at least 10 hours rest in suitable accommodation, with travel time to/from accommodation in addition. Used when the following duty starts before a full 12-hour rest would end and the reduced option remains legal.',
    reference: 'CAR 700.40; AC 700-047 §§4.37–4.40',
  },
  SDF: {
    label: 'Single day free from duty',
    definition:
      'Time free from duty from the beginning of the first local night’s rest until the end of the following local night’s rest (two consecutive local nights with no duty between). Under the 60-hour option, at least one such day must fall entirely within any 168 consecutive hours, and four within any 672 consecutive hours.',
    reference: 'CAR 700.29(1)(c); AC 700-047 §§2.3(i), 4.31–4.32',
  },
}

function formatHours(h: number): string {
  return Number.isInteger(h) ? String(h) : h.toFixed(1)
}

function zoneLabel(tz: string): string {
  return tz.replace(/_/g, ' ')
}

export function locationTZ(
  event: DutyEvent,
  which: 'start' | 'end' | 'accl',
  fallback: string,
): string {
  if (which === 'start') return event.startTZ || event.acclTZ || fallback
  if (which === 'end') return event.endTZ || event.acclTZ || fallback
  return event.acclTZ || fallback
}

/**
 * Build a full explanation for a marker on a specific event.
 */
export function explainMarker(
  marker: DutyMarker,
  event: DutyEvent,
  regulator: Regulator,
  globalAcclTZ: string,
  homeBaseTZ?: string,
): MarkerExplanation {
  const base = DEFINITIONS[marker]
  const accl = locationTZ(event, 'accl', globalAcclTZ)
  const startLoc = locationTZ(event, 'start', globalAcclTZ)
  const endLoc = locationTZ(event, 'end', globalAcclTZ)
  const home = homeBaseTZ || globalAcclTZ
  const regLabel =
    regulator === 'TC' ? 'Transport Canada (CAR 705 / Subpart 700)' : regulator

  let whyApplies = ''

  if (marker === 'E' && event.type === 'duty') {
    const p = getZonedTimeParts(event.start, accl)
    whyApplies = `This duty reports at ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')} in acclimatized zone ${zoneLabel(accl)}, which falls in the early window (02:00–06:59). Regulator: ${regLabel}.`
  } else if (marker === 'L' && event.type === 'duty') {
    const p = getZonedTimeParts(event.end, accl)
    whyApplies = `This duty releases at ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')} in acclimatized zone ${zoneLabel(accl)}, which falls in the late window (00:00–01:59). Regulator: ${regLabel}.`
  } else if (marker === 'N' && event.type === 'duty') {
    const ps = getZonedTimeParts(event.start, accl)
    const pe = getZonedTimeParts(event.end, accl)
    whyApplies = `This duty starts ${String(ps.hour).padStart(2, '0')}:${String(ps.minute).padStart(2, '0')} and ends ${String(pe.hour).padStart(2, '0')}:${String(pe.minute).padStart(2, '0')} (${zoneLabel(accl)}), matching night duty (starts 13:00–01:59 and ends after 01:59). Regulator: ${regLabel}.`
  } else if (
    (marker === 'LNR' || marker === 'LNR2' || marker === 'LNR3') &&
    event.type === 'rest'
  ) {
    const nights = event.requiredLocalNights ?? 1
    const rule = event.restRule ?? 'CAR 700.41'
    const status = event.violated
      ? 'Requirements are NOT currently met for the available rest gap.'
      : 'The planned rest gap satisfies the local night requirement(s).'
    whyApplies =
      event.ruleWhy ||
      `${nights} local night’s rest required under ${rule}. Evaluated in ${zoneLabel(accl)}. ${status}`
  } else if (
    (marker === 'RR' || marker === 'R10') &&
    event.type === 'rest'
  ) {
    const hours = event.requiredRestHours
    const rule = event.restRule ?? 'CAR 700.40'
    const status = event.violated
      ? 'The following duty starts before this minimum rest ends (or rest is insufficient).'
      : marker === 'R10'
        ? 'Rest uses the CAR 700.40 10 h + travel option; confirm hotel/room key timing with the operator.'
        : 'Planned rest meets the minimum clock duration.'
    whyApplies =
      event.ruleWhy ||
      `Minimum rest of ${hours != null ? formatHours(hours) + ' h' : 'the required duration'} under ${rule}${marker === 'R10' ? ' (10+travel)' : ''}. ${status}`
  } else if (event.type === 'duty') {
    whyApplies = `Marker ${marker} on duty in ${zoneLabel(accl)} (${regLabel}).`
  } else {
    whyApplies =
      event.ruleWhy ||
      event.title ||
      `Marker ${marker} on rest event (${regLabel}).`
  }

  // Enrich RR / multi-LNR with zone math when home base known
  if (
    event.type === 'rest' &&
    home &&
    (marker === 'RR' || marker === 'LNR2' || marker === 'LNR3') &&
    event.ruleWhy
  ) {
    whyApplies = event.ruleWhy
  }

  // Optional zone context for duties near home-base rules
  if (event.type === 'duty' && homeBaseTZ) {
    const startDiff = hoursBetweenTimeZones(startLoc, home, event.start)
    const endDiff = hoursBetweenTimeZones(endLoc, home, event.end)
    if (startDiff > 0.01 || endDiff > 0.01) {
      whyApplies += ` Start location ${zoneLabel(startLoc)} (${formatHours(startDiff)} h from home base ${zoneLabel(home)}); end location ${zoneLabel(endLoc)} (${formatHours(endDiff)} h from home base).`
    }
  }

  return {
    marker,
    label: base.label,
    definition: base.definition,
    reference: base.reference,
    whyApplies,
    violated: event.violated,
  }
}

/** Static definition only (no case-specific why). */
export function markerDefinition(marker: DutyMarker): {
  label: string
  definition: string
  reference: string
} {
  return DEFINITIONS[marker]
}

/**
 * List of markers that would show for an event on a given day, with explanations.
 */
export function explainEventMarkers(
  event: DutyEvent,
  regulator: Regulator,
  globalAcclTZ: string,
  isStartOnDay: boolean,
  isEndOnDay: boolean,
  homeBaseTZ?: string,
): MarkerExplanation[] {
  const markers = getDutyMarkers(
    event,
    regulator,
    globalAcclTZ,
    isStartOnDay,
    isEndOnDay,
  )
  return markers.map((m) =>
    explainMarker(m, event, regulator, globalAcclTZ, homeBaseTZ),
  )
}

export function restRuleLabel(rule?: RestRuleCode): string {
  return rule ?? 'CAR 700.40'
}

/** Convenience for tests / UI when only classification is needed. */
export function dutyClassificationSummary(
  event: DutyEvent,
  regulator: Regulator,
  globalAcclTZ: string,
): string {
  if (event.type !== 'duty') return event.type
  const parts: string[] = []
  if (dutyHasEarlyMarker(event, regulator, globalAcclTZ)) parts.push('Early')
  if (dutyHasLateMarker(event, regulator, globalAcclTZ)) parts.push('Late')
  if (dutyHasNightMarker(event, regulator, globalAcclTZ)) parts.push('Night')
  return parts.length ? parts.join(' + ') : 'Standard day duty'
}

function formatWhen(d: Date): string {
  return d.toLocaleString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function restRuleDefinition(rule?: RestRuleCode): {
  title: string
  rule: string
  reference: string
} {
  switch (rule) {
    case 'CAR 700.41':
      return {
        title: 'Local night’s rest (disruptive schedule)',
        rule: 'When switching between late/night and early duties (or the reverse), the operator must provide a rest period that includes one local night’s rest — at least nine hours of rest inside 22:30–09:30 acclimatized local time — in addition to the rest required under section 700.40.',
        reference: 'CAR 700.41; AC 700-047 §§2.3(e), 4.41–4.42',
      }
    case 'CAR 700.42(1)':
      return {
        title: 'Rest — time zone difference (away from base)',
        rule: 'When a flight duty period ends away from home base, rest in suitable accommodation is increased to 11 hours if local time at start and end differs by four hours, or 14 hours if the difference is more than four hours.',
        reference: 'CAR 700.42(1); AC 700-047 §4.43',
      }
    case 'CAR 700.42(2)':
      return {
        title: 'Rest — time zone difference (return to base)',
        rule: 'When a flight duty period starts away from home base and ends at home base, additional rest or one to three local nights’ rest may be required depending on the time-zone difference, time away from base, and whether the return duty touches the WOCL.',
        reference: 'CAR 700.42(2); AC 700-047 §4.44',
      }
    case 'CAR 700.51':
      return {
        title: 'Local night’s rest after consecutive WOCL duties',
        rule: 'No more than three consecutive flight duty periods may each touch the window of circadian low (02:00–05:59 acclimatized) unless the crew member is provided with one local night’s rest at the end of the third such duty before the next flight duty period.',
        reference: 'CAR 700.51; AC 700-047 §4.54',
      }
    case 'CAR 700.29':
      return {
        title: 'Single day free from duty (two local nights)',
        rule: 'Under the 60-hour option, when hours of work and activity in any 168 consecutive hours require free-time structure, the flight crew member must receive one single day free from duty entirely within that period — time free from duty from the beginning of the first local night’s rest until the end of the following local night’s rest (two consecutive local nights). WiseDuty attaches that two-night requirement to the required rest after the FDP that ends the window, the same way consecutive WOCL duties attach a local night under CAR 700.51.',
        reference: 'CAR 700.29(1)(c); AC 700-047 §§2.3(i), 4.31–4.32',
      }
    case 'CAR 700.43':
      return {
        title: 'Rest after positioning (deadhead)',
        rule: 'If a flight crew member must travel for positioning immediately after a flight duty period and the FDP plus that positioning exceeds the maximum flight duty period under CAR 700.28, the rest before the next FDP must equal the hours of work when the exceedance is three hours or less, or the hours of work plus the exceedance when it is more than three hours. Rest is never shorter than CAR 700.40. Exceeding the maximum by more than three hours requires crew agreement and must not exceed seven hours (CAR 700.43(3)).',
        reference: 'CAR 700.43; AC 700-047 §§4.45–4.47',
      }
    case 'CAR 700.50':
      return {
        title: 'Split-duty break (mid-FDP)',
        rule: 'A mid-FDP break of at least 60 consecutive minutes in suitable accommodation may extend the CAR 700.28 maximum FDP. The break remains inside the FDP (it is not a rest period under 700.40), counts toward FDP length, and does not count as hours of work. Extension = (break − 45 min) × 100% if the break is during 00:00–05:59 acclimatized time, or × 50% during 06:00–23:59 (or for unforeseen replan). Travel to/from accommodation is not part of the break. Subsequent rest follows normal 700.40 rules after final release.',
        reference: 'CAR 700.50; AC 700-047 §§4.49–4.53',
      }
    case 'CAR 700.40':
    default:
      return {
        title: 'Required rest period',
        rule: 'After a flight duty period, the operator must provide a continuous rest period meeting the minimum under CAR 700.40 (typically 10–12 hours depending on home base, travel time, and suitable accommodation). Other rules may increase this minimum.',
        reference: 'CAR 700.40; AC 700-047 §§4.37–4.40',
      }
  }
}

/**
 * Convert a marker explanation into the shared info-sheet model.
 */
export function infoSheetFromMarker(m: MarkerExplanation): InfoSheetContent {
  return {
    badge: m.marker,
    title: m.label,
    rule: m.definition,
    reference: m.reference,
    whyApplies: m.whyApplies,
    violated: m.violated,
  }
}

/**
 * Info sheet for the outline phantom rest (700.41 what-if contour).
 * Distinct from the solid rest bar sheet — explains the contour itself.
 * Language is directional: because this duty is X, if next is Y → LNR.
 */
export function infoSheetFromPhantomDisruptiveRest(opts: {
  solidRestEnd: Date
  phantomEnd: Date
  thisDutyLabel: string
  ifNextLabel: string
  reason: string
}): InfoSheetContent {
  const rule =
    opts.thisDutyLabel === 'early'
      ? 'Because this duty is early (report 02:00–06:59 acclimatized), if the next duty is night or late, CAR 700.41 requires one local night’s rest (LNR) before that next FDP — not only the usual 700.40 clock rest. This outline shows how far that LNR would run. It is not required unless the next duty is actually night or late.'
      : opts.thisDutyLabel.startsWith('night')
        ? 'Because this duty is night (and/or late), if the next duty is early, CAR 700.41 requires one local night’s rest (LNR) before that next FDP — not only the usual 700.40 clock rest. This outline shows how far that LNR would run. It is not required unless the next duty is actually early.'
        : 'Because this duty is late (release 00:00–01:59 acclimatized), if the next duty is early, CAR 700.41 requires one local night’s rest (LNR) before that next FDP — not only the usual 700.40 clock rest. This outline shows how far that LNR would run. It is not required unless the next duty is actually early.'

  return {
    badge: 'Outline',
    title: `If next duty is ${opts.ifNextLabel} → LNR required`,
    rule,
    reference: 'CAR 700.41; AC 700-047 §§4.41–4.42',
    whyApplies: opts.reason,
    meta: [
      `This duty · ${opts.thisDutyLabel}`,
      `LNR only if next duty is · ${opts.ifNextLabel}`,
      `Solid rest (applies now) ends · ${opts.solidRestEnd.toLocaleString()}`,
      `Outline (what-if LNR) ends · ${opts.phantomEnd.toLocaleString()}`,
      'Tap the solid bar for the rest that actually applies now',
    ],
  }
}

/** Info sheet for a detected single day free from duty (CAR 700.29). */
export function infoSheetFromSdf(
  sdf: SingleDayFree,
  reasons?: string[],
): InfoSheetContent {
  const copy = explainSingleDayFree(sdf)
  const isProspective = reasons?.includes('prospective')
  const whyExtra =
    reasons && reasons.length
      ? reasons
          .map((r) =>
            r === 'load_bearing'
              ? 'Shown because this free day is needed to keep a 168 h / 672 h window compliant (removing it would risk a CAR 700.29 free-time violation).'
              : r === 'required_before_next'
                ? 'Shown because recent work intensity means a single day free from duty is needed before further duty in the rolling 168 h window.'
                : r === 'prospective'
                  ? 'Not yet completed — this is the earliest two local nights after your last duty where a single day free from duty can still be taken. Schedule free time covering this period before adding more flight duty, or the rolling 168 h window may close without a free day.'
                  : r,
          )
          .join(' ')
      : ''
  return {
    badge: isProspective ? 'SDF?' : 'SDF',
    title: isProspective
      ? 'Single day free from duty needed'
      : 'Single day free from duty',
    rule: copy.rule,
    reference: copy.reference,
    whyApplies: isProspective
      ? whyExtra
      : [copy.whyApplies, whyExtra].filter(Boolean).join(' '),
    meta: [
      `Start · ${sdf.start.toLocaleString()}`,
      `End · ${sdf.end.toLocaleString()}`,
      `Acclimatized TZ · ${sdf.acclTZ.replace(/_/g, ' ')}`,
      `Local nights · ${sdf.nights[0].windowKey} → ${sdf.nights[1].windowKey}`,
      ...(reasons?.length
        ? [`Display · ${reasons.join(', ')}`]
        : []),
    ],
  }
}

/** Info sheet for a 700.29 window violation. */
export function infoSheetFrom70029Violation(
  v: C70029Violation,
): InfoSheetContent {
  const hard =
    v.code === 'work_60_in_168' ||
    v.code === 'work_192_in_672' ||
    v.code === 'work_2200_in_365'
  return {
    badge: hard ? '700.29' : 'SDF?',
    title: hard
      ? 'Hours of work limit (CAR 700.29)'
      : 'Time free from duty (CAR 700.29)',
    rule: hard
      ? 'A flight crew member’s hours of work must not exceed 2,200 h in 365 days, 192 h in 28 days, or (under the standard option) 60 h in 7 consecutive days when the required single days free from duty are provided.'
      : 'Under CAR 700.29(1)(c), the 60 h / 7-day limit applies only when the member also receives at least one single day free from duty entirely within each 168 consecutive hours, and four such days within each 672 consecutive hours.',
    reference: 'CAR 700.29(1); AC 700-047 §§4.31–4.32',
    whyApplies: v.detail,
    meta: [
      `Window · ${v.windowStart.toLocaleString()} → ${v.windowEnd.toLocaleString()}`,
      ...(v.workHours != null
        ? [`Work in window · ${v.workHours.toFixed(1)} h`]
        : []),
      ...(v.sdfCount != null ? [`SDFs fully inside · ${v.sdfCount}`] : []),
    ],
    violated: true,
  }
}

/**
 * Build a three-section info sheet for a duty or rest calendar bar.
 */
export function explainEvent(
  event: DutyEvent,
  regulator: Regulator,
  globalAcclTZ: string,
  homeBaseTZ?: string,
): InfoSheetContent {
  const accl = locationTZ(event, 'accl', globalAcclTZ)
  const startLoc = locationTZ(event, 'start', globalAcclTZ)
  const endLoc = locationTZ(event, 'end', globalAcclTZ)
  const home = homeBaseTZ || globalAcclTZ
  const hours =
    (event.end.getTime() - event.start.getTime()) / (1000 * 60 * 60)
  const regLabel =
    regulator === 'TC' ? 'Transport Canada (CAR Subpart 700)' : regulator

  const meta = [
    `Start · ${formatWhen(event.start)}`,
    `End · ${formatWhen(event.end)}`,
    `Duration · ${formatHours(hours)} h`,
  ]

  if (event.type === 'duty') {
    const classification = dutyClassificationSummary(
      event,
      regulator,
      globalAcclTZ,
    )
    meta.push(`Classification · ${classification}`)
    meta.push(`Acclimatized TZ · ${zoneLabel(accl)}`)
    if (startLoc !== endLoc || startLoc !== home) {
      meta.push(
        `Locations · start ${zoneLabel(startLoc)}, end ${zoneLabel(endLoc)}, home ${zoneLabel(home)}`,
      )
    }

    let why = `This flight duty period runs ${formatHours(hours)} h from report to final release, evaluated for ${regLabel} using acclimatized time in ${zoneLabel(accl)}.`
    if (classification !== 'Standard day duty') {
      why += ` It is classified as ${classification.toLowerCase()} for early/late/night rules (AC 700-047 §2.3).`
    }
    if (event.endsWithPositioning && event.operatingEnd) {
      const opH =
        (event.operatingEnd.getTime() - event.start.getTime()) / (1000 * 60 * 60)
      const posH =
        (event.end.getTime() - event.operatingEnd.getTime()) / (1000 * 60 * 60)
      meta.push(`Operating release · ${formatWhen(event.operatingEnd)}`)
      meta.push(
        `Operating FDP · ${formatHours(opH)} h · Positioning (DH) · ${formatHours(posH)} h`,
      )
      if (event.operatingSectors != null) {
        meta.push(`Operating sectors · ${event.operatingSectors}`)
      }
      if (event.positioningSectors != null && event.positioningSectors > 0) {
        meta.push(`Positioning sectors · ${event.positioningSectors}`)
      }
      if (event.positioningAgreed) {
        meta.push('Extended positioning · crew agreed (700.43(3))')
      }
      why += ` Ends with trailing deadhead/positioning after operating release (${formatHours(posH)} h). Positioning flights do not count toward the 700.28 sector column; rest after an overrun follows CAR 700.43.`
    } else if (event.operatingSectors != null) {
      meta.push(`Operating sectors · ${event.operatingSectors}`)
      if (event.positioningSectors != null && event.positioningSectors > 0) {
        meta.push(`Positioning sectors · ${event.positioningSectors}`)
      }
    }
    if (event.splitBreak) {
      const brH =
        (event.splitBreak.end.getTime() - event.splitBreak.start.getTime()) /
        (1000 * 60 * 60)
      meta.push(
        `Split-duty break · ${formatHours(brH)} h (${formatWhen(event.splitBreak.start)} → ${formatWhen(event.splitBreak.end)})`,
      )
      why +=
        ' Includes a CAR 700.50 split-duty break in suitable accommodation (mid-FDP; not post-duty rest). The break counts toward FDP length but not hours of work.'
    }
    if (event.violated) {
      why += ' A compliance flag is set (for example overlap with rest).'
    }

    return {
      badge: event.endsWithPositioning
        ? 'Duty+DH'
        : event.splitBreak
          ? 'Duty+Split'
          : 'Duty',
      title: event.title || 'Flight duty period',
      rule: 'A flight duty period (FDP) is the time from the earlier of report for duty, report for flight, positioning, or standby, until engines off / rotors stopped at the end of the last operating flight. Positioning after that is duty/hours of work and may extend total duty under CAR 700.43. Maximum operating FDP depends on acclimatized start time, operating sectors (positioning not counted), average sector time, and any augmentation or split-duty provisions (CAR 700.50 mid-FDP break in suitable accommodation).',
      reference:
        regulator === 'TC'
          ? 'CAR 700.28 (maximum FDP, incl. (6) positioning not a flight); CAR 700.50 (split flight duty); CAR 700.43 (rest after positioning); CAR 101 / AC 700-047 §2.3'
          : `${regLabel} flight duty period limitations`,
      whyApplies: why,
      meta,
      violated: event.violated,
      eventId: event.id,
    }
  }

  // Rest event
  const def = restRuleDefinition(event.restRule)
  if (event.requiredRestHours != null) {
    meta.push(`Minimum clock rest · ${formatHours(event.requiredRestHours)} h`)
  }
  if (event.requiredLocalNights != null && event.requiredLocalNights > 0) {
    meta.push(`Local nights required · ${event.requiredLocalNights}`)
  }
  if (event.restRule) {
    meta.push(`Rule · ${event.restRule}`)
  }
  if (event.restRule === 'CAR 700.43') {
    meta.push('Rest extended due to trailing positioning / deadhead')
  }
  if (event.restKind === 'split_break' || event.restRule === 'CAR 700.50') {
    meta.push('Mid-FDP break · still inside flight duty period')
    meta.push('Not hours of work (CAR 700.29)')
  }

  const isSplit = event.restKind === 'split_break' || event.restRule === 'CAR 700.50'
  const status = isSplit
    ? 'This break is part of the surrounding flight duty period and does not replace post-FDP rest under CAR 700.40.'
    : event.violated
      ? 'This rest requirement is currently not met (insufficient gap and/or night window before the next duty).'
      : 'Based on the current schedule, this rest requirement is met.'

  return {
    badge: isSplit ? 'Split' : event.isLocalNightRest ? 'LNR' : 'Rest',
    title: def.title,
    rule: def.rule,
    reference: def.reference,
    whyApplies: [event.ruleWhy, status].filter(Boolean).join(' '),
    meta,
    violated: event.violated,
    canDelete: !isSplit,
    eventId: event.id,
  }
}
