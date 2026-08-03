/**
 * Official schedule mutation pipeline (Phase 0 optim).
 *
 * Every mutation path must go through this module so regulation always runs as:
 *
 *   mutate → recomputeScheduleCompliance → 10+travel post-process → evaluate70029
 *   (→ persist is the caller's responsibility with the returned events)
 *
 * Optimizations may cache or index; they must not skip these steps.
 *
 * This file intentionally wraps existing domain functions without changing rules.
 */
import type { DutyEvent, Regulator, RestType, TimeFreeOption } from './types'
import {
  applyTenPlusTravelIfRestCompressed,
  recomputeAfterDutyChange,
  recomputeAfterDutyDelete,
  recomputeScheduleCompliance,
  removeDutyAndRelated,
  restIdForDuty,
  type TenPlusTravelCompression,
} from './events'
import { splitBreakRestId } from './rest-70050'
import {
  evaluate70029,
  type C70029Report,
} from './rest-70029'

/** Regulatory + TZ context for a schedule mutation. */
export interface ScheduleContext {
  regulator: Regulator
  homeBaseTZ: string
  globalAcclTZ: string
  /** CAR 700.29 option; default `auto`. */
  timeFreeOption?: TimeFreeOption
}

/**
 * Mutations the pipeline accepts.
 * UI / import / clone should map into one of these — not reimplement recompute.
 */
export type ScheduleMutation =
  | {
      type: 'upsert_duty'
      duty: DutyEvent
      restType: RestType
      /**
       * When true (default), run 10+travel compression against the previous FDP
       * after rest rebuild (same as Calendar saveDutyEvent).
       */
      applyTenPlusTravel?: boolean
    }
  | {
      type: 'delete_duty'
      dutyId: string
    }
  | {
      type: 'replace_schedule'
      events: DutyEvent[]
      /** Optional per-duty base rest prefs for recompute. */
      restTypeForDuty?: Record<string, RestType>
      /**
       * Optional duty id to check for 10+travel compression after full recompute
       * (e.g. last imported duty). Omit to skip 10+travel post-process.
       */
      tenPlusTravelTriggerDutyId?: string
      /**
       * When true, walk all duties chronologically and apply 10+travel compression
       * after each (import parity with manual multi-duty adds).
       */
      applyTenPlusTravelAll?: boolean
    }
  | {
      type: 'recompute_only'
      /** Optional per-duty base rest prefs. */
      restTypeForDuty?: Record<string, RestType>
      tenPlusTravelTriggerDutyId?: string
      applyTenPlusTravelAll?: boolean
    }

export type ScheduleNotice =
  | {
      kind: 'ten_plus_travel'
      compression: TenPlusTravelCompression
    }

export interface ScheduleMutationResult {
  /** Full schedule after recompute (+ optional 10+travel). Ready to persist. */
  events: DutyEvent[]
  /** User-facing notices (e.g. reduced rest acknowledgment). */
  notices: ScheduleNotice[]
  /** CAR 700.29 report on the resulting schedule. */
  report70029: C70029Report
}

function ctxDefaults(ctx: ScheduleContext): Required<
  Pick<ScheduleContext, 'timeFreeOption'>
> &
  ScheduleContext {
  return {
    ...ctx,
    timeFreeOption: ctx.timeFreeOption ?? 'auto',
  }
}

function evaluateReport(
  events: DutyEvent[],
  ctx: ScheduleContext,
): C70029Report {
  const c = ctxDefaults(ctx)
  return evaluate70029(
    events,
    c.globalAcclTZ,
    c.regulator,
    c.timeFreeOption,
  )
}

/**
 * Apply 10+travel compression when a triggering duty compresses prior rest.
 * Always returns a full recompute-capable event list (may be unchanged).
 */
function postProcessTenPlusTravel(
  events: DutyEvent[],
  triggerDutyId: string | undefined,
  ctx: ScheduleContext,
): { events: DutyEvent[]; notices: ScheduleNotice[] } {
  if (!triggerDutyId) return { events, notices: [] }
  const { events: next, notice } = applyTenPlusTravelIfRestCompressed(
    events,
    triggerDutyId,
    ctx.regulator,
    ctx.homeBaseTZ,
    ctx.globalAcclTZ,
  )
  if (!notice) return { events: next, notices: [] }
  return {
    events: next,
    notices: [{ kind: 'ten_plus_travel', compression: notice }],
  }
}

/**
 * Walk duties in chronological order; after each, run 10+travel compression.
 * Each step may call full recompute inside applyTenPlusTravelIfRestCompressed.
 */
