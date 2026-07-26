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
  } else if (marker === 'RR' && event.type === 'rest') {
    const hours = event.requiredRestHours
    const rule = event.restRule ?? 'CAR 700.40'
    const status = event.violated
      ? 'The following duty starts before this minimum rest ends (or rest is insufficient).'
      : 'Planned rest meets the minimum clock duration.'
    whyApplies =
      event.ruleWhy ||
      `Minimum rest of ${hours != null ? formatHours(hours) + ' h' : 'the required duration'} under ${rule}. ${status}`
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
