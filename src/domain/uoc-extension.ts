/**
 * CAR 700.63 — Unforeseen operational circumstances (FDP extension).
 * Decision helpers for the in-app extension / UOC guideline flow.
 *
 * Max FDP extension (after PIC consults crew and judges it safe):
 * - 1 pilot: +1 h
 * - Non-augmented multi-crew: +2 h
 * - Augmented, 1 flight in FDP: +3 h
 * - Augmented, 2–3 flights: +2 h
 *
 * Event must occur within 60 min of FDP start or during the FDP
 * (not earlier than 60 min before report).
 *
 * Clock phase of the UOC extension band (default +2 h two-pilot):
 * - future: now is still before Max FDP ends (extension not started)
 * - active: now is inside Max FDP … Max FDP + extension cap
 * - ended:  now is past Max FDP + extension cap
 */
import type { DutyEvent } from './types'
import { formatDurationHMin } from './fdp-near-limit'

const H = 3_600_000

/** Default UOC cap used for clock-phase detection when crew config is unknown. */
export const DEFAULT_UOC_EXTENSION_CAP_H = 2

export type UocCrewConfig =
  | 'single_pilot'
  | 'two_pilot'
  | 'augmented_1_flight'
  | 'augmented_2_3_flights'

/** Wall-clock phase of the Max FDP → Max FDP + UOC cap window. */
export type FdpExtensionPhase = 'future' | 'active' | 'ended'

export interface FdpExtensionWindow {
  phase: FdpExtensionPhase
  /** Report / FDP start. */
  report: Date
  /** Instant Max FDP is exhausted: report + maxFdpHours. */
  extensionStart: Date
  /** Instant UOC cap is exhausted: extensionStart + extensionCapHours. */
  extensionEnd: Date
  maxFdpHours: number
  /** Cap used for the window (default 2 h two-pilot). */
  extensionCapHours: number
  /** How far the scheduled/forecast FDP exceeds Max FDP (0 if under). */
  neededExtensionHours: number
  /** Hours from now until extension starts (0 if already started/ended). */
  hoursUntilStart: number
  /** Hours from now until extension ends (0 if already ended). */
  hoursUntilEnd: number
  /** Hours since extension ended (0 if not ended). */
  hoursSinceEnd: number
}

export interface UocAnswers {
  /** UOC occurred within 60 min of report or during FDP. */
  uocTimingOk: boolean | null
  /**
   * All flight crew were consulted on fatigue and consent to the extension
   * (CAR 700.63(1) consult requirement + crew willingness).
   */
  crewConsulted: boolean | null
  /** PIC of the opinion that extending is safe. */
  picAgrees: boolean | null
  crewConfig: UocCrewConfig | null
}

export interface UocAssessmentInput {
  /** Hours of FDP used (operating when trailing DH). */
  actualHours: number
  /** Applicable max (700.28+split, or RDP-limited). */
  maxFdpHours: number
  /** True when 700.70 RDP is the tighter limit. */
  rdpLimiting: boolean
  /** Operating sectors on the duty (for default augmented flight count). */
  operatingSectors?: number
  answers: UocAnswers
}

export interface UocAssessmentResult {
  maxExtensionHours: number | null
  neededExtensionHours: number
  allowed: boolean | null
  /** Short bullets for the result panel. */
  lines: string[]
  summary: string
}

export const UOC_EMPTY_ANSWERS: UocAnswers = {
  uocTimingOk: null,
  crewConsulted: null,
  picAgrees: null,
  crewConfig: null,
}

/** Max hours PIC may add under 700.63(1) for a crew configuration. */
export function maxUocExtensionHours(config: UocCrewConfig): number {
  switch (config) {
    case 'single_pilot':
      return 1
    case 'two_pilot':
      return 2
    case 'augmented_1_flight':
      return 3
    case 'augmented_2_3_flights':
      return 2
  }
}

export function defaultCrewConfigFromSectors(
  operatingSectors?: number,
): UocCrewConfig {
  // App rarely knows augmentation; default two-pilot. If many sectors, still two-pilot.
  void operatingSectors
  return 'two_pilot'
}

/**
 * Evaluate whether an extension is available under 700.63 given wizard answers.
 */