export function applyTenPlusTravelAcrossSchedule(
  events: DutyEvent[],
  ctx: ScheduleContext,
): { events: DutyEvent[]; notices: ScheduleNotice[] } {
  const duties = events
    .filter((e) => e.type === 'duty')
    .sort((a, b) => a.start.getTime() - b.start.getTime())
  let current = events
  const notices: ScheduleNotice[] = []
  for (const d of duties) {
    const post = postProcessTenPlusTravel(current, d.id, ctx)
    current = post.events
    notices.push(...post.notices)
  }
  return { events: current, notices }
}

/**
 * Official entry point for schedule mutations.
 *
 * Pipeline (never skip):
 * 1. Mutate event list
 * 2. recomputeScheduleCompliance (via recomputeAfterDutyChange / delete / full)
 * 3. 10+travel post-process when applicable
 * 4. evaluate70029 on the result
 *
 * Persist (`saveEvents`) stays outside so UI can show notices / confirm first.
 */
export function applyScheduleMutation(
  events: DutyEvent[],
  mutation: ScheduleMutation,
  ctx: ScheduleContext,
): ScheduleMutationResult {
  const notices: ScheduleNotice[] = []
  let next = events

  switch (mutation.type) {
    case 'upsert_duty': {
      next = recomputeAfterDutyChange(
        events,
        mutation.duty,
        ctx.regulator,
        ctx.homeBaseTZ,
        ctx.globalAcclTZ,
        mutation.restType,
      )
      const applyTenPlus = mutation.applyTenPlusTravel !== false
      if (applyTenPlus) {
        const post = postProcessTenPlusTravel(next, mutation.duty.id, ctx)
        next = post.events
        notices.push(...post.notices)
      }
      break
    }
    case 'delete_duty': {
      const target = events.find((e) => e.id === mutation.dutyId)
      const stripped = target
        ? removeDutyAndRelated(events, target)
        : events.filter(
            (e) =>
              e.id !== mutation.dutyId &&
              e.id !== restIdForDuty(mutation.dutyId) &&
              e.id !== splitBreakRestId(mutation.dutyId),
          )
      next = recomputeAfterDutyDelete(
        stripped,
        ctx.regulator,
        ctx.homeBaseTZ,
        ctx.globalAcclTZ,
      )
      break
    }
    case 'replace_schedule': {
      next = recomputeScheduleCompliance(
        mutation.events,
        ctx.regulator,
        ctx.homeBaseTZ,
        ctx.globalAcclTZ,
        mutation.restTypeForDuty,
      )
      if (mutation.applyTenPlusTravelAll) {
        const batch = applyTenPlusTravelAcrossSchedule(next, ctx)
        next = batch.events
        notices.push(...batch.notices)
      } else {
        const post = postProcessTenPlusTravel(
          next,
          mutation.tenPlusTravelTriggerDutyId,
          ctx,
        )
        next = post.events
        notices.push(...post.notices)
      }
      break
    }
    case 'recompute_only': {
      next = recomputeScheduleCompliance(
        events,
        ctx.regulator,
        ctx.homeBaseTZ,
        ctx.globalAcclTZ,
        mutation.restTypeForDuty,
      )
      if (mutation.applyTenPlusTravelAll) {
        const batch = applyTenPlusTravelAcrossSchedule(next, ctx)
        next = batch.events
        notices.push(...batch.notices)
      } else {
        const post = postProcessTenPlusTravel(
          next,
          mutation.tenPlusTravelTriggerDutyId,
          ctx,
        )
        next = post.events
        notices.push(...post.notices)
      }
      break
    }
    default: {
      const _exhaustive: never = mutation
      void _exhaustive
      break
    }
  }

  const report70029 = evaluateReport(next, ctx)
  return { events: next, notices, report70029 }
}

/**
 * Convenience: recompute + evaluate without structural mutation
 * (e.g. settings change that must re-stamp acclimatization / rests).
 */
export function recomputeSchedule(
  events: DutyEvent[],
  ctx: ScheduleContext,
  opts?: {
    restTypeForDuty?: Record<string, RestType>
    tenPlusTravelTriggerDutyId?: string
  },
): ScheduleMutationResult {
  return applyScheduleMutation(
    events,
    {
      type: 'recompute_only',
      restTypeForDuty: opts?.restTypeForDuty,
      tenPlusTravelTriggerDutyId: opts?.tenPlusTravelTriggerDutyId,
    },
    ctx,
  )
}
