# Code quality audit — `audit/code-quality-pass`

Review of the post–PR #2 codebase. Findings below; items marked **Fixed** are implemented on this branch.

## Bugs

| Issue | Severity | Status |
|--------|----------|--------|
| Event bar position ignored minutes on multi-day start segments (`getHours()` only) | High | **Fixed** (`dayBarPosition`) |
| React keys: day cells used array index; multi-day bars reused `event.id` across days | Medium | **Fixed** |
| Long-press timer stored in React state (extra renders, stale clears) | Medium | **Fixed** (`useRef` + unmount cleanup) |
| Event bar click bubbled to day cell (double selection / side effects) | Medium | **Fixed** (`stopPropagation`) |
| Weekly limit window ended at duty *start*, undercounting hours near duty end | Medium | **Fixed** (window ends at duty *end*) |
| LNR marker math used global accl TZ, not duty-specific TZ | Medium | **Fixed** (prefer event `acclTZ`) |
| `saveEvents` rewrote localStorage on every mount | Low | **Fixed** (skip first persist) |
| Dead no-op block in `maybeBuildLnrBetween` | Low | **Fixed** |
| `findDutyOnDate` only returns first duty on a day (multi-duty days broken for edit/delete) | High | **Partial** — `findDutiesOnDate` added; UI still edits first duty only |
| “Required Rest” day action only `alert`s | Low | Open |
| `alert`/`confirm` for UX and LNR — blocks native feel | Medium | Open (needs modal system) |
| 10+travel timers don’t survive background | High (product) | Open (Capacitor Local Notifications) |
| Edit 10+travel path can persist duty then leave form open with validation | Medium | Open (order of operations) |
| `referenceTZ` stored but unused in duty math/display | Medium | Open |
| No multi-duty UI (second duty same day) | High (product) | Open |

## Inefficiencies

| Issue | Status |
|--------|--------|
| Calendar re-filters all events per cell per render | **Improved** (`eventsOnLocalDay` helper; still O(days×events) — index by day next) |
| Full timezone list built with offsets at module load (~400 `Intl` formats) | Acceptable for now; lazy/cached search later |
| ~20 `useState` fields in `Calendar` | Open — extract `useDutyForm` / `useCalendarNav` |
| `getCalendarDays` recreated each render | **Fixed** (`useMemo`) |
| Duplicate time formatting strings | **Fixed** (`formatHHmm`) |

## Structure

| Issue | Recommendation | Status |
|--------|----------------|--------|
| `Calendar.tsx` still ~900 lines (UI + domain glue) | Split: `CalendarGrid`, `DutyFormPanel`, `DayDetails` | Open |
| Global CSS conflicts (`index.css` vs app tokens) | Remove Vite template `index.css` button/h1 rules | Open |
| Pages still flat under `src/` | Move to `src/pages/` | Open |
| No error boundary | Add around router | Open |
| No auto-deploy CI | GitHub Actions on `main` | Open |
| iCloud project path | Prefer non-synced folder | Ops note |

## Changes on this branch

1. **Domain**
   - `dayBarPosition`, `formatHHmm`, `localTimeOfDayHours`
   - `eventsOnLocalDay`, `findDutiesOnDate`
   - Weekly limit uses rolling window ending at duty end
2. **Calendar**
   - Timer ref + cleanup, persist skip, bar keys, stopPropagation, memoized days
   - LNR uses duty acclimatization TZ
3. **Settings**
   - Theme toggle uses functional state update (avoids stale closure)

## Suggested follow-ups (not in this branch)

1. Multi-duty picker for edit/delete  
2. Replace `alert`/`confirm` with accessible modals  
3. Capacitor local notifications for 10+travel  
4. Split Calendar into feature components  
5. Day-indexed event map for O(1) day lookup  
6. Wire `referenceTZ` into Zulu/local dual display consistently  
7. GitHub Actions deploy workflow  

## Verify

```bash
npm test
npm run build
npm run dev   # http://127.0.0.1:5173/WiseDuty/
```