export function assessUocExtension(
  input: UocAssessmentInput,
): UocAssessmentResult {
  const needed = Math.max(0, input.actualHours - input.maxFdpHours)
  const lines: string[] = []
  const { answers } = input

  lines.push(
    `Scheduled / forecast FDP: ${fmt(input.actualHours)} h · Max allowed: ${fmt(input.maxFdpHours)} h${input.rdpLimiting ? ' (RDP-limited)' : ''}.`,
  )
  if (needed > 1e-6) {
    lines.push(`Extension needed to cover forecast: ${fmt(needed)} h.`)
  } else {
    lines.push(
      `Margin to max: ${fmt(input.maxFdpHours - input.actualHours)} h (no extension required yet).`,
    )
  }

  if (input.rdpLimiting) {
    lines.push(
      'RDP is limiting: a 700.63 FDP extension does not by itself raise the reserve duty period cap. Completing past Max RDP still needs a valid RDP basis (e.g. 700.70(10) notice conditions if used).',
    )
  }

  if (answers.uocTimingOk === false) {
    return {
      maxExtensionHours: null,
      neededExtensionHours: needed,
      allowed: false,
      lines: [
        ...lines,
        'UOC must occur within 60 minutes of report or during the FDP — events earlier than that are not “unforeseen” under 700.63.',
      ],
      summary: 'Extension not available — UOC timing not met.',
    }
  }
  if (answers.crewConsulted === false) {
    return {
      maxExtensionHours: null,
      neededExtensionHours: needed,
      allowed: false,
      lines: [
        ...lines,
        'All flight crew must be consulted on fatigue and must consent to the extension before it can proceed (CAR 700.63(1)).',
      ],
      summary: 'Extension not available — full crew consent required.',
    }
  }
  if (answers.picAgrees === false) {
    return {
      maxExtensionHours: null,
      neededExtensionHours: needed,
      allowed: false,
      lines: [
        ...lines,
        'PIC must be of the opinion that continuing is safe; PIC may refuse the extension even if others consent.',
      ],
      summary: 'Extension not available — PIC not agreeing to extend.',
    }
  }

  if (
    answers.uocTimingOk == null ||
    answers.crewConsulted == null ||
    answers.picAgrees == null ||
    answers.crewConfig == null
  ) {
    return {
      maxExtensionHours:
        answers.crewConfig != null
          ? maxUocExtensionHours(answers.crewConfig)
          : null,
      neededExtensionHours: needed,
      allowed: null,
      lines: [
        ...lines,
        'Answer the remaining questions to finish the assessment.',
      ],
      summary: 'Assessment incomplete.',
    }
  }

  const maxExt = maxUocExtensionHours(answers.crewConfig)
  lines.push(
    `Maximum UOC extension for selected crew: +${maxExt} h (CAR 700.63(1)).`,
  )
  lines.push(
    'After any extension, rest after the FDP is increased (700.63(3)); notify the operator (700.63(4)).',
  )

  if (needed <= 1e-6) {
    return {
      maxExtensionHours: maxExt,
      neededExtensionHours: 0,
      allowed: true,
      lines: [
        ...lines,
        'You are still within Max FDP; extension is optional if further delay develops and UOC conditions hold.',
      ],
      summary: `UOC conditions look met · up to +${maxExt} h available if needed.`,
    }
  }

  if (input.rdpLimiting && needed > 1e-6) {
    return {
      maxExtensionHours: maxExt,
      neededExtensionHours: needed,
      allowed: false,
      lines: [
        ...lines,
        `Forecast needs +${fmt(needed)} h but the schedule is RDP-limited — treat as not free to extend on FDP/UOC alone.`,
      ],
      summary: 'Not free to extend on UOC alone while RDP is the limit.',
    }
  }

  if (needed <= maxExt + 1e-6) {
    return {
      maxExtensionHours: maxExt,
      neededExtensionHours: needed,
      allowed: true,
      lines: [
        ...lines,
        `Needed +${fmt(needed)} h is within the +${maxExt} h UOC cap for this crew.`,
      ],
      summary: `Extension may be available (+${fmt(needed)} h needed, up to +${maxExt} h).`,
    }
  }

  return {
    maxExtensionHours: maxExt,
    neededExtensionHours: needed,
    allowed: false,
    lines: [
      ...lines,
      `Needed +${fmt(needed)} h exceeds the +${maxExt} h UOC cap for this crew configuration.`,
    ],
    summary: `Extension not sufficient — need +${fmt(needed)} h but cap is +${maxExt} h.`,
  }
}

