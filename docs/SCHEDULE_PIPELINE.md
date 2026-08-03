# Schedule mutation pipeline

**Branch:** `optim` (Phases 0–5)  
**Module:** `src/domain/schedule-pipeline.ts`

## Required order (do not skip)

```
mutate
  → recomputeScheduleCompliance   (full rest rebuild for all duties)
  → 10+travel post-process          (when a trigger duty compresses prior rest)
  → evaluate70029                   (hours / SDF / Option C|D)
  → persist                         (caller: saveEvents / setState)
```

Optimizations may cache or index; they **must not** omit full rest rebuild or 700.29 evaluation after a mutation.

## Official API

```ts
import {
  applyScheduleMutation,
  recomputeSchedule,
  type ScheduleContext,
  type ScheduleMutation,
} from './domain/schedule-pipeline'

const ctx: ScheduleContext = {
  regulator: 'TC',
  homeBaseTZ: 'America/Toronto',
  globalAcclTZ: 'America/Toronto',
  timeFreeOption: 'auto',
}

const result = applyScheduleMutation(events, mutation, ctx)
// result.events      — ready to persist
// result.notices     — e.g. ten_plus_travel compression
// result.report70029 — CAR 700.29 report for UI / hard-soft gates
```

### Mutations

| `type` | Effect |
|--------|--------|
| `upsert_duty` | Insert/update duty → full recompute → optional 10+travel on that duty id |
| `delete_duty` | Remove duty + managed rest → full recompute |
| `replace_schedule` | Replace list (import) → full recompute → optional 10+travel trigger |
| `recompute_only` | No structural change; restamp + rebuild (settings / TZ) |

## Characterization

Golden outcomes for fixed schedules live in:

- `src/domain/characterization.test.ts`

These freeze rest markers, rest lengths, 700.29 violation codes, and pipeline shape so later optim phases cannot drop regulation by accident.

## Callers

Primary mutation paths should use `applyScheduleMutation` only:

- **Calendar** — duty upsert/delete, free-block apply
- **Calendar import** — `replace_schedule` + `applyTenPlusTravelAll`

Persist remains in the UI (`setEvents` → `saveEvents` effect).
