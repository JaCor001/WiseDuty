# WiseDuty

Duty-time awareness for pilots — color-coded schedule clarity across CAR 705 (Canada), FAA, EASA, and CASA rules.

## Stack

- **Web:** React 19 + TypeScript + Vite + React Router
- **Native:** Capacitor 8 (iOS / Android)
- **Deploy (web):** GitHub Pages (`/WiseDuty/` base path)

## Scripts

| Command | Purpose |
|--------|---------|
| `npm run dev` | Local Vite dev server |
| `npm run build` | Production web build (`base: /WiseDuty/`) |
| `npm run build:native` | Capacitor-ready build (`base: ./`) |
| `npm run cap:sync` | Native build + `cap sync` |
| `npm test` | Unit tests (Vitest) |
| `npm run lint` | ESLint |
| `npm run deploy` | Publish `dist/` to GitHub Pages |

## Project layout

```
src/
  domain/           # Pure regs, time, event helpers (unit-tested)
  features/settings # Shared theme/regulator/TZ context
  shared/           # storage, notifications, UI primitives
  *.tsx             # Route pages (Landing, Calendar, Signup, Login)
```

## Branching note

Active work from the structure/scalability audit lives on  
`audit/structure-scalability-fixes` so `main` stays protected until review.

## Known limitations

- Auth is UI-only (stubs); no backend yet.
- 10+travel reminders use in-page timers (do not survive backgrounding).
- Regulatory tables are simplified pilot-app models — validate against current regs before operational use.