/** Soft default for wizard (user must confirm). */
export function suggestCrewConfig(_duty: DutyEvent): UocCrewConfig {
  return 'two_pilot'
}

/**
 * Classify where wall-clock `now` sits relative to the UOC extension band:
 *   [report + maxFdp, report + maxFdp + extensionCap]
 *
 * Default cap is +2 h (non-augmented multi-crew). Pass a different cap when
 * crew configuration is known.
 */
export function classifyFdpExtensionPhase(
  duty: DutyEvent,
  opts: {
    maxFdpHours: number
    /** Forecast / actual FDP hours (operating when trailing DH). */
    actualHours: number
    extensionCapHours?: number
    now?: Date
  },
): FdpExtensionWindow {
  const now = opts.now ?? new Date()
  const cap = opts.extensionCapHours ?? DEFAULT_UOC_EXTENSION_CAP_H
  const report = duty.start
  const maxMs = Math.max(0, opts.maxFdpHours) * H
  const capMs = Math.max(0, cap) * H
  const extensionStart = new Date(report.getTime() + maxMs)
  const extensionEnd = new Date(extensionStart.getTime() + capMs)
  const nowMs = now.getTime()

  let phase: FdpExtensionPhase
  if (nowMs < extensionStart.getTime() - 1e-6) {
    phase = 'future'
  } else if (nowMs <= extensionEnd.getTime() + 1e-6) {
    phase = 'active'
  } else {
    phase = 'ended'
  }

  const hoursUntilStart = Math.max(
    0,
    (extensionStart.getTime() - nowMs) / H,
  )
  const hoursUntilEnd = Math.max(0, (extensionEnd.getTime() - nowMs) / H)
  const hoursSinceEnd = Math.max(0, (nowMs - extensionEnd.getTime()) / H)
  const neededExtensionHours = Math.max(0, opts.actualHours - opts.maxFdpHours)

  return {
    phase,
    report,
    extensionStart,
    extensionEnd,
    maxFdpHours: opts.maxFdpHours,
    extensionCapHours: cap,
    neededExtensionHours,
    hoursUntilStart,
    hoursUntilEnd,
    hoursSinceEnd,
  }
}

/**
 * CAR 700.63(3)/(4) rest + notification implications after a UOC extension.
 * Used when the extension window is already in the past (or to inform crew).
 */
export function uocExtensionRestImplications(opts: {
  neededExtensionHours: number
  extensionCapHours?: number
  limitKind?: 'FDP' | 'RDP'
}): string[] {
  const needed = Math.max(0, opts.neededExtensionHours)
  const cap = opts.extensionCapHours ?? DEFAULT_UOC_EXTENSION_CAP_H
  const used = needed > 1e-6 ? Math.min(needed, cap) : cap
  const lines: string[] = [
    `CAR 700.63(3): after a UOC-extended FDP, the following rest period is increased by the amount of the extension (about ${formatDurationHMin(used)} if +${fmt(used)} h was used).`,
    'Confirm the longer rest is planned before the next duty or availability period.',
    'CAR 700.63(4): the air operator must be notified of the extension as soon as possible.',
  ]
  if (opts.limitKind === 'RDP') {
    lines.push(
      'This duty was RDP-limited (700.70): a 700.63 FDP extension does not by itself raise the reserve duty period cap — confirm the RDP basis with your company.',
    )
  }
  if (needed > cap + 1e-6) {
    lines.push(
      `Forecast exceeded the +${fmt(cap)} h UOC cap by ${formatDurationHMin(needed - cap)} — company re-plan may still be required.`,
    )
  }
  return lines
}

/** Contact-company footer used on all near/over Max FDP prompts. */
export const UOC_CONTACT_COMPANY_NOTE =
  'Contact your company if an extension, re-plan, or rest change is required so the assignment can be updated.'

/**
 * Build post-save dialog content from near/over Max FDP status + extension phase.
 */
export function buildFdpExtensionPhasePrompt(opts: {
  phase: FdpExtensionPhase
  limitKind: 'FDP' | 'RDP'
  assessmentMessage: string
  remainingLabel: string
  window: FdpExtensionWindow
}): {
  title: string
  message: string
  /** Choice buttons when phase is future; empty for alert-only phases. */
  choices: { id: string; label: string }[]
  kind: 'choice' | 'alert'
} {
  const { phase, limitKind, assessmentMessage, remainingLabel, window: w } =
    opts
  const restLines = uocExtensionRestImplications({
    neededExtensionHours: w.neededExtensionHours,
    extensionCapHours: w.extensionCapHours,
    limitKind,
  })
  const contact = UOC_CONTACT_COMPANY_NOTE
  const capLabel = `+${fmt(w.extensionCapHours)} h`

  if (phase === 'ended') {
    const need =
      w.neededExtensionHours > 1e-6
        ? `An extension of about ${formatDurationHMin(w.neededExtensionHours)} was needed past Max ${limitKind}.`
        : `The UOC extension window (${capLabel} past Max ${limitKind}) has already ended.`
    return {
      kind: 'alert',
      title: `UOC extension window ended (Max ${limitKind})`,
      message: [
        assessmentMessage,
        need,
        'An extension was required under unforeseen operational circumstances (CAR 700.63). Rest implications apply:',
        ...restLines.map((l) => `• ${l}`),
        contact,
      ].join('\n\n'),
      choices: [],
    }
  }

  if (phase === 'active') {
    const need =
      w.neededExtensionHours > 1e-6
        ? `Forecast needs about ${formatDurationHMin(w.neededExtensionHours)} past Max ${limitKind}.`
        : `You are inside the ${capLabel} UOC band past Max ${limitKind}.`
    return {
      kind: 'alert',
      title: `UOC extension required (Max ${limitKind})`,
      message: [
        assessmentMessage,
        need,
        `A UOC extension is required if this duty continues. The extension window is active now (up to ${capLabel} past Max ${limitKind}; about ${formatDurationHMin(w.hoursUntilEnd)} remaining in that window).`,
        'Consult crew and PIC under CAR 700.63 before continuing. Rest after release will increase by the extension used (700.63(3)); notify the operator (700.63(4)).',
        contact,
      ].join('\n\n'),
      choices: [],
    }
  }

  // future — extension window has not started yet
  const margin =
    w.neededExtensionHours > 1e-6
      ? `Forecast already needs about ${formatDurationHMin(w.neededExtensionHours)} past Max ${limitKind}.`
      : `Remaining to Max ${limitKind}: ${remainingLabel || formatDurationHMin(w.hoursUntilStart)}.`
  return {
    kind: 'choice',
    title: `FDP approaching / near Max ${limitKind}`,
    message: [
      assessmentMessage,
      margin,
      `The ${capLabel} UOC extension window has not started yet (begins in about ${formatDurationHMin(w.hoursUntilStart)} at Max ${limitKind}).`,
      'If you may need to extend, review the guidelines now. If you will not extend, contact your company early.',
      contact,
    ].join('\n\n'),
    choices: [
      { id: 'guidelines', label: 'Review Extending Duty Guidelines' },
      { id: 'got_it', label: 'Got it' },
      { id: 'refuse', label: "I won't extend" },
    ],
  }
}

function fmt(n: number): string {
  const r = Math.round(n * 10) / 10
  return Number.isInteger(r) ? String(r) : r.toFixed(1)
}

export const UOC_GUIDELINE_STEPS = [
  {
    id: 'timing',
    question:
      'Did the unforeseen event occur within 60 minutes of report, or during the FDP?',
    yesLabel: 'Yes — within 60 min of report or during FDP',
    noLabel: 'No — more than 60 min before report',
  },
  {
    id: 'consult',
    question:
      'Have all flight crew members been consulted on fatigue and consented to extend?',
    yesLabel: 'Yes — all crew consent to extend',
    noLabel: 'No — not all crew consent',
  },
  {
    id: 'pic',
    question:
      'Is the PIC of the opinion that extending the FDP is safe?',
    yesLabel: 'Yes — PIC agrees extension is safe',
    noLabel: 'No — PIC does not agree',
  },
] as const
